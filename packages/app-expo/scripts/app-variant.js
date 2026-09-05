const APP_VARIANTS = {
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
};

const VARIANT_ALIASES = {
  dev: "development",
  development: "development",
  local: "development",
  debug: "development",
  "development-simulator": "development",
  preview: "preview",
  staging: "preview",
  test: "preview",
  prod: "production",
  production: "production",
  release: "production",
};

function normalizeAppVariant(value) {
  const rawVariant = String(value || "")
    .trim()
    .toLowerCase();

  if (VARIANT_ALIASES[rawVariant]) {
    return VARIANT_ALIASES[rawVariant];
  }

  if (rawVariant.includes("production")) {
    return "production";
  }

  if (rawVariant.includes("preview") || rawVariant.includes("staging")) {
    return "preview";
  }

  return "development";
}

function getAppVariant() {
  return normalizeAppVariant(
    process.env.APP_VARIANT || process.env.EAS_BUILD_PROFILE || "development",
  );
}

function getAppVariantConfig() {
  return APP_VARIANTS[getAppVariant()];
}

module.exports = {
  APP_VARIANTS,
  getAppVariant,
  getAppVariantConfig,
  normalizeAppVariant,
};
