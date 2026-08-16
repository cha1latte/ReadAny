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
  }

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

  it("sets up pnpm before using the setup-node pnpm cache", () => {
    const source = readWorkflow("shlai-pr.yml");
    const jobSources = source.split(/^ {2}[a-z]+:\s*$/m).slice(1);

    expect(jobSources).toHaveLength(2);
    for (const jobSource of jobSources) {
      expect(jobSource.indexOf("pnpm/action-setup@v3")).toBeGreaterThan(-1);
      expect(jobSource.indexOf("pnpm/action-setup@v3")).toBeLessThan(
        jobSource.indexOf("actions/setup-node@v4"),
      );
    }
  });

  it("uses event-safe fallbacks for manual dispatch", () => {
    const source = readWorkflow("shlai-pr.yml");
    expect(source).toContain('if [[ "${{ github.event_name }}" == "pull_request" ]]');
    expect(source).toContain('BASE_SHA="$(git rev-parse HEAD^)"');
    expect(source).toContain("github.event.pull_request.number || github.run_number");
  });
});
