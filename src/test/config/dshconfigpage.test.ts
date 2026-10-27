import assert = require("node:assert/strict");
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import test = require("node:test");
import * as vm from "node:vm";
import { commitDshDocument, createDshExampleProfileText, serializeDshPatchYaml } from "../../cli/dshConfigModels";
import { applyConfig, getConfigById, saveConfig } from "../../config/configService";
import { readDshActivation, readDshActiveProfileText, resolveDshConfigPaths } from "../../config/dshConfig";

const storePath = path.join(process.cwd(), "media", "config", "assets", "config-app-store.js");
const apiPath = path.join(process.cwd(), "media", "config", "assets", "config-app-api.js");
const uiPath = path.join(process.cwd(), "media", "config", "assets", "config-app-ui.js");

function read(filePath: string): string {
  return fs.readFileSync(filePath, "utf8");
}

function loadStoreUtilities(): { utils: Record<string, any>; storage: Map<string, string> } {
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
  CONFIG_STORAGE_KEYS,
  storeJson,
  createEmptyOrder,
  loadStoredOrder,
  appendOrderForConfigs,
  mergeOrderWithConfigs,
  configManagerPlatforms,
};`,
    sandbox,
  );
  return { utils: (sandbox as { __store: Record<string, any> }).__store, storage };
}

function loadDshPageUtils(): {
  createProfileText: (baseURL?: string) => string;
  readDocument: (content: string) => {
    ok: boolean;
    error: string;
    content: string;
    document: {
      baseURL: string;
      api: string;
      models: Array<{ id: string; name?: string; contextWindow?: number; maxTokens?: number }>;
      acpModel: string;
      apiKeyEnv: string;
      apiKey?: string;
    } | null;
    fields: { provider: string; baseURL: string; modelId: string; apiKeyEnv: string; models: string[]; acpModel: string };
  };
  containsSecret: (value: string) => boolean;
  containsProfileSecret: (value: string) => boolean;
      updateModelId: (document: unknown, previousId: string, nextId: string) => { ok: boolean; error: string; document: any; content: string };
      updateModelName: (document: unknown, modelId: string, value: string) => { ok: boolean; error: string; document: any; content: string };
      updateModelContextWindow: (document: unknown, modelId: string, value: string) => { ok: boolean; error: string; document: any; content: string };
      addModel: (document: unknown, rawId?: string) => { ok: boolean; error: string; document: any; content: string };
  deleteModel: (document: unknown, id: string) => { ok: boolean; error: string; document: any; content: string };
  setAcpModel: (document: unknown, id: string) => { ok: boolean; error: string; document: any; content: string };
  updateApiKeyEnv: (document: unknown, value: string) => { ok: boolean; error: string; document: any; content: string };
  updateBaseUrl: (document: unknown, value: string) => { ok: boolean; error: string; document: any; content: string };
  updateApi: (document: unknown, value: string) => { ok: boolean; error: string; document: any; content: string };
  switchMode: (input: { mode: string; nextMode: string; text: string; document: unknown }) => {
    ok: boolean;
    error: string;
    mode: string;
    text: string;
    document: any;
  };
  modelId: string;
  apiKeyEnv: string;
  provider: string;
  supportsMultipleModels: boolean;
} {
  const source = read(uiPath);
  const start = source.indexOf("const DSH_UI_PROVIDER");
  const end = source.indexOf("const CONFIG_FIELD_HELP_TOOLTIP_TITLE_FALLBACK_DELAY_MS");
  assert.ok(start >= 0 && end > start);
  const sandbox: Record<string, unknown> = { URL };
  vm.runInNewContext(`${source.slice(start, end)}\nglobalThis.__dsh = DshConfigPageUtils;`, sandbox);
  return (sandbox as { __dsh: never }).__dsh as never;
}

function loadConfigImportNormalizer(): (item: Record<string, unknown>) => Record<string, unknown> | null {
  const source = read(uiPath);
  const helperStart = source.indexOf("const DSH_UI_PROVIDER");
  const helperEnd = source.indexOf("const CONFIG_FIELD_HELP_TOOLTIP_TITLE_FALLBACK_DELAY_MS");
  const start = source.indexOf("      normalizeImportItem =");
  const end = source.indexOf("      handleImportFile =", start);
  assert.ok(helperStart >= 0 && helperEnd > helperStart && start >= 0 && end > start);
  const functionSource = source.slice(start, end)
    .replace("      normalizeImportItem = (k) => {", "function normalizeImportItem(k) {")
    .replace(/\},\s*$/, "}");
  const sandbox: Record<string, unknown> = { Date };
  vm.runInNewContext(
    `${source.slice(helperStart, helperEnd)}\n${functionSource}\nglobalThis.__normalize = normalizeImportItem;`,
    sandbox,
  );
  return (sandbox as { __normalize: (item: Record<string, unknown>) => Record<string, unknown> | null }).__normalize;
}

type EditorNode = { type: unknown; props: Record<string, any> };

function editorNodes(value: unknown): EditorNode[] {
  if (Array.isArray(value)) return value.flatMap(editorNodes);
  if (!value || typeof value !== "object" || !("props" in value)) return [];
  const node = value as EditorNode;
  return [node, ...Object.values(node.props).flatMap(editorNodes)];
}

function createDshEditorHarness(options: { active?: boolean; baseURL?: string; content?: string; error?: string; validated?: boolean; busy?: boolean; loading?: boolean }) {
  const source = read(uiPath);
  const helperStart = source.indexOf("const DSH_UI_PROVIDER");
  const helperEnd = source.indexOf("const CONFIG_FIELD_HELP_TOOLTIP_TITLE_FALLBACK_DELAY_MS");
  const renderStart = source.indexOf("const renderDshProfileEditor =");
  const renderEnd = source.indexOf("// dsh profile editor");
  assert.ok(helperStart >= 0 && helperEnd > helperStart && renderStart > helperEnd && renderEnd > renderStart);
  const utils = loadDshPageUtils();
  const initialContent = options.content === undefined ? utils.createProfileText(options.baseURL) : options.content;
  const profile = utils.readDocument(initialContent);
  const jsx = (type: unknown, props: Record<string, any>): EditorNode => ({ type, props });
  const sandbox: Record<string, any> = {
    URL,
    be: { jsx, jsxs: jsx },
    aa: "Card",
    xn: "Button",
    AH: "DeleteIcon",
    xr: { confirm: (options: Record<string, unknown>) => { sandbox.deleteConfirmation = options; } },
    Kt: { error: (value: string) => { sandbox.lastError = value; } },
    Pv: "SaveIcon",
    Qa: "TextArea",
    o: () => (options.active ? "profile-a" : null),
    O: { id: "profile-a", name: "DSH 配置", platform: "dsh" },
    dshEditorMode: "json",
    dshText: initialContent,
    dshVisual: options.validated === false ? null : profile.document,
    dshFieldError: options.error !== undefined ? options.error : (profile.ok ? "" : profile.error),
    dshSelectedModelId: profile.document?.acpModel || profile.document?.models[0]?.id || "",
    dshBusy: options.busy === true,
    configListLoading: options.loading === true,
    exampleKey: "",
    N: (value: string) => { sandbox.exampleKey = value; },
    saved: false,
    saveDshConfigCard: () => { sandbox.saved = true; },
    setDshVisual: (value: unknown) => { sandbox.dshVisual = value; },
    setDshText: (value: string) => { sandbox.dshText = value; },
    setDshFieldError: (value: string) => { sandbox.dshFieldError = value; },
    setDshSelectedModelId: (value: string) => { sandbox.dshSelectedModelId = value; },
    setDshEditorMode: (value: string) => { sandbox.dshEditorMode = value; },
    renderCodexField: (label: string, value: string, onChange: unknown, placeholder: string, extra: Record<string, unknown> = {}) =>
      jsx("Field", { label, value, onChange, placeholder, ...extra }),
    renderCodexSelect: (label: string, value: string, onChange: unknown, optionsList: unknown, extra: Record<string, unknown> = {}) =>
      jsx("Select", { label, value, onChange, options: optionsList, ...extra }),
    renderFixedEditorModeTabs: (modes: unknown) => jsx("ModeTabs", { modes }),
    Ya: "FileIcon",
  };
  sandbox.switchDshEditorMode = (nextMode: string) => {
    const switched = sandbox.dshUiSwitchMode({
      mode: sandbox.dshEditorMode,
      nextMode,
      text: sandbox.dshText,
      document: sandbox.dshVisual,
    });
    if (!switched.ok) {
      sandbox.dshFieldError = switched.error;
      return;
    }
    sandbox.dshEditorMode = switched.mode;
    sandbox.dshText = switched.text;
    sandbox.dshVisual = switched.document;
    sandbox.dshFieldError = "";
  };
  vm.runInContext(
    `${source.slice(helperStart, helperEnd)}\n${source.slice(renderStart, renderEnd)}\nglobalThis.__render = renderDshProfileEditor;`,
    vm.createContext(sandbox),
  );
  const render = () => sandbox.__render() as EditorNode;
  const find = (property: string, value: unknown) => {
    const node = editorNodes(render()).find((candidate) => candidate.props[property] === value);
    assert.ok(node, `Missing ${property}=${String(value)}`);
    return node;
  };
  return { sandbox, render, find, utils };
}

test("old config order missing dsh migrates without dropping earlier platforms", () => {
  const { utils } = loadStoreUtilities();
  const previous = {
    claude: ["claude-kept"],
    codex: ["codex-kept"],
    opencode: ["opencode-kept"],
    grok: ["grok-kept"],
  };
  utils.storeJson(utils.CONFIG_STORAGE_KEYS.CONFIG_ORDER, previous);
  const loaded = JSON.parse(JSON.stringify(utils.loadStoredOrder()));
  assert.deepEqual(
    JSON.parse(JSON.stringify(utils.configManagerPlatforms)),
    ["claude", "codex", "opencode", "grok", "dsh", "kimi-code"],
  );
  assert.deepEqual(loaded, { ...previous, dsh: [], "kimi-code": [] });
  assert.deepEqual(JSON.parse(JSON.stringify(utils.createEmptyOrder())), {
    claude: [],
    codex: [],
    opencode: [],
    grok: [],
    dsh: [],
    "kimi-code": [],
  });
  const appended = JSON.parse(JSON.stringify(utils.appendOrderForConfigs(
    [{ id: "dsh-added", platform: "dsh" }],
    utils.loadStoredOrder(),
  )));
  assert.deepEqual(appended, { ...previous, dsh: ["dsh-added"], "kimi-code": [] });
  const merged = JSON.parse(JSON.stringify(utils.mergeOrderWithConfigs(
    [{ id: "dsh-added", platform: "dsh" }, { id: "dsh-new", platform: "dsh" }],
    appended.dsh,
  )));
  assert.deepEqual(merged.order, ["dsh-added", "dsh-new"]);
});

test("config import keeps valid DSH profiles including a direct apiKey", () => {
  const normalize = loadConfigImportNormalizer();
  const utils = loadDshPageUtils();
  const profile = JSON.parse(utils.createProfileText()) as Record<string, unknown>;
  profile.apiKey = "sk-fixturetoken";
  const imported = normalize({ name: "导入的 DSH", platform: "dsh", content: JSON.stringify(profile) });
  assert.ok(imported);
  assert.equal(imported.platform, "dsh");
  assert.equal(imported.content, JSON.stringify(profile));
  assert.equal(imported.configContent, JSON.stringify(profile));
  const committed = commitDshDocument(String(imported.content));
  assert.equal(committed.ok, true);
});

test("config import rejects DSH credentials outside the supported apiKey field", () => {
  const normalize = loadConfigImportNormalizer();
  const utils = loadDshPageUtils();
  const profile = JSON.parse(utils.createProfileText()) as Record<string, any>;
  profile.models[0].token = "sk-fixturetoken";
  assert.equal(normalize({ name: "非法 DSH", platform: "dsh", content: JSON.stringify(profile) }), null);
});

test("DSH visual model draft uses the detail id field and confirms icon deletion", () => {
  const utils = loadDshPageUtils();
  const source = utils.createProfileText();
  const example = JSON.parse(source) as Record<string, unknown>;
  const backendExample = JSON.parse(createDshExampleProfileText()) as Record<string, unknown>;
  assert.equal(example.provider, backendExample.provider);
  assert.equal(example.api, backendExample.api);
  assert.equal(example.apiKeyEnv, backendExample.apiKeyEnv);
  assert.equal(example.acpModel, backendExample.acpModel);
  assert.deepEqual(
    (example.models as Array<{ id: string }>).map((model) => model.id),
    (backendExample.models as Array<{ id: string }>).map((model) => model.id),
  );
  const edited = JSON.parse(JSON.stringify(example)) as Record<string, unknown>;
  edited.apiKey = "test-key";
  edited.baseURL = "https://provider.example/v1";
  assert.deepEqual({ ...edited, apiKey: example.apiKey, baseURL: example.baseURL }, example);
  const committed = commitDshDocument(JSON.stringify(edited));
  if (!committed.ok) assert.fail(committed.error);
  assert.equal(committed.document.apiKey, "test-key");
  assert.equal(committed.document.baseURL, "https://provider.example/v1");
  assert.equal(committed.document.acpModel, example.acpModel);
  assert.equal(example.apiKey, "");
  assert.equal("displayName" in example, false);
  assert.equal("timeoutMs" in example, false);
  assert.equal("streamIdleTimeoutMs" in example, false);
  assert.equal("retryPolicy" in example, false);
  const profile = utils.readDocument(source);
  assert.equal(profile.ok, true);
  if (!profile.ok || !profile.document) return;

  const draft = utils.addModel(profile.document);
  assert.equal(draft.ok, true);
  assert.equal(draft.document.models[1].id, "");
  assert.equal(Object.prototype.hasOwnProperty.call(draft.document.models[1], "maxTokens"), false);
  assert.match(utils.readDocument(draft.content).error, /模型 id 为必填项/);
  const asJson = utils.switchMode({ mode: "visual", nextMode: "json", text: source, document: draft.document });
  assert.equal(asJson.ok, true);
  assert.equal(JSON.parse(asJson.text).models[1].id, "");
  const backToVisual = utils.switchMode({ mode: "json", nextMode: "visual", text: asJson.text, document: asJson.document });
  assert.equal(backToVisual.ok, false);
  assert.match(backToVisual.error, /模型 id 为必填项/);

  const harness = createDshEditorHarness({ active: true, content: source });
  harness.sandbox.switchDshEditorMode("visual");
  harness.find("data-testid", "dsh-add-model").props.onClick();
  assert.equal(harness.find("data-testid", "dsh-model-id").props.value, "");
  const draftDeleteButton = editorNodes(harness.render()).find((node) =>
    node.props["data-testid"] === "dsh-delete-model" && node.props["data-dsh-model-id"] === "",
  );
  assert.ok(draftDeleteButton);
  assert.equal(draftDeleteButton.props.type, "text");
  assert.equal(draftDeleteButton.props.icon.type, "DeleteIcon");
  draftDeleteButton.props.onClick({ stopPropagation: () => undefined });
  assert.equal(harness.sandbox.deleteConfirmation.title, "取消新增模型");
  harness.sandbox.deleteConfirmation.onOk();
  assert.equal(harness.sandbox.dshVisual.models.length, 1);

  harness.find("data-testid", "dsh-add-model").props.onClick();
  harness.find("data-testid", "dsh-model-id").props.onChange("vendor/added-model");
  assert.equal(harness.sandbox.dshVisual.models[1].id, "vendor/added-model");
  const modelDeleteButton = editorNodes(harness.render()).find((node) =>
    node.props["data-testid"] === "dsh-delete-model" && node.props["data-dsh-model-id"] === "vendor/added-model",
  );
  assert.ok(modelDeleteButton);
  assert.equal(modelDeleteButton.props.type, "text");
  assert.equal(modelDeleteButton.props.icon.type, "DeleteIcon");
  modelDeleteButton.props.onClick({ stopPropagation: () => undefined });
  assert.equal(harness.sandbox.deleteConfirmation.title, "删除模型");
  harness.sandbox.deleteConfirmation.onOk();
  assert.equal(harness.sandbox.dshVisual.models.length, 1);
});

test("DSH visual editor separates profile fields from configurable model fields", () => {
  const utils = loadDshPageUtils();
  const profile = JSON.parse(utils.createProfileText()) as {
    models: Array<{ id: string; name?: string; contextWindow?: number; maxTokens?: number }>;
  } & Record<string, unknown>;
  profile.models[0].name = "DeepSeek Flash";
  profile.models[0].contextWindow = 131072;
  profile.models[0].maxTokens = 4096;

  const harness = createDshEditorHarness({ content: JSON.stringify(profile) });
  assert.equal(harness.sandbox.dshEditorMode, "json");
  harness.sandbox.switchDshEditorMode("visual");

  const tree = editorNodes(harness.render());
  const commonParameters = tree.find((node) => node.props["data-testid"] === "dsh-common-parameters");
  const modelDetails = tree.find((node) => node.props["data-testid"] === "dsh-selected-model-detail");
  assert.ok(commonParameters);
  assert.ok(modelDetails);
  const commonTestIds = editorNodes(commonParameters).map((node) => node.props["data-testid"]);
  const modelTestIds = editorNodes(modelDetails).map((node) => node.props["data-testid"]);
  assert.deepEqual(commonTestIds.filter(Boolean), [
    "dsh-common-parameters",
    "dsh-provider",
    "dsh-api",
    "dsh-base-url",
    "dsh-api-key",
    "dsh-api-key-env-note",
    "dsh-api-key-warning",
    "dsh-acp-model",
  ]);
  assert.deepEqual(modelTestIds.filter(Boolean), [
    "dsh-selected-model-detail",
    "dsh-model-id",
    "dsh-model-name",
    "dsh-model-context-window",
    "dsh-model-input-type",
  ]);
  assert.equal(tree.some((node) => node.props["data-testid"] === "dsh-api-key-env"), false);
  assert.equal(harness.find("data-testid", "dsh-model-name").props.value, "DeepSeek Flash");
  assert.equal(harness.find("data-testid", "dsh-model-context-window").props.value, 131072);
  assert.equal(tree.some((node) => node.props["data-testid"] === "dsh-model-max-tokens"), false);

  harness.find("data-testid", "dsh-model-name").props.onChange("DeepSeek Flash Custom");
  harness.find("data-testid", "dsh-model-context-window").props.onChange("262144");
  const invalidContextWindow = utils.updateModelContextWindow(harness.sandbox.dshVisual, profile.models[0].id, "0");
  assert.equal(invalidContextWindow.ok, false);

  const savedProfile = utils.readDocument(harness.sandbox.dshText);
  assert.equal(savedProfile.ok, true);
  assert.equal(savedProfile.document?.models[0].name, "DeepSeek Flash Custom");
  assert.equal(savedProfile.document?.models[0].contextWindow, 262144);
  assert.equal(savedProfile.document?.models[0].maxTokens, 4096);
  const reopened = createDshEditorHarness({ content: savedProfile.content });
  reopened.sandbox.switchDshEditorMode("visual");
  assert.equal(reopened.find("data-testid", "dsh-model-name").props.value, "DeepSeek Flash Custom");
  assert.equal(reopened.find("data-testid", "dsh-model-context-window").props.value, 262144);
  assert.equal(editorNodes(reopened.render()).some((node) => node.props["data-testid"] === "dsh-model-max-tokens"), false);

  const misplacedContextWindow = { ...profile, contextWindow: 131072 };
  const rejectedProfile = utils.readDocument(JSON.stringify(misplacedContextWindow));
  assert.equal(rejectedProfile.ok, false);
  assert.match(rejectedProfile.error, /contextWindow/);
});

test("DSH empty profile can switch to a visual draft before strict save validation", () => {
  const utils = loadDshPageUtils();
  const switched = utils.switchMode({
    mode: "json",
    nextMode: "visual",
    text: "",
    document: null,
  });
  assert.equal(switched.ok, true);
  assert.equal(switched.mode, "visual");
  assert.equal(switched.document.provider, "sinitek-custom");
  assert.equal(switched.document.apiKey, "");
  assert.equal(switched.document.baseURL, "https://gateway.example/v1");
  assert.equal(utils.readDocument(switched.text).ok, true);

  const harness = createDshEditorHarness({ content: "" });
  assert.equal(harness.sandbox.dshFieldError, "DSH profile is empty.");
  harness.sandbox.switchDshEditorMode("visual");
  assert.equal(harness.sandbox.dshEditorMode, "visual");
  assert.equal(harness.sandbox.dshFieldError, "");
  assert.equal(harness.find("data-testid", "dsh-api-key").props.value, "");
  assert.equal(harness.find("data-testid", "dsh-model-id").props.value, "deepseek-v4.1-flash");
});

test("DSH editor edits the same JSON in text and visual modes without an activation badge", () => {
  const utils = loadDshPageUtils();
  const example = createDshExampleProfileText();
  assert.equal(example.includes("subcoco/"), false);
  const fromBackend = utils.readDocument(example);
  assert.equal(fromBackend.ok, true);
  assert.equal(fromBackend.fields.provider, "sinitek-custom");
  assert.equal(fromBackend.fields.baseURL, "https://gateway.example/v1");
  assert.equal(fromBackend.fields.modelId, "deepseek-v4.1-flash");
  assert.equal(fromBackend.fields.apiKeyEnv, "SINITEK_DSH_API_KEY");
  assert.equal(fromBackend.fields.modelId.split("/").length, 1);
  const profileWithDirectApiKey = JSON.parse(example) as Record<string, unknown>;
  profileWithDirectApiKey.apiKey = "sk-fixturetoken";
  const directApiKeyText = JSON.stringify(profileWithDirectApiKey);
  assert.equal(utils.containsProfileSecret(directApiKeyText), false);
  assert.equal(utils.readDocument(directApiKeyText).ok, true);
  const reopenedWithDirectApiKey = createDshEditorHarness({ content: directApiKeyText });
  assert.equal(reopenedWithDirectApiKey.sandbox.dshFieldError, "");
  assert.equal(reopenedWithDirectApiKey.sandbox.dshEditorMode, "json");
  reopenedWithDirectApiKey.sandbox.switchDshEditorMode("visual");
  assert.equal(reopenedWithDirectApiKey.find("data-testid", "dsh-api-key").props.value, "sk-fixturetoken");
  assert.equal(reopenedWithDirectApiKey.find("data-testid", "dsh-model-id").props.value, "deepseek-v4.1-flash");
  assert.equal(fromBackend.fields.modelId, utils.modelId);
  const withoutApiKeyEnv = JSON.parse(example) as Record<string, unknown>;
  delete withoutApiKeyEnv.apiKeyEnv;
  const normalizedApiKeyEnv = utils.readDocument(JSON.stringify(withoutApiKeyEnv));
  assert.equal(normalizedApiKeyEnv.ok, true);
  assert.equal(normalizedApiKeyEnv.document?.apiKeyEnv, "SINITEK_DSH_API_KEY");
  assert.match(normalizedApiKeyEnv.content, /"apiKeyEnv": "SINITEK_DSH_API_KEY"/);

  const split = utils.readDocument(JSON.stringify({
    provider: "subcoco",
    acpModel: "subcoco/deepseek-v4.1-flash",
    apiKeyEnv: "SINITEK_DSH_API_KEY",
    baseURL: "https://gateway.example/v1",
  }));
  assert.equal(split.ok, false);
  assert.equal(split.fields.modelId, "");
  assert.equal(split.fields.provider, "");
  assert.match(split.error, /Do not split the model id/);

  const existingNamespaced = JSON.parse(example) as {
    models: Array<{ id: string; name: string }>;
    acpModel: string;
  };
  existingNamespaced.models[0].id = "subcoco/deepseek-v4.1-flash";
  existingNamespaced.models[0].name = "subcoco/deepseek-v4.1-flash";
  existingNamespaced.acpModel = "subcoco/deepseek-v4.1-flash";
  const retainedNamespaced = utils.readDocument(JSON.stringify(existingNamespaced));
  assert.equal(retainedNamespaced.ok, true);
  assert.equal(retainedNamespaced.document?.models[0].id, "subcoco/deepseek-v4.1-flash");
  assert.equal(retainedNamespaced.document?.acpModel, "subcoco/deepseek-v4.1-flash");

  const secret = "sk-fixturetoken";
  const leaked = utils.readDocument(example.replace(
    "\"apiKeyEnv\": \"SINITEK_DSH_API_KEY\"",
    `\"apiKey\": \"${secret}\",\n  \"apiKeyEnv\": \"SINITEK_DSH_API_KEY\"`,
  ));
  assert.equal(leaked.ok, true);
  assert.equal(leaked.document?.apiKey, secret);
  assert.equal("apiKey" in leaked.fields, false);
  assert.equal(leaked.fields.apiKeyEnv, "SINITEK_DSH_API_KEY");
  assert.equal(utils.containsProfileSecret(JSON.stringify({ apiKey: secret })), false);
  assert.equal(utils.containsProfileSecret(JSON.stringify({ nested: { apiKey: secret } })), true);

  const harness = createDshEditorHarness({ active: true });
  const shell = harness.render();
  assert.equal(shell.props.className, "config-editor-shell config-editor-dsh");
  const card = Array.isArray(shell.props.children) ? shell.props.children[0] : shell.props.children;
  assert.equal(card.type, "Card");
  assert.equal(card.props.title.props.children[0].props["data-testid"], "dsh-profile-name");
  assert.equal(card.props.title.props.children[0].props.children, "DSH 配置");
  assert.equal(JSON.stringify(card.props.title).includes("dsh-activation-status"), false);
  assert.equal(JSON.stringify(card.props.title).includes("已激活"), false);
  assert.equal(harness.find("data-testid", "dsh-editor-mode").props["data-mode"], "json");
  harness.find("data-testid", "dsh-editor-mode").props.children.props.modes[0].onClick();
  assert.equal(harness.find("data-testid", "dsh-editor-mode").props["data-mode"], "visual");
  const modelField = harness.find("data-testid", "dsh-model-id");
  const apiField = harness.find("data-testid", "dsh-api").props.children;
  assert.equal(apiField.type, "Select");
  assert.equal(apiField.props.label, "API 类型");
  assert.equal(JSON.stringify(apiField.props.options.map((option: { value: string }) => option.value)), JSON.stringify([
    "openai-completions",
    "openai-responses",
    "anthropic-messages",
  ]));
  apiField.props.onChange("openai-responses");
  assert.equal(harness.sandbox.dshVisual.api, "openai-responses");
  assert.match(harness.sandbox.dshText, /"api": "openai-responses"/);
  apiField.props.onChange("anthropic-messages");
  assert.equal(harness.sandbox.dshVisual.api, "anthropic-messages");
  assert.equal(harness.find("data-testid", "dsh-api").props.children.props.value, "anthropic-messages");
  assert.equal(harness.find("data-testid", "dsh-api").props.children.props.options.length, 3);
  assert.equal(utils.updateApi(harness.sandbox.dshVisual, "azure-openai-responses").ok, false);
  const apiKeyField = harness.find("data-testid", "dsh-api-key");
  assert.equal(editorNodes(harness.render()).some((node) => node.props["data-testid"] === "dsh-api-key-env"), false);
  assert.equal(harness.find("data-testid", "dsh-api-key-env-note").props.children.includes("apiKeyEnv"), true);
  assert.match(apiKeyField.props.help, /激活副本.*明文保存/);
  assert.match(apiKeyField.props.help, /apiKeyEnv.*SINITEK_DSH_API_KEY/);
  assert.match(apiKeyField.props.help, /read -rsp 'DSH API Key: ' SINITEK_DSH_API_KEY/);
  const exampleButton = editorNodes(harness.render()).find((node) => node.props.children === "查看范例");
  assert.ok(exampleButton);
  exampleButton.props.onClick();
  assert.equal(harness.sandbox.exampleKey, "dsh-config");
  assert.equal(modelField.props.value, "deepseek-v4.1-flash");
  assert.equal(modelField.props.readOnly, undefined);
  assert.equal(apiKeyField.props.value, "");
  apiKeyField.props.onChange("sk-fixturetoken");
  assert.equal(harness.sandbox.dshVisual.apiKey, "sk-fixturetoken");
  assert.equal(utils.containsProfileSecret(harness.sandbox.dshText), false);
  assert.equal(harness.find("data-testid", "dsh-provider").props.readOnly, true);
  assert.equal(harness.find("data-testid", "dsh-provider").props.value, "sinitek-custom");
  assert.equal(harness.sandbox.dshVisual.apiKeyEnv, "SINITEK_DSH_API_KEY");
  assert.equal(harness.sandbox.dshVisual.apiKey, secret);
  apiKeyField.props.onChange(secret);
  assert.equal(harness.sandbox.dshVisual.apiKey, secret);
  assert.equal(harness.sandbox.dshText.includes(secret), true);
  harness.find("data-testid", "dsh-base-url").props.onChange(secret);
  assert.equal(harness.sandbox.dshVisual.baseURL, "https://gateway.example/v1");
  modelField.props.onChange("gateway/other-model");
  assert.equal(harness.sandbox.dshVisual.models[0].id, "gateway/other-model");
  assert.equal(harness.sandbox.dshVisual.acpModel, "gateway/other-model");
  assert.equal(harness.sandbox.dshText.includes("gateway/other-model"), true);
  harness.find("data-testid", "dsh-add-model").props.onClick();
  assert.equal(harness.sandbox.dshVisual.models[1].id, "");
  assert.equal(harness.find("data-testid", "dsh-model-id").props.value, "");
  assert.equal(editorNodes(harness.render()).some((node) => node.props["data-testid"] === "dsh-new-model-id"), false);
  assert.match(utils.readDocument(harness.sandbox.dshText).error, /模型 id 为必填项/);
  const draftDeleteButton = editorNodes(harness.render()).find((node) =>
    node.props["data-testid"] === "dsh-delete-model" && node.props["data-dsh-model-id"] === "",
  );
  assert.ok(draftDeleteButton);
  assert.equal(draftDeleteButton.props.type, "text");
  assert.equal(draftDeleteButton.props.icon.type, "DeleteIcon");
  draftDeleteButton.props.onClick({ stopPropagation: () => undefined });
  assert.equal(harness.sandbox.deleteConfirmation.title, "取消新增模型");
  harness.sandbox.deleteConfirmation.onOk();
  harness.find("data-testid", "dsh-add-model").props.onClick();
  harness.find("data-testid", "dsh-model-id").props.onChange("vendor/second-model");
  assert.equal(JSON.stringify(harness.sandbox.dshVisual.models.map((model: { id: string }) => model.id)), JSON.stringify([
    "gateway/other-model",
    "vendor/second-model",
  ]));
  assert.equal(harness.sandbox.dshSelectedModelId, "vendor/second-model");
  assert.equal(editorNodes(harness.render()).filter((node) => node.props["data-testid"] === "dsh-model-row").length, 2);
  const modelDeleteButton = editorNodes(harness.render()).find((node) =>
    node.props["data-testid"] === "dsh-delete-model" && node.props["data-dsh-model-id"] === "vendor/second-model",
  );
  assert.ok(modelDeleteButton);
  assert.equal(modelDeleteButton.props.type, "text");
  assert.equal(modelDeleteButton.props.icon.type, "DeleteIcon");
  assert.ok(harness.find("data-testid", "dsh-selected-model-detail"));
  harness.find("data-testid", "dsh-model-select").props.onClick();
  assert.equal(harness.sandbox.dshSelectedModelId, "gateway/other-model");
  harness.find("data-testid", "dsh-acp-model").props.children.props.onChange("vendor/second-model");
  assert.equal(harness.sandbox.dshVisual.acpModel, "vendor/second-model");
  assert.equal(harness.sandbox.dshSelectedModelId, "vendor/second-model");
  assert.match(JSON.stringify(harness.render()), /grok-model-workspace/);
  const beforeSwitch = harness.sandbox.dshText;
  harness.find("data-testid", "dsh-editor-mode").props.children.props.modes[1].onClick();
  assert.equal(harness.sandbox.dshEditorMode, "json");
  assert.equal(harness.sandbox.dshText, beforeSwitch);
  harness.find("data-testid", "dsh-json-editor").props.onChange({ target: { value: beforeSwitch } });
  harness.find("data-testid", "dsh-editor-mode").props.children.props.modes[0].onClick();
  assert.equal(harness.sandbox.dshEditorMode, "visual");
  assert.equal(JSON.stringify(harness.sandbox.dshVisual.models.map((model: { id: string }) => model.id)), JSON.stringify([
    "gateway/other-model",
    "vendor/second-model",
  ]));
  assert.equal(harness.sandbox.dshVisual.acpModel, "vendor/second-model");
  harness.find("className", "config-standard-action-button").props.onClick();
  assert.equal(harness.sandbox.saved, true);

  const draftModeHarness = createDshEditorHarness({ active: true });
  draftModeHarness.sandbox.switchDshEditorMode("visual");
  draftModeHarness.find("data-testid", "dsh-add-model").props.onClick();
  draftModeHarness.find("data-testid", "dsh-editor-mode").props.children.props.modes[1].onClick();
  assert.equal(draftModeHarness.sandbox.dshEditorMode, "json");
  draftModeHarness.find("data-testid", "dsh-editor-mode").props.children.props.modes[0].onClick();
  assert.equal(draftModeHarness.sandbox.dshEditorMode, "json");
  assert.match(draftModeHarness.sandbox.dshFieldError, /模型 id 为必填项/);

  const busy = createDshEditorHarness({ busy: true });
  busy.sandbox.switchDshEditorMode("visual");
  assert.equal(busy.find("className", "config-standard-action-button").props.disabled, true);
  assert.equal(busy.find("data-testid", "dsh-model-id").props.disabled, true);
  const idle = createDshEditorHarness({ active: false, validated: false });
  assert.equal(JSON.stringify(idle.render()).includes("dsh-activation-status"), false);
  idle.sandbox.dshEditorMode = "visual";
  assert.equal(idle.find("data-testid", "dsh-model-empty").props.children, "尚无模型，请先添加。");
  assert.equal(idle.find("className", "config-standard-action-button").props.disabled, false);

  const ui = read(uiPath);
  const listStart = ui.indexOf("// Config list panel");
  const listEnd = ui.indexOf("const CLI_GLOBAL_SKILL_TARGETS =");
  const list = ui.slice(listStart, listEnd);
  assert.ok(list.indexOf('H("claude"') < list.indexOf('H("codex"'));
  assert.ok(list.indexOf('H("codex"') < list.indexOf('H("opencode"'));
  assert.ok(list.indexOf('H("opencode"') < list.indexOf('H("grok"'));
  assert.ok(list.indexOf('H("grok"') < list.indexOf('H("dsh"'));
  assert.match(list, /config-list-item-selected/);
  assert.match(list, /emptyText: "暂无配置"/);
  assert.match(ui, /config-mobile-directory-button/);
  assert.match(ui, /"dsh-config": \{ title: "DSH profile JSON", content: ps\.dsh\.config \}/);
  assert.match(ui, /case "dsh-config": \{[\s\S]*?readDshUiDocument\(I\.content\)/);
  assert.match(ui, /else if \(O\.platform === "dsh"\) \{[\s\S]*?if \(dshUiContainsProfileSecret\(W\)\)/);
  assert.match(ui, /onClick: \(\) => N\("dsh-config"\),[\s\S]*?children: "查看范例"/);
  assert.match(ui, /dshUiContainsProfileSecret\(source\)/);
  assert.match(ui, /O\.platform === "dsh"[\s\S]*?renderDshProfileEditor\(\), B\(\)/);
  assert.match(ui, /范例导入失败: \" \+ H\.error/);
  assert.match(ui, /setDshText\(H\.content\)/);
  assert.equal(ui.slice(ui.indexOf("const renderDshProfileEditor"), ui.indexOf("// dsh profile editor")).includes('"data-testid": "dsh-api-key-env"'), false);
  assert.match(ui, /dshEditorMode.*c\.useState\("json"\)/);
  assert.equal(ui.slice(ui.indexOf("const renderDshProfileEditor"), ui.indexOf("// dsh profile editor")).includes(".split(\"/\")"), false);
});

test("DSH page save and activation reuse backend validation without touching protected runtime files", async () => {
  const utils = loadDshPageUtils();
  const home = await fs.promises.mkdtemp(path.join(os.tmpdir(), "dsh-page-"));
  const previous = process.env.DSH_HOME;
  process.env.DSH_HOME = home;
  const settingsPath = path.join(home, "settings.yaml");
  const credentialsPath = path.join(home, ".credentials.yaml");
  const forbiddenToml = path.join(home, "config.toml");
  try {
    await fs.promises.mkdir(home, { recursive: true });
    await fs.promises.writeFile(settingsPath, "untouched: true\n", "utf8");
    await fs.promises.writeFile(credentialsPath, "key: redacted\n", "utf8");
    const example = utils.createProfileText();
    const committed = commitDshDocument(example);
    assert.equal(committed.ok, true);
    if (!committed.ok) return;
    assert.equal(committed.document.acpModel, "deepseek-v4.1-flash");
    assert.equal(committed.document.provider, "sinitek-custom");
    assert.equal(committed.content.includes("sk-"), false);
    const loopback = commitDshDocument(utils.createProfileText("http://127.0.0.1:9/v1"));
    assert.equal(loopback.ok, true);
    const publicHttp = commitDshDocument(utils.createProfileText("http://gateway.example/v1"));
    assert.equal(publicHttp.ok, false);

    await saveConfig({
      id: "profile-a",
      name: "DSH",
      platform: "dsh",
      content: example,
      configContent: example,
      createdAt: 1,
      updatedAt: 1,
    });
    await applyConfig("dsh", { profileId: "profile-a", content: example, configContent: example });
    const paths = resolveDshConfigPaths();
    assert.equal((await readDshActivation(paths)).activeProfileId, "profile-a");
    const patch = await fs.promises.readFile(paths.patchPath, "utf8");
    assert.match(patch, /deepseek-v4\.1-flash/);
    assert.equal(patch.includes("modelOverrides"), false);
    assert.equal(await fs.promises.readFile(settingsPath, "utf8"), "untouched: true\n");
    assert.equal(await fs.promises.readFile(credentialsPath, "utf8"), "key: redacted\n");
    await assert.rejects(fs.promises.stat(forbiddenToml));

    await assert.rejects(applyConfig("dsh", {
      profileId: "profile-b",
      content: "{\"provider\":\"subcoco\"}",
      configContent: "{\"provider\":\"subcoco\"}",
    }));
    assert.equal((await readDshActivation(paths)).activeProfileId, "profile-a");
    const secret = "sk-fixturetoken";
    const secretProfile = example.replace(
      "\"apiKeyEnv\": \"SINITEK_DSH_API_KEY\"",
      `"apiKey": "${secret}",\n  "apiKeyEnv": "SINITEK_DSH_API_KEY"`,
    );
    await saveConfig({
      id: "profile-secret",
      name: "Secret",
      platform: "dsh",
      content: secretProfile,
      configContent: secretProfile,
      createdAt: 1,
      updatedAt: 1,
    });
    const savedSecretProfilePath = path.join(paths.configDir, "profile-secret.json");
    const savedSecretProfile = JSON.parse(await fs.promises.readFile(savedSecretProfilePath, "utf8"));
    assert.equal(savedSecretProfile.content.includes(secret), true);
    if (process.platform !== "win32") {
      assert.equal((await fs.promises.stat(savedSecretProfilePath)).mode & 0o777, 0o600);
    }
    await applyConfig("dsh", { profileId: "profile-secret", content: secretProfile, configContent: secretProfile });
    const secretPatch = await fs.promises.readFile(paths.patchPath, "utf8");
    assert.equal(secretPatch.includes(secret), false);
    assert.equal(await fs.promises.readFile(settingsPath, "utf8"), "untouched: true\n");
  } finally {
    if (previous === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = previous;
    await fs.promises.rm(home, { recursive: true, force: true });
  }
});

function withDshExtension(content: string): string {
  const document = JSON.parse(content) as {
    uiExtensionMetadata?: { preserved: boolean };
    defaultMaxTokens?: number;
    displayName?: string;
    timeoutMs?: number;
    streamIdleTimeoutMs?: number;
    retryPolicy?: { mode: string; maxRetries: number; backoff: { initialDelayMs: number; maxDelayMs: number } };
    models: Array<Record<string, unknown>>;
  };
  document.uiExtensionMetadata = { preserved: true };
  document.defaultMaxTokens = 1024;
  document.displayName = "Sinitek custom";
  document.timeoutMs = 45000;
  document.streamIdleTimeoutMs = 60000;
  document.retryPolicy = {
    mode: "normal",
    maxRetries: 1,
    backoff: { initialDelayMs: 200, maxDelayMs: 1000 },
  };
  document.models[0].vendorMeta = { tier: "flash", preserved: true };
  return JSON.stringify(document);
}

test("DSH text and visual edits keep accepted fields and reject secrets", async () => {
  const utils = loadDshPageUtils();
  const extended = withDshExtension(utils.createProfileText());
  const read = utils.readDocument(extended);
  assert.equal(read.ok, true);
  const parsed = JSON.parse(read.content) as {
    uiExtensionMetadata: { preserved: boolean };
    defaultMaxTokens: number;
    displayName: string;
    timeoutMs: number;
    streamIdleTimeoutMs: number;
    retryPolicy: { mode: string; maxRetries: number; backoff: { initialDelayMs: number; maxDelayMs: number } };
    acpModel: string;
    models: Array<Record<string, unknown>>;
  };
  assert.deepEqual(parsed.uiExtensionMetadata, { preserved: true });
  assert.equal(parsed.defaultMaxTokens, 1024);
  assert.equal(parsed.displayName, "Sinitek custom");
  assert.equal(parsed.timeoutMs, 45000);
  assert.equal(parsed.streamIdleTimeoutMs, 60000);
  assert.deepEqual(parsed.retryPolicy, {
    mode: "normal",
    maxRetries: 1,
    backoff: { initialDelayMs: 200, maxDelayMs: 1000 },
  });
  assert.deepEqual(parsed.models[0].vendorMeta, { tier: "flash", preserved: true });
  assert.equal(parsed.acpModel, "deepseek-v4.1-flash");
  assert.equal(parsed.models[0].id, "deepseek-v4.1-flash");

  const toJson = utils.switchMode({ mode: "visual", nextMode: "json", text: read.content, document: read.document });
  assert.equal(toJson.ok, true);
  assert.equal(JSON.parse(toJson.text).uiExtensionMetadata.preserved, true);
  const back = utils.switchMode({ mode: "json", nextMode: "visual", text: toJson.text, document: toJson.document });
  assert.equal(back.ok, true);
  assert.equal(back.document.uiExtensionMetadata.preserved, true);
  assert.equal(back.document.models[0].vendorMeta.preserved, true);
  const invalid = utils.switchMode({ mode: "json", nextMode: "visual", text: "{", document: back.document });
  assert.equal(invalid.ok, false);
  assert.equal(invalid.document, back.document);
  assert.equal(invalid.document.uiExtensionMetadata.preserved, true);

  const relocated = utils.updateBaseUrl(read.document, "https://gateway.example/custom");
  assert.equal(relocated.ok, true);
  assert.equal(relocated.document.baseURL, "https://gateway.example/custom");
  assert.equal(relocated.document.uiExtensionMetadata.preserved, true);
  assert.equal(relocated.document.models[0].vendorMeta.preserved, true);
  const renamed = utils.updateModelId(read.document, "deepseek-v4.1-flash", "gateway/other-model");
  assert.equal(renamed.ok, true);
  assert.equal(renamed.document.models[0].id, "gateway/other-model");
  assert.equal(renamed.document.acpModel, "gateway/other-model");
  assert.equal(renamed.document.uiExtensionMetadata.preserved, true);
  assert.equal(renamed.document.models[0].vendorMeta.tier, "flash");
  const added = utils.addModel(renamed.document, "vendor/second-model");
  assert.equal(added.ok, true);
  assert.equal(JSON.stringify(added.document.models.map((model: { id: string }) => model.id)), JSON.stringify([
    "gateway/other-model",
    "vendor/second-model",
  ]));
  assert.equal(added.document.models[0].vendorMeta.preserved, true);
  assert.equal(added.document.uiExtensionMetadata.preserved, true);
  const draft = utils.addModel(renamed.document);
  assert.equal(draft.ok, true);
  assert.equal(draft.document.models[1].id, "");
  assert.match(utils.readDocument(draft.content).error, /模型 id 为必填项/);
  const completedDraft = utils.updateModelId(draft.document, "", "vendor/draft-model");
  assert.equal(completedDraft.ok, true);
  assert.equal(completedDraft.document.models[1].id, "vendor/draft-model");
  const clearedModel = utils.updateModelId(renamed.document, "gateway/other-model", "");
  assert.equal(clearedModel.ok, true);
  assert.equal(clearedModel.document.models[0].id, "");
  assert.equal(clearedModel.document.acpModel, "");
  const refilledModel = utils.updateModelId(clearedModel.document, "", "gateway/refilled-model");
  assert.equal(refilledModel.ok, true);
  assert.equal(refilledModel.document.models[0].id, "gateway/refilled-model");
  assert.equal(refilledModel.document.acpModel, "gateway/refilled-model");
  const canceledDraft = utils.deleteModel(draft.document, "");
  assert.equal(canceledDraft.ok, true);
  assert.equal(canceledDraft.document.models.length, 1);
  const selected = utils.setAcpModel(added.document, "vendor/second-model");
  assert.equal(selected.ok, true);
  assert.equal(selected.document.acpModel, "vendor/second-model");
  assert.equal(selected.document.models[0].id, "gateway/other-model");
  assert.equal(selected.document.uiExtensionMetadata.preserved, true);
  const removed = utils.deleteModel(selected.document, "vendor/second-model");
  assert.equal(removed.ok, true);
  assert.equal(removed.document.acpModel, "gateway/other-model");
  assert.equal(removed.document.models[0].vendorMeta.preserved, true);
  assert.equal(removed.document.uiExtensionMetadata.preserved, true);

  const harness = createDshEditorHarness({ content: extended });
  harness.sandbox.switchDshEditorMode("visual");
  harness.find("data-testid", "dsh-model-id").props.onChange("gateway/renamed-model");
  assert.equal(harness.sandbox.dshVisual.models[0].id, "gateway/renamed-model");
  assert.equal(harness.sandbox.dshVisual.uiExtensionMetadata.preserved, true);
  assert.equal(harness.sandbox.dshVisual.models[0].vendorMeta.preserved, true);
  assert.equal(harness.sandbox.dshText.includes("uiExtensionMetadata"), true);
  assert.equal(harness.sandbox.dshText.includes("vendorMeta"), true);
  harness.find("data-testid", "dsh-editor-mode").props.children.props.modes[1].onClick();
  assert.equal(harness.sandbox.dshEditorMode, "json");
  const validText = harness.sandbox.dshText;
  harness.sandbox.dshText = "{";
  harness.find("data-testid", "dsh-editor-mode").props.children.props.modes[0].onClick();
  assert.equal(harness.sandbox.dshEditorMode, "json");
  assert.equal(harness.sandbox.dshText, "{");
  assert.equal(harness.sandbox.dshVisual.uiExtensionMetadata.preserved, true);
  harness.sandbox.dshText = validText;
  harness.find("data-testid", "dsh-editor-mode").props.children.props.modes[0].onClick();
  assert.equal(harness.sandbox.dshEditorMode, "visual");
  assert.equal(harness.sandbox.dshVisual.models[0].vendorMeta.tier, "flash");

  const secretSource = JSON.parse(extended) as { apiKeyEnv?: string; apiKey?: string };
  secretSource.apiKey = "sk-fixturetoken";
  const secretField = utils.readDocument(JSON.stringify(secretSource));
  assert.equal(secretField.ok, true);
  assert.equal(secretField.document?.apiKey, "sk-fixturetoken");
  const headers = JSON.parse(extended) as { headers?: unknown };
  headers.headers = { authorization: "Bearer example" };
  const rejected = utils.readDocument(JSON.stringify(headers));
  assert.equal(rejected.ok, false);
  assert.match(rejected.error, /headers/);
  const closed = JSON.parse(extended) as { retryPolicy: { note?: string } };
  closed.retryPolicy.note = "drop-me";
  const closedRead = utils.readDocument(JSON.stringify(closed));
  assert.equal(closedRead.ok, false);
  assert.match(closedRead.error, /retryPolicy\.note/);

  const home = await fs.promises.mkdtemp(path.join(os.tmpdir(), "dsh-roundtrip-"));
  const previous = process.env.DSH_HOME;
  process.env.DSH_HOME = home;
  try {
    await saveConfig({
      id: "profile-roundtrip",
      name: "DSH roundtrip",
      platform: "dsh",
      content: read.content,
      configContent: read.content,
      createdAt: 1,
      updatedAt: 1,
    });
    const stored = await getConfigById("dsh", "profile-roundtrip");
    assert.ok(stored);
    const storedProfile = JSON.parse(stored?.configContent || stored?.content || "{}") as typeof parsed;
    assert.deepEqual(storedProfile.uiExtensionMetadata, { preserved: true });
    assert.deepEqual(storedProfile.models[0].vendorMeta, { tier: "flash", preserved: true });
    await applyConfig("dsh", { profileId: "profile-roundtrip", content: read.content, configContent: read.content });
    const paths = resolveDshConfigPaths();
    const applied = JSON.parse(await readDshActiveProfileText(paths)) as typeof parsed;
    assert.deepEqual(applied.uiExtensionMetadata, { preserved: true });
    assert.equal(applied.models[0].id, "deepseek-v4.1-flash");
    const patch = await fs.promises.readFile(paths.patchPath, "utf8");
    assert.equal(patch.includes("uiExtensionMetadata"), false);
    assert.equal(patch.includes("vendorMeta"), false);
    assert.equal(patch.includes("defaultMaxTokens"), false);
    assert.match(patch, /deepseek-v4\.1-flash/);
    assert.equal(patch.includes("subcoco/"), false);
    const committed = commitDshDocument(read.content);
    assert.equal(committed.ok, true);
    if (committed.ok) {
      assert.equal(serializeDshPatchYaml(committed.document).includes("preserved"), false);
    }
  } finally {
    if (previous === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = previous;
    await fs.promises.rm(home, { recursive: true, force: true });
  }
});

test("config API allows a direct DSH apiKey without applying secret guards to its value", async () => {
  const source = read(apiPath);
  const calls: string[] = [];
  const sandbox: Record<string, any> = {
    console: { error: () => undefined },
    fetch: async (url: string) => {
      calls.push(url);
      return { ok: true, status: 200, text: async () => "{\"success\":true,\"data\":{}}" };
    },
    window: {},
  };
  vm.runInNewContext(
    `${source}
globalThis.__api = { saveConfigItem, applyConfigItem, CONFIG_MANAGER_PLATFORMS };`,
    sandbox,
  );
  const api = sandbox.__api;
  assert.deepEqual(
    JSON.parse(JSON.stringify(api.CONFIG_MANAGER_PLATFORMS)),
    ["claude", "codex", "opencode", "grok", "dsh", "kimi-code"],
  );
  const secretConfig = {
    platform: "dsh",
    content: "{\"apiKey\":\"sk-fixturetoken\"}",
    configContent: "{\"apiKey\":\"sk-fixturetoken\"}",
  };
  await api.saveConfigItem(secretConfig);
  await api.applyConfigItem("dsh", { content: secretConfig.content, profileId: "profile-a" });
  assert.deepEqual(calls, ["http://127.0.0.1:9001/api/config/save", "http://127.0.0.1:9001/api/config/apply/dsh"]);
  await api.saveConfigItem({ platform: "grok", content: "model = \"grok\"" });
  assert.equal(calls.length, 3);
});
