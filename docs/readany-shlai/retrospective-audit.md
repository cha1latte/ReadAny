# Retrospective Bunny audit

Review a bounded area of **current main**, using merged PRs to select the area.
Do not redispatch ordinary Bunny PR reviews against old heads: historical defects
may already be fixed, and old merge signals must retain their original meaning.

## Initial audit portfolio

| Order | Scope | Historical PRs | Reason |
| --- | --- | --- | --- |
| 1 | `updates` | #2, #3 | Shared phone updates, release identity, version selection, and install failure affect both users. |
| 2 | `annotations` | #7, #12 | Book isolation, annotation retrieval, and fallback cancellation cross core/mobile boundaries. |
| 3 | `reading-state` | #28 | Session persistence and teardown can corrupt or lose reading history. |

Start with **one updates run**. Triage every candidate before spending on another
scope. Continue to annotations and reading-state if the pilot produces a
reproducible defect or useful, testable coverage gaps. If it produces only stale,
speculative, or stylistic comments, improve the packet before expanding. Do not
bulk-review all merged PRs. Desktop lifecycle (#26), imports/storage from #1/#2,
and the large upstream sync (#25) are deferred; they need separate focused scopes.
Recent Bunny-reviewed changes (#31–#35) are lower priority.

The manifest `.github/bunny-review/retrospective-scopes.json` lists the exact files
and purposes. These scopes are deliberately partial. Reading-state does not cover
the full renderer, and updates does not cover every unrelated change in PR #2.

## Run and observe

After the workflow is merged into main:

```sh
gh workflow run bunny-retrospective.yml --repo cha1latte/ReadAny --ref main -f scope=updates
gh run list --repo cha1latte/ReadAny --workflow bunny-retrospective.yml --limit 1
```

Record the run ID and its start time. The workflow pins the checkout to the
dispatch SHA, permits only main, and uses a read-only token with checkout
credentials removed. It installs only Bunny's dependencies and reads application
source; it does not run application scripts, build APKs, post comments or issues,
change commit statuses, or release anything. The standard PR reviewer is unchanged.

One scope runs at a time, without cancelling an active audit. A packet is capped
at 120,000 characters and rejected rather than silently truncated when oversized.
It contains current source as a synthetic all-added patch for Bunny's existing
line-based review contract, bounded repository guidance, and recent scoped commit
history. Historical PR numbers are orientation, not evidence that a bug survives.
Bunny can request bounded adjacent current code/tests using its existing context
retrieval. Guidance/context truncation remains visible and limits coverage.

Bunny reuses its broad, skeptical, and judge passes. The audit permits at most
eight model requests, 300 seconds each, with SDK retries disabled; the job has a
45-minute limit. This bounds calls/time, not a currency amount. Logs mark request
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

## Offline verification

```sh
python -I -m unittest discover -s .github/bunny-review -p 'test_*.py'
python -I -m unittest discover -s scripts -p 'test_*.py'
python -I .github/bunny-review/retrospective.py --scope updates --prepare-only --output /tmp/bunny-updates-packet
```

Preparation makes no model calls or GitHub writes. Source is read from HEAD;
local guidance edits may appear in preparation output. A live run requires a clean
tracked checkout so context retrieval and the pinned source agree. All audit
tooling paths are exempt from preview APK builds.
