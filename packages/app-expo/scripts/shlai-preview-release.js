const fs = require("node:fs");

const PREVIEW_TAG = /^shlai-preview-v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)\.([1-9]\d*)$/;
const UPSTREAM_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const MAX_ANDROID_VERSION_CODE = 2_100_000_000;
const MAX_SAFE_INTEGER_TEXT = String(Number.MAX_SAFE_INTEGER);

function compareIntegerStrings(left, right) {
  if (left.length !== right.length) return left.length > right.length ? 1 : -1;
  return left === right ? 0 : left > right ? 1 : -1;
}

function compareTuples(left, right) {
  for (let index = 0; index < left.length; index += 1) {
    const compared = compareIntegerStrings(left[index], right[index]);
    if (compared !== 0) return compared;
  }
  return 0;
}

function validateVersionCode(value, context) {
  const text = String(value);
  if (!/^[1-9]\d*$/.test(text)) {
    throw new Error(`Invalid Android versionCode in ${context}`);
  }
  const parsed = Number(text);
  if (!Number.isSafeInteger(parsed) || parsed > MAX_ANDROID_VERSION_CODE) {
    throw new Error(`Invalid Android versionCode in ${context}`);
  }
  return parsed;
}

function parsePreviewRelease(release) {
  const tag = typeof release?.tag_name === "string" ? release.tag_name : "";
  if (!tag.startsWith("shlai-preview-v")) return null;

  const tagMatch = tag.match(PREVIEW_TAG);
  if (!tagMatch || release.draft !== false || release.prerelease !== true) {
    throw new Error(`Malformed preview release: ${tag || "missing tag"}`);
  }

  const revisionText = tagMatch[4];
  if (compareIntegerStrings(revisionText, MAX_SAFE_INTEGER_TEXT) > 0) {
    throw new Error(`Preview revision cannot increase safely: ${tag}`);
  }

  const body = typeof release.body === "string" ? release.body : "";
  const versionCodeMatches = [...body.matchAll(/^Android versionCode: ([1-9]\d*)$/gm)];
  if (versionCodeMatches.length !== 1) {
    throw new Error(`Preview release must contain exactly one Android versionCode line: ${tag}`);
  }

  return {
    tag,
    tuple: tagMatch.slice(1),
    revision: Number(revisionText),
    versionCode: validateVersionCode(versionCodeMatches[0][1], tag),
  };
}

function derivePreviewRelease({ upstreamVersion, releases, baselineVersionCode }) {
  const upstreamMatch = String(upstreamVersion).match(UPSTREAM_VERSION);
  if (!upstreamMatch) {
    throw new Error(`Invalid upstream version: ${upstreamVersion}`);
  }

  const baseline = validateVersionCode(baselineVersionCode, "baseline");
  const flattenedReleases = Array.isArray(releases) ? releases.flat() : [];
  const seenTags = new Set();
  let greatest = null;
  let greatestVersionCode = baseline;

  for (const release of flattenedReleases) {
    const parsed = parsePreviewRelease(release);
    if (!parsed) continue;
    if (seenTags.has(parsed.tag)) {
      throw new Error(`Duplicate preview tag: ${parsed.tag}`);
    }
    seenTags.add(parsed.tag);
    if (!greatest || compareTuples(parsed.tuple, greatest.tuple) > 0) {
      greatest = parsed;
    }
    greatestVersionCode = Math.max(greatestVersionCode, parsed.versionCode);
  }

  const upstreamTuple = upstreamMatch.slice(1);
  let revision = 1;
  if (greatest) {
    const upstreamComparison = compareTuples(upstreamTuple, greatest.tuple.slice(0, 3));
    if (upstreamComparison < 0) {
      throw new Error("Repository version must be newer than prior preview release");
    }
    if (upstreamComparison === 0) {
      if (greatest.revision >= Number.MAX_SAFE_INTEGER) {
        throw new Error("Preview revision cannot increase safely");
      }
      revision = greatest.revision + 1;
    }
  }

  if (greatestVersionCode >= MAX_ANDROID_VERSION_CODE) {
    throw new Error("Android versionCode cannot increase");
  }
  const versionCode = greatestVersionCode + 1;
  const tag = `shlai-preview-v${upstreamVersion}.${revision}`;
  if (seenTags.has(tag)) {
    throw new Error(`Preview tag already exists: ${tag}`);
  }

  return {
    revision,
    tag,
    version: `${upstreamVersion}-shlai.${revision}`,
    versionCode,
  };
}

function readCliArguments(argv) {
  if (argv[0] !== "derive") {
    throw new Error("Expected derive command");
  }
  const values = new Map();
  for (let index = 1; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!name?.startsWith("--") || value === undefined) {
      throw new Error("Invalid command arguments");
    }
    values.set(name, value);
  }
  return values;
}

function runCli(argv) {
  const values = readCliArguments(argv);
  const releasesPath = values.get("--releases");
  if (!releasesPath) throw new Error("Missing --releases");
  const result = derivePreviewRelease({
    upstreamVersion: values.get("--version"),
    releases: JSON.parse(fs.readFileSync(releasesPath, "utf8")),
    baselineVersionCode: values.get("--baseline-version-code"),
  });
  process.stdout.write(
    `revision=${result.revision}\ntag=${result.tag}\nversion=${result.version}\nversion_code=${result.versionCode}\n`,
  );
}

if (require.main === module) {
  try {
    runCli(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}

module.exports = {
  compareIntegerStrings,
  compareTuples,
  derivePreviewRelease,
};
