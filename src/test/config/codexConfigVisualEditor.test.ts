import assert = require("node:assert/strict");
import * as fs from "node:fs";
import * as path from "node:path";
import test = require("node:test");
import * as vm from "node:vm";

const uiPath = path.join(process.cwd(), "media", "config", "assets", "config-app-ui.js");

function loadUiSource(): string {
  return fs.readFileSync(uiPath, "utf8");
}

function loadVisualUtils(): any {
  const source = loadUiSource();
  const startMarker = "// CODEX_VISUAL_EDITOR_UTILS_START";
  const endMarker = "// CODEX_VISUAL_EDITOR_UTILS_END";
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker);
  assert.notEqual(start, -1, "Codex visual utility start marker should exist");
  assert.notEqual(end, -1, "Codex visual utility end marker should exist");
  const sandbox: Record<string, unknown> = {};
  vm.runInNewContext(
    `${source.slice(start, end)}\n;globalThis.__utils = CodexConfigVisualEditorUtils;`,
    sandbox,
  );
  return sandbox.__utils;
}

function extractCodexConfigExample(): string {
  const source = loadUiSource();
  const marker = "codex: {\n      config: `";
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, "Codex config example marker should exist");
  const contentStart = start + marker.length;
  const contentEnd = source.indexOf("`,\n", contentStart);
  assert.notEqual(contentEnd, -1, "Codex config example should terminate");
  return source.slice(contentStart, contentEnd);
}

test("official Codex example uses config.toml instead of JSON", () => {
  const source = loadUiSource();
  const configExample = extractCodexConfigExample();

  assert.match(configExample, /model = "gpt-5\.1-codex"/);
  assert.match(configExample, /\[model_providers\.codex\]/);
  assert.match(configExample, /wire_api = "responses"/);
  assert.match(configExample, /web_search = "cached"/);
  assert.doesNotMatch(configExample, /\[features\]/);
  assert.doesNotMatch(configExample, /env_key/);
  assert.match(source, /"codex-config": \{ title: "Codex config\.toml", content: ps\.codex\.config \}/);
  assert.doesNotMatch(source, /Codex JSON/i);
});

test("visual parser loads TOML fields and provider mapping", () => {
  const utils = loadVisualUtils();
  const configWithRootFields = extractCodexConfigExample().replace(
    "\n[model_providers.codex]",
    '\nmodel_context_window = 128000\nmodel_auto_compact_token_limit = 100000\napproval_policy = "on-request"\nsandbox_mode = "workspace-write"\nweb_search = "cached"\n[features]\nfast_mode = true\n[model_providers.codex]',
  );
  const parsed = utils.parseContent(configWithRootFields);

  assert.equal(parsed.ok, true);
  assert.equal(parsed.state.model, "gpt-5.1-codex");
  assert.equal(parsed.state.modelProvider, "codex");
  assert.equal(parsed.state.contextWindow, "128000");
  assert.equal(parsed.state.autoCompactTokenLimit, "100000");
  assert.equal(parsed.state.approvalPolicy, "on-request");
  assert.equal(parsed.state.sandboxMode, "workspace-write");
  assert.equal(parsed.state.reasoningEffort, "high");
  assert.equal(parsed.state.reasoningSummary, "detailed");
  assert.equal(parsed.state.webSearch, "cached");
  assert.equal(parsed.state.features.fast_mode, true);
  assert.equal(parsed.state.providers.length, 1);
  assert.equal(parsed.state.providers[0].id, "codex");
  assert.equal(parsed.state.providers[0].source.wire_api, "responses");
});

test("serializes visual edits while preserving unknown TOML fields", () => {
  const utils = loadVisualUtils();
  let state = utils.createState(
    `model = "old"\ncustom_root = "keep"\n\n[model_providers.gateway]\nname = "Gateway"\nbase_url = "https://old.example/v1"\nenv_key = "OPENAI_API_KEY"\ncustom_provider = "keep"\n\n[experimental]\nflag = true\n`,
  );
  state = utils.updateState(state, {
    model: "gpt-5.1-codex",
    modelProvider: "gateway",
    approvalPolicy: "never",
    sandboxMode: "danger-full-access",
    reasoningEffort: "medium",
    webSearch: "cached",
  });
  state = utils.updateProvider(state, "gateway", {
    baseUrl: "https://new.example/v1",
    wireApi: "responses",
  });
  const serialized = utils.serializeState(state);

  assert.equal(serialized.ok, true);
  assert.match(serialized.content, /model = "gpt-5\.1-codex"/);
  assert.match(serialized.content, /custom_root = "keep"/);
  assert.match(serialized.content, /\[experimental\]\nflag = true/);
  assert.match(serialized.content, /\[model_providers\.gateway\]/);
  assert.match(serialized.content, /custom_provider = "keep"/);
  assert.match(serialized.content, /base_url = "https:\/\/new\.example\/v1"/);
  assert.match(serialized.content, /env_key = "OPENAI_API_KEY"/);
  assert.equal(serialized.envContent, undefined);
});

test("Codex visual state round-trips developer instructions, verbosity, and web search modes", () => {
  const utils = loadVisualUtils();
  let state = utils.createState(
    'model_verbosity = "high"\ndeveloper_instructions = "Keep responses concise."\nweb_search = "indexed"\n',
    "",
  );

  assert.equal(state.verbosity, "high");
  assert.equal(state.developerInstructions, "Keep responses concise.");
  assert.equal(state.webSearch, "indexed");

  state = utils.updateState(state, {
    verbosity: "low",
    developerInstructions: "Use the repository conventions.\nKeep explanations focused.",
    webSearch: "live",
  });
  const serialized = utils.serializeState(state);
  assert.equal(serialized.ok, true);
  const reparsed = utils.parseToml(serialized.content);
  assert.equal(reparsed.model_verbosity, "low");
  assert.equal(
    reparsed.developer_instructions,
    "Use the repository conventions.\nKeep explanations focused.",
  );
  assert.equal(reparsed.web_search, "live");

  state = utils.updateState(state, {
    verbosity: "",
    developerInstructions: "",
    webSearch: "",
  });
  const cleared = utils.parseToml(utils.serializeState(state).content);
  assert.equal(cleared.model_verbosity, undefined);
  assert.equal(cleared.developer_instructions, undefined);
  assert.equal(cleared.web_search, undefined);
});

test("Codex visual state accepts and serializes the product ultra reasoning value", () => {
  const utils = loadVisualUtils();
  let state = utils.createState('model_reasoning_effort = "ultra"\n', "");

  assert.equal(state.reasoningEffort, "ultra");
  let serialized = utils.serializeState(state);
  assert.equal(serialized.ok, true);
  assert.equal(utils.parseToml(serialized.content).model_reasoning_effort, "ultra");

  state = utils.updateState(utils.createState("", ""), { reasoningEffort: "ultra" });
  serialized = utils.serializeState(state);
  assert.equal(serialized.ok, true);
  assert.equal(utils.parseToml(serialized.content).model_reasoning_effort, "ultra");
});

test("Codex visual max option follows xhigh and serializes for new configs", () => {
  const utils = loadVisualUtils();
  assert.deepEqual(Array.from(utils.reasoningEffortOptions), [
    "minimal",
    "low",
    "medium",
    "high",
    "xhigh",
    "max",
    "ultra",
  ]);
  const state = utils.updateState(utils.createState("", ""), { reasoningEffort: "max" });
  const serialized = utils.serializeState(state);
  assert.equal(serialized.ok, true);
  assert.equal(utils.parseToml(serialized.content).model_reasoning_effort, "max");

  const source = loadUiSource();
  assert.match(
    source,
    /\[state\.reasoningEffort, CODEX_VISUAL_REASONING_EFFORT_OPTIONS,/,
  );
  assert.match(
    source,
    /"model_reasoning_effort"[\s\S]*?\["", \.\.\.CODEX_VISUAL_REASONING_EFFORT_OPTIONS\]\.map/,
  );
});

test("Codex visual serializes current root parameters and feature switches", () => {
  const utils = loadVisualUtils();
  let state = utils.createState(
    `model = "gpt-5"
model_context_window = 128000
model_auto_compact_token_limit = 100000
approval_policy = "on-request"
sandbox_mode = "danger-full-access"
web_search = "cached"

[features]
fast_mode = true

[model_providers.gateway]
name = "Gateway"
wire_api = "responses"
`,
    "",
  );

  assert.equal(state.contextWindow, "128000");
  assert.equal(state.autoCompactTokenLimit, "100000");
  assert.equal(state.approvalPolicy, "on-request");
  assert.equal(state.webSearch, "cached");
  assert.equal(state.features.fast_mode, true);
  assert.equal(state.providers[0].wireApi, "responses");

  state = utils.updateState(state, {
    model: "gpt-5.1-codex",
    contextWindow: "200000",
    autoCompactTokenLimit: "150000",
    features: { fast_mode: true, hooks: true },
  });
  const serialized = utils.serializeState(state);
  assert.equal(serialized.ok, true);
  const config = utils.parseToml(serialized.content);
  assert.equal(config.model_context_window, 200000);
  assert.equal(config.model_auto_compact_token_limit, 150000);
  assert.equal(config.approval_policy, "on-request");
  assert.equal(config.sandbox_mode, "danger-full-access");
  assert.equal(config.web_search, "cached");
  assert.equal(config.features.fast_mode, true);
  assert.equal(config.features.hooks, true);
  assert.equal(config.model_providers.gateway.wire_api, "responses");

  const newState = utils.updateState(utils.createState("", ""), { approvalPolicy: "untrusted" });
  const rejected = utils.serializeState(newState);
  assert.equal(rejected.ok, false);
  assert.match(rejected.error, /approval_policy/);

  const invalidType = utils.parseContent('model_context_window = 1.5\n');
  assert.equal(invalidType.ok, false);
  assert.match(invalidType.error, /model_context_window/);
  const invalidWebSearch = utils.parseContent('web_search = true\n');
  assert.equal(invalidWebSearch.ok, false);
  assert.match(invalidWebSearch.error, /web_search/);
});

test("invalid TOML cannot replace the last valid visual state", () => {
  const utils = loadVisualUtils();
  const parsed = utils.parseContent("model = \"gpt-5\"\nnot valid\n", "");
  assert.equal(parsed.ok, false);
  assert.equal(parsed.state, null);
  assert.match(parsed.error, /TOML 无法加载到可视化编辑器/);
  assert.match(parsed.error, /切换到 TOML 源码修复/);

  const serialized = utils.serializeState(parsed.state);
  assert.equal(serialized.ok, false);
  assert.match(serialized.error, /TOML 源码修复/);
});

test("editor keeps visual and TOML source modes without .env editor", () => {
  const source = loadUiSource();
  const codexStart = source.indexOf('className: "config-editor-shell config-editor-codex"');
  assert.notEqual(codexStart, -1, "Codex editor branch should exist");
  const codexBranch = source.slice(codexStart);

  assert.match(codexBranch, /children: \[be\.jsx\(Ya, \{\}\), " config\.toml"\]/);
  assert.match(codexBranch, /主配置: ~\/\.codex\/config\.toml/);
  assert.match(
    codexBranch,
    /title: renderConfigEditorCardTitle\(`编辑配置: \$\{O\.name\}`,[\s\S]*?switchCodexEditorMode\("visual"\)[\s\S]*?switchCodexEditorMode\("toml"\)[\s\S]*?className: "config-editor-fixed-actions"[\s\S]*?className: "config-editor-fixed-action-row"[\s\S]*?children: "保存"/,
    "Codex mode tabs should stay under the card title before primary actions",
  );
  assert.match(
    codexBranch,
    /config\.toml[\s\S]*?children: "查看范例"/,
    "Codex example entry should remain beside the config filename",
  );
  assert.match(codexBranch, /switchCodexEditorMode\("visual"\)/);
  assert.match(codexBranch, /switchCodexEditorMode\("toml"\)/);
  assert.match(codexBranch, /codexEditorMode === "visual" \? renderCodexVisualEditor\(\) : null/);
  assert.match(codexBranch, /display: codexEditorMode === "toml" \? "flex" : "none"/);
  assert.match(codexBranch, /label: "TOML 源码"/);
  assert.match(codexBranch, /children: "配置文件路径: ~\/\.codex\/config\.toml"/);
  assert.doesNotMatch(codexBranch, /\.env|codex-env|请输入 \.env 配置/);
  assert.doesNotMatch(codexBranch, /请输入JSON配置[\s\S]*?config\.toml/);
});

test("Codex config filename and example entry appear once across editor modes", () => {
  const source = loadUiSource();
  const codexStart = source.indexOf('className: "config-editor-shell config-editor-codex"');
  assert.notEqual(codexStart, -1, "Codex editor branch should exist");
  const codexEnd = source.indexOf("be.jsx(SkillsManagerModal,", codexStart);
  assert.notEqual(codexEnd, -1, "Codex editor branch should end before the skills modal");
  const codexBranch = source.slice(codexStart, codexEnd);
  const configExampleAction = 'onClick: () => N("codex-config")';

  assert.equal(
    codexBranch.split(configExampleAction).length - 1,
    1,
    "Codex config.toml should have only one shared example entry",
  );
  assert.equal(
    (codexBranch.match(/children: \[be\.jsx\(Ya, \{\}\), " config\.toml"\]/g) || []).length,
    1,
    "TOML source mode should not repeat the shared config.toml heading",
  );
  const visualEditorStart = codexBranch.indexOf('codexEditorMode === "visual" ? renderCodexVisualEditor() : null');
  assert.notEqual(visualEditorStart, -1, "Codex visual editor should exist");
  assert.ok(
    codexBranch.indexOf(configExampleAction) < visualEditorStart,
    "The single example entry should remain outside both editor modes",
  );
  assert.match(codexBranch, /onClick: \(\) => N\("codex-auth"\)/);
});

test("Codex editor saves TOML and auth without envContent", () => {
  const source = loadUiSource();

  assert.match(
    source,
    /await r\(O\.id, \{ content: W, configContent: W, authContent: k \}\);/,
  );
  assert.match(
    source,
    /await r\(O\.id, \{ content: m, configContent: m, authContent: W \}\);/,
  );
  assert.doesNotMatch(source, /await applyConfigItem\("codex", \{[\s\S]*?envContent:/);
});

test("visual labels expose tooltip help and enum values", () => {
  const source = loadUiSource();
  assert.match(source, /renderConfigFieldLabel =/);
  assert.match(source, /children: "\?"/);
  assert.match(source, /const CONFIG_FIELD_HELP_TOOLTIP_TITLE_FALLBACK_DELAY_MS = 500;/);
  assert.match(
    source,
    /const CONFIG_FIELD_HELP_TOOLTIP_DELAY_MS = CONFIG_FIELD_HELP_TOOLTIP_TITLE_FALLBACK_DELAY_MS \/ 2;/,
    "tooltip hover delay should be explicitly halved from the previous title fallback timing",
  );
  assert.match(source, /setTimeout\(\(\) => \{[\s\S]*?setConfigFieldHelpTooltipKey\(W\);[\s\S]*?CONFIG_FIELD_HELP_TOOLTIP_DELAY_MS/);
  assert.match(source, /title: getConfigFieldHelp\(W, H\)/);
  assert.match(source, /role: "tooltip"/);
  assert.match(source, /formatConfigEnumHelp\(getConfigFieldHelp\(W, U\.help\)/);
  assert.match(source, /approval_policy: "控制工具执行审批：on-request 按需请求批准，never 从不请求批准。细粒度 granular 策略在 TOML 源码中配置。"/);
  assert.doesNotMatch(source, /\["", "untrusted", "on-request", "never"\]/);
  assert.match(source, /"on-request"/);
  assert.match(source, /"never"/);
  assert.match(source, /sandbox_mode: "控制 Codex CLI 文件系统沙箱范围。"/);
  assert.match(source, /"read-only"/);
  assert.match(source, /"workspace-write"/);
  assert.match(source, /"danger-full-access"/);
  assert.match(
    source,
    /"model_reasoning_effort"[\s\S]*?\["", \.\.\.CODEX_VISUAL_REASONING_EFFORT_OPTIONS\]\.map/,
  );
  assert.match(source, /CODEX_VISUAL_WEB_SEARCH_OPTIONS/);
  assert.match(source, /model_context_window/);
  assert.match(source, /model_auto_compact_token_limit/);
  assert.match(source, /"data-testid": "codex-features"/);
  assert.match(source, /CODEX_VISUAL_FEATURE_HELP/);
  assert.match(source, /viewBox: "0 0 16 16"/);
  assert.match(source, /onMouseEnter: \(\) => \{ hideConfigFieldHelpTooltip\(\); setConfigFieldHelpTooltipKey\(feature\); \}/);
  assert.match(source, /onMouseLeave: hideConfigFieldHelpTooltip/);
  assert.match(source, /wire_api: "Codex 当前仅支持 Responses API（responses）。旧协议值仅兼容保留，不代表当前 CLI 支持；可在 TOML 源码中迁移。"/);
  assert.doesNotMatch(source, /env_key: "从 \.env 读取 API Key 的环境变量名。"/);
  const codexStart = source.indexOf("renderCodexVisualEditor = () =>");
  const codexEnd = source.indexOf("\n    return O", codexStart);
  const codexVisualSource = source.slice(codexStart, codexEnd);
  assert.doesNotMatch(codexVisualSource, /renderCodexField\("env_key"/);
  assert.doesNotMatch(codexVisualSource, /OPENAI_API_KEY|\.codex\/\.env|codexVisualState\.env/);
  assert.doesNotMatch(codexVisualSource, /renderCodexSelect\("features\.web_search"/);
  assert.doesNotMatch(codexVisualSource, /renderCodexSelect\("tools\.web_search"/);
});

test("Codex 公共区在顶部，Provider 使用共享列表和双栏详情", () => {
  const source = loadUiSource();
  const codexStart = source.indexOf("renderCodexVisualEditor = () =>");
  const codexEnd = source.indexOf("\n    const renderFixedEditorModeTabs", codexStart);
  assert.notEqual(codexStart, -1, "Codex visual editor should exist");
  assert.notEqual(codexEnd, -1, "Codex visual editor should terminate before editor return");
  const codexVisualSource = source.slice(codexStart, codexEnd);

  assert.ok(codexVisualSource.indexOf('"codex-common-parameters"') < codexVisualSource.indexOf('"codex-provider-workspace"'));
  assert.ok(codexVisualSource.indexOf('"codex-provider-workspace"') < codexVisualSource.indexOf('"codex-features"'));
  assert.ok(codexVisualSource.indexOf('"默认模型 model"') < codexVisualSource.indexOf('"默认 Provider"'));
  assert.ok(codexVisualSource.indexOf('"默认 Provider"') < codexVisualSource.indexOf('"model_context_window"'));
  assert.match(codexVisualSource, /gridTemplateColumns: "repeat\(4, minmax\(0, 1fr\)\)"/);
  assert.match(codexVisualSource, /role: "table"/);
  assert.match(codexVisualSource, /role: "cell"/);
  assert.match(codexVisualSource, /className: "grok-model-workspace codex-provider-workspace"/);
  assert.match(codexVisualSource, /className: "grok-model-row"/);
  assert.match(codexVisualSource, /className: "config-visual-form-grid"/);
  assert.match(codexVisualSource, /"data-codex-delete-provider-id": provider\.id/);
  assert.match(codexVisualSource, /icon: be\.jsx\(AH, \{\}\)/);
  assert.doesNotMatch(codexVisualSource, /renderCodex(?:Select|Field|TextArea)\("(?:model_verbosity|developer_instructions|disable_response_storage|hide_agent_reasoning|model_supports_reasoning_summaries|model_reasoning_summary)"/);
});

type VisualNode = { type: unknown; props: Record<string, any> };

function visualNodes(value: unknown): VisualNode[] {
  if (Array.isArray(value)) return value.flatMap(visualNodes);
  if (!value || typeof value !== "object" || !("props" in value)) return [];
  const node = value as VisualNode;
  return [node, ...visualNodes(node.props.children)];
}

function createCodexEditorHarness(content: string) {
  const source = loadUiSource();
  const utils = loadVisualUtils();
  const jsx = (type: unknown, props: Record<string, any>) => ({ type, props });
  const confirmations: Record<string, any>[] = [];
  const sandbox: Record<string, any> = {
    be: { jsx, jsxs: jsx }, xn: "Button", AH: "DeleteIcon",
    xr: { confirm: (options: Record<string, any>) => confirmations.push(options) },
    codexVisualState: utils.createState(content), codexVisualError: "",
    getConfigFieldHelp: (label: string) => label,
    CODEX_VISUAL_REASONING_EFFORT_OPTIONS: ["low", "medium", "high", "xhigh"],
    CODEX_VISUAL_APPROVAL_POLICY_OPTIONS: ["on-request", "never"],
    CODEX_VISUAL_SANDBOX_MODE_OPTIONS: ["read-only", "workspace-write", "danger-full-access"],
    CODEX_VISUAL_WEB_SEARCH_OPTIONS: ["disabled", "cached", "indexed", "live"],
    CODEX_VISUAL_FEATURE_OPTIONS: ["enable_request_compression", "fast_mode", "goals", "hooks", "memories", "multi_agent", "prefer_mxc", "prevent_idle_sleep", "remote_plugin", "shell_snapshot", "shell_tool", "skill_mcp_dependency_install", "ultrafast_mode", "unified_exec"],
    CODEX_VISUAL_FEATURE_HELP: {
      enable_request_compression: "启用请求压缩。",
      fast_mode: "启用 Fast mode。是否可用仍取决于当前模型和账户。",
      goals: "启用 Goals 功能，用于持久化目标和自动继续。",
      hooks: "启用 Codex hooks 生命周期钩子。",
      memories: "启用 Memories 功能。",
      multi_agent: "启用多智能体协作工具。",
      prefer_mxc: "在支持时优先使用 MXC 执行路径。",
      prevent_idle_sleep: "运行期间阻止计算机进入睡眠。",
      remote_plugin: "启用远程插件目录。",
      shell_snapshot: "为重复命令创建 shell 环境快照，以提高执行速度。",
      shell_tool: "启用命令执行工具。",
      skill_mcp_dependency_install: "允许为 Skill 提示并安装缺失的 MCP 依赖。",
      ultrafast_mode: "启用 Ultrafast mode。是否可用仍取决于当前模型和账户。",
      unified_exec: "启用可恢复的统一命令执行。",
    },
    configFieldHelpTooltipKey: "",
    setConfigFieldHelpTooltipKey: (key: string) => { sandbox.configFieldHelpTooltipKey = key; },
    hideConfigFieldHelpTooltip: () => { sandbox.configFieldHelpTooltipKey = ""; },
    renderCodexField: (label: string, value: string, onChange: unknown) => jsx("Field", { label, value, onChange }),
    renderCodexSelect: (label: string, value: string, onChange: unknown, options: unknown[]) => jsx("Select", { label, value, onChange, options }),
    renderCodexSection: (title: string, description: string, children: unknown) => jsx("Section", { title, description, children }),
    codexVisualAddProvider: utils.addProvider, codexVisualCreateState: utils.createState,
    codexVisualDeleteProvider: utils.deleteProvider,
    setCodexVisualState: (update: any) => { sandbox.codexVisualState = typeof update === "function" ? update(sandbox.codexVisualState) : update; },
    updateCodexVisualState: (patch: any) => { sandbox.codexVisualState = utils.updateState(sandbox.codexVisualState, patch); },
    selectCodexProvider: (id: string) => { sandbox.codexVisualState = { ...sandbox.codexVisualState, selectedProviderId: id }; },
    updateSelectedCodexProvider: (patch: any) => { sandbox.codexVisualState = utils.updateProvider(sandbox.codexVisualState, sandbox.codexVisualState.selectedProviderId, patch); },
  };
  Object.defineProperty(sandbox, "selectedCodexProvider", {
    get: () => sandbox.codexVisualState?.providers.find((provider: any) => provider.id === sandbox.codexVisualState.selectedProviderId),
  });
  const confirmStart = source.indexOf("confirmDeleteCodexProvider =");
  const confirmEnd = source.indexOf("renderCodexField =", confirmStart);
  const renderStart = source.indexOf("renderCodexVisualEditor = () =>");
  const renderEnd = source.indexOf("\n    const renderFixedEditorModeTabs", renderStart);
  assert.ok(confirmStart >= 0 && confirmEnd > confirmStart && renderEnd > renderStart);
  vm.runInNewContext(`const ${source.slice(confirmStart, confirmEnd).replace(/,\s*$/, ";")}\nconst ${source.slice(renderStart, renderEnd)}\nglobalThis.render = renderCodexVisualEditor;`, sandbox);
  const render = () => sandbox.render() as VisualNode;
  const find = (property: string, value: unknown) => {
    const node = visualNodes(render()).find((candidate) => candidate.props[property] === value);
    assert.ok(node, `缺少 ${property}=${value}`);
    return node;
  };
  return { sandbox, utils, confirmations, render, find };
}

test("Codex Provider 列表支持选中、新增、取消删除和确认删除非选中项", () => {
  const harness = createCodexEditorHarness('model_provider = "first"\n[model_providers.first]\nname = "首项"\n[model_providers.second]\nname = "次项"\n');
  assert.equal(harness.render().props.children[0].props["data-testid"], "codex-common-parameters");
  harness.find("data-codex-provider-id", "second").props.onClick();
  assert.equal(harness.sandbox.codexVisualState.selectedProviderId, "second");
  assert.equal(harness.find("data-codex-provider-id", "second").props["aria-pressed"], true);
  assert.equal(harness.find("label", "Provider id").props.value, "second");
  let stopped = false;
  harness.find("data-codex-delete-provider-id", "first").props.onClick({ stopPropagation: () => { stopped = true; } });
  assert.equal(stopped, true);
  assert.equal(harness.sandbox.codexVisualState.providers.length, 2);
  harness.find("data-codex-delete-provider-id", "first").props.onClick({ stopPropagation() {} });
  harness.confirmations.at(-1)!.onOk();
  assert.equal(harness.sandbox.codexVisualState.providers.length, 1);
  assert.equal(harness.sandbox.codexVisualState.providers[0].id, "second");
  assert.equal(harness.sandbox.codexVisualState.selectedProviderId, "second");
  harness.find("data-testid", "codex-add-provider").props.onClick();
  assert.equal(harness.sandbox.codexVisualState.providers.length, 2);
  assert.notEqual(harness.sandbox.codexVisualState.selectedProviderId, "second");
});

test("Codex 空列表可新增，解析错误显示可恢复提示", () => {
  const harness = createCodexEditorHarness("");
  assert.match(JSON.stringify(harness.render()), /暂无 Provider，请新增/);
  harness.find("data-testid", "codex-add-provider").props.onClick();
  assert.equal(harness.sandbox.codexVisualState.providers.length, 1);
  assert.deepEqual(Array.from(harness.find("label", "wire_api").props.options, (option: any) => option.value), ["", "responses"]);
  harness.sandbox.codexVisualState = null;
  assert.match(JSON.stringify(harness.render()), /切换到 TOML 源码修复/);
});

test("Codex features 使用复选框并序列化布尔值", () => {
  const harness = createCodexEditorHarness("[features]\nfast_mode = true\n");
  const checkbox = harness.find("data-codex-feature", "fast_mode");
  assert.equal(checkbox.props.type, "checkbox");
  assert.equal(checkbox.props.checked, true);
  const cell = harness.find("data-codex-feature-cell", "fast_mode");
  assert.equal(cell.props.role, "cell");
  const helpIcon = visualNodes(cell).find((node) => node.props.role === "img");
  assert.ok(helpIcon, "feature should expose an SVG help icon");
  assert.equal(helpIcon.props.tabIndex, 0);
  helpIcon.props.onMouseEnter();
  assert.equal(harness.sandbox.configFieldHelpTooltipKey, "fast_mode");
  const tooltip = visualNodes(harness.render()).find((node) => node.props.role === "tooltip");
  assert.ok(tooltip, "feature help should appear immediately on hover");
  assert.match(String(tooltip.props.children), /Fast mode/);
  helpIcon.props.onMouseLeave();
  assert.equal(harness.sandbox.configFieldHelpTooltipKey, "");
  checkbox.props.onChange({ target: { checked: false } });
  assert.equal(harness.sandbox.codexVisualState.features.fast_mode, false);
  const serialized = harness.utils.serializeState(harness.sandbox.codexVisualState);
  assert.equal(serialized.ok, true);
  assert.equal(harness.utils.parseToml(serialized.content).features.fast_mode, false);
});

test("Codex 精简表单编辑后保留未展示字段和 Provider 配置", () => {
  const content = `model = "old"
model_provider = "gateway"
model_verbosity = "high"
model_reasoning_summary = "detailed"
developer_instructions = "保留指令"
disable_response_storage = true
hide_agent_reasoning = false
model_supports_reasoning_summaries = true
[model_providers.gateway]
name = "原始名称"
wire_api = "chat"
env_key = "CUSTOM_API_KEY"
request_max_retries = 7
stream_max_retries = 6
stream_idle_timeout_ms = 90000
[model_providers.gateway.http_headers]
"X-Custom" = "preserved"
[custom_root]
enabled = true
`;
  const harness = createCodexEditorHarness(content);
  harness.find("label", "默认模型 model").props.onChange("updated");
  harness.find("label", "name").props.onChange("新名称");
  const serialized = harness.utils.serializeState(harness.sandbox.codexVisualState);
  assert.equal(serialized.ok, true);
  const expected = harness.utils.parseContent(content).state.source;
  expected.model = "updated";
  expected.model_providers.gateway.name = "新名称";
  assert.deepEqual(JSON.parse(JSON.stringify(harness.utils.parseContent(serialized.content).state.source)), JSON.parse(JSON.stringify(expected)));
  assert.equal(harness.sandbox.codexVisualState.providers[0].wireApi, "chat");
});
