#!/usr/bin/env node

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const rootDir = path.resolve(__dirname, "..");
const knowledgeEditorBundlePath = path.join(
  rootDir,
  "packages/app-expo/assets/editor/knowledge-editor.html",
);
const desktopDistDir = path.join(rootDir, "packages/app/dist");

const knowledgeTests = [
  "src/db/__tests__/knowledge-queries.test.ts",
  "src/db/__tests__/knowledge-source-writeback.test.ts",
  "src/db/__tests__/highlight-queries.test.ts",
  "src/db/__tests__/note-queries.test.ts",
  "src/sync/__tests__/simple-sync.integration.test.ts",
  "src/sync/__tests__/sync-files.test.ts",
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
  "src/ai/__tests__/system-prompt.test.ts",
  "src/ai/__tests__/streaming.test.ts",
  "src/ai/__tests__/reading-agent-tools.test.ts",
  "src/ai/__tests__/tools.test.ts",
  "src/ai/__tests__/knowledge-context.test.ts",
  "src/ai/__tests__/knowledge-memory.test.ts",
  "src/ai/__tests__/tool-call-state.test.ts",
  "src/ai/__tests__/knowledge-tool-result.test.ts",
  "src/ai/__tests__/tool-result.test.ts",
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
  ["pnpm", ["--filter", "app", "exec", "vite", "build"], "desktop production bundle"],
  [
    "pnpm",
    ["--filter", "@readany/app-expo", "exec", "tsc", "--noEmit"],
    "mobile TypeScript",
  ],
];

function readFile(pathname) {
  return fs.existsSync(pathname) ? fs.readFileSync(pathname, "utf8") : null;
}

function readTextBundle(dir, extensions) {
  if (!fs.existsSync(dir)) {
    console.error(`[knowledge-acceptance] desktop production bundle is missing: ${dir}`);
    process.exit(1);
  }

  const stack = [dir];
  const chunks = [];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(entryPath);
        continue;
      }
      if (extensions.has(path.extname(entry.name))) {
        chunks.push(fs.readFileSync(entryPath, "utf8"));
      }
    }
  }

  return chunks.join("\n");
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

function verifyDesktopProductionBundleContract() {
  console.log("\n[knowledge-acceptance] desktop production bundle contract");
  const bundle = readTextBundle(desktopDistDir, new Set([".css", ".html", ".js"]));
  const requiredFragments = [
    "readany-knowledge-editor",
    "knowledgeProposal",
    "knowledgeToolResult",
    "readany-card",
    "readany-internal-link",
    "readany-source-reference",
    "knowledgeDocumentSearchPlaceholder",
    "knowledgeDocumentPath",
    "type: readany-knowledge",
    "readany-knowledge-bundle",
    "book_home",
    "standalone_note",
    "highlight_note",
    "imported_markdown",
    "readany-attachment://",
  ];
  const missingFragments = requiredFragments.filter((fragment) => !bundle.includes(fragment));
  if (missingFragments.length > 0) {
    console.error(
      [
        "[knowledge-acceptance] desktop production bundle is missing knowledge features:",
        ...missingFragments.map((fragment) => `- ${fragment}`),
      ].join("\n"),
    );
    process.exit(1);
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
  verifyKnowledgeEditorBundleContract(after);
}

function verifyKnowledgeEditorBundleContract(bundle) {
  if (!bundle) {
    console.error("[knowledge-acceptance] mobile knowledge editor bundle is missing.");
    process.exit(1);
  }

  const requiredFragments = [
    "window.__ReadAnyKnowledgeEditor",
    "ReactNativeWebView",
    "postMessage",
    "loaded",
    "ready",
    "selectionChanged",
    "contentChanged",
    "heightChanged",
    "focusChanged",
    "error",
    "unknown_command",
    "unknown_message",
    "bridge_error",
    "parse_error",
    "setContent",
    "setEditable",
    "requestContent",
    "runCommand",
    "insertImage",
    "insertInternalLink",
    "insertSourceReference",
    "insertCard",
    "readany-card",
    "readany-internal-link",
    "readany-source-reference",
    "readany-image-missing",
    "readany-attachment://",
  ];
  const missingFragments = requiredFragments.filter((fragment) => !bundle.includes(fragment));
  if (missingFragments.length > 0) {
    console.error(
      [
        "[knowledge-acceptance] mobile knowledge editor bundle is missing bridge features:",
        ...missingFragments.map((fragment) => `- ${fragment}`),
      ].join("\n"),
    );
    process.exit(1);
  }
}

for (const [command, args, label] of commands) {
  runCommand(command, args, label);
}

verifyDesktopProductionBundleContract();
verifyKnowledgeEditorBundle();
runCommand("git", ["diff", "--check"], "diff whitespace check");

console.log("\n[knowledge-acceptance] all automated checks passed");
