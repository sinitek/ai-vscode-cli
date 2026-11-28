import test = require("node:test");
import assert = require("node:assert/strict");
import { loopPlusAcceptanceChecksFixture } from "../loopPlusAcceptFixture";

import {
  type LoopPlusAcceptancePlanSnapshot,
  LOOP_PLUS_ACCEPTANCE_PLAN_MAX_COUNT,
  LOOP_PLUS_ACCEPTANCE_PLAN_CHECK_KEYS,
  LOOP_PLUS_ACCEPTANCE_PLAN_CHECK_DEFINITIONS,
  LOOP_PLUS_SYSTEM_ACCEPTANCE_PLAN_ID,
  LOOP_PLUS_SYSTEM_ACCEPTANCE_PLAN_NAME,
  buildLoopPlusAcceptancePlanFeedbackSection,
  buildLoopPlusAcceptanceFeedbackSection,
  buildLoopPlusAcceptancePlanPromptLines,
  buildLoopPlusAcceptancePlanPromptSection,
  listLoopPlusAcceptancePlanFeedbackItems,
  buildSystemLoopPlusAcceptancePlan,
  buildSystemLoopPlusAcceptancePlanSnapshot,
  createLoopPlusAcceptancePlanId,
  hasLoopPlusAcceptancePlanName,
  isLoopPlusAcceptancePlanSnapshotEmpty,
  normalizeLoopPlusAcceptancePlanChecks,
  normalizeLoopPlusAcceptancePlanName,
  normalizeLoopPlusAcceptancePlanOtherText,
  normalizeLoopPlusAcceptancePlanSnapshot,
  normalizeLoopPlusAcceptancePlans,
  resolveLoopPlusAcceptancePlanSelectionId,
  deleteLoopPlusAcceptancePlan,
  upsertLoopPlusAcceptancePlan,
  type LoopPlusAcceptancePlan,
} from "../../loopPlusAcceptancePlan";

function plan(overrides: Partial<LoopPlusAcceptancePlan> = {}): LoopPlusAcceptancePlan {
  return {
    id: "plan-a",
    name: "上线前加严",
    checks: ["security"],
    otherText: "",
    updatedAt: 1,
    ...overrides,
  };
}

test("system default plan is built in, named 系统默认, and carries no optional checks", () => {
  const system = buildSystemLoopPlusAcceptancePlan();
  assert.equal(system.id, LOOP_PLUS_SYSTEM_ACCEPTANCE_PLAN_ID);
  assert.equal(system.name, LOOP_PLUS_SYSTEM_ACCEPTANCE_PLAN_NAME);
  assert.deepEqual(system.checks, []);
  assert.equal(system.otherText, "");
  assert.deepEqual(buildSystemLoopPlusAcceptancePlanSnapshot(), {
    id: LOOP_PLUS_SYSTEM_ACCEPTANCE_PLAN_ID,
    name: LOOP_PLUS_SYSTEM_ACCEPTANCE_PLAN_NAME,
    checks: [],
    otherText: "",
    systemDefault: true,
  });
});

test("check normalization preserves legacy selections and follows the six-check review order", () => {
  assert.deepEqual(LOOP_PLUS_ACCEPTANCE_PLAN_CHECK_KEYS, ["maintainability", "performance", "ui_aesthetics", "security", "other"]);
  assert.deepEqual(normalizeLoopPlusAcceptancePlanChecks(["security", "other", "ui_aesthetics"]), ["ui_aesthetics", "security", "other"]);
  assert.deepEqual(normalizeLoopPlusAcceptancePlanChecks({ ui_aesthetics: true, security: true, other: true }), ["ui_aesthetics", "security", "other"]);
  assert.equal(LOOP_PLUS_ACCEPTANCE_PLAN_CHECK_DEFINITIONS.find(({ key }) => key === "ui_aesthetics")?.label, "用户体验审查");
  const legacySnapshot = normalizeLoopPlusAcceptancePlanSnapshot({
    id: "legacy", name: "旧方案", checks: ["security", "ui_aesthetics"], otherText: "", systemDefault: false,
  });
  assert.deepEqual(legacySnapshot.checks, ["security", "ui_aesthetics"]);
  assert.deepEqual(listLoopPlusAcceptancePlanFeedbackItems(legacySnapshot).map(({ key }) => key), ["security", "ui_aesthetics"]);
  const legacyFeedback = buildLoopPlusAcceptancePlanFeedbackSection(legacySnapshot, [
    { key: "security", passed: true, reason: "旧安全结论" },
    { key: "ui_aesthetics", passed: true, reason: "旧体验结论" },
  ]);
  assert.ok(legacyFeedback);
  assert.ok(legacyFeedback.body.indexOf("| 安全审查 |") < legacyFeedback.body.indexOf("| 用户体验审查 |"));
  assert.deepEqual(normalizeLoopPlusAcceptancePlanChecks(["baseline", "unknown"]), []);
  assert.deepEqual(
    normalizeLoopPlusAcceptancePlanChecks({ maintainability: true, security: false, performance: true }),
    ["maintainability", "performance"],
  );
  assert.deepEqual(normalizeLoopPlusAcceptancePlanChecks(undefined), []);
  assert.deepEqual(normalizeLoopPlusAcceptancePlanChecks("security"), []);
  assert.deepEqual(
    normalizeLoopPlusAcceptancePlanChecks(["other", "security", "security"]),
    ["security", "other"],
  );
});

test("name and other-text normalization trims, bounds, and tolerates junk", () => {
  assert.equal(normalizeLoopPlusAcceptancePlanName("  上线   前  "), "上线 前");
  assert.equal(normalizeLoopPlusAcceptancePlanName("   "), "");
  assert.equal(normalizeLoopPlusAcceptancePlanName(undefined), "");
  assert.equal(normalizeLoopPlusAcceptancePlanName(42), "");
  assert.equal(normalizeLoopPlusAcceptancePlanName("a".repeat(80)).length, 60);
  assert.equal(normalizeLoopPlusAcceptancePlanName("bad\u0000name"), "");

  assert.equal(normalizeLoopPlusAcceptancePlanOtherText("  keep  "), "keep");
  assert.equal(normalizeLoopPlusAcceptancePlanOtherText(null), "");
  assert.equal(normalizeLoopPlusAcceptancePlanOtherText("x".repeat(5000)).length, 4000);
});

test("loading plans tolerates missing, legacy, and corrupt data", () => {
  assert.deepEqual(normalizeLoopPlusAcceptancePlans(undefined), []);
  assert.deepEqual(normalizeLoopPlusAcceptancePlans("nope"), []);

  const loaded = normalizeLoopPlusAcceptancePlans([
    { id: "plan-a", name: "  A  ", checks: { security: true }, otherText: "  ", updatedAt: "x" },
    { id: "plan-a", name: "duplicate id", checks: [], otherText: "" },
    { id: "", name: "no id", checks: [], otherText: "" },
    { id: "plan-b", name: "", checks: [], otherText: "" },
    { id: "system_default", name: "系统默认", checks: ["security"], otherText: "" },
    null,
    "string",
  ]);
  assert.equal(loaded.length, 1);
  assert.equal(loaded[0].id, "plan-a");
  assert.equal(loaded[0].name, "A");
  assert.deepEqual(loaded[0].checks, ["security"]);
  assert.equal(loaded[0].otherText, "");

  const many = Array.from({ length: LOOP_PLUS_ACCEPTANCE_PLAN_MAX_COUNT + 10 }, (_, index) => (
    plan({ id: `plan-${index}`, name: `方案 ${index}` })
  ));
  assert.equal(normalizeLoopPlusAcceptancePlans(many).length, LOOP_PLUS_ACCEPTANCE_PLAN_MAX_COUNT);
});

test("unchecked 其它 drops its text so it cannot count as a requirement", () => {
  const loaded = normalizeLoopPlusAcceptancePlans([
    plan({ id: "plan-a", checks: ["security"], otherText: "secret requirement" }),
    plan({ id: "plan-b", checks: ["other"], otherText: "  real requirement  " }),
  ]);
  assert.equal(loaded[0].otherText, "");
  assert.equal(loaded[1].otherText, "real requirement");
});

test("旧默认方案迁移为新建方案并保留内容、稳定标识及时间戳", () => {
  const legacy = plan({
    id: "plan-legacy",
    name: " 默认方案 ",
    checks: ["other", "security"],
    otherText: "检查鉴权边界",
    updatedAt: 42,
  });
  const migrated = normalizeLoopPlusAcceptancePlans([legacy]);
  assert.deepEqual(migrated, [{ ...legacy, name: "新建方案", checks: ["other", "security"] }]);
  assert.equal(resolveLoopPlusAcceptancePlanSelectionId(legacy.id, migrated), legacy.id);
  assert.deepEqual(normalizeLoopPlusAcceptancePlans(migrated), migrated);
  assert.equal(legacy.name, " 默认方案 ");
});

test("迁移旧默认方案避开已有名称且不覆盖任何方案", () => {
  const plans = [
    plan({ id: "legacy-a", name: "默认方案", checks: ["security"] }),
    plan({ id: "custom-a", name: "新建方案" }),
    plan({ id: "custom-b", name: "新建方案（2）" }),
    plan({ id: "legacy-b", name: "默认方案", checks: ["performance"] }),
  ];
  const migrated = normalizeLoopPlusAcceptancePlans(plans);
  assert.deepEqual(migrated.map((item) => item.name), ["新建方案（3）", "新建方案", "新建方案（2）", "新建方案（4）"]);
  assert.deepEqual(migrated.map((item) => item.id), plans.map((item) => item.id));
  assert.deepEqual(normalizeLoopPlusAcceptancePlans(migrated), migrated);
});

test("selection falls back to the system default when the id is unknown or corrupted", () => {
  const plans = [plan({ id: "plan-a" })];
  assert.equal(resolveLoopPlusAcceptancePlanSelectionId("plan-a", plans), "plan-a");
  assert.equal(resolveLoopPlusAcceptancePlanSelectionId("plan-missing", plans), LOOP_PLUS_SYSTEM_ACCEPTANCE_PLAN_ID);
  assert.equal(resolveLoopPlusAcceptancePlanSelectionId("", plans), LOOP_PLUS_SYSTEM_ACCEPTANCE_PLAN_ID);
  assert.equal(resolveLoopPlusAcceptancePlanSelectionId(undefined, plans), LOOP_PLUS_SYSTEM_ACCEPTANCE_PLAN_ID);
  assert.equal(resolveLoopPlusAcceptancePlanSelectionId(LOOP_PLUS_SYSTEM_ACCEPTANCE_PLAN_ID, plans), LOOP_PLUS_SYSTEM_ACCEPTANCE_PLAN_ID);
});

test("creating a plan needs a unique trimmed name and keeps 其它 validation", () => {
  const base = [plan({ id: "plan-a", name: "已有方案" })];
  const missing = upsertLoopPlusAcceptancePlan({ plans: base, name: "   ", checks: [], otherText: "" });
  assert.deepEqual(missing, { ok: false, error: "请输入验收方案名称。" });

  const duplicate = upsertLoopPlusAcceptancePlan({
    plans: base,
    name: " 已有方案 ",
    checks: ["security"],
    otherText: "",
    now: 50,
  });
  assert.equal(duplicate.ok, true);
  if (!duplicate.ok) {
    return;
  }
  assert.equal(duplicate.created, false);
  assert.equal(duplicate.plan.id, "plan-a");
  assert.equal(duplicate.plans.length, 1);
  assert.deepEqual(duplicate.plan.checks, ["security"]);

  const reserved = upsertLoopPlusAcceptancePlan({ plans: [], name: " 系统默认 ", checks: [], otherText: "" });
  assert.deepEqual(reserved, { ok: false, error: "已存在同名验收方案，请更换名称。" });
  const defaultName = upsertLoopPlusAcceptancePlan({ plans: [], name: "默认方案", checks: [], otherText: "" });
  assert.deepEqual(defaultName, { ok: false, error: "已存在同名验收方案，请更换名称。" });
  const systemSave = upsertLoopPlusAcceptancePlan({
    plans: [], planId: "system_default", name: "自定义名称", checks: ["security"], otherText: "",
  });
  assert.deepEqual(systemSave, { ok: false, error: "默认方案不能保存，请先选择新增方案。" });

  const otherBlank = upsertLoopPlusAcceptancePlan({ plans: base, name: "新方案", checks: ["other"], otherText: "   " });
  assert.deepEqual(otherBlank, { ok: false, error: "已勾选“其它”，请填写审查内容。" });

  const created = upsertLoopPlusAcceptancePlan({
    plans: base,
    name: "  新方案  ",
    checks: ["other", "security"],
    otherText: "  检查鉴权边界  ",
    now: 1234,
  });
  assert.equal(created.ok, true);
  if (!created.ok) {
    return;
  }
  assert.equal(created.created, true);
  assert.equal(created.plan.name, "新方案");
  assert.equal(created.plan.otherText, "检查鉴权边界");
  assert.match(created.plan.id, /^plan-/);
  assert.equal(created.plans.length, 2);
});

test("updating an existing plan renames in place and a same name overwrites that plan", () => {
  const plans = [plan({ id: "plan-a", name: "A" }), plan({ id: "plan-b", name: "B" })];
  const renamed = upsertLoopPlusAcceptancePlan({
    plans,
    planId: "plan-a",
    name: "A2",
    checks: ["performance"],
    otherText: "ignored",
    now: 99,
  });
  assert.equal(renamed.ok, true);
  if (!renamed.ok) {
    return;
  }
  assert.equal(renamed.created, false);
  assert.equal(renamed.plan.id, "plan-a");
  assert.equal(renamed.plan.name, "A2");
  assert.equal(renamed.plan.otherText, "");
  assert.deepEqual(renamed.plans.map((item) => item.id), ["plan-a", "plan-b"]);
  assert.equal(renamed.plans[1].name, "B");

  const collide = upsertLoopPlusAcceptancePlan({
    plans,
    planId: "plan-a",
    name: "B",
    checks: ["performance"],
    otherText: "",
    now: 70,
  });
  assert.equal(collide.ok, true);
  if (!collide.ok) {
    return;
  }
  assert.equal(collide.plan.id, "plan-b");
  assert.equal(collide.plans.length, 2);
  assert.equal(collide.plans.find((item) => item.id === "plan-a")?.name, "A");
  assert.deepEqual(collide.plans.find((item) => item.id === "plan-b")?.checks, ["performance"]);

  const gone = upsertLoopPlusAcceptancePlan({ plans, planId: "plan-missing", name: "C", checks: [], otherText: "" });
  assert.deepEqual(gone, { ok: false, error: "验收方案不存在或已被删除。" });
});

test("deleting a saved plan removes it and falls back to the system default", () => {
  const plans = [plan({ id: "plan-a", name: "默认方案" }), plan({ id: "plan-b", name: "B" })];
  const removed = deleteLoopPlusAcceptancePlan(plans, "plan-a", "plan-a");
  assert.equal(removed.ok, true);
  if (!removed.ok) {
    return;
  }
  assert.deepEqual(removed.plans.map((item) => item.id), ["plan-b"]);
  assert.equal(removed.selection, LOOP_PLUS_SYSTEM_ACCEPTANCE_PLAN_ID);

  const kept = deleteLoopPlusAcceptancePlan(plans, "plan-a", "plan-b");
  assert.equal(kept.ok, true);
  if (!kept.ok) {
    return;
  }
  assert.equal(kept.selection, "plan-b");
  assert.deepEqual(deleteLoopPlusAcceptancePlan(plans, LOOP_PLUS_SYSTEM_ACCEPTANCE_PLAN_ID, "plan-a"), {
    ok: false,
    error: "内置方案不能删除。",
  });
  assert.deepEqual(deleteLoopPlusAcceptancePlan(plans, "plan-missing", "plan-a"), {
    ok: false,
    error: "验收方案不存在或已被删除。",
  });
});

test("plan ids stay stable on rename and collide safely", () => {
  const first = createLoopPlusAcceptancePlanId([], 1000);
  assert.equal(first, createLoopPlusAcceptancePlanId([], 1000).replace(/$/, ""));
  assert.equal(createLoopPlusAcceptancePlanId([], 1000), first);
  assert.notEqual(createLoopPlusAcceptancePlanId([plan({ id: first })], 1000), first);
  assert.equal(hasLoopPlusAcceptancePlanName([plan({ id: "plan-a", name: "A" })], "A", "plan-a"), false);
  assert.equal(hasLoopPlusAcceptancePlanName([plan({ id: "plan-a", name: "A" })], "A", "plan-b"), true);
});

test("snapshots fall back to the baseline when missing, corrupt, or legacy", () => {
  const fallback = buildSystemLoopPlusAcceptancePlanSnapshot();
  assert.deepEqual(normalizeLoopPlusAcceptancePlanSnapshot(undefined), fallback);
  assert.deepEqual(normalizeLoopPlusAcceptancePlanSnapshot(null), fallback);
  assert.deepEqual(normalizeLoopPlusAcceptancePlanSnapshot({ id: "", name: "x" }), fallback);
  assert.deepEqual(normalizeLoopPlusAcceptancePlanSnapshot({ id: "plan-a", name: "" }), fallback);

  const custom = normalizeLoopPlusAcceptancePlanSnapshot({
    id: "plan-a",
    name: "A",
    checks: ["other", "security"],
    otherText: "  review  ",
  });
  assert.deepEqual(custom, {
    id: "plan-a",
    name: "A",
    checks: ["other", "security"],
    otherText: "review",
    systemDefault: false,
  });

  const systemWithChecks = normalizeLoopPlusAcceptancePlanSnapshot({
    id: LOOP_PLUS_SYSTEM_ACCEPTANCE_PLAN_ID,
    name: "被改写的系统默认",
    checks: ["security"],
    otherText: "",
    systemDefault: false,
  });
  assert.equal(systemWithChecks.name, LOOP_PLUS_SYSTEM_ACCEPTANCE_PLAN_NAME);
  assert.equal(systemWithChecks.systemDefault, true);
});

test("empty snapshots add no prompt lines at all", () => {
  assert.equal(isLoopPlusAcceptancePlanSnapshotEmpty(buildSystemLoopPlusAcceptancePlanSnapshot()), true);
  assert.deepEqual(buildLoopPlusAcceptancePlanPromptLines(buildSystemLoopPlusAcceptancePlanSnapshot()), []);
  assert.equal(buildLoopPlusAcceptancePlanPromptSection(null), "");
  assert.equal(buildLoopPlusAcceptancePlanPromptSection(undefined), "");
});

test("prompt lines inject reviews and user content in the shared order", () => {
  const lines = buildLoopPlusAcceptancePlanPromptLines({
    id: "plan-a",
    name: "上线前加严",
    checks: ["security", "other"],
    otherText: "确认审计日志不写入密钥",
    systemDefault: false,
  });
  const text = lines.join("\n");
  assert.match(text, /Additional acceptance reviews from the acceptance plan "上线前加严"/);
  assert.match(text, /additive/);
  assert.match(text, /never weaken it/);
  assert.match(text, /defensive code review only/);
  assert.match(text, /Do not reproduce a vulnerability/);
  assert.match(text, /evidence backed|backed by evidence/);
  assert.match(text, /User-supplied review content/);
  assert.match(text, /确认审计日志不写入密钥/);
  assert.ok(text.indexOf("Security review:") < text.indexOf("User-supplied review content"));
  assert.doesNotMatch(text, /Maintainability review/);
  assert.doesNotMatch(text, /Performance review/);
  assert.doesNotMatch(text, /User experience review/);
  assert.doesNotMatch(text, /conflicting dimension only|ui_aesthetics/);
});

test("legacy task snapshots retain persisted order in prompts and feedback", () => {
  const snapshot = normalizeLoopPlusAcceptancePlanSnapshot({
    id: "legacy-order", name: "旧方案", checks: ["other", "security"],
    otherText: "历史要求", systemDefault: false,
  });
  assert.deepEqual(snapshot.checks, ["other", "security"]);
  const prompt = buildLoopPlusAcceptancePlanPromptLines(snapshot);
  assert.ok(prompt.indexOf("User-supplied review content") < prompt.findIndex((line) => line.includes("Security review:")));
  assert.deepEqual(listLoopPlusAcceptancePlanFeedbackItems(snapshot).map(({ key }) => key), ["other", "security"]);
});

test("acceptance feedback lists every selected item only when each verdict is present", () => {
  const snapshot: LoopPlusAcceptancePlanSnapshot = {
    id: "plan-a",
    name: "上线前加严",
    checks: ["security", "other"],
    otherText: "确认审计日志不写入密钥",
    systemDefault: false,
  };
  assert.deepEqual(listLoopPlusAcceptancePlanFeedbackItems(snapshot).map(({ key }) => key), ["security", "other"]);
  assert.equal(buildLoopPlusAcceptancePlanFeedbackSection(snapshot, null), null);
  assert.equal(buildLoopPlusAcceptancePlanFeedbackSection(snapshot, [
    { key: "security", passed: true },
  ]), null);
  assert.equal(buildLoopPlusAcceptancePlanFeedbackSection(
    buildSystemLoopPlusAcceptancePlanSnapshot(),
    [{ key: "security", passed: true }],
  ), null);

  const section = buildLoopPlusAcceptancePlanFeedbackSection(snapshot, [
    { key: "security", passed: false, reason: "错误日志仍输出明文令牌" },
    { key: "other", passed: true, reason: "审计日志已脱敏，未写入密钥" },
  ]);
  assert.equal(section?.heading, "验收结果");
  assert.match(section?.body ?? "", /\| 审查内容 \| 审查结果 \|/);
  assert.match(section?.body ?? "", /\| 安全审查 \| ❌ 错误日志仍输出明文令牌 \|/);
  assert.match(section?.body ?? "", /\| 其它 \| ✅ 审计日志已脱敏，未写入密钥 \|/);
  assert.ok((section?.body ?? "").indexOf("| 安全审查 |") < (section?.body ?? "").indexOf("| 其它 |"));
  assert.doesNotMatch(section?.body ?? "", /审查内容：/);
  assert.doesNotMatch(section?.body ?? "", /代码可维护性审查/);
  assert.doesNotMatch(section?.body ?? "", /^- /mu);
});

test("legacy ui_aesthetics selection requests evidence and limits exceptions to explicit user intent", () => {
  const snapshot: LoopPlusAcceptancePlanSnapshot = {
    id: "legacy", name: "旧方案", checks: ["ui_aesthetics"], otherText: "", systemDefault: false,
  };
  const prompt = buildLoopPlusAcceptancePlanPromptLines(snapshot).join("\n");
  assert.match(prompt, /by default, judge from actual evidence whether visuals and terminology are consistent/);
  assert.match(prompt, /explicit requirement from the user's original or supplemental request applies to the current delivery and conflicts with a default UX convention/);
  assert.match(prompt, /follow that requirement for the conflicting dimension only/);
  assert.match(prompt, /Do not infer authorization from unrelated notes, subtask reports, or vague preferences/);
  assert.match(prompt, /distinctive page style, do not fail it merely for looking different; judge from actual evidence whether it achieves the requested style/);
  assert.match(prompt, /Name the exception and explain why it applies/);
  assert.match(prompt, /Keep reviewing all other applicable dimensions, including keyboard operation, feedback, error recovery, and narrow-width readability/);
  assert.match(prompt, /evidence-backed conclusion for the selected ui_aesthetics result/);
  assert.match(prompt, /Explicitly identify any aspects not covered and why; do not treat an exception or missing evidence as verification/);
  assert.match(prompt, /For all remaining cases include a result for every selected key: ui_aesthetics\./);
  assert.match(buildLoopPlusAcceptancePlanFeedbackSection(snapshot, [
    { key: "ui_aesthetics", passed: true, reason: "沿用旧键并有对应检查证据" },
  ])?.body ?? "", /用户体验审查/);
});

test("acceptance feedback includes full default and per-event evidence", () => {
  const section = buildLoopPlusAcceptanceFeedbackSection({
    subtaskTitles: ["修复空输入处理"],
    reviews: [{ eventId: "event-a", acceptance: "failed", reason: "测试断言失败，需先修复" }],
    checks: loopPlusAcceptanceChecksFixture({ tests: { passed: false, detail: "测试断言失败" } }),
    snapshot: {
      id: "plan-a",
      name: "上线前加严",
      checks: ["security"],
      otherText: "",
      systemDefault: false,
    },
    planResults: [{ key: "security", passed: true, reason: "未发现输入信任边界问题" }],
  });
  assert.equal(section?.heading, "验收结果");
  assert.match(section?.body ?? "", /^\*\*子任务：修复空输入处理\*\*\n\n\*\*整体验收结果：❌ 未通过\*\*\n\n❌ 测试断言失败，需先修复\n\n\| 审查内容/u);
  assert.doesNotMatch(section?.body ?? "", /验收事件|\| 整体验收结果/u);
  assert.match(section?.body ?? "", /\| 验证与运行 \| ❌ 测试验证未通过：测试断言失败 \/ 产物可运行性通过：/u);
  assert.match(section?.body ?? "", /\*\*附加审查\*\*\n\n\| 审查内容/u);
  assert.match(section?.body ?? "", /\| 安全审查 \| ✅ 未发现输入信任边界问题 \|/);
  const reasons = [...(section?.body.matchAll(/\| [✅❌] ([^|\n]+) \|$/gmu) ?? [])].map((match) => match[1].trim());
  assert.equal(reasons.length, 4);
  const longReason = "证据说明".repeat(30);
  const longSection = buildLoopPlusAcceptanceFeedbackSection({
    snapshot: { id: "plan-a", name: "加严", checks: ["performance", "security"], otherText: "", systemDefault: false },
    planResults: [
      { key: "performance", passed: true, reason: longReason },
      { key: "security", passed: false, reason: "安全边界仍有风险" },
    ],
  });
  assert.match(longSection?.body ?? "", new RegExp(longReason));
  assert.ok((longSection?.body ?? "").indexOf("性能审查") < (longSection?.body ?? "").indexOf("安全审查"));
  assert.equal(buildLoopPlusAcceptanceFeedbackSection({
    reviews: [{ eventId: "event-a", acceptance: "passed" }],
    checks: loopPlusAcceptanceChecksFixture(),
  }), null);
});

test("acceptance feedback explains when a failed delivery is completed without repair", () => {
  const section = buildLoopPlusAcceptanceFeedbackSection({
    checks: loopPlusAcceptanceChecksFixture(),
    reviews: [{
      eventId: "event-a",
      acceptance: "failed",
      reason: "旧路径未交付",
      noRepairReason: "后续目标已覆盖旧路径",
    }],
  });
  assert.match(section?.body ?? "", /❌ 旧路径未交付（无需修复：后续目标已覆盖旧路径）/u);
});

test("acceptance feedback preserves the chosen reason language without translation", () => {
  const section = buildLoopPlusAcceptanceFeedbackSection({
    reviews: [{ eventId: "event-a", acceptance: "failed", reason: "The empty-input regression still fails." }],
    checks: loopPlusAcceptanceChecksFixture({ tests: { passed: false, detail: "Empty-input assertion fails." } }),
  });
  assert.match(section?.body ?? "", /\n\n❌ The empty-input regression still fails\.\n\n/u);
  assert.match(section?.body ?? "", /\| 验证与运行 \| ❌ 测试验证未通过：Empty-input assertion fails\./u);
});

test("acceptance feedback identifies a batch above one shared table and escapes task titles", () => {
  const section = buildLoopPlusAcceptanceFeedbackSection({
    subtaskTitles: ["前端 *表单*\n## 结果", "后端 | API <script>"],
    reviews: [
      { eventId: "front", acceptance: "passed", reason: "表单回归通过" },
      { eventId: "back", acceptance: "failed", reason: "契约断言失败" },
    ],
    checks: loopPlusAcceptanceChecksFixture({ tests: { passed: false, detail: "后端契约断言失败" } }),
  });
  assert.ok(section);
  const [summary, table] = section.body.split("| 审查内容");
  assert.ok(summary.includes("前端 \\*表单\\* \\#\\# 结果"));
  assert.ok(summary.includes("后端 \\| API \\<script\\>"));
  assert.match(summary, /整体验收结果：❌ 未通过/u);
  assert.match(summary, /✅ 表单回归通过/u);
  assert.match(summary, /❌ 契约断言失败/u);
  assert.doesNotMatch(table, /子任务|验收事件|整体验收结果/u);
  assert.equal((section.body.match(/\| 审查内容/gu) ?? []).length, 1);
});

test("task-only acceptance derives the overall result from default and optional checks", () => {
  for (const passed of [true, false]) {
    const section = buildLoopPlusAcceptanceFeedbackSection({
      checks: loopPlusAcceptanceChecksFixture({ tests: { detail: "回归通过" } }),
      snapshot: { id: "security", name: "安全", checks: ["security"], otherText: "", systemDefault: false },
      planResults: [{ key: "security", passed, reason: passed ? "输入边界已校验" : "日志包含敏感信息" }],
    });
    assert.ok(section);
    assert.ok(section.body.startsWith(`**主任务验收**\n\n**整体验收结果：${passed ? "✅ 通过" : "❌ 未通过"}**\n\n| 审查内容`));
  }
  assert.equal(buildLoopPlusAcceptanceFeedbackSection({ subtaskTitles: ["无结果"] }), null);
});

test("three conclusions use stable pairs and expose failure in either member", () => {
  const pairs = [
    ["交付与范围", "dispatched work", "unauthorized changes"],
    ["契约与回归", "contracts", "omissions and regressions"],
    ["验证与运行", "tests", "artifacts"],
  ] as const;
  for (const [group, first, second] of pairs) {
    for (const failedName of [first, second]) {
      const checks = loopPlusAcceptanceChecksFixture({ [failedName]: { passed: false, detail: "缺少该项证据" } }).reverse();
      const section = buildLoopPlusAcceptanceFeedbackSection({ checks });
      assert.ok(section);
      const rows = section.body.split("\n").filter((line) => /^\| [^|]+ \| [✅❌]/u.test(line));
      assert.deepEqual(rows.map((line) => line.split("|")[1].trim()), pairs.map(([label]) => label));
      assert.equal(rows.filter((line) => line.includes("❌")).length, 1);
      assert.ok(rows.find((line) => line.startsWith(`| ${group} | ❌`))?.includes("未通过：缺少该项证据 / "));
      assert.match(section.body, /整体验收结果：❌ 未通过/u);
    }
  }
  const sameEvidence = buildLoopPlusAcceptanceFeedbackSection({ checks: loopPlusAcceptanceChecksFixture({
    tests: { detail: "这次冒烟覆盖断言和启动" }, artifacts: { detail: "这次冒烟覆盖断言和启动" },
  }) });
  assert.match(sameEvidence?.body ?? "", /\| 验证与运行 \| ✅ 这次冒烟覆盖断言和启动 \|/u);
});

test("incomplete, duplicate or unknown default checks produce no partial conclusion", () => {
  const checks = loopPlusAcceptanceChecksFixture();
  const reviews = [{ eventId: "one", acceptance: "passed" as const, reason: "交付通过" }];
  for (const incomplete of [undefined, [], checks.slice(1), [checks[1], ...checks.slice(1)],
    [{ ...checks[0], name: "unknown" }, ...checks.slice(1)], [...checks, checks[0]]]) {
    assert.equal(buildLoopPlusAcceptanceFeedbackSection({ checks: incomplete, reviews }), null);
  }
});

test("default acceptance feedback works without optional reviews and rejects invalid reasons", () => {
  for (const snapshot of [undefined, buildSystemLoopPlusAcceptancePlanSnapshot()]) {
    const section = buildLoopPlusAcceptanceFeedbackSection({
      snapshot,
      checks: loopPlusAcceptanceChecksFixture({ artifacts: { detail: "仅调整提示词，无独立可运行产物" } }),
    });
    assert.match(section?.body ?? "", /\| 验证与运行 \| ✅ [^\n]*产物可运行性：仅调整提示词，无独立可运行产物 \|/u);
  }
  for (const reason of [undefined, "  "]) {
    assert.equal(buildLoopPlusAcceptanceFeedbackSection({
      checks: loopPlusAcceptanceChecksFixture().map((check) => check.name === "tests" ? { ...check, detail: reason } : check),
    }), null);
  }
  assert.ok(buildLoopPlusAcceptanceFeedbackSection({
    checks: loopPlusAcceptanceChecksFixture({ tests: { detail: "😀".repeat(50) } }),
  }));
});

test("feedback never writes a partial bubble or fabricates reasons for selected reviews", () => {
  const snapshot: LoopPlusAcceptancePlanSnapshot = {
    id: "plan-a", name: "加严", checks: ["security", "performance"], otherText: "", systemDefault: false,
  };
  const checks = loopPlusAcceptanceChecksFixture({ tests: { detail: "回归用例通过" } });
  for (const planResults of [
    undefined,
    [{ key: "security", passed: true, reason: "输入已校验" }],
    [{ key: "security", passed: true, reason: "输入已校验" }, { key: "security", passed: false, reason: "结论冲突" }],
    [{ key: "security", passed: true }, { key: "performance", passed: true, reason: "无重复请求" }],
  ]) {
    assert.equal(buildLoopPlusAcceptanceFeedbackSection({ snapshot, checks, planResults }), null);
    assert.equal(buildLoopPlusAcceptancePlanFeedbackSection(snapshot, planResults), null);
  }
});

test("其它 text is not injected when the checkbox is unchecked", () => {
  const text = buildLoopPlusAcceptancePlanPromptSection({
    id: "plan-a",
    name: "A",
    checks: ["maintainability"],
    otherText: "这段文字不应出现在提示词里",
    systemDefault: false,
  });
  assert.match(text, /Maintainability review/);
  assert.doesNotMatch(text, /这段文字不应出现在提示词里/);
  assert.doesNotMatch(text, /other/i);
});

test("撤销反馈展示原因，不把撤销当作失败或通过", () => {
  const prompt = buildLoopPlusAcceptancePlanPromptLines({ ...buildSystemLoopPlusAcceptancePlanSnapshot(), checks: ["security"] }).join("\n");
  assert.match(prompt, /when all accept\.reviews have acceptance=cancelled/);
  assert.match(prompt, /omit acceptance and acceptancePlanResults/);
  const cancelled = { eventId: "obsolete", acceptance: "cancelled" as const, reason: "用户已取消该需求" };
  const section = buildLoopPlusAcceptanceFeedbackSection({
    snapshot: { ...buildSystemLoopPlusAcceptancePlanSnapshot(), checks: ["security"] }, subtaskTitles: ["旧交付"], reviews: [cancelled],
  });
  assert.ok(section);
  assert.match(section.body, /验收已撤销/u);
  assert.match(section.body, /用户已取消该需求/u);
  assert.doesNotMatch(section.body, /✅|❌|默认验收/u);
  const mixed = buildLoopPlusAcceptanceFeedbackSection({
    subtaskTitles: ["旧交付", "新交付"],
    checks: loopPlusAcceptanceChecksFixture(),
    reviews: [cancelled, { eventId: "keep", acceptance: "passed", reason: "测试通过" }],
  });
  assert.ok(mixed);
  assert.match(mixed.body, /部分验收已撤销，其余通过/u);
});
