import assert from 'node:assert/strict';
import { test } from 'node:test';
import { measureRequest, reconcileUsage } from '../src/measurement/index.mjs';

const render = async (report, options = {}) => {
  const { renderContext } = await import('../src/view/render.mjs');
  const width = options.width ?? 100;
  const lines = renderContext(report, { width, ...options });
  assert.ok(Array.isArray(lines) && lines.length > 0);
  for (const line of lines) {
    assert.match(line, /^[ -~]*$/u); // One column per character; no terminal escapes.
    assert.ok(line.length <= width, `Overflow at ${width}: ${line}`);
  }
  return lines.join('\n');
};

const removable = { declarations: true, announcements: true };
const tool = (server, size) => ({ kind: 'text', value: 'x'.repeat(size),
  owner: { server }, part: 'declaration', phase: 'effective' });

function sample() {
  const snapshot = measureRequest({ format: 'fragments', coverage: 'full', model: 'synthetic-chat',
    projected: { tokens: 800, contextWindow: 1000, percent: 80 },
    servers: [
      { id: 'uncertain', exposure: 'codemode', removable: { declarations: true } },
      { id: 'off', exposure: 'direct', removable },
      { id: 'lookup', exposure: 'deferred', removable },
      { id: 'catalog', exposure: 'mixed', removable },
    ],
    request: [
      { kind: 'text', group: 'system', value: 'synthetic-system', owner: 'native' },
      { kind: 'text', group: 'conversation', value: 'synthetic-conversation' },
      tool('lookup', 8), tool('catalog', 28), tool('uncertain', 48),
      { kind: 'text', part: 'announcement', phase: 'effective', value: 'beta', owner: { server: 'catalog' } },
      { kind: 'text', part: 'announcement', phase: 'effective', value: '<shared>', owner: 'shared' },
      { kind: 'text', group: 'results', phase: 'historical', value: 'fixture-private-marker', owner: { server: 'catalog' } },
    ],
  });
  return { snapshot, model: 'synthetic-chat', projected: { tokens: 250, contextWindow: 1000, percent: 25 },
    ageMs: 1250, reconciliation: reconcileUsage(snapshot, { usage: { input: 20, cacheRead: 3, cacheWrite: 2 },
      match: { sameCall: true, unchanged: true } }), staleReason: null };
}

const empty = { snapshot: null, model: null, projected: null, ageMs: null, reconciliation: null, staleReason: null };

test('overview uses the live projection for used/free and an occupied/free-only grid', async () => {
  const report = sample();
  const before = structuredClone(report);
  const output = await render(report);
  assert.match(output, /^Context: synthetic-chat$/m);
  assert.match(output, /Projected: 250 \/ 1,000 tokens \(25%\)/);
  assert.match(output, /Free: 750 tokens/);
  assert.deepEqual(output.match(/^[#.]+$/gm), ['##########..........', '....................']);
  assert.match(output, /# occupied +\. free/);
  assert.match(output, /Observation: fragments \/ full; age 1,250 ms/);
  assert.match(output, /Category estimates \(observed text; not projected occupancy\)/);
  assert.match(output, /System +~4 tokens; 16 text bytes/);
  assert.match(output, /Declarations and announcements/);
  assert.match(output, /Conversation/);
  assert.match(output, /Results and injections/);
  assert.match(output, /Other/);
  assert.doesNotMatch(output, /800|fixture-private-marker|synthetic-system|synthetic-conversation|<shared>|reserve|buffer|Matched provider input/i);
  assert.deepEqual(report, before);
});

test('server overview ranks only conditional savings and keeps retained history separate', async () => {
  const output = await render(sample());
  assert.match(output, /Conditional savings if disabled on next full request/);
  assert.match(output, /Current decl\. +Retained +Savings/);
  for (const width of [48, 100]) {
    const report = await render(sample(), { width });
    assert.match(report.replace(/\s+/g, ' '), /Retained = attributed history only; 0 does not rule out earlier results\./);
  }
  assert.match(output, /catalog +mixed +28 +22 +~8 tokens/);
  assert.match(output, /lookup +deferred +8 +0 +~2 tokens/);
  assert.match(output, /off +direct +0 +0 +~0 tokens/);
  assert.match(output, /uncertain +codemode +48 +0 +unknown/);
  assert.deepEqual(output.match(/^(catalog|lookup|off|uncertain)(?= )/gm), ['catalog', 'lookup', 'off', 'uncertain']);
});

test('detail separates shared and unknown origins, estimates and matched cache-inclusive usage', async () => {
  const report = sample();
  report.staleReason = 'compaction';
  let output = await render(report, { detail: true });
  assert.match(output, /Stale observation: compaction/);
  assert.match(output, /Method: ceil\(UTF-8 bytes \/ 4\); not model-tokenized/);
  assert.match(output, /Measurement model: synthetic-chat/);
  assert.match(output, /Observed total +~39 tokens; 156 text bytes/);
  assert.match(output, /Native +~4 tokens; 16 text bytes/);
  assert.match(output, /Shared +~2 tokens; 8 text bytes/);
  assert.match(output, /Unknown origin +~6 tokens; 22 text bytes/);
  assert.match(output, /Matched provider input: 25 tokens \(cache-inclusive\)/);
  assert.match(output, /Discrepancy \(provider minus estimate\): -14 tokens/);
  assert.match(output, /Conditional components: declarations 48 bytes; announcements unknown/);
  const snapshot = measureRequest({ format: 'fragments', coverage: 'delta', request: [
    tool('lookup', 8), { kind: 'media', bytes: 5 }, { kind: 'media' }, { kind: 'unknown' },
  ], servers: [{ id: 'lookup', exposure: 'deferred', removable }] });
  output = await render({ ...empty, snapshot, ageMs: 0, reconciliation: { inputTokens: 0, discrepancy: null } }, { detail: true });
  assert.match(output, /Observation: fragments \/ delta; age 0 ms/);
  assert.match(output, /Other +unknown tokens; 0 text bytes/);
  assert.match(output, /2 media items; 5 known media bytes; 1 unknown media size; 1 opaque block/);
  assert.match(output, /lookup +deferred +8 +0 +unknown/);
  assert.match(output, /Matched provider input: 0 tokens/);
  assert.match(output, /Discrepancy \(provider minus estimate\): unknown/);
});

test('projects before a first observation, and does not turn unknown observations into empty requests', async () => {
  let output = await render(empty, { detail: true });
  assert.match(output, /Context: unknown model/);
  assert.match(output, /Projected: unknown \/ unknown tokens \(unknown\)/);
  assert.match(output, /Free: unknown/);
  assert.match(output, /No request measured yet/);
  assert.doesNotMatch(output, /Category estimates|^#|^\./m);
  output = await render({ ...empty, projected: { tokens: 0, contextWindow: 1000, percent: 0 } });
  assert.match(output, /Projected: 0 \/ 1,000 tokens \(0%\)/);
  assert.match(output, /Free: 1,000 tokens/);
  assert.deepEqual(output.match(/^[#.]+$/gm), ['....................', '....................']);
  output = await render({ ...empty, projected: { tokens: 1001, contextWindow: 1000, percent: 100.1 },
    snapshot: measureRequest({ servers: [{ id: 'catalog', exposure: 'direct', removable }] }) });
  assert.match(output, /Projected: 1,001 \/ 1,000 tokens \(100.1%\)/);
  assert.match(output, /Free: 0 tokens; over window by 1 token/);
  assert.match(output, /Observation unavailable; age unknown/);
  assert.match(output, /catalog +direct +unknown +unknown +unknown/);
  assert.doesNotMatch(output, /Category estimates/);
});

test('narrow output degrades to stacked server rows and neutralizes hidden terminal controls', async () => {
  const injection = '\x1b]52;c;PAYLOAD\x07\r\n\t\x9b31m\u202e\u2028\u2029\u200b';
  const malicious = `${injection}Wide-模型-${'Z'.repeat(90)}`;
  const snapshot = measureRequest({ model: malicious, coverage: 'full', format: 'fragments',
    request: [], servers: [{ id: malicious, exposure: 'direct', removable }] });
  const report = { ...empty, model: malicious, snapshot, staleReason: malicious };
  for (const width of [1, 24, 48, 80, 180]) await render(report, { width, detail: true });
  const narrow = await render(sample(), { width: 48 });
  assert.match(narrow, /catalog \(mixed\)\n  Current declarations: 28 text bytes\n  Retained history: 22 text bytes\n  Savings: ~8 tokens/);
  assert.doesNotMatch(narrow, /Current decl\. +Retained/);
  assert.match(narrow, /^Decls \+ announcements: ~24 tokens; 96 text bytes$/m);
  const at = await render(sample(), { width: 76 });
  const below = await render(sample(), { width: 75 });
  assert.match(at, /Current decl\. +Retained/);
  assert.doesNotMatch(below, /Current decl\. +Retained/);
});

test('paired server on/off reports keep identical earlier results visible', async () => {
  const history = [{ kind: 'text', group: 'results', phase: 'historical', value: 'retained', owner: { server: 'lookup' } }];
  for (const enabled of [true, false]) {
    const snapshot = measureRequest({ format: 'fragments', coverage: 'full',
      servers: [{ id: 'lookup', exposure: 'direct', removable }],
      request: enabled ? [tool('lookup', 20), ...history] : history });
    const output = await render({ ...empty, snapshot });
    assert.match(output, /^Results and injections +~2 tokens; 8 text bytes$/m);
    assert.match(output, enabled ? /^lookup +direct +20 +8 +~5 tokens$/m : /^lookup +direct +0 +8 +~0 tokens$/m);
  }
});

const stripColor = (line) => line.replace(/\x1b\[[\d;]*m/gu, '');
const roles = { dim: 90, muted: 37, accent: 35, mdCode: 95, mdLink: 34, mdCodeBlock: 32, mdHeading: 33, toolDiffRemoved: 31, warning: 93 };
const theme = {
  fg(role, text) {
    assert.ok(Object.hasOwn(roles, role), `Unexpected theme role: ${role}`);
    return `\x1b[${roles[role]}m${text}\x1b[39m`;
  },
  bold(text) { return `\x1b[1m${text}\x1b[22m`; },
};
const dashboard = async (report, width = 80, detail = false) => {
  const { renderContext } = await import('../src/view/render.mjs');
  const lines = renderContext(report, { width, theme, detail }).map(stripColor);
  for (const line of lines) assert.ok([...line].length <= width, `Overflow at ${width}: ${line}`);
  return lines;
};
const grid = (lines) => lines.filter((line) => /^[■·] [■·]/u.test(line)).map((line) => line.split(/ {2,}/u)[0]);

test('themed overview puts a ten-row projection beside estimates at normal widths', async () => {
  const report = sample();
  const before = structuredClone(report);
  const lines = await dashboard(report);
  const output = lines.join('\n');
  assert.equal(lines[0], 'Context usage');
  assert.match(output, /^■(?: ■){19} {3}synthetic-chat$/mu);
  assert.match(output, /250 \/ 1k tokens \(25%\)/);
  assert.deepEqual(grid(lines).map((row) => row.replaceAll(' ', '').length), Array(10).fill(20));
  assert.equal([...grid(lines).join('')].filter((cell) => cell === '■').length, 50);
  assert.match(output, /Occupied \(unclassified\)/);
  assert.match(output, /Free +750 tokens/);
  assert.match(output, /Observed estimates · % of window/);
  assert.match(output, /System +~0\.004k +0\.4%/);
  assert.match(output, /Declarations \+ ads +~0\.024k +2\.4%/);
  assert.match(output, /Results \+ injections/);
  assert.match(output, /4 MCP servers/);
  assert.match(output, /catalog ~8 tokens.*1 unavailable/);
  assert.match(output, /\/gentle:context all/);
  assert.doesNotMatch(output, /Approx\. mix|text bytes|Retained|Method:|fixture-private-marker/);
  assert.deepEqual(report, before);
  const narrow = await dashboard(report, 44);
  assert.ok(narrow.indexOf('synthetic-chat') < narrow.findIndex((line) => line.startsWith('■')));
  assert.ok(grid(narrow).every((row) => narrow.includes(row)));
});

test('partial estimates color only their approximate share of the window', async () => {
  const report = sample();
  Object.values(report.snapshot.groups).forEach((row, i) => { row.estimatedTokens = [16020, 15828, 23904, 62961, null][i]; });
  report.projected = { tokens: 127779, contextWindow: 272000 };
  const { renderContext } = await import('../src/view/render.mjs');
  const colors = () => renderContext(report, { width: 80, theme }).slice(2, 12).map(line => line.split('   ')[0]).join('');
  const first = colors();
  assert.equal(first.split(theme.fg('mdCode', '■')).length - 1, 12);
  assert.equal(first.split(theme.fg('muted', '■')).length - 1, 7);
  assert.equal(first.split(theme.fg('dim', '·')).length - 1, 106);
  report.snapshot.groups.system.estimatedTokens = 90000;
  assert.equal(colors().split(theme.fg('muted', '■')).length - 1, 94);
});

test('dashboard keeps unknowns and exact projection boundaries distinct', async () => {
  const report = sample();
  const counts = [500, 1000, 1500, 2000, 2500];
  Object.values(report.snapshot.groups).forEach((row, i) => { row.estimatedTokens = counts[i]; });
  report.projected = { tokens: 7500, contextWindow: 10000, percent: 75 };
  const mixed = (await dashboard(report)).join('\n');
  assert.match(mixed, /Approx\. mix/);
  assert.doesNotMatch(mixed, /unclassified/);
  const { renderContext } = await import('../src/view/render.mjs');
  const colored = renderContext(report, { width: 80, theme });
  for (const role of ['mdCode', 'mdLink', 'mdCodeBlock', 'mdHeading', 'toolDiffRemoved']) {
    const mark = theme.fg(role, '■');
    assert.ok(colored.some((line) => line.split('   ')[0].includes(mark)));
    assert.ok(colored.some((line) => line.split('   ')[1]?.startsWith(mark)));
  }
  report.snapshot.observation.coverage = 'delta';
  assert.match((await dashboard(report)).join('\n'), /unclassified/);
  report.snapshot.groups.system.estimatedTokens = null;
  report.snapshot.servers = report.snapshot.servers.filter((server) => server.id === 'uncertain');
  report.projected = null;
  let lines = await dashboard(report);
  assert.equal(grid(lines).length, 0);
  assert.match(lines.join('\n'), /^Free +unknown$/m);
  assert.ok(lines.includes('1 MCP server · Savings unavailable'));
  assert.match(lines.join('\n'), /System +unknown/);
  report.snapshot.servers = sample().snapshot.servers.filter((server) => server.id === 'off');
  assert.match((await dashboard(report)).join('\n'), /off ~0 tokens/);
  for (const [tokens, expected, occupied] of [[0, /Free +1,000,000 tokens/, 0],
    [1, /Free +999,999 tokens/, 1], [999999, /Free +1 token\b/, 199],
    [1000000, /Free +0 tokens/, 200], [1000001, /Over window by 1 token\b/, 200]]) {
    lines = await dashboard({ ...empty, projected: { tokens, contextWindow: 1000000 } });
    assert.equal([...grid(lines).join('')].filter((cell) => cell === '■').length, occupied);
    assert.match(lines.join('\n'), expected);
  }
  const badLabel = `\x1b]52;c;PAYLOAD\x07-${'models/模型/new-release-'.repeat(8)}`;
  const long = sample();
  long.model = badLabel;
  long.snapshot.servers.find((server) => server.id === 'catalog').id = badLabel;
  for (const width of [1, 7, 24, 44, 77, 78, 80, 85, 120]) {
    const output = (await dashboard(long, width)).join('\n');
    assert.doesNotMatch(output, /[\x07\x1b]/u);
  }
  assert.match((await dashboard(long)).join('\n'), /…/u);
});

function referenceDetail() {
  const names = ['catalog', 'workspace', 'design-library', 'documents', 'media-search'];
  const sizes = [141, 94, 279, 146, 279];
  const servers = names.map((id) => ({ id, exposure: 'mixed', removable: id === 'workspace' ? removable : { announcements: true } }));
  const text = (group, bytes, owner) => ({ kind: 'text', group, value: 'x'.repeat(bytes), owner });
  const snapshot = measureRequest({ format: 'fragments', coverage: 'full', model: 'synthetic-chat', servers,
    request: [text('system', 64080, 'native'), text('declarations', 62273, 'shared'), text('conversation', 95616),
      text('results', 235460), text('other', 9216), tool('workspace', 12),
      { ...text('results', 16384, { server: 'workspace' }), phase: 'historical' },
      ...names.map((server, i) => ({ ...text('declarations', sizes[i], { server }), part: 'announcement', phase: 'effective' })),
      { kind: 'media', bytes: 65536 }, { kind: 'media' }, { kind: 'unknown' }],
  });
  return { ...empty, model: 'synthetic-chat', snapshot, projected: { tokens: 160981, contextWindow: 272000, percent: 59.18 },
    ageMs: 1250, reconciliation: { inputTokens: 160729, discrepancy: null } };
}

test('themed detail answers footprint and disable separately with the overview grid at wide, regular and narrow sizes', async () => {
  const report = referenceDetail();
  const before = structuredClone(report);
  for (const width of [136, 80, 44]) {
    const lines = await dashboard(report, width, true);
    const output = lines.join('\n');
    assert.equal(lines[0], 'Context usage · Details');
    assert.match(output, /Current context/);
    assert.match(output, /161k \/ 272k tokens \(59\.18%\)/);
    assert.deepEqual(grid(lines), grid(await dashboard(report, width)));
    const [, footprint, disable, evidence] = output.split(/Current footprint by MCP|If disabled · next full request|Observation detail/u);
    const flat = (text) => text.replace(/\s+/gu, ' ');
    assert.match(flat(footprint), /0 retained does not rule out earlier results/);
    assert.match(flat(disable), /Disabling does not delete past calls or results/);
    assert.match(flat(disable), /compaction/i);
    assert.doesNotMatch(output, /# occupied|\/gentle:context all|Server detail|fixture-private-marker/u);
    for (const name of report.snapshot.servers.map(({ id }) => id)) {
      assert.equal(footprint.split(name).length, 2);
      assert.equal(disable.split(name).length, 2);
      assert.ok(!evidence.includes(name));
    }
    if (width >= 80) {
      assert.match(footprint, /^workspace +mixed +~4,123 +16,490 +12 +94 +16,384$/mu);
      assert.match(footprint, /^catalog +mixed +~36 +141 +0 +141 +0$/mu);
      assert.match(disable, /^workspace +~27 +12 +94$/mu);
      assert.match(disable, /^catalog +unknown +unknown +141$/mu);
    } else {
      assert.match(footprint, /^workspace · mixed\n +Total: ~4,123 tokens · 16,490 B\n +Decl 12 · Ads 94 · Retained 16,384 B$/mu);
      assert.match(footprint, /^catalog · mixed\n +Total: ~36 tokens · 141 B\n +Decl 0 · Ads 141 · Retained 0 B$/mu);
      assert.match(disable, /^workspace · ~27 tokens saved\n +Removable B: Decl 12 · Ads 94$/mu);
      assert.match(disable, /^catalog · unknown savings\n +Removable B: Decl unknown · Ads 141$/mu);
    }
    const details = flat(evidence);
    assert.match(details, /fragments \/ full · age 1,250 ms/);
    assert.match(details, /Other.*9,216.*2 media items.*65,536 known media bytes.*1 unknown media size.*1 opaque block/);
    assert.match(details, /Origins.*alternate view/i);
    assert.match(details, /Native.*Shared.*Unknown origin/);
    assert.match(details, /Method: ceil\(UTF-8 bytes \/ 4\); not model-tokenized/);
    assert.match(details, /Measurement model: synthetic-chat/);
    assert.match(details, /Matched provider input: 160,729 tokens \(cache-inclusive\)/);
    assert.match(details, /Discrepancy \(provider minus estimate\): unknown/);
  }
  const { renderContext } = await import('../src/view/render.mjs');
  const cells = (detail) => renderContext(report, { width: 136, detail, theme }).filter((line) => /^[■·] [■·]/u.test(stripColor(line)))
    .map((line) => line.split('   ')[0]);
  assert.deepEqual(cells(true), cells(false));
  assert.deepEqual(report, before);
});

test('themed details distinguish missing, zero, and partial observations without trusting labels', async () => {
  const absent = (await dashboard(empty, 44, true)).join('\n');
  assert.match(absent, /No request measured yet/);
  assert.match(absent, /Matched provider input: unknown/);
  assert.doesNotMatch(absent, /0 MCP servers|# occupied|\/gentle:context all/);
  const report = sample();
  const output = (await dashboard(report, 80, true)).join('\n');
  assert.match(output, /off .*~0.*0.*0.*0.*0/);
  assert.match(output, /Discrepancy \(provider minus estimate\): -14 tokens/);
  assert.match((await dashboard({ ...report, reconciliation: { inputTokens: 50, discrepancy: 11 } }, 80, true)).join('\n'),
    /Discrepancy \(provider minus estimate\): \+11 tokens/);
  const injection = '\x1b]52;c;PAYLOAD\x07\r\n\t\x9b31m\u202e\u200b模型';
  const id = `${injection}${'Long-'.repeat(20)}`;
  const snapshot = measureRequest({ format: 'fragments', coverage: 'full', model: id,
    servers: [{ id, exposure: 'direct', removable }], request: [tool(id, 48),
      { kind: 'text', group: 'results', value: 'unscoped', owner: { server: id } },
      { kind: 'media', owner: { server: id } }],
  });
  const escaped = (await dashboard({ ...report, model: id, snapshot }, 44, true)).join('\n');
  assert.match(escaped, /\\u\{1b\}/u);
  assert.match(escaped, /Total: unknown tokens · 56\* B/);
  assert.match(escaped, /Decl 48 · Ads 0 · Retained 0 B/);
  assert.match(escaped, /1 unknown media size/u);
  assert.doesNotMatch(escaped, /[\x00-\x09\x0b-\x1f\x7f-\x9f\u202e\u200b模型]/u);
});

test('synthetic terminal previews at representative widths', async (t) => {
  for (const [width, detail] of [[180, false], [80, true], [48, false]]) {
    const output = await render(sample(), { width, detail });
    assert.match(output, /Context: synthetic-chat/);
    t.diagnostic(`Synthetic ${width} columns (${detail ? 'detail' : 'overview'})\n${output}`);
  }
});
