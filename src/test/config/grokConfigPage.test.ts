import assert = require("node:assert/strict");
import * as fs from "node:fs";
import * as path from "node:path";
import test = require("node:test");
import * as vm from "node:vm";

const storePath = path.join(process.cwd(), "media", "config", "assets", "config-app-store.js");
const uiPath = path.join(process.cwd(), "media", "config", "assets", "config-app-ui.js");

function read(filePath: string): string {
  return fs.readFileSync(filePath, "utf8");
}

function loadStoreUtilities(): { utils: Record<string, (...args: unknown[]) => unknown>; storage: Map<string, string> } {
  const source = read(storePath);
  const start = source.indexOf("const CONFIG_STORAGE_KEYS =");
  const end = source.indexOf("// Config store");
  const utilitySource = source.slice(start, end).replace(/,\s*$/, ";");
  const storage = new Map<string, string>();
  const sandbox: Record<string, unknown> = {
    console: { error: () => undefined },
    localStorage: {
      getItem: (key: string) => (storage.has(key) ? storage.get(key) ?? null : null),
      setItem: (key: string, value: string) => storage.set(key, String(value)),
      removeItem: (key: string) => storage.delete(key),
    },
  };
  vm.runInNewContext(
    `${utilitySource}
globalThis.__store = {
  createEmptyOrder,
  loadStoredOrder,
  appendOrderForConfigs,
};`,
    sandbox,
  );
  return { utils: (sandbox as { __store: { utils: never } }).__store as never, storage };
}

function loadGrokVisualUtils(): {
  parseContent: (content: string) => { ok: boolean; error?: string; state: { fieldError?: string; source: Record<string, unknown>; defaultModel?: string; model?: string; envKey?: string; apiBackend?: string } | null };
  updateState: (state: unknown, patch: Record<string, unknown>) => { fieldError: string; source: Record<string, unknown>; model?: string; envKey?: string };
  serializeState: (state: unknown) => { ok: boolean; content?: string; error?: string };
} {
  const source = read(uiPath);
  const parserStart = source.indexOf("function fk(");
  const parserEnd = source.indexOf("const { Paragraph: p1, Text: _k, Title: Mk } = lc;");
  const grokStart = source.indexOf("const GROK_VISUAL_FIELD_IDS");
  const grokEnd = source.indexOf("const ps = {");
  assert.ok(parserStart >= 0 && parserEnd > parserStart && grokStart > parserEnd && grokEnd > grokStart);
  const sandbox: Record<string, unknown> = {};
  vm.runInNewContext(
    `${source.slice(parserStart, parserEnd)}\n${source.slice(grokStart, grokEnd)}\nglobalThis.__grok = GrokConfigVisualEditorUtils;`,
    sandbox,
  );
  return (sandbox as { __grok: never }).__grok as never;
}

test("config page bundle keeps Grok after OpenCode and preserves old order archives", () => {
  const uiSource = read(uiPath);
  const storeSource = read(storePath);
  const listPanel = uiSource.slice(uiSource.indexOf("// Config list panel"), uiSource.indexOf("const jv ="));
  const claudeCard = listPanel.indexOf('H("claude", $)');
  const codexCard = listPanel.indexOf('H("codex", w)');
  const openCodeCard = listPanel.indexOf('H("opencode", O)');
  const grokCard = listPanel.indexOf('H("grok", grokConfigs)');
  assert.ok(claudeCard >= 0 && codexCard > claudeCard && openCodeCard > codexCard && grokCard > openCodeCard);
  assert.match(storeSource, /activeConfigIds: \{ claude: null, codex: null, opencode: null, grok: null \}/);
  assert.doesNotMatch(listPanel, /gemini/);

  const { utils, storage } = loadStoreUtilities();
  assert.deepEqual(JSON.parse(JSON.stringify(utils.createEmptyOrder())), { claude: [], codex: [], opencode: [], grok: [] });
  storage.set(
    "ai_cli_config_order",
    JSON.stringify({ claude: ["c1", "c2"], codex: ["x"], opencode: ["o1"] }),
  );
  assert.deepEqual(JSON.parse(JSON.stringify(utils.loadStoredOrder())), {
    claude: ["c1", "c2"],
    codex: ["x"],
    opencode: ["o1"],
    grok: [],
  });
  assert.deepEqual(
    JSON.parse(JSON.stringify(utils.appendOrderForConfigs([{ id: "g1", platform: "grok" }], {
      claude: ["c1"],
      codex: ["x"],
      opencode: ["o1"],
    }))),
    { claude: ["c1"], codex: ["x"], opencode: ["o1"], grok: ["g1"] },
  );
});

test("Grok visual mode maps only the documented config.toml fields and keeps hidden values", () => {
  const uiSource = read(uiPath);
  const visualStart = uiSource.indexOf("renderGrokVisualEditor = () =>");
  const visualEnd = uiSource.indexOf("renderCodexVisualEditor = () =>", visualStart);
  assert.notEqual(visualStart, -1);
  assert.ok(visualEnd > visualStart);
  const visual = uiSource.slice(visualStart, visualEnd);
  for (const field of [
    "models.default",
    "models.default_reasoning_effort",
    "model.model",
    "model.name",
    "model.base_url",
    "model.api_key",
    "model.api_backend",
    "model.env_key",
    "model.context_window",
    "model.reasoning_summary",
    "model.compaction_at_tokens",
  ]) {
    assert.match(uiSource.slice(uiSource.indexOf("const GROK_VISUAL_FIELD_IDS"), visualEnd), new RegExp(field.replace(/\./g, "\\.")));
    assert.match(visual, /data-grok-fields/);
  }
  assert.match(visual, /chat_completions/);
  assert.match(visual, /responses/);
  assert.match(visual, /messages/);
  assert.match(visual, /none/);
  assert.match(visual, /auto/);
  assert.match(visual, /concise/);
  assert.match(visual, /detailed/);
  assert.match(visual, /只写环境变量名，不写密钥值。/);
  assert.match(visual, /API Key/);
  assert.match(visual, /写入 \[model\.<id>\]\.api_key/);
  assert.match(visual, /renderCodexField\(/);
  assert.match(visual, /renderCodexSelect\(/);
  assert.match(visual, /renderConfigFieldLabel|renderCodexField/);
  assert.match(uiSource, /disabled: grokSaveDisabled/);
  assert.match(uiSource, /configListLoading/);
  assert.match(uiSource, /GROK_EMPTY_TEXT_ERROR/);
  assert.match(uiSource, /className: "config-editor-shell config-editor-grok"/);
  assert.match(uiSource, /配置文件路径: ~\/\.grok\/config\.toml/);
  assert.match(uiSource, /children: "查看范例"/);

  const utils = loadGrokVisualUtils();
  const original = `[models]
default = "old"
default_reasoning_effort = "low"

[model."grok-4.7-kedaya"]
model = "grok-4.7-kedaya"
name = "Kedaya"
base_url = "http://127.0.0.1:33391/v1"
api_key = ""
api_backend = "responses"
env_key = "XAI_API_KEY"
context_window = 500000
reasoning_summary = "auto"
compaction_at_tokens = 450000
custom_note = "keep"
service_tier = "fast"

[projects."/workspace"]
trust_level = "trusted"
`;
  const parsed = utils.parseContent(original);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.state?.fieldError || "", "");
  const updated = utils.updateState(parsed.state, {
    defaultModel: "grok-4.7-kedaya",
    apiBackend: "messages",
    envKey: "NOT A SECRET",
  });
  assert.match(updated.fieldError, /env_key/);
  const valid = utils.updateState(parsed.state, {
    defaultModel: "grok-4.7-kedaya",
    defaultReasoningEffort: "xhigh",
    apiBackend: "messages",
    envKey: "XAI_API_KEY",
  });
  assert.equal(valid.fieldError, "");
  const serialized = utils.serializeState(valid);
  assert.equal(serialized.ok, true);
  assert.match(serialized.content || "", /custom_note = "keep"/);
  assert.match(serialized.content || "", /service_tier = "fast"/);
  assert.match(serialized.content || "", /trust_level = "trusted"/);
  assert.match(serialized.content || "", /api_backend = "messages"/);
  assert.match(serialized.content || "", /api_key = ""/);
  assert.doesNotMatch(serialized.content || "", /wire_api|requires_openai_auth|disable_response_storage/);

  const empty = utils.parseContent(" \n");
  assert.equal(empty.ok, false);
  assert.equal(utils.serializeState(parsed.state).ok, true);
  const invalid = utils.parseContent("[[[");
  assert.equal(invalid.ok, false);
  assert.equal(invalid.state, null);
});
