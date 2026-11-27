import test = require("node:test");
import assert = require("node:assert/strict");
import { spawnSync } from "node:child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { LOOP_PLUS_DEFAULT_ACCEPTANCE_CHECK_NAMES } from "../../loopPlusAcceptancePlan";
import { parseLoopPlusDecisionWithFeedback } from "../../loopPlusDecision";
import { buildLoopBlockerSummary, type LoopBlocker } from "../../loopBlocker";
import { sameLoopPlusReportIds } from "../../extensionHost/loopPlusDecisionStrategies";

const entry = path.join(__dirname, "../../loopPlusDecisionHelper.js");
const secretPrompt = "SECRET_PROMPT_BODY_do_not_log";
const secretPath = "/tmp/session/do-not-log-path";
const reports = ["report-z-first", "report-a-second"];

type Json = Record<string, unknown>;

function withHome(run: (home: string) => void): void {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "loop-plus-decision-helper-"));
  fs.mkdirSync(path.join(home, ".sinitek_cli"), { recursive: true });
  fs.writeFileSync(path.join(home, ".sinitek_cli", "settings.json"), JSON.stringify({ historyRetentionDays: 1 }));
  try {
    run(home);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
}

function invoke(home: string, args: string[], input: unknown) {
  return spawnSync(process.execPath, [entry, ...args], {
    input: typeof input === "string" ? input : JSON.stringify(input),
    encoding: "utf8",
    timeout: 20000,
    env: { ...process.env, HOME: home, USERPROFILE: home },
  });
}

function context(overrides: Json = {}): Json {
  return {
    v: 1,
    statuses: ["dispatch", "accept", "wait", "steer", "blocked", "completed", "clarify"],
    reviews: [],
    reportEventIds: reports,
    subtaskMax: 6,
    acceptancePlanKeys: [],
    allowDirectCompletion: false,
    requireAcceptanceFeedback: true,
    requireProgressPercent: true,
    ...overrides,
  };
}

function checks(testsPassed = true) {
  return LOOP_PLUS_DEFAULT_ACCEPTANCE_CHECK_NAMES.map((name) => ({
    name,
    passed: name === "tests" ? testsPassed : true,
    detail: "证据已核对",
  }));
}

function envelope(value: Json, fields: Json): Json {
  return { context: value, fields };
}

function readLogs(home: string): string {
  const directory = path.join(home, ".sinitek_cli", "logs");
  if (!fs.existsSync(directory)) return "";
  return fs.readdirSync(directory)
    .filter((name) => name.endsWith(".log"))
    .map((name) => fs.readFileSync(path.join(directory, name), "utf8"))
    .join("\n");
}

function reparse(stdout: string, options: Json) {
  const decision = JSON.parse(stdout) as Json;
  const again = parseLoopPlusDecisionWithFeedback(stdout, options);
  assert.deepEqual(again.decision, decision);
  assert.equal(again.rejectionReason, null);
  return decision;
}

function hostOptions(snapshot: Json): Json {
  const reviews = snapshot.reviews as Array<{ eventId: string }>;
  return {
    subtaskMax: snapshot.subtaskMax,
    allowDirectCompletion: snapshot.allowDirectCompletion,
    acceptancePlanKeys: snapshot.acceptancePlanKeys,
    requireAcceptanceFeedback: snapshot.requireAcceptanceFeedback,
    requireProgressPercent: snapshot.requireProgressPercent,
    frozenReviewEventIds: reviews.map((item) => item.eventId),
  };
}

function recoverableBlocker(): LoopBlocker {
  return {
    kind: "recoverable",
    cause: "接口联调缺少已确认的请求字段",
    affectedRequirements: ["接口约定"],
    evidence: ["文档没有必填字段"],
    attempts: ["已查阅现有文档"],
    nextSteps: [{ owner: "接口负责人", action: "确认字段", verification: "字段齐全" }],
    resumeCondition: "字段已经明确",
  };
}

test("the packaged entry starts on macOS and rejects an incomplete command", () => {
  assert.equal(process.platform, "darwin");
  assert.equal(fs.existsSync(entry), true);
  withHome((home) => {
    const launched = invoke(home, [], "{}");
    assert.equal(launched.status, 2, launched.stderr);
    assert.equal(launched.stdout, "");
    assert.match(launched.stderr, /template --status/);
    assert.match(launched.stderr, /build --status/);
    assert.match(readLogs(home), /"reason":"input\.usage"/);
  });
});

test("template lists the fields for one frozen review and the FIFO report prefix", () => {
  withHome((home) => {
    const launched = invoke(home, ["template", "--status", "accept"], envelope(context({
      reviews: [{ eventId: "event-only", subtaskId: "sub-only" }],
      acceptancePlanKeys: ["security"],
    }), {}));
    assert.equal(launched.status, 0, launched.stderr);
    assert.equal(launched.stderr, "");
    const listed = JSON.parse(launched.stdout) as { status: string; fields: Array<{ path: string }> };
    assert.equal(listed.status, "accept");
    const paths = listed.fields.map((field) => field.path);
    assert.ok(paths.includes("progressPercent"));
    assert.ok(paths.includes("reviews[0].acceptance"));
    assert.ok(paths.includes("reviews[0].repair"));
    assert.ok(paths.includes("independentSubtasks"));
    assert.ok(paths.includes("reportEventIds"));
    assert.equal(paths.filter((item) => item === "reportEventIds").length, 1);
  });
});

test("build corrects a same-id repair after a contradictory failure and keeps single and multi-event shapes", () => {
  const options = {
    subtaskMax: 6,
    allowDirectCompletion: false,
    acceptancePlanKeys: ["security"],
    requireAcceptanceFeedback: true,
    requireProgressPercent: true,
  };
  const frozen = [
    { eventId: "event-z", subtaskId: "sub-z" },
    { eventId: "event-a", subtaskId: "sub-a" },
    { eventId: "event-c", subtaskId: "sub-c" },
    { eventId: "event-b", subtaskId: "sub-b" },
  ];
  const fields = {
    progressPercent: 23,
    reportEventIds: reports,
    acceptance: { passed: false, checks: checks(false) },
    acceptancePlanResults: [{ key: "security", passed: true, reason: "未引入新的安全暴露" }],
    reviews: [
      { acceptance: "failed", reason: "定向测试失败", repair: { id: "wrong-id", title: "返工", prompt: secretPrompt, taskType: "backend" } },
      { acceptance: "failed", reason: "失败但无需再改", noRepairReason: "需求已撤回，保留失败结论" },
      { acceptance: "cancelled", reason: "该交付不再需要验收" },
      { acceptance: "passed", reason: "实现与契约一致" },
    ],
    independentSubtasks: [{ id: "sub-new", title: "独立派发", prompt: `完成剩余交付 ${secretPath}`, taskType: "general" }],
  };
  withHome((home) => {
    const snapshot = context({ reviews: frozen, acceptancePlanKeys: ["security"] });
    const rejected = invoke(home, ["build", "--status", "accept"], envelope(snapshot, fields));
    assert.equal(rejected.status, 1, rejected.stderr);
    assert.equal(rejected.stdout, "");
    assert.match(rejected.stderr, /fields\.reviews\[0\]\.repair\.id/);
    assert.match(rejected.stderr, /sub-z/);
    const corrected = {
      ...fields,
      reviews: fields.reviews.map((review, index) => index === 0
        ? { ...review, repair: { ...review.repair, id: "sub-z" } }
        : review),
    };
    const accepted = invoke(home, ["build", "--status", "accept"], envelope(snapshot, corrected));
    assert.equal(accepted.status, 0, accepted.stderr);
    assert.equal(accepted.stderr, "");
    assert.equal(accepted.stdout.trim().split("\n").length, 1);
    const decision = reparse(accepted.stdout, options);
    assert.deepEqual(decision.reviewEventIds, frozen.map((item) => item.eventId));
    assert.equal(decision.reviewEventId, undefined);
    assert.deepEqual(decision.reportEventIds, reports);
    const decisionReviews = decision.reviews as Array<Json>;
    assert.deepEqual(decisionReviews.map((item) => item.acceptance), ["failed", "failed", "cancelled", "passed"]);
    assert.deepEqual(decisionReviews[0]?.subtaskIds, ["sub-z"]);
    assert.equal(decisionReviews[1]?.noRepairReason, "需求已撤回，保留失败结论");
    assert.equal(decisionReviews[1]?.subtaskIds, undefined);
    assert.deepEqual(decision.independentSubtaskIds, ["sub-new"]);
    const subtasks = decision.subtasks as Array<Json>;
    assert.equal(subtasks.find((item) => item.id === "sub-z")?.requiresAcceptance, true);
    assert.equal(subtasks.find((item) => item.id === "sub-z")?.prompt, secretPrompt);

    const single = invoke(home, ["build", "--status", "accept"], envelope(context({
      reviews: [{ eventId: "event-only", subtaskId: "sub-only" }],
      acceptancePlanKeys: ["security"],
    }), {
      progressPercent: 40,
      reportEventIds: reports,
      acceptance: { passed: true, checks: checks(true) },
      acceptancePlanResults: [{ key: "security", passed: true, reason: "单项审查通过" }],
      reviews: [{ acceptance: "passed", reason: "单项验收通过" }],
    }));
    assert.equal(single.status, 0, single.stderr);
    const one = reparse(single.stdout, options);
    assert.equal(one.reviewEventId, "event-only");
    assert.equal(one.reviewEventIds, undefined);
    assert.equal(sameLoopPlusReportIds(one.reportEventIds as string[], reports), true);
    const combined = `${readLogs(home)}\n${rejected.stderr}`;
    assert.equal(combined.includes(secretPrompt), false);
    assert.equal(combined.includes(secretPath), false);
    assert.match(readLogs(home), /"outcome":"error"/);
    assert.match(readLogs(home), /"reason":"input\.contradiction"/);
    assert.match(readLogs(home), /"outcome":"ok"/);
    assert.match(readLogs(home), /"reason":"decision\.authored"/);
  });
});

test("report prefix failures stay on stderr and clarify echoes the prefix without consuming it", () => {
  withHome((home) => {
    const reversed = invoke(home, ["build", "--status", "wait"], envelope(context(), {
      reportEventIds: [...reports].reverse(),
    }));
    assert.equal(reversed.status, 1, reversed.stderr);
    assert.equal(reversed.stdout, "");
    assert.match(reversed.stderr, /fields\.reportEventIds/);
    assert.match(reversed.stderr, /report-z-first/);
    const waited = invoke(home, ["build", "--status", "wait"], envelope(context(), { reportEventIds: reports }));
    assert.equal(waited.status, 0, waited.stderr);
    const waitDecision = reparse(waited.stdout, { subtaskMax: 6, allowDirectCompletion: false, acceptancePlanKeys: [] });
    assert.deepEqual(waitDecision.reportEventIds, reports);
    const clarified = invoke(home, ["build", "--status", "clarify"], envelope(context(), {
      reportEventIds: reports,
      clarification: { formFields: [{ id: "scope", label: "范围", type: "text" }] },
    }));
    assert.equal(clarified.status, 0, clarified.stderr);
    const clarifyDecision = reparse(clarified.stdout, { subtaskMax: 6, allowDirectCompletion: false, acceptancePlanKeys: [] });
    assert.equal(clarifyDecision.status, "clarify");
    assert.deepEqual(clarifyDecision.reportEventIds, reports);
    assert.equal(sameLoopPlusReportIds(clarifyDecision.reportEventIds as string[], reports), true);
  });
});

test("direct completion, dispatch, and blocked facts follow the host flags", () => {
  withHome((home) => {
    const denied = invoke(home, ["build", "--status", "completed"], envelope(context(), {
      directCompletion: true,
      answerConclusion: "已处理",
      finalSummary: "已直接完成",
      reportEventIds: reports,
    }));
    assert.equal(denied.status, 1, denied.stderr);
    assert.match(denied.stderr, /fields\.directCompletion/);
    assert.equal(denied.stdout, "");
    const directContext = context({ allowDirectCompletion: true, reviews: [], acceptancePlanKeys: [], reportEventIds: reports });
    const direct = invoke(home, ["build", "--status", "completed"], envelope(directContext, {
      directCompletion: true,
      answerConclusion: "已处理",
      finalSummary: "已直接完成",
      reportEventIds: reports,
    }));
    assert.equal(direct.status, 0, direct.stderr);
    const decision = reparse(direct.stdout, { allowDirectCompletion: true, acceptancePlanKeys: [], subtaskMax: 6 });
    assert.equal(decision.directCompletion, true);
    assert.equal(decision.acceptance, undefined);
    const dispatched = invoke(home, ["build", "--status", "dispatch"], envelope(context(), {
      reportEventIds: reports,
      subtasks: [{ id: "sub-dispatch", title: "派发", prompt: "完成独立交付并记录结果", taskType: "backend" }],
    }));
    assert.equal(dispatched.status, 0, dispatched.stderr);
    const dispatchDecision = reparse(dispatched.stdout, { subtaskMax: 6, acceptancePlanKeys: [] });
    assert.equal(dispatchDecision.status, "dispatch");
    assert.deepEqual(dispatchDecision.reportEventIds, reports);
    const blocked = invoke(home, ["build", "--status", "blocked"], envelope(context({ reportEventIds: [] }), {
      blocker: { kind: "recoverable" },
      finalSummary: "熔断说明已填写，但 blocker 仍不完整",
    }));
    assert.equal(blocked.status, 1, blocked.stderr);
    assert.equal(blocked.stdout, "");
    assert.match(blocked.stderr, /blocker/);
    const recovered = invoke(home, ["build", "--status", "blocked"], envelope(context({ reportEventIds: [] }), {
      blocker: {
        kind: "recoverable",
        cause: "CAUSE_SENTINEL_do_not_log",
        affectedRequirements: ["接口约定"],
        evidence: ["文档没有必填字段"],
        attempts: ["已查阅现有文档"],
        nextSteps: [{ owner: "接口负责人", action: "确认字段", verification: "字段齐全" }],
        resumeCondition: "字段已经明确",
      },
      finalSummary: "外部依赖未确认，任务不能继续",
    }));
    assert.equal(recovered.status, 0, recovered.stderr);
    const blockerDecision = reparse(recovered.stdout, { subtaskMax: 6, acceptancePlanKeys: [] });
    assert.equal((blockerDecision.blocker as Json).kind, "recoverable");
    assert.equal(readLogs(home).includes("CAUSE_SENTINEL_do_not_log"), false);
  });
});

test("oversized, nested, and disallowed input exits nonzero with a field correction", () => {
  withHome((home) => {
    const huge = invoke(home, ["build", "--status", "wait"], `{${" ".repeat(300_000)}}`);
    assert.equal(huge.status, 1);
    assert.equal(huge.stdout, "");
    assert.match(huge.stderr, /stdin/);
    let nested: unknown = { leaf: true };
    for (let index = 0; index < 9; index += 1) nested = { nested };
    const deep = invoke(home, ["build", "--status", "wait"], { context: context(), fields: nested });
    assert.equal(deep.status, 1, deep.stderr);
    assert.match(deep.stderr, /嵌套/);
    const unavailable = invoke(home, ["build", "--status", "accept"], envelope(context({ statuses: ["wait"] }), {}));
    assert.equal(unavailable.status, 1, unavailable.stderr);
    assert.equal(unavailable.stdout, "");
    assert.match(unavailable.stderr, /--status/);
    assert.match(unavailable.stderr, /wait/);
  });
});

test("log retention removes expired helper logs and a log write failure still returns the decision", () => {
  withHome((home) => {
    const logs = path.join(home, ".sinitek_cli", "logs");
    fs.mkdirSync(logs);
    const expired = path.join(logs, "sinitek-cli.expired.log");
    const recent = path.join(logs, "sinitek-cli.recent.log");
    const note = path.join(logs, "notes.txt");
    fs.writeFileSync(expired, "expired");
    fs.writeFileSync(recent, "RECENT_KEEP");
    fs.writeFileSync(note, "keep-note");
    const old = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    fs.utimesSync(expired, old, old);
    fs.utimesSync(note, old, old);
    const launched = invoke(home, ["build", "--status", "wait"], envelope(context(), { reportEventIds: reports }));
    assert.equal(launched.status, 0, launched.stderr);
    assert.equal(fs.existsSync(expired), false);
    assert.equal(fs.readFileSync(recent, "utf8"), "RECENT_KEEP");
    assert.equal(fs.readFileSync(note, "utf8"), "keep-note");
    assert.match(readLogs(home), /"reason":"decision\.authored"/);
  });
  withHome((home) => {
    fs.writeFileSync(path.join(home, ".sinitek_cli", "logs"), "not-a-directory");
    const launched = invoke(home, ["build", "--status", "wait"], envelope(context(), { reportEventIds: reports }));
    assert.equal(launched.status, 0, launched.stderr);
    assert.match(launched.stdout, /"status":"wait"/);
    assert.equal(launched.stderr, "");
  });
});

test("accept and dispatch templates list controls and build keeps parser-checked controls", () => {
  withHome((home) => {
    const acceptSnapshot = context({
      reviews: [{ eventId: "event-only", subtaskId: "sub-only" }],
      reportEventIds: [],
      acceptancePlanKeys: [],
    });
    const acceptTemplate = invoke(home, ["template", "--status", "accept"], envelope(acceptSnapshot, {}));
    assert.equal(acceptTemplate.status, 0, acceptTemplate.stderr);
    const acceptFields = JSON.parse(acceptTemplate.stdout).fields as Array<{ path: string; required: boolean; description: string }>;
    const acceptControls = acceptFields.find((field) => field.path === "controls");
    assert.equal(acceptControls?.required, false);
    assert.match(acceptControls?.description ?? "", /close 或 reprompt/);
    assert.match(acceptFields.find((field) => field.path === "reviews[0].repair")?.description ?? "", /taskType/);

    const dispatchSnapshot = context({ reportEventIds: [] });
    const dispatchTemplate = invoke(home, ["template", "--status", "dispatch"], envelope(dispatchSnapshot, {}));
    assert.equal(dispatchTemplate.status, 0, dispatchTemplate.stderr);
    const dispatchFields = JSON.parse(dispatchTemplate.stdout).fields as Array<{ path: string; required: boolean; description: string }>;
    assert.equal(dispatchFields.find((field) => field.path === "controls")?.required, false);
    assert.match(dispatchFields.find((field) => field.path === "subtasks")?.description ?? "", /taskType/);

    const accepted = invoke(home, ["build", "--status", "accept"], envelope(acceptSnapshot, {
      progressPercent: 12,
      acceptance: { passed: true, checks: checks(true) },
      reviews: [{ acceptance: "passed", reason: "实现与契约一致" }],
      controls: [{ id: "running-other", action: "close", reason: "范围已取消" }],
    }));
    assert.equal(accepted.status, 0, accepted.stderr);
    const acceptDecision = reparse(accepted.stdout, hostOptions(acceptSnapshot));
    assert.deepEqual(acceptDecision.controls, [{ id: "running-other", action: "close", reason: "范围已取消" }]);

    const acceptConflict = invoke(home, ["build", "--status", "accept"], envelope(acceptSnapshot, {
      progressPercent: 12,
      acceptance: { passed: false, checks: checks(false) },
      reviews: [{
        acceptance: "failed",
        reason: "定向测试失败",
        repair: { id: "sub-only", title: "返工", prompt: "修正失败分支", taskType: "backend" },
      }],
      controls: [{ id: "sub-only", action: "close", reason: "不要同时控制返工" }],
    }));
    assert.equal(acceptConflict.status, 1, acceptConflict.stderr);
    assert.equal(acceptConflict.stdout, "");
    assert.match(acceptConflict.stderr, /fields\.controls/);
    assert.match(acceptConflict.stderr, /冲突/);

    const dispatched = invoke(home, ["build", "--status", "dispatch"], envelope(dispatchSnapshot, {
      subtasks: [{ id: "sub-dispatch", title: "派发", prompt: "完成独立交付", taskType: "frontend" }],
      controls: [{ id: "running-other", action: "reprompt", title: "收窄范围", prompt: "只调整配置" }],
    }));
    assert.equal(dispatched.status, 0, dispatched.stderr);
    const dispatchDecision = reparse(dispatched.stdout, hostOptions(dispatchSnapshot));
    assert.deepEqual(dispatchDecision.controls, [{
      id: "running-other",
      action: "reprompt",
      title: "收窄范围",
      prompt: "只调整配置",
    }]);

    const dispatchConflict = invoke(home, ["build", "--status", "dispatch"], envelope(dispatchSnapshot, {
      subtasks: [{ id: "sub-dispatch", title: "派发", prompt: "完成独立交付", taskType: "frontend" }],
      controls: [{ id: "sub-dispatch", action: "close", reason: "同一 ID" }],
    }));
    assert.equal(dispatchConflict.status, 1, dispatchConflict.stderr);
    assert.match(dispatchConflict.stderr, /fields\.controls/);
    assert.match(dispatchConflict.stderr, /冲突/);

    const malformed = invoke(home, ["build", "--status", "dispatch"], envelope(dispatchSnapshot, {
      subtasks: [{ id: "sub-dispatch", title: "派发", prompt: "完成独立交付", taskType: "frontend" }],
      controls: [{ id: "running-other", action: "pause" }],
    }));
    assert.equal(malformed.status, 1, malformed.stderr);
    assert.match(malformed.stderr, /fields\.controls/);
    assert.match(malformed.stderr, /格式/);
  });
});

test("blocked template requires finalSummary and build submits it with blocker", () => {
  withHome((home) => {
    const snapshot = context({ reportEventIds: [] });
    const listed = invoke(home, ["template", "--status", "blocked"], envelope(snapshot, {}));
    assert.equal(listed.status, 0, listed.stderr);
    const fields = JSON.parse(listed.stdout).fields as Array<{ path: string; required: boolean }>;
    assert.equal(fields.find((field) => field.path === "finalSummary")?.required, true);
    assert.equal(fields.find((field) => field.path === "blocker")?.required, true);

    const missing = invoke(home, ["build", "--status", "blocked"], envelope(snapshot, {
      blocker: recoverableBlocker(),
    }));
    assert.equal(missing.status, 1, missing.stderr);
    assert.equal(missing.stdout, "");
    assert.match(missing.stderr, /fields\.finalSummary/);

    const blank = invoke(home, ["build", "--status", "blocked"], envelope(snapshot, {
      blocker: recoverableBlocker(),
      finalSummary: "  ",
    }));
    assert.equal(blank.status, 1, blank.stderr);
    assert.match(blank.stderr, /fields\.finalSummary/);

    const blocker = recoverableBlocker();
    const built = invoke(home, ["build", "--status", "blocked"], envelope(snapshot, {
      blocker,
      finalSummary: "调用方提交的非空熔断说明",
    }));
    assert.equal(built.status, 0, built.stderr);
    const decision = reparse(built.stdout, hostOptions(snapshot));
    assert.equal((decision.blocker as Json).kind, "recoverable");
    assert.equal(decision.finalSummary, buildLoopBlockerSummary(decision.blocker as LoopBlocker));
    assert.equal((decision.finalSummary as string).includes("接口联调缺少已确认的请求字段"), true);
  });
});

test("dispatch, repair, and independent tasks require taskType and keep general read-only", () => {
  withHome((home) => {
    const dispatchSnapshot = context({ reportEventIds: [] });
    const missing = invoke(home, ["build", "--status", "dispatch"], envelope(dispatchSnapshot, {
      subtasks: [{ id: "sub-missing", title: "缺分类", prompt: "完成交付" }],
    }));
    assert.equal(missing.status, 1, missing.stderr);
    assert.match(missing.stderr, /fields\.subtasks\[0\]\.taskType/);
    assert.match(missing.stderr, /backend、frontend 或 general/);

    const unknown = invoke(home, ["build", "--status", "dispatch"], envelope(dispatchSnapshot, {
      subtasks: [{ id: "sub-bad", title: "错分类", prompt: "完成交付", taskType: "coding" }],
    }));
    assert.match(unknown.stderr, /fields\.subtasks\[0\]\.taskType/);

    const generalWrite = invoke(home, ["build", "--status", "dispatch"], envelope(dispatchSnapshot, {
      subtasks: [{ id: "sub-gen", title: "只读", prompt: "分析资料", taskType: "general", writeFiles: ["src/a.ts"] }],
    }));
    assert.match(generalWrite.stderr, /fields\.subtasks\[0\]\.writeFiles/);

    const generalDelivery = invoke(home, ["build", "--status", "dispatch"], envelope(dispatchSnapshot, {
      subtasks: [{ id: "sub-gen", title: "只读", prompt: "分析资料", taskType: "general", codingDelivery: false }],
    }));
    assert.match(generalDelivery.stderr, /fields\.subtasks\[0\]\.codingDelivery/);

    const dispatched = invoke(home, ["build", "--status", "dispatch"], envelope(dispatchSnapshot, {
      subtasks: [
        { id: "sub-be", title: "接口", prompt: "实现接口", taskType: "backend", writeFiles: ["src/a.ts"] },
        { id: "sub-fe", title: "页面", prompt: "实现页面", taskType: "frontend", codingDelivery: true },
        { id: "sub-gen", title: "阅读", prompt: "只读分析", taskType: "general" },
      ],
    }));
    assert.equal(dispatched.status, 0, dispatched.stderr);
    const dispatchDecision = reparse(dispatched.stdout, hostOptions(dispatchSnapshot));
    const dispatchedTasks = dispatchDecision.subtasks as Array<Json>;
    assert.deepEqual(dispatchedTasks.map((item) => item.taskType), ["backend", "frontend", "general"]);
    assert.deepEqual(dispatchedTasks[0]?.writeFiles, ["src/a.ts"]);
    assert.equal(dispatchedTasks[1]?.codingDelivery, true);
    assert.equal(dispatchedTasks[2]?.writeFiles, undefined);
    assert.equal(dispatchedTasks[2]?.codingDelivery, undefined);

    const acceptSnapshot = context({
      reviews: [{ eventId: "event-only", subtaskId: "sub-only" }],
      reportEventIds: [],
      acceptancePlanKeys: [],
    });
    const repairBase = {
      progressPercent: 18,
      acceptance: { passed: false, checks: checks(false) },
    };
    const repairMissing = invoke(home, ["build", "--status", "accept"], envelope(acceptSnapshot, {
      ...repairBase,
      reviews: [{
        acceptance: "failed",
        reason: "需要返工",
        repair: { id: "sub-only", title: "返工", prompt: "修正失败分支" },
      }],
    }));
    assert.match(repairMissing.stderr, /fields\.reviews\[0\]\.repair\.taskType/);

    const repairGeneral = invoke(home, ["build", "--status", "accept"], envelope(acceptSnapshot, {
      ...repairBase,
      reviews: [{
        acceptance: "failed",
        reason: "需要返工",
        repair: { id: "sub-only", title: "返工", prompt: "修正失败分支", taskType: "general", codingDelivery: true },
      }],
    }));
    assert.match(repairGeneral.stderr, /fields\.reviews\[0\]\.repair\.codingDelivery/);

    const independentMissing = invoke(home, ["build", "--status", "accept"], envelope(acceptSnapshot, {
      ...repairBase,
      reviews: [{
        acceptance: "failed",
        reason: "需要返工",
        repair: { id: "sub-only", title: "返工", prompt: "修正失败分支", taskType: "backend" },
      }],
      independentSubtasks: [{ id: "sub-new", title: "独立派发", prompt: "完成剩余交付" }],
    }));
    assert.match(independentMissing.stderr, /fields\.independentSubtasks\[0\]\.taskType/);

    const independentGeneral = invoke(home, ["build", "--status", "accept"], envelope(acceptSnapshot, {
      ...repairBase,
      reviews: [{
        acceptance: "failed",
        reason: "需要返工",
        repair: { id: "sub-only", title: "返工", prompt: "修正失败分支", taskType: "frontend" },
      }],
      independentSubtasks: [{ id: "sub-new", title: "独立阅读", prompt: "只读分析", taskType: "general", writeFiles: ["docs/a.md"] }],
    }));
    assert.match(independentGeneral.stderr, /fields\.independentSubtasks\[0\]\.writeFiles/);

    const accepted = invoke(home, ["build", "--status", "accept"], envelope(acceptSnapshot, {
      ...repairBase,
      reviews: [{
        acceptance: "failed",
        reason: "需要返工",
        repair: { id: "sub-only", title: "返工", prompt: "修正失败分支", taskType: "backend" },
      }],
      independentSubtasks: [{ id: "sub-new", title: "独立阅读", prompt: "只读分析", taskType: "general" }],
    }));
    assert.equal(accepted.status, 0, accepted.stderr);
    const acceptDecision = reparse(accepted.stdout, hostOptions(acceptSnapshot));
    const acceptTasks = acceptDecision.subtasks as Array<Json>;
    assert.equal(acceptTasks.find((item) => item.id === "sub-only")?.taskType, "backend");
    assert.equal(acceptTasks.find((item) => item.id === "sub-only")?.requiresAcceptance, true);
    assert.equal(acceptTasks.find((item) => item.id === "sub-new")?.taskType, "general");
    assert.deepEqual(acceptDecision.independentSubtaskIds, ["sub-new"]);
  });

  const legacy = parseLoopPlusDecisionWithFeedback(JSON.stringify({
    status: "dispatch",
    subtasks: [{ id: "legacy", title: "旧任务", prompt: "保持兼容" }],
  }), { subtaskMax: 6, acceptancePlanKeys: [], frozenReviewEventIds: [] });
  assert.equal(legacy.rejectionReason, null);
  assert.equal(legacy.decision?.subtasks?.[0]?.taskType, undefined);
});

test("unsupported or contradictory fields get a field correction instead of being dropped", () => {
  withHome((home) => {
    const snapshot = context({ reportEventIds: [] });
    const blockedPlan = invoke(home, ["build", "--status", "blocked"], envelope(snapshot, {
      blocker: recoverableBlocker(),
      finalSummary: "已填写熔断说明",
      nextStepPlan: { objective: "继续" },
    }));
    assert.equal(blockedPlan.status, 1, blockedPlan.stderr);
    assert.match(blockedPlan.stderr, /fields\.nextStepPlan/);
    assert.match(blockedPlan.stderr, /blocked 不支持/);

    const waited = invoke(home, ["build", "--status", "wait"], envelope(context(), {
      reportEventIds: reports,
      controls: [{ id: "running-other", action: "close", reason: "不应出现" }],
    }));
    assert.equal(waited.status, 1, waited.stderr);
    assert.match(waited.stderr, /fields\.controls/);
    assert.match(waited.stderr, /wait 不支持/);

    const rounds = invoke(home, ["build", "--status", "wait"], envelope(context(), {
      reportEventIds: reports,
      estimatedRemainingRounds: 4,
    }));
    assert.equal(rounds.status, 0, rounds.stderr);
    const decision = reparse(rounds.stdout, hostOptions(context()));
    assert.equal(decision.estimatedRemainingRounds, 4);
    assert.deepEqual(decision.reportEventIds, reports);

    const tooManyRounds = invoke(home, ["build", "--status", "dispatch"], envelope(snapshot, {
      subtasks: [{ id: "sub-be", title: "接口", prompt: "实现接口", taskType: "backend" }],
      estimatedRemainingRounds: 101,
    }));
    assert.equal(tooManyRounds.status, 1, tooManyRounds.stderr);
    assert.match(tooManyRounds.stderr, /fields\.estimatedRemainingRounds/);
  });
});
