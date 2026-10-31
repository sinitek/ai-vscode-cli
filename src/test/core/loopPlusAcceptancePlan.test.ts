import test = require("node:test");
import assert = require("node:assert/strict");

import {
  type LoopPlusAcceptancePlanSnapshot,
  LOOP_PLUS_ACCEPTANCE_PLAN_MAX_COUNT,
  LOOP_PLUS_SYSTEM_ACCEPTANCE_PLAN_ID,
  LOOP_PLUS_SYSTEM_ACCEPTANCE_PLAN_NAME,
  buildLoopPlusAcceptancePlanFeedbackSection,
  buildLoopPlusAcceptanceFeedbackSection,
  buildLoopPlusAcceptancePlanPromptLines,
  buildLoopPlusAcceptancePlanPromptSection,
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

test("check normalization never adds the fixed baseline and accepts legacy boolean maps", () => {
  assert.deepEqual(normalizeLoopPlusAcceptancePlanChecks(["security", "other"]), ["security", "other"]);
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
  assert.equal(defaultName.ok, true);

  const otherBlank = upsertLoopPlusAcceptancePlan({ plans: base, name: "新方案", checks: ["other"], otherText: "   " });
  assert.deepEqual(otherBlank, { ok: false, error: "已勾选“其它”，请填写审查内容。" });

  const created = upsertLoopPlusAcceptancePlan({
    plans: base,
    name: "  新方案  ",
    checks: ["security", "other"],
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
    checks: ["security", "other"],
    otherText: "  review  ",
  });
  assert.deepEqual(custom, {
    id: "plan-a",
    name: "A",
    checks: ["security", "other"],
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

test("prompt lines inject only selected checks plus valid 其它 content", () => {
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
  assert.doesNotMatch(text, /Maintainability review/);
  assert.doesNotMatch(text, /Performance review/);
  assert.doesNotMatch(text, /UI aesthetics review/);
});

test("acceptance feedback lists every selected item only when each verdict is present", () => {
  const snapshot: LoopPlusAcceptancePlanSnapshot = {
    id: "plan-a",
    name: "上线前加严",
    checks: ["security", "other"],
    otherText: "确认审计日志不写入密钥",
    systemDefault: false,
  };
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
  assert.match(section?.body ?? "", /安全审查：未通过/);
  assert.match(section?.body ?? "", /其它：通过/);
  assert.match(section?.body ?? "", /原因：审计日志已脱敏，未写入密钥/);
  assert.doesNotMatch(section?.body ?? "", /审查内容：/);
  assert.doesNotMatch(section?.body ?? "", /代码可维护性审查/);
});

test("acceptance feedback includes default and per-event reasons within 50 characters", () => {
  const section = buildLoopPlusAcceptanceFeedbackSection({
    reviews: [{ eventId: "event-a", acceptance: "failed", reason: "测试断言失败，需先修复" }],
    checks: [{ name: "tests", passed: false, detail: "测试断言失败" }],
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
  assert.match(section?.body ?? "", /验收事件 1：未通过/);
  assert.match(section?.body ?? "", /默认验收·测试验证：未通过/);
  assert.match(section?.body ?? "", /安全审查：通过/);
  assert.match(section?.body ?? "", /原因：测试断言失败/);
  assert.equal(
    (section?.body.match(/原因：([^\n]+)/gu) ?? []).every((line) => Array.from(line.slice(3)).length <= 50),
    true,
  );
  assert.equal(buildLoopPlusAcceptanceFeedbackSection({
    reviews: [{ eventId: "event-a", acceptance: "passed" }],
  }), null);
});

test("acceptance feedback preserves the chosen reason language without translation", () => {
  const section = buildLoopPlusAcceptanceFeedbackSection({
    reviews: [{ eventId: "event-a", acceptance: "failed", reason: "The empty-input regression still fails." }],
    checks: [{ name: "tests", passed: false, detail: "Empty-input assertion fails." }],
  });
  assert.match(section?.body ?? "", /原因：The empty-input regression still fails\./u);
  assert.match(section?.body ?? "", /原因：Empty-input assertion fails\./u);
});

test("default acceptance feedback works without optional reviews and rejects invalid reasons", () => {
  for (const snapshot of [undefined, buildSystemLoopPlusAcceptancePlanSnapshot()]) {
    const section = buildLoopPlusAcceptanceFeedbackSection({
      snapshot,
      checks: [{ name: "artifacts", passed: true, detail: "仅调整提示词，无独立可运行产物" }],
    });
    assert.match(section?.body ?? "", /默认验收·产物可运行性：通过/);
    assert.match(section?.body ?? "", /原因：仅调整提示词，无独立可运行产物/);
  }
  for (const reason of [undefined, "  ", "字".repeat(51)]) {
    assert.equal(buildLoopPlusAcceptanceFeedbackSection({
      checks: [{ name: "tests", passed: false, detail: reason }],
    }), null);
  }
  assert.ok(buildLoopPlusAcceptanceFeedbackSection({
    checks: [{ name: "tests", passed: true, detail: "😀".repeat(50) }],
  }));
});

test("feedback never writes a partial bubble or fabricates reasons for selected reviews", () => {
  const snapshot: LoopPlusAcceptancePlanSnapshot = {
    id: "plan-a", name: "加严", checks: ["security", "performance"], otherText: "", systemDefault: false,
  };
  const checks = [{ name: "tests", passed: true, detail: "回归用例通过" }];
  for (const planResults of [
    undefined,
    [{ key: "security", passed: true, reason: "输入已校验" }],
    [{ key: "performance", passed: true, reason: "无重复请求" }, { key: "security", passed: true, reason: "输入已校验" }],
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
