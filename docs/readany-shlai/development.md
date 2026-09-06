# Developing ReadAny Shlai

ReadAny Shlai is the public, unofficial GPL-3.0-or-later Android fork at [cha1latte/ReadAny](https://github.com/cha1latte/ReadAny). The official project remains [codedogQBY/ReadAny](https://github.com/codedogQBY/ReadAny).

## Celia's canonical clone

```powershell
git clone https://github.com/cha1latte/ReadAny.git
Set-Location ReadAny
git remote add upstream https://github.com/codedogQBY/ReadAny.git
pnpm install --frozen-lockfile
pnpm --filter @readany/app-expo test
git switch -c feature/reader-font-size
```

## Friend fork clone

The friend must use their own GitHub fork; do not add them as a direct collaborator on `cha1latte/ReadAny`. First create the fork in the GitHub UI, then clone and configure it exactly like this (replace only `<friend-login>`):

```powershell
git clone https://github.com/<friend-login>/ReadAny.git
Set-Location ReadAny
git remote add canonical https://github.com/cha1latte/ReadAny.git
git remote add upstream https://github.com/codedogQBY/ReadAny.git
git fetch canonical
git fetch upstream
git switch -c feature/reader-font-size canonical/main
pnpm install --frozen-lockfile
pnpm --filter @readany/app-expo test
```

`origin` is the friend's writable fork; `canonical` is Celia's protected Shlai repository; `upstream` remains the official ReadAny repository. The canonical repository is owner-only because GitHub Releases share the repository's `contents: write` permission. Public releases are still available to everyone, including the friend, through GitHub Releases and Obtainium.

## Branches and pull requests

Do not push directly to `main`. The friend pushes only to their own fork, then opens a focused pull request into `cha1latte/ReadAny:main`:

```powershell
git push -u origin feature/reader-font-size
gh pr create --repo cha1latte/ReadAny --base main --head <friend-login>:feature/reader-font-size --fill
```

Wait for `Validate` and, when built, `Preview APK`, then review the preview artifact. Friend reviews and comments are advisory; Celia manually approves and merges after the checks are green. App/build changes merged into `main` publish the next shared preview phone update after a second successful validation/build; they do not publish a stable-production release. See [phone-updates.md](phone-updates.md).

[Bunny Review](bunny-review.md) adds automated review comments with a Ghostface-inspired voice. Its [architecture and code-quality guards](code-quality.md) cover platform boundaries, data integrity, and practical KISS/YAGNI/SOLID concerns. Bunny remains advisory; the existing checks and owner merge decision still apply.

## Workflow approvals

GitHub places `pull_request` workflows created by automation using `GITHUB_TOKEN` into an approval-required state, and it can require the same approval for a first pull request from a fork. When an automated upstream-sync PR or a first-time fork PR shows **Approve workflows**, Celia clicks it in the pull request's Checks/Actions view; GitHub then runs the normal `Validate` and `Preview APK` jobs. Do not add a PAT, `workflow_dispatch` workaround, or bootstrap push: these workflows are triggered by `pull_request`, not only by default-branch pushes.

## Preview APKs

Every pull request to `main` runs the secret-free **Shlai Pull Request** workflow. After its `Preview APK` job succeeds, open that workflow run in GitHub Actions and download the artifact named `ReadAny-Shlai-Preview-<PR number>`. The downloaded ZIP contains `ReadAny-Shlai-Preview-<PR number>.apk`; extract it and install that APK for review. It is a self-contained release-mode preview with bundled JavaScript and no Expo development launcher or Metro dependency. Preview artifacts are retained for 14 days.

PRs that change only Bunny tooling, the PR/phone-preview CI wiring and its scope checker, `AGENTS.md`, `.gitignore`, or Markdown files under `docs/` still run `Validate` but skip `Preview APK`. The same rule prevents an APK build and phone prerelease after merging those changes. `scripts/preview_build_scope.py` owns the exact allowlist. Any other changed path, including app code, dependencies, or build configuration, requires an APK; deleted and renamed paths count too. Manual workflow dispatch always builds. Inspect the **Determine preview build scope** summary to see the decision, and manually dispatch a build when changing build steps inside an allowlisted workflow requires APK verification.

The GitHub workflows and the variant-aware EAS post-install hook temporarily add package-level Expo autolinking exclusions for `expo-dev-client`, `expo-dev-launcher`, and their menu modules before native generation. This keeps development-client builds untouched while preventing every supported preview and stable Android APK from opening a blank launcher screen. Android release builds also use a bounded 4 GB Gradle heap so R8 can finish on hosted runners.

The preview is a separate app (`io.github.cha1latte.readanyshlai.preview`), so it can be installed alongside official ReadAny and stable ReadAny Shlai without changing either app's data.

Pull-request APKs are temporary review artifacts. Celia and Decidetto use the permanent prerelease channel documented in [phone-updates.md](phone-updates.md); a successful app/build merge to `main` creates the next verified update for both phones.

## Long-running local builds

Before starting a compile expected to take more than a few minutes, verify the requested behavior, connected-device state, required toolchain versions, build variant, and all proposed workarounds. Reproduce build failures with the smallest relevant configure or build target, and prove a workaround against that target before launching a full application build. Do not use repeated full compiles as a trial-and-error diagnostic loop.

Record the command, process ID, start time, and persistent log paths for any build that may outlive its terminal command. If prerequisites remain unverified or a workaround changes the supported toolchain, stop and report the blocker instead of starting the long build.

## No secrets in development or previews

Never add a keystore, password, certificate, signing value, or GitHub secret to the repository, pull-request text, issue text, logs, terminal arguments, or preview workflow. Pull-request previews intentionally receive no stable signing secrets. Stable signing is available only through the protected `shlai-production` environment; follow [releasing.md](releasing.md) for that process and its two-encrypted-backup requirement.

EAS is intentionally limited to development and preview profiles. There is no supported production EAS profile or `eas:build:android` / `eas:build:ios` shortcut in this fork. Build and publish stable Android packages only through the protected `Release ReadAny Shlai` GitHub workflow; iOS stable distribution remains out of scope.

## Installed app identities

| Build | Android package | Deep-link scheme |
| --- | --- | --- |
| Official ReadAny | `com.readany.app` | `readany` |
| ReadAny Shlai Dev | `io.github.cha1latte.readanyshlai.dev` | `readany-shlai-dev` |
| ReadAny Shlai Preview | `io.github.cha1latte.readanyshlai.preview` | `readany-shlai-preview` |
| ReadAny Shlai | `io.github.cha1latte.readanyshlai` | `readany-shlai` |

These identities deliberately keep official ReadAny, local development, preview, and stable Shlai data separate.

## Upstreamable fixes

For a broadly useful ReadAny change, start a branch from `upstream/main`, not from the Shlai fork. Keep it free of Shlai names, branding assets, package identities, signing configuration, release automation, and other fork-only changes. Open it first as a focused pull request to `codedogQBY/ReadAny:main`; only carry the accepted upstream change into Shlai afterward through the normal synchronization path.

For the reviewable synchronization and conflict-resolution process, see [upstream-sync.md](upstream-sync.md). It preserves Shlai-specific identities, release behavior, signing boundaries, branding, and attribution while bringing official changes in through a visible pull request.
