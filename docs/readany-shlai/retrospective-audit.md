# Retrospective Bunny audit

Review a bounded area of **current main**, using merged PRs to select the area.
Do not redispatch ordinary Bunny PR reviews against old heads: historical defects
may already be fixed, and old merge signals must retain their original meaning.

## Initial audit portfolio

| Order | Scope | Historical PRs | Reason |
| --- | --- | --- | --- |
| 1 | `update-release` | #2, #3 | Release/version generation, package identity, publication workflow, and focused tests. |
| 2 | `update-discovery` | #2 | Update selection, channel configuration, scheduling, callers, and focused tests. |
| 3 | `update-install` | #2 | Download, verification, installation, dialog/store lifecycle, and focused tests. |
| 4 | `annotations` | #7, #12 | Book isolation, annotation retrieval, and fallback cancellation cross core/mobile boundaries. |
| 5 | `reading-state` | #28 | Session persistence and teardown can corrupt or lose reading history. |

Start with **one update-release run**, then update-discovery and update-install.
Each chunk is a separate dispatch, checkpoint, and report; the old combined
`updates` option is removed. Triage every candidate before spending on another
scope. Continue to annotations and reading-state if the update pilot produces a
reproducible defect or useful, testable coverage gaps. If it produces only stale,
speculative, or stylistic comments, improve the packet before expanding. Do not
bulk-review all merged PRs. Desktop lifecycle (#26), imports/storage from #1/#2,
and the large upstream sync (#25) are deferred; they need separate focused scopes.
Recent Bunny-reviewed changes (#31–#35) are lower priority.

The manifest `.github/bunny-review/retrospective-scopes.json` lists the exact files
and purposes. These scopes are deliberately partial. Reading-state does not cover
the full renderer, and the update chunks do not cover every unrelated change in PR #2.

## Run and observe

After the workflow is merged into main:

```sh
gh workflow run bunny-retrospective.yml --repo cha1latte/ReadAny --ref main -f scope=update-release
gh run list --repo cha1latte/ReadAny --workflow bunny-retrospective.yml --limit 1
```

Record the run ID and its start time. The workflow pins the checkout to the
dispatch SHA, permits only main, and uses a read-only token with checkout
credentials removed. It installs only Bunny's dependencies and reads application
source; it does not run application scripts, build APKs, post comments or issues,
change commit statuses, or release anything. The standard PR reviewer is unchanged.

One scope runs at a time, without cancelling an active audit. A packet is capped
at 65,000 characters for each update chunk (120,000 for the other scopes) and
rejected rather than silently truncated when oversized.
It contains current source as a synthetic all-added patch for Bunny's existing
line-based review contract, bounded repository guidance, and recent scoped commit
history. Historical PR numbers are orientation, not evidence that a bug survives.
Bunny can request at most two adjacent current files and one literal search,
with 10,000 characters per file and 20,000 extra characters total. These reduced
limits apply only to retrospective audits. Guidance is capped at 6,000 characters
per document. Guidance/context truncation remains visible and limits coverage.
Each of the three model passes receives only its selected chunk, not the combined
update source. The judge additionally receives the two earlier pass results.

Bunny reuses its broad, skeptical, and judge passes. The audit permits at most
eight model requests with SDK retries disabled. Each request explicitly disables
the SDK timeout; the job's 45-minute limit is the overall time bound. A stalled
request can consume that entire limit. This bounds calls/time, not a currency amount. Logs mark request
starts/ends and token telemetry. There is no trustworthy percentage or ETA inside
a model request. A failed request is recorded with its exception cause types;
provider messages, URLs, and credentials are excluded from error diagnostics.

Download `bunny-retrospective-<scope>-<run-id>` from the run. It contains the pinned
manifest, source packet, progress log, raw review and candidate results in
`report.json`, and `report.md`. Artifacts last 30 days. Each run starts with an
`incomplete` checkpoint so interruption cannot be mistaken for a clean review.
Preparation failure appears in the job log and may occur before artifacts exist.
Rerun only the failed scope after investigating; keep the earlier run for evidence.

## Triage before filing or fixing

For each candidate, record:

1. Audited SHA, source path/line, concrete trigger, expected/actual behavior, and impact.
2. Whether current main still contains the behavior; check fixes merged after the audited SHA.
3. Existing issue/PR matches, so overlapping reports become one task.
4. A minimal reproduction or focused regression test; record the exact command and result.
5. Disposition: confirmed, already fixed, duplicate, not reproduced, or needs context.

Only confirmed current defects become proposed issues/fix PRs, subject to the
repository's publication approval rules. No candidate is automatically a verified
bug. `no-candidates` means the model returned none in this scope, not that the
codebase is defect-free. `incomplete` means the run, output contract, locations,
or review controls failed; never count it as coverage. Keep the candidate count,
confirmed count, request/token usage, and elapsed time with the pilot assessment.

## Streaming comparison

After a successful small diagnostic, run the discovery chunk with streaming:

```sh
gh workflow run bunny-retrospective.yml --repo cha1latte/ReadAny --ref main -f scope=update-discovery -f streaming=true
```

Streaming is opt-in and applies to every model pass in that audit. The small
diagnostic remains non-streaming. The manifest records the selected transport;
compare source files and packet sizes against the earlier run before attributing
any outcome to streaming. This is an experiment, not a guaranteed connection fix.

The adapter requests token usage, assembles text deltas, and requires a normal
`stop` finish. Empty, truncated, filtered, or interrupted streams fail the audit
instead of producing a partial review. Responses are capped at one million
characters. Missing usage is explicitly logged; do not interpret zero recorded
tokens as zero cost when the provider omitted usage. Streams are closed on success
and failure. SDK retries remain disabled and request timeouts remain disabled;
the 45-minute job limit still applies.

Logs show first event time, first text time, periodic event/character counts,
and a 15-second waiting heartbeat, without printing model text. A heartbeat proves
only that the worker is alive; incoming events/text provide response progress.
The existing three-pass review and candidate-validation rules still apply.

## Provider diagnostic

If an audit stalls, use a single small request before spending on another scope:

```sh
gh workflow run bunny-retrospective.yml --repo cha1latte/ReadAny --ref main -f diagnostic=true
```

This ignores the selected audit scope and sends only the current 12-line
`shlai-release-asset.ts` helper to the same provider/model, asking for a short
explanation. It is non-streaming, makes one request, and disables SDK retries.
It logs a waiting heartbeat every 15 seconds. The diagnostic has a 180-second
request timeout and a four-minute step limit; ordinary retrospective requests
still have no request timeout and retain the 45-minute job limit.

Download `bunny-retrospective-diagnostic-<run-id>` for `diagnostic.json` and
`progress.log`. The report distinguishes a nonempty response from failure and
records elapsed time, exception cause types, HTTP error status when supplied by
the SDK, and fixed categories such as disconnect-before-response, TLS, DNS, or
timeout. It does not save provider error messages, headers, URLs, credentials,
or generated response text. An empty reply is a failure. The source is capped
at 4,000 characters, so this cannot silently grow into another full audit.

A successful diagnostic demonstrates that the small request completed; it does
not prove that a large request will succeed. After success, a streaming comparison
on the discovery scope is the next experiment, not a confirmed transport fix.
If this small request also fails, investigate the provider/endpoint before another
large audit. This diagnostic does not provide application-code audit coverage.

## Offline verification

```sh
python -I -m unittest discover -s .github/bunny-review -p 'test_*.py'
python -I -m unittest discover -s scripts -p 'test_*.py'
python -I .github/bunny-review/retrospective.py --scope update-release --prepare-only --output /tmp/bunny-update-release-packet
```

Preparation makes no model calls or GitHub writes. Source is read from HEAD;
local guidance edits may appear in preparation output. A live run requires a clean
tracked checkout so context retrieval and the pinned source agree. All audit
tooling paths are exempt from preview APK builds.
