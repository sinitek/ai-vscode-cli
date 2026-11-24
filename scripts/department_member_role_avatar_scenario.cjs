/* Bounded display-only scenario owned by department_group_chat_smoke.cjs.
 * Uses its real compiled generator, theme, fixture and opaque iframe bridge. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const leaderATaskId = "department-20261113-leader-111111";
const leaderBTaskId = "department-20261113-leader-222222";
const findLeader = (state, taskId) => state.department.leaders.find((leader) => leader.taskId === taskId);
const groupFor = (context, taskId) => context.locator(`.department-group[data-department-leader-task-id="${taskId}"]`);

function roleAvatarFixture(state, patched = false) {
  const leaderA = findLeader(state, leaderATaskId);
  const leaderB = findLeader(state, leaderBTaskId);
  state.department.director.title = patched ? "" : "星河计划：总监任务的长标题不应出现在成员栏。".repeat(12);
  leaderA.participant.title = patched ? "API契约" : "同名模块";
  leaderA.progressPercent = 25;
  leaderB.participant.title = patched ? "星河计划" : "同名模块";
  findLeader(state, "").participant.title = patched ? "同名模块" : "";
  leaderA.employees[0].title = patched ? "子任务 1：同名模块" : "子任务 1";
  leaderB.employees[0].title = patched ? "子任务 1：同名模块" : "子任务 1：API契约";
}

async function inspectDirectorGroups(context, leaderAProgress) {
  const groups = context.locator(".department-tree .department-group");
  assert.deepEqual(await groups.evaluateAll((elements) => elements.map((group) => group.dataset.departmentLeaderTaskId)),
    ["", leaderBTaskId, leaderATaskId], "director groups render C, B, A with their original task bindings");
  assert.equal(await context.locator(".department-tree .department-employees").count(), 0);
  const zeroCounts = { running: 0, repairing: 0, reviewing: 0, queue: 0, pending: 0, acceptance_failed: 0, blocked: 0, completed: 0 };
  const expected = [
    { taskId: "", label: "组长C", counts: zeroCounts },
    { taskId: leaderBTaskId, label: "组长B", counts: { ...zeroCounts, pending: 1 } },
    { taskId: leaderATaskId, label: "组长A", counts: { ...zeroCounts, running: 1, completed: 1 }, progress: leaderAProgress },
  ];
  const summaries = [];
  for (const { taskId, label, counts, progress } of expected) {
    const group = groupFor(context, taskId);
    const summary = group.getByRole("group", { name: `${label}任务状态汇总`, exact: true });
    assert.equal(await summary.count(), 1);
    const renderedCounts = await summary.locator("[data-loop-plus-count]").evaluateAll((tags) => tags.map((tag) => [
      tag.dataset.loopPlusCount, Number(tag.textContent.match(/\s(\d+)$/u)?.[1]),
    ]));
    assert.deepEqual(renderedCounts, Object.entries(counts), `${label} (${taskId || "unbound"}) status summary`);
    const open = group.getByRole("button", { name: taskId ? "打开组长群聊" : "打开组长群聊：群聊尚未创建", exact: true });
    assert.equal(await open.getAttribute("data-department-task-id"), taskId);
    assert.equal(await open.isDisabled(), !taskId);
    const renderedProgress = await group.locator(".department-leader-progress").allTextContents();
    assert.deepEqual(renderedProgress, progress === undefined ? [] : [`${progress}%`], `${label} progress`);
    summaries.push({ taskId, label, counts: Object.fromEntries(renderedCounts), progress: renderedProgress });
  }
  return summaries;
}

async function inspectRoster(context, expectedTitles, leaderTaskId) {
  const rows = await context.locator(".department-tree .member").evaluateAll((members) => members.map((member) => {
    const avatar = member.querySelector(":scope > .avatar");
    const title = member.querySelector(".member-name");
    const style = getComputedStyle(avatar), rowStyle = getComputedStyle(member);
    const rect = avatar.getBoundingClientRect(), titleRect = title.getBoundingClientRect();
    const range = document.createRange(); range.selectNodeContents(avatar);
    const glyph = range.getBoundingClientRect();
    return { avatar: avatar.textContent, title: title.textContent, tooltip: title.getAttribute("title"), width: rect.width, height: rect.height,
      fontSize: style.fontSize, radius: style.borderRadius, align: style.alignItems, justify: style.justifyContent,
      gap: rowStyle.gap, padding: rowStyle.paddingTop, leftOfTitle: rect.right <= titleRect.left,
      centerOffset: Math.abs((glyph.left + glyph.width / 2) - (rect.left + rect.width / 2)),
      background: style.backgroundColor, foreground: style.color };
  }));
  assert.deepEqual(rows.map((row) => row.avatar), leaderTaskId ? ["组", "员"] : ["总", "组", "组", "组"]);
  assert.deepEqual(rows.map((row) => row.title), expectedTitles);
  for (const row of rows) {
    assert.doesNotMatch(row.title, /[☀🌛⭐]/u);
    assert.equal(row.tooltip, row.title);
    assert.equal(row.width, 28); assert.equal(row.height, 28); assert.equal(row.fontSize, "12px");
    assert.equal(row.radius, "50%"); assert.equal(row.align, "center"); assert.equal(row.justify, "center");
    assert.equal(row.gap, "8px"); assert.equal(row.padding, "4px"); assert.equal(row.leftOfTitle, true);
    assert.ok(row.centerOffset <= 1, JSON.stringify(row));
  }
  if (leaderTaskId) {
    const groups = context.locator(".department-group");
    assert.equal(await groups.count(), 1);
    assert.equal(await groups.getAttribute("data-department-leader-task-id"), leaderTaskId);
    assert.equal(await groups.locator('[data-action="openDepartmentTask"]').count(), 0);
    assert.doesNotMatch(await context.locator(".department-tree").innerText(), /总监|其他组长/u);
  }
  const layout = await context.locator(".sidebar").evaluate((element) => ({ client: element.clientWidth, scroll: element.scrollWidth }));
  assert.ok(layout.scroll <= layout.client + 1, JSON.stringify(layout));
  return { rows, layout };
}

async function runRoleAvatarScenario({ page, panel, parentState, sent, showMembers, overflow, settle, targetReady, inject, output, name }) {
  const captureRoster = async (context, label) => {
    await context.locator(".department-tree").evaluate((element) => element.scrollIntoView({ block: "start" }));
    await settle();
    await page.screenshot({ path: path.join(output, `${name}-${label}.png`) });
  };
  assert.equal(await page.locator("#panelHeading").textContent(), "产研部群聊");
  assert.equal(await page.title(), "产研部群聊");
  await showMembers(page); await overflow(page);
  const directorInitial = await inspectRoster(page, ["总监", "组长C · ", "组长B · 同名模块", "组长A · 同名模块"]);
  directorInitial.summaries = await inspectDirectorGroups(page, 25);
  await captureRoster(page, "director-initial");
  const directorGroup = groupFor(page, leaderATaskId);
  const open = directorGroup.getByRole("button", { name: "打开组长群聊", exact: true });
  await open.click();
  const target = await targetReady();
  assert.equal(target.taskId, leaderATaskId);
  assert.equal(await page.locator("#departmentChatTitle").textContent(), "组长A");
  const { frame, state } = await inject(target);
  assert.equal(await frame.locator("#panelHeading").textContent(), "组长A");
  assert.equal(await page.locator("#departmentChatTitle").textContent(), "组长A");
  assert.equal(await page.locator("#departmentChatContent iframe").getAttribute("sandbox"), "allow-scripts");
  await showMembers(frame); await overflow(frame);
  const leaderInitial = await inspectRoster(frame, ["组长A · 同名模块", "子任务 1"], target.taskId);
  await captureRoster(frame, "leader-initial");
  await frame.evaluate(() => { window.__roleAvatarDocument = "same-document"; });
  await page.evaluate(() => { window.__roleAvatarDocument = "same-document"; });
  roleAvatarFixture(state, true);
  assert.equal(panel.setDepartmentModalState(target, structuredClone(state)), true);
  await groupFor(frame, target.taskId).getByText("组长A · API契约", { exact: true }).waitFor();
  assert.equal(await frame.evaluate(() => window.__roleAvatarDocument), "same-document", "child contentPatch must not reload iframe");
  const leaderPatched = await inspectRoster(frame, ["组长A · API契约", "子任务 1：同名模块"], target.taskId); await overflow(frame);
  assert.equal(await frame.locator("#panelHeading").textContent(), "组长A");
  fs.writeFileSync(path.join(output, `${name}-leader-patched.html`), await frame.content());
  await captureRoster(frame, "leader-patched");
  // Existing employee acceptance and return controls retain their accessible names and routes.
  const childGroup = groupFor(frame, target.taskId);
  const employee = childGroup.locator('.department-employees .member-acceptance-link');
  assert.equal(await employee.getAttribute("aria-label"), "子任务 1：同名模块：查看最近一次验收结果");
  await employee.click(); await settle();
  assert.equal(await frame.locator("#loop-plus-acceptance-0").evaluate((element) => document.activeElement === element), true);
  await showMembers(frame);
  await employee.focus();
  findLeader(state, target.taskId).participant.status = "completed";
  assert.equal(panel.setDepartmentModalState(target, structuredClone(state)), true);
  await childGroup.locator(".department-group-header").getByText("已收口", { exact: true }).waitFor();
  assert.equal(await childGroup.locator(".department-employees").isVisible(), true);
  assert.equal(await childGroup.locator('[data-action="toggleDepartmentEmployees"]').count(), 0);
  await frame.getByRole("button", { name: "返回总监群聊", exact: true }).click();
  await page.waitForFunction(() => !document.getElementById("departmentChatBackdrop").classList.contains("visible"));
  assert.equal(panel.getDepartmentModalTarget(), undefined);
  assert.equal(await open.evaluate((element) => document.activeElement === element), true);
  roleAvatarFixture(parentState, true); panel.update(structuredClone(parentState));
  await directorGroup.getByText("组长A · API契约", { exact: true }).waitFor({ state: "attached" });
  assert.equal(await page.evaluate(() => window.__roleAvatarDocument), "same-document", "parent contentPatch must not reload page");
  await showMembers(page); await overflow(page);
  const directorPatched = await inspectRoster(page, ["总监", "组长C · 同名模块", "组长B · 星河计划", "组长A · API契约"]);
  directorPatched.summaries = await inspectDirectorGroups(page, 25);
  assert.equal(await page.locator("#panelHeading").textContent(), "产研部群聊");
  assert.equal(await page.title(), "产研部群聊");
  fs.writeFileSync(path.join(output, `${name}-director-patched.html`), await page.content());
  await captureRoster(page, "director-patched");
  const directorLeader = findLeader(parentState, target.taskId);
  directorLeader.progressPercent = 35;
  panel.update(structuredClone(parentState));
  await directorGroup.getByText("35%", { exact: true }).waitFor();
  await inspectDirectorGroups(page, 35);
  directorLeader.participant.status = "completed";
  directorLeader.progressPercent = 100;
  directorLeader.employees[0].title = "子任务 1：完成后仍隐藏";
  panel.update(structuredClone(parentState));
  await directorGroup.getByText("100%", { exact: true }).waitFor();
  await inspectDirectorGroups(page, 100);
  assert.equal(await directorGroup.getByText("子任务 1：完成后仍隐藏", { exact: true }).count(), 0);
  await captureRoster(page, "director-completed-summary");
  directorLeader.participant.status = "running";
  directorLeader.progressPercent = 40;
  panel.update(structuredClone(parentState));
  await directorGroup.getByText("40%", { exact: true }).waitFor();
  await inspectDirectorGroups(page, 40);
  await groupFor(page, leaderBTaskId).getByRole("button", { name: "打开组长群聊", exact: true }).click();
  const secondTarget = await targetReady();
  assert.equal(secondTarget.taskId, leaderBTaskId);
  assert.equal(await page.locator("#departmentChatTitle").textContent(), "组长B");
  const { frame: secondFrame } = await inject(secondTarget);
  assert.equal(await secondFrame.locator("#panelHeading").textContent(), "组长B");
  assert.equal(await page.locator("#departmentChatTitle").textContent(), "组长B");
  await showMembers(secondFrame); await overflow(secondFrame);
  const secondLeaderInitial = await inspectRoster(secondFrame, ["组长B · 同名模块", "子任务 1：API契约"], secondTarget.taskId);
  await page.locator("#departmentChatClose").click();
  assert.equal(sent.filter((message) => message.type === "loopGroupChatChat:updateDepartmentEmployeeLimit").length, 0);
  return { checks: ["text-only role labels and tooltips on initial HTML and patch", "director first and groups C/B/A with stable task bindings", "director hides employees and shows eight exact status counts per group", "unbound group navigation disabled and progress updates scoped to bound leader", "leader A/B only see their own group and ordinary subtask titles", "director and opaque leader iframe initial HTML", "same-document real contentPatch on both surfaces", "28px circle, 12px centered glyph, 8px gap, 4px padding", "narrow root/sidebar/iframe overflow", "leader navigation, employee acceptance and return focus", "leader employee list stays visible without disclosure controls"],
    target, directorInitial, leaderInitial, directorPatched, leaderPatched, secondLeaderInitial };
}
module.exports = { roleAvatarFixture, runRoleAvatarScenario };
