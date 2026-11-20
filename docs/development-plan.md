# Development plan: measure what disabling a server changes

Deliver a read-only, local Pi extension. Success means a user can distinguish a large tool result from an expensive tool declaration and choose the right action. Do not toggle MCPs, compact history, call a model, or upload telemetry from the command.

## 1. Establish the baseline before building

Use a disposable Pi profile, a deterministic fake MCP server with two differently sized tool schemas, synthetic results and a recording mock provider. Pin the Pi and comparison-package versions. Never use a real session as a fixture.

Review the published behavior of [pi-context-tax](https://github.com/Roshvan/pi-context-tax), [pi-context-view](https://github.com/dimk90/pi-context-view) and [pi-context-usage](https://github.com/championswimmer/pi-context-usage). Evaluate the closest comparator, `/ctx`, on the same fixture. Borrow questions, not source, UI layouts, assets, README text or test data. Record observed behavior separately from README claims.

Replay identical history with the server enabled and disabled. Repeat for direct, deferred (before and after discovery) and codemode exposure, including a per-tool override. Compare outgoing declarations, prompt announcements and retained messages separately. If another package already answers the full question reliably, document the result and reconsider the scope before implementing.

**Exit evidence:** versioned comparison matrix and one reproducible on/off example where the declaration changes but the old tool result remains.

## 2. Build a measurement core without a UI

Keep three records distinct: Pi's projected window occupancy now, the provider-specific request object observed at our hook, and normalized input usage reported after the matching response. `before_provider_request` is an observation point, not a wire capture. Later hooks can rewrite a request; a continuation may send only a delta. Never reconcile different requests or silently substitute cumulative session usage.

Classify each transmitted fragment once, then attach origin tags for alternate views:

| Group | Include |
| --- | --- |
| System | Rendered Pi instructions, harness and extension additions, project instruction files, skill catalog |
| Declarations | Native tools, MCP advertisements and schemas actually exposed; shared codemode infrastructure separately |
| Conversation | Current input, active history, assistant content (including reasoning only if resent), tool calls and arguments |
| Results and injections | Returned stdout, file excerpts, loaded skills, MCP output after truncation, memory lookups and subagent reports |
| Other | Retained summaries, images or provider-specific blocks, framing and unclassified content |

Count UTF-8 bytes of observed text. Label token estimates with their method and model. For media without a supported model rule, show count and known size, tokens unknown. Never tokenize base64 as prose. Compare with normalized `input + cacheRead + cacheWrite` when available; cache affects cost, not logical occupancy. Show signed discrepancy instead of scaling rows to fit. Do not infer marginal savings by removing shared infrastructure or subtracting historical results. Where effective removal cannot be predicted, show unknown or a clearly labeled conditional estimate.

**Exit evidence:** fixtures assert unique attribution, Unicode byte counts, unchanged historical results, no double counting of shared tools, explicit unknowns, and a cache-inclusive comparison for the same call.

## 3. Integrate with Pi and expose the command

Keep provider adapters separate from the pure attribution logic. Correlate observation and response within the active session; if the association is ambiguous, suppress the comparison. Retain bounded numeric aggregates and origin labels in memory, never raw requests, arguments, result contents, file contents or headers. Discard stale snapshots or label them stale after branch, session or model changes and compaction. Do not add context messages to render the report.

- `/gentle:context`: show occupancy, measurement age and servers ranked by estimated avoidable input. Columns: server, exposure mode, current declarations, retained history, estimated next-call savings. Keep unknown savings distinct from zero.
- `/gentle:context all`: expand the origin groups, methodology, shared/unknown rows and last comparable provider input. Show a useful empty state before the first snapshot.

**Exit evidence:** command-level checks for no snapshot, one complete request, truncation, continuation, later hook rewrite and post-compaction uncertainty. Verify the command neither calls the provider nor emits synthetic secret markers from fixtures into reports or persistent storage.

## 4. Ship only after an install test

1. Select an npm name the maintainer controls: the unscoped name `pi-context` is already occupied. The GitHub repository name need not change. Confirm license and supported Pi versions before distribution.
2. Add an explicit Pi extension entry, `pi-package` keyword, executable package contents, repository URL and matching installation/removal instructions. Keep fixtures and local planning state out of the tarball.
3. Inspect `npm pack --dry-run`, build the actual tarball, install it in a clean profile and run both commands. Check plain Pi and Gentle Shell; ensure no command collisions on the supported versions.
4. For [Gentle Hub](https://gentlemanprogramming.com/gentle-hub/#join), keep the repository public with `gentle-shell-package` and `gentle-shell-extension`. Discovery is asynchronous, not guaranteed at repository creation. For the separate [Pi Gallery](https://docs.pi.dev/latest/packages), publish to npm only after release approval and verify the listing independently.

**First development milestone:** baseline experiment and comparison matrix, not an npm release. No implementation or compatibility is claimed by this plan.
