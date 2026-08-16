# Releasing ReadAny Shlai

## Required GitHub environment and secrets

Create the protected GitHub environment `shlai-production` before dispatching a stable release. It must contain these secrets:

- `SHLAI_ANDROID_KEYSTORE_BASE64`
- `SHLAI_ANDROID_KEYSTORE_PASSWORD`
- `SHLAI_ANDROID_KEY_ALIAS`
- `SHLAI_ANDROID_KEY_PASSWORD`

They are never used by pull-request workflows. Keep the environment approval rule enabled so signing is available only for intentional stable releases.

The four secrets are exposed only to the final signing-and-publishing shell step. Checkout, dependency installation, Expo prebuild, Gradle compilation, and artifact upload all run without the protected environment or signing secrets. The protected job does not check out the repository or execute pnpm, Expo, Gradle, or repository code.

## Versioning

The first stable Shlai build based on ReadAny `1.3.5` is app version `1.3.5-shlai.1` with `versionCode=1`. Its release tag is `shlai-v1.3.5.1`. Keep the Shlai revision and Android version code increasing for every later stable release.

## Release

Dispatch the protected workflow from fork `main` only:

```powershell
gh workflow run "Release ReadAny Shlai" --repo cha1latte/ReadAny --ref main -f upstream_version=1.3.5 -f revision=1 -f version_code=1
```

The workflow fails before checkout unless `GITHUB_REF` is exactly `refs/heads/main`; the protected signing job repeats that guard. Do not dispatch a stable release from a feature branch or tag.

The workflow first validates the selected `main` commit. A separate secret-free production build then:

1. generates the Android project;
2. removes exactly the generated release build's debug-signing assignment while leaving the debug build unchanged;
3. compiles only `arm64-v8a` without keystore injection;
4. verifies that `app-release-unsigned.apk` is unsigned; and
5. uploads that exact internal artifact for the protected job.

Approve the `shlai-production` environment only after confirming the run targets the intended `main` commit and its unsigned build succeeded. The minimal protected job downloads that artifact, zipaligns it if needed, signs it with `apksigner`, verifies the signing certificate, rejects an existing tag, and publishes exactly one asset named `ReadAny-Shlai.apk` under the matching `shlai-v...` tag.

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
