const { version: packageVersion } = require("../package.json");
const { normalizeAppVariant } = require("./app-variant");

const MAX_ANDROID_VERSION_CODE = 2100000000;

function getShlaiVersionConfig(env = process.env) {
  const upstreamVersion = String(env.SHLAI_UPSTREAM_VERSION || packageVersion);
  const revisionText = String(env.SHLAI_REVISION || "0");
  const versionCodeText = String(env.SHLAI_VERSION_CODE || "1");
  const isProduction =
    normalizeAppVariant(env.APP_VARIANT || env.EAS_BUILD_PROFILE) === "production";

  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(upstreamVersion)) {
    throw new Error(`Invalid SHLAI_UPSTREAM_VERSION: ${upstreamVersion}`);
  }
  if (!/^(0|[1-9]\d*)$/.test(revisionText)) {
    throw new Error(`Invalid SHLAI_REVISION: ${revisionText}`);
  }
  if (!/^[1-9]\d*$/.test(versionCodeText)) {
    throw new Error(`Invalid SHLAI_VERSION_CODE: ${versionCodeText}`);
  }

  const revision = Number(revisionText);
  const versionCode = Number(versionCodeText);
  if (!Number.isSafeInteger(revision) || (isProduction && revision <= 0)) {
    throw new Error(`Invalid SHLAI_REVISION: ${revisionText}`);
  }
  if (!Number.isSafeInteger(versionCode) || versionCode > MAX_ANDROID_VERSION_CODE) {
    throw new Error(`Invalid SHLAI_VERSION_CODE: ${versionCodeText}`);
  }
  return {
    upstreamVersion,
    revision,
    version: `${upstreamVersion}-shlai.${revision}`,
    tag: `shlai-v${upstreamVersion}.${revision}`,
    versionCode,
  };
}

module.exports = { getShlaiVersionConfig };
