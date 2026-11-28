const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { configurePromptRuleIndex, readPromptRuleLibrary } = require("../dist/promptRuleIndex");
const { buildLoopPlusMainModelPrompt, buildLoopPlusDecisionHelperPromptContext } = require("../dist/extensionHost/loopPlusPromptBuilders");
const { parseLoopPlusDecisionForFrozenInput } = require("../dist/loopPlusDecision");

const install = path.resolve(__dirname, "..");
const live = process.argv.includes("--live");
const sample = fs.mkdtempSync(path.join(install, ".tmp", "prompt-rule-probe-"));
const subtaskId = "handoff-document";
const event = { eventId: "handoff-ready", subtaskId, attemptId: "handoff-attempt-1", outcome: "completed", detail: "已完成交接清单并自检" };

function input(directory, kind) {
  const reviewing = kind === "review";
  const reportOnly = kind === "report";
  return {
    taskId: "rule-probe", kind: reviewing ? "review" : reportOnly ? "continue" : "initial",
    rootPrompt: reviewing ? "交付 handoff.md，包含有实际值的发布负责人和回退命令两个字段。" : "列出仓库入口文件。",
    mainCommunicationFile: path.join(directory, "main.md"), taskStoreFile: path.join(directory, "task.json"),
    decisionHelperScriptPath: path.join(install, "dist", "loopPlusDecisionHelper.js"),
    supplementalRequirements: [], maxConcurrency: 6, loopSubtaskMode: "split",
    view: { phase: reviewing ? "reviewing" : "idle", seq: 4, wake: true, wakeSeq: 4, running: [], pending: [],
      currentReview: reviewing ? event : null, reviewQueue: [], userMessageQueue: [], blockers: [], visibleReviewCount: reviewing ? 1 : 0, canComplete: !reportOnly },
    currentEventId: reviewing ? event.eventId : null, acceptanceEventIds: reviewing ? [event.eventId] : [],
    reportOnly, reportQueue: reportOnly ? [event] : [], reportEventIds: reportOnly ? [event.eventId] : [],
  };
}

function liveReview(mode, directory, context, prompt) {
  const artifact = "# 交接清单\n\n发布负责人：值班组。\n";
  const report = path.join(directory, "attempt.md");
  fs.writeFileSync(path.join(directory, "handoff.md"), artifact);
  fs.writeFileSync(report, "本次交付为 handoff.md。已完成目标中的两个字段，已检查文件内容。\n");
  fs.writeFileSync(context.mainCommunicationFile, "本轮负责核对交接清单是否满足原始目标。\n");
  fs.writeFileSync(context.taskStoreFile, JSON.stringify({ id: context.taskId, rootPrompt: context.rootPrompt,
    subTasks: [{ id: subtaskId, attemptId: event.attemptId, communicationFile: report, status: "completed" }] }));
  const resultFile = path.join(directory, "decision.json");
  const start = Date.now();
  const result = spawnSync("codex", ["exec", "--ephemeral", "--skip-git-repo-check", "--json", "--sandbox", "workspace-write",
    "-c", "project_doc_max_bytes=0", "-c", 'model_reasoning_effort="medium"', "-c", 'approval_policy="never"', "-C", directory, "-o", resultFile, "-"],
  { input: prompt, cwd: directory, encoding: "utf8", timeout: 360000, maxBuffer: 8 * 1024 * 1024 });
  if (result.status !== 0) throw Error(`合成 CLI ${mode} 退出 ${result.status} ${result.error?.code ?? result.stderr?.slice(-400)}`);
  const decision = JSON.parse(fs.readFileSync(resultFile, "utf8"));
  const frozen = buildLoopPlusDecisionHelperPromptContext(context);
  assert.ok(parseLoopPlusDecisionForFrozenInput(JSON.stringify(decision), {
    ...frozen, frozenReviewEventIds: frozen.reviews.map((review) => review.eventId),
  }).decision, "宿主必须接受本轮冻结输入的决策");
  assert.equal(decision.status, "accept");
  assert.equal(decision.reviewEventId, event.eventId);
  assert.equal(decision.reviews[0].acceptance, "failed");
  assert.deepEqual(decision.reviews[0].subtaskIds, [subtaskId]);
  assert.equal(decision.subtasks.length, 1);
  assert.equal(decision.subtasks[0].id, subtaskId);
  assert.notEqual(decision.subtasks[0].requiresAcceptance, false);
  assert.match(JSON.stringify(decision.reviews), /回退|rollback/iu);
  assert.equal(fs.readFileSync(path.join(directory, "handoff.md"), "utf8"), artifact);
  const events = result.stdout.split("\n").flatMap((line) => { try { return [JSON.parse(line)]; } catch { return []; } });
  const commands = events.filter((entry) => entry.type === "item.completed" && entry.item?.type === "command_execution").map((entry) => entry.item);
  const library = readPromptRuleLibrary(install);
  const output = commands.filter((item) => item.exit_code === 0).map((item) => item.aggregated_output ?? "").join("\n");
  const readRules = [...library.rules.values()].filter((rule) => {
    const firstParagraph = rule.body.split(/\r?\n\r?\n/)[1];
    return firstParagraph && output.includes(firstParagraph.trim().slice(0, 48));
  });
  const ruleFiles = readRules.map((rule) => `${rule.id}.md`);
  const helperCalls = commands.filter((item) => item.exit_code === 0 && item.command.includes("loopPlusDecisionHelper.js")).length;
  console.log(JSON.stringify({ mode, elapsedMs: Date.now() - start, ruleFiles, helperCalls, toolCalls: commands.length,
    usage: events.filter((entry) => entry.type === "turn.completed").map((entry) => entry.usage), verdict: "failed", repair: subtaskId }));
  if (mode === "indexed") {
    assert.ok(ruleFiles.includes("loop-plus/review.md"), "成功的工具输出必须含验收规则正文");
    assert.ok(ruleFiles.includes("loop-plus/repair.md"), "成功的工具输出必须含返工规则正文");
  }
}

for (const mode of ["indexed", "full"]) {
  assert.equal(configurePromptRuleIndex(install, mode), mode !== "full");
  const directory = path.join(sample, mode);
  fs.mkdirSync(directory);
  for (const kind of ["initial", "report", "review"]) {
    const context = input(directory, kind);
    const prompt = buildLoopPlusMainModelPrompt(context);
    const rules = prompt.slice(prompt.indexOf("Rules:"), prompt.indexOf("Decision helper:"));
    console.log(JSON.stringify({ mode, kind, rules: rules.length, prompt: prompt.length }));
    if (kind === "review" && live) liveReview(mode, directory, context, prompt);
  }
}
