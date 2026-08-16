# Releasing ReadAny Shlai

## Required GitHub environment and secrets

Create the protected GitHub environment `shlai-production` before dispatching a stable release. It must contain these secrets:

- `SHLAI_ANDROID_KEYSTORE_BASE64`
- `SHLAI_ANDROID_KEYSTORE_PASSWORD`
- `SHLAI_ANDROID_KEY_ALIAS`
- `SHLAI_ANDROID_KEY_PASSWORD`

They are never used by pull-request workflows. Keep the environment approval rule enabled so signing is available only for intentional stable releases.

## Versioning

The first stable Shlai build based on ReadAny `1.3.5` is app version `1.3.5-shlai.1` with `versionCode=1`. Its release tag is `shlai-v1.3.5.1`. Keep the Shlai revision and Android version code increasing for every later stable release.

## Release

Dispatch the protected workflow from the intended fork commit:

```powershell
gh workflow run "Release ReadAny Shlai" --repo cha1latte/ReadAny -f upstream_version=1.3.5 -f revision=1 -f version_code=1
```

Approve the `shlai-production` environment only after confirming the run targets the intended commit. The workflow rejects an existing tag, creates the signed arm64 APK, verifies it, and publishes `ReadAny-Shlai.apk`.

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
