import test = require("node:test");
import assert = require("node:assert/strict");

import {
  buildLoopPlusAcceptancePlanSelectionPanelValue,
  buildLoopPlusAcceptancePlansPanelValue,
  readLoopPlusAcceptancePlanPanelState,
  deleteLoopPlusAcceptancePlan,
  saveLoopPlusAcceptancePlan,
  selectLoopPlusAcceptancePlan,
  type LoopPlusAcceptancePlanSettingsHost,
} from "../../extensionHost/loopPlusAcceptancePlanHost";
import type { WorkspaceSettings } from "../../workspaceSettingsStore";

function createHost(initial: WorkspaceSettings = {}): LoopPlusAcceptancePlanSettingsHost & {
  saved: WorkspaceSettings[];
  failNextSave: boolean;
  current: WorkspaceSettings;
} {
  const host = {
    current: initial,
    saved: [] as WorkspaceSettings[],
    failNextSave: false,
    getWorkspaceSettings(): WorkspaceSettings {
      return host.current;
    },
    setWorkspaceSettings(settings: WorkspaceSettings): void {
      host.current = settings;
    },
    saveWorkspaceSettings(settings: WorkspaceSettings) {
      if (host.failNextSave) {
        host.failNextSave = false;
        return { ok: false, error: "boom" };
      }
      host.saved.push(settings);
      return { ok: true };
    },
  };
  return host;
}

test("an empty workspace exposes the system default selection only", () => {
  const state = readLoopPlusAcceptancePlanPanelState({});
  assert.deepEqual(state, { plans: [], selection: "system_default" });
  assert.deepEqual(buildLoopPlusAcceptancePlansPanelValue({}), []);
  assert.equal(buildLoopPlusAcceptancePlanSelectionPanelValue({}), "system_default");
});

test("creating a plan persists it beside other settings and selects it", () => {
  const host = createHost({ workspaceMemoryEnabled: true });
  const result = saveLoopPlusAcceptancePlan(host, {
    planId: null,
    name: " 上线前加严 ",
    checks: ["security"],
    otherText: "",
  });
  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  assert.equal(result.plan.name, "上线前加严");
  assert.equal(result.selection, result.plan.id);
  assert.equal(host.saved.length, 1);
  const persisted = host.saved[0];
  assert.equal(persisted.workspaceMemoryEnabled, true);
  assert.equal(persisted.loopPlusAcceptancePlanSelection, result.plan.id);
  assert.deepEqual(persisted.loopPlusAcceptancePlans?.map((plan) => plan.name), ["上线前加严"]);
});

test("updating a plan keeps its stable id, renames in place, and never duplicates", () => {
  const host = createHost();
  const created = saveLoopPlusAcceptancePlan(host, {
    planId: null,
    name: "A",
    checks: ["security"],
    otherText: "",
  });
  assert.equal(created.ok, true);
  if (!created.ok) {
    return;
  }
  const updated = saveLoopPlusAcceptancePlan(host, {
    planId: created.plan.id,
    name: "A2",
    checks: ["performance", "other"],
    otherText: " 检查热点路径 ",
  });
  assert.equal(updated.ok, true);
  if (!updated.ok) {
    return;
  }
  assert.equal(updated.plan.id, created.plan.id);
  assert.equal(updated.plan.name, "A2");
  assert.equal(updated.plan.otherText, "检查热点路径");
  assert.equal(updated.plans.length, 1);
  assert.equal(host.current.loopPlusAcceptancePlans?.length, 1);
});

test("save failures surface a Chinese error and leave stored settings untouched", () => {
  const host = createHost();
  host.failNextSave = true;
  const result = saveLoopPlusAcceptancePlan(host, {
    planId: null,
    name: "A",
    checks: [],
    otherText: "",
  });
  assert.deepEqual(result, { ok: false, error: "验收方案保存失败，请稍后重试。" });
  assert.deepEqual(host.current, {});
});

test("invalid drafts and duplicate names are rejected before any write", () => {
  const host = createHost();
  saveLoopPlusAcceptancePlan(host, { planId: null, name: "A", checks: [], otherText: "" });
  const writesBefore = host.saved.length + 1;

  const duplicate = saveLoopPlusAcceptancePlan(host, {
    planId: null,
    name: "A",
    checks: ["security"],
    otherText: "",
  });
  assert.equal(duplicate.ok, true);
  if (!duplicate.ok) {
    return;
  }
  assert.equal(duplicate.plans.length, 1);
  assert.equal(duplicate.plan.name, "A");
  assert.deepEqual(duplicate.plan.checks, ["security"]);
  assert.equal(host.current.loopPlusAcceptancePlans?.length, 1);

  const blankOther = saveLoopPlusAcceptancePlan(host, {
    planId: null,
    name: "B",
    checks: ["other"],
    otherText: "  ",
  });
  assert.deepEqual(blankOther, { ok: false, error: "已勾选“其它”，请填写审查内容。" });

  const blankName = saveLoopPlusAcceptancePlan(host, { planId: null, name: "   ", checks: [], otherText: "" });
  assert.deepEqual(blankName, { ok: false, error: "请输入验收方案名称。" });

  assert.equal(host.saved.length, writesBefore);
});

test("deleting the selected plan falls back to the system default", () => {
  const host = createHost();
  const created = saveLoopPlusAcceptancePlan(host, { planId: null, name: "默认方案", checks: ["security"], otherText: "" });
  assert.equal(created.ok, true);
  if (!created.ok) {
    return;
  }
  const removed = deleteLoopPlusAcceptancePlan(host, created.plan.id);
  assert.equal(removed.ok, true);
  if (!removed.ok) {
    return;
  }
  assert.equal(removed.selection, "system_default");
  assert.equal(removed.plans.length, 0);
  assert.equal(host.current.loopPlusAcceptancePlans, undefined);
  assert.deepEqual(deleteLoopPlusAcceptancePlan(host, "system_default"), {
    ok: false,
    error: "内置方案不能删除。",
  });
});

test("selection persists and unknown or corrupted selections fall back to the system default", () => {
  const host = createHost();
  const created = saveLoopPlusAcceptancePlan(host, { planId: null, name: "A", checks: [], otherText: "" });
  assert.equal(created.ok, true);
  if (!created.ok) {
    return;
  }
  const selected = selectLoopPlusAcceptancePlan(host, created.plan.id);
  assert.deepEqual(selected, { ok: true, selection: created.plan.id });
  assert.equal(host.current.loopPlusAcceptancePlanSelection, created.plan.id);

  assert.deepEqual(selectLoopPlusAcceptancePlan(host, "plan-missing"), {
    ok: false,
    error: "验收方案不存在或已被删除。",
  });
  assert.deepEqual(selectLoopPlusAcceptancePlan(host, ""), { ok: true, selection: "system_default" });
});

test("a stored selection pointing at a deleted plan resolves back to the system default", () => {
  const state = readLoopPlusAcceptancePlanPanelState({
    loopPlusAcceptancePlans: [],
    loopPlusAcceptancePlanSelection: "plan-deleted",
  });
  assert.equal(state.selection, "system_default");
});
