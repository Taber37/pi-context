import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { comparePair } from '../experiments/comparator/evidence.mjs';

const history = [{ role: 'toolResult', toolCallId: 'old', content: [{ type: 'text', text: 'café 🧪' }] }];
const on = {
  history, declarations: [{ name: 'mcp__fixture__small', description: 'café' }],
  announcements: ['café', '🧪'], report: 'MCP · fixture: ~12\nConversation: ~34',
};
const off = { ...on, declarations: [], announcements: [], report: 'Conversation: ~34' };

test('paired evidence separates declarations, announcements, retained UTF-8 result and literal report', () => {
  const pair = comparePair(on, off, 'old');
  assert.deepEqual(pair, {
    declarationBytes: { on: 54, off: 2 },
    announcementBytes: { on: 9, off: 0 },
    retained: { messageCount: 1, resultBytes: 10 },
    report: { on: on.report, off: off.report },
  });
});

test('a history change or missing retained result invalidates the comparison', () => {
  assert.throws(() => comparePair(on, { ...off, history: [] }, 'old'), { message: 'Paired request history differs' });
  assert.throws(() => comparePair(on, off, 'missing'), { message: 'Expected one retained text tool result for missing' });
});

test('an unpinned archive is rejected before executing or reading the supplied Pi path', () => {
  const runner = new URL('../experiments/comparator/run.mjs', import.meta.url);
  const result = spawnSync(process.execPath, [fileURLToPath(runner), '/unused'], { input: 'not an archive', encoding: 'utf8' });
  assert.ifError(result.error);
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, 'Comparator failed: archive does not match pi-context-tax@0.2.3 integrity\n');
});
