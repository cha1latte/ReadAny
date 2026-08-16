import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const hookPath = resolve(dirname(fileURLToPath(import.meta.url)), "use-update-checker.ts");

describe("useUpdateChecker", () => {
  it("uses the latest dismissed version and store actions for its delayed check", () => {
    const source = readFileSync(hookPath, "utf8");

    expect(source).toContain("}, [dismissedVersion, setCheckResult, showDialog]);");
  });
});
