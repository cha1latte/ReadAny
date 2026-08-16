import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../../../..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

describe("OLED Black mobile theme", () => {
  it("defines, restores, and maps OLED as a dark theme with a pure-black background", () => {
    const context = read("packages/app-expo/src/styles/ThemeContext.tsx");
    const app = read("packages/app-expo/src/App.tsx");

    expect(context).toContain('export type ThemeMode = "light" | "dark" | "sepia" | "oled"');
    expect(context).toMatch(
      /const oledColors: ThemeColors = \{[\s\S]*?\.\.\.darkColors,[\s\S]*?background: "#000000"/,
    );
    expect(context).toMatch(/oled: oledColors/);
    expect(context).toMatch(/saved === "oled"/);
    expect(context).toContain('isDark: mode === "dark" || mode === "oled"');
    expect(app).toContain('<StatusBar style={isDark ? "light" : "dark"} />');
  });
});
