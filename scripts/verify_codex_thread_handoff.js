"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const crossSpawn = require("cross-spawn");

async function within(promise, milliseconds, phase = "隔离验证") {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((resolve, reject) => { timer = setTimeout(() => reject(new Error(`${phase}超时`)), milliseconds); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function trackChild(child, command) {
  const state = { command, pid: child.pid, exited: false, closed: false, streams: {} };
  const closures = [new Promise((resolve) => child.once("close", () => { state.closed = true; resolve(); }))];
  child.once("exit", () => { state.exited = true; });
  for (const name of ["stdin", "stdout", "stderr"]) {
    const stream = child[name];
    if (!stream) continue;
    const status = { ended: stream.readableEnded === true, closed: stream.closed === true };
    state.streams[name] = status;
    stream.once("end", () => { status.ended = true; });
    if (!status.closed) closures.push(new Promise((resolve) => stream.once("close", () => { status.closed = true; resolve(); })));
  }
  return { state, done: Promise.all(closures) };
}

async function cleanup({ shutdown, server, tracked, removeRoot, emit, root, timeoutMs = 10000 }) {
  try {
    await within((async () => {
      shutdown();
      server.closeAllConnections();
      const serverClosed = new Promise((resolve, reject) => server.close((error) => {
        if (error && error.code !== "ERR_SERVER_NOT_RUNNING") reject(error);
        else resolve();
      }));
      // Include killers spawned during shutdown; exit alone never settles a tracked child.
      await serverClosed;
      for (let index = 0; index < tracked.length;) {
        const pending = tracked.slice(index);
        index = tracked.length;
        await Promise.all(pending.map((entry) => entry.done));
      }
      assert.ok(tracked.every(({ state }) => !state.pid || (state.exited && state.closed)), "子进程退出尚未确认");
      await removeRoot();
    })(), timeoutMs, "资源清理");
  } catch (error) {
    emit({ phase: "cleanup_failed", root, children: tracked.map((entry) => entry.state), error: error.message });
    throw error;
  }
  emit({ phase: "cleanup_verified", processesExited: true, stdioClosed: true, temporaryDirectoryRemoved: true,
    root, children: tracked.map((entry) => entry.state) });
}

async function main() {
  if (!process.argv.includes("--live")) {
    throw new Error("请先构建，再使用 --live 启动隔离的真实 Codex 进程验证；模型请求只发送到本机测试服务器。");
  }
  const moduleRoot = process.env.SINITEK_CODEX_HANDOFF_MODULE_ROOT || path.join(__dirname, "../dist");
  assert.ok(path.isAbsolute(moduleRoot), "隔离编译目录必须使用绝对路径");
  require(path.join(moduleRoot, "test/vscodeMock")).installVscodeMock();
  const { acquireCodexAppServer, shutdownCodexAppServerPool } = require(path.join(moduleRoot, "interactive/codexAppServerPool"));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sinitek-codex-handoff-"));
  const home = path.join(root, "home");
  const workspace = path.join(root, "workspace");
  fs.mkdirSync(home);
  fs.mkdirSync(workspace);
  let localRequests = 0;
  const server = http.createServer((request, response) => {
    localRequests += 1;
    request.resume();
    response.writeHead(400, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ error: { message: "仅用于隔离写锁验证，不调用真实模型", type: "invalid_request_error" } }));
  });
  const children = [];
  const tracked = [];
  const originalSpawn = crossSpawn.spawn;
  crossSpawn.spawn = (...args) => {
    const child = originalSpawn(...args);
    children.push(child);
    tracked.push(trackChild(child, args[0]));
    return child;
  };
  try {
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = server.address().port;
    fs.writeFileSync(path.join(home, "config.toml"), [
      'model = "local-test"', 'model_provider = "local_test"',
      // An empty HOME otherwise triggers curated plugin git fetches whose Windows
      // launcher can exit before its descendants; they escape taskkill /T and hold stdio.
      '[features]', 'plugins = false',
      '[model_providers.local_test]', 'name = "Local handoff test"',
      `base_url = "http://127.0.0.1:${port}/v1"`, 'wire_api = "responses"', 'requires_openai_auth = false',
    ].join("\n"));
    const env = { CODEX_HOME: home, HOME: home, USERPROFILE: home };
    for (const name of ["PATH", "Path", "PATHEXT", "SystemRoot", "WINDIR", "COMSPEC", "TEMP", "TMP", "TMPDIR", "LOCALAPPDATA", "APPDATA"]) {
      if (process.env[name]) env[name] = process.env[name];
    }
    const spec = {
      command: process.env.CODEX_COMMAND || "codex", args: ["app-server"], cwd: workspace,
      env, codexHomeDir: home, initializeParams: { clientInfo: { name: "sinitek_handoff_probe", version: "1.0.0" } },
    };
    let completeTurn;
    const turnCompleted = new Promise((resolve) => { completeTurn = resolve; });
    const listener = (id) => ({
      id, isActive: () => false, handleServerRequest: () => null, onClosed: () => undefined,
      handleNotification: (message) => {
        if (message.method === "turn/completed") completeTurn();
      },
    });
    const old = acquireCodexAppServer({ ...spec, key: "probe-before" }, listener("a"));
    acquireCodexAppServer({ ...spec, key: "probe-before" }, listener("b"));
    await within(old.whenReady(), 10000);
    const threadParams = { cwd: workspace, approvalPolicy: "never", sandbox: "read-only", model: "local-test", modelProvider: "local_test", persistExtendedHistory: true };
    const started = await within(old.request("a", "thread/start", threadParams), 10000);
    const threadId = started.thread.id;
    await within(old.request("a", "turn/start", { threadId, input: [{ type: "text", text: "只测试本地会话文件的生命周期", text_elements: [] }] }), 10000);
    await within(turnCompleted, 15000);
    assert.ok(localRequests > 0, "必须确认请求发到了本机测试服务器");
    assert.ok(started.thread.path && fs.existsSync(started.thread.path), "必须先创建真实的持久会话");
    const retained = await within(old.request("b", "thread/start", threadParams), 10000, "保留另一会话");
    const next = acquireCodexAppServer({ ...spec, key: "probe-after" }, listener("a-next"));
    await within(next.whenReady(), 10000);
    await assert.rejects(within(next.request("a-next", "thread/resume", { ...threadParams, threadId }), 10000, "复现写锁冲突"), { code: "CODEX_THREAD_WRITER_CONFLICT" });
    console.log(JSON.stringify({ phase: "writer_conflict_reproduced", differentProcesses: children[0].pid !== children[1].pid }));
    old.release("a");
    const start = Date.now();
    await next.withThread("a-next", threadId, async () => {
      const resumed = await within(next.request("a-next", "thread/resume", { ...threadParams, threadId }), 10000, "恢复原会话");
      assert.equal(resumed.thread.id, threadId);
    });
    assert.equal(old.isAlive(), true);
    const loaded = await within(old.request("b", "thread/loaded/list", {}), 10000, "核对已加载会话");
    assert.ok(loaded.data.includes(retained.thread.id), "另一会话必须仍在旧进程内");
    assert.ok(!loaded.data.includes(threadId), "目标会话必须已从旧进程卸载");
    console.log(JSON.stringify({ phase: "handoff_verified", elapsedMs: Date.now() - start, sameThread: true, otherThreadRetained: true, localRequests }));
  } finally {
    try {
      await cleanup({
        shutdown: shutdownCodexAppServerPool, server, tracked, root,
        removeRoot: () => {
          fs.rmSync(root, { recursive: true, force: true });
          assert.equal(fs.existsSync(root), false, "临时目录清理尚未完成");
        },
        emit: (event) => (event.phase === "cleanup_failed" ? console.error : console.log)(JSON.stringify(event)),
      });
    } finally {
      crossSpawn.spawn = originalSpawn;
    }
  }
}

module.exports = { cleanup, trackChild };
if (require.main === module) main().catch((error) => { console.error(error); process.exitCode = 1; });
