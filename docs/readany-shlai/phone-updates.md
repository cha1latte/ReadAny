# ReadAny Shlai phone updates

This is the shared Android update channel for Celia and Decidetto. It installs as `io.github.cha1latte.readanyshlai.preview`, keeps its own library and settings, and does not replace official ReadAny.

## First install for Decidetto

1. On the phone, open <https://github.com/cha1latte/ReadAny/releases>.
2. Choose the newest prerelease whose tag starts with `shlai-preview-v`.
3. Download `ReadAny-Shlai-Preview.apk`. Do not download an APK with a pull-request number in its name.
4. If Android asks, allow installs from the browser or file manager being used.
5. Open the download and confirm **Install**.

Android always requires a person to confirm Install. ReadAny Shlai can download and verify an update, but Android does not allow this app to silently install it.

For an optional desktop checksum check, download both release assets into the same directory and run:

```bash
sha256sum --check "ReadAny-Shlai-Preview.apk.sha256"
```

The checksum file must be named `ReadAny-Shlai-Preview.apk.sha256` and must verify `ReadAny-Shlai-Preview.apk`.

## Later updates on either phone

The app checks the same `shlai-preview-v` release family. When it offers an update:

1. Tap **Download update**.
2. Wait while the APK downloads and its checksum is verified.
3. Confirm **Install** in Android's installer.

Do not uninstall the app before updating. Installing the newer APK over the existing `io.github.cha1latte.readanyshlai.preview` package preserves that phone's books, settings, and reading data. An uninstall deletes app-local data.

If the in-app check is unavailable, use the first-install release page again and install the newest APK over the existing app.

## How future fixes reach both phones

Make each change on a branch based on `cha1latte/ReadAny:main`, push it, and open a pull request into `cha1latte/ReadAny:main`. Wait for **Shlai Pull Request** validation and test its temporary APK. After Celia approves and merges the pull request, the **Shlai Phone Release** workflow validates the merged commit again, builds the shared APK, verifies its identity/version/signature/checksum, and publishes the next prerelease.

Only a successful build from `cha1latte/ReadAny:main` publishes a shared phone update. A branch, an open pull request, a failed workflow, or a build from another repository publishes nothing.

Never use a pull-request artifact as Decidetto's permanent installation. It is temporary, expires after 14 days, and is only for reviewing that pull request. The permanent shared channel is the APK on <https://github.com/cha1latte/ReadAny/releases>.

Decidetto can work independently by forking the repository, creating a branch from `cha1latte/main`, and opening a pull request back to `cha1latte/ReadAny:main`. Decidetto does not need release permission or signing material.

## Recovery and rollback

- If validation, building, or verification fails, the workflow publishes nothing. Fix it in a reviewed commit and merge that commit, or rerun the workflow on `main` after correcting an external failure.
- Never delete, replace, or reuse an existing release or tag.
- A rollback is a rebuild of the chosen older source with a new preview revision and a higher Android `versionCode`. Android will not install an APK with a lower version code over a newer one.
- Preserve the package name and certificate. Changing either creates a different installation or makes Android reject the update.

## Security boundary

The workflow accepts only the exact GitHub repository, release tag family, APK name, checksum name, package ID, Android version code, and expected certificate digest. It verifies the APK before publishing and the app verifies it again before opening Android's installer.

This convenience channel uses a public preview signing certificate, not the protected stable-production key. Anyone with that public debug key could technically sign the same package, so install updates only through the app or the `cha1latte/ReadAny` release page. The protected stable release channel remains the higher-security choice for broader distribution.
