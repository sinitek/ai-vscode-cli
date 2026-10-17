import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "node:test";
import * as vm from "node:vm";

type ElementNode = { type: string; props: Record<string, any> };

const uiSource = fs.readFileSync(path.join(process.cwd(), "media/config/assets/config-app-ui.js"), "utf8");
const skill = { name: "example-skill", path: "/skills/example-skill" };

function descendants(node: ElementNode): ElementNode[] {
  const children = [node.props.children].flat().filter((child) => child && typeof child === "object");
  return [node, ...children.flatMap(descendants)];
}

function createHarness(onCopy: (item: typeof skill, platform: string) => Promise<void>, platform = "claude") {
  const state: any[] = [];
  let cursor = 0;
  let closeCount = 0;
  const messages: string[] = [];
  const element = (type: string, props: Record<string, any>) => ({ type, props });
  const sandbox = {
    Error,
    be: { jsx: element, jsxs: element },
    xr: "modal",
    xn: "button",
    Kt: { success: (message: string) => messages.push(message) },
    c: {
      useState(initial: unknown) {
        const index = cursor++;
        if (!(index in state)) state[index] = initial;
        return [state[index], (value: any) => {
          state[index] = typeof value === "function" ? value(state[index]) : value;
        }];
      },
      useRef(initial: unknown) {
        const index = cursor++;
        if (!(index in state)) state[index] = { current: initial };
        return state[index];
      },
    },
  };
  const source = uiSource.slice(uiSource.indexOf("const CLI_GLOBAL_SKILL_TARGETS ="), uiSource.indexOf("const SkillsManagerModal ="));
  const components = vm.runInNewContext(`${source}\n({ SkillsCopyModal, renderSkillRows })`, sandbox);
  const render = (): ElementNode => {
    cursor = 0;
    return components.SkillsCopyModal({ skill, platform, onCopy, onClose: () => closeCount++ });
  };
  const options = () => descendants(render()).filter((node) => node.type === "label");
  const option = (label: string) => {
    const target = options().find((node) => node.props.children[1].props.children === label);
    assert.ok(target, `missing CLI option ${label}`);
    return target.props.children[0] as ElementNode;
  };
  return {
    render,
    options,
    option,
    components,
    messages,
    select: (label: string, checked = true) => option(label).props.onChange({ target: { checked } }),
    get closeCount() { return closeCount; },
  };
}

test("skill row actions stay on one line and copying opens a dialog instead of a select", () => {
  const harness = createHarness(async () => undefined);
  const copied: unknown[] = [];
  const deleted: unknown[] = [];
  const row = harness.components.renderSkillRows([skill], "", (item: unknown) => copied.push(item), (item: unknown) => deleted.push(item));
  const nodes = descendants(row);
  assert.equal(nodes.filter((node) => node.type === "select").length, 0);
  const actions = nodes.find((node) => node.props.className === "skills-manager-row-actions");
  assert.ok(actions);
  const [copyButton, deleteButton] = actions.props.children;
  assert.equal(copyButton.props.children, "复制到");
  copyButton.props.onClick();
  deleteButton.props.onClick();
  assert.deepEqual(copied, [skill]);
  assert.deepEqual(deleted, [skill]);
  const pendingRow = harness.components.renderSkillRows([skill], skill.name, () => undefined, () => undefined);
  assert.ok(descendants(pendingRow).filter((node) => node.type === "button").every((node) => node.props.disabled));

  const assetsDirectory = path.join(process.cwd(), "media/config/assets");
  const cssFile = fs.readdirSync(assetsDirectory).find((file) => /^index-.*\.css$/.test(file));
  assert.ok(cssFile);
  const css = fs.readFileSync(path.join(assetsDirectory, cssFile), "utf8");
  assert.match(css, /\.skills-manager-table-actions \{[^}]*width: 160px;/);
  assert.match(css, /\.skills-manager-row-actions \{[^}]*flex-wrap: nowrap;/);
  assert.match(css, /\.skills-manager-row-actions \.ant-btn \{[^}]*flex-shrink: 0;[^}]*white-space: nowrap;/);
});

test("copy dialog excludes its source CLI and empty selection cannot submit", async () => {
  for (const [platform, label] of [["claude", "Claude"], ["opencode", "OpenCode"], ["grok", "Grok"], ["codex", "Codex"]]) {
    let calls = 0;
    const harness = createHarness(async () => { calls++; }, platform);
    assert.equal(harness.options().length, 3);
    assert.ok(harness.options().every((node) => node.props.children[1].props.children !== label));
    assert.equal(harness.render().props.okButtonProps.disabled, true);
    await harness.render().props.onOk();
    harness.render().props.onCancel();
    assert.equal(calls, 0);
    assert.equal(harness.closeCount, 1);
  }
});

test("multiple selected CLI targets receive copies while unchecked targets do not", async () => {
  const calls: string[] = [];
  const harness = createHarness(async (item, platform) => {
    assert.equal(item, skill);
    calls.push(platform);
  });
  harness.select("OpenCode");
  harness.select("Grok");
  harness.select("Codex");
  harness.select("Grok", false);
  assert.equal(harness.render().props.okButtonProps.disabled, false);
  await harness.render().props.onOk();
  assert.deepEqual(calls, ["opencode", "codex"]);
  assert.equal(harness.closeCount, 1);
  assert.deepEqual(harness.messages, ["已复制 example-skill 到 OpenCode、Codex"]);
});

test("partial failures retain failed selections and retry never recopies successful targets", async () => {
  const calls: string[] = [];
  let failGrok = true;
  const harness = createHarness(async (_item, platform) => {
    calls.push(platform);
    if (platform === "grok" && failGrok) throw new Error("同名技能已存在");
  });
  harness.select("OpenCode");
  harness.select("Grok");
  harness.select("Codex");
  await harness.render().props.onOk();
  assert.equal(harness.closeCount, 0);
  assert.equal(harness.option("OpenCode").props.disabled, true);
  assert.equal(harness.option("Codex").props.disabled, true);
  assert.equal(harness.option("Grok").props.disabled, false);
  assert.equal(harness.option("Grok").props.checked, true);
  const error = descendants(harness.render()).find((node) => node.props.role === "alert");
  assert.equal(error?.props.children, "Grok：同名技能已存在");
  assert.deepEqual(harness.messages, ["已复制 example-skill 到 OpenCode、Codex"]);
  failGrok = false;
  await harness.render().props.onOk();
  assert.deepEqual(calls, ["opencode", "grok", "codex", "grok"]);
  assert.equal(harness.closeCount, 1);
});

test("failed copies stay visible without reporting success", async () => {
  const harness = createHarness(async () => { throw new Error("目标目录不可写"); });
  harness.select("Codex");
  await harness.render().props.onOk();
  assert.equal(harness.closeCount, 0);
  assert.equal(harness.option("Codex").props.checked, true);
  assert.deepEqual(harness.messages, []);
  assert.equal(harness.render().props.confirmLoading, false);
  assert.equal(harness.render().props.okText, "重试复制");
});

test("copy in progress blocks cancellation and duplicate submissions", async () => {
  let finishCopy!: () => void;
  let calls = 0;
  const harness = createHarness(async () => {
    calls++;
    await new Promise<void>((resolve) => { finishCopy = resolve; });
  });
  harness.select("Codex");
  const modal = harness.render();
  const pending = modal.props.onOk();
  await modal.props.onOk();
  modal.props.onCancel();
  const busyModal = harness.render();
  assert.equal(calls, 1);
  assert.equal(harness.closeCount, 0);
  assert.equal(busyModal.props.confirmLoading, true);
  assert.equal(busyModal.props.cancelButtonProps.disabled, true);
  assert.equal(busyModal.props.okButtonProps.disabled, true);
  assert.equal(busyModal.props.closable, false);
  assert.equal(busyModal.props.maskClosable, false);
  assert.equal(busyModal.props.keyboard, false);
  assert.ok(harness.options().every((node) => node.props.children[0].props.disabled));
  finishCopy();
  await pending;
  assert.equal(harness.closeCount, 1);
});

test("copy handler propagates host errors and never refreshes a different source", async () => {
  const handlerSource = uiSource.slice(uiSource.indexOf("const copyCliSkillTo ="), uiSource.indexOf("const confirmDeleteCliSkill ="));
  let fail = true;
  let refreshCount = 0;
  const pending: string[] = [];
  const sandbox = {
    O: { platform: "claude", id: "source" },
    skillsLoadTargetRef: { current: "claude:source" },
    setPendingSkillName: (name: string) => pending.push(name),
    copyCliSkill: async () => {
      if (fail) throw new Error("host error");
      return { skills: [] };
    },
    applyCliSkillsResult: () => refreshCount++,
  };
  const copy = vm.runInNewContext(`${handlerSource}\ncopyCliSkillTo`, sandbox);
  await assert.rejects(copy(skill, "codex"), /host error/);
  assert.deepEqual(pending, [skill.name, ""]);
  fail = false;
  await copy(skill, "codex");
  assert.equal(refreshCount, 1);
  sandbox.skillsLoadTargetRef.current = "grok:another";
  await copy(skill, "codex");
  assert.equal(refreshCount, 1);
});
