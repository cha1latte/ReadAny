import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { APP_VARIANTS } = require("../../scripts/app-variant.js");
const { getShlaiVersionConfig } = require("../../scripts/shlai-version.js");
const standaloneAutolinkingScriptPath = resolve(
  import.meta.dirname,
  "../../scripts/configure-standalone-autolinking.js",
);

const loadExpoConfig = (variant: "development" | "preview" | "production") => {
  const configPath = resolve(import.meta.dirname, "../../app.config.js");
  const revision = variant === "production" ? "1" : "0";
  const output = execFileSync(
    process.execPath,
    ["-e", `process.stdout.write(JSON.stringify(require(${JSON.stringify(configPath)}).expo))`],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        APP_VARIANT: variant,
        SHLAI_UPSTREAM_VERSION: "1.3.5",
        SHLAI_REVISION: revision,
        SHLAI_VERSION_CODE: "1",
      },
    },
  );
  return JSON.parse(output) as {
    plugins: Array<string | [string, Record<string, unknown>]>;
    extra: Record<string, unknown>;
  };
};

describe("ReadAny Shlai app configuration", () => {
  it("includes the Expo development launcher only in development builds", () => {
    const developmentPlugins = loadExpoConfig("development").plugins;
    expect(developmentPlugins).toContainEqual(["expo-dev-client", { launchMode: "launcher" }]);

    for (const variant of ["preview", "production"] as const) {
      const pluginNames = loadExpoConfig(variant).plugins.map((plugin) =>
        Array.isArray(plugin) ? plugin[0] : plugin,
      );
      expect(pluginNames).not.toContain("expo-dev-client");
    }
  });

  it("excludes development-only Expo modules from standalone native builds", () => {
    expect(existsSync(standaloneAutolinkingScriptPath)).toBe(true);
    if (!existsSync(standaloneAutolinkingScriptPath)) return;

    const { configureStandaloneAutolinking } = require(standaloneAutolinkingScriptPath);
    const configured = configureStandaloneAutolinking({
      name: "test-app",
      expo: {
        autolinking: {
          exclude: ["globally-excluded"],
          android: { exclude: ["already-excluded"] },
        },
      },
    });
    expect(configured).toEqual({
      name: "test-app",
      expo: {
        autolinking: {
          exclude: ["globally-excluded"],
          android: {
            exclude: [
              "globally-excluded",
              "already-excluded",
              "expo-dev-client",
              "expo-dev-launcher",
              "expo-dev-menu",
              "expo-dev-menu-interface",
            ],
          },
        },
      },
    });
  });

  it("keeps the Expo development client in development EAS builds only", () => {
    const { shouldConfigureStandaloneAutolinking } = require(standaloneAutolinkingScriptPath);
    expect(shouldConfigureStandaloneAutolinking({ APP_VARIANT: "development" })).toBe(false);
    expect(
      shouldConfigureStandaloneAutolinking({ EAS_BUILD_PROFILE: "development-simulator" }),
    ).toBe(false);
    expect(shouldConfigureStandaloneAutolinking({ APP_VARIANT: "preview" })).toBe(true);
    expect(shouldConfigureStandaloneAutolinking({ APP_VARIANT: "production" })).toBe(true);
  });

  it("keeps EAS limited to development and preview builds", () => {
    const root = resolve(import.meta.dirname, "../../../..");
    const eas = JSON.parse(readFileSync(resolve(root, "packages/app-expo/eas.json"), "utf8"));
    const expoPackage = JSON.parse(
      readFileSync(resolve(root, "packages/app-expo/package.json"), "utf8"),
    );
    const workspacePackage = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
    const legacyReleaseWorkflow = readFileSync(
      resolve(root, ".github/workflows/release.yml"),
      "utf8",
    );

    expect(Object.keys(eas.build).sort()).toEqual([
      "development",
      "development-simulator",
      "preview",
    ]);
    expect(
      Object.keys(expoPackage.scripts).filter((name) => /^eas:build:(android|ios)$/.test(name)),
    ).toEqual([]);
    expect(
      Object.keys(workspacePackage.scripts).filter((name) =>
        /^eas:build:(android|ios)$/.test(name),
      ),
    ).toEqual([]);
    expect(expoPackage.scripts["eas-build-post-install"]).toContain(
      "node scripts/configure-standalone-autolinking.js package.json",
    );
    expect(expoPackage.expo.autolinking?.android?.exclude).toBeUndefined();
    expect(eas.build.preview.android.gradleCommand).toBe(
      '--no-daemon -Dorg.gradle.jvmargs="-Xmx4g -XX:MaxMetaspaceSize=1g" :app:assembleRelease -PreactNativeArchitectures=arm64-v8a',
    );
    expect(legacyReleaseWorkflow).not.toContain("production-apk");
    expect(legacyReleaseWorkflow).not.toContain("build-android:");
  });

  it("uses isolated identities for every Android variant", () => {
    expect(APP_VARIANTS).toEqual({
      development: {
        key: "development",
        name: "ReadAny Shlai Dev",
        bundleIdentifier: "io.github.cha1latte.readanyshlai.dev",
        androidPackage: "io.github.cha1latte.readanyshlai.dev",
        scheme: "readany-shlai-dev",
      },
      preview: {
        key: "preview",
        name: "ReadAny Shlai Preview",
        bundleIdentifier: "io.github.cha1latte.readanyshlai.preview",
        androidPackage: "io.github.cha1latte.readanyshlai.preview",
        scheme: "readany-shlai-preview",
      },
      production: {
        key: "production",
        name: "ReadAny Shlai",
        bundleIdentifier: "io.github.cha1latte.readanyshlai",
        androidPackage: "io.github.cha1latte.readanyshlai",
        scheme: "readany-shlai",
      },
    });
  });

  it("emits distinct stable and preview release channel metadata", () => {
    expect(loadExpoConfig("preview").extra).toMatchObject({
      appVariant: "preview",
      releaseApiUrl: "https://api.github.com/repos/cha1latte/ReadAny/releases?per_page=100",
      releaseTagPrefix: "shlai-preview-v",
      releaseMode: "canonical-prerelease-list",
      releaseAssetName: "ReadAny-Shlai-Preview.apk",
      releaseChecksumAssetName: "ReadAny-Shlai-Preview.apk.sha256",
    });
    expect(loadExpoConfig("production").extra).toMatchObject({
      appVariant: "production",
      releaseApiUrl: "https://api.github.com/repos/cha1latte/ReadAny/releases/latest",
      releaseTagPrefix: "shlai-v",
      releaseMode: "single",
      releaseAssetName: "ReadAny-Shlai.apk",
    });
  });

  it("derives the release tag, display version, and Android build number", () => {
    expect(
      getShlaiVersionConfig({
        APP_VARIANT: "production",
        SHLAI_UPSTREAM_VERSION: "1.3.5",
        SHLAI_REVISION: "2",
        SHLAI_VERSION_CODE: "9",
      }),
    ).toEqual({
      upstreamVersion: "1.3.5",
      revision: 2,
      version: "1.3.5-shlai.2",
      tag: "shlai-v1.3.5.2",
      versionCode: 9,
    });
  });

  it("keeps the largest safe revision and Android version code canonical", () => {
    const env = {
      APP_VARIANT: "production",
      SHLAI_UPSTREAM_VERSION: "1.3.5",
      SHLAI_REVISION: String(Number.MAX_SAFE_INTEGER),
      SHLAI_VERSION_CODE: "2100000000",
    };

    expect(getShlaiVersionConfig(env)).toEqual({
      upstreamVersion: env.SHLAI_UPSTREAM_VERSION,
      revision: Number.MAX_SAFE_INTEGER,
      version: `${env.SHLAI_UPSTREAM_VERSION}-shlai.${env.SHLAI_REVISION}`,
      tag: `shlai-v${env.SHLAI_UPSTREAM_VERSION}.${env.SHLAI_REVISION}`,
      versionCode: 2100000000,
    });
  });

  it("allows revision zero only for non-production variants", () => {
    expect(
      getShlaiVersionConfig({
        APP_VARIANT: "preview",
        SHLAI_UPSTREAM_VERSION: "1.3.5",
        SHLAI_REVISION: "0",
        SHLAI_VERSION_CODE: "1",
      }).revision,
    ).toBe(0);
  });

  it.each([
    [{ SHLAI_UPSTREAM_VERSION: "one" }, "Invalid SHLAI_UPSTREAM_VERSION"],
    [{ SHLAI_REVISION: "-1" }, "Invalid SHLAI_REVISION"],
    [{ APP_VARIANT: "production", SHLAI_REVISION: "0" }, "Invalid SHLAI_REVISION"],
    [{ SHLAI_REVISION: "9007199254740992" }, "Invalid SHLAI_REVISION"],
    [{ SHLAI_VERSION_CODE: "0" }, "Invalid SHLAI_VERSION_CODE"],
    [{ SHLAI_VERSION_CODE: "2100000001" }, "Invalid SHLAI_VERSION_CODE"],
  ])("rejects invalid release metadata", (env, message) => {
    expect(() => getShlaiVersionConfig(env)).toThrow(message);
  });
});
