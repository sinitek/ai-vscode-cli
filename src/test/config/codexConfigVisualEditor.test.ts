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
    '\napproval_policy = "on-request"\nsandbox_mode = "workspace-write"\nweb_search = true\n[model_providers.codex]',
  );
  const parsed = utils.parseContent(`${configWithRootFields}\n[tools]\nweb_search = true\n[features]\nweb_search = false\n`);

  assert.equal(parsed.ok, true);
  assert.equal(parsed.state.model, "gpt-5.1-codex");
  assert.equal(parsed.state.modelProvider, "codex");
  assert.equal(parsed.state.approvalPolicy, "on-request");
  assert.equal(parsed.state.sandboxMode, "workspace-write");
  assert.equal(parsed.state.reasoningEffort, "high");
  assert.equal(parsed.state.reasoningSummary, "detailed");
  assert.match(parsed.state.webSearch, /__sinitek_codex_compatibility__/);
  assert.equal(parsed.state.toolsWebSearch, undefined);
  assert.equal(parsed.state.featuresWebSearch, undefined);
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

test("Codex visual saves preserve legacy values and complex approval or web-search objects", () => {
  const utils = loadVisualUtils();
  let state = utils.createState(
    `model = "gpt-5"
approval_policy = "on-failure"
model_reasoning_effort = "max"
web_search = true

[tools.web_search]
max_context_size_bytes = 2048
allowed_domains = ["docs.example.com"]

[features]
web_search = false

[model_providers.gateway]
name = "Gateway"
wire_api = "chat"
`,
    "",
  );

  assert.equal(state.approvalPolicy, "on-failure");
  assert.equal(state.reasoningEffort, "max");
  assert.match(state.webSearch, /__sinitek_codex_compatibility__/);
  assert.equal(state.providers[0].wireApi, "chat");

  state = utils.updateState(state, { model: "gpt-5.1-codex" });
  const serialized = utils.serializeState(state);
  assert.equal(serialized.ok, true);
  const config = utils.parseToml(serialized.content);
  assert.equal(config.approval_policy, "on-failure");
  assert.equal(config.model_reasoning_effort, "max");
  assert.equal(config.web_search, true);
  assert.equal(config.tools.web_search.max_context_size_bytes, 2048);
  assert.deepEqual(JSON.parse(JSON.stringify(config.tools.web_search.allowed_domains)), ["docs.example.com"]);
  assert.equal(config.features.web_search, false);
  assert.equal(config.model_providers.gateway.wire_api, "chat");

  const newState = utils.updateState(utils.createState("", ""), {
    approvalPolicy: "on-failure",
    reasoningEffort: "max",
  });
  const rejected = utils.serializeState(newState);
  assert.equal(rejected.ok, false);
  assert.match(rejected.error, /approval_policy/);

  let complexState = utils.createState(
    `[approval_policy]
default = "on-request"

[tools.web_search]
max_context_size_bytes = 2048
allowed_domains = ["docs.example.com"]
`,
    "",
  );
  assert.match(complexState.approvalPolicy, /__sinitek_codex_compatibility__/);
  complexState = utils.updateState(complexState, { model: "gpt-5.1-codex" });
  const complex = utils.parseToml(utils.serializeState(complexState).content);
  assert.equal(complex.approval_policy.default, "on-request");
  assert.equal(complex.tools.web_search.max_context_size_bytes, 2048);
  assert.deepEqual(JSON.parse(JSON.stringify(complex.tools.web_search.allowed_domains)), ["docs.example.com"]);
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
  assert.match(source, /approval_policy: "控制命令执行前的审批策略。复杂 granular table 仅在 TOML 源码中保留。"/);
  assert.match(source, /"untrusted"/);
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
  assert.match(source, /web_search[\s\S]*?\["", "disabled", "cached", "indexed", "live"\]\.map/);
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

test("Codex 精简表单编辑后保留高级参数、旧协议和未知字段", () => {
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
