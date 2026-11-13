"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crossSpawn = require("cross-spawn");

const repoRoot = path.resolve(__dirname, "..");
const liveScript = path.join(__dirname, "verify_codex_thread_handoff.js");
const runnerScript = path.join(__dirname, "verify_codex_runner_unload.js");
// These clocks start only after terminal failure, never during initialization or handoff.
const FAILURE_EXIT_GRACE_MS = 5000;
const FAILURE_OUTPUT_DRAIN_MS = 5000;

function parseEvent(line) {
  try {
    const event = JSON.parse(line);
    return event && typeof event === "object" ? event : null;
  } catch { return null; }
}

function parseOptions(args) {
  const options = { live: false, help: false, runs: 3, report: null };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--live") options.live = true;
    else if (argument === "--help") options.help = true;
    else if (argument === "--runs" || argument === "--report") {
      const value = args[++index];
      if (!value || value.startsWith("--")) throw new Error(`${argument} 缺少参数`);
      if (argument === "--runs") {
        if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 20) {
          throw new Error("--runs 必须是 1 到 20 的整数");
        }
        options.runs = Number(value);
      } else options.report = path.resolve(value);
    } else throw new Error(`未知参数：${argument}`);
  }
  if (!options.live && !options.help) throw new Error("请使用 --live 确认启动隔离的真实 Codex 验收");
  return options;
}

function verifyLiveResult(result) {
  assert.ok(!result.error, result.error || "子进程启动失败");
  assert.equal(result.signal, null, "验证进程被信号终止，不能判定通过");
  assert.equal(result.status, 0, "验证进程非正常退出，包含清理失败的情况");
  assert.ok(!result.supervision || (result.supervision.closed && !result.supervision.terminationAttempted), "验证进程必须正常关闭，强制收尾不能算通过");
  const events = [];
  for (const line of result.stdout.split(/\r?\n/)) {
    const event = parseEvent(line);
    if (event) events.push(event);
  }
  assert.ok(![...events, ...result.stderr.split(/\r?\n/).map(parseEvent)].some((event) => event?.phase === "cleanup_failed"), "cleanup_failed：资源清理未完成，不能判定通过");
  const conflicts = events.filter((event) => ["writer_conflict_reproduced", "writer_conflict_prevented"].includes(event.phase));
  const handoffs = events.filter((event) => event.phase === "handoff_verified");
  const cleanups = events.filter((event) => event.phase === "cleanup_verified");
  assert.equal(conflicts.length, 1, "必须且只能成功复现一次真实写锁冲突");
  assert.equal(handoffs.length, 1, "缺少完整的 handoff_verified；仅复现冲突不算修复通过");
  assert.equal(cleanups.length, 1, "必须且只能出现一次 cleanup_verified 清理成功证据");
  const conflict = conflicts[0];
  const handoff = handoffs[0];
  const cleanup = cleanups[0];
  assert.ok(events.indexOf(conflict) < events.indexOf(handoff) && events.indexOf(handoff) < events.indexOf(cleanup), "验证阶段顺序错误：必须依次冲突、交接、清理");
  assert.equal(conflict.differentProcesses, true, "必须使用两个不同的真实进程");
  if (conflict.phase === "writer_conflict_prevented") {
    assert.equal(conflict.ownershipGuard, true, "专属连接必须实际拒绝其它 owner");
    assert.equal(handoff.connectionPolicy, "exclusive");
    assert.equal(handoff.releaseEvidence, "process/exit");
    assert.equal(handoff.originalProcessExited, true, "专属策略必须确认原进程退出");
  }
  assert.equal(handoff.sameThread, true, "必须恢复原会话，不能新建会话绕过问题");
  assert.equal(handoff.otherThreadRetained, true, "旧进程中的另一会话必须保留");
  assert.ok(Number.isInteger(handoff.localRequests) && handoff.localRequests > 0, "必须实际访问本机模拟服务");
  assert.ok(Number.isFinite(handoff.elapsedMs) && handoff.elapsedMs >= 0, "必须记录有效的交接耗时");
  for (const field of ["processesExited", "stdioClosed", "temporaryDirectoryRemoved"]) {
    assert.equal(cleanup[field], true, `cleanup_verified.${field} 必须严格为 true`);
  }
  return { ...handoff, differentProcesses: true, resourceCleanup: "verified" };
}

function regressionTests() {
  const directory = path.join(repoRoot, "dist/test/interactive");
  const tests = fs.readdirSync(directory)
    .filter((name) => /^(codex.*|manager|runnerLifecycle.*)\.test\.js$/.test(name))
    .map((name) => path.join(directory, name));
  tests.push(...[
    "core/promptRetry.test.js",
    "core/contextCompactionRunner.test.js",
    "core/codexThreadHandoffAcceptance.test.js",
  ].map((name) => path.join(repoRoot, "dist/test", name)));
  for (const required of ["codexThreadHandoff.test.js", "codexRunnerProcess.test.js"]) {
    assert.ok(tests.some((file) => path.basename(file) === required), `缺少必要回归测试：${required}`);
  }
  for (const file of tests) assert.ok(fs.existsSync(file), `缺少编译后的测试：${file}`);
  return tests.sort();
}

function runCommand(command, args, echo = true, runtime = { spawn: crossSpawn.spawn, setTimeout, clearTimeout }, options = {}) {
  // Only supervise the verifier we create directly. Never signal diagnostic PIDs or a process tree.
  const supervise = command === process.execPath && [liveScript, runnerScript].includes(args[0]) && args.includes("--live");
  return new Promise((resolve) => {
    const child = runtime.spawn(command, args, {
      cwd: repoRoot, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
      ...(options.env ? { env: options.env } : {}),
    });
    let stdout = "";
    let stderr = "";
    let error = null;
    let failure = null;
    let timer = null;
    let settled = false;
    const pending = { stdout: "", stderr: "" };
    const supervision = {
      pid: child.pid ?? null, exited: false, closed: false, exitStatus: null, exitSignal: null,
      terminationAttempted: false, terminationAccepted: null, terminationError: null,
      outputComplete: false, resourceCleanup: "unverified",
    };
    function finish(status, signal, closed) {
      if (settled) return;
      settled = true;
      if (timer !== null) runtime.clearTimeout(timer);
      timer = null;
      supervision.closed = closed;
      supervision.outputComplete = closed;
      child.stdout.removeListener("data", onStdout);
      child.stderr.removeListener("data", onStderr);
      child.stdout.removeListener("end", onStdoutEnd);
      child.stderr.removeListener("end", onStderrEnd);
      child.removeListener("error", onError);
      child.removeListener("exit", onExit);
      child.removeListener("close", onClose);
      if (!closed) {
        // A descendant may still hold a pipe after the owned verifier exits. Do not destroy it
        // or pretend cleanup succeeded. Preserve drained output and explicitly report missing EOF.
        child.stdout.unref?.();
        child.stderr.unref?.();
        child.unref();
        // A late asynchronous kill error must not crash the parent before it writes its report.
        child.once("error", () => {});
        error = [error, "verifier 失败收尾超时：未收到 close，输出可能不完整；资源及临时目录清理未确认",
          !supervision.exited ? `自有 verifier PID ${supervision.pid} 的终止未确认，需检查遗留进程` : null].filter(Boolean).join("；");
      }
      resolve({ status, signal, stdout, stderr, error: [failure, error].filter(Boolean).join("；") || null,
        ...(supervise ? { supervision } : {}) });
    }
    function fail(reason) {
      if (!supervise || settled || failure) return;
      failure = reason;
      timer = runtime.setTimeout(() => {
        timer = null;
        // Keep draining both pipes after the single termination request. A kill request is not exit/close.
        timer = runtime.setTimeout(() => finish(null, null, false), FAILURE_OUTPUT_DRAIN_MS);
        if (!supervision.exited) {
          supervision.terminationAttempted = true;
          try { supervision.terminationAccepted = child.kill("SIGKILL"); }
          catch (failure) { supervision.terminationError = failure.message; }
        }
      }, FAILURE_EXIT_GRACE_MS);
    }
    function inspect(line, stream, complete = true) {
      const event = parseEvent(line);
      if (event?.phase === "cleanup_failed") fail("cleanup_failed：verifier 已报告资源清理失败");
      // console.error(error) in the verifier's terminal catch. Ignore progress and arbitrary stderr.
      else if (stream === "stderr" && complete && /^(?:Error|[\w.]*Error)(?: \[[^\]]+\])?:/.test(line)) fail(line);
    }
    function output(chunk, stream) {
      if (stream === "stdout") { stdout += chunk; if (echo) process.stdout.write(chunk); }
      else { stderr += chunk; if (echo) process.stderr.write(chunk); }
      if (!supervise) return;
      pending[stream] += chunk;
      const lines = pending[stream].split(/\r?\n/);
      pending[stream] = lines.pop();
      for (const line of lines) inspect(line, stream);
      // Structured failure can be complete even if the producer omits the last newline.
      inspect(pending[stream], stream, false);
    }
    function onStdout(chunk) { output(chunk, "stdout"); }
    function onStderr(chunk) { output(chunk, "stderr"); }
    function onStdoutEnd() { inspect(pending.stdout, "stdout"); }
    function onStderrEnd() { inspect(pending.stderr, "stderr"); }
    function onError(problem) { error = problem.message; fail(error); }
    function onExit(status, signal) {
      supervision.exited = true;
      supervision.exitStatus = status;
      supervision.exitSignal = signal;
      if (status !== 0 || signal) fail(`verifier 非正常退出：status=${status}, signal=${signal}`);
    }
    function onClose(status, signal) { finish(status, signal, true); }
    // Decode across chunk boundaries so Chinese diagnostics and trailing output remain intact.
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", onStdout);
    child.stderr.on("data", onStderr);
    child.stdout.once("end", onStdoutEnd);
    child.stderr.once("end", onStderrEnd);
    child.once("error", onError);
    child.once("exit", onExit);
    child.once("close", onClose);
  });
}

async function runAcceptance(options, execute = runCommand) {
  const reportPath = options.report || path.join(os.tmpdir(), `sinitek-codex-handoff-acceptance-${Date.now()}-${process.pid}.json`);
  const report = {
    schemaVersion: 1, startedAt: new Date().toISOString(), passed: false,
    scope: "isolated-thread-handoff", requestedRuns: options.runs,
    environment: { platform: process.platform, arch: process.arch, node: process.version, codex: null, codexCommand: process.env.CODEX_COMMAND || "codex", commit: null, dirty: null },
    checks: [], runs: [],
    notCovered: ["真实 VS Code 多窗口 Loop+ 调度与完整模型执行", "未知外部进程的写锁接管"],
  };
  async function check(name, command, args, evidence) {
    console.log(JSON.stringify({ phase: "acceptance_step_started", step: name }));
    const start = Date.now();
    const result = await execute(command, args);
    if (evidence) Object.assign(evidence, result);
    const passed = result.status === 0 && !result.signal && !result.error;
    report.checks.push({ name, passed, elapsedMs: Date.now() - start, status: result.status, signal: result.signal, error: result.error,
      ...(result.supervision ? { supervision: result.supervision } : {}) });
    if (!passed) throw new Error(`${name} 失败：${result.error || result.stderr.trim().slice(-2000) || `退出码 ${result.status}`}`);
    return result;
  }
  try {
    await check("build", "npm", ["run", "build"]);
    const version = await check("codex_version", process.env.CODEX_COMMAND || "codex", ["--version"]);
    report.environment.codex = version.stdout.trim();
    const commit = await execute("git", ["rev-parse", "HEAD"], false);
    if (commit.status === 0) report.environment.commit = commit.stdout.trim();
    const status = await execute("git", ["status", "--porcelain"], false);
    if (status.status === 0) report.environment.dirty = Boolean(status.stdout.trim());
    await check("regression", process.execPath, ["--test", ...regressionTests()]);
    for (let run = 1; run <= options.runs; run += 1) {
      console.log(JSON.stringify({ phase: "acceptance_run_started", run, total: options.runs, hint: "交接可能等待约 60 秒，请勿中断" }));
      const evidence = { run, passed: false };
      report.runs.push(evidence);
      const result = await check(`live_${run}`, process.execPath, [liveScript, "--live"], evidence);
      const verified = verifyLiveResult(result);
      // close/status alone do not prove that the verifier's children and temporary directory were cleaned.
      if (result.supervision) result.supervision.resourceCleanup = verified.resourceCleanup;
      Object.assign(evidence, verified, { passed: true });
      console.log(JSON.stringify({ phase: "acceptance_run_passed", run, elapsedMs: evidence.elapsedMs }));
    }
    report.passed = true;
  } catch (error) {
    report.failure = error instanceof Error ? error.message : String(error);
    console.error(report.failure);
  }
  report.finishedAt = new Date().toISOString();
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ phase: "acceptance_completed", passed: report.passed, completedRuns: report.runs.filter((run) => run.passed).length, requestedRuns: options.runs, reportPath }));
  return report;
}

if (require.main === module) {
  Promise.resolve().then(() => {
    const options = parseOptions(process.argv.slice(2));
    if (options.help) {
      console.log("用法：node scripts/verify_codex_thread_handoff_acceptance.js --live [--runs 3] [--report 文件路径]");
      console.log("自动构建、执行相关回归、重复隔离真实交接并生成报告；只访问本机模拟模型，不修改用户会话。完整通过仍需结合真实 VS Code 多窗口 Loop+ 验收。");
      console.log("包含 Loop+ 所有权、完成状态、Tab 和公共 runner 的统一入口：npm run verify:loop-plus。");
      return;
    }
    return runAcceptance(options).then((report) => { process.exitCode = report.passed ? 0 : 1; });
  }).catch((error) => { console.error(error); process.exitCode = 1; });
}

module.exports = { parseOptions, verifyLiveResult, regressionTests, runAcceptance, runCommand };
