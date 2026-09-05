# Releasing ReadAny Shlai

## Required GitHub environment and secrets

Create the protected GitHub environment `shlai-production` before dispatching a stable release. It must contain these secrets:

- `SHLAI_ANDROID_KEYSTORE_BASE64`
- `SHLAI_ANDROID_KEYSTORE_PASSWORD`
- `SHLAI_ANDROID_KEY_ALIAS`
- `SHLAI_ANDROID_KEY_PASSWORD`

They are never used by pull-request workflows. Keep the environment approval rule enabled so signing is available only for intentional stable releases.

The same protected environment must contain one non-secret environment variable:

- `SHLAI_ANDROID_CERT_SHA256` — the signing certificate's canonical 64-character SHA-256 hexadecimal digest, without separators

After confirming the fingerprint shown by `keytool -list -v`, configure and verify the environment variable without treating it as a secret:

```powershell
$certSha256 = Read-Host 'Paste the 64-character signing certificate SHA-256 digest without separators'
if ($certSha256 -notmatch '^[0-9A-Fa-f]{64}$') { throw 'Invalid certificate SHA-256 digest' }
gh variable set SHLAI_ANDROID_CERT_SHA256 --repo cha1latte/ReadAny --env shlai-production --body ($certSha256.ToUpperInvariant())
gh variable list --repo cha1latte/ReadAny --env shlai-production
```

The four secrets are exposed only to the final signing-and-publishing shell step. Checkout, dependency installation, Expo prebuild, Gradle compilation, and artifact upload all run without the protected environment or signing secrets. The protected job does not check out the repository or execute pnpm, Expo, Gradle, or repository code.

## Versioning

The first stable Shlai build based on ReadAny `1.3.5` is app version `1.3.5-shlai.1` with `versionCode=1`. Its release tag is `shlai-v1.3.5.1`. Every later release must use both a strictly greater four-integer semantic tuple (`upstream major`, `minor`, `patch`, then Shlai revision) and a strictly greater Android `versionCode`.

Stable Android builds are supported only through the protected GitHub workflow below. The repository deliberately has no production EAS profile and no generic production EAS build script; development and preview EAS profiles remain available. Stable iOS distribution is not supported.

## Release

Dispatch the protected workflow from fork `main` only:

```powershell
gh workflow run "Release ReadAny Shlai" --repo cha1latte/ReadAny --ref main -f upstream_version=1.3.5 -f revision=1 -f version_code=1
```

The workflow fails before checkout unless `GITHUB_REF` is exactly `refs/heads/main`. It also rejects non-canonical version input, including whitespace, leading-zero components such as `01`, zero or leading-zero revisions, and zero or leading-zero Android version codes. It pages through all canonical, non-draft, non-prerelease Shlai releases and finds the greatest exact `shlai-vX.Y.Z.N` tuple without converting arbitrary-size tuple components to JavaScript or shell integers. If a prior stable release exists, the requested tuple must be greater and its Android version code must be greater than the prior value. Release-history API or parsing failures stop the workflow. Concurrent stable dispatches are serialized.

Each published release records one exact `Android versionCode: N` line in its notes. A later release fails closed if that line is absent, duplicated, malformed, or outside Android's supported bound on the greatest prior stable Shlai release. Only the first stable Shlai release may proceed without prior metadata. The protected signing job repeats the main guard. Do not dispatch a stable release from a feature branch or tag.

The workflow first validates the selected `main` commit. A separate secret-free production build then:

1. generates the Android project;
2. removes exactly the generated release build's debug-signing assignment while leaving the debug build unchanged;
3. compiles only `arm64-v8a` without keystore injection;
4. verifies that `app-release-unsigned.apk` is unsigned; and
5. uploads that exact internal artifact for the protected job.

Both APK jobs explicitly install and use Android build tools `36.0.0`; they never select an arbitrary latest runner version. Every third-party action in the Shlai release, pull-request, and upstream-sync workflows is pinned to a reviewed commit SHA. Approve the `shlai-production` environment only after confirming the run targets the intended `main` commit and its unsigned build succeeded. The minimal protected job downloads that artifact, zipaligns it if needed, signs it with `apksigner`, requires the APK's single signer certificate digest to match `SHLAI_ANDROID_CERT_SHA256`, performs verbose signature verification, rejects any pre-existing exact Git tag even when no GitHub Release exists, and publishes exactly one asset named `ReadAny-Shlai.apk` under the matching `shlai-v...` tag.

## Verify

Confirm the GitHub Release:

```powershell
gh release view shlai-v1.3.5.1 --repo cha1latte/ReadAny
```

Download the `ReadAny-Shlai.apk` asset, then verify its signing certificate and package identity before installation:

```powershell
$apk = '.\ReadAny-Shlai.apk'
$buildTools = Get-ChildItem "$env:ANDROID_HOME\build-tools" -Directory | Sort-Object Name -Descending | Select-Object -First 1
& "$($buildTools.FullName)\apksigner.bat" verify --verbose --print-certs $apk
$adb = 'D:\dev\_toolchains\readany-android\sdk\platform-tools\adb.exe'
& $adb install -r $apk
& $adb shell dumpsys package io.github.cha1latte.readanyshlai
```

## Rollback

Rebuild the previous known-good source commit, but release it with a newer Android version code and a new Shlai revision. Never reuse a published tag or lower `versionCode`; installed devices need the newer signed package to accept the rollback update.

## Key recovery

Do not release until both encrypted signing-key backups are confirmed recoverable. If either backup is unverified, stop and restore key access before approving `shlai-production`; do not replace the signing key for an already-published package.
