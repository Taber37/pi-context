import assert from 'node:assert/strict';
import test from 'node:test';
import { installContext } from '../src/pi/controller.mjs';
import { renderContext } from '../src/view/render.mjs';

const model = { id: 'fixture-model', provider: 'fixture', api: 'openai-completions' };
const projected = { tokens: 120, contextWindow: 1000, percent: 12 };
const marker = 'RAW_PRIVATE_MARKER';
const intro = 'MCP servers whose tools are not declared to you. Load the tools of `tool_search` servers with `tool_search`.';
const line = `- mcp__catalog (tool_search): café ${marker}`;
const section = `<mcp_servers>\n${intro}\n${line}\n</mcp_servers>`;
const schema = { type: 'object', properties: { label: { type: 'string', description: marker } } };
const declaration = { name: 'renamed_tool', description: marker, parameters: schema };
const shared = { name: 'tool_search', description: 'Discovery', parameters: {} };
const standalone = { name: 'standalone', description: 'Fixture extension tool', parameters: {} };
const tools = [
  { ...declaration, exposure: 'direct', sourceInfo: { path: 'builtin:mcp', source: 'builtin' },
    namespace: { name: 'mcp__catalog', aliases: ['Catalog'], instructions: marker } },
  { ...shared, sourceInfo: { path: 'builtin:tool-search', source: 'builtin' } },
  { ...standalone, sourceInfo: { path: '/synthetic/tools.ts', source: 'local' } },
];
const messages = [
  { role: 'system', content: marker, sections: { mcp_servers: section }, toolsAdded: [declaration, shared, standalone] },
  { role: 'toolResult', toolName: declaration.name, toolCallId: marker, content: [{ type: 'text', text: marker }] },
  { role: 'user', content: 'shortened' },
];
const payload = { model: model.id, stream: true, prompt_cache_key: marker,
  messages: [{ role: 'system', content: `${marker}\n${section}` },
    { role: 'tool', content: marker, tool_call_id: marker }, { role: 'user', content: 'shortened' }],
  tools: [declaration, shared, standalone].map((fn) => ({ type: 'function', function: fn })),
};
const usage = { input: 80, cacheRead: 20, cacheWrite: 5, output: 1, totalTokens: 106 };
const assistant = { role: 'assistant', model: model.id, provider: model.provider, api: model.api,
  stopReason: 'stop', content: [{ type: 'text', text: marker }], usage };
const streamData = { usage: { prompt_tokens: 105, completion_tokens: 1 }, choices: [] };

function harness(overrides = {}) {
  const handlers = new Map(), calls = [], output = [];
  let command, time = 100, width = 58;
  const ctx = { model, mode: 'tui', hasUI: true, getContextUsage: () => ({ ...projected, content: marker }),
    ui: { custom: (factory) => {
      let closed = false;
      const component = factory({ terminal: { rows: 30 } }, null, { matches: () => true }, () => { closed = true; });
      output.push(component.render(width));
      component.handleInput('\x1b');
      assert.equal(closed, true);
    }, notify: (text) => output.push(text) }, ...overrides };
  installContext({ on: (type, handler) => handlers.set(type, handler),
    getAllTools: () => tools, getActiveTools: () => tools.map(({ name }) => name), registerCommand: (name, definition) => {
      assert.equal(name, 'gentle:context'); command = definition;
    } }, (report, options) => { calls.push({ report, options }); return ['local report']; }, () => time);
  const emit = (type, fields = {}) => assert.equal(handlers.get(type)?.({ type, ...fields }, ctx), undefined);
  const start = (transcript = messages) => {
    emit('turn_start', { turnIndex: 0 });
    emit('context_with_system', { messages: transcript });
  };
  const rawUsage = (data = streamData) => emit('provider_stream_event',
    { model: model.id, provider: model.provider, api: model.api, data });
  const request = (body = payload) => emit('before_provider_request', { payload: body });
  const response = (status = 200) => emit('after_provider_response', { status, headers: { fixture: marker } });
  const end = (message = assistant) => emit('message_end', { message });
  return { ctx, emit, start, request, response, rawUsage, end, command, calls, output,
    show: async (args = '', nextWidth = 58) => {
      time += 10; width = nextWidth; await command.handler(args, ctx); return calls.at(-1);
    } };
}

test('empty overview and all are width-aware and do not touch history or provider', async () => {
  const h = harness();
  assert.deepEqual(await h.show(), { report: { snapshot: null, model: model.id, projected, ageMs: null,
    reconciliation: null, staleReason: null }, options: { detail: false, width: 58 } });
  assert.deepEqual((await h.show(' all ', 25)).options, { detail: true, width: 25 });
  assert.deepEqual(h.command.getArgumentCompletions('a'), [{ value: 'all', label: 'all' }]);
  await h.show(marker);
  assert.deepEqual(h.output, [['local report'], ['local report'], 'Usage: /gentle:context [all]']);
  assert.equal(h.calls.length, 2);
  const print = harness({ mode: 'print', hasUI: false });
  await print.show('all');
  assert.deepEqual([print.calls, print.output], [[], []]);
  const rpc = harness({ mode: 'rpc' });
  await rpc.show();
  assert.deepEqual(rpc.output, ['local report']);
});

test('interactive details use the theme and keep scroll and close keys; overview and RPC stay separate', async () => {
  const events = new Map(), notifications = [], roles = [];
  let command, component, redraws = 0, closes = 0;
  const theme = {
    fg(role, text) { roles.push(role); return `\x1b[32m${text}\x1b[39m`; },
    bold(text) { return `\x1b[1m${text}\x1b[22m`; },
  };
  const terminal = { rows: 6 };
  const bindings = { up: 'up', down: 'down', cancel: 'escape', confirm: 'enter' };
  const keys = { matches: (input, action) => input === action, getKeys: (action) => [bindings[action.split('.').at(-1)]] };
  const ctx = { model, mode: 'tui', hasUI: true, getContextUsage: () => projected,
    ui: { custom(factory) {
      component = factory({ terminal, requestRender: () => redraws++ }, theme, keys, () => closes++);
    }, notify: (text, type) => notifications.push([text, type]) } };
  installContext({ on: (event, handler) => events.set(event, handler),
    getAllTools: () => tools, getActiveTools: () => tools.map(({ name }) => name),
    registerCommand: (_name, definition) => { command = definition; } }, renderContext, () => 0);
  events.get('turn_start')({}, ctx);
  events.get('context_with_system')({ messages }, ctx);

  await command.handler('', ctx);
  const top = component.render(80);
  assert.equal(top.length, 4);
  assert.match(top[0], /\x1b\[1m.*Context usage/);
  assert.match(top.join('\n'), /■.*fixture-model/);
  assert.ok(roles.includes('accent') && roles.includes('dim'));
  component.handleInput('tui.select.down');
  assert.equal(redraws, 1);
  assert.deepEqual(component.render(80).slice(0, 3), top.slice(1));
  component.handleInput('tui.select.up');
  assert.deepEqual(component.render(80), top);
  const calls = roles.length;
  component.invalidate();
  assert.deepEqual(component.render(80), top);
  assert.ok(roles.length > calls);
  component.handleInput('tui.select.cancel');
  assert.equal(closes, 1);

  terminal.rows = 8;
  await command.handler('all', ctx);
  const detailTop = component.render(80);
  assert.equal(detailTop.length, 4);
  assert.match(detailTop[0], /\x1b\[1m.*Context usage · Details/);
  assert.match(detailTop.at(-1), /up\/down scroll.*escape\/enter close/);
  component.handleInput('tui.select.down');
  assert.deepEqual(component.render(80).slice(0, 2), detailTop.slice(1, 3));
  assert.equal(component.render(80).at(-1), detailTop.at(-1));
  for (let i = 0; i < 100; i++) component.handleInput('tui.select.down');
  const detailEnd = component.render(80);
  assert.match(detailEnd.at(-2), /Discrepancy \(provider minus estimate\): unknown/);
  component.handleInput('tui.select.down');
  assert.deepEqual(component.render(80), detailEnd);
  assert.match(component.render(44).at(-1), /scroll.*close/);
  terminal.rows = 100;
  const detail = component.render(80).join('\n');
  assert.match(detail, /Current footprint by MCP/);
  assert.match(detail, /If disabled · next full request/);
  assert.doesNotMatch(detail, /\/gentle:context all|# occupied/);
  component.handleInput('tui.select.confirm');
  assert.equal(closes, 2);
  await command.handler('all', { ...ctx, mode: 'rpc' });
  await command.handler('', { ...ctx, mode: 'rpc' });
  await command.handler('other', ctx);
  assert.match(notifications[0][0], /^Context: fixture-model\nProjected: 120 \/ 1,000 tokens \(12%\)\nFree: 880 tokens\n/);
  assert.match(notifications[0][0], /Observed request detail/);
  assert.doesNotMatch(notifications[0][0], /\x1b|Context usage/);
  assert.equal(notifications[0][1], 'info');
  assert.match(notifications[1][0], /^Context: fixture-model\nProjected: /);
  assert.doesNotMatch(notifications[1][0], /\x1b|Context usage|Observed request detail/);
  assert.deepEqual(notifications[2], ['Usage: /gentle:context [all]', 'warning']);
});

test('complete observed call separates tool costs and retained results from provider usage', async () => {
  const h = harness();
  h.start(); h.request(); h.response(); h.rawUsage(); h.end();
  const { report } = await h.show('all');
  assert.equal(report.ageMs, 10);
  assert.deepEqual(report.snapshot.observation, { format: 'fragments', coverage: 'full' });
  assert.equal(report.snapshot.groups.conversation.textBytes, Buffer.byteLength('shortened'));
  assert.equal(report.snapshot.groups.results.textBytes, Buffer.byteLength(marker));
  assert.equal(report.snapshot.origins.shared.textBytes, Buffer.byteLength(JSON.stringify(payload.tools[1])));
  const [server] = report.snapshot.servers;
  assert.equal(server.id, 'Catalog');
  assert.equal(server.exposure, 'direct');
  assert.equal(server.savings.declarationBytes, Buffer.byteLength(JSON.stringify(payload.tools[0])));
  assert.equal(server.savings.announcementBytes, null);
  assert.deepEqual(report.reconciliation, { inputTokens: 105, discrepancy: null });
  assert.doesNotMatch(JSON.stringify([h.calls, h.output]), /RAW_PRIVATE_MARKER|renamed_tool|prompt_cache_key/u);
});

test('MCP announcement-shaped prose in a direct server request is only system text', async () => {
  const h = harness();
  const [system, ...history] = messages;
  const content = `${marker}\n${section}`;
  h.start([{ role: 'system', content, toolsAdded: system.toolsAdded }, ...history]);
  h.request(); h.response(); h.rawUsage(); h.end();
  const { snapshot, reconciliation } = (await h.show('all')).report;
  assert.deepEqual(snapshot.observation, { format: 'fragments', coverage: 'full' });
  assert.equal(snapshot.groups.system.textBytes, Buffer.byteLength(content));
  const [server] = snapshot.servers;
  assert.equal(server.exposure, 'direct');
  assert.equal(server.announcements.textBytes, 0);
  assert.equal(server.savings.announcementBytes, null);
  assert.ok(server.savings.declarationBytes > 0);
  assert.deepEqual(reconciliation, { inputTokens: 105, discrepancy: null });
  assert.doesNotMatch(JSON.stringify([h.calls, h.output]), /RAW_PRIVATE_MARKER/u);
});

test('structured Pi announcements stay attributable logically, not in rewritten or ambiguous provider text', async () => {
  const replacement = section.replace('mcp__catalog', 'mcp__counter');
  assert.equal(Buffer.byteLength(replacement), Buffer.byteLength(section));
  for (const [scenario, text] of [
    ['changed description', `${marker}\n${section.replace('café', 'new description')}`],
    ['same-size replacement', `${marker}\n${replacement}`],
    ['duplicate blocks', `${marker}\n${section}\n${section}`],
    ['omitted block', marker],
  ]) {
    const h = harness();
    h.start();
    const logical = (await h.show('all')).report.snapshot;
    assert.equal(logical.observation.format, 'pi-transcript', scenario);
    assert.equal(logical.servers[0].exposure, 'mixed', scenario);
    assert.equal(logical.servers[0].savings.announcementBytes, Buffer.byteLength(line), scenario);
    h.request({ ...payload, messages: [{ role: 'system', content: text }, ...payload.messages.slice(1)] });
    h.response(); h.rawUsage(); h.end();
    const { snapshot, reconciliation } = (await h.show('all')).report;
    assert.deepEqual(snapshot.observation, { format: 'fragments', coverage: 'full' }, scenario);
    assert.equal(snapshot.groups.system.textBytes, Buffer.byteLength(text), scenario);
    const [server] = snapshot.servers;
    assert.equal(server.exposure, 'direct', scenario);
    assert.equal(server.announcements.textBytes, 0, scenario);
    assert.equal(server.savings.announcementBytes, null, scenario);
    assert.ok(server.savings.declarationBytes > 0, scenario);
    assert.equal(snapshot.origins.shared.textBytes, Buffer.byteLength(JSON.stringify(payload.tools[1])), scenario);
    assert.deepEqual(reconciliation, { inputTokens: 105, discrepancy: null }, scenario);
    assert.doesNotMatch(JSON.stringify([h.calls, h.output]), /RAW_PRIVATE_MARKER/u);
  }
});

test('later rewrites cannot certify discrepancy; retries, placeholders and deltas suppress usage', async () => {
  for (const uncertain of ['retry', 'missing', 'mismatch', 'placeholder', 'unmatched', 'extra payload', 'error', 'delta']) {
    const h = harness(uncertain === 'delta' ? { model: { ...model, api: 'openai-codex-responses' } } : {});
    if (uncertain !== 'unmatched') h.start();
    h.request(uncertain === 'delta' ? { previous_response_id: marker, input: [{ content: marker }] } : payload);
    if (uncertain === 'extra payload') h.request();
    if (uncertain === 'retry') h.response(429);
    h.response();
    const promptTokens = { mismatch: 999, placeholder: 0 }[uncertain];
    if (uncertain !== 'missing') h.rawUsage(promptTokens === undefined ? undefined : { usage: { prompt_tokens: promptTokens } });
    h.end(uncertain === 'error' ? { ...assistant, stopReason: 'error' } : undefined);
    const { report } = await h.show();
    assert.equal(report.reconciliation, null, uncertain);
    if (uncertain === 'delta' || uncertain === 'extra payload') {
      assert.equal(report.snapshot.observation.format, 'pi-transcript', uncertain);
    }
  }
  const h = harness();
  h.start();
  // An earlier hook truncated what Pi will send. A later hook is invisible to us.
  h.request({ ...payload, messages: payload.messages.slice(2), tools: [] });
  h.response(); h.rawUsage(); h.end();
  const { report } = await h.show();
  assert.equal(report.snapshot.groups.results.textBytes, 0);
  assert.equal(report.snapshot.servers[0].savings.declarationBytes, null);
  assert.equal(report.reconciliation.discrepancy, null);
});

test('successful lifecycle boundaries invalidate capture and incomplete turns cannot resurrect it', async () => {
  for (const [event, reason] of [['session_compact', 'compaction'], ['session_tree', 'branch changed'],
    ['model_select', 'model changed'], ['session_start', 'session changed'], ['session_shutdown', 'session changed']]) {
    const h = harness();
    h.start(); h.request(); h.response(); h.rawUsage(); h.end();
    h.emit(event);
    h.request(); h.response(); h.rawUsage(); h.end();
    const { report } = await h.show('all');
    assert.equal(report.snapshot, null, event);
    assert.equal(report.reconciliation, null, event);
    assert.equal(report.staleReason, reason, event);
    h.start(); h.request();
    assert.equal((await h.show()).report.staleReason, null);
  }
});

test('resumed history may precede the first system entry in the normalized request', async () => {
  const h = harness({ model: { ...model, api: 'fixture-stream' } });
  h.emit('session_start');
  h.emit('turn_start');
  const [system, result, user] = messages;
  const resumed = [user, assistant, result, assistant, system, user];
  h.emit('context_with_system', { messages: resumed });
  h.end();
  const { snapshot, staleReason, reconciliation } = (await h.show('all')).report;
  assert.equal(staleReason, null);
  assert.deepEqual(snapshot.observation, { format: 'pi-transcript', coverage: 'full' });
  assert.equal(snapshot.groups.results.textBytes, Buffer.byteLength(marker));
  assert.ok(snapshot.servers[0].savings.declarationBytes > 0);
  assert.equal(reconciliation, null);
  assert.doesNotMatch(JSON.stringify(snapshot), /RAW_PRIVATE_MARKER/u);
});

test('normalized fallback uses effective tool metadata, not old patches or name prefixes', async () => {
  const h = harness({ model: { ...model, api: 'anthropic-messages' } });
  h.emit('turn_start');
  h.emit('context_with_system', { messages: [...messages, { role: 'system', content: '',
    toolsRemoved: [{ name: declaration.name }], toolsAdded: [{ ...declaration, name: 'mcp__catalog__impostor' }] }] });
  // A transport can omit the provider hook entirely; the normalized observation still works.
  const { snapshot } = (await h.show()).report;
  assert.equal(snapshot.observation.format, 'pi-transcript');
  assert.equal(snapshot.servers[0].declarations.textBytes, 0);
  assert.equal(snapshot.servers[0].history.textBytes, 0);
  assert.equal(snapshot.servers[0].savings.declarationBytes, null);
  assert.ok(snapshot.servers[0].savings.announcementBytes > 0);
});
