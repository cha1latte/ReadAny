# ReadAny Shlai Fork Design

## Goal

Create a public, maintainable fork named **ReadAny Shlai** that Celia owns, while one friend contributes from their own GitHub fork, tests on Android, and receives public releases through GitHub Releases and Obtainium. The fork must remain easy to synchronize with official ReadAny and must keep broadly useful fixes suitable for upstream contribution.

## Constraints

- Official ReadAny must remain installed and continue receiving its own updates.
- ReadAny Shlai must have a distinct app identity, signing identity, storage area, icon treatment, and update channel.
- Official ReadAny data must never be modified as part of Shlai development or installation.
- The fork remains public and GPL-3.0 licensed, preserves upstream attribution, and clearly identifies itself as unofficial.
- Repository, build, release, and sync automation must not contain API keys, signing keys, passwords, personal books, or user data.
- Stable releases require Celia's explicit approval. Pull requests and preview builds cannot access the stable signing key.
- The initial scope is Android. App-store publication and iOS distribution are not included.

## Repository Ownership and Remotes

The canonical fork is `cha1latte/ReadAny`, and Celia is its only write-capable maintainer. The friend works from their own GitHub fork, `<friend-login>/ReadAny`, and opens pull requests into `cha1latte/ReadAny:main`; they are not invited as a direct collaborator.

This boundary is intentional: GitHub Releases use the repository's `contents: write` permission. Giving the friend canonical write access would also give them release-channel write power, which is incompatible with owner-only stable release control. The canonical repository and its releases remain public, so the friend can still inspect, test, download, and use each released APK.

Local clones use these remotes:

- `origin`: `https://github.com/cha1latte/ReadAny.git`
- `upstream`: `https://github.com/codedogQBY/ReadAny.git`

The fork's protected `main` branch always represents the stable Shlai source. Direct pushes to `main` are disabled. Work enters `main` through short-lived feature branches and pull requests after required checks pass.

## Collaboration Workflow

1. The friend creates a feature branch in their own fork from the latest canonical `main`.
2. Changes are committed to that fork branch and opened as a pull request into `cha1latte/ReadAny:main`.
3. GitHub runs tests, TypeScript checks, changed-file linting, diff checks, and an Android preview build.
4. The preview APK is installed and tested separately from stable Shlai.
5. The friend may review and comment, but those reviews are advisory; Celia manually approves the merge after the checks and preview review.
6. Celia merges the pull request, which updates source on `main` but does not publish a stable phone update.

The preview APK uses a preview package identity and ephemeral debug signing. It may require uninstalling the previous preview build before installation. Stable signing material is never exposed to pull-request code.

## App Identity

| Variant | Display name | Android package | Deep-link scheme | Purpose |
| --- | --- | --- | --- | --- |
| Production | ReadAny Shlai | `io.github.cha1latte.readanyshlai` | `readany-shlai` | Stable personal release |
| Preview | ReadAny Shlai Preview | `io.github.cha1latte.readanyshlai.preview` | `readany-shlai-preview` | Pull-request testing |
| Development | ReadAny Shlai Dev | `io.github.cha1latte.readanyshlai.dev` | `readany-shlai-dev` | Local Metro development |

Each variant uses a visibly distinct icon badge. The production icon remains recognizable as a ReadAny derivative while making the Shlai version unmistakable beside the official app. The README and About screen say that ReadAny Shlai is an unofficial GPL-3.0 fork and link to both official ReadAny and the fork source.

Changing the Android package creates a separate secure-storage namespace and application database. Official ReadAny books, settings, AI credentials, and history do not automatically appear in Shlai.

## Data Setup and Isolation

The first Shlai installation starts with an empty application data area. Users populate it through supported ReadAny mechanisms:

- WebDAV sync where appropriate;
- existing export/import features; or
- re-importing local book files.

AI provider credentials are entered again because Android secure storage is intentionally isolated by package. Automation does not copy files from official ReadAny's private application directory and never performs a destructive migration.

## Pull-Request Checks and Preview Builds

The fork adds an Android-focused GitHub Actions workflow for pull requests into `main`. It performs:

1. dependency installation with the repository's pinned Node and pnpm versions;
2. reader-asset generation;
3. Expo mobile tests;
4. Expo TypeScript type-checking;
5. Biome checks limited to changed supported files, avoiding unrelated pre-existing baseline findings;
6. `git diff --check`;
7. generation of the preview Android project; and
8. compilation of a preview APK as a downloadable workflow artifact.

A failed required check blocks merge. A failed preview build produces no installable artifact. The workflow does not hide failures with fallback artifacts or fake-success steps.

## Stable Releases and Obtainium

A manual **Release ReadAny Shlai** workflow publishes stable Android updates. Merging to `main` never invokes it automatically.

The release workflow:

1. accepts an explicit Shlai version and monotonically increasing Android build number;
2. checks out the exact `main` commit selected for release;
3. reruns all required automated checks;
4. builds the production Android package;
5. enters a protected `shlai-production` GitHub environment requiring Celia's approval;
6. loads the dedicated Android keystore from encrypted GitHub Actions secrets;
7. signs and verifies the APK;
8. creates a Git tag and GitHub Release tied to the same source commit; and
9. attaches the signed APK and concise release notes.

Release tags encode the upstream version followed by a Shlai revision, for example `shlai-v1.3.5.1`. The matching app version name is `1.3.5-shlai.1`. Obtainium watches releases in `cha1latte/ReadAny` and discovers the attached APK.

If a release fails at any point, no GitHub Release is published. To roll back behavior, the previous source commit is rebuilt with a newer Android build number so Android accepts it as an update.

## Signing-Key Safety

The stable keystore, alias, and passwords are never committed. GitHub stores the build copy as protected environment secrets. Celia retains two encrypted backups: one in her password-management or encrypted cloud system and one offline. Recovery instructions record the keystore filename, alias, and where each encrypted backup is stored without recording passwords in the repository.

Losing the signing key would make it impossible to update an installed ReadAny Shlai package with the same identity, so the first stable release does not occur until both backups are verified.

## Upstream Synchronization

A scheduled workflow checks official `upstream/main` weekly. When upstream is ahead, automation creates or refreshes a date-named branch such as `sync/upstream-2026-08-15` and opens a pull request into the fork's `main`.

Upstream changes are never auto-merged. The sync pull request runs the normal tests and preview build. Conflicts are resolved on the sync branch and tested before approval. If upstream has not changed, the workflow does nothing.

## Contributing Fixes Upstream

Broadly useful fixes are kept separate from Shlai branding and customization:

1. create a focused branch from the latest `upstream/main`;
2. include only the general fix and its tests;
3. verify the affected behavior and open a pull request against `codedogQBY/ReadAny:main`;
4. apply the same fix to Shlai through its own pull request when needed; and
5. after upstream merges the fix, synchronize upstream and remove any duplicate fork-only patch during conflict resolution.

ReadAny Shlai names, icons, package identifiers, signing configuration, release automation, and personal features are never included in upstream pull requests.

## Stable-Release Verification

Before Celia approves each stable release, she and/or her friend verifies:

- a clean installation on Android;
- an update over the previous stable Shlai release;
- persistence of the Shlai library and settings across the update;
- book import and reading;
- AI configuration and ordinary chat;
- selected text to sparkle action to visible keyboard input;
- keyboard dismissal and reopening;
- WebDAV or the chosen data-transfer path; and
- Obtainium discovery of the published release.

The exact keyboard regression fixed in upstream PR #680 remains an automated layout contract and a manual release smoke test.

## Failure Handling

- Pull-request check failure blocks merge.
- Preview-build failure publishes no APK artifact.
- Upstream conflict remains visible in an unmerged sync pull request.
- Signing or verification failure publishes no stable release.
- Obtainium failure leaves the existing installed version untouched and is diagnosed from the GitHub Release metadata and APK naming.
- A bad stable release is superseded by a newly numbered rollback release; users are not instructed to delete app data.

## Implementation Sequence

1. Reconfigure remotes and fork repository protections without altering the upstream keyboard-fix branch or PR.
2. Add Shlai production, preview, and development identities and branded assets.
3. Add required pull-request checks and preview APK artifacts.
4. Create and back up the stable signing key, then configure the protected release environment.
5. Add the manual stable-release workflow and validate Obtainium using the first tagged Shlai release.
6. Add the scheduled upstream-sync pull-request workflow.
7. Have the friend fork the canonical repository and walk through one sample fork branch, preview, advisory review, Celia-approved merge, and release cycle.

## Out of Scope

- Publishing ReadAny Shlai to Google Play or another app store.
- Automatic copying of private data from official ReadAny.
- Automatic merging of upstream changes.
- Giving pull-request workflows access to stable signing credentials.
- iOS signing, TestFlight, or App Store distribution.
