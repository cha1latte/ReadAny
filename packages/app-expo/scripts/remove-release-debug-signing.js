const { readFileSync, writeFileSync } = require("node:fs");

function findMatchingBrace(source, openIndex) {
  let depth = 0;
  let quote = null;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;

  for (let index = openIndex; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1];

    if (lineComment) {
      if (character === "\n") lineComment = false;
      continue;
    }
    if (blockComment) {
      if (character === "*" && next === "/") {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === quote) {
        quote = null;
      }
      continue;
    }
    if (character === "/" && next === "/") {
      lineComment = true;
      index += 1;
      continue;
    }
    if (character === "/" && next === "*") {
      blockComment = true;
      index += 1;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === "{") depth += 1;
    if (character === "}") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }

  throw new Error("Unbalanced Gradle block");
}

function findUniqueBlock(source, name, start = 0, end = source.length) {
  const pattern = new RegExp(`^\\s*${name}\\s*\\{`, "gm");
  const matches = [...source.matchAll(pattern)].filter(
    (match) => match.index >= start && match.index < end,
  );
  if (matches.length !== 1) {
    throw new Error(`Expected exactly one ${name} block, found ${matches.length}`);
  }

  const openIndex = source.indexOf("{", matches[0].index);
  return { openIndex, closeIndex: findMatchingBrace(source, openIndex) };
}

function removeReleaseDebugSigning(source) {
  const buildTypes = findUniqueBlock(source, "buildTypes");
  const release = findUniqueBlock(
    source,
    "release",
    buildTypes.openIndex + 1,
    buildTypes.closeIndex,
  );
  const releaseBody = source.slice(release.openIndex + 1, release.closeIndex);
  const assignmentPattern = /^[\t ]*signingConfig[\t ]+signingConfigs\.debug[\t ]*(?:\r?\n|$)/gm;
  const assignments = releaseBody.match(assignmentPattern) ?? [];

  if (assignments.length !== 1) {
    throw new Error(
      `Expected exactly one release debug-signing assignment, found ${assignments.length}`,
    );
  }

  const updatedReleaseBody = releaseBody.replace(assignmentPattern, "");
  if (assignmentPattern.test(updatedReleaseBody)) {
    throw new Error("Release debug-signing assignment remains after replacement");
  }

  return `${source.slice(0, release.openIndex + 1)}${updatedReleaseBody}${source.slice(release.closeIndex)}`;
}

if (require.main === module) {
  const [buildGradlePath, unexpectedArgument] = process.argv.slice(2);
  if (!buildGradlePath || unexpectedArgument) {
    throw new Error("Usage: node remove-release-debug-signing.js <app/build.gradle>");
  }
  const source = readFileSync(buildGradlePath, "utf8");
  writeFileSync(buildGradlePath, removeReleaseDebugSigning(source), "utf8");
}

module.exports = { removeReleaseDebugSigning };
