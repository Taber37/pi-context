# Synthetic MCP baseline

**Observed:** Pi SDK `@earendil-works/pi-coding-agent@1.6.1` on Node `26.12.1`. This is a local mock-provider experiment, not a measurement of billed tokens or an evaluation of `/ctx`.

## Reproduce

Use an existing local installation of the pinned Pi package with its dependencies available. Set `PI_BASELINE_PACKAGE` to the absolute directory containing that package's `package.json` (not the `pi` executable). From the repository root:

```sh
export PI_BASELINE_PACKAGE=/absolute/path/to/@earendil-works/pi-coding-agent
node baseline/run.mjs
node --test test/baseline.test.mjs
node --test
```

The runner checks the Pi package name and version, launches with an allowlisted environment and a disposable home, profile, and working directory, and removes the scratch directory on exit. It runs offline with telemetry disabled. The provider is an in-process recorder; no model service, real keys, or installed profile is used. Without `PI_BASELINE_PACKAGE`, the integration test skips and the standalone runner fails closed.

## Observed matrix

The fixture exposes two schemas: `small` (79 UTF-8 bytes of compact JSON) and `large` (2,233 bytes). Both arms get the same synthetic history and final user prompt. The deferred-after arms replay the same branch after an actual `tool_search` call loaded `large`; the branch includes the discovery result. The override is `small: direct` on a deferred server. Codemode was declared but no script was executed.

Each `on → off` cell compares the next request's **effective** state after applying Pi's system-message updates. Parentheses give the decrease (`on − off`).

| Exposure | Fixture declarations on → off | Shared declarations on → off | Declaration JSON bytes on → off (decrease) | `mcp_servers` body bytes on → off (decrease) | Retained messages on/off | Old result bytes on/off |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| Direct | `small`, `large` → none | none → none | 2,499 → 2 (2,497) | 0 → 0 (0) | 4 / 4 | 311 / 311 |
| Deferred before discovery | none → none | `tool_search` → none | 617 → 2 (615) | 178 → 0 (178) | 4 / 4 | 311 / 311 |
| Deferred after discovery | `large` → none | `tool_search` → `tool_search` | 2,951 → 617 (2,334) | 178 → 0 (178) | 8 / 8 | 311 / 311 |
| Codemode | none → none | `codemode` → none | 1,957 → 2 (1,955) | 175 → 0 (175) | 4 / 4 | 311 / 311 |
| Deferred with direct override | `small` → none | `tool_search` → none | 781 → 2 (779) | 178 → 0 (178) | 4 / 4 | 311 / 311 |

Declaration bytes count the compact JSON array of effective tools, including the two bytes for `[]`. Announcement bytes count the UTF-8 section body, excluding tags. Retained messages exclude system entries and the new user prompt; the runner compares whole retained messages within each pair, not just counts or digests. Old result bytes count only the original synthetic tool-result text. All pairs had identical retained conversation messages; the deferred-after pair also kept one discovery result in each arm.

The deferred-after off transcript still contains the older `large` addition and the older announcement, followed by a delta that removes `large` and clears the section. `tool_search` stays declared. The matrix counts neither the old system entries nor the removal delta as effective declarations. The JSON output includes these observations as `systemDeltas`; do not infer that a provider necessarily omits those older bytes.

## What remains unknown

- The mock records Pi's normalized transcript, not a real provider's wire encoding. These are effective declaration and announcement byte comparisons, not total prompt bytes, token estimates, cache effects, or a modeled savings forecast. Provider tokens are unknown, not zero.
- The shared declarations that disappear here do so in a one-server fixture. Do not attribute their full size to an individual server when other servers or settings keep them active.
- `/ctx` (`pi-context-tax`) was not run; its pin and results are pending independent comparator sourcing. This baseline reports no comparator README claims as observations and does not establish whether an existing package answers the full question.
