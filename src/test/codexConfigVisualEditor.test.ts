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
    '\napproval_policy = "on-request"\nsandbox_mode = "workspace-write"\n[model_providers.codex]',
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
  assert.equal(parsed.state.webSearch, "true");
  assert.equal(parsed.state.toolsWebSearch, "true");
  assert.equal(parsed.state.featuresWebSearch, "false");
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
    webSearch: "true",
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
  assert.match(source, /approval_policy: "控制命令执行前的审批策略。"/);
  assert.match(source, /"untrusted"/);
  assert.match(source, /"on-failure"/);
  assert.match(source, /"on-request"/);
  assert.match(source, /"never"/);
  assert.match(source, /sandbox_mode: "控制 Codex CLI 文件系统沙箱范围。"/);
  assert.match(source, /"read-only"/);
  assert.match(source, /"workspace-write"/);
  assert.match(source, /"danger-full-access"/);
  assert.match(source, /wire_api: "Provider 使用的 wire API。可选值：responses \/ chat"/);
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
