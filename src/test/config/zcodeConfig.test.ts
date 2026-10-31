import assert = require("node:assert/strict");
import * as fs from "node:fs";
import * as path from "node:path";
import test = require("node:test");
import * as vm from "node:vm";
import {
  createZcodeExampleText,
  mergeZcodeProviderConfigText,
  parseZcodeProviderConfig,
  readZcodeConfigModels,
  resolveZcodeModelWireForRun,
  ZCODE_EXAMPLE_API_KEY_PLACEHOLDER,
  ZCODE_EXAMPLE_BASE_URL,
  ZCODE_EXAMPLE_MODEL_ID,
  ZCODE_GLM_FLASH_SUB_COCO_MODEL_ID,
} from "../../config/zcodeConfig";

type AnyRecord = Record<string, any>;

function loadZcodeUiSource(): string {
  return fs.readFileSync(path.join(process.cwd(), "media/config/assets/config-app-ui.js"), "utf8");
}

function extractBetween(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.notEqual(start, -1, `missing section start: ${startMarker}`);
  assert.notEqual(end, -1, `missing section end: ${endMarker}`);
  return source.slice(start, end);
}

function loadZcodeVisualUi() {
  const source = loadZcodeUiSource();
  const utilitySource = extractBetween(source, "// ZCODE_VISUAL_EDITOR_UTILS_START", "// ZCODE_VISUAL_EDITOR_UTILS_END");
  const utilitySandbox: AnyRecord = {};
  vm.runInNewContext(`${utilitySource}\nglobalThis.__utils = ZcodeConfigVisualEditorUtils;`, utilitySandbox);

  const rendererMarker = "const renderZcodeVisualEditor = ";
  const rendererStart = source.indexOf(rendererMarker);
  const rendererEnd = source.indexOf(";\n// ZCODE_VISUAL_EDITOR_UTILS_END", rendererStart);
  assert.notEqual(rendererStart, -1, "ZCode visual renderer should exist");
  assert.notEqual(rendererEnd, -1, "ZCode visual renderer should end at its utility boundary");
  const renderer = source.slice(rendererStart + rendererMarker.length, rendererEnd);
  const makeNode = (type: unknown, props: AnyRecord) => ({ type, props });
  let confirmation: AnyRecord | null = null;
  const renderSandbox: AnyRecord = {
    ZCODE_VISUAL_API_TYPES: ["openai-chat-completions", "openai-responses", "anthropic-messages"],
    AH: "DeleteIcon",
    be: {
      jsx: makeNode,
      jsxs: makeNode,
    },
    xr: {
      confirm: (options: AnyRecord) => {
        confirmation = options;
      },
    },
    renderField: (label: string, value: unknown, onChange: (next: string) => void, placeholder: string, options: AnyRecord) => ({
      type: "field",
      props: { label, value, onChange, placeholder, options },
    }),
    renderSelect: (label: string, value: unknown, onChange: (next: string) => void, options: AnyRecord[], controlOptions: AnyRecord) => ({
      type: "select",
      props: { label, value, onChange, options, controlOptions },
    }),
    Button: "AntButton",
    zcodeVisualAddModel: utilitySandbox.__utils.addModel,
    zcodeVisualDeleteModel: utilitySandbox.__utils.deleteModel,
  };
  vm.runInNewContext(
    `const renderZcodeVisualEditor = (${renderer});\nglobalThis.__render = renderZcodeVisualEditor;`,
    renderSandbox,
  );
  return {
    utils: utilitySandbox.__utils,
    render: renderSandbox.__render,
    renderSandbox,
    getConfirmation: () => confirmation,
  };
}

function findNode(node: AnyRecord, predicate: (candidate: AnyRecord) => boolean): AnyRecord | undefined {
  if (!node || typeof node !== "object") return undefined;
  if (predicate(node)) return node;
  const children = node.props?.children;
  for (const child of Array.isArray(children) ? children : [children]) {
    const found = findNode(child, predicate);
    if (found) return found;
  }
  return undefined;
}

test("example config uses the local OpenAI Responses endpoint and a placeholder key", () => {
  const text = createZcodeExampleText();
  assert.match(text, new RegExp(ZCODE_EXAMPLE_BASE_URL.replace(/[.]/g, "\\.")));
  assert.match(text, new RegExp(ZCODE_EXAMPLE_MODEL_ID));
  assert.match(text, new RegExp(ZCODE_EXAMPLE_API_KEY_PLACEHOLDER));
  assert.equal(text.includes("sk-"), false);
  const models = readZcodeConfigModels(text);
  assert.deepEqual(models.models, [`local-glm/${ZCODE_EXAMPLE_MODEL_ID}`]);
  assert.deepEqual(models.labels, { [`local-glm/${ZCODE_EXAMPLE_MODEL_ID}`]: ZCODE_EXAMPLE_MODEL_ID });
  assert.equal(models.error, null);
  const parsed = parseZcodeProviderConfig(text);
  assert.deepEqual(parsed?.models[0].reasoningLevels, ["max"]);
  assert.equal(parsed?.defaultReasoningLevel, "high");
  const document = JSON.parse(text);
  assert.equal(document.config.providerConfigRules.providerRules[0].config.api.type, "openai-responses");
  assert.deepEqual(document.config.defaultModelSelection.options, { reasoningLevel: "high" });
  assert.deepEqual(document.config.modelConfigRules, { providerModelRules: [], manualProviderModelRules: [] });
  assert.equal(document.config.providerOrder, undefined);
  assert.equal(document.config.providerConfigRules.providerRules[0].providerName, undefined);
  assert.equal(document.config.providerConfigRules.providerRules[0].enabled, undefined);
  assert.equal(document.config.providerConfigRules.providerRules[0].config.group, "standard-personal");
});

test("model labels preserve modelId without the provider prefix or truncating model namespaces", () => {
  const document = JSON.parse(createZcodeExampleText());
  document.config.providerConfigRules.providerRules[0].config.personalModelIds.push("vendor/second-model");
  const text = JSON.stringify(document);
  const models = readZcodeConfigModels(text);

  assert.deepEqual(models.models, [`local-glm/${ZCODE_EXAMPLE_MODEL_ID}`, "local-glm/vendor/second-model"]);
  assert.deepEqual(models.labels, {
    [`local-glm/${ZCODE_EXAMPLE_MODEL_ID}`]: ZCODE_EXAMPLE_MODEL_ID,
    "local-glm/vendor/second-model": "vendor/second-model",
  });
  assert.equal(models.defaultModel, `local-glm/${ZCODE_EXAMPLE_MODEL_ID}`);
  assert.equal(resolveZcodeModelWireForRun(text, "local-glm/vendor/second-model"), "local-glm/vendor/second-model");
});

test("empty or invalid configs do not expose model labels", () => {
  for (const text of ["", "  ", "{not-json"]) {
    const models = readZcodeConfigModels(text);
    assert.deepEqual(models.models, []);
    assert.deepEqual(models.labels, {});
    assert.equal(models.defaultModel, null);
    assert.equal(Boolean(models.error), Boolean(text.trim()));
  }
  const document = JSON.parse(createZcodeExampleText());
  document.config.providerConfigRules.providerRules[0].config.personalModelIds = [];
  assert.deepEqual(readZcodeConfigModels(JSON.stringify(document)), {
    models: [], labels: {}, defaultModel: null, error: null,
  });
});

test("visual editor preserves an explicitly configured chat completions API type", () => {
  const { utils } = loadZcodeVisualUi();
  const document = JSON.parse(createZcodeExampleText());
  document.config.providerConfigRules.providerRules[0].config.api.type = "openai-chat-completions";
  const parsed = utils.parseContent(JSON.stringify(document));
  assert.equal(parsed.ok, true);
  const serialized = utils.serializeState(parsed.state);
  assert.equal(serialized.ok, true);
  assert.deepEqual(JSON.parse(serialized.content), document);
});

test("legacy GLM model without a manual reasoning rule defaults to max", () => {
  const document = JSON.parse(createZcodeExampleText());
  document.config.defaultModelSelection.modelId = ZCODE_GLM_FLASH_SUB_COCO_MODEL_ID;
  document.config.providerConfigRules.providerRules[0].config.personalModelIds = [ZCODE_GLM_FLASH_SUB_COCO_MODEL_ID];
  document.config.modelConfigRules.providerModelRules = [];
  document.config.modelConfigRules.manualProviderModelRules = [];
  delete document.config.defaultModelSelection.options;

  const parsed = parseZcodeProviderConfig(JSON.stringify(document));
  assert.deepEqual(parsed?.models[0].reasoningLevels, ["max"]);
  assert.equal(
    resolveZcodeModelWireForRun(JSON.stringify(document), `local-glm/${ZCODE_GLM_FLASH_SUB_COCO_MODEL_ID}`),
    `local-glm/${ZCODE_GLM_FLASH_SUB_COCO_MODEL_ID}$max`,
  );
});

test("run model wire carries the required default reasoning level without capability overrides", () => {
  assert.equal(
    resolveZcodeModelWireForRun(createZcodeExampleText(), `local-glm/${ZCODE_EXAMPLE_MODEL_ID}`),
    `local-glm/${ZCODE_EXAMPLE_MODEL_ID}$high`,
  );
});

test("explicit default reasoning takes precedence over capability order and is scoped to its model", () => {
  const document = JSON.parse(createZcodeExampleText());
  document.config.defaultModelSelection.options.reasoningLevel = "high";
  document.config.providerConfigRules.providerRules[0].config.personalModelIds.push(ZCODE_GLM_FLASH_SUB_COCO_MODEL_ID);
  document.config.modelConfigRules.providerModelRules.push({
    providerId: "local-glm", modelId: ZCODE_EXAMPLE_MODEL_ID,
    config: { optionSpecs: { reasoningLevel: { values: ["low", "high", "max"] } } },
  });
  const text = JSON.stringify(document);
  assert.equal(resolveZcodeModelWireForRun(text, null), `local-glm/${ZCODE_EXAMPLE_MODEL_ID}$high`);
  assert.equal(resolveZcodeModelWireForRun(text, `local-glm/${ZCODE_GLM_FLASH_SUB_COCO_MODEL_ID}`), `local-glm/${ZCODE_GLM_FLASH_SUB_COCO_MODEL_ID}$max`);
});

test("simplified config retains the native schema arrays and refuses incomplete documents", () => {
  const document = JSON.parse(createZcodeExampleText());
  delete document.config.modelConfigRules.manualProviderModelRules;
  assert.equal(parseZcodeProviderConfig(JSON.stringify(document)), null);
  const { utils } = loadZcodeVisualUi();
  const parsed = utils.parseContent(JSON.stringify(document));
  assert.equal(parsed.ok, false);
  assert.match(parsed.error, /必需.*数组/);
});

test("merge keeps unrelated providers and refuses an invalid existing document", () => {
  const current = JSON.stringify({
    schemaVersion: 1,
    config: {
      providerOrder: ["other"],
      providerConfigRules: {
        providerRules: [{
          providerId: "other",
          providerName: "Other",
          enabled: true,
          config: { personalModelIds: ["keep-me"] },
        }],
      },
      modelConfigRules: { providerModelRules: [], manualProviderModelRules: [] },
    },
  });
  const merged = mergeZcodeProviderConfigText(current, createZcodeExampleText());
  assert.equal(merged.ok, true);
  if (!merged.ok) {
    return;
  }
  const document = JSON.parse(merged.content);
  const ids = document.config.providerConfigRules.providerRules.map((rule: { providerId: string }) => rule.providerId);
  assert.deepEqual(ids, ["other", "local-glm"]);
  assert.equal(document.config.providerConfigRules.providerRules[0].config.personalModelIds[0], "keep-me");
  const refused = mergeZcodeProviderConfigText("{not-json", createZcodeExampleText());
  assert.equal(refused.ok, false);
});

test("applying a minimal provider snapshot removes its old overrides without changing other providers", () => {
  const current = JSON.parse(createZcodeExampleText());
  const otherRule = { providerId: "other", modelId: "keep-me", config: { enabled: false } };
  current.config.modelConfigRules.providerModelRules = [
    otherRule,
    { providerId: "local-glm", modelId: ZCODE_EXAMPLE_MODEL_ID, config: { optionSpecs: { reasoningLevel: { values: ["max"] } } } },
  ];
  const merged = mergeZcodeProviderConfigText(JSON.stringify(current), createZcodeExampleText());
  assert.equal(merged.ok, true);
  if (!merged.ok) return;
  const document = JSON.parse(merged.content);
  assert.deepEqual(document.config.modelConfigRules.providerModelRules, [otherRule]);
  assert.equal(document.config.providerOrder, undefined);
  assert.equal(document.config.defaultModelSelection.options.reasoningLevel, "high");
});

test("visual editor reuses shared fields and keeps the common parameters above the model workspace", () => {
  const { utils, render, getConfirmation } = loadZcodeVisualUi();
  const parsed = utils.parseContent(createZcodeExampleText());
  assert.equal(parsed.ok, true);
  const visualExample = JSON.parse(utils.createExampleText());
  assert.equal(visualExample.config.defaultModelSelection.modelId, ZCODE_EXAMPLE_MODEL_ID);
  assert.deepEqual(visualExample, JSON.parse(createZcodeExampleText()));
  const serialized = utils.serializeState(parsed.state);
  assert.equal(serialized.ok, true);
  const serializedDocument = JSON.parse(serialized.content);
  assert.deepEqual(serializedDocument.config.modelConfigRules.manualProviderModelRules, []);
  assert.deepEqual(serializedDocument, JSON.parse(createZcodeExampleText()));

  let currentState = parsed.state;
  const update = (next: AnyRecord | ((previous: AnyRecord) => AnyRecord)) => {
    currentState = typeof next === "function" ? next(currentState) : next;
  };
  const tree = render(currentState, update, {
    controlsDisabled: false,
    renderField: (label: string, value: unknown, onChange: (next: string) => void, placeholder: string, options: AnyRecord) => ({
      type: "field",
      props: { label, value, onChange, placeholder, options },
    }),
    renderSelect: (label: string, value: unknown, onChange: (next: string) => void, options: AnyRecord[], controlOptions: AnyRecord) => ({
      type: "select",
      props: { label, value, onChange, options, controlOptions },
    }),
    Button: "AntButton",
  });

  assert.equal(tree.props.className, "zcode-visual-editor");
  const visualSections = tree.props.children;
  assert.equal(visualSections[0].props["data-testid"], "zcode-common-parameters");
  assert.equal(visualSections[1].props["data-testid"], "zcode-model-workspace");
  assert.equal(visualSections[0].props.children[0].props.children, "公共参数");
  assert.ok(findNode(tree, (node) => node.props?.["data-testid"] === "zcode-model-list"));
  assert.ok(findNode(tree, (node) => node.props?.["data-testid"] === "zcode-model-row"));
  assert.ok(findNode(tree, (node) => node.props?.["data-testid"] === "zcode-delete-model"));
  assert.ok(findNode(tree, (node) => node.props?.["data-testid"] === "zcode-model-detail"));
  assert.ok(findNode(tree, (node) => node.type === "select" && node.props.label === "默认模型"));

  const modelIdField = findNode(tree, (node) => node.type === "field" && node.props.label === "模型 ID");
  assert.ok(modelIdField);
  modelIdField.props.onChange("renamed-model");
  assert.equal(currentState.models[0].id, "renamed-model");
  assert.equal(currentState.defaultModelId, "renamed-model");
  assert.equal(currentState.selectedModelId, "renamed-model");

  const deleteTree = render(currentState, update, {
    renderField: (label: string, value: unknown, onChange: (next: string) => void, placeholder: string, options: AnyRecord) => ({
      type: "field",
      props: { label, value, onChange, placeholder, options },
    }),
    renderSelect: (label: string, value: unknown, onChange: (next: string) => void, options: AnyRecord[], controlOptions: AnyRecord) => ({
      type: "select",
      props: { label, value, onChange, options, controlOptions },
    }),
    Button: "AntButton",
  });
  const deleteButton = findNode(deleteTree, (node) => node.props?.["data-testid"] === "zcode-delete-model");
  assert.ok(deleteButton);
  let propagationStopped = false;
  deleteButton.props.onClick({ stopPropagation: () => { propagationStopped = true; } });
  assert.equal(propagationStopped, true);
  const deleteConfirmation = getConfirmation();
  assert.ok(deleteConfirmation);
  assert.match(deleteConfirmation.content, /其他模型和未展示字段会保留/);
  deleteConfirmation.onOk();
  assert.equal(currentState.models.length, 0);
  assert.equal(currentState.defaultModelId, "");

  const disabledTree = render(parsed.state, () => undefined, {
    controlsDisabled: true,
    renderField: (_label: string, _value: unknown, _onChange: (next: string) => void, _placeholder: string, options: AnyRecord) => ({
      type: "field",
      props: { options },
    }),
    renderSelect: (_label: string, _value: unknown, _onChange: (next: string) => void, _options: AnyRecord[], controlOptions: AnyRecord) => ({
      type: "select",
      props: { controlOptions },
    }),
    Button: "AntButton",
  });
  assert.equal(findNode(disabledTree, (node) => node.type === "field")?.props.options.disabled, true);
  assert.equal(findNode(disabledTree, (node) => node.type === "AntButton")?.props.disabled, true);
});

test("visual simplification preserves hidden provider and model overrides, including renamed manual models", () => {
  const { utils } = loadZcodeVisualUi();
  const document = JSON.parse(createZcodeExampleText());
  const provider = document.config.providerConfigRules.providerRules[0];
  provider.providerName = "Keep label";
  provider.enabled = false;
  const rule = {
    providerId: "local-glm", modelId: ZCODE_EXAMPLE_MODEL_ID,
    config: { enabled: false, properties: { contextWindow: 123456 }, optionSpecs: { reasoningLevel: { values: ["low", "high", "max"] } } },
  };
  document.config.modelConfigRules.manualProviderModelRules = [rule];
  document.config.defaultModelSelection.options.maxOutputTokens = 1024;
  const parsed = utils.parseContent(JSON.stringify(document));
  parsed.state.models[0].id = "renamed-model";
  parsed.state.defaultModelId = "renamed-model";
  parsed.state.defaultReasoningLevel = "high";
  const serialized = utils.serializeState(parsed.state);
  assert.equal(serialized.ok, true);
  const saved = JSON.parse(serialized.content);
  assert.deepEqual(saved.config.providerConfigRules.providerRules[0], { ...provider, config: { ...provider.config, personalModelIds: ["renamed-model"] } });
  assert.deepEqual(saved.config.modelConfigRules.manualProviderModelRules, [{ ...rule, modelId: "renamed-model" }]);
  assert.deepEqual(saved.config.modelConfigRules.providerModelRules, []);
  assert.deepEqual(saved.config.defaultModelSelection.options, { reasoningLevel: "high", maxOutputTokens: 1024 });
  assert.equal(utils.validateState({ ...parsed.state, defaultReasoningLevel: "" }).includes("思考力度"), true);
});

test("visual editor does not require or serialize unused reasoning parameters for other models", () => {
  const { utils } = loadZcodeVisualUi();
  const document = JSON.parse(createZcodeExampleText());
  document.config.defaultModelSelection.modelId = "plain-model";
  delete document.config.defaultModelSelection.options;
  document.config.providerConfigRules.providerRules[0].config.personalModelIds = ["plain-model"];
  const parsed = utils.parseContent(JSON.stringify(document));
  assert.equal(parsed.state.defaultReasoningLevel, "");
  assert.equal(utils.validateState(parsed.state), "");
  const serialized = utils.serializeState(parsed.state);
  assert.equal(serialized.ok, true);
  assert.equal(JSON.parse(serialized.content).config.defaultModelSelection.options, undefined);
  parsed.state.source.config.defaultModelSelection.options = { maxOutputTokens: 1024, reasoningLevel: "old" };
  const preserved = utils.serializeState(parsed.state);
  assert.equal(preserved.ok, true);
  assert.deepEqual(JSON.parse(preserved.content).config.defaultModelSelection.options, { maxOutputTokens: 1024 });
});

test("ZCode editor defaults to JSON on initial load, profile changes and example imports", () => {
  const source = loadZcodeUiSource();
  assert.match(source, /\[zcodeEditorMode, setZcodeEditorMode\] = c\.useState\("json"\)/);
  const branchMarker = '} else if (O.platform === "zcode") {';
  const loadBranch = extractBetween(source, branchMarker, '} else if (O.platform === "kimi-code") {').slice(branchMarker.length);
  const { utils } = loadZcodeVisualUi();
  const modes: string[] = [];
  const sandbox = {
    O: { configContent: createZcodeExampleText() },
    ZcodeConfigVisualEditorUtils: utils,
    setZcodeTextDraft: () => undefined,
    setZcodeEditorMode: (mode: string) => modes.push(mode),
    setZcodeVisualState: () => undefined,
    setZcodeVisualError: () => undefined,
    s: () => undefined, v: () => undefined, h: () => undefined,
  };
  vm.runInNewContext(loadBranch, sandbox);
  assert.deepEqual(modes, ["json"]);
  const renderer = extractBetween(source, "const renderZcodeVisualEditor = ", "// ZCODE_VISUAL_EDITOR_UTILS_END");
  assert.doesNotMatch(renderer, /renderField\("(?:Provider ID|显示名称|上下文窗口（tokens）|思考档位)"/);
  assert.match(renderer, /"默认思考力度"/);
});

test("ZCode editor uses the shared card header and imports its example into JSON mode", () => {
  const source = loadZcodeUiSource();
  const editorStart = source.indexOf('className: "config-editor-shell config-editor-zcode"');
  const editorEnd = source.indexOf(': O.platform === "kimi-code"', editorStart);
  assert.notEqual(editorStart, -1, "ZCode configuration card should exist");
  assert.ok(editorEnd > editorStart, "ZCode configuration card should end before Kimi Code");
  const zcodeEditor = source.slice(editorStart, editorEnd);

  assert.match(zcodeEditor, /be\.jsx\(aa, \{[\s\S]*?title: renderConfigEditorCardTitle\(/);
  assert.match(zcodeEditor, /"data-testid": "zcode-editor-mode"/);
  assert.match(zcodeEditor, /"data-testid": "zcode-save-config"/);
  assert.match(zcodeEditor, /onClick: \(\) => N\("zcode-config"\)/);
  assert.doesNotMatch(zcodeEditor, /zcode-import-example|一键导入/);
  assert.match(source, /case "zcode-config":\s*importZcodeExample\(\);\s*return;/);
  assert.match(source, /importZcodeExample = \(\) => \{[\s\S]*?syncZcodeVisualContent\(example, "json", !0\)/);
  assert.match(source, /Kt\.success\("已导入范例内容，请确认后保存"\)/);
  assert.match(source, /renderField\("API Key"[\s\S]*?type: "password"/);
  assert.match(zcodeEditor, /className: "config-editor-fixed-actions"[\s\S]*?children: "保存"/);
  assert.match(source, /const renderConfigEditorCardTitle = \(W, H, attributes = \{\}\)/);
});

test("ZCode example drawer opens, closes and imports from the shared drawer in both editor modes", () => {
  const source = loadZcodeUiSource();
  const platformStart = source.indexOf(': O.platform === "zcode"');
  const editorStart = source.indexOf('be.jsxs("div", {', platformStart);
  const editorEnd = source.indexOf(': O.platform === "kimi-code"', editorStart);
  const editor = source.slice(editorStart, editorEnd).trim();
  const drawerHandlers = extractBetween(source, 'N = (W) => y(W),', '      A = async (W) =>').replace(/,\s*$/, ";");
  const importHandler = extractBetween(source, 'importZcodeExample = () => {', '      switchDshEditorMode =').replace(/,\s*$/, ";");
  const { utils } = loadZcodeVisualUi();
  const example = { title: "ZCode provider_config.json", content: createZcodeExampleText() };
  const element = (type: unknown, props: AnyRecord) => ({ type, props });

  for (const mode of ["visual", "json"]) {
    const sandbox: AnyRecord = {
      be: { jsx: element, jsxs: element, Fragment: "fragment" },
      aa: "card", xn: "button", Pv: "icon", Ya: "icon", Qa: "textarea", ConfigSourceEditor: "textarea", RE: "drawer",
      O: { id: "zcode-test", name: "ZCode" },
      Nk: { "zcode-config": example }, S: null, I: null,
      configListLoading: false, zcodeEditorMode: mode,
      zcodeVisualError: "", zcodeVisualState: null, zcodeTextDraft: "",
      renderConfigEditorCardTitle: () => null,
      renderZcodeVisualEditor: () => null,
      renderCodexField: () => null, renderConfigSelect: () => null,
      Kt: { success: () => undefined },
      y: (key: string | null) => {
        sandbox.S = key;
        sandbox.I = key ? sandbox.Nk[key] : null;
      },
      syncZcodeVisualContent: (content: string, nextMode: string) => {
        const parsed = utils.parseContent(content);
        assert.equal(parsed.ok, true);
        sandbox.zcodeTextDraft = content;
        sandbox.zcodeVisualState = parsed.state;
        sandbox.zcodeEditorMode = nextMode;
        return true;
      },
    };
    vm.runInNewContext(`const ${drawerHandlers}\nconst ${importHandler}\nglobalThis.render = () => (${editor});`, sandbox);
    const drawer = () => {
      const node = findNode(sandbox.render(), (candidate) => candidate.type === "drawer");
      assert.ok(node, "ZCode must mount the shared example drawer");
      return node;
    };
    const openExample = () => {
      const button = findNode(sandbox.render(), (node) => node.props?.children === "查看范例");
      assert.ok(button);
      button.props.onClick();
      assert.equal(drawer().props.open, true);
      assert.equal(drawer().props.title, example.title);
      assert.equal(findNode(drawer(), (node) => node.type === "pre")?.props.children, example.content);
    };

    assert.equal(drawer().props.open, false);
    openExample();
    drawer().props.onClose();
    assert.equal(drawer().props.open, false);
    assert.equal(sandbox.zcodeTextDraft, "", "Closing the example must not import or save it");
    openExample();
    const importButton = findNode(drawer(), (node) => node.props?.children === "一键导入");
    assert.ok(importButton);
    importButton.props.onClick();
    assert.equal(sandbox.zcodeTextDraft, example.content);
    assert.equal(sandbox.zcodeEditorMode, "json");
    assert.equal(drawer().props.open, false);
  }
});
