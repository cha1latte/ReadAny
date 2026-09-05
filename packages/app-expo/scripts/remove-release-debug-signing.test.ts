import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { removeReleaseDebugSigning } = require("./remove-release-debug-signing.js");

const generatedBuildGradle = `android {
    signingConfigs {
        debug {
            storeFile file('debug.keystore')
        }
    }
    buildTypes {
        debug {
            signingConfig signingConfigs.debug
        }
        release {
            signingConfig signingConfigs.debug
            def enableProguardInReleaseBuilds = (findProperty('android.enableProguardInReleaseBuilds') ?: false).toBoolean()
            minifyEnabled enableProguardInReleaseBuilds
        }
    }
}
`;

describe("removeReleaseDebugSigning", () => {
  it("removes only the generated release debug-signing assignment", () => {
    const result = removeReleaseDebugSigning(generatedBuildGradle);

    expect(result).toContain(`debug {
            signingConfig signingConfigs.debug
        }`);
    expect(result).toContain(`release {
            def enableProguardInReleaseBuilds`);
    expect(result.match(/signingConfig signingConfigs\.debug/g)).toHaveLength(1);
  });

  it("fails closed when the release assignment is absent", () => {
    expect(() =>
      removeReleaseDebugSigning(
        generatedBuildGradle.replace(
          "            signingConfig signingConfigs.debug\n            def enableProguard",
          "            def enableProguard",
        ),
      ),
    ).toThrow("Expected exactly one release debug-signing assignment, found 0");
  });

  it("fails closed when more than one release assignment would be removed", () => {
    expect(() =>
      removeReleaseDebugSigning(
        generatedBuildGradle.replace(
          "            signingConfig signingConfigs.debug\n            def enableProguard",
          "            signingConfig signingConfigs.debug\n            signingConfig signingConfigs.debug\n            def enableProguard",
        ),
      ),
    ).toThrow("Expected exactly one release debug-signing assignment, found 2");
  });
});
