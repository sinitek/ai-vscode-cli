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
  const dialog = page.getByRole("dialog", { name: "分配员工" });
  const actions = page.locator("#panelActions");
  const opener = actions.getByRole("button", { name: "分配员工" });
  assert.equal(await actions.getByRole("button", { name: "刷新", exact: true }).count(), 0);
  assert.equal(await actions.locator('[data-action="askMainModel"] + [data-action="allocateEmployees"]').count(), 1);
  if (page.viewportSize().width > 780) {
    const questionButton = await actions.getByRole("button", { name: "我要提问" }).boundingBox();
    const allocationButton = await opener.boundingBox();
    assert.ok(questionButton && allocationButton && allocationButton.x >= questionButton.x + questionButton.width);
    assert.equal(allocationButton.y, questionButton.y);
  }
  const row = (id = a) => dialog.locator('[data-allocation-leader="' + id + '"]');
  const input = (id = a) => row(id).locator("input");
  const save = dialog.locator("#departmentAllocationSave");
  const close = dialog.getByRole("button", { name: "关闭", exact: true });
  const feedback = (id) => row(id).locator(".department-allocation-feedback");
  const requests = () => sent.filter((message) => message.type === "loopGroupChatChat:updateDepartmentEmployeeLimit");
  const patch = async () => { panel.update(structuredClone(state)); await settle(); };
  const receipt = async (request, patch = {}) => { panel.post({ type: "loopGroupChatChat:departmentEmployeeLimitSettled", rootTaskId: root,
    leaderTaskId: request.leaderTaskId, requestId: request.requestId, ok: true, revision: snapshot().revision,
    desiredLimit: snapshot().leaders.find((leader) => leader.leaderTaskId === request.leaderTaskId).desiredLimit, ...patch }); await settle(); };
  const confirm = async (request) => {
    const current = snapshot().leaders.find((leader) => leader.leaderTaskId === request.leaderTaskId);
    current.source = "manual";
    current.desiredLimit = request.employeeLimit; current.pending = true;
    snapshot().revision += 1;
    await patch(); await receipt(request);
  };
  await showMembers(page);
  const roster = page.locator("#rosterPanelSlot");
  assert.equal(await roster.locator("input, [data-allocation-action], [data-action='allocateEmployees']").count(), 0);
  assert.doesNotMatch(await roster.innerText(), /员工参考额度|恢复均分/u);
  assert.equal(await dialog.isVisible(), false);
  await opener.press("Enter"); await dialog.waitFor();
  assert.equal(await dialog.locator("button").count(), 2);
  assert.equal(await dialog.locator(".dialog-header #departmentAllocationClose svg").count(), 1);
  assert.equal(await dialog.locator(".dialog-actions #departmentAllocationSave").innerText(), "保存并关闭");
  assert.notEqual(await input().getAttribute("aria-label"), await input(b).getAttribute("aria-label"));
  assert.equal(await input().inputValue(), "5");
  assert.match(await row().innerText(), /默认均分.*待首次派发/u);
  assert.doesNotMatch(await row().innerText(), /上次派发参考 0/u);
  assert.equal(await row("").locator("input").isDisabled(), true);
  await input().fill("6");
  await page.keyboard.press("Escape"); await dialog.waitFor({ state: "hidden" });
  assert.equal(await opener.evaluate((element) => document.activeElement === element), true);
  assert.equal(requests().length, 0);
  await opener.click();
  assert.equal(await input().inputValue(), "5", "closing discards unsaved edits");
  await input(b).fill("8"); await close.click(); await dialog.waitFor({ state: "hidden" });
  assert.equal(await opener.evaluate((element) => document.activeElement === element), true);
  await opener.click(); assert.equal(await input(b).inputValue(), "5");
  await save.click(); await dialog.waitFor({ state: "hidden" });
  assert.equal(requests().length, 0, "saving without changes only closes the dialog");
  await opener.click();
  await input().fill("7"); await input().blur(); await settle(); assert.equal(requests().length, 0, "input and blur never submit");
  snapshot().leaders[0].activeEmployees = 1; await patch();
  assert.equal(await input().inputValue(), "7", "content patch preserves unsaved draft");
  assert.equal(await input(b).inputValue(), "5", "draft is scoped to its leader");
  for (const invalid of ["-1", "1.5", "21", ""]) {
    await input(b).fill(invalid); await input().press("Enter"); await settle();
    assert.match(await feedback(b).innerText(), /整数/u);
    assert.equal(await input(b).evaluate((element) => document.activeElement === element), true);
    assert.equal(await input(b).inputValue(), invalid); assert.equal(requests().length, 0, "all drafts are validated before any write");
  }
  await input(b).fill("0"); await patch();
  assert.equal(await input(b).evaluate((element) => document.activeElement === element), true);
  await save.click(); await settle();
  assert.equal(requests().length, 1); const first = requests()[0];
  assert.equal(first.employeeLimit, 7); assert.equal(first.expectedRevision, 3); assert.equal(first.leaderTaskId, a);
  assert.equal(await input().isDisabled(), true); assert.equal(await input(b).isDisabled(), true);
  assert.equal(await save.isDisabled(), true); assert.equal(await close.isDisabled(), true);
  assert.equal(await save.innerText(), "保存中…");
  await page.keyboard.press("Escape"); assert.equal(await dialog.isVisible(), true);
  await receipt(first, { rootTaskId: "other-root" }); assert.equal(await input().isDisabled(), true);
  await receipt(first, { leaderTaskId: b }); assert.equal(await input().isDisabled(), true);
  await receipt(first, { requestId: "other-request" }); assert.equal(await input().isDisabled(), true);
  await page.screenshot({ path: path.join(output, `${name}-allocation-pending.png`) });
  await confirm(first);
  assert.equal(requests().length, 2);
  assert.equal(await dialog.isVisible(), true, "stays open until all saves are confirmed");
  assert.equal(await input().inputValue(), "7");
  assert.match(await row().innerText(), /手动.*实际占用 1.*待首次派发.*新参考值已保存/u);
  const failed = requests().at(-1);
  assert.equal(failed.employeeLimit, 0); assert.equal(failed.leaderTaskId, b); assert.equal(failed.expectedRevision, 4);
  await receipt(first); assert.equal(await input(b).isDisabled(), true, "old receipt cannot settle the next group");
  await receipt(failed, { ok: false, error: "保存失败：夹具模拟持久服务不可用，请重试。" });
  assert.equal(await input(b).inputValue(), "0"); assert.equal(await input(b).isEnabled(), true);
  assert.match(await feedback(b).innerText(), /保存失败/u);
  assert.match(await dialog.locator("#departmentAllocationStatus").innerText(), /部分额度已保存/u);
  await page.screenshot({ path: path.join(output, `${name}-allocation-failure-state.png`) });
  await input(b).press("Enter"); await settle(); const retry = requests().at(-1);
  assert.equal(retry.leaderTaskId, b); assert.equal(retry.employeeLimit, 0); assert.equal(requests().length, 3);
  assert.notEqual(retry.requestId, failed.requestId);
  await receipt(failed); assert.equal(await input(b).isDisabled(), true, "old receipt cannot settle a new request");
  await confirm(retry); await dialog.waitFor({ state: "hidden" });
  assert.equal(await opener.evaluate((element) => document.activeElement === element), true);
  await opener.click();
  assert.equal(await input().inputValue(), "7"); assert.equal(await input(b).inputValue(), "0");
  snapshot().leaders[0].appliedLimit = 7; snapshot().leaders[0].pending = false; await patch();
  assert.match(await row().innerText(), /上次派发参考 7/u);
  await input().fill("12"); await input(b).fill("8"); await patch();
  assert.equal(await input().inputValue(), "12"); assert.equal(await input(b).inputValue(), "8");
  assert.equal(await input(b).evaluate((element) => document.activeElement === element), true);
  await input().press("Enter"); await settle(); const oldRootRequest = requests().at(-1);
  state.task.id = "fixture-new-root"; state.department.rootTaskId = state.task.id; snapshot().rootTaskId = state.task.id;
  await patch(); await receipt(oldRootRequest);
  assert.equal(await dialog.isVisible(), false);
  assert.equal(requests().length, 4, "switching roots aborts remaining writes");
  await opener.click();
  assert.equal(await input().inputValue(), "7", "root change clears drafts and in-flight state");
  assert.equal(await input(b).inputValue(), "0"); assert.equal(await input().isEnabled(), true);
  assert.equal(await feedback().innerText(), "");
  state.department.employeeAllocationEditable = false; await patch();
  assert.equal(await input().isDisabled(), true); assert.match(await row().innerText(), /写入服务不可用/u);
  assert.equal(await save.isDisabled(), true);
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
  const closeBox = await close.boundingBox(), saveBox = await save.boundingBox(), dialogBox = await dialog.boundingBox();
  assert.ok(closeBox.y >= dialogBox.y && closeBox.y < saveBox.y);
  assert.ok(closeBox.x + closeBox.width > dialogBox.x + dialogBox.width / 2);
  assert.ok(saveBox.x + saveBox.width > dialogBox.x + dialogBox.width / 2);
  await input().focus(); assert.equal(await input().evaluate((element) => document.activeElement === element && !element.closest("[inert]")), true);
  await page.screenshot({ path: path.join(output, `${name}-allocation.png`) });
  await close.click();
  assert.equal(await opener.evaluate((element) => document.activeElement === element), true);
  return { checks: ["toolbar dialog outside roster", "SVG close and Escape discard drafts and return focus", "one footer save and Enter", "serial writes with confirmed revision", "numeric zero without reset", "validate all drafts before writing", "pending, partial failure and retry", "late root/leader/request receipts", "contentPatch draft and focus isolation", "unavailable reader/writer", "first dispatch vs applied", "responsive geometry and accessible controls"],
    geometry, requestCount: requests().length };
}
module.exports = { allocationFixture, runAllocationScenario };
