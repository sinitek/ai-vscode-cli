#!/usr/bin/env node

const childProcess = require("child_process");
const fs = require("fs");
const path = require("path");

const IGNORED_DIRS = new Set([
  ".git",
  ".codegraph",
  "dist",
  "node_modules",
]);

function main() {
  const roots = process.argv.slice(2);
  const files = roots.length > 0
    ? collectInputFiles(roots)
    : collectGitWorkspaceFiles();
  const findings = [];
  for (const file of files) {
    findings.push(...findTrailingWhitespace(file));
  }
  if (findings.length === 0) {
    return 0;
  }
  findings.forEach((finding) => {
    console.log(`${finding.file}:${finding.line}: trailing whitespace`);
  });
  return 1;
}

function collectInputFiles(inputs) {
  const files = [];
  for (const input of inputs) {
    const resolved = path.resolve(input);
    if (!fs.existsSync(resolved)) {
      continue;
    }
    const stat = fs.statSync(resolved);
    if (stat.isDirectory()) {
      files.push(...walkFiles(resolved));
    } else if (stat.isFile()) {
      files.push(resolved);
    }
  }
  return unique(files);
}

function collectGitWorkspaceFiles() {
  const output = childProcess.execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard"],
    { encoding: "utf8" },
  );
  return output
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((file) => !isIgnoredPath(file))
    .filter((file) => fs.existsSync(file) && fs.statSync(file).isFile());
}

function walkFiles(root) {
  const files = [];
  const entries = fs.readdirSync(root, { withFileTypes: true });
  for (const entry of entries) {
    const absolute = path.join(root, entry.name);
    const relative = path.relative(process.cwd(), absolute);
    if (entry.isDirectory()) {
      if (!isIgnoredPath(relative)) {
        files.push(...walkFiles(absolute));
      }
      continue;
    }
    if (entry.isFile() && !isIgnoredPath(relative)) {
      files.push(absolute);
    }
  }
  return files;
}

function isIgnoredPath(file) {
  return file
    .split(/[\\/]+/u)
    .some((segment) => IGNORED_DIRS.has(segment));
}

function findTrailingWhitespace(file) {
  const buffer = fs.readFileSync(file);
  if (buffer.includes(0)) {
    return [];
  }
  const text = buffer.toString("utf8");
  const findings = [];
  const lines = text.split(/\n/u);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].replace(/\r$/u, "");
    if (/[ \t]+$/u.test(line)) {
      findings.push({
        file: path.relative(process.cwd(), file) || file,
        line: index + 1,
      });
    }
  }
  return findings;
}

function unique(values) {
  return Array.from(new Set(values));
}

process.exitCode = main();
