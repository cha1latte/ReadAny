# Shlai Shared Phone Update Channel Design

## Goal

Make `ReadAny Shlai Preview` the single shared Android app for Celia and Decidetto. The next APK must contain every approved Shlai fix, update the currently installed preview app in place without deleting its library, and make every future approved `main` merge available to both phones through a one-tap in-app update.

## Confirmed starting state

- `cha1latte/ReadAny:main` already contains Shlai branding and identity, the Android chat keyboard fix, justified EPUB text, and the OLED black theme.
- The complete metadata, MOBI/AZW/AZW3 vectorization, and OPDS implementations remain on the focused branches used by upstream PRs #689, #690, and #693.
- The installed app is `io.github.cha1latte.readanyshlai.preview`, version `1.3.5-shlai.0`, Android `versionCode=1`.
- The installed APK and two independently produced GitHub Actions preview APKs have the same signing certificate and package ID. An APK with that same identity, certificate, and a greater version code can therefore update the installed app without replacing its app-data directory.
- The current update checker targets only stable production releases and the `ReadAny-Shlai.apk` production package. It does not provide a preview update channel.
- No stable Shlai release or protected stable-signing environment is currently configured. Migrating to the separate production package would create a second app and would not preserve the preview package's local data.

## Chosen architecture

### One canonical phone app

Keep the existing Android identity `io.github.cha1latte.readanyshlai.preview` and user-facing name `ReadAny Shlai Preview`. Celia and Decidetto install the same public APK from `cha1latte/ReadAny`. Experimental pull-request artifacts remain review-only; only a successful merge to Celia's `main` publishes a phone update.

This is intentionally a preview-grade channel. It preserves the existing preview certificate lineage and app data rather than forcing a destructive migration to a new production identity. The app downloads updates only from the exact public `cha1latte/ReadAny` GitHub release endpoint, and Android still requires an explicit install confirmation.

### Integration branch

Create one focused integration branch from current `origin/main`. Preserve the Shlai-specific identity, branding, update, and workflow files already on `main`, then integrate the reviewed feature histories in dependency order:

1. complete metadata (#689);
2. MOBI/AZW/AZW3 vectorization (#690);
3. OPDS catalogs (#693), whose history already depends on the metadata work.

The integration pull request into `cha1latte/ReadAny:main` is the review boundary. It must show conflict resolutions explicitly and must pass the combined core, Expo, desktop, TypeScript, formatting, generated-reader, and workflow-contract gates before merge.

### Main-to-phone release workflow

Add a dedicated GitHub Actions workflow triggered by `push` to `main`, with an owner-only `workflow_dispatch` retry path. The workflow uses serialized concurrency and performs these stages:

1. validate the exact `main` commit;
2. read all canonical preview releases and derive a strictly greater preview revision and Android version code;
3. build the release-mode preview APK for `arm64-v8a` with bundled JavaScript and no development launcher;
4. verify the APK package is `io.github.cha1latte.readanyshlai.preview`;
5. verify the version code is strictly greater than the previous canonical preview release and the currently installed baseline of `1`;
6. verify the APK's single signer certificate matches the checked-in non-secret preview certificate digest;
7. publish an immutable GitHub prerelease with an exact canonical preview tag, one `ReadAny-Shlai-Preview.apk` asset, one SHA-256 checksum asset, and one canonical `Android versionCode: N` metadata line.

Canonical preview tags use `shlai-preview-vX.Y.Z.N`, where `X.Y.Z` is the exact three-integer version in `packages/app-expo/package.json` and `N` is a positive preview revision. Within one upstream version, each successful publication increments `N`. When `X.Y.Z` increases, `N` restarts at `1`, but the full four-integer tuple must still be greater than every prior canonical preview tuple. Android `versionCode` is tracked independently and increments from the greatest valid prior preview release; when no prior preview release exists, the first combined build uses `versionCode=2` so it can replace the currently installed baseline `versionCode=1`.

Malformed release history, failed tests, build failure, certificate drift, package drift, non-monotonic versioning, an existing exact tag, or an asset collision stops publication. The previous working release remains available.

### Variant-aware update discovery

Keep stable-production discovery unchanged. Add a preview release configuration used only when `extra.appVariant` is `preview`:

- repository: `cha1latte/ReadAny`;
- exact tag shape: `shlai-preview-vX.Y.Z.N`;
- exact asset: `ReadAny-Shlai-Preview.apk`;
- source: paginated GitHub releases, filtered to canonical preview prereleases;
- update decision: greatest valid preview version strictly newer than the installed preview version.

Development builds do not check either public release channel. The parser rejects malformed tags, wrong assets, drafts, stable releases, non-increasing versions, and wrong release families. Fetch or parsing failures surface as a normal update-check failure without consuming the success throttle.

When a valid update exists, the existing update dialog downloads the exact APK, verifies its published SHA-256 checksum, and opens Android's package installer. Android presents the required install confirmation; accepting it updates the same package and retains books, settings, reading progress, models, and credentials.

## User flow

### Celia's existing phone

The first combined APK is installed over the current Shlai Preview package. Before installation, automation proves package, certificate, and version compatibility. After installation, the existing Hitchhiker and Dracula library entries and settings must still be present.

### Decidetto's first install

Decidetto receives one public GitHub release link and installs `ReadAny-Shlai-Preview.apk`. No GitHub account or repository access is required. From then on, the app itself announces each approved update and opens the standard Android installer after one tap.

### Future fixes

Each fix is developed on a branch and reviewed through a pull request. Pull-request preview artifacts do not notify either phone. When Celia approves and merges the pull request into `main`, the shared phone workflow validates and publishes the next canonical preview release. Both phones discover the same update.

## Verification and acceptance

Automated acceptance requires:

- complete UTC core and Expo suites;
- desktop tests and production build for the integrated cross-platform changes;
- Expo TypeScript and targeted Biome checks;
- generated-reader determinism and diff checks;
- parsed-YAML contracts proving main-only publication, serialized releases, strict version progression, exact package/asset/tag selection, certificate verification, checksum publication, and secret-free preview jobs;
- unit tests proving preview and stable release families cannot cross-update;
- update-check tests for malformed history, wrong assets, drafts, prereleases, network failures, checksum mismatch, and throttle behavior.

Live Pixel 9a acceptance requires:

1. install the combined APK with Android's replace/update path, never uninstalling the current Shlai Preview first;
2. confirm Hitchhiker, Dracula, reading progress, settings, and the selected theme survive;
3. vectorize the existing DRM-free Hitchhiker MOBI and prove it reaches Indexed/searchable state;
4. open both Gutenberg catalogs, perform a search, and import a book with readable Book Details metadata;
5. spot-check keyboard clearance, Deep Thinking and Spoiler-Free controls, justified EPUB text, and OLED black mode;
6. publish one subsequent harmless version increment and prove the in-app prompt downloads and installs it over the first combined build without data loss.

Decidetto acceptance requires only the public first-install link plus confirmation that a later canonical preview release appears through the same one-tap update flow.

## Operational boundaries

- Android does not allow silent consumer APK installation; one explicit installer confirmation is required per update.
- Preview releases contain no stable production signing secrets and do not alter the separate production package or stable release workflow.
- The currently installed preview lineage uses the standard Android debug certificate. Preserving its app data requires retaining that certificate for this preview-grade channel; its signing key is not a private production trust boundary. Distribution trust therefore comes from the exact `cha1latte/ReadAny` HTTPS release source plus checksum verification. A later move to a private production signing identity requires a separately designed data migration or proven Android signing-key rotation.
- Only `cha1latte/ReadAny:main` publishes shared phone updates. Fork pull requests and official upstream PRs never publish directly to either phone.
- A failed release is not replaced with a fallback APK. Repair happens through another reviewed commit or a manual retry of the same protected main-only workflow.
- The current preview package is never uninstalled during migration. Any signature or package mismatch is a hard stop because uninstalling would delete local app data.
