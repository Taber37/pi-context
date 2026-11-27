const groupsList = ['system', 'declarations', 'conversation', 'results', 'other'];
const originList = ['native', 'shared', 'unknown'];
const encoder = new TextEncoder();
const count = (value) => Number.isSafeInteger(value) && value >= 0 ? value : null;
const label = (value) => typeof value === 'string' && value.length > 0 && value.length <= 256 ? value : null;
const own = (record, key) => Object.hasOwn(record ?? {}, key) ? record[key] : undefined;
const totals = () => ({ textBytes: 0, mediaCount: 0, knownMediaBytes: 0, unknownMediaSizes: 0, unknownBlocks: 0 });
const rows = (keys) => Object.fromEntries(keys.map((key) => [key, totals()]));
const estimate = (bytes) => Math.ceil(bytes / 4);
const knownText = (row) => row.unknownBlocks === 0 && row.mediaCount === 0;
const finish = (row) => ({ ...row, estimatedTokens: knownText(row) ? estimate(row.textBytes) : null });
const finishRows = (record) => Object.fromEntries(Object.entries(record).map(([key, row]) => [key, finish(row)]));

function decodedSize(data) {
  if (typeof data !== 'string' || data.length % 4 !== 0) return null;
  const pad = data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0;
  if (/[^A-Za-z0-9+/]/u.test(pad ? data.slice(0, -pad) : data)) return null;
  return data.length / 4 * 3 - pad;
}

function fragmentTotals({ kind, value, bytes }) {
  const row = totals();
  if (kind === 'media') {
    row.mediaCount = 1;
    row.knownMediaBytes = count(bytes) ?? 0;
    row.unknownMediaSizes = count(bytes) === null ? 1 : 0;
  } else {
    let text;
    if (kind === 'text') text = value;
    if (kind === 'json') {
      try { text = JSON.stringify(value); } catch { /* Unserializable block. */ }
    }
    if (typeof text === 'string') row.textBytes = encoder.encode(text).length;
    else row.unknownBlocks = 1;
  }
  return row;
}

function visitTranscript(messages, owners, groupOverrides, add) {
  // Pi 1.6.1 applies removals before additions and replaces sections by name.
  // Use source positions so a redefinition can belong to a different server.
  const tools = new Map(), sections = new Map();
  messages.forEach((message, i) => {
    if (message?.role !== 'system') return;
    for (const tool of message.toolsRemoved ?? []) tools.delete(tool?.name);
    message.toolsAdded?.forEach((tool, j) => {
      if (typeof tool?.name === 'string') tools.set(tool.name, `${i}/toolsAdded/${j}`);
    });
    for (const [name, value] of Object.entries(message.sections ?? {})) {
      if (value === null) sections.delete(name);
      else sections.set(name, i);
    }
  });
  messages.forEach((message, i) => {
    const emit = (path, fragment) => add({ ...fragment, owner: own(owners, path) ?? fragment.owner });
    const role = message?.role;
    const system = role === 'system';
    const defaultGroup = system ? 'system' : role === 'toolResult' ? 'results' : 'conversation';
    const content = (path, block) => {
      const override = own(groupOverrides, path);
      const group = !system && (override === 'results' || override === 'other') ? override : defaultGroup;
      const phase = system ? undefined : 'historical';
      if (typeof block === 'string') emit(path, { group, phase, kind: 'text', value: block });
      else if (block?.type === 'text') {
        emit(path, { group, phase, kind: 'text', value: block.text });
        if (block.textSignature) add({ group: 'other', kind: 'unknown' });
      } else if (block?.type === 'image') {
        emit(path, { group: 'other', phase, kind: 'media', bytes: decodedSize(block.data) });
      } else if (role === 'assistant' && block?.type === 'thinking') {
        if (!block.redacted) emit(path, { group, phase, kind: 'text', value: block.thinking });
        if (block.redacted || block.thinkingSignature) add({ group: 'other', kind: 'unknown' });
      } else if (role === 'assistant' && block?.type === 'toolCall') {
        const { id, name, arguments: args, namespace, thoughtSignature, argumentsError } = block;
        emit(path, { group, phase, kind: 'json', value: { id, name, arguments: args, namespace } });
        if (thoughtSignature || argumentsError) add({ group: 'other', kind: 'unknown' });
      } else emit(path, { group: 'other', phase, kind: 'unknown' });
    };
    if (!['system', 'user', 'assistant', 'toolResult'].includes(role)) {
      add({ group: 'other', kind: 'unknown' });
      return;
    }
    (Array.isArray(message.content) ? message.content : [message.content])
      .forEach((block, j) => content(`${i}/content/${j}`, block));
    if (!system) return;
    message.toolsAdded?.forEach((tool, j) => {
      const path = `${i}/toolsAdded/${j}`;
      emit(path, { part: 'declaration', kind: typeof tool?.name === 'string' ? 'json' : 'unknown', value: tool,
        phase: tools.get(tool?.name) === path ? 'effective' : 'historical' });
    });
    message.toolsRemoved?.forEach((value, j) => emit(`${i}/toolsRemoved/${j}`,
      { group: 'other', phase: 'historical', kind: 'json', value }));
    for (const [name, value] of Object.entries(message.sections ?? {})) {
      if (value === null) continue;
      const phase = sections.get(name) === i ? 'effective' : 'historical';
      const path = `${i}/sections/${name}`;
      if (name === 'mcp_servers' && typeof value === 'string') {
        value.split('\n').forEach((line, j) => {
          // A line's removable bytes exclude separators and the shared wrapper.
          if (j) add({ part: 'announcement', phase, kind: 'text', value: '\n', owner: 'shared' });
          const shared = /^\s*<\/?mcp_servers>\s*$/u.test(line) || line.startsWith('MCP servers whose tools are not declared to you.');
          const fragment = { part: 'announcement', phase, kind: 'text', value: line };
          if (shared) add({ ...fragment, owner: 'shared' });
          else emit(`${path}/${j}`, fragment);
        });
      } else emit(path, { group: phase === 'effective' ? 'system' : 'other', phase, kind: 'text', value });
    }
  });
}

/** Reduce a normalized transcript or adapter-classified provider request to aggregates. */
export function measureRequest({ request, format, coverage, model, projected, owners, groupOverrides, servers = [] } = {}) {
  const valid = (format === 'pi-transcript' && Array.isArray(request?.messages) &&
    !Object.hasOwn(request, 'systemPrompt') && !Object.hasOwn(request, 'tools')) ||
    (format === 'fragments' && Array.isArray(request));
  const observation = { format: valid ? format : null,
    coverage: valid && ['full', 'delta'].includes(coverage) ? coverage : 'unknown' };
  const observed = totals(), groups = rows(groupsList), origins = rows(originList);
  const inventory = new Map();
  function server(id) {
    if (!inventory.has(id)) inventory.set(id, { id, exposure: null, removable: null,
      observed: totals(), declarations: totals(), announcements: totals(), history: totals() });
    return inventory.get(id);
  }
  for (const entry of servers) {
    const id = label(entry?.id);
    if (!id) continue;
    const row = server(id);
    row.exposure = ['direct', 'deferred', 'codemode', 'mixed'].includes(entry.exposure) ? entry.exposure : null;
    row.removable = entry.removable;
  }

  function add({ group, part, phase, owner, ...fragment } = {}) {
    const availability = part === 'declaration' ? 'declarations' : part === 'announcement' ? 'announcements' : null;
    const bucket = availability ? (phase === 'effective' ? 'declarations' : 'other') :
      groupsList.includes(group) ? group : 'other';
    const row = fragmentTotals(fragment);
    const id = label(owner?.server);
    const attributed = id ? server(id) : null;
    const origin = attributed?.observed ?? origins[originList.includes(owner) ? owner : 'unknown'];
    const scope = phase === 'historical' ? attributed?.history :
      availability && phase === 'effective' ? attributed?.[availability] : null;
    for (const summary of [observed, groups[bucket], origin, scope]) {
      if (!summary) continue;
      for (const key of Object.keys(row)) summary[key] += row[key];
    }
  }
  if (!valid) add();
  else if (format === 'pi-transcript') visitTranscript(request.messages, owners, groupOverrides, add);
  else for (const fragment of request) add(fragment ?? undefined);

  const serverRows = Array.from(inventory.values(), (row) => {
    const { id, exposure, declarations, announcements, history, removable } = row;
    const removableBytes = (key, row) => observation.coverage === 'full' && own(removable, key) === true && knownText(row)
      ? row.textBytes : null;
    const declarationBytes = removableBytes('declarations', declarations);
    const announcementBytes = removableBytes('announcements', announcements);
    const known = declarationBytes !== null && announcementBytes !== null;
    return { id, exposure, observed: finish(row.observed), declarations: finish(declarations),
      announcements: finish(announcements), history: finish(history),
      savings: { status: known ? 'conditional-next-full-request' : 'unknown', declarationBytes, announcementBytes,
        estimatedTokens: known ? estimate(declarationBytes + announcementBytes) : null } };
  });
  return { observation, estimation: { method: 'ceil(UTF-8 bytes / 4); not model-tokenized', model: label(model) },
    projected: { tokens: count(projected?.tokens), contextWindow: count(projected?.contextWindow),
      percent: Number.isFinite(projected?.percent) && projected.percent >= 0 ? projected.percent : null },
    observed: finish(observed), groups: finishRows(groups), origins: finishRows(origins), servers: serverRows };
}

/** Associate only normalized input usage from a matched response; never rescale the observation. */
export function reconcileUsage(snapshot, { usage, match } = {}) {
  const components = [usage?.input, usage?.cacheRead, usage?.cacheWrite].map(count);
  const inputTokens = match?.sameCall === true && components.every((value) => value !== null)
    ? count(components.reduce((sum, value) => sum + value, 0)) : null;
  const comparable = inputTokens !== null && match.unchanged === true && snapshot?.observation?.format === 'fragments' &&
    snapshot.observation.coverage === 'full' && count(snapshot.observed?.estimatedTokens) !== null;
  return { inputTokens, discrepancy: comparable ? inputTokens - snapshot.observed.estimatedTokens : null };
}
