import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const about = readFileSync(resolve(here, "AboutScreen.tsx"), "utf8");
const profile = readFileSync(resolve(here, "../ProfileScreen.tsx"), "utf8");

describe("ReadAny Shlai attribution", () => {
  it("names the fork and links both source repositories", () => {
    expect(about).toContain("ReadAny Shlai");
    expect(about).toContain("https://github.com/cha1latte/ReadAny");
    expect(about).toContain("https://github.com/codedogQBY/ReadAny");
    expect(about).toContain("Unofficial GPL-3.0 fork");
  });

  it("does not claim the official app's ICP registration", () => {
    expect(profile).not.toContain("ICP_NUMBER");
    expect(profile).not.toContain("beian.miit.gov.cn");
  });
});
