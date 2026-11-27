import assert from 'node:assert/strict';
import { test } from 'node:test';

const core = () => import('../src/measurement/index.mjs');
const bytes = (value) => Buffer.byteLength(value);
const schema = (name, description) => ({ name, description, parameters: { type: 'object' } });
const text = (value) => ({ type: 'text', text: value });
const mcp = (body) => ({ mcp_servers: body });
const alpha = { server: 'alpha' };
const beta = { server: 'beta' };
const complete = { declarations: true, announcements: true };
const server = (report, id) => report.servers.find((row) => row.id === id);

const old = schema('same', 'Old schema 🧪');
const current = schema('same', 'New schema café');
const shared = schema('tool_search', 'Shared catalog');
const unknown = schema('mcp__alpha__unverified', 'Ownership not inferred');
const oldResult = 'fixture-private café 🧪';
const announcement = '<mcp_servers>\nShared introduction\n- alpha: café\n- beta: 🧪\n</mcp_servers>';
const toolCall = { type: 'toolCall', id: 'c1', name: 'same', arguments: { query: '秘密' } };
const messages = [
  { role: 'system', content: [text('system π')], sections: mcp('old announcement'), toolsAdded: [old, shared, unknown] },
  { role: 'user', content: 'Hola 🧪' },
  { role: 'assistant', content: [toolCall], usage: { input: 9000 } },
  { role: 'toolResult', toolCallId: 'c1', toolName: 'same', content: [text(oldResult)] },
  { role: 'system', content: '', toolsRemoved: [{ name: 'same' }], toolsAdded: [current], sections: mcp(announcement) },
];
const owners = {
  '0/toolsAdded/0': alpha, '0/toolsAdded/1': 'shared', '2/content/0': alpha, '3/content/0': alpha,
  '4/toolsAdded/0': beta, '4/sections/mcp_servers/1': 'shared',
  '4/sections/mcp_servers/2': alpha, '4/sections/mcp_servers/3': beta,
};
const options = {
  format: 'pi-transcript', coverage: 'full', model: 'fixture-chat', owners,
  servers: [{ id: 'alpha', exposure: 'deferred', removable: complete },
    { id: 'beta', exposure: 'mixed', removable: complete }, { id: 'disabled', removable: complete },
    { id: 'uncertain', exposure: 'codemode', removable: { declarations: true } }],
};
const jsonBytes = (value) => bytes(JSON.stringify(value));

test('replays normalized Pi deltas while partitioning every observed fragment once', async () => {
  const { measureRequest } = await core();
  const request = { messages };
  const before = structuredClone(request);
  const r = measureRequest({ ...options, request });
  assert.equal(r.estimation.model, 'fixture-chat');
  assert.equal(r.estimation.method, 'ceil(UTF-8 bytes / 4); not model-tokenized');
  assert.equal(r.groups.system.textBytes, bytes('system π'));
  assert.equal(r.groups.conversation.textBytes, bytes('Hola 🧪') + jsonBytes({ id: 'c1', name: 'same', arguments: { query: '秘密' } }));
  assert.equal(r.groups.results.textBytes, bytes(oldResult));
  assert.equal(r.groups.other.textBytes, jsonBytes(old) + jsonBytes({ name: 'same' }) + bytes('old announcement'));
  assert.equal(r.groups.declarations.textBytes, jsonBytes(current) + jsonBytes(shared) + jsonBytes(unknown) + bytes(announcement));
  assert.equal(r.observed.textBytes, Object.values(r.groups).reduce((n, group) => n + group.textBytes, 0));
  assert.equal(r.observed.estimatedTokens, Math.ceil(r.observed.textBytes / 4));
  assert.equal(r.origins.shared.textBytes, jsonBytes(shared) + bytes(announcement) - bytes('- alpha: café') - bytes('- beta: 🧪'));
  assert.equal(r.origins.unknown.textBytes >= jsonBytes(unknown), true);
  assert.equal(r.observed.textBytes, [...Object.values(r.origins), ...r.servers.map((row) => row.observed)]
    .reduce((n, row) => n + row.textBytes, 0));
  assert.equal(server(r, 'alpha').history.textBytes, jsonBytes(old) + r.groups.conversation.textBytes - bytes('Hola 🧪') + bytes(oldResult));
  assert.equal(server(r, 'beta').history.textBytes, 0);
  assert.deepEqual(request, before);
  assert.doesNotMatch(JSON.stringify(r), /fixture-private|秘密|New schema|unverified|Shared introduction|c1/);
});

test('conditional savings never include shared infrastructure or history; zero requires evidence', async () => {
  const { measureRequest } = await core();
  const r = measureRequest({ ...options, request: { messages } });
  assert.deepEqual(server(r, 'alpha').savings, {
    status: 'conditional-next-full-request', declarationBytes: 0, announcementBytes: bytes('- alpha: café'),
    estimatedTokens: Math.ceil(bytes('- alpha: café') / 4),
  });
  assert.deepEqual(server(r, 'beta').savings, {
    status: 'conditional-next-full-request', declarationBytes: jsonBytes(current), announcementBytes: bytes('- beta: 🧪'),
    estimatedTokens: Math.ceil((jsonBytes(current) + bytes('- beta: 🧪')) / 4),
  });
  assert.equal(server(r, 'disabled').savings.estimatedTokens, 0);
  assert.deepEqual(server(r, 'uncertain').savings, {
    status: 'unknown', declarationBytes: 0, announcementBytes: null, estimatedTokens: null,
  });
  const off = measureRequest({ ...options, request: { messages: [...messages,
    { role: 'system', content: '', toolsRemoved: [{ name: 'same' }], sections: mcp(null) }] } });
  assert.equal(off.groups.results.textBytes, r.groups.results.textBytes);
  assert.equal(server(off, 'alpha').history.textBytes,
    server(r, 'alpha').history.textBytes + bytes('- alpha: café')); // Cleared section remains in the transcript.
  assert.equal(server(off, 'beta').savings.estimatedTokens, 0);
  assert.equal(off.groups.declarations.textBytes, jsonBytes(shared) + jsonBytes(unknown));
  const delta = measureRequest({ ...options, coverage: 'delta', request: { messages } });
  assert.equal(server(delta, 'beta').savings.estimatedTokens, null);
});

test('counts media separately, and leaves opaque blocks and missing payload unknown', async () => {
  const { measureRequest } = await core();
  const r = measureRequest({ format: 'pi-transcript', request: { messages: [
    { role: 'user', content: [text('ñ'), { type: 'image', data: 'AQI=', mimeType: 'image/png' },
      { type: 'image', data: 'https://example.invalid/img' }] },
    { role: 'assistant', content: [{ type: 'thinking', thinking: 'π' },
      { type: 'thinking', redacted: true, thinking: '', thinkingSignature: 'ciphertext' },
      { type: 'foreign', data: 'unrecognized block' }] },
  ] } });
  assert.equal(r.groups.conversation.textBytes, 4);
  assert.equal(r.groups.other.mediaCount, 2);
  assert.equal(r.groups.other.knownMediaBytes, 2);
  assert.equal(r.groups.other.unknownMediaSizes, 1);
  assert.equal(r.groups.other.unknownBlocks, 2);
  assert.equal(r.observed.estimatedTokens, null);
  assert.doesNotMatch(JSON.stringify(r), /AQI=|ciphertext|unrecognized block|example.invalid/);
  assert.equal(measureRequest({ request: { messages: [] } }).observed.estimatedTokens, null);
  assert.equal(measureRequest({ format: 'pi-transcript', request: { messages: [], tools: [shared] } })
    .observed.estimatedTokens, null);
});

test('supports adapter evidence for normalized injections and provider fragments', async () => {
  const { measureRequest } = await core();
  const transcript = measureRequest({ format: 'pi-transcript',
    request: { messages: [{ role: 'user', content: 'retained summary' },
      { role: 'user', content: [text('a file excerpt')] }] },
    groupOverrides: { '0/content/0': 'other', '1/content/0': 'results' },
  });
  assert.equal(transcript.groups.other.textBytes, bytes('retained summary'));
  assert.equal(transcript.groups.results.textBytes, bytes('a file excerpt'));
  assert.equal(transcript.groups.conversation.textBytes, 0);
  const fragments = measureRequest({ format: 'fragments', coverage: 'full', servers: options.servers, request: [
    { part: 'declaration', phase: 'historical', kind: 'json', value: old, owner: alpha },
    { part: 'declaration', phase: 'effective', kind: 'json', value: current, owner: beta },
    { part: 'announcement', phase: 'effective', kind: 'unknown', owner: beta },
    { part: 'declaration', phase: 'effective', kind: 'json', value: shared, owner: 'shared' },
    { group: 'system', kind: 'text', value: 'local instructions', owner: 'native' },
  ] });
  assert.equal(fragments.origins.native.textBytes, bytes('local instructions'));
  assert.equal(server(fragments, 'alpha').history.textBytes, jsonBytes(old));
  assert.equal(server(fragments, 'alpha').savings.estimatedTokens, 0);
  assert.equal(server(fragments, 'beta').savings.declarationBytes, jsonBytes(current));
  assert.equal(server(fragments, 'beta').savings.announcementBytes, null);
  assert.equal(fragments.observed.estimatedTokens, null);
});

test('keeps projected occupancy, full provider observation and matched normalized usage distinct', async () => {
  const { measureRequest, reconcileUsage } = await core();
  const r = measureRequest({ format: 'fragments', coverage: 'full', model: 'fixture-chat',
    projected: { tokens: 700, contextWindow: 2000, percent: 35 },
    request: [{ group: 'conversation', kind: 'text', value: 'abcdefghijklmnop' }],
  });
  assert.deepEqual(r.projected, { tokens: 700, contextWindow: 2000, percent: 35 });
  assert.equal(r.observed.estimatedTokens, 4);
  const usage = { input: 0, cacheRead: 1, cacheWrite: 2, cacheWrite1h: 2, output: 40, totalTokens: 123 };
  const match = { sameCall: true, unchanged: true };
  assert.deepEqual(reconcileUsage(r, { usage, match }), { inputTokens: 3, discrepancy: -1 });
  assert.deepEqual(reconcileUsage(r, { usage: { ...usage, input: 10 }, match }), { inputTokens: 13, discrepancy: 9 });
  assert.deepEqual(reconcileUsage(r, { usage, match: { sameCall: true } }), { inputTokens: 3, discrepancy: null });
  assert.deepEqual(reconcileUsage(r, { usage }), { inputTokens: null, discrepancy: null });
  assert.deepEqual(reconcileUsage(r, { usage: { input: 3, cacheRead: 0 }, match }), { inputTokens: null, discrepancy: null });
  for (const observed of [{ format: 'fragments', coverage: 'delta', request: [] },
    { format: 'fragments', coverage: 'full', request: [{ group: 'other', kind: 'media', bytes: 42 }] },
    { format: 'pi-transcript', coverage: 'full', request: { messages: [] } }]) {
    assert.deepEqual(reconcileUsage(measureRequest(observed), { usage, match }), { inputTokens: 3, discrepancy: null });
  }
  assert.deepEqual(measureRequest({ projected: { tokens: null, contextWindow: 2000, percent: null } }).projected,
    { tokens: null, contextWindow: 2000, percent: null });
});
