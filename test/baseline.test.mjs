import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const runner = fileURLToPath(new URL('../baseline/run.mjs', import.meta.url));
const run = (piPackage) => spawnSync(process.execPath, [runner], {
  env: { ...process.env, PI_BASELINE_PACKAGE: piPackage }, encoding: 'utf8', timeout: 60_000,
});

test('the baseline fails closed when the pinned Pi package is not supplied', () => {
  const result = run('');
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, 'Set PI_BASELINE_PACKAGE to the local @earendil-works/pi-coding-agent@1.6.1 package directory.\n');
});

test('pinned Pi sends different declarations with identical retained histories', {
  skip: !process.env.PI_BASELINE_PACKAGE && 'Supply the pinned Pi package to exercise integration',
}, () => {
  const result = run(process.env.PI_BASELINE_PACKAGE);
  assert.equal(result.stderr, '');
  assert.equal(result.status, 0);
  const { evidence, pi, comparator, providerTokens, schemaBytes, pairs } = JSON.parse(result.stdout);
  assert.equal(evidence, 'observed');
  assert.equal(pi, '@earendil-works/pi-coding-agent@1.6.1');
  assert.equal(comparator.evidence, 'unknown');
  assert.equal(providerTokens, null);
  assert.ok(schemaBytes.small < schemaBytes.large);
  assert.deepEqual(pairs.map(({ mode }) => mode), ['direct', 'deferred-before', 'deferred-after', 'codemode', 'override']);
  const small = 'mcp__fixture__small';
  const large = 'mcp__fixture__large';
  const expectedTools = [[large, small], [], [large], [], [small]];
  for (const [index, { mode, on, off, retainedIdentical }] of pairs.entries()) {
    assert.deepEqual(on.mcpTools, expectedTools[index], mode);
    assert.deepEqual(off.mcpTools, [], mode);
    assert.equal(retainedIdentical, true, mode);
    assert.deepEqual(on.retained, off.retained, mode);
    assert.ok(on.retained.resultBytes > 0, mode);
    assert.equal(on.retained.searchResults, mode === 'deferred-after' ? 1 : 0, mode);
    assert.deepEqual(on.sharedTools, mode === 'codemode' ? ['codemode'] : mode === 'direct' ? [] : ['tool_search'], mode);
    assert.deepEqual(off.sharedTools, mode === 'deferred-after' ? ['tool_search'] : [], mode);
    assert.equal(on.announcementBytes > 0, mode !== 'direct', mode);
    assert.equal(off.announcementBytes, 0, mode);
  }
  assert.ok(pairs[0].on.declarationBytes > pairs[0].off.declarationBytes);
});
