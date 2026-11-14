"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { runCommand, verifyLiveResult, regressionTests: handoffRegressionTests } = require("./verify_codex_thread_handoff_acceptance");
const { verifyRunnerEvidence } = require("./verify_codex_runner_unload");

const repoRoot = path.resolve(__dirname, "..");
const liveScript = path.join(__dirname, "verify_codex_thread_handoff.js");
const runnerScript = path.join(__dirname, "verify_codex_runner_unload.js");

function parseOptions(args) {
  const options = { live: false, help: false, runs: 3, report: null, codex: null };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--live") options.live = true;
    else if (argument === "--help") options.help = true;
    else if (["--runs", "--report", "--codex"].includes(argument)) {
      const value = args[++index];
      if (!value?.trim() || value.startsWith("--")) throw new Error(`${argument} 缺少参数`);
      if (argument === "--runs") {
        if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 20) throw new Error("--runs 必须是 1 到 20 的整数");
        options.runs = Number(value);
      } else if (argument === "--report") options.report = path.resolve(value);
      else options.codex = value;
    } else throw new Error(`未知参数：${argument}`);
  }
  if (!options.live && !options.help) throw new Error("请使用 --live 确认隔离的真实 Codex 检测，或使用 npm run verify:loop-plus");
  return options;
}

function regressionTests() {
  const tests = new Set(handoffRegressionTests());
  const host = path.join(repoRoot, "dist/test/extensionHost");
  for (const name of fs.readdirSync(host).filter((name) => /^prompt.*\.test\.js$/.test(name))) tests.add(path.join(host, name));
  for (const name of [
    "core/codexRunnerUnloadAcceptance.test.js", "core/loopPlusFixAcceptance.test.js",
    "extensionHost/promptInteractiveRuntime.test.js", "extensionHost/sessionTabOwnership.test.js", "extensionHost/interactiveTurnStrategy.test.js",
    "extensionHost/extensionHostExtractionContracts.test.js", "extensionHost/loopPlusRuntimeIntegration.test.js",
    "extensionHost/loopPlusOrchestration.test.js", "loop/loopSubtaskSession.test.js",
    "loop/loopSubtaskAutoCompact.test.js", "session/conversationTabRunningFlow.test.js",
    "loop/loopMainFailure.test.js", "loop/loopPlusPause.test.js", "loop/loopBlockedSummary.test.js",
    "loop/loopFinalSummary.test.js", "loop/loopGroupChat.test.js",
    "session/sessionTabCliSwitch.test.js", "webview/tabRunStatus.test.js", "webview/conversationTabClose.test.js",
  ]) tests.add(path.join(repoRoot, "dist/test", name));
  for (const filename of tests) assert.ok(fs.existsSync(filename), `缺少必要回归测试：${filename}`);
  return [...tests].sort();
}

function verifyCommandResult(result) {
  assert.ok(!result.error, result.error || "子进程启动失败");
  assert.equal(result.signal, null, "进程被信号终止，不能判定通过");
  assert.equal(result.status, 0, `进程退出码 ${result.status}：${result.stderr.trim().slice(-2000)}`);
  if (result.supervision) {
    assert.ok(result.supervision.closed && result.supervision.outputComplete && !result.supervision.terminationAttempted,
      "强制收尾或缺少 close/输出完成证据不能算通过");
  }
}

function verifyRegressionResult(result) {
  verifyCommandResult(result);
  const summary = {};
  for (const field of ["tests", "pass", "fail", "cancelled", "skipped", "todo"]) {
    const matches = [...result.stdout.matchAll(new RegExp(`^# ${field} (\\d+)\\r?$`, "gm"))];
    assert.equal(matches.length, 1, `缺少或重复的单测统计：${field}`);
    summary[field] = Number(matches[0][1]);
  }
  assert.ok(summary.tests > 0 && summary.pass === summary.tests, "所有回归必须真实执行并通过");
  for (const field of ["fail", "cancelled", "skipped", "todo"]) assert.equal(summary[field], 0, `单测存在 ${field}，不能判定通过`);
  return summary;
}

function outputEvents(output) {
  return output.split(/\r?\n/).flatMap((line) => {
    try { const event = JSON.parse(line); return event && typeof event === "object" ? [event] : []; }
    catch { return []; }
  });
}

function verifyRunnerResult(result, report, command, version, reportPath) {
  verifyCommandResult(result);
  assert.ok(result.supervision, "缺少公共 runner 验证进程的关闭证据");
  const events = outputEvents(result.stdout);
  assert.ok(![...events, ...outputEvents(result.stderr)].some((event) => event.phase === "cleanup_failed"), "公共 runner 资源清理失败");
  const cleanups = events.filter((event) => event.phase === "cleanup_verified");
  const completions = events.filter((event) => event.phase === "runner_handoff_verified");
  assert.equal(cleanups.length, 1, "公共 runner 缺少唯一清理证据");
  assert.equal(completions.length, 1, "公共 runner 缺少唯一完成证据");
  assert.ok(events.indexOf(cleanups[0]) < events.indexOf(completions[0]), "公共 runner 必须在清理后报告完成");
  assert.equal(completions[0].passed, true, "公共 runner 完成事件未通过");
  assert.equal(completions[0].reportPath, reportPath, "公共 runner 报告路径不一致");
  for (const key of ["processesExited", "stdioClosed", "temporaryDirectoryRemoved"]) assert.equal(cleanups[0][key], true, `公共 runner 清理缺少 ${key}`);
  assert.equal(report.passed, true, "公共 runner 详细报告未通过");
  assert.equal(report.evidence.environment.platform, process.platform, "公共 runner 平台证据不一致");
  assert.equal(report.evidence.environment.arch, process.arch, "公共 runner 架构证据不一致");
  const verified = verifyRunnerEvidence(report.evidence);
  for (const entry of [...report.evidence.processes, ...report.evidence.probes, ...report.evidence.capabilities]) {
    assert.equal(entry.command, command, "版本探测和公共 runner 必须使用同一个 Codex 可执行文件");
  }
  for (const entry of report.evidence.probes) assert.equal(entry.version, version, "Codex 版本在检测过程中发生变化");
  assert.deepEqual(report.verified, verified, "公共 runner 摘要与详细协议证据不一致");
  for (const [key, value] of Object.entries(verified)) assert.equal(completions[0][key], value, `公共 runner 完成事件的 ${key} 与协议证据不一致`);
  return { ...verified, resourceCleanup: "verified" };
}

async function runVerification(options, runtime = {}) {
  assert.ok(options.live && !options.help, "检测必须显式启用 --live");
  assert.ok(Number.isInteger(options.runs) && options.runs >= 1 && options.runs <= 20, "检测轮数无效");
  const reportPath = options.report || path.join(os.tmpdir(), `sinitek-loop-plus-${randomUUID()}.json`);
  const stem = reportPath.replace(/\.json$/i, "");
  const logPath = `${stem}.log`;
  const runnerReportPath = `${stem}.runner.json`;
  for (const filename of [reportPath, logPath, runnerReportPath]) assert.ok(!fs.existsSync(filename), `不能覆盖已有检测文件：${filename}`);
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  const reportFile = fs.openSync(reportPath, "wx");
  let logFile;
  const execute = runtime.execute || ((command, args, echo = true, env) => runCommand(command, args, echo, undefined, { env }));
  const resolveCommand = runtime.resolveCommand || ((command) => require(path.join(repoRoot, "dist/cli/commandResolution")).resolveCliCommand(command, { cwd: repoRoot }));
  const configuredCommand = options.codex || process.env.CODEX_COMMAND || "codex";
  const report = {
    schemaVersion: 1, scope: "loop-plus-codex-source-and-isolated-runtime", startedAt: new Date().toISOString(),
    passed: false, fullyVerified: false, requestedRuns: options.runs, reportPath, logPath, runnerReportPath,
    environment: { platform: process.platform, arch: process.arch, node: process.version,
      sourceVersion: require(path.join(repoRoot, "package.json")).version, commit: null, dirty: null,
      configuredCommand, codexCommand: null, codexVersion: null, resolvedFrom: null },
    coverage: { regression: false, poolHandoff: false, publicRunnerHandoff: false }, checks: [], runs: [],
    notCovered: ["已安装扩展版本及真实 VS Code 多窗口 Loop+ 端到端行为（含成功自动关 Tab）",
      `其它原生平台（本次仅 ${process.platform}/${process.arch}）`, "真实模型完整任务与主模型验收", "未知外部进程的写锁接管", "其它 CLI", "全仓单测（本入口只执行必要回归集）"],
  };
  function log(message) {
    console.log(message);
    if (logFile !== undefined) fs.writeSync(logFile, `${new Date().toISOString()} ${message}\n`);
  }
  async function check(name, command, args, validate, env) {
    const entry = { name, command, args, passed: false, startedAt: new Date().toISOString() };
    report.checks.push(entry);
    const started = Date.now();
    log(`开始检测：${name}`);
    try {
      const result = await execute(command, args, true, env);
      Object.assign(entry, { status: result.status, signal: result.signal, error: result.error, ...(result.supervision ? { supervision: result.supervision } : {}) });
      fs.writeSync(logFile, `\n[${name}] stdout\n${result.stdout}\n[${name}] stderr\n${result.stderr}\n`);
      verifyCommandResult(result);
      if (validate) entry.evidence = validate(result);
      entry.passed = true;
      log(`检测通过：${name}`);
      return result;
    } catch (error) {
      entry.failure = error.message;
      throw new Error(`${name} 失败：${error.message}`);
    } finally { entry.elapsedMs = Date.now() - started; }
  }
  try {
    logFile = fs.openSync(logPath, "wx");
    log(`本次检测源码，不安装或重载扩展；共享策略每轮约 60 秒，兼容专属策略按实际进程退出交接。`);
    log(`报告：${reportPath}`);
    await check("build", "npm", ["run", "build"]);
    const resolved = resolveCommand(configuredCommand);
    assert.ok(resolved && path.isAbsolute(resolved.command), "无法定位 Codex；请用 --codex 指定单个可执行文件的完整路径（不要附带参数），并先安装项目依赖");
    report.environment.codexCommand = resolved.command;
    report.environment.resolvedFrom = resolved.resolvedFrom;
    const version = await check("codex_version", resolved.command, ["--version"], (result) => {
      const match = /^codex-cli (\S+)\s*$/.exec(result.stdout.trim());
      assert.ok(match, "无法识别 Codex 版本输出，请用 --codex 指定实际 Codex 路径");
      return { version: match[1] };
    });
    report.environment.codexVersion = /^codex-cli (\S+)\s*$/.exec(version.stdout.trim())[1];
    log(`实际 Codex：${resolved.command}（${report.environment.codexVersion}，${resolved.resolvedFrom}）`);
    const commit = await check("source_commit", "git", ["rev-parse", "HEAD"]);
    report.environment.commit = commit.stdout.trim();
    const status = await check("source_status", "git", ["status", "--porcelain"]);
    report.environment.dirty = Boolean(status.stdout.trim());
    const tests = (runtime.regressionTests || regressionTests)();
    assert.ok(tests.length > 0, "没有发现回归测试");
    await check("regression", process.execPath, ["--test", "--test-reporter=tap", ...tests], verifyRegressionResult);
    report.coverage.regression = true;
    const env = { ...process.env, CODEX_COMMAND: resolved.command, SINITEK_CODEX_HANDOFF_MODULE_ROOT: path.join(repoRoot, "dist") };
    for (let run = 1; run <= options.runs; run += 1) {
      const evidence = { run, passed: false };
      report.runs.push(evidence);
      await check(`pool_handoff_${run}`, process.execPath, [liveScript, "--live"], (result) => {
        assert.ok(result.supervision, "缺少 pool 验证进程关闭证据");
        const verified = verifyLiveResult(result);
        result.supervision.resourceCleanup = verified.resourceCleanup;
        Object.assign(evidence, verified, { passed: true });
        return verified;
      }, env);
    }
    report.coverage.poolHandoff = true;
    await check("public_runner_handoff", process.execPath, [runnerScript, "--live", "--report", runnerReportPath], (result) => {
      const runnerReport = JSON.parse(fs.readFileSync(runnerReportPath, "utf8"));
      const verified = verifyRunnerResult(result, runnerReport, resolved.command, report.environment.codexVersion, runnerReportPath);
      result.supervision.resourceCleanup = verified.resourceCleanup;
      return verified;
    }, env);
    report.coverage.publicRunnerHandoff = true;
    report.passed = true;
  } catch (error) {
    report.failure = error instanceof Error ? error.message : String(error);
    log(`检测未通过：${report.failure}`);
    log("请查看报告及日志；可用 --codex 指定插件实际使用的路径，不要用另一版本的通过结果替代。");
  } finally {
    report.finishedAt = new Date().toISOString();
    report.verdict = report.passed ? "scoped-checks-passed" : "failed";
    try { fs.writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`); }
    finally { fs.closeSync(reportFile); if (logFile !== undefined) fs.closeSync(logFile); }
  }
  console.log(report.passed ? "当前平台源码与隔离运行时检测通过；尚不能判定已安装扩展或跨平台完全修复。" : "检测失败，不能判定修复通过。");
  console.log(`详细报告：${reportPath}\n阶段日志：${logPath}`);
  console.log(JSON.stringify({ phase: "loop_plus_fix_checked", passed: report.passed, fullyVerified: false, reportPath, logPath }));
  return report;
}

function printHelp() {
  console.log("用法：npm run verify:loop-plus -- [--codex 可执行文件路径] [--runs 3] [--report 报告.json]");
  console.log("或：node scripts/verify_loop_plus_fix.js --live [同上参数]；macOS/Windows 可双击同名 .command/.cmd。");
  console.log("需要 Node.js、npm、git、已安装的项目依赖和 Codex；只访问本机模拟模型，使用临时 HOME，不修改用户任务或会话。");
  console.log("自动构建、检查 Loop+ 所有权/完成状态/暂停/Tab 回归、重复原会话交接、验证公共 runner 与资源清理；共享策略默认 3 轮约 3–5 分钟。");
  console.log("默认按插件的命令解析规则固定 Codex 路径；--codex 优先于 CODEX_COMMAND。带空格路径请加引号。未知能力不强行开启零延迟。");
  console.log("确认支持即时卸载的版本验证共享池；旧版/未知能力验证专属进程、原进程实际退出和其它会话保留。不会换用另一版本让检测通过。");
  console.log("报告与日志拒绝覆盖；任一步失败、跳过、缺协议或清理证据均退出 1。退出 0 仅代表本机源码/隔离验证通过，不代表其它平台或真实 VS Code 已验收。");
}

if (require.main === module) {
  Promise.resolve().then(() => {
    const options = parseOptions(process.argv.slice(2));
    if (options.help) return printHelp();
    return runVerification(options).then((report) => { process.exitCode = report.passed ? 0 : 1; });
  }).catch((error) => { console.error(`检测无法启动：${error.message}`); process.exitCode = 1; });
}

module.exports = { parseOptions, regressionTests, verifyRegressionResult, verifyRunnerResult, runVerification };
