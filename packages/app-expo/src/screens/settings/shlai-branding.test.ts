import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const about = readFileSync(resolve(here, "AboutScreen.tsx"), "utf8");
const animatedSplash = readFileSync(
  resolve(here, "../../components/splash/AnimatedSplash.tsx"),
  "utf8",
);
const badges = readFileSync(resolve(here, "../BadgesScreen.tsx"), "utf8");
const profile = readFileSync(resolve(here, "../ProfileScreen.tsx"), "utf8");
const readme = readFileSync(resolve(here, "../../../../../README.md"), "utf8");

describe("ReadAny Shlai attribution", () => {
  it("names the fork and links both source repositories", () => {
    expect(about).toContain("ReadAny Shlai");
    expect(about).toContain("https://github.com/cha1latte/ReadAny");
    expect(about).toContain("https://github.com/codedogQBY/ReadAny");
  });

  it("uses the factual GPL-3.0-or-later fork notice", () => {
    expect({
      about: about.includes("Unofficial GPL-3.0-or-later fork"),
      readme: readme.includes("Unofficial GPL-3.0-or-later fork"),
    }).toEqual({ about: true, readme: true });
  });

  it("declares the root project license as GPL-3.0-or-later", () => {
    expect(readme).toContain("[GPL-3.0-or-later](LICENSE)");
    expect(readme).not.toContain("[GPL-3.0](LICENSE)");
  });

  it("describes the Android fork without claiming cross-platform distribution", () => {
    expect(about).toContain("Android");
    expect(about).not.toContain("一个跨平台的智能电子书阅读器");
  });

  it("does not claim the official app's ICP registration", () => {
    expect(profile).not.toContain("ICP_NUMBER");
    expect(profile).not.toContain("beian.miit.gov.cn");
  });

  it("uses the Shlai asset on the active splash surface", () => {
    expect(animatedSplash).toContain('require("../../../assets/shlai/splash-icon.png")');
    expect(animatedSplash).not.toContain('require("../../../assets/splash-icon.png")');
  });

  it("uses the Shlai asset on the active badge surface", () => {
    expect(badges).toContain('from "../../assets/shlai/icon.png"');
    expect(badges).not.toContain('from "../../assets/icon.png"');
  });
});
