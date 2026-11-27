import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';

export function comparePair(on, off, resultId) {
  assert.ok(isDeepStrictEqual(on.history, off.history), 'Paired request history differs');
  const results = on.history.filter(({ role, toolCallId }) => role === 'toolResult' && toolCallId === resultId);
  assert.ok(results.length === 1 && results[0].content.length > 0 &&
    results[0].content.every(({ type, text }) => type === 'text' && typeof text === 'string'),
  `Expected one retained text tool result for ${resultId}`);
  const counts = (measure) => ({ on: measure(on), off: measure(off) });
  return {
    declarationBytes: counts(({ declarations }) => Buffer.byteLength(JSON.stringify(declarations))),
    announcementBytes: counts(({ announcements }) => announcements.reduce((bytes, text) => bytes + Buffer.byteLength(text), 0)),
    retained: {
      messageCount: on.history.length,
      resultBytes: results[0].content.reduce((bytes, { text }) => bytes + Buffer.byteLength(text), 0),
    },
    report: counts(({ report }) => report),
  };
}
