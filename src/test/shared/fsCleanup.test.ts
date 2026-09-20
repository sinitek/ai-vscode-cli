import test = require("node:test");
import assert = require("node:assert/strict");
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { removeEmptyDirBestEffort, removePathBestEffort } from "../../shared/fsCleanup";

test("best-effort removal deletes an existing tree and ignores missing paths", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sinitek-fs-cleanup-"));
  const nestedFile = path.join(tempDir, "nested", "file.txt");
  fs.mkdirSync(path.dirname(nestedFile), { recursive: true });
  fs.writeFileSync(nestedFile, "payload", "utf8");

  assert.equal(removePathBestEffort(tempDir), true);
  assert.equal(fs.existsSync(tempDir), false);
  assert.equal(removePathBestEffort(tempDir), true);
  assert.equal(removePathBestEffort(""), true);
});

test("best-effort empty dir removal only succeeds for vacant directories", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sinitek-fs-empty-dir-"));
  try {
    const vacant = path.join(tempDir, "vacant");
    const occupied = path.join(tempDir, "occupied");
    fs.mkdirSync(vacant);
    fs.mkdirSync(occupied);
    fs.writeFileSync(path.join(occupied, "keep.txt"), "keep", "utf8");

    assert.equal(removeEmptyDirBestEffort(vacant), true);
    assert.equal(fs.existsSync(vacant), false);
    assert.equal(removeEmptyDirBestEffort(occupied), false);
    assert.equal(fs.existsSync(occupied), true);
    assert.equal(removeEmptyDirBestEffort(path.join(tempDir, "missing")), false);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
