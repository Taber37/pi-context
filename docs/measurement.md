# Measurement core (adapter API)

Import `measureRequest(options)` and `reconcileUsage(snapshot, evidence)` from `src/measurement/index.mjs`. Both are synchronous and have no Pi or Node imports. The core returns counters and caller-supplied model/server labels only; it does not keep a request, response, raw text, arguments, schema, image, call identifier, or payload reference. Pass only safe display labels as `model` and server `id` values.

## Choose the observation explicitly

- `format: 'pi-transcript', request: { messages }` accepts Pi 1.6.1's normalized provider context (the `context_with_system` transcript after Pi message conversion, or the normalized context seen by the baseline mock). `system` messages carry `content`, named `sections`, `toolsRemoved: [{ name }]`, and `toolsAdded: [{ name, description, parameters, … }]`. Removals precede additions; additions replace by name; `null` clears a section. The current declaration/announcement and any older versions each occupy exactly one bucket. Older versions and tool removals go in `other`, not current declarations. Do not pass an SDK shorthand `Context` with top-level `systemPrompt` or `tools`: normalize it first. Do not mix in the session log.
- `format: 'fragments', request: [...]` accepts adapter-classified fragments of the actual object observed at `before_provider_request`. The hook can expose provider-specific formats, and later hooks may rewrite them. The adapter owns the decoding and should supply **one entry per disjoint fragment**, never both a parent blob and its children. Do not submit arbitrary hook payloads as Pi transcripts just because they have a `messages` array.
- Set `coverage: 'full'` only for a complete observation, `'delta'` for a continuation, or omit it if unknown. Unsupported/missing observations are unknown, not empty requests. Use separate snapshots for normalized transcript and provider observation if both are available; never add their counts together.

A fragment is `{ kind, value?, bytes?, group?, part?, phase?, owner? }`:

| Field | Meaning |
| --- | --- |
| `kind: 'text'` | UTF-8 bytes of string `value` |
| `kind: 'json'` | UTF-8 bytes of compact JSON `value`, e.g. a parsed tool schema; send already serialized arguments as `text` instead |
| `kind: 'media'` | Count one media item; optional `bytes` is its known decoded size, not base64 length |
| `kind: 'unknown'` | One opaque block; do not provide its contents |
| `group` | `system`, `declarations`, `conversation`, `results`, or `other` (default). Use `other` for summaries/media/framing and `results` for tool output and injections. |
| `part` / `phase` | For a `declaration` or `announcement`, mark `phase: 'effective'` or `'historical'`. This overrides `group` (`declarations` or `other` respectively). Mark earlier calls/results as `'historical'` for the server's history row. |
| `owner` | `{ server: 'id' }` for exclusive server ownership, `'shared'`, `'native'`, or `'unknown'` (default). Assign shared infrastructure only to `'shared'`, not to every server that uses it. |

For transcripts, `owners` maps positional addresses to the same owner values: `0/toolsAdded/1`, `3/content/0`, `4/sections/mcp_servers/2`, etc. Indices are zero-based, and scalar message content uses `/content/0`. Annotate old calls/results using evidence from their own point in time, not today's tool registry. The same name can belong to two servers at different positions. Neither names nor `mcp__` prefixes establish ownership. `groupOverrides` maps content positions to `other` or `results` when upstream metadata identifies a summary or injection that Pi converted to user text.

Transcript content includes observed `user`, `assistant`, and `toolResult` blocks. Tool calls count compact JSON of ID, name, arguments, and optional namespace, once. Visible thinking in this normalized context is not proof a provider resends it. Opaque signatures and unknown blocks have unknown tokens. Images have known decoded size only for standard base64. The structured `mcp_servers` section is split into lines; wrappers, line separators and the known Pi intro are shared. Attribute individual lines explicitly. Unrecognized lines remain unowned; arbitrary system prose is not parsed for advertisements. Counts exclude implicit SDK/provider framing, local timestamps and historical usage, and do not count JSON array punctuation for declarations. They will not reproduce fixture array-byte deltas exactly.

## Output and evidence

- `projected` copies the numeric `{tokens, contextWindow, percent}` from `ctx.getContextUsage()` when supplied; no provider usage is substituted. Unknown values are `null`.
- `observed` and `groups` record `textBytes`, `mediaCount`, `knownMediaBytes`, `unknownMediaSizes`, `unknownBlocks` and `estimatedTokens`. `origins` and `servers` are alternate views, not extra bytes. The estimate is `ceil(UTF-8 bytes / 4)` over the row, not a model tokenizer. The `estimation.model` label does not calibrate the heuristic; rounding means estimates need not add across rows. Rows containing media or opaque blocks have `null` estimates; `textBytes` is still the known subtotal.
- `servers: [{id, exposure?, removable?}]` supplies inventory, including servers with no observed fragments. Exposure is `direct`, `deferred`, `codemode`, `mixed`, or unknown (`null`). Output `declarations` and `announcements` mean *observed effective fragments attributed to this server*; `history` is counted separately. Each server's `observed` row counts all fragments assigned to it, including those outside these subsets. Empty attribution is not proof of absence.
- `removable: {declarations?: true, announcements?: true}` is an adapter attestation **per component**: the complete exclusive, effective set that would be removed on the next full request is known, is exactly the attributed set, and has no unaccounted server-owned contribution. Leave the flag unset for missing inventory, ambiguous ownership, or unpredictable effective rewrites. Exposure alone is not evidence. A full observation and an attestation allow a conditional byte estimate or a known `0`. Missing evidence gives `null`, not zero. Shared infrastructure, reflow/separators, and retained history are excluded even if disabling the last server might incidentally remove some of them. The reported values are not an exact counterfactual, additive across servers, or billing estimates.
- After the response, `reconcileUsage(snapshot, { usage: assistant.usage, match: { sameCall, unchanged } })` returns `{inputTokens, discrepancy}`. The adapter must establish `sameCall: true` for one response with actual normalized usage, not cumulative, missing, synthetic zero placeholders, or an ambiguous retry. All of `input + cacheRead + cacheWrite` are required (zero is valid; `cacheWrite1h` is already included). Only for a full `fragments` observation with known estimate and `unchanged: true` (no late rewrite, same logical input scope as usage) is `discrepancy = inputTokens - estimatedTokens` computed. Transcript snapshots and continuations cannot give a discrepancy. Rows are never scaled to fit.

## Worked example: two servers share discovery

```js
const snapshot = measureRequest({
  format: 'pi-transcript', coverage: 'full', model: 'fixture-chat',
  request: { messages: [
    { role: 'system', content: '', toolsAdded: [
      { name: 'tool_search', description: 'Search the catalog', parameters: {} },
    ], sections: { mcp_servers: '<mcp_servers>\n- alpha: café\n- beta: 🧪\n</mcp_servers>' } },
    { role: 'toolResult', toolCallId: 'old', toolName: 'lookup', content: 'café' },
  ] },
  owners: {
    '0/toolsAdded/0': 'shared',
    '0/sections/mcp_servers/1': { server: 'alpha' },
    '0/sections/mcp_servers/2': { server: 'beta' },
    '1/content/0': { server: 'alpha' },
  },
  servers: ['alpha', 'beta'].map(id => ({ id, exposure: 'deferred',
    removable: { declarations: true, announcements: true } })),
});
```

With the stated evidence, disabling `alpha` conditionally saves 0 declaration bytes and 14 announcement bytes (~4 heuristic tokens); its 5-byte old result remains. `beta` has 12 announcement bytes (~3 heuristic tokens). Neither gets credit for `tool_search` or the wrapper. If `alpha` could also have a loaded declaration the adapter cannot account for, omit its `declarations` attestation: the 14 known announcement bytes still appear, but combined savings are unknown. This follows the separation in [the pinned A/B baseline](baseline.md), not a prediction of any provider's wire encoding.
