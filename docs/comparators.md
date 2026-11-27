# Context comparators: pinned evidence

The matrix separates the shipped README from inspection of the published source and from runtime evidence. Versions refer to npm artifacts, not moving GitHub branches. The GitHub refs below resolve to manifests with the same versions; the experiment loads the npm artifact, not a Git checkout.

| Package and source | README claims | Published source inspection | Runtime evidence |
| --- | --- | --- | --- |
| [`pi-context-tax@0.2.3`](https://registry.npmjs.org/pi-context-tax/-/pi-context-tax-0.2.3.tgz) · [GitHub `4c5b7f8`](https://github.com/Roshvan/pi-context-tax/tree/4c5b7f81dcefd4c14cf9cfb5e68e9dbbabbe7ff6) | `/ctx` estimates current startup/context costs, groups tool definitions, and separates cumulative session/MCP activity. Hidden and inactive deferred definitions are excluded; codemode entries count within the shared description. | `extensions/context-tax.ts` captures `context_with_system` and reads the session branch. `src/startup.ts` groups by MCP namespace; `src/report.ts` prints startup and conversation. The command grammar has no server-disable estimate. | Exercised below. Closest to S2 because it reports MCP definitions separately from conversation and uses captured declarations. |
| [`pi-context-view@0.8.4`](https://registry.npmjs.org/pi-context-view/-/pi-context-view-0.8.4.tgz) · [GitHub `2592a04` (`v0.8.4`)](https://github.com/dimk90/pi-context-view/tree/2592a0491a5cc3d5db855422fc6b6a3795df0ee3) | `/context usage` maps occupancy and `/context injections` inspects the latest system prompt, definitions and contributions; an optional initial probe is intended not to reach a provider. | `src/capture/register.ts` pairs transcript snapshots with a provider hook when a UI is present. `src/probe/silent-probe.ts` aborts its own probe and records identities for omission. `src/command.ts` exposes usage, injections and config, not a per-server counterfactual. | Not run. This version requires Pi ≥1.3.0 and a compatible UI (source inspection, not a compatibility test). |
| [`pi-context-usage@2.1.1`](https://registry.npmjs.org/pi-context-usage/-/pi-context-usage-2.1.1.tgz) · [GitHub `49475ad`](https://github.com/championswimmer/pi-context-usage/tree/49475ad526a8ab2ac8ff062ea7b59c9532e84813) | `/context` renders a dot grid; `/context details` expands prompt, active tool estimates and conversation. | `src/context/index.ts` uses `getContextUsage`; `src/context/breakdown.ts` estimates tool definitions using the active registry and conversation from session entries. No on/off request comparison in the command. | Not run. |

## Reproduce the `/ctx` experiment

Use Node 26.12.1 (observed) and a local `@earendil-works/pi-coding-agent@1.6.1` distribution with its existing dependencies. Set `PI_PACKAGE_DIR` to the absolute path of that package directory (containing `package.json` and `dist/index.js`). From the repository root:

```bash
node --test test/comparator.test.mjs
set -o pipefail
curl -q --proto '=https' -fsS https://registry.npmjs.org/pi-context-tax/-/pi-context-tax-0.2.3.tgz \
  | node experiments/comparator/run.mjs "$PI_PACKAGE_DIR"
```

Both commands exited 0 (three helper tests; five on/off pairs and one discovery seed run). The extension entrypoint, helper sources and manifest were inspected before loading. The runner checks the archive SHA-512 against npm's pinned integrity (`Cf4IR2O1k1TrID1i1ZVwJwznLFCdp8XNttHGo23qlPkjO23dF3xSYE9ZBgR4aGtw1eppdkw+GpfL+/6nbsby2A==`), extracts only that verified artifact in disposable scratch, and starts Pi with a clean environment, scratch profile and in-memory sessions. There is no npm installation/lifecycle execution. The provider is in-process and MCP is local stdio; the only external download is the npm artifact. Profile isolation is not an OS sandbox. The runner removes its scratch directory on exit.

Each pair replays the same synthetic conversation from `baseline/fixture.mjs` and local `baseline/mcp-server.mjs`. For deferred-after, both arms reuse the same seed containing a successful prior `tool_search`. After recording the normalized mock request, Pi dispatches the bare `/ctx` command in SDK print mode. The runner verifies that the command adds neither a provider call nor a session entry and emits the literal report for each arm.

## Runtime comparison (observed)

All numbers are **on → off**. Declaration bytes are the UTF-8 size of the complete effective tool array as JSON (`[]` is 2 bytes). Announcements count only the body of `<mcp_servers>`, not its wrapper or other system text. Direct names omit the `mcp__fixture__` prefix. Report estimates are comparator output, not measured provider tokens.

| Fixture mode | Direct declarations | Shared declarations | Declaration bytes | Announcement bytes | `/ctx` startup tax | `/ctx` conversation |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| Direct | `large`, `small` → none | none → none | 2,499 → 2 | 0 → 0 | ~1.1k → ~511 | ~110 → ~110 |
| Deferred, before discovery | none → none | `tool_search` → none | 617 → 2 | 178 → 0 | ~672 → ~511 | ~110 → ~110 |
| Deferred, after discovery | `large` → none | `tool_search` → `tool_search` | 2,951 → 617 | 178 → 0 | ~1.2k → ~672 | ~165 → ~165 |
| Codemode | none → none | `codemode` → none | 1,957 → 2 | 175 → 0 | ~964 → ~511 | ~110 → ~110 |
| Deferred, `small` overridden to direct | `small` → none | `tool_search` → none | 781 → 2 | 178 → 0 | ~703 → ~511 | ~110 → ~110 |

The old 311-byte tool result is identical in every on/off pair; the runner also checks deep equality of the retained transcript (four messages, or eight after discovery). In direct mode the `fixture tools: ~605` row disappears while `Conversation: ~110` stays. Before discovery and in codemode there are no direct MCP declarations, yet disabling the server changes both declarations and announcements. After discovery the shared search declaration stays even with the server off. In that same pair `/ctx` printed `Extension additions: ~529` in both arms even though the recorded announcement body disappeared. These are different effects from removing historical results.

**S2 verdict:** the comparator already exposes useful startup and conversation estimates and a per-server row for direct declarations. The observed `/ctx` report is a snapshot, not a per-server next-request disable estimate: the indirect modes expose generic tool/addition totals, not what each server would save; the report supplies no explicit unknown-versus-zero marginal value. The manual A/B experiment demonstrates the difference; `/ctx` does not compute it. Keep the S2 scope. The byte changes here are fixture-specific, not additive savings for a multi-server setup or provider billing.

**S3 verdict (comparator slice):** repository-local work, temporary profile, synthetic history and mock provider only; nothing published or installed and no global profile changed. No claim about TUI interaction, actual providers, wire payloads, or runtime behavior of the two source-only comparators.
