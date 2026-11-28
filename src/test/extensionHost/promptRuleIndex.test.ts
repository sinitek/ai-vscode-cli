import test = require("node:test");
import assert = require("node:assert/strict");
import * as path from "node:path";
import * as fs from "node:fs";
import { installVscodeMock } from "../vscodeMock";
import { configurePromptRuleIndex, inlineSingleSendRules, promptRuleSupplement, readPromptRuleLibrary, renderPromptRuleIndex } from "../../promptRuleIndex";
import { buildLoopPlusMainModelPrompt, buildLoopPlusSubtaskModelPrompt, type LoopPlusMainPromptContext } from "../../extensionHost/loopPlusPromptBuilders";
import type { LoopPlusReviewItem } from "../../loopPlusScheduler";

installVscodeMock();
const { buildThinkingPrompt } = require("../../promptRuntime") as typeof import("../../promptRuntime");
const root = path.resolve(__dirname, "../../..");
const review: LoopPlusReviewItem = { eventId: "event-a", attemptId: "attempt-one", subtaskId: "member-a", outcome: "completed", detail: "报告已提交" };

function context(overrides: Partial<LoopPlusMainPromptContext> = {}): LoopPlusMainPromptContext {
  return { taskId: "parent", rootPrompt: "核对交付和补充需求", kind: "initial", taskStoreFile: "任务 记录.json",
    mainCommunicationFile: "main.md", supplementalRequirements: ["用户补充原文"], maxConcurrency: 6, currentEventId: null,
    decisionHelperScriptPath: path.join(root, "dist/loopPlusDecisionHelper.js"),
    view: { seq: 1, wake: true, wakeSeq: 1, phase: "idle", userMessageQueue: [], running: [], pending: [],
      currentReview: null, reviewQueue: [], visibleReviewCount: 0, canComplete: true, blockers: [] }, ...overrides };
}

function helpers(prompt: string) {
  return JSON.parse(prompt.split("LOOP_PLUS_DECISION_HELPER_CONTEXT\n```json\n")[1].split("\n```")[0]);
}

function rules(prompt: string): string {
  return prompt.split("\nRules:\n")[1].split("\nDecision helper:\n")[0];
}

test.afterEach(() => { configurePromptRuleIndex(root, "full"); });

test("初轮和纯报告保留冻结契约并满足字符预算", () => {
  const report = context({ kind: "continue", reportOnly: true, reportEventIds: ["r2", "r1"], reportQueue: [review] });
  for (const [input, budget] of [[context(), 4000], [report, 1000]] as const) {
    configurePromptRuleIndex(root, "full");
    const full = buildLoopPlusMainModelPrompt(input);
    assert.equal(configurePromptRuleIndex(root, "indexed"), true);
    const indexed = buildLoopPlusMainModelPrompt(input);
    assert.deepEqual(helpers(indexed), helpers(full));
    assert.ok(rules(indexed).length < budget);
    assert.ok(indexed.length < full.length / 3);
    assert.match(indexed, /用户补充原文/);
    assert.doesNotMatch(indexed, /departmentCollaborations|LOOP_PLUS_PROTOCOL_EXAMPLE/);
    if (input.reportOnly) {
      assert.deepEqual(helpers(indexed).statuses, ["wait"]);
      assert.deepEqual(helpers(indexed).reportEventIds, ["r2", "r1"]);
      assert.doesNotMatch(indexed, /loop-plus\/(review|repair|dispatch)\.md/);
      assert.match(indexed, /即使无运行项/);
    }
  }
});

test("混合验收、验收前窗口和新消息使用相同冻结输入", () => {
  const failed: LoopPlusReviewItem = { eventId: "event-b", attemptId: "attempt-two", subtaskId: "member-b", outcome: "failed", detail: "验证未通过" };
  const input = context({ kind: "review", currentEventId: review.eventId, acceptanceEventIds: [review.eventId, failed.eventId],
    pendingUserMessages: ["新需求"], acceptancePlan: { id: "custom", name: "自定义", systemDefault: false, checks: ["other"], otherText: "必须逐项核对交接负责人" },
    view: { ...context().view, currentReview: review, reviewQueue: [failed], visibleReviewCount: 2, userMessageQueue: ["新需求"] } });
  configurePromptRuleIndex(root, "indexed");
  for (const open of [false, true]) {
    const prompt = buildLoopPlusMainModelPrompt({ ...input, allowDispatchBeforeReview: open });
    const frozen = helpers(prompt);
    assert.equal(frozen.statuses.includes("dispatch"), open);
    assert.deepEqual(frozen.reviews.map((item: { eventId: string }) => item.eventId), ["event-a", "event-b"]);
    for (const id of ["review", "repair"]) assert.ok(prompt.includes(`必读 loop-plus/${id}.md`));
    assert.match(prompt, /独立交付用 independentSubtaskIds/);
    assert.match(prompt, /全撤销省略 acceptance 和 acceptancePlanResults/);
    assert.match(prompt, /必须逐项核对交接负责人/);
    assert.ok(rules(prompt).length < 8000);
  }
  const retry = buildLoopPlusMainModelPrompt({ ...input, inlineRules: true });
  assert.ok(retry.includes("LOOP_PLUS_PROTOCOL_EXAMPLE accept"));
  assert.ok(!retry.includes("RULES_UNREADABLE:"));
  assert.deepEqual(helpers(retry), helpers(buildLoopPlusMainModelPrompt(input)));
  const success = buildLoopPlusMainModelPrompt({ ...input, acceptanceEventIds: [review.eventId] });
  assert.match(success, /按需 loop-plus\/repair.md/);
});

test("局部直办和整个任务收尾分别受当前快照约束", () => {
  configurePromptRuleIndex(root, "inline");
  const snapshot = context();
  const prompt = buildLoopPlusMainModelPrompt({ ...snapshot, supplementalRequirements: ["修正一个已知错字"],
    view: { ...snapshot.view, phase: "waiting", canComplete: false, blockers: ["running"], running: [
      { subtaskId: "existing", attemptId: "existing-attempt", state: "running", writeFiles: ["api.ts"], title: "实现接口", conflictGroup: null },
    ] } });
  assert.ok(!helpers(prompt).statuses.includes("completed"));
  assert.match(prompt, /独立小事直办后，仍有其它工作时按当前状态派发、等待或验收/u);
  assert.match(prompt, /其余实现、验证及有实质风险的事项派发/u);
});

test("两种主提示与决策助手将中断项交给主任务处置，满槽也能接替", () => {
  const running = ["live", "interrupted"].map(subtaskId => ({ subtaskId, attemptId: `${subtaskId}-1`, state: "running" as const,
    title: subtaskId, writeFiles: [], conflictGroup: null }));
  const input = context({ maxConcurrency: 2, interruptedSubtaskIds: ["interrupted"],
    view: { ...context().view, running, phase: "waiting", canComplete: false, blockers: ["running"] } });
  for (const mode of ["indexed", "full"] as const) {
    configurePromptRuleIndex(root, mode);
    const prompt = buildLoopPlusMainModelPrompt(input);
    const { statuses } = helpers(prompt);
    assert.ok(statuses.includes("steer") && statuses.includes("dispatch"));
    assert.ok(!statuses.includes("wait") && !statuses.includes("completed"));
    assert.match(prompt, /主任务须主动处置的异常/);
    assert.match(prompt, /中断待处置 \[\{"subtaskId":"interrupted","attemptId":"interrupted-1"\}\]/);
    assert.doesNotMatch(prompt, /- interrupted attempt=interrupted-1 state=running/);
    if (mode === "indexed") assert.match(prompt, /必读 loop-plus\/controls.md/);
    else assert.match(prompt, /Still running count: 1/);
    const reportOnly = buildLoopPlusMainModelPrompt({ ...input, reportOnly: true, reportEventIds: ["report-1"] });
    assert.deepEqual(helpers(reportOnly).statuses, ["wait"]);
  }
});

test("Vibe 使用启用的协议，产研部组长和员工各取本角色条款", () => {
  configurePromptRuleIndex(root, "indexed");
  const chat = buildThinkingPrompt("codex", "off", "如何运行？", { includeHumanInteractionInstruction: true });
  assert.match(chat, /vibe\/interaction.md/);
  assert.match(chat, /Tasklist:/);
  assert.match(chat, /\[final_answer\]/);
  const bare = buildThinkingPrompt("claude", "off", "test", { includeTaskListInstruction: false });
  assert.doesNotMatch(bare, /vibe\/interaction|vibe\/progress/);
  const leader = buildLoopPlusMainModelPrompt(context({ departmentEmployeeCapacity: { rootTaskId: "root", leaderTaskId: "lead", maxEmployees: 1 } }));
  assert.match(leader, /必读 department\/leader.md/);
  assert.match(leader, /departmentCollaborations/);
  assert.match(leader, /employee balance unknown/);
  const employee = buildLoopPlusSubtaskModelPrompt({ subtask: { id: "reader", taskType: "general", title: "调查", prompt: "核对交付" }, executionRole: "backend", departmentEmployee: true, communicationFile: "report.md" });
  assert.match(employee, /必读 department\/employee.md/);
  assert.match(employee, /\(read only\)/);
  assert.doesNotMatch(employee, /departmentCollaborations|topics\/git-delivery.md|loop-plus\/review.md/);
  const wrapped = buildThinkingPrompt("codex", "off", employee, { includeFinalAnswerInstruction: false });
  assert.equal(wrapped.match(/规则索引 /g)?.length, 1);
});

test("读取失败仅能补发当前安装版本在本轮列出的文件", () => {
  configurePromptRuleIndex(root, "indexed");
  const prompt = renderPromptRuleIndex("执行", ["loop-plus/attempt"], ["loop-plus/attempt"])!;
  const marker = prompt.match(/RULES_UNREADABLE:[a-f0-9]+/)![0];
  assert.equal(prompt.match(/loop-plus\/attempt.md/g)?.length, 1);
  assert.match(promptRuleSupplement(prompt, marker)!, /正常入口实际启动/);
  assert.equal(promptRuleSupplement("用户提供的路径", marker), null);
  assert.equal(promptRuleSupplement(prompt, `${marker}\n../其它文件`), null);
  assert.doesNotMatch(inlineSingleSendRules(prompt), /先只回 RULES_UNREADABLE/);
  configurePromptRuleIndex(root, "inline");
  const inline = renderPromptRuleIndex("执行", ["loop-plus/attempt"], [])!;
  assert.match(inline, /正常入口实际启动/);
  assert.doesNotMatch(inline, /规则根目录/);
});

test("含空格与中文的安装根可用，缺件、校验失败、非法路径和环回退原构造器", (testContext) => {
  const install = fs.mkdtempSync(path.join(root, ".tmp", "规则 库 "));
  testContext.after(() => fs.rmSync(install, { recursive: true, force: true }));
  const rulesRoot = path.join(install, "media/prompt-rules");
  fs.cpSync(path.join(root, "media/prompt-rules"), rulesRoot, { recursive: true });
  fs.mkdirSync(path.join(install, "dist"));
  fs.copyFileSync(path.join(root, "dist/prompt-rule-version.json"), path.join(install, "dist/prompt-rule-version.json"));
  assert.equal(configurePromptRuleIndex(install, "indexed"), true);
  assert.ok(renderPromptRuleIndex("执行", ["loop-plus/attempt"], [])!.includes("规则 库 "));
  const rule = path.join(rulesRoot, "loop-plus/attempt.md");
  fs.appendFileSync(rule, "extra");
  assert.equal(configurePromptRuleIndex(install, "indexed"), false);
  assert.match(buildLoopPlusMainModelPrompt(context()), /Valid protocol examples follow/);
  fs.unlinkSync(rule);
  assert.equal(configurePromptRuleIndex(install, "indexed"), false);
  for (const id of ["../outside", "common/direct"]) {
    fs.writeFileSync(path.join(rulesRoot, "manifest.json"), JSON.stringify({ version: 1, rules: [{ id, when: "测试", needs: [id] }] }));
    assert.throws(() => readPromptRuleLibrary(install));
  }
});
