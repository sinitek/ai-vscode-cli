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

function loadLegacyMaxCompatibilityOptionOrderer(): any {
  const source = loadUiSource();
  const startMarker = "insertLegacyMaxCompatibilityOption = ";
  const endMarker = ",\n      renderClaudeSelect";
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.notEqual(start, -1, "legacy max compatibility orderer should exist");
  assert.notEqual(end, -1, "legacy max compatibility orderer should terminate before select rendering");
  const sandbox: Record<string, unknown> = {};
  vm.runInNewContext(
    `globalThis.__orderer = ${source.slice(start + startMarker.length, end)};`,
    sandbox,
  );
  return sandbox.__orderer;
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

function extractCodexEnvExample(): string {
  const source = loadUiSource();
  const marker = "env: `";
  const configStart = source.indexOf("codex: {\n      config: `");
  const start = source.indexOf(marker, configStart);
  assert.notEqual(start, -1, "Codex .env example marker should exist");
  const contentStart = start + marker.length;
  const contentEnd = source.indexOf("`,\n", contentStart);
  assert.notEqual(contentEnd, -1, "Codex .env example should terminate");
  return source.slice(contentStart, contentEnd);
}

test("official Codex example uses config.toml with .env instead of JSON", () => {
  const source = loadUiSource();
  const configExample = extractCodexConfigExample();
  const envExample = extractCodexEnvExample();

  assert.match(configExample, /model = "gpt-5\.1-codex"/);
  assert.match(configExample, /\[model_providers\.codex\]/);
  assert.match(configExample, /env_key = "OPENAI_API_KEY"/);
  assert.match(configExample, /web_search = "cached"/);
  assert.doesNotMatch(configExample, /\[features\]/);
  assert.match(envExample, /# ~\/\.codex\/\.env/);
  assert.match(envExample, /OPENAI_API_KEY=<你的 api key>/);
  assert.match(source, /"codex-config": \{ title: "Codex config\.toml 与 \.env"/);
  assert.match(source, /# ~\/\.codex\/\.env\\n\$\{ps\.codex\.env\}/);
  assert.doesNotMatch(source, /Codex JSON/i);
});

test("visual parser loads TOML fields, provider mapping, and .env values", () => {
  const utils = loadVisualUtils();
  const configWithRootFields = extractCodexConfigExample().replace(
    "\n[model_providers.codex]",
    '\napproval_policy = "on-request"\nsandbox_mode = "workspace-write"\nweb_search = true\n[model_providers.codex]',
  );
  const parsed = utils.parseContent(
    `${configWithRootFields}\n[tools]\nweb_search = true\n[features]\nweb_search = false\n`,
    extractCodexEnvExample(),
  );

  assert.equal(parsed.ok, true);
  assert.equal(parsed.state.model, "gpt-5.1-codex");
  assert.equal(parsed.state.modelProvider, "codex");
  assert.equal(parsed.state.approvalPolicy, "on-request");
  assert.equal(parsed.state.sandboxMode, "workspace-write");
  assert.equal(parsed.state.reasoningEffort, "medium");
  assert.equal(parsed.state.reasoningSummary, "detailed");
  assert.match(parsed.state.webSearch, /__sinitek_codex_compatibility__/);
  assert.equal(parsed.state.toolsWebSearch, undefined);
  assert.equal(parsed.state.featuresWebSearch, undefined);
  assert.equal(parsed.state.providers.length, 1);
  assert.equal(parsed.state.providers[0].id, "codex");
  assert.equal(parsed.state.providers[0].envKey, "OPENAI_API_KEY");
  assert.equal(parsed.state.env.OPENAI_API_KEY, "<你的 api key>");
  assert.equal(parsed.state.env.OPENAI_BASE_URL, "<可选供应商 url>");
});

test("serializes visual edits while preserving unknown TOML and .env fields", () => {
  const utils = loadVisualUtils();
  let state = utils.createState(
    `model = "old"\ncustom_root = "keep"\n\n[model_providers.gateway]\nname = "Gateway"\nbase_url = "https://old.example/v1"\ncustom_provider = "keep"\n\n[experimental]\nflag = true\n`,
    `CUSTOM_ENV=keep\nOPENAI_API_KEY=old-key\n`,
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
    envKey: "OPENAI_API_KEY",
    wireApi: "responses",
  });
  state = utils.updateEnv(state, "OPENAI_API_KEY", "new-key");
  state = utils.updateEnv(state, "OPENAI_BASE_URL", "https://new.example/v1");

  const serialized = utils.serializeState(state);

  assert.equal(serialized.ok, true);
  assert.match(serialized.content, /model = "gpt-5\.1-codex"/);
  assert.match(serialized.content, /custom_root = "keep"/);
  assert.match(serialized.content, /\[experimental\]\nflag = true/);
  assert.match(serialized.content, /\[model_providers\.gateway\]/);
  assert.match(serialized.content, /custom_provider = "keep"/);
  assert.match(serialized.content, /base_url = "https:\/\/new\.example\/v1"/);
  assert.match(serialized.content, /env_key = "OPENAI_API_KEY"/);
  assert.match(serialized.envContent, /CUSTOM_ENV=keep/);
  assert.match(serialized.envContent, /OPENAI_API_KEY=new-key/);
  assert.match(serialized.envContent, /OPENAI_BASE_URL=https:\/\/new\.example\/v1/);
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

test("Codex visual legacy max select keeps max immediately before ultra", () => {
  const orderer = loadLegacyMaxCompatibilityOptionOrderer();
  const fixedOptions = ["", "minimal", "low", "medium", "high", "xhigh", "ultra"].map((value) => ({
    value,
    label: value || "Use default",
  }));

  assert.deepEqual(
    Array.from(orderer(fixedOptions, "max", { value: "max", label: "max" }), (option: any) => option.value),
    ["", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"],
  );
  assert.deepEqual(
    Array.from(orderer(fixedOptions, "future-effort", { value: "future-effort", label: "future-effort" }), (option: any) => option.value),
    ["", "minimal", "low", "medium", "high", "xhigh", "ultra", "future-effort"],
  );

  const source = loadUiSource();
  const selectStart = source.indexOf("renderCodexSelect =");
  const selectEnd = source.indexOf(",\n      renderCodexTextArea", selectStart);
  assert.notEqual(selectStart, -1, "Codex select renderer should exist");
  assert.notEqual(selectEnd, -1, "Codex select renderer should terminate before text area rendering");
  assert.match(source.slice(selectStart, selectEnd), /insertLegacyMaxCompatibilityOption\(L, H,/);
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

test("editor exposes visual and TOML source modes with .env editor", () => {
  const source = loadUiSource();
  const codexStart = source.indexOf('className: "config-editor-shell config-editor-codex"');
  assert.notEqual(codexStart, -1, "Codex editor branch should exist");
  const codexBranch = source.slice(codexStart);

  assert.match(codexBranch, /config\.toml \/ \.env/);
  assert.match(codexBranch, /主配置: ~\/\.codex\/config\.toml/);
  assert.match(
    codexBranch,
    /config\.toml \/ \.env[\s\S]*?children: "查看范例"[\s\S]*?switchCodexEditorMode\("visual"\)/,
    "Codex example entry should sit beside the config filename and before mode controls",
  );
  assert.match(codexBranch, /switchCodexEditorMode\("visual"\)/);
  assert.match(codexBranch, /switchCodexEditorMode\("toml"\)/);
  assert.match(codexBranch, /codexEditorMode === "visual" \? renderCodexVisualEditor\(\) : null/);
  assert.match(codexBranch, /display: codexEditorMode === "toml" \? "flex" : "none"/);
  assert.match(codexBranch, /children: "TOML 源码"/);
  assert.match(codexBranch, /children: "配置文件路径: ~\/\.codex\/\.env"/);
  assert.match(codexBranch, /value: b/);
  assert.match(codexBranch, /placeholder: "请输入 \.env 配置"/);
  assert.doesNotMatch(codexBranch, /请输入JSON配置[\s\S]*?config\.toml/);
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
    /"model_reasoning_effort"[\s\S]*?\["", "minimal", "low", "medium", "high", "xhigh", "ultra"\]\.map/,
  );
  assert.match(source, /"model_verbosity"[\s\S]*?\["", "low", "medium", "high"\]\.map/);
  assert.match(source, /renderCodexTextArea\([\s\S]*?"developer_instructions"/);
  assert.match(source, /web_search[\s\S]*?\["", "disabled", "cached", "indexed", "live"\]\.map/);
  assert.match(source, /wire_api: "Provider 使用的 wire API。新配置仅提供 responses；旧值会保留直到明确迁移。"/);
  const codexStart = source.indexOf("renderCodexVisualEditor = () =>");
  const codexEnd = source.indexOf("\n    return O", codexStart);
  const codexVisualSource = source.slice(codexStart, codexEnd);
  assert.doesNotMatch(codexVisualSource, /renderCodexSelect\("features\.web_search"/);
  assert.doesNotMatch(codexVisualSource, /renderCodexSelect\("tools\.web_search"/);
});

test("Codex provider list uses reduced shared card width", () => {
  const source = loadUiSource();
  const codexStart = source.indexOf("renderCodexVisualEditor = () =>");
  const codexEnd = source.indexOf("\n    return O", codexStart);
  assert.notEqual(codexStart, -1, "Codex visual editor should exist");
  assert.notEqual(codexEnd, -1, "Codex visual editor should terminate before editor return");
  const codexVisualSource = source.slice(codexStart, codexEnd);

  assert.match(source, /const CONFIG_PROVIDER_CARD_ORIGINAL_WIDTH_PX = 220;/);
  assert.match(source, /const CONFIG_PROVIDER_CARD_ORIGINAL_MIN_WIDTH_PX = 190;/);
  assert.match(source, /const CONFIG_PROVIDER_CARD_WIDTH_SCALE = 0\.6;/);
  assert.match(
    codexVisualSource,
    /width: `\$\{CONFIG_PROVIDER_CARD_WIDTH_PX\}px`,\s+minWidth: `\$\{CONFIG_PROVIDER_CARD_MIN_WIDTH_PX\}px`,/,
    "Codex provider card should use the 60% shared width constants",
  );
  assert.match(
    codexVisualSource,
    /gridTemplateColumns: "repeat\(auto-fit, minmax\(min\(210px, 100%\), 1fr\)\)"/,
    "Codex provider fields should keep their existing responsive grid",
  );
});
