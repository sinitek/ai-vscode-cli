import test = require("node:test");
import assert = require("node:assert/strict");
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

import { writeFileAtomically, writeFileAtomicallySync } from "../../shared/atomicWrite";

test("synchronous atomic writes replace files and preserve the target when replacement fails", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "sinitek-atomic-sync-"));
  const targetPath = path.join(tempDir, "messages.json");
  try {
    writeFileAtomicallySync(targetPath, "first");
    writeFileAtomicallySync(targetPath, "second");
    assert.equal(await fs.readFile(targetPath, "utf8"), "second");
    const blockedPath = path.join(tempDir, "blocked");
    await fs.mkdir(blockedPath);
    await fs.writeFile(path.join(blockedPath, "original"), "original");
    assert.throws(() => writeFileAtomicallySync(blockedPath, "replacement"));
    assert.equal(await fs.readFile(path.join(blockedPath, "original"), "utf8"), "original");
    assert.deepEqual((await fs.readdir(tempDir)).sort(), ["blocked", "messages.json"]);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("atomically overwrites an existing file", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "sinitek-atomic-write-"));
  const targetPath = path.join(tempDir, "config.toml");
  try {
    await writeFileAtomically(targetPath, "first\n");
    await writeFileAtomically(targetPath, "second\n");
    assert.equal(await fs.readFile(targetPath, "utf8"), "second\n");
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});
