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
  const startMarker = "// OPENCODE_VISUAL_EDITOR_UTILS_START";
  const endMarker = "// OPENCODE_VISUAL_EDITOR_UTILS_END";
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker);
  assert.notEqual(start, -1, "visual utility start marker should exist");
  assert.notEqual(end, -1, "visual utility end marker should exist");
  const sandbox: Record<string, unknown> = {};
  vm.runInNewContext(
    `${source.slice(start, end)}\n;globalThis.__utils = OpenCodeConfigVisualEditorUtils;`,
    sandbox,
  );
  return sandbox.__utils;
}

function extractOpenCodeExample(): string {
  const source = loadUiSource();
  const marker = 'opencode: {\n      settings: `';
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, "OpenCode example marker should exist");
  const contentStart = start + marker.length;
  const contentEnd = source.indexOf("`,\n", contentStart);
  assert.notEqual(contentEnd, -1, "OpenCode example should terminate");
  return source.slice(contentStart, contentEnd);
}

test("visual parser loads current myAPI example and roles", () => {
  const utils = loadVisualUtils();
  const parsed = utils.parseContent(extractOpenCodeExample());
  assert.equal(parsed.ok, true);
  assert.equal(parsed.state.providers.length, 1);
  const provider = parsed.state.providers[0];
  assert.equal(provider.id, "myAPI");
  assert.equal(provider.npm, "@ai-sdk/openai-compatible");
  assert.deepEqual(
    Array.from(provider.models, (model: any) => [model.id, model.name, model.efforts]),
    [
      ["main-chat-model", "Main Chat Model", "medium, low, high"],
      ["small-task-model", "Small Task Model", "low, high"],
    ],
  );
  assert.equal(parsed.state.primaryModel, "myAPI/main-chat-model");
  assert.equal(parsed.state.smallModel, "myAPI/small-task-model");
});

test("visual editor exposes official provider adapters and full reasoning efforts", () => {
  const utils = loadVisualUtils();
  assert.deepEqual(
    Array.from(utils.providerNpmOptions, (option: any) => option.value),
    [
      "@ai-sdk/openai-compatible",
      "@ai-sdk/openai",
      "@ai-sdk/anthropic",
      "@ai-sdk/google",
    ],
  );
  assert.deepEqual(
    Array.from(utils.reasoningEffortOptions),
    ["low", "medium", "high", "xhigh", "max"],
  );

  const source = loadUiSource();
  assert.match(source, /renderOpenCodeSelect\([\s\S]*?"npm"[\s\S]*?OPEN_CODE_PROVIDER_NPM_OPTIONS/);
  assert.match(source, /renderOpenCodeMultiSelect = \([\s\S]*?mode: "multiple"/);
  assert.match(source, /renderOpenCodeMultiSelect\([\s\S]*?OPEN_CODE_REASONING_EFFORT_OPTIONS\.map/);
  assert.match(source, /Google \(@ai-sdk\/google\)/);
});

test("provider and model operations add edit delete and preserve selection", () => {
  const utils = loadVisualUtils();
  let state = utils.createState({});
  state = utils.addProvider(state);
  assert.equal(state.providers[0].npm, "@ai-sdk/openai-compatible");
  const providerId = state.providers[0].id;
  state = utils.updateProvider(state, providerId, {
    name: "Gateway",
    npm: "@ai-sdk/openai",
    baseURL: "{env:BASE_URL}",
    apiKey: "{env:API_KEY}",
  });
  state = utils.addModel(state, providerId);
  const modelId = state.providers[0].models[0].id;
  state = utils.updateModel(state, providerId, modelId, {
    name: "Gateway Model",
    reasoning: true,
  });
  assert.equal(state.providers[0].name, "Gateway");
  assert.equal(state.providers[0].models[0].name, "Gateway Model");
  state = utils.deleteModel(state, providerId, modelId);
  assert.equal(state.providers[0].models.length, 0);
  state = utils.deleteProvider(state, providerId);
  assert.equal(state.providers.length, 0);
});

test("provider and model id renames synchronize exact role references", () => {
  const utils = loadVisualUtils();
  let state = utils.createState({
    model: "old/main",
    small_model: "old/small",
    provider: {
      old: { models: { main: { name: "Main" }, small: { name: "Small" } } },
    },
  });
  state = utils.updateProvider(state, "old", { id: "renamed" });
  assert.equal(state.primaryModel, "renamed/main");
  assert.equal(state.smallModel, "renamed/small");
  state = utils.updateModel(state, "renamed", "main", { id: "primary" });
  assert.equal(state.primaryModel, "renamed/primary");
  assert.equal(state.smallModel, "renamed/small");
});

test("comma efforts deduplicate and generate options plus variants", () => {
  const utils = loadVisualUtils();
  const model = utils.applyEfforts(
    {
      options: { temperature: 0.2, reasoningEffort: "old" },
      variants: {
        old: { reasoningEffort: "old" },
        custom: { reasoningEffort: "legacy", temperature: 0.4 },
        untouched: { label: "keep" },
      },
    },
    " low, medium, low, high,  ",
  );
  assert.equal(model.options.reasoningEffort, "low");
  assert.equal(model.options.temperature, 0.2);
  assert.deepEqual(Object.keys(model.variants), ["custom", "untouched", "low", "medium", "high"]);
  assert.equal(model.variants.low.reasoningEffort, "low");
  assert.equal(model.variants.medium.reasoningEffort, "medium");
  assert.equal(model.variants.high.reasoningEffort, "high");
  assert.equal(model.variants.custom.temperature, 0.4);
  assert.equal(model.variants.custom.reasoningEffort, "legacy");
  assert.equal(model.variants.untouched.label, "keep");

  const cleared = utils.applyEfforts(model, "");
  assert.equal(cleared.options.reasoningEffort, undefined);
  assert.equal(cleared.options.temperature, 0.2);
  assert.deepEqual(Object.keys(cleared.variants), ["custom", "untouched"]);
  assert.equal(cleared.variants.custom.reasoningEffort, "legacy");
});

test("serialization preserves unknown top provider and model fields", () => {
  const utils = loadVisualUtils();
  const original = {
    $schema: "https://opencode.ai/config.json",
    permission: { edit: "ask" },
    mcp: { local: { enabled: false } },
    provider: {
      custom: {
        name: "Custom",
        npm: "@ai-sdk/openai-compatible",
        customProviderField: { keep: true },
        options: { baseURL: "old", timeout: 5000 },
        models: {
          alpha: {
            name: "Alpha",
            reasoning: true,
            customModelField: "keep",
            options: { reasoningEffort: "medium", temperature: 0.7 },
          },
        },
      },
    },
    model: "custom/alpha",
  };
  let state = utils.createState(original);
  state = utils.updateProvider(state, "custom", { baseURL: "new" });
  state = utils.updateModel(state, "custom", "alpha", { efforts: "high, low" });
  const serialized = utils.serializeState(state);
  assert.equal(serialized.ok, true);
  assert.deepEqual(JSON.parse(JSON.stringify(serialized.config.permission)), original.permission);
  assert.deepEqual(JSON.parse(JSON.stringify(serialized.config.mcp)), original.mcp);
  const provider = serialized.config.provider.custom;
  assert.deepEqual(JSON.parse(JSON.stringify(provider.customProviderField)), { keep: true });
  assert.equal(provider.options.timeout, 5000);
  assert.equal(provider.options.baseURL, "new");
  assert.equal(provider.models.alpha.customModelField, "keep");
  assert.equal(provider.models.alpha.options.temperature, 0.7);
  assert.equal(provider.models.alpha.options.reasoningEffort, "high");
});

test("dangling model roles block serialization after deletion", () => {
  const utils = loadVisualUtils();
  let state = utils.createState({
    model: "myAPI/main",
    small_model: "myAPI/small",
    provider: {
      myAPI: { models: { main: { name: "Main" }, small: { name: "Small" } } },
    },
  });
  state = utils.deleteModel(state, "myAPI", "main");
  const serialized = utils.serializeState(state);
  assert.equal(serialized.ok, false);
  assert.match(serialized.error, /主模型引用/);
  assert.match(serialized.error, /请重新选择模型/);
});

test("invalid JSON cannot become an empty visual save", () => {
  const utils = loadVisualUtils();
  const parsed = utils.parseContent('{"provider":');
  assert.equal(parsed.ok, false);
  assert.match(parsed.error, /JSON 无法加载到可视化编辑器/);
  const serialized = utils.serializeState(parsed.state);
  assert.equal(serialized.ok, false);
  assert.match(serialized.error, /切换到 JSON 模式修复/);
});

test("JSON and visual state round-trip while save flow calls save then apply", async () => {
  const utils = loadVisualUtils();
  const parsed = utils.parseContent(extractOpenCodeExample());
  assert.equal(parsed.ok, true);
  let state = utils.updateModel(parsed.state, "myAPI", "main-chat-model", {
    name: "Renamed Main",
    efforts: "high, medium, high",
  });
  state = utils.setRole(state, "myAPI", "main-chat-model", "small", true);
  const serialized = utils.serializeState(state);
  assert.equal(serialized.ok, true);
  const reparsed = utils.parseContent(serialized.content);
  assert.equal(reparsed.ok, true);
  assert.equal(reparsed.state.providers[0].models[0].name, "Renamed Main");
  assert.equal(reparsed.state.providers[0].models[0].efforts, "high, medium");
  assert.equal(reparsed.state.smallModel, "myAPI/main-chat-model");

  const calls: string[] = [];
  await utils.runSaveFlow({
    content: serialized.content,
    saveConfig: async (content: string) => calls.push(`save:${JSON.parse(content).model}`),
    applyActiveConfig: async (content: string) => calls.push(`apply:${JSON.parse(content).model}`),
  });
  assert.deepEqual(calls, ["save:myAPI/main-chat-model", "apply:myAPI/main-chat-model"]);
  assert.match(loadUiSource(), /saveOpenCodeSettingsCard[\s\S]*openCodeVisualRunSaveFlow/);
});

test("visual editor keeps sensitive input and narrow layouts usable", () => {
  const source = loadUiSource();
  assert.match(
    source,
    /renderOpenCodeField\("API Key",[\s\S]*?\{ type: "password" \}\)/,
    "API Key should remain a password input",
  );
  assert.match(
    source,
    /renderOpenCodeVisualEditor[\s\S]*?flexWrap: "wrap"[\s\S]*?flex: "1 1 420px"/,
    "provider and editor columns should wrap at narrow widths",
  );
  assert.match(source, /const CONFIG_PROVIDER_CARD_ORIGINAL_WIDTH_PX = 220;/);
  assert.match(source, /const CONFIG_PROVIDER_CARD_WIDTH_SCALE = 0\.6;/);
  const openCodeStart = source.indexOf("renderOpenCodeVisualEditor = () =>");
  const openCodeEnd = source.indexOf("selectedCodexProvider =", openCodeStart);
  assert.notEqual(openCodeStart, -1, "OpenCode visual editor should exist");
  assert.notEqual(openCodeEnd, -1, "OpenCode visual editor should terminate before Codex state");
  const openCodeVisualSource = source.slice(openCodeStart, openCodeEnd);
  assert.equal(
    (openCodeVisualSource.match(/width: `\$\{CONFIG_PROVIDER_CARD_WIDTH_PX\}px`,\s+minWidth: `\$\{CONFIG_PROVIDER_CARD_MIN_WIDTH_PX\}px`,/g) || []).length,
    2,
    "OpenCode provider and model list cards should use the 60% shared width constants",
  );
  assert.match(
    source,
    /config\.json[\s\S]*?children: "查看范例"[\s\S]*?switchOpenCodeEditorMode\("visual"\)/,
    "OpenCode example entry should remain beside the config filename",
  );
  assert.match(source, /renderConfigFieldLabel =/);
  assert.match(source, /children: "\?"/);
  assert.match(source, /思考力度: "该模型支持的 reasoning effort，可多选。可选值：low \/ medium \/ high \/ xhigh \/ max"/);
  assert.match(
    source,
    /display: "flex",\s+gap: "6px",\s+flexWrap: "wrap",\s+flex: 1,\s+minHeight: 260/,
    "model list and model form should wrap at narrow widths",
  );
  assert.doesNotMatch(
    openCodeVisualSource,
    /width: "220px",\s+minWidth: "190px"/,
    "OpenCode model list should no longer use the original full-width card sizing",
  );
  assert.match(
    openCodeVisualSource,
    /Provider 配置[\s\S]*?gridTemplateColumns: "repeat\(auto-fit, minmax\(min\(210px, 100%\), 1fr\)\)"/,
    "OpenCode provider configuration form should keep its existing responsive grid",
  );
  assert.match(source, /flex: "1 1 360px"/, "model form should keep a flexible narrow-width basis");
  const visualRenderStart = source.indexOf("renderOpenCodeField =");
  const visualRenderEnd = source.indexOf("\n    return O", visualRenderStart);
  assert.notEqual(visualRenderStart, -1, "visual render start should exist");
  assert.notEqual(visualRenderEnd, -1, "visual render end should exist");
  assert.doesNotMatch(
    source.slice(visualRenderStart, visualRenderEnd),
    /#[0-9a-f]{3,8}|rgba?\(|hsla?\(/i,
    "visual editor should use theme variables instead of hardcoded colors",
  );
  assert.match(
    source.slice(visualRenderStart, visualRenderEnd),
    /border: "1px solid var\(--border-color\)"[\s\S]*?padding: "6px"/,
    "OpenCode visual card density should remain the style baseline",
  );
  assert.match(
    source.slice(visualRenderStart, visualRenderEnd),
    /renderOpenCodeField[\s\S]*?color: "var\(--text-color-secondary\)"[\s\S]*?fontSize: "12px"/,
    "OpenCode field labels should keep compact secondary styling",
  );
});
