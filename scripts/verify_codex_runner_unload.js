"use strict";

// Public-runner integration coverage. The pool-only verifier intentionally keeps
// its default-delay coverage; neither capability decisions nor spawns are faked here.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { createRequire } = require("node:module");
const { StringDecoder } = require("node:string_decoder");
const { cleanup, trackChild } = require("./verify_codex_thread_handoff");

function verifyRunnerEvidence(evidence) {
  const { processes, capabilities, probes, events, targetThread, peerThread, migrationSeq, peerCheckSeq } = evidence;
  assert.equal(processes.length, 2, "必须由公共 runner 启动两个配置身份的真实 app-server");
  assert.ok(processes.every((entry) => Number.isInteger(entry.pid) && entry.pid > 0));
  assert.notEqual(processes[0].pid, processes[1].pid);
  assert.ok(targetThread && peerThread && targetThread !== peerThread, "必须保留两个不同的原 thread");
  for (const child of processes) {
    const capability = capabilities.find((entry) => entry.command === child.command && entry.seq < child.seq);
    assert.ok(capability, "启动必须有实际能力判定");
    const probe = probes.find((entry) => entry.command === child.command && entry.closed && entry.version === capability.version);
    assert.ok(probe, "必须记录实际目标的版本探测与 close");
    const overrides = child.args.filter((arg) => /^thread_unload_delay_secs\s*=/.test(arg));
    const supported = capability.supported === true && capability.reason === "supported";
    assert.deepEqual(overrides, supported ? ["thread_unload_delay_secs=0"] : [], "只有确认支持才启用零延迟");
    assert.equal(child.args[0], "app-server");
    assert.ok(child.args.includes("--listen") && child.args.includes("stdio://"), "保留 stdio listen");
  }
  const find = (process, method, direction, threadId, after = 0) => events.find((event) =>
    event.process === process && event.method === method && event.direction === direction
    && event.threadId === threadId && event.seq > after);
  const targetStart = find(0, "thread/start", "response", targetThread);
  const peerStart = find(0, "thread/start", "response", peerThread);
  assert.ok(targetStart?.persisted && peerStart, "原会话必须持久化，另一会话必须在旧进程加载");
  assert.ok(targetStart.seq < migrationSeq && peerStart.seq < migrationSeq);
  const unsubscribe = find(0, "thread/unsubscribe", "request", targetThread, migrationSeq);
  const resume = find(1, "thread/resume", "request", targetThread, migrationSeq);
  const resumed = find(1, "thread/resume", "response", targetThread, migrationSeq);
  assert.ok(unsubscribe && resume && resumed && !resumed.failed && resume.seq < resumed.seq, "必须恢复原 thread，不换 thread 或隐式重试");
  assert.equal(events.filter((event) => event.method === "thread/resume" && event.direction === "request" && event.threadId === targetThread).length, 1);
  const release = events.find((event) => event.process === 0 && event.seq > unsubscribe.seq && event.seq < resume.seq
    && ((event.threadId === targetThread && ((event.method === "thread/closed" && event.direction === "notification")
      || (event.method === "thread/unsubscribe" && event.direction === "response" && event.status === "notLoaded")))
      || event.method === "process/exit"));
  assert.ok(release, "ACK、参数、逻辑关闭或 kill 请求不能代替真实释放证据");
  const continued = find(0, "turn/start", "request", peerThread, peerCheckSeq);
  assert.ok(continued && continued.seq > resumed.seq, "另一原 thread 必须继续在旧进程运行");
  assert.ok(!events.some((event) => event.seq > migrationSeq && event.threadId === peerThread
    && ["thread/start", "thread/resume", "thread/closed", "thread/unsubscribe"].includes(event.method)), "另一会话不得重新加载、迁移或卸载");
  assert.ok(!events.some((event) => event.process === 0 && event.method === "process/exit" && event.seq < continued.seq));
  for (const [process, threadId, after] of [[0, targetThread, targetStart.seq], [0, peerThread, peerStart.seq], [1, targetThread, resumed.seq], [0, peerThread, peerCheckSeq]]) {
    const turn = find(process, "turn/start", "request", threadId, after);
    assert.ok(turn && find(process, "turn/completed", "notification", threadId, turn.seq)?.status === "failed", "每次公共 runner 调用必须完成隔离模型回合");
  }
  assert.ok(evidence.localRequests >= 4);
  assert.ok(Number.isFinite(evidence.elapsedMs) && evidence.elapsedMs >= 0 && evidence.elapsedMs < 75000);
  assert.ok(evidence.cleanup && ["processesExited", "stdioClosed", "temporaryDirectoryRemoved"].every((key) => evidence.cleanup[key] === true), "清理必须完整确认");
  return { sameThread: true, otherThreadRetained: true, releaseEvidence: release.method === "thread/unsubscribe" ? "notLoaded" : release.method,
    immediateThreadUnload: capabilities[0].supported === true && capabilities[0].reason === "supported", elapsedMs: evidence.elapsedMs };
}

async function within(promise, timeoutMs, phase) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`${phase}超时`)), timeoutMs);
    })]);
  } finally { clearTimeout(timer); }
}

async function waitFor(predicate, timeoutMs, phase) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error(`${phase}超时`);
    await new Promise((resolve) => setTimeout(resolve, Math.min(20, remaining)));
  }
}

async function main(args = process.argv.slice(2)) {
  assert.ok(args.includes("--live"), "请构建后显式使用 --live；只访问临时 HOME 和本机模拟模型");
  assert.ok(args.every((arg, index) => arg === "--live" || arg === "--report" || args[index - 1] === "--report"), "未知参数");
  const reportIndex = args.indexOf("--report");
  assert.ok(reportIndex < 0 || (args[reportIndex + 1] && !args[reportIndex + 1].startsWith("--")), "缺少报告路径");
  const reportPath = path.resolve(reportIndex < 0
    ? path.join(os.tmpdir(), `sinitek-codex-runner-unload-${Date.now()}-${process.pid}.json`) : args[reportIndex + 1]);
  assert.ok(!fs.existsSync(reportPath), "不能覆盖已有验证报告");
  // Loop workspaces may link scripts to the repository while compiling in cwd.
  // Consume this invocation's build, never an older dist beside the linked script.
  const moduleRoot = process.env.SINITEK_CODEX_HANDOFF_MODULE_ROOT || path.resolve("dist");
  assert.ok(path.isAbsolute(moduleRoot), "编译目录必须使用绝对路径");
  // Windows permits differently cased module paths to create distinct cache entries.
  // Intercept the runner's dependency instance, including explicit module-root runs.
  const crossSpawn = createRequire(path.join(moduleRoot, "interactive/codexRunner.js"))("cross-spawn");
  require(path.join(moduleRoot, "test/vscodeMock")).installVscodeMock();
  const capabilityModule = require(path.join(moduleRoot, "interactive/codexAppServerCapabilities"));
  const originalCapability = capabilityModule.resolveCodexThreadUnloadCapability;
  const originalSpawn = crossSpawn.spawn;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sinitek-codex-runner-"));
  const home = path.join(root, "home");
  const workspace = path.join(root, "workspace");
  fs.mkdirSync(home); fs.mkdirSync(workspace);
  const evidence = { environment: { platform: process.platform, arch: process.arch, node: process.version },
    processes: [], probes: [], capabilities: [], events: [], localRequests: 0 };
  let sequence = 0;
  let observationError;
  const tracked = [];
  const runners = [];
  const probeHomes = new Set();
  const threadPaths = new Map();
  const record = (event) => {
    if (evidence.events.length >= 5000) { observationError = new Error("协议证据超过限额"); return; }
    evidence.events.push({ ...event, seq: ++sequence, at: Date.now() });
  };
  const server = http.createServer((request, response) => {
    evidence.localRequests += 1;
    request.resume();
    response.writeHead(400, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ error: { message: "isolated runner lifecycle test", type: "invalid_request_error" } }));
  });
  capabilityModule.resolveCodexThreadUnloadCapability = async (input) => {
    const result = await originalCapability(input);
    evidence.capabilities.push({ command: input.command, ...result, seq: ++sequence });
    return result;
  };
  crossSpawn.spawn = (command, spawnArgs, options) => {
    const child = originalSpawn(command, spawnArgs, options);
    tracked.push(trackChild(child, command));
    if (spawnArgs.includes("--version")) {
      const probe = { command, closed: false };
      evidence.probes.push(probe);
      probeHomes.add(options.env.CODEX_HOME);
      let output = "";
      child.stdout.on("data", (chunk) => { if (output.length < 4096) output += chunk.toString("utf8"); });
      child.once("close", () => {
        probe.closed = true;
        probe.version = /^codex-cli (\S+)\s*$/.exec(output.trim())?.[1];
      });
    }
    if (!spawnArgs.includes("app-server")) return child;
    const index = evidence.processes.length;
    evidence.processes.push({ command, args: [...spawnArgs], pid: child.pid, seq: ++sequence });
    const pending = new Map();
    const observe = (message, direction) => {
      if (!message || typeof message !== "object") return;
      if (direction === "request") {
        if (message.id !== undefined) pending.set(message.id, { method: message.method, threadId: message.params?.threadId });
        record({ process: index, direction, method: message.method, threadId: message.params?.threadId });
      } else if (message.id !== undefined && pending.has(message.id)) {
        const request = pending.get(message.id); pending.delete(message.id);
        const thread = message.result?.thread;
        if (thread?.path && !path.relative(root, thread.path).startsWith("..")) threadPaths.set(thread.id, thread.path);
        const persisted = Boolean(thread?.path && path.relative(root, thread.path) && !path.relative(root, thread.path).startsWith("..") && fs.existsSync(thread.path));
        record({ process: index, direction: "response", method: request.method, threadId: thread?.id || request.threadId,
          status: message.result?.status, persisted, failed: Boolean(message.error) });
      } else if (message.method) {
        record({ process: index, direction: "notification", method: message.method,
          threadId: message.params?.threadId || message.params?.thread?.id, status: message.params?.turn?.status });
      }
    };
    const parser = (direction) => {
      const decoder = new StringDecoder("utf8");
      let buffer = "";
      return (chunk) => {
        buffer += typeof chunk === "string" ? chunk : decoder.write(chunk);
        if (buffer.length > 1024 * 1024) { observationError = new Error("协议行超过限额"); buffer = ""; return; }
        const lines = buffer.split("\n"); buffer = lines.pop();
        for (const line of lines) { try { observe(JSON.parse(line), direction); } catch (error) { observationError = error; } }
      };
    };
    const outgoing = parser("request");
    const write = child.stdin.write;
    child.stdin.write = function (chunk, ...rest) { outgoing(chunk); return write.call(this, chunk, ...rest); };
    child.stdout.on("data", parser("notification"));
    child.once("exit", () => record({ process: index, method: "process/exit", direction: "lifecycle" }));
    return child;
  };
  const { CodexInteractiveRunner } = require(path.join(moduleRoot, "interactive/codexRunner"));
  const { shutdownCodexAppServerPool } = require(path.join(moduleRoot, "interactive/codexAppServerPool"));
  let failure;
  try {
    await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
    fs.writeFileSync(path.join(home, "config.toml"), [
      'model = "local-test"', 'model_provider = "local_test"', '[features]', 'plugins = false',
      '[model_providers.local_test]', 'name = "Isolated public runner test"',
      `base_url = "http://127.0.0.1:${server.address().port}/v1"`, 'wire_api = "responses"', 'requires_openai_auth = false',
    ].join("\n"));
    const env = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (["PATH", "PATHEXT", "SYSTEMROOT", "WINDIR", "COMSPEC"].includes(key.toUpperCase())) env[key] = value;
    }
    for (const key of ["HOME", "USERPROFILE", "CODEX_HOME", "CODEX_HOME_DIR", "APPDATA", "LOCALAPPDATA", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_STATE_HOME", "XDG_CACHE_HOME", "TMPDIR", "TMP", "TEMP"]) env[key] = home;
    const options = { command: process.env.CODEX_COMMAND || "codex", args: [], cwd: workspace, env,
      thinkingMode: "medium", interactiveMode: "coding", readOnly: true, threadId: null, configFingerprint: "isolated-before" };
    const target = new CodexInteractiveRunner(options);
    const peer = new CodexInteractiveRunner(options);
    runners.push(target, peer);
    async function turn(runner) {
      const before = sequence;
      const requests = evidence.localRequests;
      let rejected = false;
      try {
        // Bounds the harness only; the product's 75s handoff deadline is unchanged.
        await within(runner.runStreamed("Isolated lifecycle test; no external model.", {
          onAssistantDelta() {}, onTrace() {}, onTaskListUpdate() {}, onThreadId() {},
        }), 100000, "公共 runner 回合");
      } catch (error) {
        // A harness timeout or unrelated runner failure must never become an
        // expected model rejection merely because a local request was observed.
        assert.match(String(error?.message || ""), /isolated runner lifecycle test/, "必须由本地模拟响应拒绝，不能吞掉其它 runner 错误");
        rejected = true;
      }
      if (observationError) throw observationError;
      assert.ok(rejected && evidence.localRequests > requests, "只允许本地模拟模型造成的预期失败");
      await waitFor(() => evidence.events.some((event) => event.seq > before && event.method === "turn/completed"
        && event.threadId === runner.getThreadId() && event.status === "failed"), 3000, "原生 turn/completed");
      for (const event of evidence.events) {
        if (event.method === "thread/start" && event.direction === "response" && threadPaths.has(event.threadId)) {
          event.persisted = fs.existsSync(threadPaths.get(event.threadId));
        }
      }
    }
    await turn(target); evidence.targetThread = target.getThreadId();
    await turn(peer); evidence.peerThread = peer.getThreadId();
    assert.equal(evidence.processes.length, 1, "两个初始 runner 必须共享旧进程");
    evidence.migrationSeq = ++sequence;
    target.updateOptions({ ...options, threadId: evidence.targetThread, configFingerprint: "isolated-after" });
    await turn(target);
    assert.equal(target.getThreadId(), evidence.targetThread);
    evidence.peerCheckSeq = ++sequence;
    await turn(peer);
    assert.equal(peer.getThreadId(), evidence.peerThread);
    const unsubscribe = evidence.events.find((event) => event.seq > evidence.migrationSeq && event.method === "thread/unsubscribe" && event.direction === "request");
    const resume = evidence.events.find((event) => event.seq > evidence.migrationSeq && event.method === "thread/resume" && event.direction === "request");
    assert.ok(unsubscribe && resume);
    evidence.elapsedMs = resume.at - unsubscribe.at;
  } catch (error) { failure = error; }
  finally {
    try {
      await cleanup({ shutdown: () => { for (const runner of runners) runner.dispose(); shutdownCodexAppServerPool(); },
        server, tracked, root,
        removeRoot: () => {
          for (const probeHome of probeHomes) assert.equal(fs.existsSync(probeHome), false, "能力探测临时 HOME 必须在 close 后清理");
          fs.rmSync(root, { recursive: true, force: true });
          assert.equal(fs.existsSync(root), false);
        },
        emit: (event) => { evidence.cleanup = event; console.log(JSON.stringify(event)); },
      });
    } catch (error) { failure = failure || error; }
    finally {
      crossSpawn.spawn = originalSpawn;
      capabilityModule.resolveCodexThreadUnloadCapability = originalCapability;
    }
  }
  const report = { passed: false, evidence, notCovered: ["原生 macOS/Linux", "真实 VS Code 多窗口", "其它 CLI", "真实模型执行", "有效配置内容指纹算法（本脚本显式切换身份）"] };
  try {
    if (failure) throw failure;
    report.verified = verifyRunnerEvidence(evidence);
    report.passed = true;
  } catch (error) { report.failure = error.message; }
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, { flag: "wx" });
  console.log(JSON.stringify({ phase: "runner_handoff_verified", passed: report.passed, ...report.verified, reportPath, failure: report.failure }));
  if (!report.passed) throw new Error(report.failure);
  return report;
}

module.exports = { verifyRunnerEvidence, waitFor };
if (require.main === module) main().catch((error) => { console.error(error); process.exitCode = 1; });
