# Bunny Review

Bunny reviews ReadAny Shlai pull requests with the custom reviewer ported from
De-Koi. Its original Ghostface-inspired voice combines restrained phone-call
suspense, horror-film wit, and a patient search for hidden failure paths. The
reviewer critiques code, never the author. Its character is configurable.

## Changing Bunny's character

Edit [`.github/bunny-review/voice.json`](../../.github/bunny-review/voice.json).
This is the single character/persona configuration for both model prose and
themed captions. The root [AGENTS.md](../../AGENTS.md) points coding agents here.
No Python, workflow, model credential, or review-policy edits are needed for a
character swap.

| Field | Purpose |
| --- | --- |
| `character` | Required character name, or `Neutral` for plain technical prose. |
| `instructions` | Optional array of short style directions. |
| `examples` | Optional array of example review sentences in that character's voice. |
| `captions` | Optional fixed-message overrides. Omitted keys use neutral technical wording. |

For example, replace the entire file with:

```json
{
  "character": "GLaDOS",
  "instructions": ["Use dry, precise, deadpan humor about the code. Keep findings actionable."],
  "captions": {}
}
```

For a plain reviewer, use `{"character": "Neutral", "instructions": ["Use concise, plain technical prose."]}`.
Replace or remove the old examples and captions when switching characters;
changing only the name while retaining Ghostface examples can mix voices.
The checked-in Ghostface configuration lists all supported caption keys. Caption
values must be nonempty single-line strings and retain the factual meaning of
the corresponding state. Unknown fields and invalid types fail validation.

Run the reviewer tests and `pnpm exec biome check .github/bunny-review/voice.json`.
Merge the configuration into `main`; subsequent reviews use it automatically.
The PR that changes it is reviewed with the previous trusted `main` configuration.
After merging, a manual full **Bunny Review** dispatch for an existing PR can
verify the new wording. Logs identify the active character as `Bunny voice:`.

The character changes presentation only. Review checks, severity, repair
contracts, bot markers, the `Bunny Review` check name, and `/bunny-review` commands
stay independent. Persona-only changes still validate but do not build APKs.

## Activation

The three `.github/workflows/bunny-review*.yml` files and `.github/bunny-review/`
must be merged into `cha1latte/ReadAny:main` before dispatch or comment commands
work. This setup does not change branch protection or publish an application.

In repository Settings → Secrets and variables → Actions, configure:

| Kind | Name | Purpose |
| --- | --- | --- |
| Secret | `OPENAI_API_KEY` | Model credential; matches De-Koi's configured secret name. |
| Secret | `LLM_BASE_URL` | The same provider endpoint used by De-Koi, when using its custom endpoint. |
| Secret, optional | `SHLAI_BUNNY_LLM_API_KEY` | Provider-specific credential; takes precedence over `OPENAI_API_KEY`. |
| Variable, optional | `SHLAI_BUNNY_LLM_BASE_URL` | Endpoint override; takes precedence over `LLM_BASE_URL`. |
| Variable, optional | `SHLAI_BUNNY_LLM_MODEL` | Defaults to `gpt-5.5`, matching De-Koi. |
| Variable, optional | `SHLAI_BUNNY_MODEL_REQUEST_TIMEOUT_SECONDS` | Per-request timeout; defaults to `120`. |
| Variable, optional | `SHLAI_PR_SYNC_AUTOMATION` | Set to `off` to pause automatic reviews on new commits. |
| Variable, optional | `SHLAI_BUNNY_TRUSTED_AUTHORS` | Space-separated additional PR author logins; defaults to `Decidetto`, the documented friend-fork contributor. Set to `none` to disable that default. |

Credentials must match the chosen endpoint. GitHub cannot export an existing
secret value; a clone only contains references to its name. Configure credentials
directly in GitHub, never in code, PR comments, or logs. Missing credentials make
Bunny report a skipped review and a failed Bunny status, not a clean review.

## Review behavior

- Automatic review runs for non-draft PRs targeting `main` when opened, updated,
  reopened, marked ready, or retargeted. Metadata-only edits are ignored.
- Owners, members, collaborators, and allowlisted PR authors receive automatic
  review. Other fork authors need an authorized maintainer to request it.
- `/bunny-review` requests a review; `/bunny-review full` rechecks the whole diff.
  Only owners, members, or collaborators may use these commands. The author
  allowlist grants automatic review eligibility, not repository or command access.
- Manual dispatch of **Bunny Review** on `main` accepts a PR number and review
  mode. It can review drafts. Repeated automatic passes use the last reviewed
  ancestor when available; full review remains available after rebases or when
  the whole PR needs another pass.
- Bunny runs broad, skeptical, and judge model passes, validates findings against
  changed lines, updates one walkthrough comment, and deduplicates inline findings.
  Repair contracts carry unresolved issues into follow-up reviews.
- Rules cover platform boundaries, reading state, imports, persistence, sync,
  audio, AI privacy, release identity, and [code quality](code-quality.md), including
  pragmatic KISS/YAGNI/SOLID checks.
- Bunny observes `Validate` and `Preview APK` for up to 15 minutes while reviewing.
  A deliberately skipped `Preview APK` for an automation/docs-only diff counts as
  satisfied; validation still runs. Missing or running CI is reported as incomplete. Its status reflects review
  completion and blocking/high findings on non-drafts; it does not replace either
  CI check, manual workflow approval, preview testing, or Celia's merge decision.

## Trust boundary and diagnostics

PR and comment workflows only authorize and dispatch. The reviewer workflow runs
on `main`, preserves its Python code, prompt, voice, rules, and dependencies from trusted
`main`, then inspects PR source as data. It never installs PR dependencies or runs
PR build scripts. Python uses isolated mode to prevent PR-local module imports.
Actions are pinned to commit SHAs. A head change before posting rejects stale
results; inline comments are bound to the reviewed commit.

This separation follows [GitHub's guidance for privileged PR workflows](https://docs.github.com/en/actions/reference/security/securely-using-pull_request_target).

The workflows default to GitHub-hosted Ubuntu runners. Advanced runner overrides
are `SHLAI_BUNNY_RUNS_ON` and `SHLAI_BUNNY_DISPATCH_RUNS_ON` (JSON string or array);
use isolated ephemeral runners for this privileged reviewer.

The **Bunny Review** run uploads review JSON, rendered Markdown, inline findings,
and CI diagnostics for 14 days. Logs include model-call and packet telemetry.
Inspect these when a run fails or skips. No real model or GitHub posting is needed
for the local regression checks:

```powershell
python -m unittest discover -s .github/bunny-review -p "test_*.py" -v
python -m unittest discover -s scripts -p "test_preview_build_scope.py" -v
```

## First live verification

After the setup reaches `main`, open a documentation-only PR and mark it ready
for review. Confirm **Bunny Review Auto Dispatch** starts **Bunny Review**, and
check that its walkthrough identifies the PR's current head commit. The review
should use the configured character (Ghostface by default) and concrete
observations about the diff.

Confirm `Validate` succeeds and `Preview APK` is deliberately skipped. In the
Bunny run, verify model-call telemetry and a completed review rather than a
skipped or failed review report. A workflow dispatch alone does not
prove that the provider accepted a model request or that comments were posted.
