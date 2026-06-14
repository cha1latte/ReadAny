#!/usr/bin/env node

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const rootDir = path.resolve(__dirname, "..");
const knowledgeEditorBundlePath = path.join(
  rootDir,
  "packages/app-expo/assets/editor/knowledge-editor.html",
);

const knowledgeTests = [
  "src/db/__tests__/knowledge-queries.test.ts",
  "src/sync/__tests__/simple-sync.integration.test.ts",
  "src/knowledge/document-utils.test.ts",
  "src/knowledge/vault-path-fidelity.test.ts",
  "src/knowledge/editor-profile.test.ts",
  "src/knowledge/editor-projection.test.ts",
  "src/knowledge/editor-draft.test.ts",
  "src/knowledge/mobile-editor-bridge.test.ts",
  "src/knowledge/rich-text-preservation.test.ts",
  "src/knowledge/card-registry.test.ts",
  "src/knowledge/attachments.test.ts",
  "src/knowledge/internal-links.test.ts",
  "src/knowledge/source-links.test.ts",
  "src/knowledge/proposals.test.ts",
  "src/knowledge/compact-summary.test.ts",
  "src/ai/__tests__/knowledge-context.test.ts",
  "src/ai/__tests__/knowledge-tool-result.test.ts",
  "src/ai/tools/knowledge-tools.test.ts",
  "src/export/knowledge-exporter.test.ts",
  "src/export/knowledge-importer.test.ts",
];

const commands = [
  [
    "pnpm",
    ["--filter", "@readany/core", "exec", "vitest", "run", ...knowledgeTests],
    "knowledge acceptance tests",
  ],
  ["pnpm", ["--filter", "@readany/core", "exec", "tsc", "--noEmit"], "core TypeScript"],
  ["pnpm", ["--filter", "app", "exec", "tsc", "--noEmit"], "desktop TypeScript"],
  [
    "pnpm",
    ["--filter", "@readany/app-expo", "exec", "tsc", "--noEmit"],
    "mobile TypeScript",
  ],
];

function readFile(pathname) {
  return fs.existsSync(pathname) ? fs.readFileSync(pathname, "utf8") : null;
}

function runCommand(command, args, label) {
  console.log(`\n[knowledge-acceptance] ${label}`);
  const result = spawnSync(command, args, {
    stdio: "inherit",
    shell: process.platform === "win32",
  });

  if (result.error) {
    console.error(`[knowledge-acceptance] Failed to start ${label}: ${result.error.message}`);
    process.exit(1);
  }

  if (result.status !== 0) {
    console.error(`[knowledge-acceptance] ${label} failed with exit code ${result.status}`);
    process.exit(result.status || 1);
  }
}

function verifyKnowledgeEditorBundle() {
  const before = readFile(knowledgeEditorBundlePath);
  runCommand(
    "pnpm",
    ["--filter", "@readany/app-expo", "exec", "node", "scripts/build-knowledge-editor.js"],
    "mobile knowledge editor bundle",
  );
  const after = readFile(knowledgeEditorBundlePath);
  if (before !== after) {
    console.error(
      [
        "[knowledge-acceptance] mobile knowledge editor bundle was regenerated.",
        "Commit packages/app-expo/assets/editor/knowledge-editor.html and rerun pnpm acceptance:knowledge.",
      ].join("\n"),
    );
    process.exit(1);
  }
}

for (const [command, args, label] of commands) {
  runCommand(command, args, label);
}

verifyKnowledgeEditorBundle();
runCommand("git", ["diff", "--check"], "diff whitespace check");

console.log("\n[knowledge-acceptance] all automated checks passed");
