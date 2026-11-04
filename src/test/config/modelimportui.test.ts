import assert = require("node:assert/strict");
import * as fs from "node:fs";
import * as path from "node:path";
import test = require("node:test");
import * as vm from "node:vm";
import { applyModelImport, discoverImportModels, getModelImportProviders } from "../../config/modelimport";

type AnyRecord = Record<string, any>;

const repoRoot = path.resolve(__dirname, "../../..");

function readAsset(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function extractBetween(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.ok(start >= 0, `missing section start: ${startMarker}`);
  assert.ok(end > start, `missing section end: ${endMarker}`);
  return source.slice(start, end);
}

function loadParentModelImportDraftHarness(options: {
  platform: string;
  editorMode: string;
  content: string;
  configContent?: string;
  authContent?: string;
  visualContent?: string;
  serializationError?: string;
}): AnyRecord {
  const source = readAsset("media/config/assets/config-app-ui.js");
  const editorUtilitySource = extractBetween(source, "// OPENCODE_VISUAL_EDITOR_UTILS_START", "// OPENCODE_VISUAL_EDITOR_UTILS_END");
  const jsoncParserSource = extractBetween(source, "function parseConfigJsonText(", "const GROK_VISUAL_FIELD_IDS");
  const syncStart = source.indexOf("syncOpenCodeVisualContent = ");
  const syncEnd = source.indexOf(",\n      switchOpenCodeEditorMode", syncStart);
  const switchStart = source.indexOf("switchOpenCodeEditorMode = ", syncEnd);
  const switchEnd = source.indexOf(",\n      syncCodexVisualContent", switchStart);
  assert.ok(syncStart >= 0 && syncEnd > syncStart, "actual OpenCode visual sync function should exist");
  assert.ok(switchStart >= 0 && switchEnd > switchStart, "actual OpenCode editor-mode switch should exist");
  const syncExpression = source.slice(syncStart + "syncOpenCodeVisualContent = ".length, syncEnd).trim().replace(/,$/, "");
  const switchExpression = source.slice(switchStart + "switchOpenCodeEditorMode = ".length, switchEnd).trim().replace(/,$/, "");
  const utilitySource = extractBetween(source, "const MODEL_IMPORT_CLAUDE_FIELDS", "const ModelImportModal");
  const readSource = extractBetween(source, "const readModelImportDraft =", "const openModelImport =");
  const openSource = extractBetween(source, "const openModelImport =", "const applyModelImportDraft =");
  const applySource = extractBetween(source, "const applyModelImportDraft =", "const currentModelImportIdentity =");
  const handlerSource = extractBetween(source, "const currentModelImportIdentity =", "const renderModelImportOverlay =");
  const calls: AnyRecord[] = [];
  const messages: AnyRecord[] = [];
  const state: AnyRecord = { modalOpen: false, modalDraft: null, textContent: options.content };
  const sandbox: AnyRecord = {
    Error,
    calls,
    messages,
    state,
    showConfigSaveError: (message: string) => messages.push({ type: "save-error", message }),
    Kt: {
      error: (message: string) => messages.push({ type: "error", message }),
      success: (message: string) => messages.push({ type: "success", message }),
      warning: (message: string) => messages.push({ type: "warning", message }),
    },
    setModelImportOpen: (value: boolean) => { state.modalOpen = value; },
    setModelImportDraft: (value: AnyRecord) => { state.modalDraft = value; },
    s: (value: string) => { sandbox.l = value; state.textContent = value; },
    setOpenCodeVisualState: (value: AnyRecord) => { sandbox.openCodeVisualState = value; state.visualState = value; },
    setOpenCodeVisualError: (value: string) => { state.visualError = value; },
    setOpenCodeEditorMode: (value: string) => { sandbox.openCodeEditorMode = value; state.editorMode = value; },
    r: () => calls.push({ kind: "save" }),
    A: () => calls.push({ kind: "activate" }),
    O: { platform: options.platform, id: "opencode-config" },
    l: options.content,
    m: options.configContent || "",
    p: options.authContent || "",
    claudeEditorMode: "json",
    claudeVisualState: {},
    openCodeEditorMode: options.editorMode,
    openCodeVisualState: {},
    codexEditorMode: "toml",
    codexVisualState: {},
    grokEditorMode: "toml",
    grokVisualState: {},
    grokTextDraft: "",
    kimiCodeEditorMode: "toml",
    kimiCodeVisualState: {},
    kimiCodeTextDraft: "",
    zcodeEditorMode: "json",
    zcodeVisualState: {},
    zcodeTextDraft: "",
    dshText: "",
    claudeVisualSerializeState: () => ({ ok: true, content: options.visualContent || options.content }),
    codexVisualSerializeState: () => ({ ok: true, content: options.visualContent || options.configContent || options.content }),
    grokVisualSerializeState: () => ({ ok: true, content: options.visualContent || options.configContent || options.content }),
    kimiCodeVisualSerializeState: () => ({ ok: true, content: options.visualContent || options.configContent || options.content }),
    ZcodeConfigVisualEditorUtils: { serializeState: () => options.visualContent || options.configContent || options.content },
    syncClaudeVisualContent: (value: string) => (calls.push({ kind: "claude", value }), true),
    syncCodexVisualContent: (value: string) => (calls.push({ kind: "codex", value }), true),
    syncGrokVisualContent: (value: string) => (calls.push({ kind: "grok", value }), true),
    syncKimiCodeVisualContent: (value: string) => (calls.push({ kind: "kimi-code", value }), true),
    syncZcodeVisualContent: (value: string) => (calls.push({ kind: "zcode", value }), true),
    h: (value: string) => calls.push({ kind: "auth", value }),
    readDshUiDocument: () => ({ ok: false, error: "invalid" }),
    setDshFieldError: () => undefined,
    setDshText: () => undefined,
    setDshVisual: () => undefined,
    setDshSelectedModelId: () => undefined,
  };
  vm.runInNewContext(
    `${jsoncParserSource}\n${editorUtilitySource}\nglobalThis.__visualUtils = OpenCodeConfigVisualEditorUtils; globalThis.__parseConfigJsonText = parseConfigJsonText; globalThis.__validateConfigJsonForSave = validateConfigJsonForSave;`,
    sandbox,
  );
  sandbox.openCodeVisualState = options.serializationError
    ? {}
    : sandbox.__visualUtils.parseContent(options.visualContent || options.content).state;
  sandbox.state.visualState = sandbox.openCodeVisualState;
  vm.runInNewContext(`globalThis.__realOpenCodeSync = ${syncExpression}; globalThis.__realOpenCodeModeSwitch = ${switchExpression};`, sandbox);
  sandbox.syncOpenCodeVisualContent = (value: string, mode: string) => {
    calls.push({ kind: "opencode", value, mode });
    return sandbox.__realOpenCodeSync(value, mode, !0);
  };
  sandbox.switchOpenCodeEditorMode = (mode: string) => sandbox.__realOpenCodeModeSwitch(mode);
  vm.runInNewContext(`${utilitySource}\n${readSource}\n${openSource}\n${applySource}\n${handlerSource}\nglobalThis.__parent = { readModelImportDraft, openModelImport, applyModelImportDraft, currentModelImportIdentity, handleModelImport, calls, messages, state };`, sandbox);
  return { ...sandbox.__parent, sandbox, switchOpenCodeEditorMode: sandbox.switchOpenCodeEditorMode };
}

function plain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function loadModelImportUiUtilities(): AnyRecord {
  const source = readAsset("media/config/assets/config-app-ui.js");
  const utilitySource = extractBetween(source, "const MODEL_IMPORT_CLAUDE_FIELDS", "const ModelImportModal");
  const sandbox: AnyRecord = {};
  vm.runInNewContext(
    `${utilitySource}
globalThis.__utils = {
  modelImportProviderReason,
  modelImportUniqueModels,
  modelImportToggleSelection,
  modelImportToggleAll,
  modelImportNormalizeFields,
  modelImportDraftMatches,
  modelImportProviderDisabledText,
  modelImportCredentialStatus,
  modelImportContentForPlatform,
  modelImportSerializationResult,
  modelImportSafeErrorText,
  modelImportSubmitError,
};`,
    sandbox,
  );
  return sandbox.__utils;
}

test("Grok errors use safe stage messages without imposing new credential requirements", async () => {
  const guidance = "synthetic credential error";
  const utils = loadModelImportUiUtilities();
  assert.equal(utils.modelImportProviderDisabledText(guidance), "当前供应商不可用于模型解析，请检查配置后重试。");
  assert.equal(utils.modelImportProviderDisabledText(`${guidance} token=fake-secret`), "当前供应商不可用于模型解析，请检查配置后重试。");
  assert.equal(utils.modelImportSafeErrorText(new Error(`${guidance} fake-secret https://sensitive.example\nError: fake-secret`)), "操作失败，请检查当前配置后重试。");
  assert.equal(utils.modelImportSubmitError("grok", new Error(`${guidance}\nError: fake-secret https://sensitive.example`)), "导入失败，请检查配置后重试。");
  assert.equal(utils.modelImportSubmitError("grok", new Error(`${guidance} fake-secret\nError: fake-secret`)), "导入失败，请检查配置后重试。");

  let discoveryCalls = 0;
  const disabledHarness = createModelImportModalHarness({
    platform: "grok",
    providers: async () => ({ providers: [{ id: "grok", label: "Grok", baseUrl: "http://example.test", protocol: "responses", mode: "multi", disabledReason: guidance }] }),
    discover: async () => { discoveryCalls += 1; return { models: [], existingModelIds: [] }; },
  });
  await disabledHarness.settle();
  assert.match(treeText(disabledHarness.tree), /当前供应商不可用于模型解析/);
  assert.equal(buttonWithText(disabledHarness.tree, "解析模型").props.disabled, true);
  assert.equal(discoveryCalls, 0);

  const providerErrorHarness = createModelImportModalHarness({
    platform: "grok",
    providers: async () => { throw new Error(`${guidance}\nError: fake-secret https://sensitive.example`); },
    discover: async () => ({ models: [], existingModelIds: [] }),
  });
  await providerErrorHarness.settle();
  assert.deepEqual(findNodes(providerErrorHarness.tree, (node) => node.props?.role === "alert").map(treeText), ["供应商列表加载失败，请重试。", "请选择供应商"]);
  assert.doesNotMatch(treeText(providerErrorHarness.tree), /fake-secret|sensitive\.example|Error:/);

  const discoveryHarness = createModelImportModalHarness({
    platform: "grok",
    providers: async () => ({ providers: [{ id: "grok", label: "Grok", baseUrl: "http://example.test", protocol: "responses", mode: "multi" }] }),
    discover: async () => { throw new Error(`${guidance}\nError: fake-secret https://sensitive.example`); },
  });
  await discoveryHarness.settle();
  buttonWithText(discoveryHarness.tree, "解析模型").props.onClick();
  await discoveryHarness.settle();
  assert.deepEqual(findNodes(discoveryHarness.tree, (node) => node.props?.role === "alert").map(treeText), ["解析模型失败，请检查配置后重试。"]);
  assert.equal(buttonWithText(discoveryHarness.tree, "解析模型").props.loading, false);
  assert.doesNotMatch(treeText(discoveryHarness.tree), /fake-secret|sensitive\.example|Error:/);

  let applied = 0;
  let requestedDraft: AnyRecord | undefined;
  const draft = { content: "preserve this draft" };
  let saved = 0;
  let activated = 0;
  const importHarness = createModelImportModalHarness({
    platform: "grok",
    draft,
    providers: async () => ({ providers: [{ id: "grok", label: "Grok", baseUrl: "http://example.test", protocol: "responses", mode: "multi" }] }),
    discover: async () => ({ models: [{ id: "new-model", label: "New model" }], existingModelIds: [] }),
    apply: async (payload) => { requestedDraft = payload.draft; throw new Error(`${guidance}\nError: fake-secret https://sensitive.example`); },
    onImported: () => { applied += 1; return true; },
    hostConfig: { save: () => { saved += 1; }, activate: () => { activated += 1; } },
  });
  await importHarness.settle();
  buttonWithText(importHarness.tree, "解析模型").props.onClick();
  await importHarness.settle();
  const modelInput = findNodes(importHarness.tree, (node) => node.type === "input" && node.props?.["aria-label"] === "New model")[0];
  modelInput.props.onChange({ target: { checked: true } });
  importHarness.render();
  await buttonWithText(importHarness.tree, "导入").props.onClick();
  await importHarness.settle();
  assert.deepEqual(findNodes(importHarness.tree, (node) => node.props?.role === "alert").map(treeText), ["导入失败，请检查配置后重试。"]);
  assert.equal(findNodes(importHarness.tree, (node) => node.type === "input" && node.props?.["aria-label"] === "New model")[0].props.checked, true);
  assert.equal(applied, 0);
  assert.deepEqual(requestedDraft, draft);
  assert.deepEqual(draft, { content: "preserve this draft" });
  assert.equal(saved, 0);
  assert.equal(activated, 0);
  assert.doesNotMatch(treeText(importHarness.tree), /fake-secret|sensitive\.example|Error:/);
});

test("Grok modal keeps stage-specific fallback for spoofed reasons and failures", async () => {
  const forged = "synthetic credential error fake-secret https://sensitive.example\nError: fake-secret";
  const provider = { id: "grok", label: "Grok", baseUrl: "http://example.test", protocol: "responses", mode: "multi" };
  const disabled = createModelImportModalHarness({
    platform: "grok",
    providers: async () => ({ providers: [{ ...provider, disabledReason: forged }] }),
    discover: async () => ({ models: [], existingModelIds: [] }),
  });
  await disabled.settle();
  assert.deepEqual(findNodes(disabled.tree, (node) => node.props?.role === "alert").map(treeText), ["当前供应商不可用于模型解析，请检查配置后重试。"]);
  assert.doesNotMatch(treeText(disabled.tree), /fake-secret|sensitive\.example|Error:/);

  for (const stage of ["providers", "discover", "apply"]) {
    let applied = 0;
    const draft = { content: "unsaved draft" };
    const harness = createModelImportModalHarness({
      platform: "grok", draft,
      providers: async () => { if (stage === "providers") throw new Error(forged); return { providers: [provider] }; },
      discover: async () => { if (stage === "discover") throw new Error(forged); return { models: [{ id: "new", label: "New" }], existingModelIds: [] }; },
      apply: async () => { throw new Error(forged); },
      onImported: () => { applied += 1; return true; },
    });
    await harness.settle();
    if (stage !== "providers") {
      buttonWithText(harness.tree, "解析模型").props.onClick();
      await harness.settle();
    }
    if (stage === "apply") {
      findNodes(harness.tree, (node) => node.type === "input" && node.props?.["aria-label"] === "New")[0].props.onChange({ target: { checked: true } });
      harness.render();
      await buttonWithText(harness.tree, "导入").props.onClick();
      await harness.settle();
      assert.equal(findNodes(harness.tree, (node) => node.type === "input" && node.props?.["aria-label"] === "New")[0].props.checked, true);
    }
    const expected = stage === "providers" ? "供应商列表加载失败，请重试。" : stage === "discover" ? "解析模型失败，请检查配置后重试。" : "导入失败，请检查配置后重试。";
    assert.deepEqual(findNodes(harness.tree, (node) => node.props?.role === "alert").map(treeText), stage === "providers" ? [expected, "请选择供应商"] : [expected]);
    assert.doesNotMatch(treeText(harness.tree), /fake-secret|sensitive\.example|Error:/);
    assert.deepEqual(draft, { content: "unsaved draft" });
    assert.equal(applied, 0);
  }
});

test("Grok credential errors do not override stale draft protection", async () => {
  const pending = deferred<AnyRecord>();
  const draft = { content: "original" };
  let currentDraft = draft;
  const harness = createModelImportModalHarness({
    platform: "grok", draft, getCurrentDraft: () => currentDraft,
    providers: async () => ({ providers: [{ id: "grok", label: "Grok", baseUrl: "http://example.test", protocol: "responses", mode: "multi" }] }),
    discover: () => pending.promise,
  });
  await harness.settle();
  buttonWithText(harness.tree, "解析模型").props.onClick();
  currentDraft = { content: "changed" };
  pending.reject(new Error("synthetic credential error\nError: fake-secret"));
  await harness.settle();
  assert.match(treeText(harness.tree), /已忽略过期结果/);
  assert.doesNotMatch(treeText(harness.tree), /fake-secret|Grok 模型导入需使用/);
  assert.equal(buttonWithText(harness.tree, "解析模型").props.loading, false);
  assert.equal(currentDraft.content, "changed");
});

test("Grok modal discovers and imports using the selected literal-key configuration", async () => {
  const draft = { content: '[models]\ndefault = "first"\n[model.first]\nmodel = "old-first"\nbase_url = "https://first.example/v1"\napi_backend = "responses"\napi_key = "first-secret"\n[model.second]\nmodel = "old-second"\nbase_url = "https://second.example/v1"\napi_backend = "responses"\napi_key = "second-secret"\n' };
  let imported: AnyRecord | undefined;
  let discoveryDone: Promise<unknown> | undefined;
  const config = { env: {} };
  const providers = getModelImportProviders({ platform: "grok", draft }, config).providers;
  const harness = createModelImportModalHarness({
    platform: "grok", draft,
    providers: async () => ({ providers }),
    discover: (payload) => {
      const result = discoverImportModels(plain(payload) as Parameters<typeof discoverImportModels>[0], {
        ...config, fetch: async (url, init) => {
          assert.equal(url, "https://second.example/v1/models");
          assert.equal(new Headers(init?.headers).get("authorization"), "Bearer second-secret");
          return new Response(JSON.stringify({ data: [{ id: "old-second" }, { id: "new-model" }] }));
        },
      });
      discoveryDone = result;
      return result;
    },
    apply: (payload) => applyModelImport(plain(payload) as Parameters<typeof applyModelImport>[0], config),
    onImported: (value) => { imported = value; return true; },
  });
  await harness.settle();
  const select = findNodes(harness.tree, (node) => node.type === "Select" && node.props?.["aria-label"] === "模型导入供应商")[0];
  assert.equal(select.props.options.length, 2);
  assert.ok(select.props.options.every((option: AnyRecord) => !option.disabled));
  select.props.onChange(providers[1].id);
  harness.render();
  assert.match(treeText(harness.tree), /https:\/\/second\.example\/v1/);
  buttonWithText(harness.tree, "解析模型").props.onClick();
  await discoveryDone;
  await harness.settle();
  assert.equal(findNodes(harness.tree, (node) => node.type === "input" && node.props?.["aria-label"] === "old-second").length, 0);
  findNodes(harness.tree, (node) => node.type === "input" && node.props?.["aria-label"] === "new-model")[0].props.onChange({ target: { checked: true } });
  harness.render();
  await buttonWithText(harness.tree, "导入").props.onClick();
  await harness.settle();
  assert.match(imported?.content ?? "", /\[model\.new-model\][\s\S]*base_url = "https:\/\/second\.example\/v1"[\s\S]*api_key = "second-secret"/);
  assert.ok(imported?.content.startsWith(draft.content.trimEnd()));
  assert.doesNotMatch(treeText(harness.tree), /first-secret|second-secret|env_key/);
});

function loadApi(windowValue: AnyRecord, fetchImpl: () => Promise<never>, onError: (...args: any[]) => void = () => undefined): AnyRecord {
  const source = readAsset("media/config/assets/config-app-api.js");
  const sandbox: AnyRecord = {
    console: { error: onError },
    fetch: fetchImpl,
    window: windowValue,
  };
  vm.runInNewContext(
    `${source}
globalThis.__api = {
  getModelImportProviders,
  discoverImportModels,
  applyModelImport,
};`,
    sandbox,
  );
  return sandbox.__api;
}

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function findNodes(node: any, predicate: (value: AnyRecord) => boolean, result: AnyRecord[] = []): AnyRecord[] {
  if (Array.isArray(node)) {
    node.forEach((child) => findNodes(child, predicate, result));
    return result;
  }
  if (!node || typeof node !== "object") return result;
  if (predicate(node)) result.push(node);
  Object.values(node.props || {}).forEach((child) => {
    if (child && typeof child === "object") findNodes(child, predicate, result);
  });
  return result;
}

function treeText(node: any): string {
  if (Array.isArray(node)) return node.map(treeText).join("");
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  return treeText(node.props?.children);
}

function buttonWithText(tree: any, text: string): AnyRecord {
  const button = findNodes(tree, (node) => node.type === "Button" && node.props?.children === text)[0];
  assert.ok(button, `missing button: ${text}`);
  return button;
}

function createModelImportModalHarness(options: {
  providers: () => Promise<AnyRecord>;
  discover: (payload: AnyRecord) => Promise<AnyRecord>;
  apply?: (payload: AnyRecord) => Promise<AnyRecord>;
  platform?: string;
  draft?: AnyRecord;
  configIdentity?: string;
  getCurrentDraft?: () => AnyRecord;
  getCurrentConfigIdentity?: () => string;
  onImported?: (...args: any[]) => Promise<boolean> | boolean;
  hostConfig?: AnyRecord;
}): AnyRecord {
  const source = readAsset("media/config/assets/config-app-ui.js");
  const modalSource = extractBetween(source, "const MODEL_IMPORT_CLAUDE_FIELDS", "const ConfigEditorPanel");
  const state: any[] = [];
  const refs: any[] = [];
  const effects: Array<{ deps?: any[]; cleanup?: () => void }> = [];
  let hookIndex = 0;
  let tree: any;
  let pendingEffects: Array<() => void | (() => void)> = [];
  const sandbox: AnyRecord = {
    c: {
      useState(initial: any) {
        const index = hookIndex++;
        if (!(index in state)) state[index] = typeof initial === "function" ? initial() : initial;
        return [state[index], (next: any) => {
          state[index] = typeof next === "function" ? next(state[index]) : next;
        }];
      },
      useRef(initial: any) {
        const index = hookIndex++;
        if (!(index in refs)) refs[index] = { current: initial };
        return refs[index];
      },
      useEffect(effect: () => void | (() => void), deps?: any[]) {
        const index = hookIndex++;
        const previous = effects[index];
        const changed = !previous || !deps || !previous.deps || deps.some((value, depIndex) => !Object.is(value, previous.deps?.[depIndex]));
        if (changed) {
          if (previous?.cleanup) previous.cleanup();
          effects[index] = { deps };
          pendingEffects.push(() => {
            const cleanup = effect();
            effects[index].cleanup = typeof cleanup === "function" ? cleanup : undefined;
          });
        }
      },
    },
    be: {
      jsx(type: any, props: AnyRecord | null, key?: any) { return { type, props: props || {}, key }; },
      jsxs(type: any, props: AnyRecord | null, key?: any) { return { type, props: props || {}, key }; },
    },
    xr: "Modal",
    xn: "Button",
    $l: "Select",
    zi: "Input",
    getModelImportProviders: options.providers,
    discoverImportModels: options.discover,
    applyModelImport: options.apply || (async () => ({ draft: { content: "updated" } })),
    window: { electronAPI: { config: options.hostConfig || {} } },
    document: { body: {} },
  };
  vm.runInNewContext(`${modalSource}\nglobalThis.__Modal = ModelImportModal;`, sandbox);
  const props: AnyRecord = {
    platform: options.platform || "claude",
    draft: options.draft || { content: "original" },
    configIdentity: options.configIdentity || `${options.platform || "claude"}:1`,
    getCurrentDraft: options.getCurrentDraft || (() => props.draft),
    getCurrentConfigIdentity: options.getCurrentConfigIdentity || (() => props.configIdentity),
    onClose: () => undefined,
    onImported: options.onImported || (() => true),
  };
  const render = (nextProps?: AnyRecord) => {
    if (nextProps) Object.assign(props, nextProps);
    hookIndex = 0;
    pendingEffects = [];
    tree = sandbox.__Modal(props);
    const currentEffects = pendingEffects;
    pendingEffects = [];
    currentEffects.forEach((run) => run());
    return tree;
  };
  const settle = async () => {
    await Promise.resolve();
    await Promise.resolve();
    render();
    await Promise.resolve();
    render();
    return tree;
  };
  render();
  return { props, render, settle, get tree() { return tree; } };
}

test("Kimi modal explains inherited settings and maps only the known missing-template error", async () => {
  const hostMessage = "Kimi Code 需要同一 provider 的有效模型模板（正数 max_context_size）；请先配置模板后再导入。继承值不代表服务端发现的模型能力。";
  const draft = { content: "unmodified draft" };
  let applied = 0;
  let closed = 0;
  let saved = 0;
  let activated = 0;
  let requestedDraft: AnyRecord | undefined;
  const harness = createModelImportModalHarness({
    platform: "kimi-code",
    draft,
    providers: async () => ({ providers: [{ id: "kimi", label: "Kimi", baseUrl: "http://example.test", protocol: "openai-chat-completions", mode: "multi" }] }),
    discover: async () => ({ models: [{ id: "new", label: "New" }], existingModelIds: [] }),
    apply: async (payload) => {
      requestedDraft = payload.draft;
      throw new Error(`${hostMessage}\n\nError: fake-secret https://sensitive.example`);
    },
    onImported: () => { applied += 1; return true; },
    hostConfig: { save: () => { saved += 1; }, activate: () => { activated += 1; } },
  });
  harness.props.onClose = () => { closed += 1; };
  await harness.settle();
  assert.match(treeText(harness.tree), /上下文和能力继承自同供应商已有模型模板，并非服务端发现，请核对/);
  buttonWithText(harness.tree, "解析模型").props.onClick();
  await harness.settle();
  findNodes(harness.tree, (node) => node.type === "input" && node.props?.["aria-label"] === "New")[0].props.onChange({ target: { checked: true } });
  harness.render();
  await buttonWithText(harness.tree, "导入").props.onClick();
  await harness.settle();
  const alerts = findNodes(harness.tree, (node) => node.props?.role === "alert").map(treeText);
  assert.deepEqual(alerts, ["导入失败：请先为同一供应商配置有效模型，并设置正数 max_context_size，再重新导入。"]);
  assert.equal(harness.tree.props.open, true);
  assert.equal(findNodes(harness.tree, (node) => node.type === "input" && node.props?.["aria-label"] === "New")[0].props.checked, true);
  assert.equal(buttonWithText(harness.tree, "导入").props.disabled, false);
  assert.deepEqual(requestedDraft, draft);
  assert.equal(draft.content, "unmodified draft");
  assert.equal(applied, 0);
  assert.equal(closed, 0);
  assert.equal(saved, 0);
  assert.equal(activated, 0);
  assert.doesNotMatch(treeText(harness.tree), /fake-secret|sensitive\.example|Error:/);
});

test("Kimi successful import warns about inherited settings before applying only the draft", async () => {
  const imported: AnyRecord[] = [];
  let saved = 0;
  let activated = 0;
  const harness = createModelImportModalHarness({
    platform: "kimi-code",
    draft: { content: "old" },
    providers: async () => ({ providers: [{ id: "kimi", label: "Kimi", baseUrl: "http://example.test", protocol: "openai-chat-completions", mode: "multi" }] }),
    discover: async () => ({ models: [{ id: "new", label: "New" }], existingModelIds: [] }),
    apply: async () => ({ draft: { content: "updated" } }),
    onImported: (draft) => { imported.push(draft); return true; },
    hostConfig: { save: () => { saved += 1; }, activate: () => { activated += 1; } },
  });
  await harness.settle();
  buttonWithText(harness.tree, "解析模型").props.onClick();
  await harness.settle();
  findNodes(harness.tree, (node) => node.type === "input" && node.props?.["aria-label"] === "New")[0].props.onChange({ target: { checked: true } });
  harness.render();
  assert.match(treeText(harness.tree), /上下文和能力继承自同供应商已有模型模板，并非服务端发现，请核对/);
  await buttonWithText(harness.tree, "导入").props.onClick();
  await harness.settle();
  assert.deepEqual(imported, [{ content: "updated" }]);
  assert.equal(saved, 0);
  assert.equal(activated, 0);
});

test("modal uses generic errors for other platforms and unexpected or spoofed Kimi errors", async () => {
  const known = "Kimi Code 需要同一 provider 的有效模型模板（正数 max_context_size）；请先配置模板后再导入。继承值不代表服务端发现的模型能力。";
  for (const [platform, message] of [
    ["opencode", known],
    ["kimi-code", `${known} fake-secret https://sensitive.example`],
    ["kimi-code", "fake-secret https://sensitive.example\nError: fake-secret"],
  ]) {
    let applied = 0;
    const harness = createModelImportModalHarness({
      platform,
      providers: async () => ({ providers: [{ id: "one", label: "One", baseUrl: "http://example.test", protocol: "openai-chat-completions", mode: "multi" }] }),
      discover: async () => ({ models: [{ id: "new", label: "New" }], existingModelIds: [] }),
      apply: async () => { throw new Error(message); },
      onImported: () => { applied += 1; return true; },
    });
    await harness.settle();
    if (platform !== "kimi-code") assert.doesNotMatch(treeText(harness.tree), /继承自同供应商/);
    buttonWithText(harness.tree, "解析模型").props.onClick();
    await harness.settle();
    findNodes(harness.tree, (node) => node.type === "input" && node.props?.["aria-label"] === "New")[0].props.onChange({ target: { checked: true } });
    harness.render();
    await buttonWithText(harness.tree, "导入").props.onClick();
    await harness.settle();
    assert.deepEqual(findNodes(harness.tree, (node) => node.props?.role === "alert").map(treeText), ["导入失败，请检查配置后重试。"]);
    assert.doesNotMatch(treeText(harness.tree), /fake-secret|sensitive\.example|Error:/);
    assert.equal(applied, 0);
  }
});

test("model import bridge does not log synchronous or asynchronous raw errors", async () => {
  const logged: any[] = [];
  for (const asynchronous of [false, true]) {
    const fail = () => {
      const error = new Error("fake-secret https://sensitive.example");
      if (asynchronous) return Promise.reject(error);
      throw error;
    };
    const api = loadApi({ electronAPI: { config: { getModelImportProviders: fail, discoverImportModels: fail, applyModelImport: fail } } }, async () => { throw new Error("unexpected fetch"); }, (...args) => logged.push(args));
    for (const method of ["getModelImportProviders", "discoverImportModels", "applyModelImport"]) await assert.rejects(() => api[method]({}));
  }
  assert.deepEqual(logged, []);
});

test("model import bridge forwards the fixed payload contract without network fallback", async () => {
  const calls: Array<{ method: string; payload: AnyRecord }> = [];
  const config = {
    getModelImportProviders: async (payload: AnyRecord) => {
      calls.push({ method: "providers", payload });
      return { providers: [{ id: "local", label: "Local", baseUrl: "http://localhost/v1", protocol: "openai-responses", mode: "multi" }] };
    },
    discoverImportModels: async (payload: AnyRecord) => {
      calls.push({ method: "discover", payload });
      return { models: [{ id: "one", label: "One" }], existingModelIds: ["old"] };
    },
    applyModelImport: async (payload: AnyRecord) => {
      calls.push({ method: "apply", payload });
      return { draft: { content: "updated" } };
    },
  };
  const api = loadApi({ electronAPI: { config } }, async () => {
    throw new Error("unexpected fetch");
  });
  const draft = { content: '{"model":"old"}' };
  await api.getModelImportProviders({ platform: "claude", draft });
  await api.discoverImportModels({ platform: "claude", draft, providerId: "local" });
  await api.applyModelImport({
    platform: "claude",
    draft,
    providerId: "local",
    selectedModelIds: ["one"],
    fields: { model: "one" },
  });
  assert.deepEqual(plain(calls), [
    { method: "providers", payload: { platform: "claude", draft } },
    { method: "discover", payload: { platform: "claude", draft, providerId: "local" } },
    { method: "apply", payload: { platform: "claude", draft, providerId: "local", selectedModelIds: ["one"], fields: { model: "one" } } },
  ]);
});

test("model import UI places accessible actions beside each example button", () => {
  const source = readAsset("media/config/assets/config-app-ui.js");
  assert.equal((source.match(/renderModelImportButton\(\)/g) || []).length, 8);
  assert.equal((source.match(/children: "查看范例"/g) || []).length, 8);
  assert.match(source, /"aria-label": "模型解析导入"/);
  assert.match(source, /width: 560/);
  assert.match(readAsset("media/config/assets/config-source-editor.css"), /width: min\(560px, calc\(100vw - 32px\)\)/);
});

test("multi and single selection deduplicate and keep configured models excluded", () => {
  const utils = loadModelImportUiUtilities();
  const models = utils.modelImportUniqueModels([
    { id: "one", label: "One" },
    { id: "one", label: "Duplicate" },
    { id: "two", label: "Two" },
    { id: "", label: "Ignored" },
  ]);
  assert.deepEqual(plain(models), [{ id: "one", label: "One" }, { id: "two", label: "Two" }]);
  assert.deepEqual(plain(utils.modelImportToggleSelection("multi", ["one"], "two", true)), ["one", "two"]);
  assert.deepEqual(plain(utils.modelImportToggleSelection("multi", ["one", "two"], "one", false)), ["two"]);
  assert.deepEqual(plain(utils.modelImportToggleSelection("single", ["one"], "two", true)), ["two"]);
  assert.deepEqual(plain(utils.modelImportToggleAll(["configured"], models, true)), ["configured", "one", "two"]);
  assert.deepEqual(plain(utils.modelImportToggleAll(["configured", "one"], models, false)), ["configured"]);
});

test("Claude fields preserve labels and original values while supporting all five slots", () => {
  const utils = loadModelImportUiUtilities();
  assert.deepEqual(plain(utils.modelImportNormalizeFields([
    { key: "model", label: "model", value: "current-model" },
    { key: "env.ANTHROPIC_DEFAULT_HAIKU_MODEL", label: "Haiku", value: "" },
    { key: "env.ANTHROPIC_DEFAULT_SONNET_MODEL", label: "Sonnet", value: "current-sonnet" },
    { key: "env.ANTHROPIC_DEFAULT_OPUS_MODEL", label: "Opus", value: "current-opus" },
    { key: "env.CLAUDE_CODE_SUBAGENT_MODEL", label: "子代理", value: "current-subagent" },
  ])), [
    { key: "model", label: "model", value: "current-model" },
    { key: "env.ANTHROPIC_DEFAULT_HAIKU_MODEL", label: "Haiku", value: "" },
    { key: "env.ANTHROPIC_DEFAULT_SONNET_MODEL", label: "Sonnet", value: "current-sonnet" },
    { key: "env.ANTHROPIC_DEFAULT_OPUS_MODEL", label: "Opus", value: "current-opus" },
    { key: "env.CLAUDE_CODE_SUBAGENT_MODEL", label: "子代理", value: "current-subagent" },
  ]);
  assert.deepEqual(plain(utils.modelImportNormalizeFields([]).map((field: AnyRecord) => field.key)), [
    "model",
    "env.ANTHROPIC_DEFAULT_HAIKU_MODEL",
    "env.ANTHROPIC_DEFAULT_SONNET_MODEL",
    "env.ANTHROPIC_DEFAULT_OPUS_MODEL",
    "env.CLAUDE_CODE_SUBAGENT_MODEL",
  ]);
});

test("provider empty, unsupported, disabled, and draft-race states are explicit", () => {
  const utils = loadModelImportUiUtilities();
  assert.equal(utils.modelImportProviderReason(null), "请选择供应商");
  assert.match(utils.modelImportProviderReason({ id: "missing-url", protocol: "openai-responses" }), /缺少 URL/);
  assert.equal(utils.modelImportProviderReason({ id: "future", baseUrl: "http://localhost", protocol: "future-protocol" }), "");
  assert.equal(utils.modelImportProviderReason({ id: "legacy", disabledReason: "Unsupported protocol legacy", baseUrl: "http://localhost", protocol: "legacy" }), "当前供应商协议暂不可用于模型解析。");
  assert.equal(utils.modelImportProviderReason({ id: "disabled", disabledReason: "API Key 不可用: hidden-secret", baseUrl: "http://localhost", protocol: "openai-responses" }), "当前供应商没有可用 API Key，请检查配置或宿主环境变量。");
  assert.equal(utils.modelImportProviderDisabledText("Failed: token=do-not-show"), "当前供应商不可用于模型解析，请检查配置后重试。");
  assert.equal(utils.modelImportCredentialStatus({ disabledReason: "此 provider 当前没有可用 API key" }), "未检测到可用 API Key（也可能由宿主环境变量提供）");
  assert.equal(utils.modelImportCredentialStatus({}), "凭据状态由宿主验证，不显示密钥");
  assert.equal(utils.modelImportDraftMatches({ content: "same" }, { content: "same" }), true);
  assert.equal(utils.modelImportDraftMatches({ content: "changed" }, { content: "same" }), false);
  assert.doesNotMatch(utils.modelImportSafeErrorText("upstream token=secret sk-123456789abcdef"), /secret|123456789abcdef/);
});

test("loading, retry, import confirmation, and unsaved-content protection are represented in the UI", () => {
  const source = readAsset("media/config/assets/config-app-ui.js");
  for (const text of ["解析模型", "导入", "没有可导入的模型", "请重新解析", "并发编辑", "未保存更改", "凭据状态由宿主验证"]) {
    assert.ok(source.includes(text), `missing UI state text: ${text}`);
  }
  assert.match(source, /getModelImportProviders\(\{ platform: importPlatform, draft: importDraft \}\)/);
  assert.match(source, /discoverImportModels\(\{ platform: importPlatform, draft: importDraft, providerId: requestedProviderId \}\)/);
  assert.match(source, /applyModelImport\(\{[\s\S]*selectedModelIds: selected/);
});

test("modal execution clears discovery loading on provider switch and ignores late results", async () => {
  const first = deferred<AnyRecord>();
  const second = deferred<AnyRecord>();
  const harness = createModelImportModalHarness({
    providers: async () => ({ providers: [
      { id: "first", label: "First", baseUrl: "http://first", protocol: "openai-responses", mode: "multi" },
      { id: "second", label: "Second", baseUrl: "http://second", protocol: "openai-responses", mode: "multi" },
    ] }),
    discover: (payload) => payload.providerId === "first" ? first.promise : second.promise,
  });
  await harness.settle();
  let select = findNodes(harness.tree, (node) => node.type === "Select" && node.props?.["aria-label"] === "模型导入供应商")[0];
  buttonWithText(harness.tree, "解析模型").props.onClick();
  harness.render();
  assert.equal(buttonWithText(harness.tree, "解析模型").props.loading, true);
  select.props.onChange("second");
  harness.render();
  assert.equal(buttonWithText(harness.tree, "解析模型").props.loading, false);
  assert.equal(buttonWithText(harness.tree, "解析模型").props.disabled, false);
  first.resolve({ models: [{ id: "stale", label: "Stale" }], existingModelIds: [] });
  await harness.settle();
  assert.doesNotMatch(treeText(harness.tree), /Stale/);
  select = findNodes(harness.tree, (node) => node.type === "Select" && node.props?.["aria-label"] === "模型导入供应商")[0];
  select.props.onChange("second");
  buttonWithText(harness.tree, "解析模型").props.onClick();
  second.resolve({ models: [{ id: "fresh", label: "Fresh" }], existingModelIds: [] });
  await harness.settle();
  assert.match(treeText(harness.tree), /Fresh/);
});

test("modal execution renders safe provider errors and retries", async () => {
  let attempts = 0;
  const harness = createModelImportModalHarness({
    providers: async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("apiKey=super-secret-token");
      return { providers: [{ id: "local", label: "Local", baseUrl: "http://localhost", protocol: "openai-responses", mode: "multi" }] };
    },
    discover: async () => ({ models: [], existingModelIds: [] }),
  });
  await harness.settle();
  assert.match(treeText(harness.tree), /供应商列表加载失败/);
  assert.doesNotMatch(treeText(harness.tree), /super-secret-token/);
  assert.equal(findNodes(harness.tree, (node) => node.props?.children instanceof Error).length, 0);
  buttonWithText(harness.tree, "重试加载").props.onClick();
  await harness.settle();
  assert.equal(attempts, 2);
  const providerSelect = findNodes(harness.tree, (node) => node.type === "Select" && node.props?.["aria-label"] === "模型导入供应商")[0];
  assert.ok(providerSelect.props.options.some((option: AnyRecord) => option.label === "Local"));

  const credentialHarness = createModelImportModalHarness({
    platform: "opencode",
    draft: { content: JSON.stringify({ apiKey: "draft-secret-value" }) },
    providers: async () => ({ providers: [{ id: "safe", label: "Safe", baseUrl: "http://safe", protocol: "future-protocol", mode: "multi" }] }),
    discover: async () => ({ models: [], existingModelIds: [] }),
  });
  await credentialHarness.settle();
  assert.match(treeText(credentialHarness.tree), /凭据状态由宿主验证/);
  assert.doesNotMatch(treeText(credentialHarness.tree), /draft-secret-value/);
});

test("modal execution reports loading, retryable discovery errors, empty results, and configured-only results", async () => {
  const providers = deferred<AnyRecord>();
  let attempts = 0;
  const harness = createModelImportModalHarness({
    providers: () => providers.promise,
    discover: async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("token=private-value");
      if (attempts === 2) return { models: [], existingModelIds: [] };
      return { models: [{ id: "already", label: "Already configured" }], existingModelIds: ["already"] };
    },
  });
  assert.equal(buttonWithText(harness.tree, "解析模型").props.disabled, true);
  assert.equal(buttonWithText(harness.tree, "解析模型").props.loading, false);
  providers.resolve({ providers: [{ id: "local", label: "Local", baseUrl: "http://localhost", protocol: "openai-responses", mode: "multi" }] });
  await harness.settle();
  assert.equal(buttonWithText(harness.tree, "解析模型").props.disabled, false);
  buttonWithText(harness.tree, "解析模型").props.onClick();
  await harness.settle();
  assert.match(treeText(harness.tree), /解析模型失败/);
  assert.doesNotMatch(treeText(harness.tree), /private-value/);
  buttonWithText(harness.tree, "解析模型").props.onClick();
  await harness.settle();
  assert.match(treeText(harness.tree), /未发现可用模型/);
  buttonWithText(harness.tree, "解析模型").props.onClick();
  await harness.settle();
  assert.match(treeText(harness.tree), /模型均已配置/);
});

test("modal execution refuses an import after draft or config identity changes", async () => {
  const apply = deferred<AnyRecord>();
  const originalDraft: AnyRecord = { content: "original" };
  const changedDraft: AnyRecord = { content: "changed" };
  let imported = 0;
  const harness = createModelImportModalHarness({
    providers: async () => ({ providers: [{ id: "local", label: "Local", baseUrl: "http://localhost", protocol: "openai-responses", mode: "single" }] }),
    discover: async () => ({ models: [{ id: "fresh", label: "Fresh" }], existingModelIds: [] }),
    apply: async () => apply.promise,
    getCurrentDraft: () => originalDraft,
    getCurrentConfigIdentity: () => "claude:1",
    onImported: async () => { imported += 1; return true; },
  });
  await harness.settle();
  buttonWithText(harness.tree, "解析模型").props.onClick();
  await harness.settle();
  const submitPromise = buttonWithText(harness.tree, "导入").props.onClick();
  harness.render();
  assert.equal(findNodes(harness.tree, (node) => node.type === "input" && node.props?.disabled === true).length > 0, true);
  harness.render({
    getCurrentDraft: () => changedDraft,
    getCurrentConfigIdentity: () => "claude:2",
  });
  apply.resolve({ draft: { content: "must-not-apply" } });
  await submitPromise;
  await harness.settle();
  assert.equal(imported, 0);
  assert.match(treeText(harness.tree), /请重新解析/);
});

test("provider, discovery, and import rejections ignore concurrent draft changes and release loading", async () => {
  const providerRequest = deferred<AnyRecord>();
  let currentDraft: AnyRecord = { content: "original" };
  const providerHarness = createModelImportModalHarness({
    providers: () => providerRequest.promise,
    discover: async () => ({ models: [], existingModelIds: [] }),
    getCurrentDraft: () => currentDraft,
  });
  currentDraft = { content: "edited while providers load" };
  providerRequest.reject(new Error("token=private-provider-value"));
  await providerHarness.settle();
  assert.match(treeText(providerHarness.tree), /关闭并重新打开模型导入/);
  assert.doesNotMatch(treeText(providerHarness.tree), /private-provider-value/);
  assert.equal(findNodes(providerHarness.tree, (node) => node.type === "Modal")[0].props.children.props["aria-busy"], false);

  const discoveryRequest = deferred<AnyRecord>();
  currentDraft = { content: "original" };
  const discoveryHarness = createModelImportModalHarness({
    providers: async () => ({ providers: [{ id: "local", label: "Local", baseUrl: "http://localhost", protocol: "openai-responses", mode: "multi" }] }),
    discover: () => discoveryRequest.promise,
    getCurrentDraft: () => currentDraft,
  });
  await discoveryHarness.settle();
  buttonWithText(discoveryHarness.tree, "解析模型").props.onClick();
  discoveryHarness.render();
  currentDraft = { content: "edited during discovery" };
  discoveryRequest.reject(new Error("token=private-discovery-value"));
  await discoveryHarness.settle();
  assert.match(treeText(discoveryHarness.tree), /已忽略过期结果/);
  assert.doesNotMatch(treeText(discoveryHarness.tree), /private-discovery-value/);
  assert.equal(buttonWithText(discoveryHarness.tree, "解析模型").props.loading, false);

  const importRequest = deferred<AnyRecord>();
  currentDraft = { content: "original" };
  let currentIdentity = "claude:1";
  const importHarness = createModelImportModalHarness({
    providers: async () => ({ providers: [{ id: "single", label: "Single", baseUrl: "http://localhost", protocol: "anthropic-messages", mode: "single" }] }),
    discover: async () => ({ models: [{ id: "model", label: "Model" }], existingModelIds: [] }),
    apply: () => importRequest.promise,
    getCurrentDraft: () => currentDraft,
    getCurrentConfigIdentity: () => currentIdentity,
  });
  await importHarness.settle();
  buttonWithText(importHarness.tree, "解析模型").props.onClick();
  await importHarness.settle();
  const submitPromise = buttonWithText(importHarness.tree, "导入").props.onClick();
  importHarness.render();
  currentIdentity = "claude:2";
  importRequest.reject(new Error("token=private-import-value"));
  await submitPromise;
  await importHarness.settle();
  assert.match(treeText(importHarness.tree), /已忽略过期结果/);
  assert.doesNotMatch(treeText(importHarness.tree), /private-import-value/);
  assert.equal(findNodes(importHarness.tree, (node) => node.type === "Modal")[0].props.children.props["aria-busy"], false);
});

test("modal execution deduplicates multi selections and excludes configured models, while single mode stays radio-only", async () => {
  let submittedMulti: AnyRecord = {};
  const multiHarness = createModelImportModalHarness({
    providers: async () => ({ providers: [{ id: "multi", label: "Multi", baseUrl: "http://localhost", protocol: "openai-responses", mode: "multi" }] }),
    discover: async () => ({ models: [
      { id: "configured", label: "Configured" },
      { id: "new", label: "New" },
      { id: "new", label: "Duplicate New" },
    ], existingModelIds: ["configured"] }),
    apply: async (payload) => {
      submittedMulti = payload;
      return { draft: { content: "updated" } };
    },
  });
  await multiHarness.settle();
  buttonWithText(multiHarness.tree, "解析模型").props.onClick();
  await multiHarness.settle();
  const multiInputs = findNodes(multiHarness.tree, (node) => node.type === "input" && node.props?.["aria-label"]);
  const newModelInput = multiInputs.find((node) => node.props["aria-label"] === "New");
  assert.ok(newModelInput);
  assert.equal(multiInputs.some((node) => node.props["aria-label"] === "Configured"), false);
  newModelInput.props.onChange({ target: { checked: true } });
  newModelInput.props.onChange({ target: { checked: true } });
  multiHarness.render();
  await buttonWithText(multiHarness.tree, "导入").props.onClick();
  await multiHarness.settle();
  assert.deepEqual(plain(submittedMulti.selectedModelIds), ["new"]);

  const singleHarness = createModelImportModalHarness({
    providers: async () => ({ providers: [{ id: "single", label: "Single", baseUrl: "http://localhost", protocol: "openai-responses", mode: "single" }] }),
    discover: async () => ({ models: [{ id: "configured", label: "Configured" }, { id: "replacement", label: "Replacement" }], existingModelIds: ["configured"] }),
  });
  await singleHarness.settle();
  buttonWithText(singleHarness.tree, "解析模型").props.onClick();
  await singleHarness.settle();
  const singleInputs = findNodes(singleHarness.tree, (node) => node.type === "input" && node.props?.type === "radio");
  assert.equal(singleInputs.length, 1);
  assert.equal(singleInputs[0].props["aria-label"], "Replacement");
  assert.equal(singleInputs[0].props.checked, true);
});

test("Claude execution exposes exact field keys and allows one discovered model across fields", async () => {
  let submittedPayload: AnyRecord = {};
  const fields = [
    { key: "model", label: "model", value: "shared" },
    { key: "env.ANTHROPIC_DEFAULT_HAIKU_MODEL", label: "Haiku", value: "" },
    { key: "env.ANTHROPIC_DEFAULT_SONNET_MODEL", label: "Sonnet", value: "shared" },
    { key: "env.ANTHROPIC_DEFAULT_OPUS_MODEL", label: "Opus", value: "" },
    { key: "env.CLAUDE_CODE_SUBAGENT_MODEL", label: "子代理", value: "shared" },
  ];
  const harness = createModelImportModalHarness({
    providers: async () => ({ providers: [{ id: "claude", label: "Claude", baseUrl: "http://localhost", protocol: "anthropic-messages", mode: "claude" }] }),
    discover: async () => ({ models: [{ id: "shared", label: "Shared" }, { id: "new", label: "New" }], existingModelIds: ["shared"], fields }),
    apply: async (payload) => {
      submittedPayload = payload;
      return { draft: { content: "updated" } };
    },
  });
  await harness.settle();
  buttonWithText(harness.tree, "解析模型").props.onClick();
  await harness.settle();
  const fieldSelects = findNodes(harness.tree, (node) => node.type === "Select" && ["model", "Haiku", "Sonnet", "Opus", "子代理"].includes(node.props?.["aria-label"]));
  assert.equal(fieldSelects.length, 5);
  for (const select of fieldSelects) assert.ok(select.props.options.some((option: AnyRecord) => option.value === "shared"));
  fieldSelects.find((select) => select.props["aria-label"] === "Haiku")!.props.onChange("shared");
  harness.render();
  await buttonWithText(harness.tree, "导入").props.onClick();
  await harness.settle();
  assert.deepEqual(plain(submittedPayload.selectedModelIds), ["shared"]);
  assert.deepEqual(plain(submittedPayload.fields), {
    model: "shared",
    "env.ANTHROPIC_DEFAULT_HAIKU_MODEL": "shared",
    "env.ANTHROPIC_DEFAULT_SONNET_MODEL": "shared",
    "env.ANTHROPIC_DEFAULT_OPUS_MODEL": "",
    "env.CLAUDE_CODE_SUBAGENT_MODEL": "shared",
  });
  assert.deepEqual(fields.map((field) => field.key), [
    "model",
    "env.ANTHROPIC_DEFAULT_HAIKU_MODEL",
    "env.ANTHROPIC_DEFAULT_SONNET_MODEL",
    "env.ANTHROPIC_DEFAULT_OPUS_MODEL",
    "env.CLAUDE_CODE_SUBAGENT_MODEL",
  ]);
});

test("clearing a Claude selection restores its nonempty original value in UI and payload", async () => {
  let submittedPayload: AnyRecord = {};
  let importedDraft: AnyRecord = {};
  const fields = [
    { key: "model", label: "model", value: "original-model" },
    { key: "env.ANTHROPIC_DEFAULT_HAIKU_MODEL", label: "Haiku", value: "" },
    { key: "env.ANTHROPIC_DEFAULT_SONNET_MODEL", label: "Sonnet", value: "" },
    { key: "env.ANTHROPIC_DEFAULT_OPUS_MODEL", label: "Opus", value: "" },
    { key: "env.CLAUDE_CODE_SUBAGENT_MODEL", label: "子代理", value: "" },
  ];
  const harness = createModelImportModalHarness({
    providers: async () => ({ providers: [{ id: "claude", label: "Claude", baseUrl: "http://localhost", protocol: "anthropic-messages", mode: "claude" }] }),
    discover: async () => ({ models: [{ id: "discovered-model", label: "Discovered" }], existingModelIds: [], fields }),
    apply: async (payload) => {
      submittedPayload = payload;
      return { draft: { content: JSON.stringify({
        model: payload.fields.model,
        env: { ANTHROPIC_DEFAULT_HAIKU_MODEL: payload.fields["env.ANTHROPIC_DEFAULT_HAIKU_MODEL"] },
      }) } };
    },
    onImported: (draft) => { importedDraft = draft; return true; },
  });
  await harness.settle();
  buttonWithText(harness.tree, "解析模型").props.onClick();
  await harness.settle();
  let modelSelect = findNodes(harness.tree, (node) => node.type === "Select" && node.props?.["aria-label"] === "model")[0];
  assert.equal(modelSelect.props.value, "original-model");
  assert.ok(modelSelect.props.options.some((option: AnyRecord) => option.value === "original-model"));
  modelSelect.props.onChange("discovered-model");
  harness.render();
  modelSelect = findNodes(harness.tree, (node) => node.type === "Select" && node.props?.["aria-label"] === "model")[0];
  modelSelect.props.onChange(undefined);
  harness.render();
  modelSelect = findNodes(harness.tree, (node) => node.type === "Select" && node.props?.["aria-label"] === "model")[0];
  assert.equal(modelSelect.props.value, "original-model");
  assert.match(modelSelect.props.options.find((option: AnyRecord) => option.value === "").label, /保留原值/);
  const haikuSelect = findNodes(harness.tree, (node) => node.type === "Select" && node.props?.["aria-label"] === "Haiku")[0];
  haikuSelect.props.onChange("discovered-model");
  harness.render();
  await buttonWithText(harness.tree, "导入").props.onClick();
  await harness.settle();
  assert.equal(submittedPayload.fields.model, "original-model");
  assert.equal(submittedPayload.fields["env.ANTHROPIC_DEFAULT_HAIKU_MODEL"], "discovered-model");
  assert.deepEqual(JSON.parse(importedDraft.content), {
    model: "original-model",
    env: { ANTHROPIC_DEFAULT_HAIKU_MODEL: "discovered-model" },
  });
});

test("failed visual serialization returns an actionable error without old source fallback", () => {
  const utils = loadModelImportUiUtilities();
  assert.deepEqual(plain(utils.modelImportSerializationResult({ ok: false, error: "当前配置无效" }, () => ({ content: "old-source" }))), {
    ok: false,
    error: "操作失败，请检查当前配置后重试。",
  });
});

test("parent OpenCode handlers read and apply provider imports in source and visual modes without saving", async () => {
  const oldContent = JSON.stringify({
    provider: {
      openai: { models: { "openai/old": {} } },
      anthropic: { models: { "anthropic/keep": { name: "keep" } } },
    },
    unrelated: { keep: true },
  });
  for (const selectedProvider of ["openai", "anthropic"]) {
    const selectedModel = `${selectedProvider}/new`;
    const newConfigContent = JSON.stringify({
      provider: {
        openai: { models: { "openai/old": {}, ...(selectedProvider === "openai" ? { [selectedModel]: { name: selectedModel } } : {}) } },
        anthropic: { models: { "anthropic/keep": { name: "keep" }, ...(selectedProvider === "anthropic" ? { [selectedModel]: { name: selectedModel } } : {}) } },
      },
      unrelated: { keep: true },
    });
    for (const editorMode of ["json", "visual"]) {
      const parent = loadParentModelImportDraftHarness({
        platform: "opencode",
        editorMode,
        content: oldContent,
        visualContent: oldContent,
      });
      const readResult = parent.readModelImportDraft();
      assert.equal(readResult.ok, true);
      assert.deepEqual(JSON.parse(readResult.draft.content), JSON.parse(oldContent));
      const applied = await parent.handleModelImport({ content: oldContent, configContent: newConfigContent }, {
        configIdentity: "opencode:opencode-config",
        draft: readResult.draft,
      });
      assert.equal(applied, true);
      const displayed = JSON.parse(parent.state.textContent);
      assert.equal(displayed.provider[selectedProvider].models[selectedModel].name, selectedModel);
      assert.ok(displayed.provider.openai.models["openai/old"]);
      assert.equal(displayed.provider.anthropic.models["anthropic/keep"].name, "keep");
      assert.equal(displayed.provider[selectedProvider === "openai" ? "anthropic" : "openai"].models[selectedModel], undefined);
      assert.equal(displayed.unrelated.keep, true);
      assert.deepEqual(parent.calls, [{ kind: "opencode", value: newConfigContent, mode: editorMode }]);
      assert.equal(parent.state.modalOpen, false);
      assert.deepEqual(parent.messages, [{ type: "success", message: "已导入模型，请确认后保存" }]);
      assert.equal(parent.calls.some((call: AnyRecord) => call.kind === "save" || call.kind === "activate"), false);
    }
  }
  const fallback = loadParentModelImportDraftHarness({ platform: "opencode", editorMode: "json", content: oldContent });
  const fallbackConfig = JSON.stringify({ provider: { fallback: { models: {} } } });
  assert.equal(fallback.applyModelImportDraft({ content: oldContent, configContent: fallbackConfig }), true);
  assert.equal(fallback.calls[0].value, fallbackConfig);
});

test("invalid OpenCode visual draft cannot open import or proceed to provider loading", () => {
  const parent = loadParentModelImportDraftHarness({
    platform: "opencode",
    editorMode: "visual",
    content: "source-before-error",
    serializationError: "可视化配置无效",
  });
  parent.openModelImport();
  assert.equal(parent.state.modalOpen, false);
  assert.equal(parent.state.modalDraft, null);
  assert.equal(parent.calls.length, 0);
  assert.match(parent.messages[0].message, /切换到源码模式修复后重试/);
});

test("OpenCode source-mode import preserves and validates JSONC comments", async () => {
  const original = `{
    // existing config comment
    "provider": {"openai": {"models": {"openai/old": {}}}},
  }`;
  const imported = `{
    // imported model comment must remain in the source editor
    "provider": {"openai": {"models": {"vendor/model-name": {"name": "Vendor Model"},},},},
    "model": "openai/vendor/model-name",
    "small_model": "openai/vendor/model-name",
  }`;
  const parent = loadParentModelImportDraftHarness({ platform: "opencode", editorMode: "json", content: original });
  const readResult = parent.readModelImportDraft();
  assert.equal(readResult.ok, true);
  assert.equal(readResult.draft.content, original);
  assert.equal(await parent.handleModelImport({ content: "stale", configContent: imported }, {
    configIdentity: "opencode:opencode-config",
    draft: readResult.draft,
  }), true);
  assert.equal(parent.state.textContent, imported);
  assert.match(parent.state.textContent, /imported model comment/);
  assert.equal(parent.sandbox.__validateConfigJsonForSave(imported, "config.json", true), true);
  assert.equal(parent.sandbox.__parseConfigJsonText(imported, true).model, "openai/vendor/model-name");
  assert.equal(parent.calls.some((call: AnyRecord) => call.kind === "save" || call.kind === "activate"), false);
});

test("OpenCode visual import preserves slash model IDs through mode switch and save validation", async () => {
  const original = JSON.stringify({
    provider: {
      openai: { models: { old: { name: "Old" } } },
      other: { options: { baseURL: "https://other.example.test", apiKey: "keep" }, models: { keep: { name: "Keep" } } },
    },
    model: "openai/old",
    small_model: "openai/old",
    unrelated: { keep: true },
  });
  const imported = JSON.stringify({
    provider: {
      openai: { models: { old: { name: "Old" }, "vendor/model-name": { name: "Vendor Model", reasoning: true } } },
      other: { options: { baseURL: "https://other.example.test", apiKey: "keep" }, models: { keep: { name: "Keep" } } },
    },
    model: "openai/vendor/model-name",
    small_model: "openai/vendor/model-name",
    unrelated: { keep: true },
  });
  const parent = loadParentModelImportDraftHarness({ platform: "opencode", editorMode: "visual", content: original });
  const readResult = parent.readModelImportDraft();
  assert.equal(readResult.ok, true);
  assert.deepEqual(JSON.parse(readResult.draft.content), JSON.parse(original));
  assert.equal(await parent.handleModelImport({ content: original, configContent: imported }, {
    configIdentity: "opencode:opencode-config",
    draft: readResult.draft,
  }), true);
  assert.equal(JSON.parse(parent.state.textContent).provider.openai.models["vendor/model-name"].name, "Vendor Model");
  parent.switchOpenCodeEditorMode("json");
  assert.equal(parent.state.editorMode, "json");
  const switched = JSON.parse(parent.state.textContent);
  assert.equal(switched.model, "openai/vendor/model-name");
  assert.equal(switched.small_model, "openai/vendor/model-name");
  assert.equal(switched.provider.openai.models["vendor/model-name"].name, "Vendor Model");
  assert.equal(switched.provider.other.options.apiKey, "keep");
  assert.equal(switched.provider.other.models.keep.name, "Keep");
  assert.equal(switched.unrelated.keep, true);
  assert.equal(parent.sandbox.__validateConfigJsonForSave(parent.state.textContent, "config.json", true), true);
  assert.equal(parent.calls.some((call: AnyRecord) => call.kind === "save" || call.kind === "activate"), false);
});

test("modal sends the selected one of two OpenCode suppliers and keeps Claude empty results explicit", async () => {
  let appliedPayload: AnyRecord = {};
  const harness = createModelImportModalHarness({
    platform: "opencode",
    draft: { content: '{"provider":{"first":{},"second":{}}}' },
    providers: async () => ({ providers: [
      { id: "first", label: "First", baseUrl: "http://first", protocol: "openai-responses", mode: "multi" },
      { id: "second", label: "Second", baseUrl: "http://second", protocol: "openai-responses", mode: "multi" },
    ] }),
    discover: async (payload) => ({ models: [{ id: payload.providerId, label: payload.providerId }], existingModelIds: [] }),
    apply: async (payload) => {
      appliedPayload = payload;
      return { draft: { configContent: JSON.stringify({ provider: payload.providerId }) } };
    },
  });
  await harness.settle();
  const providerSelect = findNodes(harness.tree, (node) => node.type === "Select" && node.props?.["aria-label"] === "模型导入供应商")[0];
  providerSelect.props.onChange("second");
  harness.render();
  buttonWithText(harness.tree, "解析模型").props.onClick();
  await harness.settle();
  const model = findNodes(harness.tree, (node) => node.type === "input" && node.props?.["aria-label"] === "second")[0];
  model.props.onChange({ target: { checked: true } });
  harness.render();
  await buttonWithText(harness.tree, "导入").props.onClick();
  await harness.settle();
  assert.equal(appliedPayload.providerId, "second");
  assert.equal(appliedPayload.platform, "opencode");
  assert.deepEqual(plain(appliedPayload.selectedModelIds), ["second"]);

  const emptyClaude = createModelImportModalHarness({
    providers: async () => ({ providers: [{ id: "claude", label: "Claude", baseUrl: "http://claude", protocol: "anthropic-messages", mode: "claude" }] }),
    discover: async () => ({ models: [], existingModelIds: [], fields: [{ key: "model", value: "old" }] }),
  });
  await emptyClaude.settle();
  buttonWithText(emptyClaude.tree, "解析模型").props.onClick();
  await emptyClaude.settle();
  assert.match(treeText(emptyClaude.tree), /未发现可选 Claude 模型/);
  assert.equal(buttonWithText(emptyClaude.tree, "导入").props.disabled, true);
});
