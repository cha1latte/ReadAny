import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const root = resolve(import.meta.dirname, "../../../..");
const readWorkflow = (name: string) =>
  readFileSync(resolve(root, ".github/workflows", name), "utf8");

type WorkflowStep = {
  uses?: string;
  run?: string;
  env?: Record<string, unknown>;
  with?: Record<string, unknown>;
};

type WorkflowJob = {
  name?: string;
  needs?: string | string[];
  permissions?: unknown;
  environment?: unknown;
  env?: Record<string, unknown>;
  uses?: string;
  steps?: WorkflowStep[];
};

type Workflow = {
  on?: Record<string, unknown>;
  permissions?: Record<string, unknown>;
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

const expectReleaseWorkflowContract = (source: string) => {
  const workflow = parse(source, { version: "1.2" }) as Workflow;
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
  expect(validate?.name).toBe("Validate");
  expect(release?.name).toBe("Release ReadAny Shlai");
  expect(release?.needs).toBe("validate");
  expect(validate?.permissions).toBeUndefined();
  expect(validate?.environment).toBeUndefined();
  expect(JSON.stringify(validate)).not.toContain("secrets.");

  expect(release?.permissions).toEqual({ contents: "write" });
  expect(release?.environment).toBe("shlai-production");
  expect(release?.env).toEqual({
    APP_VARIANT: "production",
    SHLAI_UPSTREAM_VERSION: "${{ inputs.upstream_version }}",
    SHLAI_REVISION: "${{ inputs.revision }}",
    SHLAI_VERSION_CODE: "${{ inputs.version_code }}",
    ...Object.fromEntries(releaseSecretNames.map((name) => [name, `\${{ secrets.${name} }}`])),
  });

  const validateCommands = (validate?.steps ?? [])
    .map((step) => step.run)
    .filter((command): command is string => typeof command === "string");
  expect(validateCommands).toContain("pnpm install --frozen-lockfile");
  expect(validateCommands).toContain("pnpm --filter @readany/core test");
  expect(validateCommands).toContain("pnpm --filter @readany/app-expo test");
  expect(validateCommands).toContain("pnpm exec tsc --noEmit -p packages/app-expo/tsconfig.json");
  expect(validateCommands.join("\n")).toContain("git diff --check");

  const releaseSteps = release?.steps ?? [];
  const releaseActions = releaseSteps
    .map((step) => step.uses)
    .filter((action): action is string => typeof action === "string");
  expect(releaseActions).toContain("android-actions/setup-android@v3");
  const setupNode = releaseSteps.find((step) => step.uses === "actions/setup-node@v4");
  expect(setupNode?.with).toEqual({ "node-version": "20.18.0", cache: "pnpm" });
  const setupJava = releaseSteps.find((step) => step.uses === "actions/setup-java@v4");
  expect(setupJava?.with).toEqual({ distribution: "temurin", "java-version": 17 });
  expect(releaseSteps.map((step) => step.run)).toContain("pnpm install --frozen-lockfile");

  const releaseCommands = releaseSteps
    .map((step) => step.run)
    .filter((command): command is string => typeof command === "string")
    .join("\n");
  expect(releaseCommands).toContain('TAG="shlai-v${SHLAI_UPSTREAM_VERSION}.${SHLAI_REVISION}"');
  expect(releaseCommands).toContain('APK="ReadAny-Shlai.apk"');
  expect(releaseCommands).toContain('KEYSTORE="$RUNNER_TEMP/readany-shlai-release.jks"');
  expect(releaseCommands).toContain('gh release view "$TAG" --repo "$GITHUB_REPOSITORY"');
  expect(releaseCommands).toContain(
    'printf \'%s\' "$SHLAI_ANDROID_KEYSTORE_BASE64" | base64 --decode > "$KEYSTORE"',
  );
  expect(releaseCommands).toContain("pnpm --filter @readany/app-expo run build:reader");
  expect(releaseCommands).toContain(
    "pnpm --filter @readany/app-expo exec expo prebuild --platform android --clean --no-install",
  );
  expect(releaseCommands).toContain("./gradlew assembleRelease \\");
  expect(releaseCommands).toContain("-PreactNativeArchitectures=arm64-v8a \\");
  expect(releaseCommands).toContain('-Pandroid.injected.signing.store.file="$KEYSTORE" \\');
  expect(releaseCommands).toContain(
    '"$BUILD_TOOLS/apksigner" verify --verbose --print-certs "$APK"',
  );
  expect(releaseCommands).toContain('gh release create "$TAG" "$APK"');
  expect(releaseCommands).toContain('--target "$GITHUB_SHA"');
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
    name: "validate secret",
    mutate: (source: string) =>
      source.replace(
        "  validate:\n    name: Validate",
        "  validate:\n    name: Validate\n    env:\n      TOKEN: ${{ secrets.UNRELATED_TOKEN }}",
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
    expect(source).toContain("apksigner verify --verbose --print-certs");
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
