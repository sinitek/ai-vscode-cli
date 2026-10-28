import test = require("node:test");
import assert = require("node:assert/strict");
import * as childProcess from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

type TargetRules = {
  resolveTarget: (value: string, platform?: string, arch?: string) => string;
  nativePackages: (target: string) => string[];
  requiredEntries: (target: string) => string[];
  buildIgnoreRules: (baseRules: string, target: string) => string;
  validateEntries: (entries: string[], target: string) => void;
  prepareIgnoreFile: (target: string, outputFile: string, cwd: string) => void;
};

const repoRoot = path.resolve(__dirname, "..", "..", "..");
const helperPath = path.join(repoRoot, "scripts", "vsix_target.js");
const rules: TargetRules = require(helperPath);
const baseRules = fs.readFileSync(path.join(repoRoot, ".vscodeignore"), "utf8");
const { minimatch } = require(require.resolve("minimatch", {
  paths: [path.dirname(require.resolve("@vscode/vsce"))],
})) as { minimatch: (file: string, pattern: string, options: { dot: boolean }) => boolean };
const targets = ["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64", "win32-x64"];

test("VSIX pins the Claude SDK layout supported by universal packaging", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8")) as {
    dependencies: Record<string, string>;
  };
  assert.equal(manifest.dependencies["@anthropic-ai/claude-agent-sdk"], "0.2.12");
});

function isIncluded(file: string, ignoreRules: string): boolean {
  const patterns = ignoreRules.split(/\r?\n/u).map((pattern) => pattern.trim())
    .filter((pattern) => pattern && !pattern.startsWith("#"));
  return !patterns.some((pattern) => !pattern.startsWith("!") && minimatch(file, pattern, { dot: true }))
    || patterns.some((pattern) => pattern.startsWith("!") && minimatch(file, pattern.slice(1), { dot: true }));
}

test("VSIX target selection keeps universal default and resolves host platforms explicitly", () => {
  assert.equal(rules.resolveTarget("universal"), "universal");
  assert.equal(rules.resolveTarget("current", "darwin", "arm64"), "darwin-arm64");
  assert.equal(rules.resolveTarget("current", "win32", "x64"), "win32-x64");
  assert.equal(rules.resolveTarget("linux-x64", "darwin", "arm64"), "linux-x64");
  assert.throws(() => rules.resolveTarget("web"), /不支持的打包平台/);
  assert.throws(() => rules.resolveTarget("current", "linux", "arm"), /不支持的打包平台/);
});

test("universal VSIX retains every bundled SDK platform and installed image dependency", () => {
  assert.equal(rules.buildIgnoreRules(baseRules, "universal"), baseRules);
  const entries = rules.requiredEntries("universal");
  rules.validateEntries(entries, "universal");
  for (const entry of entries) {
    assert.equal(isIncluded(entry, baseRules), true, entry);
  }
  assert.equal(isIncluded("node_modules/@img/sharp-darwin-arm64/lib/sharp-darwin-arm64.node", baseRules), true);
  assert.equal(isIncluded("node_modules/@img/sharp-win32-x64/lib/sharp-win32-x64.node", baseRules), true);
});

for (const target of targets) {
  test(`${target} VSIX retains SDK fallback, native binding, image resources and licenses`, () => {
    const ignoreRules = rules.buildIgnoreRules(baseRules, target);
    const entries = rules.requiredEntries(target);
    rules.validateEntries(entries, target);
    for (const entry of entries) {
      assert.equal(isIncluded(entry, ignoreRules), true, entry);
    }
    for (const name of rules.nativePackages(target)) {
      assert.equal(isIncluded(`node_modules/${name}/lib/runtime-library`, ignoreRules), true);
      assert.equal(isIncluded(`node_modules/${name}/LICENSE`, ignoreRules), true);
    }
    for (const otherTarget of targets.filter((entry) => entry !== target)) {
      const foreignEntries = rules.requiredEntries(otherTarget).filter((entry) => (
        entry.includes("/vendor/ripgrep/") || entry.startsWith("node_modules/@img/")
      ));
      for (const entry of foreignEntries) {
        assert.equal(isIncluded(entry, ignoreRules), false, entry);
      }
    }
    for (const file of ["LICENSE.md", "README.md"]) {
      assert.equal(isIncluded(`node_modules/@anthropic-ai/claude-agent-sdk/${file}`, ignoreRules), true);
    }
  });
}

test("VSIX excludes developer artifacts without excluding embedded workspace scaffold", () => {
  const discarded = [
    "run_dev.py",
    "scripts/export_vscode_extension.py",
    "scripts/publish_vscode_extension.py",
    "scripts/vscode_extension_process.py",
    "scripts/vscode_extension_win.py",
    ".tmp/playwright-smoke/screenshot.png",
    ".tmp/bubble-spacing/webview.html",
    "dist/test/shared/vsixPackaging.test.js",
    "dist/extension.js.map",
    "dist/interactive/claudeRunner.js.map",
    "node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts",
    "node_modules/@anthropic-ai/claude-agent-sdk/bun.lock",
    "media/workspace-scaffold/.agents/skills/ontology/tests/__pycache__/test_search_ontology.cpython-312.pyc",
    "media/workspace-scaffold/.agents/skills/ontology/scripts/__pycache__/cached-module.bin",
  ];
  const retained = [
    "dist/extension.js",
    "dist/interactive/claudeRunner.js",
    "media/config/monaco-editor/0.52.2/min/vs/editor/editor.main.js",
    "media/workspace-scaffold/AGENTS.md",
    "media/workspace-scaffold/.ch/docs/README.md",
    "node_modules/@dagrejs/dagre/dist/dagre.js",
    "node_modules/marked/lib/marked.cjs",
    "node_modules/json-formatter-js/dist/json-formatter.umd.js",
  ];
  for (const target of ["universal", ...targets]) {
    const ignoreRules = rules.buildIgnoreRules(baseRules, target);
    for (const file of discarded) {
      assert.equal(isIncluded(file, ignoreRules), false, file);
    }
    for (const file of retained) {
      assert.equal(isIncluded(file, ignoreRules), true, file);
    }
  }
});

test("VSIX audit rejects missing SDK, platform executable and native image binding", () => {
  const target = "darwin-arm64";
  const entries = rules.requiredEntries(target);
  for (const removed of ["cli.js", "rg", "ripgrep.node", "sharp-darwin-arm64.node"]) {
    assert.throws(() => rules.validateEntries(entries.filter((entry) => !entry.endsWith(`/${removed}`)), target), /缺少.*运行时资源/);
  }
  assert.throws(() => rules.validateEntries([], "universal"), /缺少.*运行时资源/);
  assert.throws(() => rules.validateEntries(entries.concat("node_modules/@img/sharp-win32-x64/package.json"), target), /其他平台资源/);
  assert.throws(() => rules.validateEntries(entries.concat("node_modules/@anthropic-ai/claude-agent-sdk/vendor/ripgrep/x64-linux/rg"), target), /其他平台资源/);
});

test("VSIX preflight writes a separate ignore file and rejects incomplete cross-platform dependencies", (context) => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sinitek-vsix-test-"));
  context.after(() => fs.rmSync(fixtureRoot, { recursive: true, force: true }));
  fs.writeFileSync(path.join(fixtureRoot, ".vscodeignore"), baseRules);
  const outputFile = path.join(fixtureRoot, "target.ignore");
  assert.throws(() => rules.prepareIgnoreFile("win32-x64", outputFile, fixtureRoot), /请在目标平台安装完整依赖/);
  assert.equal(fs.existsSync(outputFile), false);
  for (const entry of rules.requiredEntries("win32-x64")) {
    const fullPath = path.join(fixtureRoot, entry);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, "fixture");
  }
  rules.prepareIgnoreFile("win32-x64", outputFile, fixtureRoot);
  assert.equal(fs.readFileSync(outputFile, "utf8"), rules.buildIgnoreRules(baseRules, "win32-x64"));
  assert.equal(fs.readFileSync(path.join(fixtureRoot, ".vscodeignore"), "utf8"), baseRules);
});

test("VSIX helper reports invalid targets as a nonzero CLI result", () => {
  const result = childProcess.spawnSync(process.execPath, [helperPath, "resolve", "unsupported"], { encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /不支持的打包平台/);
  assert.equal(result.stdout, "");
});

test("VSIX Python export rejects unknown options and incomplete target arguments before building", () => {
  for (const args of [["--target"], ["--unknown"]]) {
    const python = process.env.PYTHON || process.env.PYTHON3 || (process.platform === "win32" ? "python" : "python3");
    const result = childProcess.spawnSync(python, [path.join(repoRoot, "scripts", "export_vscode_extension.py"), ...args], { encoding: "utf8" });
    assert.equal(result.status, 2);
    assert.match(result.stderr, /usage:/);
    assert.doesNotMatch(result.stdout, /Building/);
  }
});

test("VSIX Python export audits current runtime assets rather than removed marketplace catalogs", () => {
  const script = fs.readFileSync(path.join(repoRoot, "scripts", "export_vscode_extension.py"), "utf8");
  const requiredBlock = script.match(/REQUIRED_ENTRIES = \(([\s\S]*?)\n\)/u)?.[1] ?? "";
  const entries = Array.from(requiredBlock.matchAll(/"([^"]+)"/gu), (match) => match[1]);
  assert.ok(entries.length > 0);
  for (const entry of entries) {
    assert.equal(fs.existsSync(path.join(repoRoot, entry)), true, entry);
  }
  assert.ok(entries.includes("media/config/assets/config-app-ui.js"));
  assert.doesNotMatch(requiredBlock, /mcp_marketplace|official_skills_catalog/);
});
