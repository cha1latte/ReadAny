import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../../../..");
const readWorkflow = (name: string) =>
  readFileSync(resolve(root, ".github/workflows", name), "utf8");

describe("ReadAny Shlai workflows", () => {
  it("builds secret-free preview APKs after validation", () => {
    const source = readWorkflow("shlai-pr.yml");
    expect(source).toContain("name: Validate");
    expect(source).toContain("name: Preview APK");
    expect(source).toContain("needs: validate");
    expect(source).toContain("APP_VARIANT: preview");
    expect(source).toContain("assembleDebug");
    expect(source).toContain("ReadAny-Shlai-Preview-");
    expect(source).toContain("retention-days: 14");
    expect(source).not.toContain("SHLAI_ANDROID_KEYSTORE");
    expect(source).not.toContain("environment: shlai-production");
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
