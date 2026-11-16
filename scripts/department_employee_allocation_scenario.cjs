/* Bounded display fixture scenario, run by department_group_chat_smoke.cjs.
 * No domain policy, durable writer, scheduler or external model is installed here. */
const assert = require("node:assert/strict");
const path = require("node:path");

function allocationFixture(state) {
  const department = state.department;
  department.employeeAllocationEditable = true;
  department.employeeAllocation = { rootTaskId: department.rootTaskId, revision: 3, defaultLimit: 5,
    leaders: department.leaders.filter((leader) => leader.taskId).map((leader) => ({ leaderTaskId: leader.taskId,
      source: "default", desiredLimit: 5, appliedLimit: null, activeEmployees: 0, pending: false })) };
}

async function runAllocationScenario({ page, panel, parentState: state, sent, showMembers, overflow, settle, output, name }) {
  const snapshot = () => state.department.employeeAllocation;
  const root = state.department.rootTaskId;
  const a = state.department.leaders[0].taskId, b = state.department.leaders[1].taskId;
  const row = (id = a) => page.locator('[data-allocation-leader="' + id + '"]');
  const input = (id = a) => row(id).locator("input");
  const save = () => row().locator('[data-allocation-action="save"]');
  const reset = () => row().locator('[data-allocation-action="reset"]');
  const feedback = () => row().locator(".department-allocation-feedback");
  const requests = () => sent.filter((message) => message.type === "loopGroupChatChat:updateDepartmentEmployeeLimit");
  const patch = async () => { panel.update(structuredClone(state)); await settle(); };
  const receipt = async (request, patch = {}) => { panel.post({ type: "loopGroupChatChat:departmentEmployeeLimitSettled", rootTaskId: root,
    leaderTaskId: request.leaderTaskId, requestId: request.requestId, ok: true, revision: snapshot().revision,
    desiredLimit: snapshot().leaders.find((leader) => leader.leaderTaskId === request.leaderTaskId).desiredLimit, ...patch }); await settle(); };
  const confirm = async (request) => {
    const current = snapshot().leaders.find((leader) => leader.leaderTaskId === request.leaderTaskId);
    current.source = request.employeeLimit === null ? "default" : "manual";
    current.desiredLimit = request.employeeLimit ?? snapshot().defaultLimit; current.pending = true;
    snapshot().revision += 1;
    await patch(); await receipt(request);
  };
  await showMembers(page);
  assert.equal(await input().inputValue(), "5");
  assert.match(await row().innerText(), /默认均分.*待首次派发/u);
  assert.doesNotMatch(await row().innerText(), /已应用上限 0/u);
  assert.equal(await row("").locator("input").isDisabled(), true);
  await input().fill("7"); await input().blur(); await settle(); assert.equal(requests().length, 0, "input and blur never submit");
  snapshot().leaders[0].activeEmployees = 1; await patch();
  assert.equal(await input().inputValue(), "7", "content patch preserves unsaved draft");
  assert.equal(await input(b).inputValue(), "5", "draft is scoped to its leader");
  for (const invalid of ["-1", "1.5", "21", ""]) {
    await input().fill(invalid); await input().press("Enter"); await settle();
    assert.match(await feedback().innerText(), /整数/u);
    assert.equal(await input().evaluate((element) => document.activeElement === element), true);
    assert.equal(await input().inputValue(), invalid); assert.equal(requests().length, 0);
  }
  await input().fill("7"); await input().press("Enter"); await settle();
  assert.equal(requests().length, 1); const first = requests()[0];
  assert.equal(first.employeeLimit, 7); assert.equal(first.expectedRevision, 3); assert.equal(first.leaderTaskId, a);
  assert.equal(await input().isDisabled(), true); assert.equal(await reset().isDisabled(), true);
  assert.equal(await save().innerText(), "保存中…");
  await receipt(first, { rootTaskId: "other-root" }); assert.equal(await input().isDisabled(), true);
  await receipt(first, { leaderTaskId: b }); assert.equal(await input().isDisabled(), true);
  await receipt(first, { requestId: "other-request" }); assert.equal(await input().isDisabled(), true);
  await page.screenshot({ path: path.join(output, `${name}-allocation-pending.png`) });
  await confirm(first);
  assert.equal(await input().inputValue(), "7"); assert.equal(await input().isEnabled(), true);
  assert.match(await row().innerText(), /手动.*实际占用 1.*待首次派发.*已保存，下次派发生效/u);
  await reset().click(); await settle(); const resetting = requests().at(-1);
  assert.equal(resetting.employeeLimit, null); assert.equal(resetting.expectedRevision, 4);
  await confirm(resetting); assert.equal(await input().inputValue(), "5"); assert.match(await row().innerText(), /默认均分/u);
  await input().fill("0"); await save().click(); await settle(); const zero = requests().at(-1);
  assert.equal(zero.employeeLimit, 0); assert.notEqual(zero.employeeLimit, resetting.employeeLimit);
  await confirm(zero); assert.equal(await input().inputValue(), "0");
  await input().fill("9"); await save().click(); await settle(); const failed = requests().at(-1);
  await receipt(failed, { ok: false, error: "保存失败：夹具模拟持久服务不可用，请重试。" });
  assert.equal(await input().inputValue(), "9"); assert.equal(await input().isEnabled(), true);
  assert.match(await feedback().innerText(), /保存失败/u);
  await page.screenshot({ path: path.join(output, `${name}-allocation-failure-state.png`) });
  await save().click(); await settle(); const retry = requests().at(-1);
  assert.notEqual(retry.requestId, failed.requestId);
  await receipt(failed); assert.equal(await input().isDisabled(), true, "old receipt cannot settle a new request");
  // Simulate an edit queued by a client before its in-flight receipt was processed.
  // Controls remain disabled to real users while saving; edit-version isolation is defensive.
  await input().evaluate((element) => { element.value = "11"; element.dispatchEvent(new Event("input", { bubbles: true })); });
  await confirm(retry); assert.equal(await input().inputValue(), "11", "receipt never overwrites a later edit");
  assert.match(await row().innerText(), /手动/u);
  await input().press("Enter"); await settle(); const newRequest = requests().at(-1);
  await receipt(retry); assert.equal(await input().isDisabled(), true);
  await confirm(newRequest); assert.equal(await input().inputValue(), "11");
  snapshot().leaders[0].appliedLimit = 11; snapshot().leaders[0].pending = false; await patch();
  assert.match(await row().innerText(), /已应用上限 11/u);
  await input().fill("12"); await input(b).fill("8"); await patch();
  assert.equal(await input().inputValue(), "12"); assert.equal(await input(b).inputValue(), "8");
  await input().press("Enter"); await settle(); const oldRootRequest = requests().at(-1);
  state.task.id = "fixture-new-root"; state.department.rootTaskId = state.task.id; snapshot().rootTaskId = state.task.id;
  await patch(); await receipt(oldRootRequest);
  assert.equal(await input().inputValue(), "11", "root change clears drafts and in-flight state");
  assert.equal(await input(b).inputValue(), "5"); assert.equal(await input().isEnabled(), true);
  assert.equal(await feedback().innerText(), "");
  state.department.employeeAllocationEditable = false; await patch();
  assert.equal(await input().isDisabled(), true); assert.match(await row().innerText(), /写入服务不可用/u);
  state.department.employeeAllocation = undefined; await patch();
  assert.equal(await input().inputValue(), ""); assert.match(await row().innerText(), /未知/u);
  allocationFixture(state); await patch();
  await overflow(page);
  const geometry = await row().evaluate((element) => {
    const controls = element.querySelector(".department-allocation-controls"), input = element.querySelector("input");
    const box = element.getBoundingClientRect();
    return { rowLeft: box.left, rowRight: box.right, viewport: innerWidth, controlsGap: getComputedStyle(controls).gap,
      marginTop: getComputedStyle(controls).marginTop, inputWidth: input.getBoundingClientRect().width,
      controlsOverflow: controls.scrollWidth > controls.clientWidth + 1 };
  });
  assert.equal(geometry.controlsGap, "8px"); assert.equal(geometry.marginTop, "4px");
  assert.ok(geometry.inputWidth <= 64); assert.equal(geometry.controlsOverflow, false);
  assert.ok(geometry.rowRight <= geometry.viewport + 1);
  await input().focus(); assert.equal(await input().evaluate((element) => document.activeElement === element && !element.closest("[inert]")), true);
  await reset().focus(); assert.equal(await reset().evaluate((element) => document.activeElement === element && !element.closest("[inert]")), true);
  await page.screenshot({ path: path.join(output, `${name}-allocation.png`) });
  return { checks: ["save and Enter", "null reset vs numeric zero", "integer validation and focus", "pending and retry draft", "late root/leader/request/edit receipts", "contentPatch draft isolation", "unavailable reader/writer", "first dispatch vs applied", "responsive geometry and accessible controls"],
    geometry, requestCount: requests().length };
}
module.exports = { allocationFixture, runAllocationScenario };
