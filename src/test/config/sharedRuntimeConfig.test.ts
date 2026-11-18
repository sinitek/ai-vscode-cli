import test = require("node:test");
import assert = require("node:assert/strict");
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { SharedRuntimeConfig } from "../../config/sharedRuntimeConfig";

test("configuration reads ignore a leftover cross-window mutex", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "sinitek-config-snapshot-"));
  try {
    await fs.writeFile(path.join(directory, "mutex"), JSON.stringify({ pid: process.pid, token: "held" }));
    const shared = new SharedRuntimeConfig(directory);
    const snapshot = await shared.read(async () => ({ configId: "first", profileDigest: "digest" }));
    assert.equal(snapshot?.configId, "first");
    assert.equal(snapshot?.ready, true);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("concurrent changes are not serialized by a cross-process lock", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "sinitek-config-race-"));
  try {
    const shared = new SharedRuntimeConfig(directory);
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const first = shared.change(async () => {
      await firstGate;
      return { configId: "first", profileDigest: null };
    });
    const second = await shared.change(async () => ({ configId: "second", profileDigest: null }));
    assert.equal(second.configId, "second");
    releaseFirst();
    await first;
    assert.equal((await shared.read())?.configId, "first");
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("editing a selected profile does not require an idle execution lease", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "sinitek-config-edit-"));
  try {
    const shared = new SharedRuntimeConfig(directory);
    await shared.change(async () => ({ configId: "selected", profileDigest: "before" }));
    let edited = false;
    await shared.edit("selected", async () => { edited = true; }, async () => "after");
    assert.equal(edited, true);
    assert.equal((await shared.read())?.profileDigest, "after");
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
