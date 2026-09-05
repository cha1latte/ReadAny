const fs = require("node:fs");
const path = require("node:path");
const { normalizeAppVariant } = require("./app-variant.js");

const STANDALONE_EXCLUDES = [
  "expo-dev-client",
  "expo-dev-launcher",
  "expo-dev-menu",
  "expo-dev-menu-interface",
];

function configureStandaloneAutolinking(packageJson) {
  const expo = packageJson.expo ?? {};
  const autolinking = expo.autolinking ?? {};
  const android = autolinking.android ?? {};
  const commonExcludes = Array.isArray(autolinking.exclude) ? autolinking.exclude : [];
  const existingExcludes = Array.isArray(android.exclude) ? android.exclude : [];

  return {
    ...packageJson,
    expo: {
      ...expo,
      autolinking: {
        ...autolinking,
        android: {
          ...android,
          exclude: [...new Set([...commonExcludes, ...existingExcludes, ...STANDALONE_EXCLUDES])],
        },
      },
    },
  };
}

function shouldConfigureStandaloneAutolinking(env) {
  return normalizeAppVariant(env.APP_VARIANT || env.EAS_BUILD_PROFILE) !== "development";
}

function main(argv, env = process.env) {
  const packageJsonArgument = argv[2];
  if (!packageJsonArgument || argv.length !== 3) {
    throw new Error("Usage: node configure-standalone-autolinking.js <path-to-package.json>");
  }

  if (!shouldConfigureStandaloneAutolinking(env)) return;

  const packageJsonPath = path.resolve(packageJsonArgument);
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
  const configured = configureStandaloneAutolinking(packageJson);
  fs.writeFileSync(packageJsonPath, `${JSON.stringify(configured, null, 2)}\n`);
}

if (require.main === module) {
  main(process.argv);
}

module.exports = { configureStandaloneAutolinking, shouldConfigureStandaloneAutolinking };
