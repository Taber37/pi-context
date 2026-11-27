import { reconcileUsage } from '../measurement/index.mjs';
import { measureTranscript } from './attribution.mjs';
import { measureChat, reportedChatInput } from './chat-completions.mjs';

const safeLabel = (value) => typeof value === 'string' && /^[\w./:@+-]{1,160}$/u.test(value) ? value : null;
const number = (value) => Number.isFinite(value) && value >= 0 ? value : null;
const sameModel = (a, b) => a?.id === b?.model && a?.provider === b?.provider && a?.api === b?.api;
const usageText = 'Usage: /gentle:context [all]';

export function installContext(pi, render, clock = Date.now) {
  let pending = null, capture = null, staleReason = null, inTurn = false;
  const invalidate = (reason) => {
    capture = null; pending = null; inTurn = false;
    staleReason = reason;
  };
  for (const [event, reason] of Object.entries({ session_start: 'session changed', session_shutdown: 'session changed',
    session_compact: 'compaction', session_tree: 'branch changed', model_select: 'model changed' })) {
    pi.on(event, () => { invalidate(reason); });
  }
  pi.on('turn_start', () => { pending = null; inTurn = true; });
  for (const event of ['turn_end', 'agent_end', 'agent_settled']) {
    pi.on(event, () => { pending = null; inTurn = false; });
  }
  pi.on('context_with_system', ({ messages }, ctx) => {
    if (!inTurn) return;
    if (pending) { pending.ambiguous = true; return; }
    const snapshot = measureTranscript(messages, pi, safeLabel(ctx.model?.id));
    if (!snapshot) return;
    pending = { snapshot, requests: 0, responses: 0, input: null };
    capture = { snapshot, ageFrom: clock(), reconciliation: null };
    staleReason = null;
  });
  pi.on('before_provider_request', ({ payload }, ctx) => {
    if (!pending) return;
    const { snapshot } = pending;
    const first = ++pending.requests === 1 && !pending.ambiguous;
    const observed = first && ctx.model?.api === 'openai-completions'
      ? measureChat(payload, pi, safeLabel(ctx.model.id)) : null;
    pending.chat = observed !== null;
    capture = { snapshot: observed ?? snapshot, ageFrom: clock(), reconciliation: null };
    staleReason = null;
  });
  pi.on('after_provider_response', ({ status }) => {
    if (!pending) return;
    pending.responses++;
    if (status < 200 || status >= 300) pending.ambiguous = true;
  });
  pi.on('provider_stream_event', (event, ctx) => {
    if (!pending?.chat || !sameModel(ctx.model, event)) return;
    const input = reportedChatInput(event.data);
    if (input !== null) {
      if (pending.input !== null && pending.input !== input) pending.ambiguous = true;
      pending.input = input;
    }
  });
  pi.on('message_end', ({ message }, ctx) => {
    if (message.role !== 'assistant' || !pending) return;
    const { chat, requests, responses, ambiguous, input } = pending;
    pending = null;
    inTurn = false;
    if (!chat || requests !== 1 || responses !== 1 || ambiguous || input === null || !sameModel(ctx.model, message) ||
        !['stop', 'length', 'toolUse'].includes(message.stopReason)) return;
    // Public hooks cannot certify that an extension loaded after us left the observed body unchanged.
    const result = reconcileUsage(capture.snapshot, { usage: message.usage, match: { sameCall: true, unchanged: false } });
    if (result.inputTokens === input) capture.reconciliation = result;
  });
  pi.registerCommand('gentle:context', {
    description: 'Show context usage and conditional MCP savings (add all for details)',
    getArgumentCompletions: (prefix) => 'all'.startsWith(prefix) ? [{ value: 'all', label: 'all' }] : null,
    async handler(args, ctx) {
      if (!ctx.hasUI) return;
      const arg = args.trim();
      if (arg && arg !== 'all') { ctx.ui.notify(usageText, 'warning'); return; }
      const usage = ctx.getContextUsage();
      const report = { snapshot: capture?.snapshot ?? null, model: safeLabel(ctx.model?.id),
        projected: usage ? { tokens: number(usage.tokens), contextWindow: number(usage.contextWindow), percent: number(usage.percent) } : null,
        ageMs: capture ? Math.max(0, clock() - capture.ageFrom) : null,
        reconciliation: capture?.reconciliation ?? null, staleReason };
      const detail = arg === 'all';
      if (ctx.mode !== 'tui') { ctx.ui.notify(render(report, { width: 80, detail }).join('\n'), 'info'); return; }
      await ctx.ui.custom((tui, theme, keys, done) => {
        let offset = 0, cachedWidth, rows;
        const hint = (...actions) => actions.map((action) => keys.getKeys?.(`tui.select.${action}`)?.[0])
          .filter((key) => /^[a-z0-9+_-]+$/i.test(key ?? '')).join('/');
        const scroll = detail && theme ? hint('up', 'down') : '';
        const close = detail && theme ? hint('cancel', 'confirm') : '';
        const controls = [scroll && `${scroll} scroll`, close && `${close} close`].filter(Boolean).join(' · ');
        return {
          render(width) {
            if (!rows || cachedWidth !== width) {
              rows = render(report, { width, detail, ...(theme ? { theme } : {}) });
              cachedWidth = width;
            }
            // The inline Pi dialog also shares the screen with the host status and footer.
            const maxHeight = Math.max(1, tui.terminal.rows - (detail && theme ? 4 : 2));
            const status = controls && controls.length <= width && maxHeight > 1;
            const height = maxHeight - (status ? 1 : 0);
            offset = Math.max(0, Math.min(offset, rows.length - height));
            const visible = rows.slice(offset, offset + height);
            if (status) visible.push(theme.fg('muted', controls));
            return visible;
          },
          handleInput(data) {
            if (keys.matches(data, 'tui.select.cancel') || keys.matches(data, 'tui.select.confirm')) done(undefined);
            else if (keys.matches(data, 'tui.select.up') || keys.matches(data, 'tui.select.down')) {
              offset += keys.matches(data, 'tui.select.up') ? -1 : 1;
              tui.requestRender();
            }
          },
          invalidate() { rows = undefined; },
        };
      });
    },
  });
}
