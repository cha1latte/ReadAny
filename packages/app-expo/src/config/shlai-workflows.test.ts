import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../../../..");
const readWorkflow = (name: string) =>
  readFileSync(resolve(root, ".github/workflows", name), "utf8");

const expectPreviewWorkflowContract = (source: string) => {
  expect(source).toContain("on:\n  pull_request:\n");
  expect(source).toMatch(/^ {2}workflow_dispatch:\s*$/m);
  expect(source).not.toMatch(/^ {2}pull_request_target:\s*$/m);
  expect(source).not.toMatch(/^ {2}push:\s*$/m);
  expect(source).toContain("permissions:\n  contents: read\n");
  expect(source).not.toMatch(/^ {2}[\w-]+:\s*write\s*$/m);
  expect(source).toContain("name: Validate");
  expect(source).toContain("name: Preview APK");
  expect(source).toContain("needs: validate");
  expect(source).toContain("APP_VARIANT: preview");
  expect(source).not.toContain("APP_VARIANT=production");
  expect(source).toContain("android-actions/setup-android@v3");
  expect(source).toContain("--platform android");
  expect(source).toContain("assembleDebug -PreactNativeArchitectures=arm64-v8a");
  expect(source).not.toContain("--platform ios");
  expect(source).not.toContain("xcodebuild");
  const assembleTasks = [...source.matchAll(/\bassemble[A-Z][A-Za-z]*/g)].map(([task]) => task);
  expect([...new Set(assembleTasks)]).toEqual(["assembleDebug"]);
  expect(source).toContain("ReadAny-Shlai-Preview-");
  expect(source).toContain("retention-days: 14");
  expect(source).not.toContain("SHLAI_ANDROID_KEYSTORE");
  expect(source).not.toContain("secrets.");
  expect(source).not.toMatch(/^\s+environment:/m);
  expect(source).not.toContain("gh release");
  expect(source).not.toContain(".github/workflows/release.yml");
  expect(source).not.toContain("pnpm publish");
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
    name: "contents write permission",
    mutate: (source: string) => source.replace("contents: read", "contents: write"),
  },
  {
    name: "additional write permission",
    mutate: (source: string) => source.replace("contents: read", "contents: read\n  issues: write"),
  },
  {
    name: "secret reference",
    mutate: (source: string) =>
      source.replace(
        "      APP_VARIANT: preview",
        "      APP_VARIANT: preview\n      RELEASE_TOKEN: $" + "{{ secrets.RELEASE_TOKEN }}",
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
    name: "non-arm64 APK",
    mutate: (source: string) => source.replace("arm64-v8a", "x86_64"),
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
    name: "production variant",
    mutate: (source: string) =>
      source.replace(
        "      - name: Build preview APK",
        "      - run: APP_VARIANT=production ./gradlew assembleDebug\n      - name: Build preview APK",
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
