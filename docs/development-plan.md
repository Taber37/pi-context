# Historical development plan: measure what disabling a server changes

This is the original design and validation plan, not a description of the current UI or a release checklist. For current commands, installation and tested versions, see the [README](../README.md) and [installation guide](local-install.md).

The goal was a read-only, local Pi extension that distinguishes a large retained tool result from an expensive tool declaration. The command should not toggle MCPs, compact history, call a model, or upload telemetry.

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

The original UI proposal ranked servers by avoidable input. The current dashboard instead keeps **Current footprint by MCP** separate from **If disabled · next full request** in `/gentle:context all`. The detail view also includes origins, measurement coverage and comparable provider input when available. `/gentle:context` is the compact overview. Both distinguish unknown values from zero.

**Exit evidence:** command-level checks for no snapshot, one complete request, truncation, continuation, later hook rewrite and post-compaction uncertainty. Verify the command neither calls the provider nor emits synthetic secret markers from fixtures into reports or persistent storage.

## 4. Verify local packaging before sharing the source

The packaging plan called for an explicit extension entry, a tarball limited to runtime files and user documentation, and clean-profile checks of install, report commands and removal. The [installation guide](local-install.md) records the checks that ran, including their Pi and Gentle Shell version boundaries.

Registry and gallery distribution were considered separately and are not part of the GitHub source delivery. The manifest remains private and unlicensed under the local build identifier `local-context-development`; the npm name `pi-context` belongs to a different project.
