# Developing ReadAny Shlai

ReadAny Shlai is the public, unofficial GPL-3.0-or-later Android fork at [cha1latte/ReadAny](https://github.com/cha1latte/ReadAny). The official project remains [codedogQBY/ReadAny](https://github.com/codedogQBY/ReadAny).

## Quick start

```powershell
git clone https://github.com/cha1latte/ReadAny.git
Set-Location ReadAny
git remote add upstream https://github.com/codedogQBY/ReadAny.git
pnpm install --frozen-lockfile
pnpm --filter @readany/app-expo test
git switch -c feature/reader-font-size
```

## Branches and pull requests

Do not push directly to `main`. Make every fork-specific change on a short-lived branch and open a pull request from that branch into `cha1latte/ReadAny:main`. Keep the pull request focused, wait for `Validate` and `Preview APK`, review the preview artifact, and obtain the required approval before merging. Merging a pull request does not publish a stable phone update.

## Preview APKs

Every pull request to `main` runs the secret-free **Shlai Pull Request** workflow. After its `Preview APK` job succeeds, open that workflow run in GitHub Actions and download the artifact named `ReadAny-Shlai-Preview-<PR number>`. The downloaded ZIP contains `ReadAny-Shlai-Preview-<PR number>.apk`; extract it and install that APK for review. Preview artifacts are retained for 14 days.

The preview is a separate app (`io.github.cha1latte.readanyshlai.preview`), so it can be installed alongside official ReadAny and stable ReadAny Shlai without changing either app's data.

## No secrets in development or previews

Never add a keystore, password, certificate, signing value, or GitHub secret to the repository, pull-request text, issue text, logs, terminal arguments, or preview workflow. Pull-request previews intentionally receive no stable signing secrets. Stable signing is available only through the protected `shlai-production` environment; follow [releasing.md](releasing.md) for that process and its two-encrypted-backup requirement.

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
