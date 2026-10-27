import assert = require("node:assert/strict");
import * as fs from "node:fs";
import * as path from "node:path";
import test = require("node:test");
import * as vm from "node:vm";

const uiPath = path.join(process.cwd(), "media", "config", "assets", "config-app-ui.js");
const storePath = path.join(process.cwd(), "media", "config", "assets", "config-app-store.js");
const apiPath = path.join(process.cwd(), "media", "config", "assets", "config-app-api.js");

function read(filePath: string): string {
  return fs.readFileSync(filePath, "utf8");
}

type EditorNode = { type: unknown; props: Record<string, any> };

function editorNodes(value: unknown): EditorNode[] {
  if (Array.isArray(value)) return value.flatMap(editorNodes);
  if (!value || typeof value !== "object" || !("props" in value)) return [];
  const node = value as EditorNode;
  return [node, ...editorNodes(node.props.children)];
}

function loadKimiVisualUtils(sandbox: Record<string, unknown> = {}) {
  const source = read(uiPath);
  const parserStart = source.indexOf("function fk(");
  const parserEnd = source.indexOf("const CLI_GLOBAL_SKILL_TARGETS =");
  const kimiStart = source.indexOf("const KIMI_CODE_VISUAL_FIELD_IDS");
  const kimiEnd = source.indexOf("const ps = {");
  assert.ok(parserStart >= 0 && parserEnd > parserStart, "找不到 TOML 解析器");
  assert.ok(kimiStart > parserEnd && kimiEnd > kimiStart, "找不到 Kimi Code 可视化工具块");
  vm.runInNewContext(
    `${source.slice(parserStart, parserEnd)}\n${source.slice(kimiStart, kimiEnd)}\nglobalThis.__kimi = KimiCodeConfigVisualEditorUtils;`,
    sandbox,
  );
  return (sandbox as { __kimi: any }).__kimi;
}

test("配置中心完整脚本可编译，保存分支的局部声明不能阻断页面加载", () => {
  assert.doesNotThrow(() => new vm.Script(read(uiPath), { filename: uiPath }));
});

test("配置中心把 kimi-code 注册为一个完整平台（平台列表、标签、命令、Skills 目标）", () => {
  const api = read(apiPath);
  assert.match(api, /const CONFIG_MANAGER_PLATFORMS = \[[^\]]*"kimi-code"\]/);

  const store = read(storePath);
  assert.match(store, /\[[^\]]*"kimi-code"\]/, "配置排序/回落列表要包含 kimi-code");
  assert.match(store, /"kimi-code": "kimi"/, "平台同步使用 kimi 标签");

  const ui = read(uiPath);
  assert.match(ui, /DEFAULT_RUN_COMMANDS[\s\S]{0,400}?"kimi-code": "kimi"/, "启动命令不能带 --auto（与 -p 互斥）");
  assert.match(ui, /DEFAULT_INSTALL_COMMANDS[\s\S]{0,600}?"kimi-code": "npm install -g @moonshot-ai\/kimi-code@latest"/);
  assert.match(ui, /platform === "kimi-code"[\s\S]{0,40}?"kimi"/);
  assert.match(ui, /\{ id: "kimi-code", label: "kimi" \}/, "Skills 目标显示 kimi");
  assert.match(ui, /kimiCodeConfigs = c\.useMemo/, "侧边栏要有 Kimi Code 配置分组");
  assert.match(ui, /isConfigPlatformEnabled\("kimi-code", cliEnabledByName\)/);
  assert.match(ui, /"kimi-code-config": \{ title: "kimi config\.toml"/, "查看范例要能打开 kimi-code");
});

test("安装命令与官方文档一致，且不把 -p 与 --auto/--yolo 混用", () => {
  const ui = read(uiPath);
  const runCommands = ui.slice(
    ui.indexOf("const DEFAULT_RUN_COMMANDS"),
    ui.indexOf("const DEFAULT_INSTALL_COMMANDS"),
  );
  assert.match(runCommands, /"kimi-code": "kimi"/);
  assert.doesNotMatch(runCommands, /"kimi-code": "kimi --auto"/);
  assert.doesNotMatch(runCommands, /"kimi-code": "kimi --yolo"/);

  const installCommands = ui.slice(
    ui.indexOf("const DEFAULT_INSTALL_COMMANDS"),
    ui.indexOf("const configPlatformLabel"),
  );
  assert.match(installCommands, /npm install -g @moonshot-ai\/kimi-code@latest/);
  // 与宿主诊断修复路径使用同一条安装命令
  const installer = fs.readFileSync(path.join(process.cwd(), "src", "cli", "installer.ts"), "utf8");
  assert.match(installer, /"kimi-code": "npm install -g @moonshot-ai\/kimi-code@latest"/);
});

test("Kimi Code 默认使用 TOML 源码模式，一键导入会写入当前草稿", () => {
  const ui = read(uiPath);
  assert.match(ui, /\[kimiCodeEditorMode, setKimiCodeEditorMode\] = c\.useState\("toml"\)/);
  assert.doesNotMatch(ui, /setKimiCodeEditorMode\("visual"\)/);
  assert.match(
    ui,
    /case "kimi-code-config":\s*if \(!syncKimiCodeVisualContent\(I\.content, "toml", !0\)\) return;/,
    "范例必须进入 Kimi TOML 草稿，导入失败不能继续提示成功",
  );
});

test("Kimi Code 可视化编辑器可以解析、往返序列化并保留未展示字段", () => {
  const kimi = loadKimiVisualUtils();
  const example = kimi.createExampleText() as string;
  assert.match(example, /default_permission_mode = "auto"/);
  assert.match(example, /api_key = "<your-kimi-api-key>"/);
  assert.doesNotMatch(example, /subcoco\//);
  assert.match(example, /capabilities = \[\s*"thinking"\s*\]/);
  assert.match(example, /support_efforts = \[[\s\S]*?"low"[\s\S]*?"max"[\s\S]*?\]/);
  assert.doesNotMatch(example, /loop_control|display_name|default_effort|\[thinking\]/);

  const parsed = kimi.parseContent(example);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.state.fieldError, "");
  assert.equal(parsed.state.selectedModelId, "kimi-k3.1-pro");
  assert.equal(parsed.state.defaultPermissionMode, "auto");
  assert.equal(parsed.state.thinkingEffort, "");
  assert.equal(parsed.state.baseUrl, "http://127.0.0.1:33391/v1");
  assert.equal(parsed.state.providerType, "openai");
  assert.equal(parsed.state.apiKey, "<your-kimi-api-key>");
  assert.equal(parsed.state.capabilities, "thinking");
  assert.equal(parsed.state.supportEfforts, "low, medium, high, xhigh, max");

  const serialized = kimi.serializeState(parsed.state);
  assert.equal(serialized.ok, true);
  const reparsed = kimi.parseContent(serialized.content);
  assert.equal(reparsed.state.fieldError, "");

  const withoutDeclarations = serialized.content
    .replace(/capabilities = \[[^\]]*\]\s*/, "")
    .replace(/support_efforts = \[[^\]]*\]\s*/, "");
  const completed = kimi.completeText(withoutDeclarations);
  assert.equal(completed.ok, true);
  const completedState = kimi.parseContent(completed.content).state;
  assert.equal(completedState.capabilities, "thinking");
  assert.equal(completedState.supportEfforts, "low, medium, high, xhigh, max");
  assert.deepEqual(kimi.completeText(completed.content), completed, "重复保存必须幂等");

  // 官方 schema：[[permission.rules]] 需要 decision + pattern
  const kept = kimi.parseContent(`${serialized.content}
[[permission.rules]]
decision = "allow"
pattern = "Read(*)"
`);
  assert.equal(kept.ok, true);
  const keptSerialized = kimi.serializeState(kept.state);
  assert.match(keptSerialized.content, /\[\[permission\.rules\]\]/, "未展示的数组表要保留");
});

test("Kimi Code 可视化编辑器拒绝非法取值并给出中文提示", () => {
  const kimi = loadKimiVisualUtils();
  const state = kimi.createState(kimi.createExampleText());

  const badMode = kimi.updateState(state, { defaultPermissionMode: "never" });
  assert.match(badMode.fieldError, /default_permission_mode 无效/);
  assert.equal(kimi.serializeState(badMode).ok, false);

  const withThinking = kimi.updateState(state, { thinkingEffort: "high", reservedContextSize: "16384", capabilities: "thinking, tool_use", supportEfforts: "high" });
  const badEffort = kimi.updateState(withThinking, { thinkingEffort: "off" });
  assert.match(badEffort.fieldError, /thinking\.effort 无效/);

  const badReserved = kimi.updateState(withThinking, { reservedContextSize: "abc" });
  assert.match(badReserved.fieldError, /reserved_context_size 必须是非负整数/);

  const badCapability = kimi.updateState(withThinking, { capabilities: "thinking, telepathy" });
  assert.match(badCapability.fieldError, /capabilities 含未知能力/);
  assert.equal(kimi.serializeState(badCapability).ok, false);

  const badToml = kimi.parseContent("[models\n");
  assert.equal(badToml.ok, false);

  const empty = kimi.parseContent("   ");
  assert.equal(empty.ok, false);
  assert.match(empty.error, /空文本/);
});

test("Kimi Code 可视化编辑器修改 provider 字段会真正写回 TOML", () => {
  const kimi = loadKimiVisualUtils();
  const state = kimi.createState(kimi.createExampleText());

  const baseUrl = kimi.updateState(state, { baseUrl: "http://127.0.0.1:9999/v1" });
  assert.equal(baseUrl.baseUrl, "http://127.0.0.1:9999/v1");
  assert.match(kimi.serializeState(baseUrl).content, /base_url = "http:\/\/127\.0\.0\.1:9999\/v1"/);

  const providerType = kimi.updateState(state, { providerType: "openai_responses" });
  assert.match(kimi.serializeState(providerType).content, /type = "openai_responses"/);

  // 写明文密钥后必须移除环境变量名，避免两份互相矛盾的凭据来源
  const withKey = kimi.updateState(state, { apiKey: "sk-visual" });
  const withKeyText = kimi.serializeState(withKey).content;
  assert.match(withKeyText, /api_key = "sk-visual"/);
  assert.doesNotMatch(withKeyText, /api_key_env/);
  assert.equal(withKey.apiKey, "sk-visual");
  assert.equal(withKey.apiKeyEnv, "");

  // 清空明文密钥后不留下空 api_key
  const cleared = kimi.updateState(withKey, { apiKey: "" });
  assert.doesNotMatch(kimi.serializeState(cleared).content, /api_key =/);

  // 明文密钥与环境变量名互斥：后写的那个生效，另一个必须被删除
  const envWins = kimi.updateState(withKey, { apiKeyEnv: "MY_KIMI_KEY" });
  const envWinsText = kimi.serializeState(envWins).content;
  assert.match(envWinsText, /api_key_env = "MY_KIMI_KEY"/);
  assert.doesNotMatch(envWinsText, /api_key = "sk-visual"/);
  const keyWins = kimi.updateState(envWins, { apiKey: "sk-second" });
  const keyWinsText = kimi.serializeState(keyWins).content;
  assert.match(keyWinsText, /api_key = "sk-second"/);
  assert.doesNotMatch(keyWinsText, /api_key_env/);

  const advanced = kimi.updateState(state, {
    displayName: "高级模型",
    capabilities: "thinking, tool_use",
    supportEfforts: "high",
    thinkingEffort: "high",
    reservedContextSize: "16384",
  });
  // 精简表单不再展示高级字段，但保存仍必须保留已有配置
  const preserve = kimi.updateState(advanced, { maxContextSize: "262144" });
  const preserveText = kimi.serializeState(preserve).content;
  assert.match(preserveText, /capabilities = /, "保存时不得删除能力声明");
  assert.match(preserveText, /support_efforts = /, "保存时不得删除档位声明");
  const preserveRoundTrip = kimi.parseContent(preserveText);
  assert.equal(preserveRoundTrip.state.capabilities, "thinking, tool_use");

  // 留空不清空：避免误删后 ACP 不再公布 thinking
  const blanked = kimi.updateState(advanced, { capabilities: "", supportEfforts: "" });
  const blankedText = kimi.serializeState(blanked).content;
  assert.match(blankedText, /capabilities = /);
  assert.match(blankedText, /support_efforts = /);

  // 只改模型字段时 provider 必须原样保留
  const modelOnly = kimi.updateState(state, { displayName: "改名", maxContextSize: "8000" });
  const modelOnlyText = kimi.serializeState(modelOnly).content;
  assert.match(modelOnlyText, /display_name = "改名"/);
  assert.match(modelOnlyText, /max_context_size = 8000/);
  assert.match(modelOnlyText, /api_key = "<your-kimi-api-key>"/);
});

test("Kimi Code 可视化编辑器新增/删除模型时保持别名与真实模型 ID 分离", () => {
  const kimi = loadKimiVisualUtils();
  const state = kimi.createState(kimi.createExampleText());

  const withCapabilities = kimi.updateState(state, { capabilities: "thinking, tool_use", supportEfforts: "high" });
  const added = kimi.addModel(withCapabilities, "kimi-k3.1-max");
  assert.equal(added.ok, true);
  assert.equal(added.state.selectedModelId, "kimi-k3.1-max");
  assert.equal(added.state.wireModel, "kimi-k3.1-max");
  assert.equal(added.state.providerId, "subcoco", "新模型复制当前模型的 provider");

  const duplicate = kimi.addModel(added.state, "kimi-k3.1-max");
  assert.equal(duplicate.ok, false);
  assert.equal(duplicate.error, "duplicate-id");

  const addedText = kimi.serializeState(added.state).content;
  assert.match(addedText, /capabilities = \[\s*"thinking",\s*"tool_use"\s*\]/, "新增模型继承能力声明");
  assert.match(addedText, /support_efforts = \[\s*"high"\s*\]/);
  const addedRoundTrip = kimi.parseContent(addedText);
  assert.equal(addedRoundTrip.state.capabilities, "thinking, tool_use");

  const removedDefault = kimi.deleteModel(state, "kimi-k3.1-pro");
  assert.equal(removedDefault.defaultModel, "");
  assert.equal(removedDefault.selectedModelId, "");

  const keepOne = kimi.deleteModel(added.state, "kimi-k3.1-pro");
  assert.equal(keepOne.defaultModel, "kimi-k3.1-max");
  assert.equal(keepOne.selectedModelId, "kimi-k3.1-max");
});

test("Kimi Code 可视化渲染函数暴露稳定字段与删除确认", () => {
  const source = read(uiPath);
  const start = source.indexOf("renderKimiCodeVisualEditor =");
  const end = source.indexOf("renderCodexVisualEditor =", start);
  assert.ok(start >= 0 && end > start, "找不到 renderKimiCodeVisualEditor");

  const confirmations: Record<string, any>[] = [];
  const jsx = (type: unknown, props: Record<string, any>): EditorNode => ({ type, props });
  const sandbox: Record<string, any> = {
    be: { jsx, jsxs: jsx },
    xn: "Button",
    AH: "DeleteIcon",
    xr: { confirm: (options: Record<string, any>) => confirmations.push(options) },
    renderCodexField: (label: string, value: string, onChange: unknown, placeholder: string, options: Record<string, unknown> = {}) =>
      jsx("Field", { label, value, onChange, placeholder, ...options }),
    renderCodexSelect: (label: string, value: string, onChange: unknown, options: unknown[]) =>
      jsx("Select", { label, value, onChange, options }),
    renderCodexSection: (title: string, description: string, children: unknown) =>
      jsx("Section", { title, description, children }),
    kimiCodeVisualError: "",
    kimiCodeAddModelOpen: false,
    kimiCodeNewModelAlias: "",
    kimiCodeModelActionError: "",
    kimiCodeNewModelInputRef: { current: { focus: () => { sandbox.focusCount += 1; } } },
    focusCount: 0,
    setKimiCodeAddModelOpen: (value: boolean) => { sandbox.kimiCodeAddModelOpen = value; },
    setKimiCodeNewModelAlias: (value: string) => { sandbox.kimiCodeNewModelAlias = value; },
    setKimiCodeModelActionError: (value: string) => { sandbox.kimiCodeModelActionError = value; },
    setKimiCodeVisualState: (value: unknown) => {
      sandbox.kimiCodeVisualState = typeof value === "function" ? value(sandbox.kimiCodeVisualState) : value;
    },
  };
  const kimi = loadKimiVisualUtils(sandbox);
  sandbox.kimiCodeVisualState = kimi.createState(kimi.createExampleText());
  vm.runInContext(
    `const ${source.slice(start, end).replace(/,\s*$/, ";")}\nglobalThis.__render = renderKimiCodeVisualEditor;`,
    sandbox,
  );
  const render = () => sandbox.__render() as EditorNode;
  const find = (property: string, value: unknown) => {
    const node = editorNodes(render()).find((candidate) => candidate.props[property] === value);
    assert.ok(node, `Missing ${property}=${value}`);
    return node;
  };

  const root = render();
  const fieldIds = String(root.props["data-kimi-code-fields"] ?? "");
  for (const id of [
    "default_model",
    "default_permission_mode",
    "model.model",
    "model.max_context_size",
    "provider.api_key",
    "provider.base_url",
  ]) {
    assert.match(fieldIds, new RegExp(id.replace(".", "\\.")), `缺少字段 ${id}`);
  }
  for (const id of ["thinking.effort", "loop_control.reserved_context_size", "model.display_name", "model.default_effort", "model.capabilities", "model.support_efforts"]) {
    assert.doesNotMatch(fieldIds, new RegExp(id.replace(".", "\\.")), `不应展示高级字段 ${id}`);
  }
  const labels = editorNodes(root).map((node) => node.props.label).filter(Boolean);
  for (const label of ["思考档位", "压缩预留上下文", "显示名称", "默认思考档", "能力声明", "可用思考档位"]) {
    assert.equal(labels.includes(label), false, `不应渲染 ${label}`);
  }

  const addButton = find("data-testid", "kimi-code-add-model");
  assert.equal(addButton.props.disabled, false);
  addButton.props.onClick();
  assert.equal(sandbox.kimiCodeAddModelOpen, true);
  const dialog = find("rootClassName", "grok-add-model-modal");
  dialog.props.afterOpenChange(true);
  assert.equal(sandbox.focusCount, 1);

  find("data-kimi-code-delete-model-id", "kimi-k3.1-pro").props.onClick({
    stopPropagation: () => undefined,
  });
  assert.equal(confirmations.length, 1);
  assert.match(String(confirmations[0].content), /kimi-k3\.1-pro/);
  confirmations[0].onOk();
  assert.equal(sandbox.kimiCodeVisualState.selectedModelId, "");

  const fallback = render();
  assert.ok(editorNodes(fallback).length > 0);
});
