"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crossSpawn = require("cross-spawn");

const repoRoot = path.resolve(__dirname, "..");
const liveScript = path.join(__dirname, "verify_codex_thread_handoff.js");

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
  const events = [];
  for (const line of result.stdout.split(/\r?\n/)) {
    try {
      const event = JSON.parse(line);
      if (event && typeof event === "object") events.push(event);
    } catch {}
  }
  const conflicts = events.filter((event) => event.phase === "writer_conflict_reproduced");
  const handoffs = events.filter((event) => event.phase === "handoff_verified");
  assert.equal(conflicts.length, 1, "必须且只能成功复现一次真实写锁冲突");
  assert.equal(handoffs.length, 1, "缺少完整的 handoff_verified；仅复现冲突不算修复通过");
  const conflict = conflicts[0];
  const handoff = handoffs[0];
  assert.ok(events.indexOf(conflict) < events.indexOf(handoff), "验证阶段顺序错误");
  assert.equal(conflict.differentProcesses, true, "必须使用两个不同的真实进程");
  assert.equal(handoff.sameThread, true, "必须恢复原会话，不能新建会话绕过问题");
  assert.equal(handoff.otherThreadRetained, true, "旧进程中的另一会话必须保留");
  assert.ok(Number.isInteger(handoff.localRequests) && handoff.localRequests > 0, "必须实际访问本机模拟服务");
  assert.ok(Number.isFinite(handoff.elapsedMs) && handoff.elapsedMs >= 0, "必须记录有效的交接耗时");
  return { ...handoff, differentProcesses: true };
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

function runCommand(command, args, echo = true) {
  return new Promise((resolve) => {
    const child = crossSpawn.spawn(command, args, {
      cwd: repoRoot, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let error = null;
    child.stdout.on("data", (chunk) => { stdout += chunk; if (echo) process.stdout.write(chunk); });
    child.stderr.on("data", (chunk) => { stderr += chunk; if (echo) process.stderr.write(chunk); });
    child.once("error", (failure) => { error = failure.message; });
    child.once("close", (status, signal) => resolve({ status, signal, stdout, stderr, error }));
  });
}

async function runAcceptance(options, execute = runCommand) {
  const reportPath = options.report || path.join(os.tmpdir(), `sinitek-codex-handoff-acceptance-${Date.now()}-${process.pid}.json`);
  const report = {
    schemaVersion: 1, startedAt: new Date().toISOString(), passed: false,
    scope: "isolated-thread-handoff", requestedRuns: options.runs,
    environment: { platform: process.platform, arch: process.arch, node: process.version, codex: null, commit: null, dirty: null },
    checks: [], runs: [],
    notCovered: ["真实 VS Code 多窗口 Loop+ 调度与完整模型执行", "未知外部进程的写锁接管"],
  };
  async function check(name, command, args) {
    console.log(JSON.stringify({ phase: "acceptance_step_started", step: name }));
    const start = Date.now();
    const result = await execute(command, args);
    const passed = result.status === 0 && !result.signal && !result.error;
    report.checks.push({ name, passed, elapsedMs: Date.now() - start, status: result.status, signal: result.signal, error: result.error });
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
      const result = await check(`live_${run}`, process.execPath, [liveScript, "--live"]);
      Object.assign(evidence, verifyLiveResult(result), { passed: true });
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
      return;
    }
    return runAcceptance(options).then((report) => { process.exitCode = report.passed ? 0 : 1; });
  }).catch((error) => { console.error(error); process.exitCode = 1; });
}

module.exports = { parseOptions, verifyLiveResult, runAcceptance };
