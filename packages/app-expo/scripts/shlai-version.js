const { version: packageVersion } = require("../package.json");

function getShlaiVersionConfig(env = process.env) {
  const upstreamVersion = String(env.SHLAI_UPSTREAM_VERSION || packageVersion).trim();
  const revisionText = String(env.SHLAI_REVISION || "0").trim();
  const versionCodeText = String(env.SHLAI_VERSION_CODE || "1").trim();

  if (!/^\d+\.\d+\.\d+$/.test(upstreamVersion)) {
    throw new Error(`Invalid SHLAI_UPSTREAM_VERSION: ${upstreamVersion}`);
  }
  if (!/^\d+$/.test(revisionText)) {
    throw new Error(`Invalid SHLAI_REVISION: ${revisionText}`);
  }
  if (!/^[1-9]\d*$/.test(versionCodeText)) {
    throw new Error(`Invalid SHLAI_VERSION_CODE: ${versionCodeText}`);
  }

  const revision = Number(revisionText);
  const versionCode = Number(versionCodeText);
  return {
    upstreamVersion,
    revision,
    version: `${upstreamVersion}-shlai.${revision}`,
    tag: `shlai-v${upstreamVersion}.${revision}`,
    versionCode,
  };
}

module.exports = { getShlaiVersionConfig };
