#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const repoRoot = path.resolve(__dirname, "..");
const compiledTestDir = path.join(repoRoot, "dist", "test");
const args = process.argv.slice(2);

if (args.length > 1 || (args.length === 1 && args[0] !== "--list")) {
  console.error("Usage: node scripts/run_unit_tests.js [--list]");
  process.exit(1);
}

function collectCompiledTests(dir) {
  if (!fs.existsSync(dir)) {
    return [];
  }

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const testFiles = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      testFiles.push(...collectCompiledTests(fullPath));
      continue;
    }

    if (entry.isFile() && entry.name.endsWith(".test.js")) {
      testFiles.push(fullPath);
    }
  }

  return testFiles.sort((a, b) => a.localeCompare(b));
}

const compiledTests = collectCompiledTests(compiledTestDir);

if (compiledTests.length === 0) {
  console.error("No compiled unit tests found under dist/test/**/*.test.js.");
  console.error("Run npm run build before invoking the unit test runner.");
  process.exit(1);
}

if (args[0] === "--list") {
  for (const testFile of compiledTests) {
    console.log(path.relative(repoRoot, testFile));
  }
  process.exit(0);
}

const result = spawnSync(process.execPath, ["--test", ...compiledTests], {
  cwd: repoRoot,
  stdio: "inherit",
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

if (typeof result.status === "number") {
  process.exit(result.status);
}

process.exit(result.signal ? 1 : 0);
