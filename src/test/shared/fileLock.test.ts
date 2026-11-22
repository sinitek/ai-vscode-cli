import test = require("node:test");
import assert = require("node:assert/strict");
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { performance } from "node:perf_hooks";

import { withFileLockSync } from "../../shared/fileLock";

const REPLACEMENT_MESSAGE = "Refusing to release a replaced lock";

function createLockPath(context: test.TestContext): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "sinitek-file-lock-"));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return path.join(directory, "settings.json.lock");
}

test("the lock is held during the action and released on return or throw", (context) => {
  const lockPath = path.join(path.dirname(createLockPath(context)), "nested", "settings.json.lock");
  const value = withFileLockSync(lockPath, REPLACEMENT_MESSAGE, () => {
    const lock = fs.lstatSync(lockPath);
    assert.equal(lock.isFile(), true);
    if (process.platform !== "win32") assert.equal(lock.mode & 0o077, 0);
    assert.throws(() => fs.openSync(lockPath, "wx", 0o600), { code: "EEXIST" });
    return "completed";
  });
  assert.equal(value, "completed");
  assert.equal(fs.existsSync(lockPath), false);

  const failure = new Error("action failed");
  assert.throws(() => withFileLockSync(lockPath, REPLACEMENT_MESSAGE, () => {
    throw failure;
  }), (error) => error === failure);
  assert.equal(fs.existsSync(lockPath), false);
});

test("closing before unlinking avoids simulated Windows delete-pending contention", (context) => {
  const lockPath = createLockPath(context);
  const close = context.mock.method(fs, "closeSync", fs.closeSync);
  const unlinkSync = fs.unlinkSync;
  const unlink = context.mock.method(fs, "unlinkSync", (filePath: fs.PathLike) => {
    assert.equal(filePath, lockPath);
    assert.throws(() => {
      if (close.mock.callCount() === 0) {
        throw Object.assign(new Error("Lock would be delete-pending"), { code: "EACCES" });
      }
      fs.closeSync(fs.openSync(lockPath, "wx", 0o600));
    }, { code: "EEXIST" });
    unlinkSync(filePath);
  }, { times: 1 });

  withFileLockSync(lockPath, REPLACEMENT_MESSAGE, () => {
    assert.equal(close.mock.callCount(), 0);
    assert.equal(unlink.mock.callCount(), 0);
    assert.equal(fs.existsSync(lockPath), true);
  });
  assert.equal(close.mock.callCount(), 1);
  assert.equal(unlink.mock.callCount(), 1);
  assert.equal(withFileLockSync(lockPath, REPLACEMENT_MESSAGE, () => "acquired"), "acquired");
});

test("a replacement introduced on descriptor close is checked before unlinking", (context) => {
  const lockPath = createLockPath(context);
  const closeSync = fs.closeSync;
  context.mock.method(fs, "closeSync", (descriptor: number) => {
    closeSync(descriptor);
    fs.renameSync(lockPath, `${lockPath}.original`);
    fs.writeFileSync(lockPath, "replacement", { flag: "wx" });
  }, { times: 1 });

  assert.throws(() => withFileLockSync(lockPath, REPLACEMENT_MESSAGE, () => {}), { message: REPLACEMENT_MESSAGE });
  assert.equal(fs.readFileSync(lockPath, "utf8"), "replacement");
});

test("an acquisition permission error fails without retrying or running the action", (context) => {
  const lockPath = createLockPath(context);
  const denied = Object.assign(new Error("Permission denied"), { code: "EACCES" });
  const open = context.mock.method(fs, "openSync", () => { throw denied; });
  const wait = context.mock.method(Atomics, "wait", () => assert.fail("EACCES must not wait"));

  assert.throws(() => withFileLockSync(lockPath, REPLACEMENT_MESSAGE, () => {
    assert.fail("action must not run without the lock");
  }), (error) => error === denied);
  assert.equal(open.mock.callCount(), 1);
  assert.equal(wait.mock.callCount(), 0);
});

test("the lock retries contention after a five-millisecond polling interval", (context) => {
  const lockPath = createLockPath(context);
  fs.writeFileSync(lockPath, "previous owner", { flag: "wx" });
  const wait = context.mock.method(Atomics, "wait", (_pause: Int32Array, index: number, expected: number, timeout?: number) => {
    assert.deepEqual([index, expected, timeout], [0, 0, 5]);
    assert.equal(fs.readFileSync(lockPath, "utf8"), "previous owner");
    fs.unlinkSync(lockPath);
    return "timed-out";
  });

  assert.equal(withFileLockSync(lockPath, REPLACEMENT_MESSAGE, () => fs.statSync(lockPath).size), 0);
  assert.equal(wait.mock.callCount(), 1);
  assert.equal(fs.existsSync(lockPath), false);
});

test("contention times out with EEXIST without reclaiming a stale lock", (context) => {
  const lockPath = createLockPath(context);
  fs.writeFileSync(lockPath, "stale owner", { flag: "wx" });
  fs.utimesSync(lockPath, 0, 0);
  const original = fs.lstatSync(lockPath, { bigint: true });

  const started = performance.now();
  assert.throws(() => withFileLockSync(lockPath, REPLACEMENT_MESSAGE, () => {
    assert.fail("action must not run while another lock exists");
  }), { code: "EEXIST" });
  assert.ok(performance.now() - started >= 1500);
  const current = fs.lstatSync(lockPath, { bigint: true });
  assert.equal(current.ino, original.ino);
  assert.equal(current.mtimeMs, original.mtimeMs);
  assert.equal(fs.readFileSync(lockPath, "utf8"), "stale owner");
});

test("a replacement regular file with a different identity is left untouched", (context) => {
  const lockPath = createLockPath(context);
  assert.throws(() => withFileLockSync(lockPath, REPLACEMENT_MESSAGE, () => {
    fs.renameSync(lockPath, `${lockPath}.original`);
    fs.writeFileSync(lockPath, "replacement", { flag: "wx" });
  }), { message: REPLACEMENT_MESSAGE });
  assert.equal(fs.readFileSync(lockPath, "utf8"), "replacement");
});

test("a replacement symlink is not followed or deleted", { skip: process.platform === "win32" }, (context) => {
  const lockPath = createLockPath(context);
  const originalPath = `${lockPath}.original`;
  assert.throws(() => withFileLockSync(lockPath, REPLACEMENT_MESSAGE, () => {
    fs.renameSync(lockPath, originalPath);
    fs.symlinkSync(originalPath, lockPath);
  }), { message: REPLACEMENT_MESSAGE });
  assert.equal(fs.readlinkSync(lockPath), originalPath);
  assert.equal(fs.statSync(originalPath).isFile(), true);
});
