import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const root = resolve(import.meta.dirname, "../../../..");
const readWorkflow = (name: string) =>
  readFileSync(resolve(root, ".github/workflows", name), "utf8");

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
  uses?: string;
  steps?: WorkflowStep[];
};

type Workflow = {
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
  const validate = jobs.validate;
  const preview = jobs.preview;
  expect(validate?.name).toBe("Validate");
  expect(preview?.name).toBe("Preview APK");
  expect(preview?.needs).toBe("validate");

  for (const job of Object.values(jobs)) {
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
  expect(commands.some((command) => /(?:publish|release)/i.test(command))).toBe(false);
  expect(commands.some((command) => /GITHUB_ENV/i.test(command))).toBe(false);
  expect(commands.join("\n")).not.toContain("--platform ios");
  expect(commands.join("\n")).not.toContain("xcodebuild");

  const previewSteps = preview?.steps ?? [];
  expect(previewSteps.map((step) => step.uses)).toContain("android-actions/setup-android@v3");
  const prebuildCommands = previewSteps
    .map((step) => step.run)
    .filter((command): command is string => command?.includes("expo prebuild") === true);
  expect(prebuildCommands).toEqual([
    "pnpm --filter @readany/app-expo exec expo prebuild --platform android --clean --no-install",
  ]);

  const assembleCommands = previewSteps
    .map((step) => step.run)
    .filter((command): command is string => command?.includes("assemble") === true);
  expect(assembleCommands).toEqual([
    "./gradlew assembleDebug -PreactNativeArchitectures=arm64-v8a",
  ]);
  const architecture = assembleCommands[0]?.match(/-PreactNativeArchitectures=([^\s]+)/)?.[1];
  expect(architecture).toBe("arm64-v8a");

  const uploadSteps = previewSteps.filter((step) => step.uses === "actions/upload-artifact@v4");
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

const stableReleaseScript = `TAG="shlai-v\${SHLAI_UPSTREAM_VERSION}.\${SHLAI_REVISION}"
APK="ReadAny-Shlai.apk"
KEYSTORE="\$RUNNER_TEMP/readany-shlai-release.jks"

if gh release view "\$TAG" --repo "\$GITHUB_REPOSITORY" >/dev/null 2>&1; then
  echo "Release already exists: \$TAG" >&2
  exit 1
fi

printf '%s' "\$SHLAI_ANDROID_KEYSTORE_BASE64" | base64 --decode > "\$KEYSTORE"
pnpm --filter @readany/app-expo run build:reader
pnpm --filter @readany/app-expo exec expo prebuild --platform android --clean --no-install

cd packages/app-expo/android
./gradlew assembleRelease \\
  -PreactNativeArchitectures=arm64-v8a \\
  -Pandroid.injected.signing.store.file="\$KEYSTORE" \\
  -Pandroid.injected.signing.store.password="\$SHLAI_ANDROID_KEYSTORE_PASSWORD" \\
  -Pandroid.injected.signing.key.alias="\$SHLAI_ANDROID_KEY_ALIAS" \\
  -Pandroid.injected.signing.key.password="\$SHLAI_ANDROID_KEY_PASSWORD"
cd ../../..

cp packages/app-expo/android/app/build/outputs/apk/release/app-release.apk "\$APK"
BUILD_TOOLS="\$(find "\$ANDROID_HOME/build-tools" -mindepth 1 -maxdepth 1 -type d | sort -V | tail -1)"
"\$BUILD_TOOLS/apksigner" verify --verbose --print-certs "\$APK"
gh release create "\$TAG" "\$APK" \\
  --repo "\$GITHUB_REPOSITORY" \\
  --target "\$GITHUB_SHA" \\
  --title "ReadAny Shlai \${SHLAI_UPSTREAM_VERSION}.\${SHLAI_REVISION}" \\
  --notes "Unofficial ReadAny Shlai Android release. Source: \${GITHUB_SERVER_URL}/\${GITHUB_REPOSITORY}/tree/\${GITHUB_SHA}"`;

const expectedValidateSteps: WorkflowStep[] = [
  { uses: "actions/checkout@v4", with: { "fetch-depth": 0 } },
  { uses: "pnpm/action-setup@v3", with: { version: "9.15.0" } },
  { uses: "actions/setup-node@v4", with: { "node-version": "20.18.0", cache: "pnpm" } },
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

const expectedReleaseSteps: WorkflowStep[] = [
  { uses: "actions/checkout@v4" },
  { uses: "pnpm/action-setup@v3", with: { version: "9.15.0" } },
  { uses: "actions/setup-node@v4", with: { "node-version": "20.18.0", cache: "pnpm" } },
  { uses: "actions/setup-java@v4", with: { distribution: "temurin", "java-version": 17 } },
  { uses: "android-actions/setup-android@v3" },
  { run: "pnpm install --frozen-lockfile" },
  {
    name: "Build, sign, verify, and publish APK",
    shell: "bash",
    env: { GH_TOKEN: "${{ github.token }}" },
    run: `${stableReleaseScript}\n`,
  },
];

const expectReleaseWorkflowContract = (source: string) => {
  const workflow = parse(source, { version: "1.2" }) as Workflow;
  expect(Object.keys(workflow).sort()).toEqual(["jobs", "name", "on", "permissions"]);
  expect(Object.keys(workflow.on ?? {})).toEqual(["workflow_dispatch"]);
  expect(workflow.permissions).toEqual({ contents: "read" });

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
  expect(Object.keys(jobs).sort()).toEqual(["release", "validate"]);
  const validate = jobs.validate;
  const release = jobs.release;
  expect(Object.keys(validate ?? {}).sort()).toEqual(["name", "runs-on", "steps"]);
  expect(Object.keys(release ?? {}).sort()).toEqual([
    "env",
    "environment",
    "name",
    "needs",
    "permissions",
    "runs-on",
    "steps",
  ]);
  expect(validate?.name).toBe("Validate");
  expect(validate?.["runs-on"]).toBe("ubuntu-22.04");
  expect(release?.name).toBe("Release ReadAny Shlai");
  expect(release?.needs).toBe("validate");
  expect(release?.["runs-on"]).toBe("ubuntu-22.04");
  expect(release?.if).toBeUndefined();
  expect(validate?.["continue-on-error"]).toBeUndefined();
  expect(release?.["continue-on-error"]).toBeUndefined();
  expect(validate?.permissions).toBeUndefined();
  expect(validate?.environment).toBeUndefined();
  expect(hasParsedKey(workflow, "secrets")).toBe(false);
  expect(validate?.steps).toEqual(expectedValidateSteps);
  expect(collectSecretsTokens(validate)).toEqual([]);
  for (const step of validate?.steps ?? []) {
    expect(step.if).toBeUndefined();
    expect(step["continue-on-error"] ?? false).toBe(false);
  }

  expect(release?.permissions).toEqual({ contents: "write" });
  expect(release?.environment).toBe("shlai-production");
  expect(release?.env).toEqual({
    APP_VARIANT: "production",
    SHLAI_UPSTREAM_VERSION: "${{ inputs.upstream_version }}",
    SHLAI_REVISION: "${{ inputs.revision }}",
    SHLAI_VERSION_CODE: "${{ inputs.version_code }}",
    ...Object.fromEntries(releaseSecretNames.map((name) => [name, `\${{ secrets.${name} }}`])),
  });
  const { env: releaseEnv, ...releaseWithoutEnv } = release ?? {};
  expect(collectSecretsTokens(releaseWithoutEnv)).toEqual([]);
  expect(collectSecretsTokens(releaseEnv)).toEqual(releaseSecretNames.map(() => "secrets"));
  expect(
    collectSecretsTokens({
      ...workflow,
      jobs: { ...jobs, release: releaseWithoutEnv },
    }),
  ).toEqual([]);

  expect(release?.steps).toEqual(expectedReleaseSteps);
};

const addWrongCacheOrderJob = (source: string, jobId: string) =>
  source.replace(
    "  preview:\n",
    `  ${jobId}:\n    runs-on: ubuntu-22.04\n    steps:\n      - uses: actions/setup-node@v4\n        with:\n          cache: pnpm\n      - uses: pnpm/action-setup@v3\n\n  preview:\n`,
  );

const unsafeMutations = [
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
    name: "self-hosted release runner",
    mutate: (source: string) =>
      source.replace(
        "  release:\n    name: Release ReadAny Shlai\n    needs: validate\n    runs-on: ubuntu-22.04",
        "  release:\n    name: Release ReadAny Shlai\n    needs: validate\n    runs-on: self-hosted",
      ),
  },
  {
    name: "top-level shell default",
    mutate: (source: string) =>
      source.replace(
        "permissions:\n  contents: read",
        "defaults:\n  run:\n    shell: bash\n\npermissions:\n  contents: read",
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
    name: "unprotected release environment",
    mutate: (source: string) =>
      source.replace("environment: shlai-production", "environment: preview"),
  },
  {
    name: "release always runs after a failed validation",
    mutate: (source: string) =>
      source.replace(
        "    runs-on: ubuntu-22.04\n    permissions:",
        "    if: always()\n    runs-on: ubuntu-22.04\n    permissions:",
      ),
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
    name: "required validation test is skipped",
    mutate: (source: string) =>
      source.replace(
        "      - run: pnpm --filter @readany/core test",
        "      - run: pnpm --filter @readany/core test\n        if: ${{ false }}",
      ),
  },
  {
    name: "validate secret",
    mutate: (source: string) =>
      source.replace(
        "  validate:\n    name: Validate",
        "  validate:\n    name: Validate\n    env:\n      TOKEN: ${{ secrets.UNRELATED_TOKEN }}",
      ),
  },
  {
    name: "validate bracket secret",
    mutate: (source: string) =>
      source.replace(
        "  validate:\n    name: Validate",
        "  validate:\n    name: Validate\n    env:\n      TOKEN: ${{ secrets['UNRELATED_TOKEN'] }}",
      ),
  },
  {
    name: "workflow-level secret",
    mutate: (source: string) =>
      source.replace(
        "permissions:\n  contents: read",
        "env:\n  TOKEN: ${{ secrets.UNRELATED_TOKEN }}\n\npermissions:\n  contents: read",
      ),
  },
  {
    name: "compound secret expression",
    mutate: (source: string) =>
      source.replace(
        "  validate:\n    name: Validate",
        "  validate:\n    name: Validate\n    env:\n      TOKEN: ${{ secrets.UNRELATED_TOKEN || '' }}",
      ),
  },
  {
    name: "dynamic bracket secret expression",
    mutate: (source: string) =>
      source.replace(
        "  validate:\n    name: Validate",
        "  validate:\n    name: Validate\n    env:\n      TOKEN: ${{ secrets[inputs.secret_name] }}",
      ),
  },
  {
    name: "serialized secrets context",
    mutate: (source: string) =>
      source.replace(
        "  validate:\n    name: Validate",
        "  validate:\n    name: Validate\n    env:\n      TOKEN: ${{ toJSON(secrets) }}",
      ),
  },
  {
    name: "release without write permission",
    mutate: (source: string) => source.replace("    permissions:\n      contents: write\n", ""),
  },
  {
    name: "mixed Android architectures",
    mutate: (source: string) => source.replace("arm64-v8a", "arm64-v8a,x86_64"),
  },
  {
    name: "unsigned APK",
    mutate: (source: string) =>
      source.replace(
        '"$BUILD_TOOLS/apksigner" verify --verbose --print-certs "$APK"',
        "true # unsigned",
      ),
  },
  {
    name: "signing reordered before APK staging",
    mutate: (source: string) =>
      source.replace(
        '          cp packages/app-expo/android/app/build/outputs/apk/release/app-release.apk "$APK"',
        '          "$BUILD_TOOLS/apksigner" verify --verbose --print-certs "$APK"\n          cp packages/app-expo/android/app/build/outputs/apk/release/app-release.apk "$APK"',
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
    name: "comment decoy in release script",
    mutate: (source: string) =>
      source.replace(
        '          "$BUILD_TOOLS/apksigner" verify --verbose --print-certs "$APK"',
        '          # "$BUILD_TOOLS/apksigner" verify --verbose --print-certs "$APK"\n          "$BUILD_TOOLS/apksigner" verify --verbose --print-certs "$APK"',
      ),
  },
  {
    name: "missing pnpm setup before cached Node setup",
    mutate: (source: string) =>
      source.replace(
        "      - uses: pnpm/action-setup@v3\n        with:\n          version: 9.15.0\n",
        "",
      ),
  },
  {
    name: "cached Node setup before pnpm setup",
    mutate: (source: string) =>
      source.replace(
        "      - uses: pnpm/action-setup@v3\n        with:\n          version: 9.15.0\n      - uses: actions/setup-node@v4\n        with:\n          node-version: 20.18.0\n          cache: pnpm\n",
        "      - uses: actions/setup-node@v4\n        with:\n          node-version: 20.18.0\n          cache: pnpm\n      - uses: pnpm/action-setup@v3\n        with:\n          version: 9.15.0\n",
      ),
  },
  {
    name: "separate release command",
    mutate: (source: string) =>
      source.replace(
        "      - name: Build, sign, verify, and publish APK",
        "      - run: gh release upload release-tag ReadAny-Shlai.apk --clobber\n      - name: Build, sign, verify, and publish APK",
      ),
  },
  {
    name: "separate release action",
    mutate: (source: string) =>
      source.replace(
        "      - name: Build, sign, verify, and publish APK",
        "      - uses: softprops/action-gh-release@v2\n      - name: Build, sign, verify, and publish APK",
      ),
  },
  {
    name: "generic GitHub script release step",
    mutate: (source: string) =>
      source.replace(
        "      - name: Build, sign, verify, and publish APK",
        "      - uses: actions/github-script@v7\n        with:\n          script: core.info('deploy')\n      - name: Build, sign, verify, and publish APK",
      ),
  },
] as const;

describe("ReadAny Shlai workflows", () => {
  it("builds secret-free preview APKs after validation", () => {
    expectPreviewWorkflowContract(readWorkflow("shlai-pr.yml"));
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
    expect(source).toContain("android.injected.signing.store.file");
    expect(source).toContain('"$BUILD_TOOLS/apksigner" verify --verbose --print-certs "$APK"');
    expect(source).toContain('gh release create "$TAG"');
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
