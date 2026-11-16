/* Bounded display-only scenario owned by department_group_chat_smoke.cjs.
 * Uses its real compiled generator, theme, fixture and opaque iframe bridge. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function roleAvatarFixture(state, patched = false) {
  const department = state.department;
  department.director.title = patched ? "" : "星河计划";
  department.leaders[0].participant.title = patched ? "API契约" : "同名模块";
  department.leaders[1].participant.title = patched ? "星河计划" : "同名模块";
  department.leaders[2].participant.title = patched ? "同名模块" : "";
  department.leaders[0].employees[0].title = patched ? "同名模块" : "";
  department.leaders[1].employees[0].title = patched ? "同名模块" : "API契约";
}

async function inspectRoster(context) {
  const rows = await context.locator(".department-tree .member").evaluateAll((members) => members.map((member) => {
    const avatar = member.querySelector(":scope > .avatar");
    const title = member.querySelector(".member-name");
    const style = getComputedStyle(avatar), rowStyle = getComputedStyle(member);
    const rect = avatar.getBoundingClientRect(), titleRect = title.getBoundingClientRect();
    const range = document.createRange(); range.selectNodeContents(avatar);
    const glyph = range.getBoundingClientRect();
    return { avatar: avatar.textContent, title: title.textContent, width: rect.width, height: rect.height,
      fontSize: style.fontSize, radius: style.borderRadius, align: style.alignItems, justify: style.justifyContent,
      gap: rowStyle.gap, padding: rowStyle.paddingTop, leftOfTitle: rect.right <= titleRect.left,
      centerOffset: Math.abs((glyph.left + glyph.width / 2) - (rect.left + rect.width / 2)),
      background: style.backgroundColor, foreground: style.color };
  }));
  assert.deepEqual(rows.map((row) => row.avatar), ["总", "组", "员", "组", "员", "组"]);
  assert.deepEqual(rows.map((row) => row.title.split(" ")[0]), ["☀️", "🌛", "⭐️", "🌛", "⭐️", "🌛"]);
  for (const row of rows) {
    assert.equal(row.width, 28); assert.equal(row.height, 28); assert.equal(row.fontSize, "12px");
    assert.equal(row.radius, "50%"); assert.equal(row.align, "center"); assert.equal(row.justify, "center");
    assert.equal(row.gap, "8px"); assert.equal(row.padding, "4px"); assert.equal(row.leftOfTitle, true);
    assert.ok(row.centerOffset <= 1, JSON.stringify(row));
  }
  const pending = context.locator('.department-group[data-department-leader-task-id=""]');
  assert.equal(await pending.locator(':scope > .member > .avatar').textContent(), "组");
  assert.equal(await pending.getByRole("button", { name: "打开组长群聊：群聊尚未创建", exact: true }).isDisabled(), true);
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
  assert.equal(await page.locator("#panelHeading").textContent(), "产研部 · 总监 ☀️");
  assert.ok((await page.title()).startsWith("☀️ 产研部 · 总监"));
  await showMembers(page); await overflow(page);
  const directorInitial = await inspectRoster(page);
  assert.match(directorInitial.rows[0].title, /总监 · 星河计划/u);
  assert.match(directorInitial.rows[2].title, /员工 · $/u);
  await captureRoster(page, "director-initial");
  const open = page.locator('.department-group').first().getByRole("button", { name: "打开组长群聊", exact: true });
  await open.click();
  const target = await targetReady();
  assert.ok((await page.locator("#departmentChatTitle").textContent()).startsWith("🌛 产研部 · 组长"));
  const { frame, state } = await inject(target);
  assert.ok((await frame.locator("#panelHeading").textContent()).startsWith("产研部 · 组长 🌛"));
  assert.ok((await page.locator("#departmentChatTitle").textContent()).startsWith("🌛 产研部 · 组长"));
  assert.equal(await page.locator("#departmentChatContent iframe").getAttribute("sandbox"), "allow-scripts");
  await showMembers(frame); await overflow(frame);
  const leaderInitial = await inspectRoster(frame);
  await captureRoster(frame, "leader-initial");
  await frame.evaluate(() => { window.__roleAvatarDocument = "same-document"; });
  await page.evaluate(() => { window.__roleAvatarDocument = "same-document"; });
  roleAvatarFixture(state, true);
  assert.equal(panel.setDepartmentModalState(target, structuredClone(state)), true);
  await frame.waitForFunction(() => document.querySelector(".department-group .member-name").textContent.includes("API契约"));
  assert.equal(await frame.evaluate(() => window.__roleAvatarDocument), "same-document", "child contentPatch must not reload iframe");
  const leaderPatched = await inspectRoster(frame); await overflow(frame);
  assert.ok((await frame.locator("#panelHeading").textContent()).startsWith("产研部 · 组长 🌛"));
  fs.writeFileSync(path.join(output, `${name}-leader-patched.html`), await frame.content());
  await captureRoster(frame, "leader-patched");
  // Existing employee acceptance and return controls retain their accessible names and routes.
  const employee = frame.locator('.department-employees .member-acceptance-link').first();
  assert.match(await employee.getAttribute("aria-label"), /员工 · 同名模块：查看最近一次验收结果/u);
  await employee.click(); await settle();
  assert.equal(await frame.locator("#loop-plus-acceptance-0").evaluate((element) => document.activeElement === element), true);
  await showMembers(frame);
  await frame.getByRole("button", { name: "返回总监群聊", exact: true }).click();
  await page.waitForFunction(() => !document.getElementById("departmentChatBackdrop").classList.contains("visible"));
  assert.equal(panel.getDepartmentModalTarget(), undefined);
  assert.equal(await open.evaluate((element) => document.activeElement === element), true);
  roleAvatarFixture(parentState, true); panel.update(structuredClone(parentState));
  await page.waitForFunction(() => document.querySelector(".department-group .member-name").textContent.includes("API契约"));
  assert.equal(await page.evaluate(() => window.__roleAvatarDocument), "same-document", "parent contentPatch must not reload page");
  await showMembers(page); await overflow(page);
  const directorPatched = await inspectRoster(page);
  assert.equal(await page.locator("#panelHeading").textContent(), "产研部 · 总监 ☀️");
  assert.ok((await page.title()).startsWith("☀️ 产研部 · 总监"));
  fs.writeFileSync(path.join(output, `${name}-director-patched.html`), await page.content());
  await captureRoster(page, "director-patched");
  assert.equal(sent.filter((message) => message.type === "loopGroupChatChat:updateDepartmentEmployeeLimit").length, 0);
  return { checks: ["sun/moon/star role labels and group dialog/heading on initial HTML and patch", "explicit hierarchy roles independent of main/subtask and empty/duplicate/arbitrary titles", "director and opaque leader iframe initial HTML", "same-document real contentPatch on both surfaces", "28px circle, 12px centered glyph, 8px gap, 4px padding", "narrow root/sidebar/iframe overflow", "leader navigation, employee acceptance and return focus"],
    target, directorInitial, leaderInitial, directorPatched, leaderPatched };
}
module.exports = { roleAvatarFixture, runRoleAvatarScenario };
