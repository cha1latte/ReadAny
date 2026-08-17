import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const root = resolve(import.meta.dirname, "../../../..");
const readWorkflow = (name: string) =>
  readFileSync(resolve(root, ".github/workflows", name), "utf8").replaceAll("\r\n", "\n");
const readShlaiDoc = (name: string) =>
  readFileSync(resolve(root, "docs/readany-shlai", name), "utf8").replaceAll("\r\n", "\n");

type WorkflowStep = {
  name?: string;
  uses?: string;
  run?: string;
  if?: string;
  shell?: string;
  "continue-on-error"?: unknown;
  env?: Record<string, unknown>;
  with?: Record<string, unknown>;
};

type WorkflowJob = {
  name?: string;
  needs?: string | string[];
  "runs-on"?: string;
  if?: string;
  "continue-on-error"?: unknown;
  permissions?: unknown;
  environment?: unknown;
  env?: Record<string, unknown>;
  outputs?: Record<string, unknown>;
  uses?: string;
  steps?: WorkflowStep[];
};

const expectPhoneReleaseWorkflowContract = (source: string) => {
  const workflow = parse(source, { version: "1.2" }) as Workflow;
  expect(workflow.on).toEqual({
    push: { branches: ["main"] },
    workflow_dispatch: null,
  });
  expect(workflow.permissions).toEqual({ contents: "read" });
  expect(workflow.concurrency).toEqual({
    group: "shlai-phone-release",
    "cancel-in-progress": false,
  });

  const jobs = workflow.jobs ?? {};
  expect(Object.keys(jobs)).toEqual(["validate", "metadata", "build", "verify", "publish"]);
  expect(jobs.metadata?.needs).toBe("validate");
  expect(jobs.build?.needs).toBe("metadata");
  expect(jobs.verify?.needs).toEqual(["metadata", "build"]);
  expect(jobs.publish?.needs).toEqual(["metadata", "verify"]);
  for (const job of Object.values(jobs)) {
    expect(job.if).toContain("github.ref == 'refs/heads/main'");
    expect(job.if).toContain("github.repository == 'cha1latte/ReadAny'");
    expect(job.uses).toBeUndefined();
    expect(job.environment).toBeUndefined();
  }
  expect(jobs.publish?.permissions).toEqual({ actions: "read", contents: "write" });
  expect(jobs.validate?.permissions).toBeUndefined();
  expect(jobs.metadata?.permissions).toBeUndefined();
  expect(jobs.build?.permissions).toBeUndefined();
  expect(jobs.verify?.permissions).toBeUndefined();
  expect(jobs.build?.env).toEqual({
    APP_VARIANT: "preview",
    SHLAI_UPSTREAM_VERSION: "${{ needs.metadata.outputs.upstream_version }}",
    SHLAI_REVISION: "${{ needs.metadata.outputs.revision }}",
    SHLAI_VERSION_CODE: "${{ needs.metadata.outputs.version_code }}",
  });

  expect(hasParsedKey(workflow, "secrets")).toBe(false);
  const allSteps = Object.values(jobs).flatMap((job) => job.steps ?? []);
  const setupNodeSteps = allSteps.filter((step) => step.uses?.startsWith("actions/setup-node@"));
  expect(setupNodeSteps).toHaveLength(3);
  expect(setupNodeSteps.every((step) => step.with?.["node-version"] === "24.15.0")).toBe(true);
  const actions = allSteps
    .map((step) => step.uses)
    .filter((action): action is string => typeof action === "string");
  expect(actions.length).toBeGreaterThan(0);
  expect(actions.every((action) => /^[\w-]+\/[\w-]+@[a-f0-9]{40}$/.test(action))).toBe(true);

  const metadataCommands = (jobs.metadata?.steps ?? [])
    .map((step) => step.run)
    .filter((run): run is string => typeof run === "string")
    .join("\n");
  expect(metadataCommands).toContain("releases?per_page=100");
  expect(metadataCommands).toContain("--paginate");
  expect(metadataCommands).toContain("--slurp");
  expect(metadataCommands).toContain("shlai-preview-release.js derive");
  expect(metadataCommands).toContain("--baseline-version-code 1");
  expect(metadataCommands).toContain('test "$GITHUB_REPOSITORY" = "cha1latte/ReadAny"');

  const validateCommands = (jobs.validate?.steps ?? [])
    .map((step) => step.run)
    .filter((run): run is string => typeof run === "string")
    .join("\n");
  expect(validateCommands).toContain("pnpm --dir packages/app exec vitest run src");
  expect(validateCommands).toContain("pnpm --filter app build");
  expect(validateCommands).toContain("pnpm --filter @readany/app-expo run build:reader");
  expect(validateCommands).toContain(
    "git diff --exit-code -- packages/app-expo/assets/reader/reader.html",
  );

  const buildCommands = (jobs.build?.steps ?? [])
    .map((step) => step.run)
    .filter((run): run is string => typeof run === "string")
    .join("\n");
  expect(buildCommands).toContain(configureStandaloneAutolinkingCommand);
  expect(buildCommands).toContain("expo prebuild --platform android --clean --no-install");
  expect(buildCommands).toContain("assembleRelease -PreactNativeArchitectures=arm64-v8a");
  expect(buildCommands).toContain('PACKAGE="$("$AAPT2" dump badging "$APK"');
  expect(buildCommands).toContain('test "$PACKAGE" = "io.github.cha1latte.readanyshlai.preview"');
  expect(buildCommands).toContain('test "$VERSION_CODE" = "$SHLAI_VERSION_CODE"');
  expect(buildCommands).toContain(
    "fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c",
  );
  expect(buildCommands).toContain('test "${#DIGESTS[@]}" -eq 1');
  expect(buildCommands).toContain('sha256sum "ReadAny-Shlai-Preview.apk"');

  const verifyCommands = (jobs.verify?.steps ?? [])
    .map((step) => step.run)
    .filter((run): run is string => typeof run === "string")
    .join("\n");
  expect(verifyCommands).toContain('test "$PACKAGE" = "io.github.cha1latte.readanyshlai.preview"');
  expect(verifyCommands).toContain('test "$VERSION_CODE" = "$SHLAI_VERSION_CODE"');
  expect(verifyCommands).toContain(
    "fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c",
  );
  expect(verifyCommands).toContain('sha256sum --check "$CHECKSUM"');
  expect(verifyCommands).toContain("apk_sha256=%s\\n");
  const verifySteps = jobs.verify?.steps ?? [];
  const verifyJavaIndex = verifySteps.findIndex((step) =>
    step.uses?.startsWith("actions/setup-java@"),
  );
  const verifyAndroidIndex = verifySteps.findIndex((step) =>
    step.uses?.startsWith("android-actions/setup-android@"),
  );
  expect(verifyJavaIndex).toBeGreaterThanOrEqual(0);
  expect(verifyJavaIndex).toBeLessThan(verifyAndroidIndex);
  expect(verifySteps[verifyJavaIndex]?.with).toEqual({
    distribution: "temurin",
    "java-version": 17,
  });

  const publishCommands = (jobs.publish?.steps ?? [])
    .map((step) => step.run)
    .filter((run): run is string => typeof run === "string")
    .join("\n");
  expect(publishCommands).toContain('test "$GITHUB_REF" = "refs/heads/main"');
  expect(publishCommands).toContain('test "$GITHUB_REPOSITORY" = "cha1latte/ReadAny"');
  expect(publishCommands).toContain('gh run download "$GITHUB_RUN_ID"');
  expect(publishCommands).toContain('test "$APK_SHA256" = "$EXPECTED_APK_SHA256"');
  expect(publishCommands).toContain('gh release create "$TAG"');
  expect(publishCommands).toContain('--target "$GITHUB_SHA"');
  expect(publishCommands).toContain("--prerelease");
  expect(publishCommands).toContain("Android versionCode: %s");
  expect(publishCommands).toContain("ReadAny-Shlai-Preview.apk.sha256");
  expect(publishCommands).toContain('sha256sum --check "$CHECKSUM"');
  expect(publishCommands).toContain("git/matching-refs/tags/$TAG");
  expect(publishCommands).not.toContain("aapt2");
  expect(publishCommands).not.toContain("apksigner");
  expect(jobs.publish?.steps?.every((step) => step.uses === undefined)).toBe(true);

  const tokenSteps = allSteps.filter((step) => step.env && "GH_TOKEN" in step.env);
  expect(tokenSteps).toHaveLength(2);
  expect(tokenSteps.every((step) => step.env?.GH_TOKEN === "${{ github.token }}")).toBe(true);
};

const unsafePhoneReleaseMutations = [
  ["main branch", (source: string) => source.replace("branches: [main]", "branches: [develop]")],
  [
    "main guard",
    (source: string) =>
      source.replaceAll(
        "if: github.repository == 'cha1latte/ReadAny' && github.ref == 'refs/heads/main'",
        "if: always()",
      ),
  ],
  [
    "repository assertion",
    (source: string) =>
      source.replaceAll('test "$GITHUB_REPOSITORY" = "cha1latte/ReadAny"', "true"),
  ],
  [
    "serialization",
    (source: string) => source.replace("cancel-in-progress: false", "cancel-in-progress: true"),
  ],
  [
    "Node runtime",
    (source: string) => source.replaceAll("node-version: 24.15.0", "node-version: 20.18.0"),
  ],
  ["pagination", (source: string) => source.replace(" --paginate", "")],
  ["prerelease flag", (source: string) => source.replace("      --prerelease", "")],
  [
    "package assertion",
    (source: string) =>
      source.replaceAll(
        'test "$PACKAGE" = "io.github.cha1latte.readanyshlai.preview"',
        'test -n "$PACKAGE"',
      ),
  ],
  [
    "version-code assertion",
    (source: string) =>
      source.replaceAll('test "$VERSION_CODE" = "$SHLAI_VERSION_CODE"', 'test -n "$VERSION_CODE"'),
  ],
  [
    "certificate digest",
    (source: string) =>
      source.replaceAll(
        "fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c",
        "0000000000000000000000000000000000000000000000000000000000000000",
      ),
  ],
  ["checksum asset", (source: string) => source.replaceAll(".apk.sha256", ".apk.txt")],
  [
    "exact APK name",
    (source: string) => source.replaceAll("ReadAny-Shlai-Preview.apk", "preview.apk"),
  ],
  [
    "job dependency",
    (source: string) => source.replace("needs: [metadata, verify]", "needs: metadata"),
  ],
  [
    "write-token action",
    (source: string) =>
      source.replace(
        "    steps:\n      - name: Verify and publish preview prerelease",
        "    steps:\n      - uses: attacker/publish@main\n      - name: Verify and publish preview prerelease",
      ),
  ],
  [
    "artifact digest binding",
    (source: string) =>
      source.replace('test "$APK_SHA256" = "$EXPECTED_APK_SHA256"', 'test -n "$APK_SHA256"'),
  ],
] as const;

type Workflow = {
  name?: string;
  concurrency?: unknown;
  on?: Record<string, unknown>;
  permissions?: Record<string, unknown>;
  env?: Record<string, unknown>;
  jobs?: Record<string, WorkflowJob>;
};

const hasParsedKey = (value: unknown, keyName: string): boolean => {
  if (Array.isArray(value)) {
    return value.some((item) => hasParsedKey(item, keyName));
  }
  if (!value || typeof value !== "object") {
    return false;
  }
  return Object.entries(value).some(
    ([key, nestedValue]) =>
      key.toLowerCase() === keyName.toLowerCase() || hasParsedKey(nestedValue, keyName),
  );
};

const expectPreviewWorkflowContract = (source: string) => {
  const workflow = parse(source, { version: "1.2" }) as Workflow;
  expect(Object.keys(workflow.on ?? {}).sort()).toEqual(["pull_request", "workflow_dispatch"]);
  expect(workflow.permissions).toEqual({ contents: "read" });

  const jobs = workflow.jobs ?? {};
  expect(Object.keys(jobs)).toEqual(["validate", "preview"]);
  const validate = jobs.validate;
  const preview = jobs.preview;
  expect(validate?.name).toBe("Validate");
  expect(preview?.name).toBe("Preview APK");
  expect(preview?.needs).toBe("validate");

  for (const job of Object.values(jobs)) {
    expect(job.uses).toBeUndefined();
    expect(job.permissions).toBeUndefined();
    expect(job.environment).toBeUndefined();
    const steps = job.steps ?? [];
    for (const [setupNodeIndex, step] of steps.entries()) {
      if (step.uses?.startsWith("actions/setup-node@") && step.with?.cache === "pnpm") {
        const pnpmSetupIndex = steps.findIndex((candidate) =>
          candidate.uses?.startsWith("pnpm/action-setup@"),
        );
        expect(pnpmSetupIndex).toBeGreaterThanOrEqual(0);
        expect(pnpmSetupIndex).toBeLessThan(setupNodeIndex);
      }
    }
  }

  expect(hasParsedKey(workflow, "secrets")).toBe(false);
  expect(JSON.stringify(workflow)).not.toMatch(/secrets(?:\.|\s*\[)/);
  expect(preview?.env).toEqual({
    APP_VARIANT: "preview",
    SHLAI_UPSTREAM_VERSION: "1.3.5",
    SHLAI_REVISION: 0,
    SHLAI_VERSION_CODE: 1,
  });

  const allSteps = Object.values(jobs).flatMap((job) => job.steps ?? []);
  const envMaps = Object.values(jobs).flatMap((job) => [
    job.env,
    ...(job.steps ?? []).map((step) => step.env),
  ]);
  for (const env of envMaps) {
    if (env && "APP_VARIANT" in env) {
      expect(env.APP_VARIANT).toBe("preview");
    }
  }

  const actions = [
    ...Object.values(jobs).map((job) => job.uses),
    ...allSteps.map((step) => step.uses),
  ].filter((action): action is string => typeof action === "string");
  const commands = allSteps
    .map((step) => step.run)
    .filter((command): command is string => typeof command === "string");
  expect(actions.some((action) => /(?:publish|release)/i.test(action))).toBe(false);
  expect(
    commands.some((command) =>
      /(?:\bgh\s+release\b|\b(?:npm|pnpm|yarn)\s+publish\b|\bgradlew(?:\.bat)?\s+publish\b)/i.test(
        command,
      ),
    ),
  ).toBe(false);
  expect(commands.some((command) => /GITHUB_ENV/i.test(command))).toBe(false);
  expect(commands.join("\n")).not.toContain("--platform ios");
  expect(commands.join("\n")).not.toContain("xcodebuild");

  const previewSteps = preview?.steps ?? [];
  expect(previewSteps.map((step) => step.uses)).toContain(actionPins.android);
  const standaloneAutolinkingIndex = previewSteps.findIndex(
    (step) => step.run === configureStandaloneAutolinkingCommand,
  );
  const prebuildIndex = previewSteps.findIndex(
    (step) => step.run?.includes("expo prebuild") === true,
  );
  expect(standaloneAutolinkingIndex).toBeGreaterThanOrEqual(0);
  expect(standaloneAutolinkingIndex).toBeLessThan(prebuildIndex);
  const prebuildCommands = previewSteps
    .map((step) => step.run)
    .filter((command): command is string => command?.includes("expo prebuild") === true);
  expect(prebuildCommands).toEqual([
    "pnpm --filter @readany/app-expo exec expo prebuild --platform android --clean --no-install",
  ]);

  const assembleCommands = previewSteps
    .map((step) => step.run)
    .filter((command): command is string => command?.includes("assemble") === true);
  expect(assembleCommands).toEqual([releaseGradleCommand]);
  const architecture = assembleCommands[0]?.match(/-PreactNativeArchitectures=([^\s]+)/)?.[1];
  expect(architecture).toBe("arm64-v8a");

  const stagePreview = previewSteps.find((step) => step.name === "Stage preview APK");
  expect(stagePreview?.run).toContain("outputs/apk/release/app-release.apk");
  expect(stagePreview?.run).not.toContain("outputs/apk/debug");

  const uploadSteps = previewSteps.filter((step) => step.uses === actionPins.upload);
  expect(uploadSteps).toHaveLength(1);
  expect(uploadSteps[0]?.with?.["retention-days"]).toBe(14);
  expect(uploadSteps[0]?.with?.name).toContain("ReadAny-Shlai-Preview-");
};

const releaseSecretNames = [
  "SHLAI_ANDROID_KEYSTORE_BASE64",
  "SHLAI_ANDROID_KEYSTORE_PASSWORD",
  "SHLAI_ANDROID_KEY_ALIAS",
  "SHLAI_ANDROID_KEY_PASSWORD",
] as const;

const secretsTokenPattern = /\bsecrets\b/gi;

const collectSecretsTokens = (value: unknown): string[] => {
  if (typeof value === "string") {
    return [...value.matchAll(secretsTokenPattern)].map(([match]) => match);
  }
  if (Array.isArray(value)) {
    return value.flatMap(collectSecretsTokens);
  }
  if (!value || typeof value !== "object") {
    return [];
  }
  return Object.entries(value).flatMap(([key, nestedValue]) => [
    ...collectSecretsTokens(key),
    ...collectSecretsTokens(nestedValue),
  ]);
};

const actionPins = {
  checkout: "actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683",
  pnpm: "pnpm/action-setup@a3252b78c470c02df07e9d59298aecedc3ccdd6d",
  node: "actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020",
  java: "actions/setup-java@c5195efecf7bdfc987ee8bae7a71cb8b11521c00",
  android: "android-actions/setup-android@9fc6c4e9069bf8d3d10b2204b1fb8f6ef7065407",
  upload: "actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02",
  download: "actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093",
} as const;

const actionVersionComments = {
  checkout: "v4.2.2",
  pnpm: "v3.0.0",
  node: "v4.4.0",
  java: "v4.7.1",
  android: "v3.2.2",
  upload: "v4.6.2",
  download: "v4.3.0",
} as const;

const androidBuildToolsVersion = "36.0.0";
const configureStandaloneAutolinkingCommand =
  "node packages/app-expo/scripts/configure-standalone-autolinking.js packages/app-expo/package.json";
const releaseGradleCommand =
  './gradlew --no-daemon -Dorg.gradle.jvmargs="-Xmx4g -XX:MaxMetaspaceSize=1g" assembleRelease -PreactNativeArchitectures=arm64-v8a';

const unsignedBuildScript = `set -euo pipefail

node packages/app-expo/scripts/remove-release-debug-signing.js packages/app-expo/android/app/build.gradle
cd packages/app-expo/android
${releaseGradleCommand}
cd ../../..

UNSIGNED_APK="packages/app-expo/android/app/build/outputs/apk/release/app-release-unsigned.apk"
test -f "\$UNSIGNED_APK"
BUILD_TOOLS="\$ANDROID_HOME/build-tools/${androidBuildToolsVersion}"
if "\$BUILD_TOOLS/apksigner" verify "\$UNSIGNED_APK" >/dev/null 2>&1; then
  echo "Expected an unsigned release APK, but signature verification succeeded." >&2
  exit 1
fi`;

const signAndPublishScript = `set -euo pipefail

TAG="shlai-v\${SHLAI_UPSTREAM_VERSION}.\${SHLAI_REVISION}"
UNSIGNED_APK="\$RUNNER_TEMP/unsigned/app-release-unsigned.apk"
ALIGNED_APK="\$RUNNER_TEMP/ReadAny-Shlai-aligned.apk"
APK="ReadAny-Shlai.apk"
KEYSTORE="\$RUNNER_TEMP/readany-shlai-release.jks"
BUILD_TOOLS="\$ANDROID_HOME/build-tools/${androidBuildToolsVersion}"
ZIPALIGN="\$BUILD_TOOLS/zipalign"
APKSIGNER="\$BUILD_TOOLS/apksigner"
trap 'rm -f "\$KEYSTORE"' EXIT

test "\$GITHUB_REF" = "refs/heads/main"
test -f "\$UNSIGNED_APK"
EXPECTED_CERT_SHA256="\$(printf '%s' "\$SHLAI_ANDROID_CERT_SHA256" | tr -d ':' | tr '[:lower:]' '[:upper:]')"
if [[ ! "\$EXPECTED_CERT_SHA256" =~ ^[0-9A-F]{64}$ ]]; then
  echo "SHLAI_ANDROID_CERT_SHA256 must normalize to exactly 64 hexadecimal characters." >&2
  exit 1
fi
EXACT_TAG_COUNT="\$(gh api "repos/\$GITHUB_REPOSITORY/git/matching-refs/tags/\$TAG" --jq "[.[] | select(.ref == \\\"refs/tags/\$TAG\\\")] | length")"
if [[ "\$EXACT_TAG_COUNT" != "0" ]]; then
  echo "Tag already exists: \$TAG" >&2
  exit 1
fi

printf '%s' "\$SHLAI_ANDROID_KEYSTORE_BASE64" | base64 --decode > "\$KEYSTORE"
if "\$ZIPALIGN" -c -P 16 -v 4 "\$UNSIGNED_APK" >/dev/null; then
  cp "\$UNSIGNED_APK" "\$ALIGNED_APK"
else
  "\$ZIPALIGN" -P 16 -f -v 4 "\$UNSIGNED_APK" "\$ALIGNED_APK"
fi
"\$APKSIGNER" sign \\
  --ks "\$KEYSTORE" \\
  --ks-key-alias "\$SHLAI_ANDROID_KEY_ALIAS" \\
  --ks-pass env:SHLAI_ANDROID_KEYSTORE_PASSWORD \\
  --key-pass env:SHLAI_ANDROID_KEY_PASSWORD \\
  --out "\$APK" \\
  "\$ALIGNED_APK"
CERT_OUTPUT="\$("\$APKSIGNER" verify --print-certs "\$APK")"
mapfile -t ACTUAL_CERT_DIGESTS < <(printf '%s\\n' "\$CERT_OUTPUT" | sed -n 's/^Signer #[0-9][0-9]* certificate SHA-256 digest: //p')
if (( \${#ACTUAL_CERT_DIGESTS[@]} != 1 )); then
  echo "Expected exactly one APK signer certificate SHA-256 digest." >&2
  exit 1
fi
ACTUAL_CERT_SHA256="\$(printf '%s' "\${ACTUAL_CERT_DIGESTS[0]}" | tr -d ':' | tr '[:lower:]' '[:upper:]')"
if [[ ! "\$ACTUAL_CERT_SHA256" =~ ^[0-9A-F]{64}$ || "\$ACTUAL_CERT_SHA256" != "\$EXPECTED_CERT_SHA256" ]]; then
  echo "Signed APK certificate SHA-256 digest does not match SHLAI_ANDROID_CERT_SHA256." >&2
  exit 1
fi
"\$APKSIGNER" verify --verbose --print-certs "\$APK"
RELEASE_NOTES="\$(printf 'Unofficial ReadAny Shlai Android release. Source: %s/%s/tree/%s\\n\\nAndroid versionCode: %s' "\$GITHUB_SERVER_URL" "\$GITHUB_REPOSITORY" "\$GITHUB_SHA" "\$SHLAI_VERSION_CODE")"
gh release create "\$TAG" "\$APK" \\
  --repo "\$GITHUB_REPOSITORY" \\
  --target "\$GITHUB_SHA" \\
  --title "ReadAny Shlai \${SHLAI_UPSTREAM_VERSION}.\${SHLAI_REVISION}" \\
  --notes "\$RELEASE_NOTES"`;

const expectedValidateSteps: WorkflowStep[] = [
  { uses: actionPins.checkout, with: { "fetch-depth": 0 } },
  { uses: actionPins.pnpm, with: { version: "9.15.0" } },
  { uses: actionPins.node, with: { "node-version": "20.18.0", cache: "pnpm" } },
  { run: "pnpm install --frozen-lockfile" },
  { run: "pnpm --filter @readany/core test" },
  { run: "pnpm --filter @readany/app-expo test" },
  { run: "pnpm exec tsc --noEmit -p packages/app-expo/tsconfig.json" },
  {
    name: "Check changed files with Biome",
    shell: "bash",
    run: `BASE_SHA="$(git rev-parse HEAD^)"
mapfile -t FILES < <(git diff --name-only --diff-filter=ACMR "$BASE_SHA" HEAD -- '*.js' '*.jsx' '*.ts' '*.tsx' '*.json' '*.css')
if (( \${#FILES[@]} > 0 )); then
  pnpm exec biome check --no-errors-on-unmatched "\${FILES[@]}"
fi
git diff --check "$BASE_SHA" HEAD\n`,
  },
];

const expectedBuildSteps: WorkflowStep[] = [
  { uses: actionPins.checkout },
  { uses: actionPins.pnpm, with: { version: "9.15.0" } },
  { uses: actionPins.node, with: { "node-version": "20.18.0", cache: "pnpm" } },
  { uses: actionPins.java, with: { distribution: "temurin", "java-version": 17 } },
  { uses: actionPins.android },
  {
    name: `Install Android build tools ${androidBuildToolsVersion}`,
    run: `sdkmanager "build-tools;${androidBuildToolsVersion}"`,
  },
  { run: "pnpm install --frozen-lockfile" },
  { run: "pnpm --filter @readany/app-expo run build:reader" },
  { run: configureStandaloneAutolinkingCommand },
  {
    run: "pnpm --filter @readany/app-expo exec expo prebuild --platform android --clean --no-install",
  },
  { name: "Build verified unsigned release APK", shell: "bash", run: `${unsignedBuildScript}\n` },
  {
    uses: actionPins.upload,
    with: {
      name: "readany-shlai-unsigned-${{ github.sha }}",
      path: "packages/app-expo/android/app/build/outputs/apk/release/app-release-unsigned.apk",
      "if-no-files-found": "error",
      "retention-days": 1,
    },
  },
];

const expectedSignSteps: WorkflowStep[] = [
  { uses: actionPins.android },
  {
    name: `Install Android build tools ${androidBuildToolsVersion}`,
    run: `sdkmanager "build-tools;${androidBuildToolsVersion}"`,
  },
  {
    uses: actionPins.download,
    with: {
      name: "readany-shlai-unsigned-${{ github.sha }}",
      path: "${{ runner.temp }}/unsigned",
    },
  },
  {
    name: "Sign, verify, and publish APK",
    shell: "bash",
    env: {
      GH_TOKEN: "${{ github.token }}",
      SHLAI_UPSTREAM_VERSION: "${{ inputs.upstream_version }}",
      SHLAI_REVISION: "${{ inputs.revision }}",
      SHLAI_VERSION_CODE: "${{ inputs.version_code }}",
      SHLAI_ANDROID_CERT_SHA256: "${{ vars.SHLAI_ANDROID_CERT_SHA256 }}",
      ...Object.fromEntries(releaseSecretNames.map((name) => [name, `\${{ secrets.${name} }}`])),
    },
    run: `${signAndPublishScript}\n`,
  },
];

const upstreamSyncScript = `git fetch origin main
git fetch https://github.com/codedogQBY/ReadAny.git main:refs/remotes/upstream/main

if git merge-base --is-ancestor upstream/main origin/main; then
  echo "Fork already contains upstream main."
  exit 0
fi

OPEN_COUNT="$(gh pr list --repo "$GITHUB_REPOSITORY" --state open --search 'in:title "Sync official ReadAny upstream"' --json number --jq 'length')"
if [[ "$OPEN_COUNT" != "0" ]]; then
  echo "An upstream sync PR is already open."
  exit 0
fi

BRANCH="sync/upstream-$(date -u +%Y-%m-%d)"
UPSTREAM_SHA="$(git rev-parse upstream/main)"
if git ls-remote --exit-code --heads origin "$BRANCH" >/dev/null 2>&1; then
  REMOTE_SHA="$(git ls-remote --heads origin "$BRANCH" | awk '{print $1}')"
  if [[ -z "$REMOTE_SHA" ]]; then
    echo "Existing sync branch could not be resolved: $BRANCH" >&2
    exit 1
  fi
  if [[ "$REMOTE_SHA" != "$UPSTREAM_SHA" ]]; then
    echo "Existing sync branch does not match upstream main: $BRANCH" >&2
    exit 1
  fi
  echo "Reusing existing sync branch: $BRANCH"
else
  git switch --create "$BRANCH" upstream/main
  git push origin "$BRANCH"
fi

gh pr create \\
  --repo "$GITHUB_REPOSITORY" \\
  --base main \\
  --head "$BRANCH" \\
  --title "Sync official ReadAny upstream $(date -u +%Y-%m-%d)" \\
  --body "Brings the latest codedogQBY/ReadAny main into ReadAny Shlai. This PR is never auto-merged; resolve conflicts and verify the preview APK before approval."
`;

const expectedUpstreamSyncSteps: WorkflowStep[] = [
  { uses: actionPins.checkout, with: { "fetch-depth": 0 } },
  {
    name: "Create sync branch and PR",
    env: { GH_TOKEN: "${{ github.token }}" },
    shell: "bash",
    run: upstreamSyncScript,
  },
];

const expectUpstreamSyncWorkflowContract = (source: string) => {
  const workflow = parse(source, { version: "1.2" }) as Workflow;
  expect(Object.keys(workflow).sort()).toEqual([
    "concurrency",
    "jobs",
    "name",
    "on",
    "permissions",
  ]);
  expect(workflow.name).toBe("Shlai Upstream Sync");
  expect(workflow.concurrency).toEqual({
    group: "shlai-upstream-sync",
    "cancel-in-progress": false,
  });
  expect(workflow.on).toEqual({
    schedule: [{ cron: "17 13 * * 1" }],
    workflow_dispatch: null,
  });
  expect(workflow.permissions).toEqual({ contents: "write", "pull-requests": "write" });
  expect(workflow.env).toBeUndefined();
  expect(hasParsedKey(workflow, "secrets")).toBe(false);
  expect(JSON.stringify(workflow)).not.toMatch(/\bsecrets\b/i);

  const jobs = workflow.jobs ?? {};
  expect(Object.keys(jobs)).toEqual(["sync"]);
  const sync = jobs.sync;
  expect(Object.keys(sync ?? {}).sort()).toEqual(["name", "runs-on", "steps"]);
  expect(sync?.name).toBe("Open upstream sync PR");
  expect(sync?.["runs-on"]).toBe("ubuntu-22.04");
  expect(sync?.if).toBeUndefined();
  expect(sync?.["continue-on-error"]).toBeUndefined();
  expect(sync?.permissions).toBeUndefined();
  expect(sync?.environment).toBeUndefined();
  expect(sync?.env).toBeUndefined();
  expect(sync?.uses).toBeUndefined();
  expect(sync?.steps).toEqual(expectedUpstreamSyncSteps);

  const syncScript = sync?.steps?.[1]?.run;
  expect(syncScript).toContain(
    'REMOTE_SHA="$(git ls-remote --heads origin "$BRANCH" | awk \'{print $1}\')"',
  );
  expect(syncScript).toContain('UPSTREAM_SHA="$(git rev-parse upstream/main)"');
  expect(syncScript?.indexOf("REMOTE_SHA=")).toBeLessThan(
    syncScript?.indexOf("gh pr create") ?? -1,
  );
  expect(syncScript).toContain('[[ "$REMOTE_SHA" != "$UPSTREAM_SHA" ]]');

  for (const step of sync?.steps ?? []) {
    expect(step.if).toBeUndefined();
    expect(step["continue-on-error"]).toBeUndefined();
  }
  expect(source).not.toMatch(/\bgh\s+pr\s+merge\b|--auto\b|\bgit\s+merge\s+upstream\b/i);
};

const unsafeUpstreamSyncMutations = [
  {
    name: "wrong workflow name",
    mutate: (source: string) => source.replace("name: Shlai Upstream Sync", "name: Unsafe sync"),
  },
  {
    name: "missing fixed concurrency group",
    mutate: (source: string) =>
      source.replace(
        "concurrency:\n  group: shlai-upstream-sync\n  cancel-in-progress: false\n\n",
        "",
      ),
  },
  {
    name: "cancels an in-progress sync",
    mutate: (source: string) =>
      source.replace("cancel-in-progress: false", "cancel-in-progress: true"),
  },
  {
    name: "extra push trigger",
    mutate: (source: string) =>
      source.replace("  workflow_dispatch:\n", "  workflow_dispatch:\n  push:\n"),
  },
  {
    name: "wrong schedule",
    mutate: (source: string) => source.replace("17 13 * * 1", "0 0 * * *"),
  },
  {
    name: "extra permission",
    mutate: (source: string) =>
      source.replace("  pull-requests: write", "  pull-requests: write\n  issues: write"),
  },
  {
    name: "job permission override",
    mutate: (source: string) =>
      source.replace(
        "    runs-on: ubuntu-22.04",
        "    runs-on: ubuntu-22.04\n    permissions: write-all",
      ),
  },
  {
    name: "self-hosted runner",
    mutate: (source: string) => source.replace("runs-on: ubuntu-22.04", "runs-on: self-hosted"),
  },
  {
    name: "extra execution default",
    mutate: (source: string) =>
      source.replace("permissions:\n", "defaults:\n  run:\n    shell: bash\n\npermissions:\n"),
  },
  {
    name: "extra step",
    mutate: (source: string) =>
      source.replace(
        "      - name: Create sync branch and PR",
        "      - run: echo unsafe\n      - name: Create sync branch and PR",
      ),
  },
  {
    name: "secret context",
    mutate: (source: string) =>
      source.replace(
        "        env:\n          GH_TOKEN: ${{ github.token }}",
        "        env:\n          GH_TOKEN: ${{ secrets.UNRELATED_TOKEN }}",
      ),
  },
  {
    name: "automatic merge",
    mutate: (source: string) =>
      source.replace("gh pr create", "gh pr merge --auto\n          gh pr create"),
  },
  {
    name: "branches from fork main",
    mutate: (source: string) =>
      source.replace(
        'git switch --create "$BRANCH" upstream/main',
        'git switch --create "$BRANCH" origin/main',
      ),
  },
  {
    name: "exits when a dated sync branch already exists",
    mutate: (source: string) =>
      source.replace(
        'echo "Reusing existing sync branch: $BRANCH"',
        'echo "Sync branch already exists: $BRANCH"\n            exit 0',
      ),
  },
  {
    name: "reuses an existing branch without verifying its upstream provenance",
    mutate: (source: string) =>
      source.replace("            REMOTE_SHA=", "            UNVERIFIED_REMOTE_SHA="),
  },
  {
    name: "creates PR before branch push",
    mutate: (source: string) =>
      source.replace(
        'git push origin "$BRANCH"\n          fi\n\n          gh pr create',
        'gh pr create\n          git push origin "$BRANCH"\n          fi',
      ),
  },
] as const;

const expectReleaseWorkflowContract = (source: string) => {
  const workflow = parse(source, { version: "1.2" }) as Workflow;
  expect(Object.keys(workflow).sort()).toEqual([
    "concurrency",
    "jobs",
    "name",
    "on",
    "permissions",
  ]);
  expect(workflow.name).toBe("Release ReadAny Shlai");
  expect(Object.keys(workflow.on ?? {})).toEqual(["workflow_dispatch"]);
  expect(workflow.permissions).toEqual({ contents: "read" });
  expect(workflow.concurrency).toEqual({
    group: "shlai-stable-release",
    "cancel-in-progress": false,
  });

  const inputs = workflow.on?.workflow_dispatch as { inputs?: Record<string, unknown> };
  expect(inputs.inputs).toEqual({
    upstream_version: {
      description: "Official ReadAny version",
      required: true,
      type: "string",
      default: "1.3.5",
    },
    revision: { description: "Shlai revision", required: true, type: "string", default: "1" },
    version_code: {
      description: "Android version code",
      required: true,
      type: "string",
      default: "1",
    },
  });

  const jobs = workflow.jobs ?? {};
  expect(Object.keys(jobs)).toEqual(["validate", "build", "sign"]);
  const validate = jobs.validate;
  const build = jobs.build;
  const sign = jobs.sign;
  expect(Object.keys(validate ?? {}).sort()).toEqual(["name", "runs-on", "steps"]);
  expect(Object.keys(build ?? {}).sort()).toEqual(["env", "name", "needs", "runs-on", "steps"]);
  expect(Object.keys(sign ?? {}).sort()).toEqual([
    "environment",
    "if",
    "name",
    "needs",
    "permissions",
    "runs-on",
    "steps",
  ]);
  expect(validate?.name).toBe("Validate");
  expect(validate?.["runs-on"]).toBe("ubuntu-22.04");
  expect(build?.name).toBe("Build unsigned production APK");
  expect(build?.needs).toBe("validate");
  expect(build?.["runs-on"]).toBe("ubuntu-22.04");
  expect(sign?.name).toBe("Sign and publish ReadAny Shlai");
  expect(sign?.needs).toBe("build");
  expect(sign?.["runs-on"]).toBe("ubuntu-22.04");
  expect(sign?.if).toBe("github.ref == 'refs/heads/main'");
  expect(validate?.["continue-on-error"]).toBeUndefined();
  expect(build?.["continue-on-error"]).toBeUndefined();
  expect(sign?.["continue-on-error"]).toBeUndefined();
  expect(validate?.permissions).toBeUndefined();
  expect(validate?.environment).toBeUndefined();
  expect(build?.permissions).toBeUndefined();
  expect(build?.environment).toBeUndefined();
  const validationStep = validate?.steps?.[0];
  expect(validationStep?.name).toBe("Validate release request");
  expect(validationStep?.shell).toBe("bash");
  expect(validationStep?.env).toEqual({
    GH_TOKEN: "${{ github.token }}",
    INPUT_UPSTREAM_VERSION: "${{ inputs.upstream_version }}",
    INPUT_REVISION: "${{ inputs.revision }}",
    INPUT_VERSION_CODE: "${{ inputs.version_code }}",
  });
  const validationScript = validationStep?.run ?? "";
  expect(validationScript).toContain("set -euo pipefail");
  expect(validationScript).toContain('[[ "$GITHUB_REF" != "refs/heads/main" ]]');
  expect(validationScript).toContain(
    '[[ ! "$INPUT_UPSTREAM_VERSION" =~ ^(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)$ ]]',
  );
  expect(validationScript).toContain('[[ ! "$INPUT_REVISION" =~ ^[1-9][0-9]*$ ]]');
  expect(validationScript).toContain('[[ ! "$INPUT_VERSION_CODE" =~ ^[1-9][0-9]*$ ]]');
  expect(validationScript).toContain("9007199254740991");
  expect(validationScript).toContain(
    'if (( ${#INPUT_VERSION_CODE} > 10 )) || { (( ${#INPUT_VERSION_CODE} == 10 )) && [[ "$INPUT_VERSION_CODE" > "2100000000" ]]; }; then',
  );
  expect(validationScript).not.toContain('INPUT_UPSTREAM_VERSION="');
  expect(validationScript).toContain("decimal_gt()");
  expect(validationScript).toContain("tuple_gt()");
  expect(validationScript).toContain(
    'gh api --paginate "repos/$GITHUB_REPOSITORY/releases?per_page=100" --slurp',
  );
  expect(validationScript).toContain(
    'RELEASES_JSON="$(gh api --paginate "repos/$GITHUB_REPOSITORY/releases?per_page=100" --slurp)"',
  );
  expect(validationScript).not.toMatch(/gh api[^\n]+\|\|\s*true|gh api[^\n]+\|\|\s*echo/);
  expect(validationScript).toContain("select(.draft == false and .prerelease == false)");
  expect(validationScript).toContain(
    '[[ ! "$release_tag" =~ ^shlai-v(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.([1-9][0-9]*)$ ]]',
  );
  expect(validationScript).toContain('if [[ -z "$PRIOR_TAG" ]] || tuple_gt');
  expect(validationScript).toContain("if ! tuple_gt \\\n");
  expect(validationScript).toContain("must be newer than prior stable release");
  expect(validationScript).toContain("grep '^Android versionCode:'");
  expect(validationScript).toContain(
    'if [[ "${PRIOR_VERSION_CODE_LINES[0]}" =~ ^Android\\ versionCode:\\ ([1-9][0-9]*)$ ]]; then',
  );
  expect(validationScript).toContain('PRIOR_VERSION_CODE="${BASH_REMATCH[1]}"');
  expect(validationScript).toContain('if ! decimal_gt "$INPUT_VERSION_CODE" "$PRIOR_VERSION_CODE"');
  expect(validationScript).toContain("must exceed prior Android versionCode");
  expect(validate?.steps?.slice(1)).toEqual(expectedValidateSteps);
  expect(build?.steps).toEqual(expectedBuildSteps);
  expect(collectSecretsTokens(validate)).toEqual([]);
  expect(collectSecretsTokens(build)).toEqual([]);
  expect(JSON.stringify(build)).not.toMatch(
    /android\.injected\.signing|SHLAI_ANDROID_KEY|apksigner\s+sign/i,
  );
  for (const step of [...(validate?.steps ?? []), ...(build?.steps ?? [])]) {
    expect(step.if).toBeUndefined();
    expect(step["continue-on-error"] ?? false).toBe(false);
  }

  expect(build?.env).toEqual({
    APP_VARIANT: "production",
    SHLAI_UPSTREAM_VERSION: "${{ inputs.upstream_version }}",
    SHLAI_REVISION: "${{ inputs.revision }}",
    SHLAI_VERSION_CODE: "${{ inputs.version_code }}",
  });

  expect(sign?.permissions).toEqual({ contents: "write" });
  expect(sign?.environment).toBe("shlai-production");
  expect(sign?.env).toBeUndefined();
  expect(sign?.steps).toEqual(expectedSignSteps);
  const finalStep = sign?.steps?.at(-1);
  expect(finalStep?.env).toEqual(expectedSignSteps.at(-1)?.env);
  expect(finalStep?.env?.SHLAI_UPSTREAM_VERSION).toBe(build?.env?.SHLAI_UPSTREAM_VERSION);
  expect(finalStep?.env?.SHLAI_REVISION).toBe(build?.env?.SHLAI_REVISION);
  expect(signAndPublishScript).toContain(
    'TAG="shlai-v${SHLAI_UPSTREAM_VERSION}.${SHLAI_REVISION}"',
  );
  expect(collectSecretsTokens(finalStep?.env)).toEqual(releaseSecretNames.map(() => "secrets"));
  expect(collectSecretsTokens({ ...finalStep, env: undefined })).toEqual([]);
  expect(collectSecretsTokens(sign?.steps?.slice(0, -1))).toEqual([]);
  expect(
    collectSecretsTokens({
      ...workflow,
      jobs: {
        ...jobs,
        sign: {
          ...sign,
          steps: [...(sign?.steps?.slice(0, -1) ?? []), { ...finalStep, env: undefined }],
        },
      },
    }),
  ).toEqual([]);

  const signActions = sign?.steps?.flatMap((step) => (step.uses ? [step.uses] : []));
  expect(signActions).toEqual([actionPins.android, actionPins.download]);
  expect(signAndPublishScript).not.toMatch(/pnpm|expo|gradle|packages\/app-expo|actions\//i);
  expect(signAndPublishScript.match(/gh release create/g)).toHaveLength(1);
  expect(
    signAndPublishScript.indexOf('"$APKSIGNER" verify --verbose --print-certs "$APK"'),
  ).toBeLessThan(signAndPublishScript.indexOf('gh release create "$TAG" "$APK"'));
  expect(signAndPublishScript).toContain("--ks-pass env:SHLAI_ANDROID_KEYSTORE_PASSWORD");
  expect(signAndPublishScript).toContain("--key-pass env:SHLAI_ANDROID_KEY_PASSWORD");
  expect(signAndPublishScript).toContain(
    'gh api "repos/$GITHUB_REPOSITORY/git/matching-refs/tags/$TAG"',
  );
  expect(signAndPublishScript).not.toContain("gh release view");
  expect(signAndPublishScript.indexOf("EXACT_TAG_COUNT=")).toBeLessThan(
    signAndPublishScript.indexOf('gh release create "$TAG" "$APK"'),
  );
  expect(signAndPublishScript).toContain(
    'EXPECTED_CERT_SHA256="$(printf \'%s\' "$SHLAI_ANDROID_CERT_SHA256"',
  );
  expect(signAndPublishScript).toContain('"$ACTUAL_CERT_SHA256" != "$EXPECTED_CERT_SHA256"');
  expect(signAndPublishScript.indexOf("ACTUAL_CERT_SHA256=")).toBeLessThan(
    signAndPublishScript.indexOf('"$APKSIGNER" verify --verbose --print-certs "$APK"'),
  );
  expect(unsignedBuildScript).toContain(
    `BUILD_TOOLS="$ANDROID_HOME/build-tools/${androidBuildToolsVersion}"`,
  );
  expect(signAndPublishScript).toContain(
    `BUILD_TOOLS="$ANDROID_HOME/build-tools/${androidBuildToolsVersion}"`,
  );
  expect(`${unsignedBuildScript}\n${signAndPublishScript}`).not.toContain(
    'find "$ANDROID_HOME/build-tools"',
  );

  const uses = Object.values(jobs).flatMap((job) =>
    (job.steps ?? []).flatMap((step) => (step.uses ? [step.uses] : [])),
  );
  expect(uses).toEqual([
    actionPins.checkout,
    actionPins.pnpm,
    actionPins.node,
    actionPins.checkout,
    actionPins.pnpm,
    actionPins.node,
    actionPins.java,
    actionPins.android,
    actionPins.upload,
    actionPins.android,
    actionPins.download,
  ]);
  for (const action of uses) {
    expect(action).toMatch(/^[\w-]+\/[\w-]+@[a-f0-9]{40}$/);
  }
  for (const [key, pin] of Object.entries(actionPins)) {
    expect(source).toContain(
      `${pin} # ${actionVersionComments[key as keyof typeof actionVersionComments]}`,
    );
  }
};

const addWrongCacheOrderJob = (source: string, jobId: string) =>
  source.replace(
    "  preview:\n",
    `  ${jobId}:\n    runs-on: ubuntu-22.04\n    steps:\n      - uses: actions/setup-node@v4\n        with:\n          cache: pnpm\n      - uses: pnpm/action-setup@v3\n\n  preview:\n`,
  );

const unsafeMutations = [
  {
    name: "unpinned reusable job action",
    mutate: (source: string) =>
      source.replace("jobs:\n", "jobs:\n  attacker:\n    uses: attacker/reusable@main\n\n"),
  },
  {
    name: "pull_request_target trigger",
    mutate: (source: string) => source.replace("  pull_request:\n", "  pull_request_target:\n"),
  },
  {
    name: "missing workflow_dispatch trigger",
    mutate: (source: string) => source.replace("  workflow_dispatch:\n", ""),
  },
  {
    name: "push trigger",
    mutate: (source: string) =>
      source.replace("  workflow_dispatch:\n", "  workflow_dispatch:\n  push:\n"),
  },
  {
    name: "additional schedule trigger",
    mutate: (source: string) =>
      source.replace(
        "  workflow_dispatch:\n",
        '  workflow_dispatch:\n  schedule:\n    - cron: "0 0 * * *"\n',
      ),
  },
  {
    name: "contents write permission",
    mutate: (source: string) => source.replace("contents: read", "contents: write"),
  },
  {
    name: "additional write permission",
    mutate: (source: string) => source.replace("contents: read", "contents: read\n  issues: write"),
  },
  {
    name: "additional read permission",
    mutate: (source: string) => source.replace("contents: read", "contents: read\n  actions: read"),
  },
  {
    name: "job write-all permission",
    mutate: (source: string) =>
      source.replace("    needs: validate\n", "    needs: validate\n    permissions: write-all\n"),
  },
  {
    name: "bracket secret reference",
    mutate: (source: string) =>
      source.replace(
        "      APP_VARIANT: preview",
        "      APP_VARIANT: preview\n      RELEASE_TOKEN: $" + "{{ secrets['RELEASE_TOKEN'] }}",
      ),
  },
  {
    name: "reusable job secrets inherit",
    mutate: (source: string) =>
      source.replace(
        "  preview:\n",
        "  helper_job:\n    uses: ./.github/workflows/helper.yml\n    secrets: inherit\n\n  preview:\n",
      ),
  },
  {
    name: "protected environment",
    mutate: (source: string) =>
      source.replace(
        "    runs-on: ubuntu-22.04",
        "    runs-on: ubuntu-22.04\n    environment: preview",
      ),
  },
  {
    name: "mixed-architecture APK",
    mutate: (source: string) => source.replace("arm64-v8a", "arm64-v8a,x86_64"),
  },
  {
    name: "iOS build operation",
    mutate: (source: string) =>
      source.replace(
        "      - name: Build preview APK",
        "      - run: xcodebuild\n      - name: Build preview APK",
      ),
  },
  {
    name: "release APK operation",
    mutate: (source: string) =>
      source.replace(
        "      - name: Build preview APK",
        "      - run: ./gradlew assembleRelease\n      - name: Build preview APK",
      ),
  },
  {
    name: "GitHub release publish",
    mutate: (source: string) =>
      source.replace(
        "      - name: Build preview APK",
        "      - run: gh release create preview\n      - name: Build preview APK",
      ),
  },
  {
    name: "release workflow invocation",
    mutate: (source: string) =>
      source.replace(
        "  preview:\n",
        "  release:\n    uses: ./.github/workflows/release.yml\n\n  preview:\n",
      ),
  },
  {
    name: "release action",
    mutate: (source: string) =>
      source.replace(
        "      - name: Build preview APK",
        "      - uses: softprops/action-gh-release@v2\n      - name: Build preview APK",
      ),
  },
  {
    name: "job production variant",
    mutate: (source: string) =>
      source.replace(
        "  validate:\n    name: Validate",
        "  validate:\n    name: Validate\n    env:\n      APP_VARIANT: production",
      ),
  },
  {
    name: "step production variant",
    mutate: (source: string) =>
      source.replace(
        "      - name: Build preview APK",
        "      - name: Unsafe production step\n        env:\n          APP_VARIANT: production\n        run: echo unsafe\n      - name: Build preview APK",
      ),
  },
  {
    name: "GITHUB_ENV production override",
    mutate: (source: string) =>
      source.replace(
        "      - name: Build preview APK",
        '      - run: echo "APP_VARIANT=production" >> "$GITHUB_ENV"\n      - name: Build preview APK',
      ),
  },
  {
    name: "PowerShell GITHUB_ENV production override",
    mutate: (source: string) =>
      source.replace(
        "      - name: Build preview APK",
        '      - shell: pwsh\n        run: Add-Content -Path $env:GITHUB_ENV -Value "APP_VARIANT=production"\n      - name: Build preview APK',
      ),
  },
  {
    name: "extra preview environment variable",
    mutate: (source: string) =>
      source.replace(
        "      SHLAI_VERSION_CODE: 1",
        "      SHLAI_VERSION_CODE: 1\n      EXTRA_FLAG: true",
      ),
  },
  {
    name: "unscoped validation dependency",
    mutate: (source: string) =>
      source
        .replace("    needs: validate\n", "    needs: [validate, release]\n")
        .replace(
          "  preview:\n",
          "  release:\n    needs: validate\n    runs-on: ubuntu-22.04\n    steps:\n      - run: echo decoy\n\n  preview:\n",
        ),
  },
  {
    name: "unscoped artifact retention",
    mutate: (source: string) =>
      source
        .replace("          retention-days: 14", "          retention-days: 30")
        .replace(
          "      - run: pnpm install --frozen-lockfile",
          "      - uses: actions/upload-artifact@v4\n        with:\n          name: decoy\n          path: decoy\n          retention-days: 14\n      - run: pnpm install --frozen-lockfile",
        ),
  },
  {
    name: "package publish operation",
    mutate: (source: string) =>
      source.replace(
        "      - name: Build preview APK",
        "      - run: pnpm publish\n      - name: Build preview APK",
      ),
  },
  {
    name: "underscore job with cache before pnpm",
    mutate: (source: string) => addWrongCacheOrderJob(source, "cache_probe"),
  },
  {
    name: "hyphen job with cache before pnpm",
    mutate: (source: string) => addWrongCacheOrderJob(source, "cache-probe"),
  },
] as const;

const unsafeReleaseMutations = [
  {
    name: "self-hosted validation runner",
    mutate: (source: string) =>
      source.replace(
        "  validate:\n    name: Validate\n    runs-on: ubuntu-22.04",
        "  validate:\n    name: Validate\n    runs-on: self-hosted",
      ),
  },
  {
    name: "self-hosted build runner",
    mutate: (source: string) =>
      source.replace(
        "  build:\n    name: Build unsigned production APK\n    needs: validate\n    runs-on: ubuntu-22.04",
        "  build:\n    name: Build unsigned production APK\n    needs: validate\n    runs-on: self-hosted",
      ),
  },
  {
    name: "self-hosted signing runner",
    mutate: (source: string) =>
      source.replace(
        "  sign:\n    name: Sign and publish ReadAny Shlai\n    needs: build\n    if: github.ref == 'refs/heads/main'\n    runs-on: ubuntu-22.04",
        "  sign:\n    name: Sign and publish ReadAny Shlai\n    needs: build\n    if: github.ref == 'refs/heads/main'\n    runs-on: self-hosted",
      ),
  },
  {
    name: "pull request trigger",
    mutate: (source: string) =>
      source.replace("  workflow_dispatch:\n", "  workflow_dispatch:\n  pull_request:\n"),
  },
  {
    name: "top-level write permission",
    mutate: (source: string) => source.replace("contents: read", "contents: write"),
  },
  {
    name: "non-main dispatch guard",
    mutate: (source: string) =>
      source.replace('[[ "$GITHUB_REF" != "refs/heads/main" ]]', '[[ -n "$GITHUB_REF" ]]'),
  },
  {
    name: "missing signing-job main guard",
    mutate: (source: string) => source.replace("    if: github.ref == 'refs/heads/main'\n", ""),
  },
  {
    name: "validation errors are ignored",
    mutate: (source: string) =>
      source.replace(
        "  validate:\n    name: Validate",
        "  validate:\n    name: Validate\n    continue-on-error: true",
      ),
  },
  {
    name: "required validation test errors are ignored",
    mutate: (source: string) =>
      source.replace(
        "      - run: pnpm --filter @readany/core test",
        "      - run: pnpm --filter @readany/core test\n        continue-on-error: true",
      ),
  },
  {
    name: "unsigned build receives a protected environment",
    mutate: (source: string) =>
      source.replace(
        "  build:\n    name: Build unsigned production APK",
        "  build:\n    name: Build unsigned production APK\n    environment: shlai-production",
      ),
  },
  {
    name: "unsigned build receives write permission",
    mutate: (source: string) =>
      source.replace(
        "  build:\n    name: Build unsigned production APK",
        "  build:\n    name: Build unsigned production APK\n    permissions:\n      contents: write",
      ),
  },
  {
    name: "unsigned build receives a secret",
    mutate: (source: string) =>
      source.replace(
        "      APP_VARIANT: production",
        "      APP_VARIANT: production\n      LEAKED_KEY: ${{ secrets.SHLAI_ANDROID_KEY_PASSWORD }}",
      ),
  },
  {
    name: "signing secrets are job-wide",
    mutate: (source: string) =>
      source.replace(
        "    environment: shlai-production",
        "    environment: shlai-production\n    env:\n      SHLAI_ANDROID_KEY_PASSWORD: ${{ secrets.SHLAI_ANDROID_KEY_PASSWORD }}",
      ),
  },
  {
    name: "secret is introduced before the final step",
    mutate: (source: string) =>
      source.replace(
        `      - uses: ${actionPins.download} # ${actionVersionComments.download}`,
        `      - uses: ${actionPins.download} # ${actionVersionComments.download}\n        env:\n          LEAKED_KEY: \${{ secrets.SHLAI_ANDROID_KEY_PASSWORD }}`,
      ),
  },
  {
    name: "unprotected signing environment",
    mutate: (source: string) =>
      source.replace("environment: shlai-production", "environment: preview"),
  },
  {
    name: "signing job lacks write permission",
    mutate: (source: string) => source.replace("    permissions:\n      contents: write\n", ""),
  },
  {
    name: "mutable checkout action",
    mutate: (source: string) =>
      source.replace(`${actionPins.checkout} # v4.2.2`, "actions/checkout@v4"),
  },
  {
    name: "wrong pinned Android action",
    mutate: (source: string) =>
      source.replace(
        actionPins.android,
        "android-actions/setup-android@0000000000000000000000000000000000000000",
      ),
  },
  {
    name: "pin loses its readable version comment",
    mutate: (source: string) =>
      source.replace(`${actionPins.download} # v4.3.0`, actionPins.download),
  },
  {
    name: "release build keeps generated debug signing",
    mutate: (source: string) =>
      source.replace(
        "node packages/app-expo/scripts/remove-release-debug-signing.js packages/app-expo/android/app/build.gradle",
        "true # leave generated debug signing in place",
      ),
  },
  {
    name: "release build injects signing properties",
    mutate: (source: string) =>
      source.replace(
        releaseGradleCommand,
        `${releaseGradleCommand} -Pandroid.injected.signing.store.file=unsafe.jks`,
      ),
  },
  {
    name: "mixed Android architectures",
    mutate: (source: string) => source.replace("arm64-v8a", "arm64-v8a,x86_64"),
  },
  {
    name: "uploads a signed-looking artifact path",
    mutate: (source: string) => source.replaceAll("app-release-unsigned.apk", "app-release.apk"),
  },
  {
    name: "signing job checks out repository code",
    mutate: (source: string) =>
      source.replace(
        `    steps:\n      - uses: ${actionPins.android} # ${actionVersionComments.android}`,
        `    steps:\n      - uses: ${actionPins.checkout} # ${actionVersionComments.checkout}\n      - uses: ${actionPins.android} # ${actionVersionComments.android}`,
      ),
  },
  {
    name: "signing step runs repository package code",
    mutate: (source: string) =>
      source.replace(
        "      - name: Sign, verify, and publish APK\n        shell: bash",
        "      - name: Sign, verify, and publish APK\n        shell: bash\n        run: pnpm test",
      ),
  },
  {
    name: "certificate verification is removed",
    mutate: (source: string) =>
      source.replace(
        '          "$APKSIGNER" verify --verbose --print-certs "$APK"',
        "          true # skip certificate verification",
      ),
  },
  {
    name: "release is published before certificate verification",
    mutate: (source: string) =>
      source.replace(
        '          "$APKSIGNER" verify --verbose --print-certs "$APK"',
        '          gh release create "$TAG" "$APK" \\\n            --repo "$GITHUB_REPOSITORY"\n          "$APKSIGNER" verify --verbose --print-certs "$APK"',
      ),
  },
  {
    name: "duplicate release publication",
    mutate: (source: string) =>
      source.replace(
        '          gh release create "$TAG" "$APK" \\',
        '          gh release create "$TAG" "$APK" \\\n            --repo "$GITHUB_REPOSITORY"\n          gh release create "$TAG" "$APK" \\',
      ),
  },
  {
    name: "mutable action runs after the secret-bearing final step",
    mutate: (source: string) =>
      source.replace(
        '            --notes "$RELEASE_NOTES"',
        '            --notes "$RELEASE_NOTES"\n      - uses: actions/checkout@v4',
      ),
  },
  {
    name: "stable release concurrency is removed",
    mutate: (source: string) =>
      source.replace(
        "concurrency:\n  group: shlai-stable-release\n  cancel-in-progress: false\n\n",
        "",
      ),
  },
  {
    name: "release history pagination is removed",
    mutate: (source: string) => source.replace("gh api --paginate", "gh api"),
  },
  {
    name: "release history API failures are treated as an empty history",
    mutate: (source: string) => source.replace('--slurp)"', "--slurp || printf '[]')\""),
  },
  {
    name: "prereleases are admitted to stable history",
    mutate: (source: string) =>
      source.replace("select(.draft == false and .prerelease == false)", "select(.draft == false)"),
  },
  {
    name: "prior semantic tuple comparison is bypassed",
    mutate: (source: string) =>
      source.replace("          if ! tuple_gt \\", "          if false && tuple_gt \\"),
  },
  {
    name: "prior Android version code comparison is bypassed",
    mutate: (source: string) =>
      source.replace(
        '          if ! decimal_gt "$INPUT_VERSION_CODE" "$PRIOR_VERSION_CODE"; then',
        "          if false; then",
      ),
  },
  {
    name: "upstream version accepts a leading-zero component like 01",
    mutate: (source: string) =>
      source.replace(
        "^(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)$",
        "^[0-9]+\\.[0-9]+\\.[0-9]+$",
      ),
  },
  {
    name: "revision accepts zero",
    mutate: (source: string) =>
      source.replace(
        'if [[ ! "$INPUT_REVISION" =~ ^[1-9][0-9]*$ ]]',
        'if [[ ! "$INPUT_REVISION" =~ ^[0-9]+$ ]]',
      ),
  },
  {
    name: "version code accepts zero",
    mutate: (source: string) =>
      source.replace(
        'if [[ ! "$INPUT_VERSION_CODE" =~ ^[1-9][0-9]*$ ]]',
        'if [[ ! "$INPUT_VERSION_CODE" =~ ^[0-9]+$ ]]',
      ),
  },
  {
    name: "revision accepts Number.MAX_SAFE_INTEGER plus one",
    mutate: (source: string) => source.replace("9007199254740991", "9007199254740992"),
  },
  {
    name: "revision upper bound is omitted",
    mutate: (source: string) =>
      source.replace(
        '          if (( ${#INPUT_REVISION} > 16 )) || { (( ${#INPUT_REVISION} == 16 )) && [[ "$INPUT_REVISION" > "9007199254740991" ]]; }; then\n            echo "Shlai revision exceeds JavaScript\'s maximum safe integer." >&2\n            exit 1\n          fi\n',
        "",
      ),
  },
  {
    name: "Android version code accepts 2100000001",
    mutate: (source: string) => source.replaceAll("2100000000", "2100000001"),
  },
  {
    name: "Android version-code upper bound is omitted",
    mutate: (source: string) =>
      source.replace(
        '          if (( ${#INPUT_VERSION_CODE} > 10 )) || { (( ${#INPUT_VERSION_CODE} == 10 )) && [[ "$INPUT_VERSION_CODE" > "2100000000" ]]; }; then\n            echo "Android version code exceeds 2100000000." >&2\n            exit 1\n          fi\n',
        "",
      ),
  },
  {
    name: "release input whitespace is silently trimmed",
    mutate: (source: string) =>
      source.replace(
        '          if [[ ! "$INPUT_UPSTREAM_VERSION"',
        '          INPUT_UPSTREAM_VERSION="${INPUT_UPSTREAM_VERSION// /}"\n          if [[ ! "$INPUT_UPSTREAM_VERSION"',
      ),
  },
  {
    name: "expected signing certificate variable is missing",
    mutate: (source: string) =>
      source.replace(
        "          SHLAI_ANDROID_CERT_SHA256: ${{ vars.SHLAI_ANDROID_CERT_SHA256 }}\n",
        "",
      ),
  },
  {
    name: "missing expected certificate digest is accepted",
    mutate: (source: string) =>
      source.replace(
        '          if [[ ! "$EXPECTED_CERT_SHA256" =~ ^[0-9A-F]{64}$ ]]; then',
        '          if [[ -n "$EXPECTED_CERT_SHA256" && ! "$EXPECTED_CERT_SHA256" =~ ^[0-9A-F]{64}$ ]]; then',
      ),
  },
  {
    name: "signing certificate mismatch is not rejected",
    mutate: (source: string) =>
      source.replace(' || "$ACTUAL_CERT_SHA256" != "$EXPECTED_CERT_SHA256"', ""),
  },
  {
    name: "certificate digest parsing is removed",
    mutate: (source: string) =>
      source.replace(
        "          mapfile -t ACTUAL_CERT_DIGESTS < <(printf '%s\\n' \"$CERT_OUTPUT\" | sed -n 's/^Signer #[0-9][0-9]* certificate SHA-256 digest: //p')",
        '          ACTUAL_CERT_DIGESTS=("$EXPECTED_CERT_SHA256")',
      ),
  },
  {
    name: "only a pre-existing release is rejected",
    mutate: (source: string) =>
      source.replace(
        '          EXACT_TAG_COUNT="$(gh api "repos/$GITHUB_REPOSITORY/git/matching-refs/tags/$TAG" --jq "[.[] | select(.ref == \\"refs/tags/$TAG\\")] | length")"',
        '          EXACT_TAG_COUNT="$(gh release view "$TAG" --repo "$GITHUB_REPOSITORY" >/dev/null 2>&1 && echo 1 || echo 0)"',
      ),
  },
  {
    name: "tag API failure is converted to no match",
    mutate: (source: string) =>
      source.replace(
        'git/matching-refs/tags/$TAG" --jq "[.[] | select(.ref == \\"refs/tags/$TAG\\")] | length")"',
        'git/matching-refs/tags/$TAG" --jq "[.[] | select(.ref == \\"refs/tags/$TAG\\")] | length" || echo 0)"',
      ),
  },
  {
    name: "tag prefix matches are treated as the exact tag",
    mutate: (source: string) =>
      source.replace('[.[] | select(.ref == \\"refs/tags/$TAG\\")] | length', "length"),
  },
  {
    name: "latest installed Android build tools are selected",
    mutate: (source: string) =>
      source.replace(
        'BUILD_TOOLS="$ANDROID_HOME/build-tools/36.0.0"',
        'BUILD_TOOLS="$(find "$ANDROID_HOME/build-tools" -mindepth 1 -maxdepth 1 -type d | sort -V | tail -1)"',
      ),
  },
  {
    name: "Android build-tools installation is omitted",
    mutate: (source: string) =>
      source.replace(
        '      - name: Install Android build tools 36.0.0\n        run: sdkmanager "build-tools;36.0.0"\n',
        "",
      ),
  },
  {
    name: "Android build-tools installation is mutable",
    mutate: (source: string) =>
      source.replace('sdkmanager "build-tools;36.0.0"', 'sdkmanager "build-tools;latest"'),
  },
] as const;

describe("ReadAny Shlai workflows", () => {
  it("documents the shared Shlai phone update channel", () => {
    const source = readShlaiDoc("phone-updates.md");
    for (const requiredText of [
      "io.github.cha1latte.readanyshlai.preview",
      "https://github.com/cha1latte/ReadAny/releases",
      "shlai-preview-v",
      "ReadAny-Shlai-Preview.apk",
      "ReadAny-Shlai-Preview.apk.sha256",
      'sha256sum --check "ReadAny-Shlai-Preview.apk.sha256"',
      "Android always requires a person to confirm Install",
      "Only a successful build from `cha1latte/ReadAny:main` publishes",
      "Never use a pull-request artifact as Decidetto's permanent installation",
      "Do not uninstall the app before updating",
      "public preview signing certificate",
      "higher Android `versionCode`",
      "Decidetto",
    ]) {
      expect(source).toContain(requiredText);
    }
  });

  it("pins every third-party action in Shlai workflows", () => {
    for (const name of [
      "shlai-pr.yml",
      "shlai-release.yml",
      "shlai-upstream-sync.yml",
      "shlai-phone-release.yml",
    ]) {
      const source = readWorkflow(name);
      const workflow = parse(source, { version: "1.2" }) as Workflow;
      const uses = Object.values(workflow.jobs ?? {}).flatMap((job) =>
        [job.uses, ...(job.steps ?? []).map((step) => step.uses)].filter(
          (action): action is string => typeof action === "string",
        ),
      );

      expect(uses.length).toBeGreaterThan(0);
      expect(uses.every((action) => /^[\w-]+\/[\w-]+@[a-f0-9]{40}$/.test(action))).toBe(true);
      expect(source).not.toMatch(/uses:\s*[^\s]+@v\d/);
    }
  });

  it("fails stable releases closed unless semantic and Android versions increase", () => {
    const source = readWorkflow("shlai-release.yml");
    expect(source).toContain("repos/$GITHUB_REPOSITORY/releases?per_page=100");
    expect(source).toContain("--paginate");
    expect(source).toContain("^shlai-v");
    expect(source).toContain("Android versionCode:");
    expect(source).toContain("tuple_gt");
    expect(source).toContain("decimal_gt");
    expect(source).toContain("No prior stable Shlai release found");
    expect(source).toContain("must be newer than prior stable release");
    expect(source).toContain("must exceed prior Android versionCode");
    expect(source).toContain("SHLAI_VERSION_CODE: ${{ inputs.version_code }}");
  });

  it("opens reviewable upstream sync pull requests without merging", () => {
    expectUpstreamSyncWorkflowContract(readWorkflow("shlai-upstream-sync.yml"));
  });

  it.each(unsafeUpstreamSyncMutations)(
    "rejects unsafe upstream sync $name mutation",
    ({ mutate }) => {
      const source = readWorkflow("shlai-upstream-sync.yml");
      const mutatedSource = mutate(source);
      expect(mutatedSource).not.toBe(source);
      expect(() => expectUpstreamSyncWorkflowContract(mutatedSource)).toThrow();
    },
  );

  it("builds secret-free preview APKs after validation", () => {
    expectPreviewWorkflowContract(readWorkflow("shlai-pr.yml"));
  });

  it("publishes verified Shlai phone updates from main", () => {
    expectPhoneReleaseWorkflowContract(readWorkflow("shlai-phone-release.yml"));
  });

  it.each(unsafePhoneReleaseMutations)("rejects unsafe phone release %s mutation", (_, mutate) => {
    const source = readWorkflow("shlai-phone-release.yml");
    const mutatedSource = mutate(source);
    expect(mutatedSource).not.toBe(source);
    expect(() => expectPhoneReleaseWorkflowContract(mutatedSource)).toThrow();
  });

  it.each(unsafeMutations)("rejects unsafe $name mutation", ({ mutate }) => {
    const source = readWorkflow("shlai-pr.yml");
    const mutatedSource = mutate(source);
    expect(mutatedSource).not.toBe(source);
    expect(() => expectPreviewWorkflowContract(mutatedSource)).toThrow();
  });

  it("uses event-safe fallbacks for manual dispatch", () => {
    const source = readWorkflow("shlai-pr.yml");
    expect(source).toContain('if [[ "${{ github.event_name }}" == "pull_request" ]]');
    expect(source).toContain('BASE_SHA="$(git rev-parse HEAD^)"');
    expect(source).toContain("github.event.pull_request.number || github.run_number");
  });

  it("guards stable signing behind the production environment", () => {
    const source = readWorkflow("shlai-release.yml");
    expect(source).toContain("environment: shlai-production");
    expect(source).toContain("workflow_dispatch:");
    expect(source).toContain("SHLAI_ANDROID_KEYSTORE_BASE64");
    expect(source).toContain('[[ "$GITHUB_REF" != "refs/heads/main" ]]');
    expect(source).toContain("app-release-unsigned.apk");
    expect(source).toContain('"$APKSIGNER" verify --verbose --print-certs "$APK"');
    expect(source).toContain('gh release create "$TAG"');
    expect(source).not.toContain("android.injected.signing");
    expect(source).not.toContain("pull_request:");
  });

  it("keeps stable release validation secret-free and signing protected", () => {
    expectReleaseWorkflowContract(readWorkflow("shlai-release.yml"));
  });

  it.each(unsafeReleaseMutations)("rejects unsafe stable release $name mutation", ({ mutate }) => {
    const source = readWorkflow("shlai-release.yml");
    const mutatedSource = mutate(source);
    expect(mutatedSource).not.toBe(source);
    expect(() => expectReleaseWorkflowContract(mutatedSource)).toThrow();
  });
});
