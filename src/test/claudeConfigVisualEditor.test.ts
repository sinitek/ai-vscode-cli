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
  const startMarker = "// CLAUDE_VISUAL_EDITOR_UTILS_START";
  const endMarker = "// CLAUDE_VISUAL_EDITOR_UTILS_END";
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker);
  assert.notEqual(start, -1, "Claude visual utility start marker should exist");
  assert.notEqual(end, -1, "Claude visual utility end marker should exist");
  const sandbox: Record<string, unknown> = {};
  vm.runInNewContext(
    `${source.slice(start, end)}\n;globalThis.__utils = ClaudeConfigVisualEditorUtils;`,
    sandbox,
  );
  return sandbox.__utils;
}

function extractClaudeExample(): string {
  const source = loadUiSource();
  const marker = 'claude: {\n      settings: `';
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, "Claude example marker should exist");
  const contentStart = start + marker.length;
  const contentEnd = source.indexOf("`,\n", contentStart);
  assert.notEqual(contentEnd, -1, "Claude example should terminate");
  return source.slice(contentStart, contentEnd);
}

test("loads official core fields and three default model mappings", () => {
  const utils = loadVisualUtils();
  const parsed = utils.parseContent(
    JSON.stringify({
      model: "sonnet",
      fallbackModel: ["opus", "haiku"],
      availableModels: ["sonnet", "opus", "haiku"],
      effortLevel: "high",
      env: {
        ANTHROPIC_DEFAULT_HAIKU_MODEL: "vendor-haiku",
        ANTHROPIC_DEFAULT_SONNET_MODEL: "vendor-sonnet",
        ANTHROPIC_DEFAULT_OPUS_MODEL: "vendor-opus",
      },
    }),
  );

  assert.equal(parsed.ok, true);
  assert.equal(parsed.state.model, "sonnet");
  assert.equal(parsed.state.fallbackModels, "opus\nhaiku");
  assert.equal(parsed.state.availableModels, "sonnet\nopus\nhaiku");
  assert.equal(parsed.state.effortLevel, "high");
  assert.equal(parsed.state.env.ANTHROPIC_DEFAULT_HAIKU_MODEL, "vendor-haiku");
  assert.equal(parsed.state.env.ANTHROPIC_DEFAULT_SONNET_MODEL, "vendor-sonnet");
  assert.equal(parsed.state.env.ANTHROPIC_DEFAULT_OPUS_MODEL, "vendor-opus");
});

test("serializes visual edits without dropping unknown settings", () => {
  const utils = loadVisualUtils();
  let state = utils.createState({
    customVendorSetting: { enabled: true },
    env: { CUSTOM_ENV: "keep", ANTHROPIC_BASE_URL: "https://old.example" },
    permissions: { additionalDirectories: ["../shared"], deny: ["Bash(rm:*)"] },
    hooks: { Stop: [{ hooks: [{ type: "command", command: "echo done" }] }] },
  });
  state = utils.updateState(state, {
    model: "vendor-sonnet",
    fallbackModels: "vendor-opus, vendor-haiku",
    availableModels: "vendor-sonnet\nvendor-opus",
    effortLevel: "max",
    language: "zh-CN",
    outputStyle: "Explanatory",
    autoUpdatesChannel: "stable",
    cleanupPeriodDays: "45",
    alwaysThinkingEnabled: "true",
    includeCoAuthoredBy: "false",
  });
  state = utils.updateEnv(state, "ANTHROPIC_BASE_URL", "https://api.example/v1");
  state = utils.updateEnv(state, "ANTHROPIC_DEFAULT_HAIKU_MODEL", "vendor-haiku");
  state = utils.updateEnv(state, "ANTHROPIC_DEFAULT_SONNET_MODEL", "vendor-sonnet");
  state = utils.updateEnv(state, "ANTHROPIC_DEFAULT_OPUS_MODEL", "vendor-opus");
  state = utils.updatePermissions(state, {
    defaultMode: "acceptEdits",
    allow: "Read\nEdit",
    ask: "Bash(git push:*)",
    deny: "Bash(rm:*)\nRead(./.env)",
  });

  const serialized = utils.serializeState(state);
  assert.equal(serialized.ok, true);
  const config = JSON.parse(serialized.content);
  assert.deepEqual(config.customVendorSetting, { enabled: true });
  assert.deepEqual(config.hooks, {
    Stop: [{ hooks: [{ type: "command", command: "echo done" }] }],
  });
  assert.equal(config.env.CUSTOM_ENV, "keep");
  assert.equal(config.env.ANTHROPIC_BASE_URL, "https://api.example/v1");
  assert.equal(config.env.ANTHROPIC_DEFAULT_HAIKU_MODEL, "vendor-haiku");
  assert.equal(config.env.ANTHROPIC_DEFAULT_SONNET_MODEL, "vendor-sonnet");
  assert.equal(config.env.ANTHROPIC_DEFAULT_OPUS_MODEL, "vendor-opus");
  assert.deepEqual(config.fallbackModel, ["vendor-opus", "vendor-haiku"]);
  assert.deepEqual(config.availableModels, ["vendor-sonnet", "vendor-opus"]);
  assert.equal(config.effortLevel, "max");
  assert.equal(config.cleanupPeriodDays, 45);
  assert.equal(config.alwaysThinkingEnabled, true);
  assert.equal(config.includeCoAuthoredBy, false);
  assert.deepEqual(config.permissions.additionalDirectories, ["../shared"]);
  assert.deepEqual(config.permissions.allow, ["Read", "Edit"]);
  assert.deepEqual(config.permissions.ask, ["Bash(git push:*)"]);
  assert.deepEqual(config.permissions.deny, ["Bash(rm:*)", "Read(./.env)"]);
});

test("rejects invalid JSON and invalid constrained visual values", () => {
  const utils = loadVisualUtils();
  assert.equal(utils.parseContent("[").ok, false);
  assert.equal(utils.parseContent('{"env":[]}').ok, false);

  const tooManyFallbacks = utils.createState({});
  tooManyFallbacks.fallbackModels = "one,two,three,four";
  assert.match(utils.serializeState(tooManyFallbacks).error, /最多支持 3 个/);

  const invalidCleanup = utils.createState({});
  invalidCleanup.cleanupPeriodDays = "0";
  assert.match(utils.serializeState(invalidCleanup).error, /大于等于 1/);
});

test("clearing managed fields preserves unrelated environment and permission keys", () => {
  const utils = loadVisualUtils();
  let state = utils.createState({
    env: { CUSTOM_ENV: "keep", ANTHROPIC_DEFAULT_OPUS_MODEL: "remove" },
    permissions: { additionalDirectories: ["../shared"], allow: ["Read"] },
  });
  state = utils.updateEnv(state, "ANTHROPIC_DEFAULT_OPUS_MODEL", "");
  state = utils.updatePermissions(state, { allow: "" });
  const config = JSON.parse(utils.serializeState(state).content);
  assert.deepEqual(config.env, { CUSTOM_ENV: "keep" });
  assert.deepEqual(config.permissions, { additionalDirectories: ["../shared"] });
});

test("official example and editor expose visual plus JSON modes", () => {
  const example = JSON.parse(extractClaudeExample());
  assert.equal(example.model, "sonnet");
  assert.deepEqual(example.fallbackModel, ["opus", "haiku"]);
  assert.equal(example.effortLevel, "high");
  assert.ok(example.env.ANTHROPIC_DEFAULT_HAIKU_MODEL);
  assert.ok(example.env.ANTHROPIC_DEFAULT_SONNET_MODEL);
  assert.ok(example.env.ANTHROPIC_DEFAULT_OPUS_MODEL);

  const source = loadUiSource();
  assert.match(source, /claudeEditorMode === "visual"/);
  assert.match(source, /switchClaudeEditorMode\("visual"\)/);
  assert.match(source, /switchClaudeEditorMode\("json"\)/);
  assert.match(source, /renderClaudeVisualEditor\(\)/);
  assert.match(source, /claudeText\("可视化", "Visual"\)/);
  assert.match(
    source,
    /~\/\.claude\/settings\.json[\s\S]*?children: "查看范例"[\s\S]*?switchClaudeEditorMode\("visual"\)/,
    "Claude example entry should sit beside the config filename and before mode controls",
  );
  assert.match(source, /Default model family mapping/);
  assert.match(source, /Advanced JSON mode preserves every Claude Code field/);
  assert.match(source, /\.\.\.\["low", "medium", "high", "xhigh", "max"\]\.map/);
});

test("visual labels expose tooltip help and visual mode is never hidden", () => {
  const source = loadUiSource();
  const claudeStart = source.indexOf('className: "config-editor-shell config-editor-claude"');
  const codexStart = source.indexOf('className: "config-editor-shell config-editor-codex"');
  assert.notEqual(claudeStart, -1, "Claude editor branch should exist");
  assert.notEqual(codexStart, -1, "Codex editor branch should exist");
  const claudeBranch = source.slice(claudeStart, codexStart);

  assert.match(source, /renderConfigFieldLabel =/);
  assert.match(source, /children: "\?"/);
  assert.match(source, /title: getConfigFieldHelp\(W, H\)/);
  assert.match(source, /formatConfigEnumHelp\(getConfigFieldHelp\(W, U\.help\)/);
  assert.match(source, /推理强度 effortLevel[\s\S]*?可选值：default \/ acceptEdits \/ plan \/ dontAsk/);
  assert.doesNotMatch(
    claudeBranch,
    /display: claudeEditorMode === "json" \? "flex" : "none"/,
    "Claude visual mode should not be hidden by the JSON container",
  );
});

test("visual editor style stays aligned with OpenCode cards", () => {
  const source = loadUiSource();
  const claudeStart = source.indexOf('className: "config-editor-shell config-editor-claude"');
  const codexStart = source.indexOf('className: "config-editor-shell config-editor-codex"');
  assert.notEqual(claudeStart, -1, "Claude editor branch should exist");
  assert.notEqual(codexStart, -1, "Codex editor branch should exist");
  assert.doesNotMatch(
    source.slice(claudeStart, codexStart),
    /Codex config\.toml 与 \.env/,
    "Claude branch should not contain Codex mode controls",
  );

  const visualRenderStart = source.indexOf("renderClaudeField =");
  const visualRenderEnd = source.indexOf("renderOpenCodeVisualEditor =", visualRenderStart);
  assert.notEqual(visualRenderStart, -1, "Claude visual render start should exist");
  assert.notEqual(visualRenderEnd, -1, "OpenCode visual render marker should follow Claude render helpers");
  const visualSource = source.slice(visualRenderStart, visualRenderEnd);
  assert.match(
    visualSource,
    /gridTemplateColumns: "repeat\(auto-fit, minmax\(min\(240px, 100%\), 1fr\)\)"/,
    "Claude field layout should keep its existing responsive width",
  );
  assert.doesNotMatch(
    visualSource,
    /CONFIG_PROVIDER_CARD_WIDTH_PX|CONFIG_PROVIDER_CARD_MIN_WIDTH_PX/,
    "Claude layout should not use OpenCode/Codex provider card width constants",
  );
  assert.match(visualSource, /be\.jsx\(zi, \{/);
  assert.match(visualSource, /color: "var\(--text-color-secondary\)"[\s\S]*?fontSize: "12px"/);
  assert.match(visualSource, /border: "1px solid var\(--border-color\)"/);
  assert.match(visualSource, /padding: "6px"/);
  assert.doesNotMatch(visualSource, /background: "var\(--background-color-secondary\)"/);
  assert.doesNotMatch(
    visualSource,
    /#[0-9a-f]{3,8}|rgba?\(|hsla?\(/i,
    "Claude visual editor should use theme variables instead of hardcoded colors",
  );
});
