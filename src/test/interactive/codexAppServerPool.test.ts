import * as assert from "node:assert/strict";
import { test } from "node:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { once } from "node:events";
import type { ChildProcess } from "node:child_process";

import { installVscodeMock } from "../vscodeMock";

installVscodeMock();

const {
  countAliveCodexAppServerConnections,
  countAliveConnections,
  buildCodexAppServerConnectionKey,
  acquireCodexAppServer,
} = require("../../interactive/codexAppServerPool") as typeof import("../../interactive/codexAppServerPool");

test("real protocol subprocesses share an identity but isolate changed configuration while another tab retains the old process", { timeout: 10000 }, async () => {
  const source = `const readline = require("readline");
readline.createInterface({ input: process.stdin }).on("line", line => {
  const message = JSON.parse(line);
  if (message.id !== undefined) process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { pid: process.pid } }) + "\\n");
});`;
  const spec = { command: process.execPath, args: ["-e", source], env: process.env, codexHomeDir: "synthetic-codex-home", initializeParams: {} };
  const listener = (id: string) => ({
    id, isActive: () => false, handleNotification: () => undefined,
    handleServerRequest: () => null, onClosed: () => undefined,
  });
  const beforeKey = buildCodexAppServerConnectionKey({ ...spec, modelProvider: "gateway", configFingerprint: "before" });
  const afterKey = buildCodexAppServerConnectionKey({ ...spec, modelProvider: "gateway", configFingerprint: "after" });
  const before = acquireCodexAppServer({ ...spec, key: beforeKey }, listener("tab-a"));
  const retained = acquireCodexAppServer({ ...spec, key: beforeKey }, listener("tab-b"));
  const after = acquireCodexAppServer({ ...spec, key: afterKey }, listener("tab-a-new"));
  try {
    await Promise.all([before.whenReady(), after.whenReady()]);
    assert.equal(before, retained);
    assert.notEqual(before, after);
    const oldProcess = await before.request<{ pid: number }>("tab-b", "test/pid", {});
    const newProcess = await after.request<{ pid: number }>("tab-a-new", "test/pid", {});
    assert.notEqual(oldProcess.pid, newProcess.pid);
    before.release("tab-a");
    assert.equal(before.isAlive(), true);
    assert.deepEqual(await retained.request("tab-b", "test/pid", {}), oldProcess);
    assert.equal(after.isAlive(), true);
  } finally {
    before.release("tab-a");
    before.release("tab-b");
    after.release("tab-a-new");
  }
});

test("the same provider uses distinct pooled processes after config or auth changes", () => {
  const input = { command: "codex", args: [], cwd: "/workspace", codexHomeDir: "/home/codex", modelProvider: "gateway" };
  const first = buildCodexAppServerConnectionKey({ ...input, configFingerprint: "config-and-auth-before" });
  assert.equal(buildCodexAppServerConnectionKey({ ...input, configFingerprint: "config-and-auth-before" }), first);
  assert.notEqual(buildCodexAppServerConnectionKey({ ...input, configFingerprint: "config-and-auth-after" }), first);
});

test("counts only connections whose process is still alive", () => {
  assert.equal(countAliveConnections([]), 0);
  assert.equal(countAliveConnections([
    { isAlive: () => false },
    { isAlive: () => true },
    { isAlive: () => true },
  ]), 2);
  assert.equal(typeof countAliveCodexAppServerConnections(), "number");
  assert.ok(countAliveCodexAppServerConnections() >= 0);
});

test("does not hide a connection liveness failure", () => {
  assert.throws(() => countAliveConnections([
    { isAlive: () => { throw new Error("liveness failed"); } },
  ]), /liveness failed/);
});

for (const releaseSupported of [true, false]) {
  test(`owned thread release preserves another real process owner (native release=${releaseSupported})`, { timeout: 10000 }, async () => {
    // Fixed protocol fixture; no model, credentials or user configuration.
    const source = `require('readline').createInterface({input:process.stdin}).on('line',line=>{
      const m=JSON.parse(line);if(m.id===undefined)return;
      const response=m.method==='thread/unsubscribe'
        ? ${releaseSupported ? "{result:{status:'notLoaded'}}" : "{error:{code:-32601,message:'fixture unsupported'}}"}
        : {result:{pid:process.pid}};
      process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,...response})+'\\n');
    });`;
    const spec = { key: `owner-release-fixture-${releaseSupported}`, command: process.execPath, args: ["-e", source],
      env: { PATH: process.env.PATH }, codexHomeDir: "synthetic-owner-release-home", initializeParams: {} };
    const listener = (id: string) => ({ id, isActive: () => false, handleNotification: () => {}, handleServerRequest: () => null, onClosed: () => {} });
    const connection = acquireCodexAppServer(spec, listener("owner-a"));
    acquireCodexAppServer(spec, listener("owner-b"));
    try {
      await connection.whenReady();
      connection.claimThread("thread-a", "owner-a"); connection.claimThread("thread-b", "owner-b");
      const before = await connection.request<{ pid: number }>("owner-b", "fixture/pid", {});
      const wrong = await connection.releaseOwnedThreadWithEvidence("owner-b", "thread-a");
      assert.equal(wrong.runner.status, "unobservable");
      assert.equal(connection.retainerCount(), 2);
      const busy = await connection.withThread("owner-a", "thread-a", () => connection.releaseOwnedThreadWithEvidence("owner-a", "thread-a"));
      assert.equal(busy.runner.status, "unobservable");
      const released = await connection.releaseOwnedThreadWithEvidence("owner-a", "thread-a", { timeoutMs: 1500 });
      assert.equal(released.runner.status, releaseSupported ? "confirmed" : "unobservable");
      assert.equal(released.streams.status, "unobservable", "a shared live read loop is not complete drain proof");
      assert.equal(connection.retainerCount(), releaseSupported ? 1 : 2);
      assert.equal(connection.hasLoadedThread("thread-a"), !releaseSupported);
      assert.equal(connection.hasLoadedThread("thread-b"), true);
      assert.deepEqual(await connection.request("owner-b", "fixture/pid", {}), before);
    } finally {
      connection.release("owner-a"); connection.release("owner-b");
      const ended = await connection.observeProcessTermination();
      assert.equal(ended.processTerminal.status, "confirmed");
      assert.notEqual(ended.streams.status, "confirmed", "forced reader.close cannot manufacture drain");
    }
  });
}

for (const releaseBeforeExit of [false, true]) {
  test(`owned thread release waits for actual close after exit clears loaded threads (releaseBeforeExit=${releaseBeforeExit})`,
    { timeout: 10000 }, async (t) => {
      const directory = fs.mkdtempSync(path.join(os.tmpdir(), "codex-owner-exit-close-"));
      const gate = path.join(directory, "release-tail");
      t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
      // The parent exits; its fixed helper retains the real pipes until the test
      // opens the gate. This makes exit-before-close deterministic without PIDs
      // or a timeout being used as termination evidence.
      const helper = `const fs=require('fs');const gate=process.argv[1];
        const finish=()=>{if(!fs.existsSync(gate))return;watcher.close();process.stdout.write('\\n',()=>process.exit(0));};
        const watcher=fs.watch(require('path').dirname(gate),finish);process.send('ready');finish();`;
      const source = `const {spawn}=require('child_process');let exiting=false;
        require('readline').createInterface({input:process.stdin}).on('line',line=>{
          const m=JSON.parse(line);if(m.id===undefined)return;
          if(m.method==='fixture/exit'||m.method==='thread/unsubscribe'){
            if(exiting)return;exiting=true;
            const helper=spawn(process.execPath,['-e',${JSON.stringify(helper)},${JSON.stringify(gate)}],
              {stdio:['ignore',process.stdout,process.stderr,'ipc']});
            helper.once('message',()=>{helper.disconnect();process.stdout.write(JSON.stringify({id:m.id,result:{status:'unsubscribed'}})+'\\n',()=>process.exit(0));});
          }else process.stdout.write(JSON.stringify({id:m.id,result:{pid:process.pid}})+'\\n');
        });`;
      const listener = (id: string) => ({ id, isActive: () => false, handleNotification: () => {},
        handleServerRequest: () => null, onClosed: () => {} });
      const spec = { key: `exit-close-${directory}`, command: process.execPath, args: ["-e", source],
        env: { PATH: process.env.PATH }, codexHomeDir: directory, initializeParams: {} };
      const connection = acquireCodexAppServer(spec, listener("owner-a"));
      acquireCodexAppServer(spec, listener("owner-b"));
      const peer = acquireCodexAppServer({ ...spec, key: `peer-${directory}`,
        args: ["-e", `require('readline').createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);if(m.id!==undefined)process.stdout.write(JSON.stringify({id:m.id,result:{pid:process.pid}})+'\\n');});`] }, listener("peer"));
      let release: ReturnType<typeof connection.releaseOwnedThreadWithEvidence> | undefined;
      try {
        await Promise.all([connection.whenReady(), peer.whenReady()]);
        connection.claimThread("thread-a", "owner-a"); connection.claimThread("thread-b", "owner-b");
        const peerBefore = await peer.request("peer", "fixture/pid", {});
        const child = (connection as unknown as { child: ChildProcess }).child;
        const exited = once(child, "exit");
        let closed = false; child.once("close", () => { closed = true; });
        if (releaseBeforeExit) release = connection.releaseOwnedThreadWithEvidence("owner-a", "thread-a");
        else await connection.request("owner-a", "fixture/exit", {});
        await exited;
        assert.equal(connection.hasLoadedThread("thread-a"), false, "exit cleared bookkeeping, not a native unload");
        assert.equal(closed, false);
        release ??= connection.releaseOwnedThreadWithEvidence("owner-a", "thread-a");
        let releaseSettled = false; void release.then(() => { releaseSettled = true; });
        await new Promise<void>((resolve) => setImmediate(resolve));
        assert.equal(releaseSettled, false, "empty Map must not report native-thread-unloaded");
        assert.equal(connection.retainerCount(), 2, "exit alone does not detach the owner");
        assert.deepEqual(await peer.request("peer", "fixture/pid", {}), peerBefore);
        fs.writeFileSync(gate, "go");
        const evidence = await release;
        assert.equal(closed, true);
        assert.deepEqual(evidence.runner, { status: "confirmed", evidence: "owned-thread-process-closed-and-listener-detached" });
        assert.notEqual(evidence.streams.status, "confirmed", "stdin/forced reader close do not manufacture a complete receipt");
        assert.deepEqual(await peer.request("peer", "fixture/pid", {}), peerBefore);
      } finally {
        fs.writeFileSync(gate, "go");
        await release;
        connection.release("owner-a"); connection.release("owner-b"); peer.release("peer");
        await Promise.all([connection.observeProcessTermination(), peer.observeProcessTermination()]);
      }
    });
}
