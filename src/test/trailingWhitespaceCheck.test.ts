import test = require("node:test");
import assert = require("node:assert/strict");
import * as childProcess from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const SCRIPT_PATH = path.join(process.cwd(), "scripts", "check_trailing_whitespace.js");

test("trailing whitespace checker reports whitespace in explicit untracked files", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sinitek-whitespace-check-"));
  try {
    const dirtyFile = path.join(tempDir, "untracked.ts");
    fs.writeFileSync(dirtyFile, "export const value = 1;  \n", "utf8");

    const result = childProcess.spawnSync(process.execPath, [SCRIPT_PATH, dirtyFile], {
      cwd: process.cwd(),
      encoding: "utf8",
    });

    assert.equal(result.status, 1);
    assert.match(result.stdout, /untracked\.ts:1: trailing whitespace/u);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("trailing whitespace checker passes clean explicit files", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sinitek-whitespace-check-"));
  try {
    const cleanFile = path.join(tempDir, "clean.ts");
    fs.writeFileSync(cleanFile, "export const value = 1;\n", "utf8");

    const result = childProcess.spawnSync(process.execPath, [SCRIPT_PATH, cleanFile], {
      cwd: process.cwd(),
      encoding: "utf8",
    });

    assert.equal(result.status, 0);
    assert.equal(result.stdout, "");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
