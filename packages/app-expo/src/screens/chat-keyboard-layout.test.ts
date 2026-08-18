import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const chatScreens = ["ChatScreen.tsx", "BookChatScreen.tsx"] as const;
const screensDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(screensDir, "../../../..");

describe("Android chat keyboard layout", () => {
  for (const screen of chatScreens) {
    it(`${screen} keeps ChatInput inside Android keyboard avoidance`, () => {
      const source = readFileSync(resolve(screensDir, screen), "utf8");

      expect(source).toMatch(
        /import\s+\{\s*KeyboardAvoidingView\s*\}\s+from\s+"react-native-keyboard-controller";/,
      );
      expect(source).toMatch(
        /<KeyboardAvoidingView\b[\s\S]*?behavior="height"[\s\S]*?enabled=\{Platform\.OS === "android"\}[\s\S]*?keyboardVerticalOffset=\{insets\.top\}[\s\S]*?<ChatInput\b[\s\S]*?<\/KeyboardAvoidingView>/,
      );
    });
  }

  it("clears the controller height style after keyboard dismissal", () => {
    const rootPackage = JSON.parse(readFileSync(resolve(repoRoot, "package.json"), "utf8")) as {
      pnpm?: { patchedDependencies?: Record<string, string> };
    };
    expect(rootPackage.pnpm?.patchedDependencies?.["react-native-keyboard-controller@1.18.5"]).toBe(
      "patches/react-native-keyboard-controller@1.18.5.patch",
    );

    const controllerSource = readFileSync(
      resolve(
        repoRoot,
        "node_modules/react-native-keyboard-controller/src/components/KeyboardAvoidingView/index.tsx",
      ),
      "utf8",
    );
    expect(controllerSource).toMatch(
      /case "height":[\s\S]*?return \{ height: undefined, flex: undefined \};/,
    );
  });
});
