#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const rootDir = path.resolve(__dirname, "..");
const defaultEvidencePath = path.join(
  rootDir,
  "docs/knowledge-base-notes/07-manual-qa-evidence.md",
);

const allowedStatuses = new Set(["Pass", "Fail", "Blocked", "N/A"]);
const readyValues = new Set(["yes", "ready", "pass", "true"]);
const emptyLikeValues = new Set(["none", "n/a", "na", "0"]);
const exceptionPattern = /(exception approved|approved exception|owner-approved|owner approved)/i;

const requiredSessionFields = [
  "Branch",
  "Commit under test",
  "Tester",
  "Test date",
  "`pnpm acceptance:knowledge` result",
  "Desktop platform/build",
  "Mobile platform/build",
  "Second sync device/build",
  "Sync backend and account",
  "AI provider/model",
  "Obsidian/export test folder",
];

const requiredCheckSections = [
  "Automated Baseline",
  "Desktop QA",
  "Mobile QA",
  "AI Knowledge QA",
  "Obsidian And Import/Export QA",
  "Sync QA",
];

const requiredFinalRows = [
  "Ready for PR review?",
  "Blocking failures",
  "Follow-up issues",
  "Reviewer notes",
];

function usage() {
  console.log(
    [
      "Usage: node scripts/check-knowledge-manual-evidence.js [--file <path>] [--allow-incomplete]",
      "",
      "Checks docs/knowledge-base-notes/07-manual-qa-evidence.md for final PR readiness.",
      "",
      "Options:",
      "  --file <path>        Check a different Markdown evidence file.",
      "  --allow-incomplete   Report missing evidence without failing the command.",
      "  --self-test          Run embedded parser/validator checks.",
      "  --help               Show this help.",
    ].join("\n"),
  );
}

function parseArgs(argv) {
  const args = {
    allowIncomplete: false,
    file: defaultEvidencePath,
    help: false,
    selfTest: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--") continue;
    if (arg === "--allow-incomplete") {
      args.allowIncomplete = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      args.help = true;
      continue;
    }
    if (arg === "--self-test") {
      args.selfTest = true;
      continue;
    }
    if (arg === "--file") {
      const file = argv[index + 1];
      if (!file) throw new Error("--file requires a path");
      args.file = path.resolve(process.cwd(), file);
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return args;
}

function splitMarkdownTableRow(line) {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|")) return null;
  const withoutEdges = trimmed.replace(/^\|/, "").replace(/\|$/, "");
  return withoutEdges.split("|").map((cell) => cell.trim());
}

function isSeparatorRow(cells) {
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function normalizeHeader(value) {
  return value.replace(/`/g, "").trim().toLowerCase();
}

function collectTables(markdown) {
  const lines = markdown.split(/\r?\n/);
  const tables = [];
  let section = "";
  let index = 0;

  while (index < lines.length) {
    const heading = lines[index].match(/^##\s+(.+?)\s*$/);
    if (heading) section = heading[1].trim();

    if (!lines[index].trim().startsWith("|")) {
      index += 1;
      continue;
    }

    const startLine = index + 1;
    const tableLines = [];
    while (index < lines.length && lines[index].trim().startsWith("|")) {
      tableLines.push(lines[index]);
      index += 1;
    }

    const rows = tableLines.map(splitMarkdownTableRow).filter((row) => row && row.length > 0);
    if (rows.length < 2) continue;

    const [headers, separator, ...body] = rows;
    if (!isSeparatorRow(separator)) continue;

    tables.push({
      body,
      headers,
      normalizedHeaders: headers.map(normalizeHeader),
      section,
      startLine,
    });
  }

  return tables;
}

function tableMatches(table, headers) {
  const normalized = headers.map(normalizeHeader);
  return (
    table.normalizedHeaders.length === normalized.length &&
    normalized.every((header, index) => table.normalizedHeaders[index] === header)
  );
}

function isBlank(value) {
  return !value || value.trim().length === 0;
}

function isEmptyLike(value) {
  const normalized = value.trim().toLowerCase();
  return emptyLikeValues.has(normalized);
}

function addMessage(messages, section, label, message) {
  messages.push(`[${section}] ${label}: ${message}`);
}

function validateManualEvidence(markdown, options = {}) {
  const allowIncomplete = Boolean(options.allowIncomplete);
  const tables = collectTables(markdown);
  const errors = [];
  const warnings = [];
  const stats = {
    checkRows: 0,
    passRows: 0,
    exceptionRows: 0,
  };

  const sessionTable = tables.find((table) => tableMatches(table, ["Field", "Value"]));
  if (!sessionTable) {
    errors.push("Missing Session Metadata table.");
  } else {
    const metadata = new Map(sessionTable.body.map((row) => [row[0], row[1] ?? ""]));
    for (const field of requiredSessionFields) {
      const value = metadata.get(field);
      if (isBlank(value)) {
        const message = `${field} must be filled.`;
        if (allowIncomplete) warnings.push(`[Session Metadata] ${message}`);
        else errors.push(`[Session Metadata] ${message}`);
      }
    }
  }

  const checkTables = tables.filter((table) =>
    tableMatches(table, ["Check", "Expected", "Status", "Evidence"]),
  );
  const sectionsWithChecks = new Set(checkTables.map((table) => table.section));
  for (const section of requiredCheckSections) {
    if (!sectionsWithChecks.has(section)) {
      errors.push(`Missing required QA table: ${section}.`);
    }
  }

  for (const table of checkTables) {
    for (const row of table.body) {
      const [check, , status = "", evidence = ""] = row;
      stats.checkRows += 1;
      if (!allowedStatuses.has(status)) {
        const message = isBlank(status)
          ? "status is empty"
          : `status "${status}" is not one of ${[...allowedStatuses].join(", ")}`;
        if (allowIncomplete && isBlank(status)) addMessage(warnings, table.section, check, message);
        else addMessage(errors, table.section, check, message);
        continue;
      }

      if (status === "Pass") {
        stats.passRows += 1;
        if (isBlank(evidence)) {
          const message = "Pass rows require evidence.";
          if (allowIncomplete) addMessage(warnings, table.section, check, message);
          else addMessage(errors, table.section, check, message);
        }
        continue;
      }

      if (status === "Fail") {
        addMessage(errors, table.section, check, "Fail means the branch is not ready for PR.");
        if (isBlank(evidence))
          addMessage(errors, table.section, check, "Fail rows require reproduction evidence.");
        continue;
      }

      stats.exceptionRows += 1;
      if (isBlank(evidence)) {
        const message = `${status} rows require an owner-approved exception note.`;
        if (allowIncomplete) addMessage(warnings, table.section, check, message);
        else addMessage(errors, table.section, check, message);
      } else if (!exceptionPattern.test(evidence)) {
        const message = `${status} evidence must include an owner-approved exception marker.`;
        if (allowIncomplete) addMessage(warnings, table.section, check, message);
        else addMessage(errors, table.section, check, message);
      }
    }
  }

  const finalDecisionTable = tables.find((table) => tableMatches(table, ["Decision", "Value"]));
  if (!finalDecisionTable) {
    errors.push("Missing Final Decision table.");
  } else {
    const decisions = new Map(finalDecisionTable.body.map((row) => [row[0], row[1] ?? ""]));
    for (const row of requiredFinalRows) {
      const value = decisions.get(row);
      if (isBlank(value)) {
        const message = `${row} must be filled. Use "None" when there is nothing to list.`;
        if (allowIncomplete) warnings.push(`[Final Decision] ${message}`);
        else errors.push(`[Final Decision] ${message}`);
      }
    }

    const readyValue = decisions.get("Ready for PR review?") ?? "";
    if (!isBlank(readyValue) && !readyValues.has(readyValue.trim().toLowerCase())) {
      errors.push('[Final Decision] Ready for PR review? must be "Yes" when strict checking.');
    }

    const blockingValue = decisions.get("Blocking failures") ?? "";
    if (!isBlank(blockingValue) && !isEmptyLike(blockingValue)) {
      errors.push(
        '[Final Decision] Blocking failures must be "None" or an equivalent empty value.',
      );
    }
  }

  return { errors, stats, warnings };
}

function runSelfTest() {
  const passDoc = [
    "# Manual QA Evidence",
    "",
    "## Session Metadata",
    "",
    "| Field | Value |",
    "| --- | --- |",
    "| Branch | `feat/knowledge-base-notes-research` |",
    "| Commit under test | abc123 |",
    "| Tester | QA |",
    "| Test date | 2026-06-14 |",
    "| `pnpm acceptance:knowledge` result | Pass |",
    "| Desktop platform/build | macOS dev |",
    "| Mobile platform/build | iOS device |",
    "| Second sync device/build | macOS second |",
    "| Sync backend and account | WebDAV test |",
    "| AI provider/model | test model |",
    "| Obsidian/export test folder | /tmp/export |",
    "",
    ...requiredCheckSections.flatMap((section) => [
      `## ${section}`,
      "",
      "| Check | Expected | Status | Evidence |",
      "| --- | --- | --- | --- |",
      "| Sample | Works | Pass | Screenshot: sample.png |",
      "",
    ]),
    "## Final Decision",
    "",
    "| Decision | Value |",
    "| --- | --- |",
    "| Ready for PR review? | Yes |",
    "| Blocking failures | None |",
    "| Follow-up issues | None |",
    "| Reviewer notes | Ready |",
    "",
  ].join("\n");
  const failDoc = passDoc.replace("| Commit under test | abc123 |", "| Commit under test |  |");

  const passResult = validateManualEvidence(passDoc);
  const failResult = validateManualEvidence(failDoc);
  if (passResult.errors.length > 0) {
    throw new Error(`Expected passing fixture, got:\n${passResult.errors.join("\n")}`);
  }
  if (failResult.errors.length === 0) {
    throw new Error("Expected failing fixture to report missing commit under test.");
  }
  console.log("[knowledge-manual-evidence] self-test passed");
}

function printResult(result, options) {
  console.log(
    `[knowledge-manual-evidence] checked ${result.stats.checkRows} QA row(s): ${result.stats.passRows} pass, ${result.stats.exceptionRows} exception`,
  );

  if (result.warnings.length > 0) {
    console.log("[knowledge-manual-evidence] warnings:");
    for (const warning of result.warnings) console.log(`- ${warning}`);
  }

  if (result.errors.length > 0) {
    console.error("[knowledge-manual-evidence] errors:");
    for (const error of result.errors) console.error(`- ${error}`);
    if (options.allowIncomplete) return;
    process.exit(1);
  }

  if (result.warnings.length > 0 && options.allowIncomplete) {
    console.log("[knowledge-manual-evidence] manual QA evidence is incomplete");
    return;
  }

  console.log("[knowledge-manual-evidence] manual QA evidence is ready");
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    usage();
    return;
  }
  if (options.selfTest) {
    runSelfTest();
    return;
  }

  if (!fs.existsSync(options.file)) {
    console.error(`[knowledge-manual-evidence] evidence file does not exist: ${options.file}`);
    process.exit(1);
  }

  const markdown = fs.readFileSync(options.file, "utf8");
  const result = validateManualEvidence(markdown, options);
  printResult(result, options);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
