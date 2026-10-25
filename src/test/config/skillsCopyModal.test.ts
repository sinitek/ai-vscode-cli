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
  for (const [platform, label] of [["claude", "Claude"], ["opencode", "OpenCode"], ["grok", "Grok"], ["codex", "Codex"], ["dsh", "DSH"]]) {
    let calls = 0;
    const harness = createHarness(async () => { calls++; }, platform);
    assert.equal(harness.options().length, 4);
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

function targetLabels(nodes: ElementNode[]): string[] {
  return nodes.map((node) => node.props.children[1].props.children);
}

function plain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function skillUiSlice(): string {
  return uiSource.slice(uiSource.indexOf("const CLI_GLOBAL_SKILL_TARGETS ="), uiSource.indexOf("const SkillsManagerModal ="));
}

test("DSH is appended to the shared copy targets and can receive a skill copy", async () => {
  const targets = vm.runInNewContext(`${skillUiSlice()}\nCLI_GLOBAL_SKILL_TARGETS`, {});
  assert.deepEqual(plain(targets), [
    { id: "claude", label: "Claude" },
    { id: "opencode", label: "OpenCode" },
    { id: "grok", label: "Grok" },
    { id: "codex", label: "Codex" },
    { id: "dsh", label: "DSH" },
  ]);

  const calls: string[] = [];
  const harness = createHarness(async (item, platform) => {
    assert.equal(item, skill);
    calls.push(platform);
  }, "claude");
  assert.deepEqual(targetLabels(harness.options()), ["OpenCode", "Grok", "Codex", "DSH"]);
  assert.equal(harness.option("DSH").props.type, "checkbox");
  assert.equal(harness.option("DSH").props.disabled, false);
  assert.equal(harness.option("Codex").props.disabled, false);
  harness.select("Codex");
  harness.select("DSH");
  await harness.render().props.onOk();
  assert.deepEqual(calls, ["codex", "dsh"]);
  assert.deepEqual(harness.messages, ["已复制 example-skill 到 Codex、DSH"]);
  assert.equal(JSON.stringify(calls).includes("sk-"), false);
  assert.equal(JSON.stringify(harness.messages).includes("SINITEK_DSH_API_KEY"), false);

  const fromDsh = createHarness(async () => undefined, "dsh");
  assert.deepEqual(targetLabels(fromDsh.options()), ["Claude", "OpenCode", "Grok", "Codex"]);
  assert.equal(fromDsh.options().some((node) => targetLabels([node])[0] === "DSH"), false);
});

function createMarketHarness(installResult: unknown) {
  const state: any[] = [];
  let cursor = 0;
  const effects: Array<() => void> = [];
  const installs: Array<Record<string, unknown>> = [];
  const messages: string[] = [];
  const warnings: string[] = [];
  const events: Array<{ type: string; detail?: unknown }> = [];
  const element = (type: string, props: Record<string, any>) => ({ type, props });
  const sandbox = {
    Error,
    be: { jsx: element, jsxs: element },
    xr: "modal",
    xn: "button",
    Kt: {
      success: (message: string) => messages.push(message),
      warning: (message: string) => warnings.push(message),
    },
    searchLobehubSkills: async () => ({
      currentPage: 1,
      totalPages: 1,
      totalCount: 1,
      items: [{
        identifier: "market-skill",
        name: "market-skill",
        description: "描述",
        author: "author",
        version: "1.0.0",
        installCount: 2,
      }],
    }),
    installLobehubSkill: async (payload: Record<string, unknown>) => {
      installs.push(payload);
      return installResult;
    },
    window: {
      dispatchEvent(event: { type: string; detail?: unknown }) {
        events.push(event);
      },
    },
    CustomEvent: class CustomEvent {
      type: string;
      detail?: unknown;
      constructor(type: string, init?: { detail?: unknown }) {
        this.type = type;
        this.detail = init?.detail;
      }
    },
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
      useEffect(effect: () => void) {
        if (effects.length === 0) effects.push(effect);
      },
    },
  };
  const components = vm.runInNewContext(`${skillUiSlice()}\n({ SkillsMarketModal, CLI_GLOBAL_SKILL_TARGETS })`, sandbox);
  const render = (): ElementNode => {
    cursor = 0;
    return components.SkillsMarketModal({ onClose: () => undefined });
  };
  const targetNodes = () => descendants(render()).filter((node) => node.type === "label" && node.props.className === "skills-copy-target");
  const button = (label: string) => {
    const match = descendants(render()).find((node) => node.type === "button" && node.props.children === label);
    assert.ok(match, `missing market button ${label}`);
    return match;
  };
  return {
    components,
    installs,
    messages,
    warnings,
    events,
    render,
    targetNodes,
    button,
    boot: async () => {
      render();
      effects[0]();
      await new Promise((resolve) => setImmediate(resolve));
      return render();
    },
  };
}

test("skills market install uses the shared list and can install to DSH", async () => {
  const harness = createMarketHarness({
    targets: [{ platform: "dsh", name: "market-skill", status: "installed" }],
  });
  assert.deepEqual(plain(harness.components.CLI_GLOBAL_SKILL_TARGETS.map((item: { id: string }) => item.id)), [
    "claude",
    "opencode",
    "grok",
    "codex",
    "dsh",
  ]);
  await harness.boot();
  harness.button("下载").props.onClick();
  assert.deepEqual(targetLabels(harness.targetNodes()), ["Claude", "OpenCode", "Grok", "Codex", "DSH"]);
  assert.equal(harness.button("安装").props.disabled, true);
  const dsh = harness.targetNodes().find((node) => targetLabels([node])[0] === "DSH");
  assert.ok(dsh);
  assert.equal(dsh.props.children[0].props.type, "checkbox");
  dsh.props.children[0].props.onChange({ target: { checked: true } });
  const codex = harness.targetNodes().find((node) => targetLabels([node])[0] === "Codex");
  assert.ok(codex);
  assert.equal(codex.props.children[0].props.disabled, false);
  assert.equal(harness.button("安装").props.disabled, false);
  harness.button("安装").props.onClick();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(harness.installs.length, 1);
  assert.deepEqual(plain(harness.installs[0]), { identifier: "market-skill", platforms: ["dsh"] });
  assert.deepEqual(Object.keys(harness.installs[0]).sort(), ["identifier", "platforms"]);
  assert.deepEqual(harness.messages, ["已安装 market-skill"]);
  assert.equal(harness.events[0]?.type, "sinitek-cli-skills-installed");
  assert.deepEqual(plain(harness.events[0]?.detail), { platforms: ["dsh"] });
  assert.equal(JSON.stringify(harness.installs).includes("apiKey"), false);
  assert.equal(JSON.stringify(harness.events).includes("sk-"), false);
});

test("skills market install failure keeps the DSH label from the shared target list", async () => {
  const harness = createMarketHarness({
    targets: [{ platform: "dsh", name: "market-skill", status: "failed", message: "目录不可写" }],
  });
  await harness.boot();
  harness.button("下载").props.onClick();
  const dsh = harness.targetNodes().find((node) => targetLabels([node])[0] === "DSH");
  assert.ok(dsh);
  dsh.props.children[0].props.onChange({ target: { checked: true } });
  harness.button("安装").props.onClick();
  await new Promise((resolve) => setImmediate(resolve));
  const error = descendants(harness.render()).find((node) => node.props.role === "alert" && String(node.props.children).includes("DSH"));
  assert.equal(error?.props.children, "DSH / market-skill：目录不可写");
  assert.deepEqual(harness.warnings, ["没有安装新技能"]);
  assert.deepEqual(harness.messages, []);
  assert.deepEqual(plain(harness.installs[0]?.platforms), ["dsh"]);
});
