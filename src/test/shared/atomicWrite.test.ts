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

test("atomically replaces long filenames without copying the target basename into the temporary filename", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "sinitek-atomic-long-name-"));
  const filename = `${"a".repeat(240)}.json`;
  const targetPath = path.join(tempDir, filename);
  try {
    await fs.writeFile(targetPath, "original");
    await writeFileAtomically(targetPath, "replacement");
    assert.equal(await fs.readFile(targetPath, "utf8"), "replacement");
    assert.deepEqual(await fs.readdir(tempDir), [filename]);

    writeFileAtomicallySync(targetPath, "sync replacement");
    assert.equal(await fs.readFile(targetPath, "utf8"), "sync replacement");
    assert.deepEqual(await fs.readdir(tempDir), [filename]);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("preserves an existing file mode during atomic replacement", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "sinitek-atomic-mode-"));
  const targetPath = path.join(tempDir, "auth.json");
  try {
    await fs.writeFile(targetPath, "first");
    await fs.chmod(targetPath, 0o600);
    await writeFileAtomically(targetPath, "second");
    assert.equal(await fs.readFile(targetPath, "utf8"), "second");
    assert.equal((await fs.stat(targetPath)).mode & 0o777, 0o600);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("opt-in symlink following replaces the linked file without removing the link or changing mode", async (context) => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "sinitek-atomic-linked-config-"));
  try {
    const target = path.join(tempDir, "existing.json");
    const link = path.join(tempDir, "linked.json");
    await fs.writeFile(target, "original");
    await fs.chmod(target, 0o640);
    const originalMode = (await fs.stat(target)).mode & 0o777;
    try {
      await fs.symlink(path.basename(target), link, "file");
    } catch (error) {
      if (process.platform !== "win32" || (error as NodeJS.ErrnoException).code !== "EPERM") throw error;
      context.skip("Windows does not grant this process permission to create file symlinks");
      return;
    }

    await writeFileAtomically(link, "replacement", { followSymlinks: true });
    assert.equal(await fs.readlink(link), path.basename(target));
    assert.equal(await fs.readFile(target, "utf8"), "replacement");
    assert.equal((await fs.stat(target)).mode & 0o777, originalMode);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

for (const filename of ["config.toml", "auth.json"]) {
  test(`preserves ${filename} when Windows rejects the atomic replacement`, async (context) => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "sinitek-atomic-write-failure-"));
    const targetPath = path.join(tempDir, filename);
    const platform = Object.getOwnPropertyDescriptor(process, "platform")!;
    const renameError = Object.assign(new Error("synthetic rename failure"), { code: "EPERM" });
    try {
      await fs.writeFile(targetPath, "original\n", "utf8");
      Object.defineProperty(process, "platform", { ...platform, value: "win32" });
      const rename = context.mock.method(fs, "rename", async () => { throw renameError; });

      await assert.rejects(writeFileAtomically(targetPath, "replacement\n"), (error) => error === renameError);
      assert.equal(await fs.readFile(targetPath, "utf8"), "original\n");
      assert.deepEqual(await fs.readdir(tempDir), [filename]);
      assert.equal(rename.mock.callCount(), 1);
    } finally {
      Object.defineProperty(process, "platform", platform);
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });
}
