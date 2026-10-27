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

function loadGrokVisualUtils(sandbox: Record<string, unknown> = {}): {
  parseContent: (content: string) => { ok: boolean; error?: string; state: { fieldError?: string; source: Record<string, unknown>; defaultModel?: string; model?: string; envKey?: string; apiBackend?: string } | null };
  updateState: (state: unknown, patch: Record<string, unknown>) => { fieldError: string; source: Record<string, unknown>; model?: string; envKey?: string };
  serializeState: (state: unknown) => { ok: boolean; content?: string; error?: string };
  addModel: (state: unknown, id: string) => { ok: boolean; error?: string; state: unknown };
  deleteModel: (state: unknown, id: string) => unknown;
} {
  const source = read(uiPath);
  const parserStart = source.indexOf("function fk(");
  const parserEnd = source.indexOf("const CLI_GLOBAL_SKILL_TARGETS =");
  const grokStart = source.indexOf("const GROK_VISUAL_FIELD_IDS");
  const grokEnd = source.indexOf("const ps = {");
  assert.ok(parserStart >= 0 && parserEnd > parserStart && grokStart > parserEnd && grokEnd > grokStart);
  vm.runInNewContext(
    `${source.slice(parserStart, parserEnd)}\n${source.slice(grokStart, grokEnd)}\nglobalThis.__grok = GrokConfigVisualEditorUtils;`,
    sandbox,
  );
  return (sandbox as { __grok: never }).__grok as never;
}

type EditorNode = { type: unknown; props: Record<string, any> };

function editorNodes(value: unknown): EditorNode[] {
  if (Array.isArray(value)) return value.flatMap(editorNodes);
  if (!value || typeof value !== "object" || !("props" in value)) return [];
  const node = value as EditorNode;
  return [node, ...editorNodes(node.props.children)];
}

function createGrokVisualEditorHarness() {
  const source = read(uiPath);
  const start = source.indexOf("renderGrokVisualEditor =");
  const end = source.indexOf("renderCodexVisualEditor =", start);
  const confirmations: Record<string, any>[] = [];
  const jsx = (type: unknown, props: Record<string, any>): EditorNode => ({ type, props });
  const sandbox: Record<string, any> = {
    be: { jsx, jsxs: jsx },
    xn: "Button",
    AH: "DeleteIcon",
    xr: { confirm: (options: Record<string, any>) => confirmations.push(options) },
    claudeText: (chinese: string) => chinese,
    renderCodexField: (label: string, value: string, onChange: unknown, placeholder: string, options: Record<string, unknown> = {}) =>
      jsx("Field", { label, value, onChange, placeholder, ...options }),
    renderCodexSelect: () => null,
    renderCodexSection: (_title: string, _description: string, children: unknown) => jsx("Section", { children }),
    grokTextDraft: "",
    grokVisualError: "",
    grokAddModelOpen: false,
    grokNewModelId: "",
    grokModelActionError: "",
    grokNewModelInputRef: { current: { focus: () => { sandbox.focusCount += 1; } } },
    focusCount: 0,
    setGrokAddModelOpen: (value: boolean) => { sandbox.grokAddModelOpen = value; },
    setGrokNewModelId: (value: string) => { sandbox.grokNewModelId = value; },
    setGrokModelActionError: (value: string) => { sandbox.grokModelActionError = value; },
    setGrokVisualState: (value: unknown) => {
      sandbox.grokVisualState = typeof value === "function" ? value(sandbox.grokVisualState) : value;
    },
  };
  const utils = loadGrokVisualUtils(sandbox);
  sandbox.grokVisualState = utils.parseContent(`
[models]
default = "main"
[model.main]
model = "original-api"
name = "Original"
base_url = "https://api.example.com/v1"
api_backend = "chat_completions"
[model.main.custom]
enabled = true
[model.other]
model = "other-api"
`).state;
  assert.ok(start >= 0 && end > start);
  vm.runInContext(`const ${source.slice(start, end).replace(/,\s*$/, ";")}\nglobalThis.__render = renderGrokVisualEditor;`, sandbox);
  const render = () => sandbox.__render() as EditorNode;
  const find = (property: string, value: unknown) => {
    const node = editorNodes(render()).find((candidate) => candidate.props[property] === value);
    assert.ok(node, `Missing ${property}=${value}`);
    return node;
  };
  return { state: sandbox, confirmations, render, find };
}

test("Grok add dialog validates one name, supports cancellation, and sets model without an optional name", () => {
  const harness = createGrokVisualEditorHarness();
  const sidebar = harness.find("className", "grok-model-sidebar");
  assert.equal(editorNodes(sidebar).filter((node) => node.type === "Field").length, 0);
  assert.equal(harness.find("rootClassName", "grok-add-model-modal").props.open, false);
  harness.find("data-testid", "grok-add-model").props.onClick();
  let dialog = harness.find("rootClassName", "grok-add-model-modal");
  assert.equal(dialog.props.open, true);
  assert.equal(dialog.props.okButtonProps.disabled, true);
  dialog.props.afterOpenChange(true);
  assert.equal(harness.state.focusCount, 1);
  dialog.props.onOk();
  assert.match(harness.state.grokModelActionError, /有效且唯一/);
  harness.find("data-testid", "grok-new-model-id").props.onChange("main");
  harness.find("rootClassName", "grok-add-model-modal").props.onOk();
  assert.match(harness.state.grokModelActionError, /已存在/);
  assert.equal(harness.state.grokAddModelOpen, true);
  assert.equal(harness.state.grokVisualState.source.model.main.model, "original-api");

  harness.find("data-testid", "grok-new-model-id").props.onChange("cancelled");
  harness.find("rootClassName", "grok-add-model-modal").props.onCancel();
  assert.equal(harness.state.grokAddModelOpen, false);
  assert.equal(harness.state.grokNewModelId, "");
  assert.equal(harness.state.grokModelActionError, "");
  assert.equal(harness.state.grokVisualState.source.model.cancelled, undefined);

  harness.find("data-testid", "grok-add-model").props.onClick();
  harness.find("data-testid", "grok-new-model-id").props.onChange(" gpt-6.1-sol ");
  harness.find("data-testid", "grok-new-model-id").props.onPressEnter({ nativeEvent: { isComposing: true } });
  assert.equal(harness.state.grokAddModelOpen, true);
  assert.equal(harness.state.grokVisualState.source.model["gpt-6.1-sol"], undefined);
  harness.find("data-testid", "grok-new-model-id").props.onPressEnter({ nativeEvent: { isComposing: false } });
  assert.equal(harness.state.grokAddModelOpen, false);
  const models = harness.state.grokVisualState.source.model;
  const { name: legacyName, ...template } = JSON.parse(JSON.stringify(models.main));
  assert.deepEqual(JSON.parse(JSON.stringify(models["gpt-6.1-sol"])), {
    ...template, model: "gpt-6.1-sol",
  });
  assert.equal(legacyName, "Original");
  assert.equal(models.main.name, "Original");
  assert.equal(models["gpt-6.1-sol"].name, undefined);
  assert.equal(harness.state.grokVisualState.selectedModelId, "gpt-6.1-sol");
  assert.notEqual(models.main.custom, models["gpt-6.1-sol"].custom);
  dialog = harness.find("rootClassName", "grok-add-model-modal");
  assert.equal(dialog.props.open, false);
});

test("Grok row delete icons confirm the clicked model without selecting or deleting another row", () => {
  const harness = createGrokVisualEditorHarness();
  const deleteButton = harness.find("data-grok-delete-model-id", "other");
  assert.equal(deleteButton.props.icon.type, "DeleteIcon");
  assert.equal(deleteButton.props.children, undefined);
  assert.equal(deleteButton.props["aria-label"], "删除模型 other");
  let stopped = false;
  deleteButton.props.onClick({ stopPropagation: () => { stopped = true; } });
  assert.equal(stopped, true);
  assert.equal(harness.state.grokVisualState.selectedModelId, "main");
  assert.equal(harness.confirmations.length, 1);
  assert.match(harness.confirmations[0].content, /other/);
  assert.ok(harness.state.grokVisualState.source.model.other);
  harness.confirmations[0].onOk();
  assert.equal(harness.state.grokVisualState.source.model.other, undefined);
  assert.equal(harness.state.grokVisualState.selectedModelId, "main");
  assert.equal(harness.state.grokVisualState.source.models.default, "main");
  harness.find("data-grok-delete-model-id", "main").props.onClick({ stopPropagation: () => undefined });
  harness.confirmations[1].onOk();
  assert.equal(harness.state.grokVisualState.selectedModelId, "");
  assert.equal(harness.state.grokVisualState.source.models?.default, undefined);
});

test("Grok visual editor adds, switches, edits, and deletes multiple models without rewriting hidden fields", () => {
  const utils = loadGrokVisualUtils();
  const original = utils.parseContent(`
custom_root = "keep"
[models]
default = "grok"
[model.grok]
model = "grok-4.7"
api_key = ""
custom_option = "keep"
[model.empty]
`);
  assert.ok(original.ok);
  const added = utils.addModel(original.state, "gpt-6.1-sol");
  assert.equal(added.ok, true);
  const edited = utils.updateState(added.state, {
    apiBackend: "responses", envKey: "SOL_TEST_KEY", contextWindow: "500000",
  });
  const switched = utils.updateState(edited, { selectedModelId: "grok" });
  assert.equal(switched.model, "grok-4.7");
  const defaulted = utils.updateState(switched, { defaultModel: "gpt-6.1-sol" });
  const serialized = utils.serializeState(defaulted);
  assert.ok(serialized.ok);
  const roundTrip = utils.parseContent(serialized.content!);
  assert.ok(roundTrip.ok);
  const source = roundTrip.state!.source;
  const models = source.model as Record<string, Record<string, unknown>>;
  assert.equal(source.custom_root, "keep");
  assert.equal(models.grok.custom_option, "keep");
  assert.equal(models.grok.api_key, "");
  assert.deepEqual(Object.keys(models.empty), []);
  assert.equal(models["gpt-6.1-sol"].model, "gpt-6.1-sol");
  assert.equal(models["gpt-6.1-sol"].env_key, "SOL_TEST_KEY");
  const emptySelected = utils.updateState(roundTrip.state, { selectedModelId: "empty" });
  assert.ok(Object.prototype.hasOwnProperty.call(emptySelected.source.model, "empty"));
  const deleted = utils.deleteModel(roundTrip.state, "gpt-6.1-sol");
  const afterDelete = utils.parseContent(utils.serializeState(deleted).content!);
  assert.equal(afterDelete.state!.defaultModel, "grok");
  assert.equal(Object.prototype.hasOwnProperty.call(afterDelete.state!.source.model, "gpt-6.1-sol"), false);
  const lastDeleted = utils.deleteModel(utils.deleteModel(deleted, "empty"), "grok");
  const emptyRoundTrip = utils.parseContent(utils.serializeState(lastDeleted).content!);
  assert.equal(emptyRoundTrip.state!.defaultModel, "");
});

test("Grok multi-model actions reject duplicate, empty, reserved, and invalid edits", () => {
  const utils = loadGrokVisualUtils();
  const state = utils.parseContent('[model.grok]\nmodel = "grok"').state;
  for (const modelId of ["", " ", "__proto__", "constructor", "grok"]) {
    const added = utils.addModel(state, modelId);
    assert.equal(added.ok, false);
    assert.equal(added.state, state);
  }
  const invalid = utils.updateState(state, { contextWindow: "-1" });
  assert.ok(invalid.fieldError);
  assert.equal(utils.addModel(invalid, "gpt-6.1-sol").ok, false);
  assert.equal(utils.deleteModel(invalid, "grok"), invalid);
  assert.equal(utils.deleteModel(state, "missing"), state);
  assert.match(read(uiPath), /claudeText\("模型名称", "Model name"\)/);
  assert.match(read(uiPath), /"data-grok-delete-model-id": modelId/);
});

test("Grok new models deep-copy settings except optional name and replace model", () => {
  const utils = loadGrokVisualUtils();
  const initial = utils.parseContent(`
[models]
default = "default"
[model.default]
model = "default-api"
base_url = "https://default.example.com/v1"
[model.selected]
model = "source-api"
name = "Source model"
base_url = "https://selected.example.com/v1"
api_key = "fixture-not-a-secret"
api_backend = "chat_completions"
env_key = "MODEL_KEY"
context_window = 500000
reasoning_efforts = [{ value = "low", name = "Low" }]
[model.selected.custom]
enabled = true
`);
  assert.ok(initial.ok);
  const selected = utils.updateState(initial.state, { selectedModelId: "selected" });
  const added = utils.addModel(selected, "gpt-6.1-sol");
  assert.ok(added.ok);
  const roundTrip = utils.parseContent(utils.serializeState(added.state).content!);
  assert.ok(roundTrip.ok);
  const models = roundTrip.state!.source.model as Record<string, Record<string, unknown>>;
  const { name: legacyName, ...template } = JSON.parse(JSON.stringify(models.selected));
  assert.deepEqual(JSON.parse(JSON.stringify(models["gpt-6.1-sol"])), {
    ...template, model: "gpt-6.1-sol",
  });
  assert.equal(legacyName, "Source model");
  assert.equal(models.selected.name, "Source model");
  assert.equal(models["gpt-6.1-sol"].name, undefined);
  const addedModels = (added.state as { source: { model: Record<string, Record<string, unknown>> } }).source.model;
  assert.notEqual(addedModels.selected.custom, addedModels["gpt-6.1-sol"].custom);
  assert.notEqual(addedModels.selected.reasoning_efforts, addedModels["gpt-6.1-sol"].reasoning_efforts);
  (addedModels["gpt-6.1-sol"].custom as { enabled: boolean }).enabled = false;
  assert.equal((addedModels.selected.custom as { enabled: boolean }).enabled, true);
  assert.equal((initial.state!.source.model as Record<string, Record<string, unknown>>)["gpt-6.1-sol"], undefined);

  const fallback = utils.addModel({ ...selected, selectedModelId: "missing" }, "fallback");
  const fallbackModels = (fallback.state as { source: { model: Record<string, Record<string, unknown>> } }).source.model;
  assert.equal(fallbackModels.fallback.base_url, "https://default.example.com/v1");
  const empty = utils.parseContent('[models]\ndefault_reasoning_effort = "low"');
  const first = utils.addModel(empty.state, "first");
  assert.ok(first.ok);
  const firstModels = (first.state as { source: { model: Record<string, Record<string, unknown>> } }).source.model;
  assert.deepEqual(JSON.parse(JSON.stringify(firstModels.first)), { model: "first" });
});

test("Grok visual editor uses a model list beside details instead of a selected-model dropdown", () => {
  const source = read(uiPath);
  const editor = source.slice(source.indexOf("renderGrokVisualEditor ="), source.indexOf("renderCodexVisualEditor ="));
  assert.match(editor, /className: "grok-model-workspace"/);
  assert.match(editor, /className: "grok-model-sidebar"/);
  assert.match(editor, /className: "grok-model-detail"/);
  assert.match(editor, /"data-grok-model-id": modelId/);
  assert.match(editor, /"aria-pressed": modelId === selectedId/);
  assert.doesNotMatch(editor, /claudeText\("当前模型", "Selected model"\)/);
});

test("Grok visual edits preserve legacy names without exposing or generating the optional field", () => {
  const utils = loadGrokVisualUtils();
  const initial = utils.parseContent(`
[models]
default = "legacy"
[model.legacy]
model = "original-api"
name = "  Legacy label  "
[model.legacy.custom]
name = "Nested name"
[model.unnamed]
model = "unnamed-api"
`);
  assert.ok(initial.ok);
  const edited = utils.updateState(initial.state, { model: "updated-api" });
  const unnamed = utils.updateState(edited, { selectedModelId: "unnamed" });
  const updated = utils.updateState(unnamed, { baseUrl: "https://api.example.com/v1" });
  const roundTrip = utils.parseContent(utils.serializeState(updated).content!);
  assert.ok(roundTrip.ok);
  const models = roundTrip.state!.source.model as Record<string, Record<string, unknown>>;
  assert.equal(models.legacy.name, "  Legacy label  ");
  assert.equal(models.legacy.model, "updated-api");
  assert.equal((models.legacy.custom as Record<string, unknown>).name, "Nested name");
  assert.equal(models.unnamed.name, undefined);
  assert.equal(models.unnamed.base_url, "https://api.example.com/v1");
  const harness = createGrokVisualEditorHarness();
  assert.equal(editorNodes(harness.render()).some((node) => node.type === "Field" && node.props.placeholder === "name"), false);
  const source = read(uiPath);
  const grokUtilities = source.slice(source.indexOf("const GROK_VISUAL_FIELD_IDS"), source.indexOf("const ps = {"));
  assert.doesNotMatch(grokUtilities, /"model\.name"|name: grokVisualReadString|"name", nextFields\.name/);
});

test("Grok config example omits optional model names and stays editable", () => {
  const source = read(uiPath);
  const start = source.indexOf("const ps = {");
  const end = source.indexOf("const Nk =", start);
  const examples = source.slice(start, end);
  const match = examples.slice(examples.indexOf("grok: {")).match(/config: `([\s\S]*?)`/);
  assert.ok(match);
  const utils = loadGrokVisualUtils();
  const parsed = utils.parseContent(match[1]);
  assert.ok(parsed.ok);
  const models = parsed.state!.source.model as Record<string, Record<string, unknown>>;
  assert.equal(models["grok-4.7"].model, "grok-4.7");
  assert.equal(models["grok-4.7"].name, undefined);
  const updated = utils.updateState(parsed.state, { model: "gpt-6.1-sol" });
  const saved = utils.serializeState(updated);
  assert.ok(saved.ok);
  assert.doesNotMatch(saved.content!, /^name\s*=/m);
});

test("config page bundle keeps Grok after OpenCode and preserves old order archives", () => {
  const uiSource = read(uiPath);
  const storeSource = read(storePath);
  const listPanel = uiSource.slice(uiSource.indexOf("// Config list panel"), uiSource.indexOf("const CLI_GLOBAL_SKILL_TARGETS ="));
  const claudeCard = listPanel.indexOf('H("claude", $)');
  const codexCard = listPanel.indexOf('H("codex", w)');
  const openCodeCard = listPanel.indexOf('H("opencode", O)');
  const grokCard = listPanel.indexOf('H("grok", grokConfigs)');
  const dshCard = listPanel.indexOf('H("dsh", dshConfigs)');
  assert.ok(claudeCard >= 0 && codexCard > claudeCard && openCodeCard > codexCard && grokCard > openCodeCard && dshCard > grokCard);
  assert.match(storeSource, /activeConfigIds: createEmptyActiveIds\(\)/);
  assert.doesNotMatch(listPanel, /gemini/);

  const { utils, storage } = loadStoreUtilities();
  assert.deepEqual(JSON.parse(JSON.stringify(utils.createEmptyOrder())), {
    claude: [],
    codex: [],
    opencode: [],
    grok: [],
    dsh: [],
    "kimi-code": [],
  });
  storage.set(
    "ai_cli_config_order",
    JSON.stringify({ claude: ["c1", "c2"], codex: ["x"], opencode: ["o1"] }),
  );
  assert.deepEqual(JSON.parse(JSON.stringify(utils.loadStoredOrder())), {
    claude: ["c1", "c2"],
    codex: ["x"],
    opencode: ["o1"],
    grok: [],
    dsh: [],
    "kimi-code": [],
  });
  assert.deepEqual(
    JSON.parse(JSON.stringify(utils.appendOrderForConfigs([{ id: "g1", platform: "grok" }], {
      claude: ["c1"],
      codex: ["x"],
      opencode: ["o1"],
    }))),
    { claude: ["c1"], codex: ["x"], opencode: ["o1"], grok: ["g1"], dsh: [], "kimi-code": [] },
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

[model."grok-4.7"]
model = "grok-4.7"
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
    defaultModel: "grok-4.7",
    apiBackend: "messages",
    envKey: "NOT A SECRET",
  });
  assert.match(updated.fieldError, /env_key/);
  const valid = utils.updateState(parsed.state, {
    defaultModel: "grok-4.7",
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
