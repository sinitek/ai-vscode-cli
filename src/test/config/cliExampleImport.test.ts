import assert = require("node:assert/strict");
import * as fs from "node:fs";
import * as path from "node:path";
import test = require("node:test");
import * as vm from "node:vm";

type AnyRecord = Record<string, any>;
type EditorNode = { type: unknown; props: AnyRecord };

const source = fs.readFileSync(path.join(process.cwd(), "media/config/assets/config-app-ui.js"), "utf8");
const values = { base_url: "https://api.example.com/v1", api_key: "example-import-key", model: "got-6.1-sol" };
const exampleKeys = ["claude-settings", "codex-config", "codex-auth", "opencode-settings", "grok-config", "dsh-config", "kimi-code-config", "zcode-config"];

function section(startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, `找不到 ${startMarker}`);
  return source.slice(start, end);
}

function nodes(value: unknown): EditorNode[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!value || typeof value !== "object" || !("props" in value)) return [];
  const node = value as EditorNode;
  return [node, ...nodes(node.props.children)];
}

function loadUtilities(overrides: AnyRecord = {}) {
  const element = (type: unknown, props: AnyRecord) => ({ type, props });
  const sandbox: AnyRecord = {
    URL, Error,
    be: { jsx: element, jsxs: element, Fragment: "fragment" },
    zi: "input", xr: "modal", xn: "button", RE: "drawer",
    $l: { SECRET_COMBOBOX_MODE_DO_NOT_USE: "combobox" },
    KH: "import-icon",
    getModelImportProviders: async () => ({ providers: [{ id: "gateway", baseUrl: values.base_url }] }),
    discoverImportModels: async () => ({ models: [{ id: values.model, label: values.model }] }),
    ...overrides,
  };
  vm.runInNewContext([
    section("function fk(", "const CLI_GLOBAL_SKILL_TARGETS ="),
    section("const DSH_UI_PROVIDER", "const CONFIG_FIELD_HELP_TOOLTIP_TITLE_FALLBACK_DELAY_MS"),
    section("// OPENCODE_VISUAL_EDITOR_UTILS_START", "// CODEX_VISUAL_EDITOR_UTILS_END"),
    section("function parseConfigJsonText(", "const GROK_VISUAL_FIELD_IDS"),
    section("const GROK_VISUAL_FIELD_IDS", "// Config editor panel"),
    "globalThis.utils = { build: buildCliExampleImport, validate: validateCliExampleImport, protocol: getCliExampleImportProtocol, modal: CliExampleImportModal, parseToml: g1, examples: Nk, templates: ps, claude: ClaudeConfigVisualEditorUtils, codex: CodexConfigVisualEditorUtils, opencode: OpenCodeConfigVisualEditorUtils, grok: GrokConfigVisualEditorUtils, kimi: KimiCodeConfigVisualEditorUtils, zcode: ZcodeConfigVisualEditorUtils, dsh: DshConfigPageUtils, protocolOptions: { codex: CODEX_VISUAL_WIRE_APIS, opencode: OPEN_CODE_PROVIDER_NPM_OPTIONS, grok: GROK_VISUAL_API_BACKENDS, dsh: DSH_UI_API_OPTIONS, kimi: KIMI_CODE_VISUAL_PROVIDER_TYPES, zcode: ZCODE_VISUAL_API_TYPES } };",
  ].join("\n"), sandbox);
  return { sandbox, utils: sandbox.utils as AnyRecord };
}

function readProtocol(utils: AnyRecord, exampleKey: string, imported: AnyRecord): unknown {
  const document = exampleKey === "opencode-settings" || exampleKey === "dsh-config" || exampleKey === "zcode-config"
    ? JSON.parse(imported.content)
    : utils.parseToml(imported.configContent || imported.content);
  switch (exampleKey) {
    case "codex-config":
    case "codex-auth": return document.model_providers[document.model_provider].wire_api;
    case "opencode-settings": return document.provider[document.model.split("/")[0]].npm;
    case "grok-config": return document.model[document.models.default].api_backend;
    case "dsh-config": return document.api;
    case "kimi-code-config": return document.providers[document.models[document.default_model].provider].type;
    case "zcode-config": return document.config.providerConfigRules.providerRules[0].config.api.type;
    default: throw new Error(`未知范例：${exampleKey}`);
  }
}

test("新增弹窗的跳过按钮位于创建按钮右侧，绕过必填校验且防重复操作", async () => {
  let skipped = 0;
  let resolveSkip: () => void = () => undefined;
  const harness = loadModalHarness({ platform: "codex", onSkip: () => {
    skipped++;
    return new Promise<void>((resolve) => { resolveSkip = resolve; });
  } });
  const footer = harness.render().props.footer;
  assert.deepEqual(Array.from(footer, (button: EditorNode) => button.props.children), ["取消", "创建配置", "跳过"]);
  const pending = footer[2].props.onClick();
  assert.equal(skipped, 1);
  assert.equal(harness.render().props.footer[2].props.disabled, true);
  await footer[2].props.onClick();
  assert.equal(skipped, 1);
  resolveSkip();
  await pending;
  assert.equal(loadModalHarness({ exampleKey: "codex-config" }).render().props.footer, undefined);
});

function loadModalHarness(props: AnyRecord) {
  const state: unknown[] = [];
  const refs: AnyRecord[] = [];
  let cursor = 0;
  let refCursor = 0;
  const imported: AnyRecord[] = [];
  const { utils, sandbox } = loadUtilities({
    configPlatformLabel: (platform: string) => platform,
    ...(props.bridge || {}),
    c: {
      useState: (initial: unknown) => {
        const index = cursor++;
        if (!(index in state)) state[index] = initial;
        return [state[index], (next: unknown) => {
          state[index] = typeof next === "function" ? (next as (previous: unknown) => unknown)(state[index]) : next;
        }];
      },
      useRef: (initial: unknown) => {
        const index = refCursor++;
        return refs[index] ||= { current: initial };
      },
      useEffect: () => undefined,
    },
  });
  const render = (onImport: (next: AnyRecord) => unknown = (next) => imported.push(next)) => {
    cursor = 0;
    refCursor = 0;
    return utils.modal({ onClose: () => undefined, onImport, ...props });
  };
  const field = (label: string) => nodes(render()).find((node) => node.props["aria-label"] === label);
  const status = () => nodes(render()).find((node) => node.props.role === "status");
  const resolve = () => nodes(render()).find((node) => node.props.className === "cli-example-import-resolve")!.props.onClick();
  const fillConnection = () => {
    for (const key of ["base_url", "api_key"]) {
      field(key)!.props.onChange({ target: { value: values[key as keyof typeof values] } });
    }
  };
  const fill = async () => {
    fillConnection();
    await resolve();
    field("模型名称")!.props.onChange({ target: { value: values.model } });
  };
  return { render, field, status, resolve, fillConnection, fill, imported, utils, sandbox };
}

test("协议字段及默认值读取各 CLI 范例，候选复用现有可视化选项，Claude 不暴露协议", () => {
  const { utils } = loadUtilities();
  for (const [exampleKey, field, expected, optionKey] of [
    ["codex-config", "wire_api", "responses", "codex"],
    ["codex-auth", "wire_api", "responses", "codex"],
    ["opencode-settings", "npm", "@ai-sdk/openai-compatible", "opencode"],
    ["grok-config", "api_backend", "responses", "grok"],
    ["dsh-config", "api", "openai-completions", "dsh"],
    ["kimi-code-config", "type", "openai", "kimi"],
    ["zcode-config", "api.type", "openai-responses", "zcode"],
  ]) {
    const protocol = utils.protocol(exampleKey);
    assert.equal(protocol.field, field);
    assert.equal(protocol.defaultValue, expected);
    const options = utils.protocolOptions[optionKey];
    assert.deepEqual(Array.from(protocol.options, (option: AnyRecord) => option.value), Array.from(options, (option: any) => typeof option === "string" ? option : option.value));
    assert.equal(readProtocol(utils, exampleKey, utils.build(exampleKey, values)), expected);
  }
  assert.equal(utils.protocol("claude-settings"), null);
  assert.equal(utils.protocol("unknown"), null);
  assert.deepEqual(utils.build("claude-settings", { ...values, protocol: "responses" }), utils.build("claude-settings", values));
  utils.examples["dsh-config"].content = utils.examples["dsh-config"].content.replace('"openai-completions"', '"anthropic-messages"');
  assert.equal(utils.protocol("dsh-config").defaultValue, "anthropic-messages");
});

test("所有协议选项写入正确层级并可重新载入编辑器，OpenCode 支持自定义 npm 包", () => {
  const { utils } = loadUtilities();
  const originals = JSON.stringify(utils.examples);
  for (const exampleKey of exampleKeys.filter((key) => key !== "claude-settings")) {
    const metadata = utils.protocol(exampleKey);
    const choices = metadata.options.map((option: AnyRecord) => option.value);
    if (metadata.allowCustomValue) choices.push("@example/custom-provider");
    for (const protocol of choices) {
      const imported = utils.build(exampleKey, { ...values, protocol: ` ${protocol} ` });
      assert.equal(readProtocol(utils, exampleKey, imported), protocol);
      if (exampleKey === "dsh-config") assert.equal(utils.dsh.readDocument(imported.content).ok, true);
      else {
        const editorKey = exampleKey.startsWith("codex") ? "codex" : exampleKey.startsWith("kimi") ? "kimi" : exampleKey.split("-")[0];
        const parsed = utils[editorKey].parseContent(imported.configContent || imported.content);
        assert.equal(parsed.ok, true, `${exampleKey}: ${protocol}: ${parsed.error}`);
        assert.ok(!parsed.state.fieldError, `${exampleKey}: ${protocol}: ${parsed.state.fieldError}`);
      }
    }
  }
  assert.equal(JSON.stringify(utils.examples), originals);
});

test("协议缺失沿用范例，显式空值、非法类型、控制字符或不支持的协议阻止生成", () => {
  const { utils } = loadUtilities();
  for (const exampleKey of exampleKeys.filter((key) => key !== "claude-settings")) {
    for (const protocol of ["", " ", null, 123, {}, "responses\n"]) {
      const errors = utils.validate({ ...values, protocol }, exampleKey);
      assert.ok(errors.protocol, `${exampleKey}: ${JSON.stringify(protocol)}`);
      assert.throws(() => utils.build(exampleKey, { ...values, protocol }), /API 协议类型/);
    }
    if (exampleKey !== "opencode-settings") {
      assert.throws(() => utils.build(exampleKey, { ...values, protocol: "unsupported" }), /当前 CLI 支持/);
    }
  }
  assert.throws(() => utils.build("codex-config", { ...values, protocol: "chat" }), /当前 CLI 支持/);
});

test("新增与范例抽屉弹窗均显示正确的协议默认值及候选，Claude 不显示，重开恢复范例默认值", async () => {
  for (const exampleKey of exampleKeys) {
    const platform = exampleKey === "kimi-code-config" ? "kimi-code" : exampleKey.split("-")[0];
    for (const props of [{ exampleKey }, { platform }]) {
      const harness = loadModalHarness(props);
      const select = harness.field("API 协议类型");
      if (exampleKey === "claude-settings") {
        assert.equal(select, undefined);
        continue;
      }
      const metadata = harness.utils.protocol(exampleKey);
      assert.ok(select);
      assert.equal(select.props.value, metadata.defaultValue);
      assert.equal(select.props.showSearch, true);
      assert.equal(select.props["aria-required"], true);
      assert.equal(select.props.mode, metadata.allowCustomValue ? "combobox" : undefined);
      const container = {};
      assert.equal(select.props.getPopupContainer({ parentElement: container }), container);
      const selected = metadata.options[0].value;
      harness.field("API 协议类型")!.props.onChange(selected);
      await harness.fill();
      await harness.render().props.onOk();
      assert.equal(harness.imported[0].protocol, selected);
      assert.equal(loadModalHarness(props).field("API 协议类型")!.props.value, metadata.defaultValue);
    }
  }
  assert.match(source, /CliExampleImportModal, \{\s*key: `cli-example-import-\$\{S\}`,?\s*exampleKey: S,/);
});

test("协议类型位于配置名称之后，其余导入字段之前", () => {
  for (const exampleKey of exampleKeys) {
    const platform = exampleKey === "kimi-code-config" ? "kimi-code" : exampleKey.split("-")[0];
    for (const props of [{ exampleKey }, { platform }]) {
      const fields = nodes(loadModalHarness(props).render())
        .map((node) => node.props["aria-label"])
        .filter(Boolean);
      const expected = [
        ...("platform" in props ? ["配置名称"] : []),
        ...(platform === "claude" ? [] : ["API 协议类型"]),
        "base_url", "api_key", "模型名称",
      ];
      assert.deepEqual(fields, expected, JSON.stringify(props));
    }
  }
});

test("协议下拉空值校验、搜索自定义包、异步失败保留选择及保存中禁用", async () => {
  const harness = loadModalHarness({ platform: "opencode" });
  await harness.fill();
  harness.field("API 协议类型")!.props.onSearch("");
  await harness.render().props.onOk();
  assert.equal(harness.imported.length, 0);
  assert.equal(harness.field("API 协议类型")!.props.status, "error");
  assert.ok(nodes(harness.render()).some((node) => node.props.role === "alert" && node.props.children === "请选择 API 协议类型"));
  harness.field("API 协议类型")!.props.onSearch("@example/custom-provider");
  assert.equal(harness.field("API 协议类型")!.props.status, undefined);
  await harness.resolve();
  harness.field("模型名称")!.props.onChange({ target: { value: values.model } });
  let rejectSave: (error: Error) => void = () => undefined;
  const pending = harness.render(() => new Promise((_resolve, reject) => { rejectSave = reject; })).props.onOk();
  assert.equal(harness.field("API 协议类型")!.props.disabled, true);
  rejectSave(new Error("保存失败"));
  await pending;
  assert.equal(harness.field("API 协议类型")!.props.value, "@example/custom-provider");
  await harness.render().props.onOk();
  assert.equal(harness.imported[0].protocol, "@example/custom-provider");
});

test("七类 CLI 的八个范例入口按结构替换全部模型引用、地址和密钥，不修改范例原文", () => {
  const { utils } = loadUtilities();
  const originals = JSON.stringify(utils.examples);
  const claude = JSON.parse(utils.build("claude-settings", values).content);
  assert.equal(claude.model, values.model);
  assert.equal(claude.env.ANTHROPIC_AUTH_TOKEN, values.api_key);
  assert.equal(claude.env.ANTHROPIC_BASE_URL, values.base_url);
  for (const key of ["ANTHROPIC_DEFAULT_HAIKU_MODEL", "ANTHROPIC_DEFAULT_SONNET_MODEL", "ANTHROPIC_DEFAULT_OPUS_MODEL", "CLAUDE_CODE_SUBAGENT_MODEL"]) {
    assert.equal(claude.env[key], values.model);
  }
  assert.equal(claude.effortLevel, "high");
  assert.equal(claude.language, "zh-CN");

  for (const exampleKey of ["codex-config", "codex-auth"]) {
    const imported = utils.build(exampleKey, values);
    const codex = utils.parseToml(imported.configContent);
    assert.equal(codex.model, values.model);
    assert.equal(codex.model_providers.codex.base_url, values.base_url);
    assert.equal(codex.model_providers.codex.wire_api, "responses");
    assert.equal(codex.model_reasoning_effort, "high");
    assert.equal(JSON.parse(imported.authContent).OPENAI_API_KEY, values.api_key);
  }

  const opencode = JSON.parse(utils.build("opencode-settings", values).content);
  assert.equal(opencode.model, `myAPI/${values.model}`);
  assert.equal(opencode.small_model, opencode.model);
  assert.deepEqual(Object.keys(opencode.provider.myAPI.models), [values.model]);
  assert.equal(opencode.provider.myAPI.models[values.model].name, values.model);
  assert.equal(opencode.provider.myAPI.models[values.model].limit.context, 128000);
  assert.equal(opencode.provider.myAPI.options.baseURL, values.base_url);
  assert.equal(opencode.provider.myAPI.options.apiKey, values.api_key);

  const grok = utils.parseToml(utils.build("grok-config", values).content);
  assert.equal(grok.models.default, values.model);
  assert.deepEqual(Object.keys(grok.model), [values.model]);
  assert.equal(grok.model[values.model].model, values.model);
  assert.equal(grok.model[values.model].base_url, values.base_url);
  assert.equal(grok.model[values.model].api_key, values.api_key);
  assert.equal(grok.model[values.model].api_backend, "responses");
  assert.equal(grok.models.default_reasoning_effort, "high");

  const dsh = JSON.parse(utils.build("dsh-config", values).content);
  assert.equal(dsh.baseURL, values.base_url);
  assert.equal(dsh.apiKey, values.api_key);
  assert.equal(dsh.acpModel, values.model);
  assert.equal(dsh.models[0].id, values.model);
  assert.equal(dsh.models[0].name, values.model);
  assert.equal(dsh.apiKeyEnv, "SINITEK_DSH_API_KEY");

  const kimi = utils.parseToml(utils.build("kimi-code-config", values).content);
  assert.equal(kimi.default_model, values.model);
  assert.deepEqual(Object.keys(kimi.models), [values.model]);
  assert.equal(kimi.models[values.model].model, values.model);
  assert.equal(kimi.providers.default.base_url, values.base_url);
  assert.equal(kimi.providers.default.api_key, values.api_key);
  assert.deepEqual(Array.from(kimi.models[values.model].capabilities), ["thinking"]);

  const zcode = JSON.parse(utils.build("zcode-config", values).content).config;
  assert.equal(zcode.defaultModelSelection.modelId, values.model);
  assert.equal(zcode.defaultModelSelection.options.reasoningLevel, "high");
  const provider = zcode.providerConfigRules.providerRules[0].config;
  assert.equal(provider.api.baseUrl, values.base_url);
  assert.equal(provider.access.apiKey, values.api_key);
  assert.deepEqual(provider.personalModelIds, [values.model]);
  assert.deepEqual(zcode.modelConfigRules.providerModelRules, []);
  assert.deepEqual(zcode.modelConfigRules.manualProviderModelRules, []);
  assert.equal(JSON.stringify(utils.examples), originals);
});

test("生成的七类配置可加载到当前编辑器，重复导入不残留上次输入", () => {
  const { utils } = loadUtilities();
  for (const [exampleKey, editor] of [
    ["claude-settings", utils.claude], ["codex-config", utils.codex],
    ["opencode-settings", utils.opencode], ["grok-config", utils.grok],
    ["kimi-code-config", utils.kimi], ["zcode-config", utils.zcode],
  ]) {
    const imported = utils.build(exampleKey, values);
    const parsed = editor.parseContent(imported.content || imported.configContent);
    assert.equal(parsed.ok, true, `${exampleKey}: ${parsed.error}`);
    assert.ok(!parsed.state.fieldError, `${exampleKey}: ${parsed.state.fieldError}`);
  }
  assert.equal(utils.dsh.readDocument(utils.build("dsh-config", values).content).ok, true);
  for (const exampleKey of exampleKeys) {
    const changed = utils.build(exampleKey, { ...values, model: "second-model" });
    assert.doesNotMatch(JSON.stringify(changed), /got-6\.1-sol/);
  }
});

test("JSON 与 TOML 正确转义引号、反斜杠和替换字符，模型键中的点不拆成表路径", () => {
  const { utils } = loadUtilities();
  const special = { ...values, api_key: 'example-"\\$&-key', model: 'model.6-"\\$&' };
  for (const exampleKey of ["codex-config", "codex-auth", "grok-config", "kimi-code-config"]) {
    const result = utils.build(exampleKey, special);
    const document = utils.parseToml(result.configContent || result.content);
    if (exampleKey.startsWith("codex")) {
      assert.equal(document.model, special.model);
      assert.equal(JSON.parse(result.authContent).OPENAI_API_KEY, special.api_key);
    } else if (exampleKey === "grok-config") {
      assert.equal(document.model[special.model].model, special.model);
      assert.equal(document.model[special.model].api_key, special.api_key);
    } else {
      assert.equal(document.models[special.model].model, special.model);
      assert.equal(document.providers.default.api_key, special.api_key);
    }
  }
  for (const exampleKey of ["claude-settings", "opencode-settings", "dsh-config", "zcode-config"]) {
    const result = utils.build(exampleKey, special);
    assert.ok(JSON.stringify(JSON.parse(result.content)).includes(JSON.stringify(special.api_key)));
  }
});

test("必填项、地址、控制字符和 OpenCode 模型边界拒绝导入，首尾空白可清理", () => {
  const { utils } = loadUtilities();
  for (const key of ["base_url", "api_key", "model"]) {
    for (const invalid of ["", "   ", "a\nb", "a\u0000b"]) {
      const candidate = { ...values, [key]: invalid };
      assert.ok(utils.validate(candidate)[key]);
      assert.throws(() => utils.build("claude-settings", candidate));
    }
  }
  for (const baseUrl of ["not-a-url", "ftp://example.com", "https://user:password@example.com/v1"]) {
    assert.ok(utils.validate({ ...values, base_url: baseUrl }).base_url);
  }
  assert.throws(() => utils.build("opencode-settings", { ...values, model: "provider/model" }), /不能包含/);
  assert.throws(() => utils.build("unknown", values), /不支持/);
  const trimmed = utils.build("claude-settings", Object.fromEntries(Object.entries(values).map(([key, value]) => [key, ` ${value} `])));
  assert.equal(JSON.parse(trimmed.content).model, values.model);
});

test("必填弹窗遮蔽密钥、空输入阻止导入、取消不导入、重开清空、失败保留错误", async () => {
  const state: unknown[] = [];
  const refs: AnyRecord[] = [];
  let cursor = 0;
  let refCursor = 0;
  let closed = 0;
  const imported: AnyRecord[] = [];
  const { utils } = loadUtilities({
    c: {
      useState: (initial: unknown) => {
        const index = cursor++;
        if (!(index in state)) state[index] = initial;
        return [state[index], (next: unknown) => {
          state[index] = typeof next === "function" ? (next as (previous: unknown) => unknown)(state[index]) : next;
        }];
      },
      useRef: (initial: unknown) => {
        const index = refCursor++;
        return refs[index] ||= { current: initial };
      },
      useEffect: () => undefined,
    },
  });
  const render = (onImport = (next: AnyRecord) => imported.push(next)) => {
    cursor = 0;
    refCursor = 0;
    return utils.modal({ onClose: () => { closed++; }, onImport });
  };
  const fieldNode = (label: string) => nodes(render()).find((node) => node.props["aria-label"] === label);
  const resolveNode = () => nodes(render()).find((node) => node.props.className === "cli-example-import-resolve");
  await render().props.onOk();
  assert.equal(imported.length, 0);
  assert.equal(nodes(render()).filter((node) => node.props.role === "alert").length, 2);
  assert.equal(fieldNode("模型名称")!.props.disabled, true);
  for (const [key, label] of [["base_url", "base_url"], ["api_key", "api_key"]]) {
    const input = fieldNode(label)!;
    assert.ok(input);
    assert.equal(input.props.required, true);
    if (key === "api_key") assert.equal(input.props.type, "password");
    input.props.onChange({ target: { value: values[key as keyof typeof values] } });
  }
  assert.equal(resolveNode()!.props.disabled, false);
  await resolveNode()!.props.onClick();
  assert.equal(nodes(render()).find((node) => node.props.role === "status")!.props["data-state"], "failure");
  assert.equal(fieldNode("模型名称")!.type, "input");
  assert.ok(nodes(render()).some((node) => node.props.children === "未能解析模型，可手动填写模型名称"));
  fieldNode("模型名称")!.props.onChange({ target: { value: values.model } });
  await render().props.onOk();
  assert.equal(imported[0].model, values.model);
  assert.equal(imported[0].api_key, values.api_key);
  assert.equal(closed, 0);
  state.length = 0;
  refs.length = 0;
  assert.ok(nodes(render()).filter((node) => node.type === "input").every((node) => node.props.value === ""));
});

test("新增导入弹窗支持名称校验、取消、异步保存失败重试及保存中防重复提交", async () => {
  const state: unknown[] = [];
  const refs: AnyRecord[] = [];
  let cursor = 0;
  let refCursor = 0;
  let closed = 0;
  let submissions = 0;
  let rejectSave: (error: Error) => void = () => undefined;
  const { utils } = loadUtilities({
    configPlatformLabel: () => "Codex",
    c: {
      useState: (initial: unknown) => {
        const index = cursor++;
        if (!(index in state)) state[index] = initial;
        return [state[index], (next: unknown) => {
          state[index] = typeof next === "function" ? (next as (previous: unknown) => unknown)(state[index]) : next;
        }];
      },
      useRef: (initial: unknown) => {
        const index = refCursor++;
        return refs[index] ||= { current: initial };
      },
      useEffect: () => undefined,
    },
  });
  const render = (onImport = (_next: AnyRecord) => {
    submissions++;
    return new Promise<void>((_resolve, reject) => { rejectSave = reject; });
  }) => {
    cursor = 0;
    refCursor = 0;
    return utils.modal({ platform: "codex", onClose: () => { closed++; }, onImport });
  };
  const input = (label: string) => {
    const field = nodes(render()).find((node) => node.props["aria-label"] === label);
    assert.ok(field);
    return field;
  };
  assert.equal(render().props.title, "添加Codex配置");
  assert.equal(render().props.zIndex, 1100);
  assert.equal(render().props.okText, "创建配置");
  assert.match(input("配置名称").props.value, /^Codex 配置 \d+$/);
  input("配置名称").props.onChange({ target: { value: " " } });
  for (const [key, label] of [["base_url", "base_url"], ["api_key", "api_key"]]) {
    input(label).props.onChange({ target: { value: values[key as keyof typeof values] } });
  }
  await nodes(render()).find((node) => node.props.className === "cli-example-import-resolve")!.props.onClick();
  input("模型名称").props.onChange(values.model);
  await render().props.onOk();
  assert.equal(submissions, 0);
  assert.ok(nodes(render()).some((node) => node.props.role === "alert" && node.props.children === "配置名称不能为空"));
  render().props.onCancel();
  assert.equal(closed, 1);
  input("配置名称").props.onChange({ target: { value: "我的配置" } });
  const saving = render().props.onOk();
  assert.equal(submissions, 1);
  assert.equal(render().props.confirmLoading, true);
  assert.equal(render().props.cancelButtonProps.disabled, true);
  assert.equal(render().props.closable, false);
  assert.ok(nodes(render()).filter((node) => node.type === "input").every((node) => node.props.disabled));
  await render().props.onOk();
  render().props.onCancel();
  assert.equal(submissions, 1);
  assert.equal(closed, 1);
  rejectSave(new Error("异步保存失败测试"));
  await saving;
  assert.equal(render().props.confirmLoading, false);
  assert.ok(nodes(render()).some((node) => node.props.role === "alert" && node.props.children === "异步保存失败测试"));
  assert.equal(input("配置名称").props.value, "我的配置");
  assert.equal(input("api_key").props.value, values.api_key);
  let retried: AnyRecord | undefined;
  await render(async (next) => { retried = next; }).props.onOk();
  assert.equal(retried?.name, "我的配置");
  assert.equal(retried?.base_url, values.base_url);
  state.length = 0;
  refs.length = 0;
  assert.equal(input("api_key").props.value, "");
});

test("共享抽屉确认导入后统一切换源码页签，仅更新草稿，解析失败不关闭，Codex 同步更新两个文件", () => {
  for (const exampleKey of exampleKeys) {
    const calls: string[] = [];
    const editorModes: string[] = [];
    const syncEditorContent = (platform: string) => (_content: string, mode: string) => {
      calls.push(platform);
      editorModes.push(mode);
      return true;
    };
    const { sandbox, utils } = loadUtilities();
    Object.assign(sandbox, {
      S: exampleKey, I: utils.examples[exampleKey], exampleImportOpen: false,
      CliExampleImportModal: "import-modal",
      setExampleImportOpen: (open: boolean) => { sandbox.exampleImportOpen = open; },
      y: (next: string | null) => { sandbox.S = next; sandbox.I = next ? utils.examples[next] : null; },
      Kt: { success: () => calls.push("success"), error: () => calls.push("error") },
      syncClaudeVisualContent: syncEditorContent("claude"),
      syncOpenCodeVisualContent: syncEditorContent("opencode"),
      syncCodexVisualContent: syncEditorContent("codex"),
      syncGrokVisualContent: syncEditorContent("grok"),
      syncKimiCodeVisualContent: syncEditorContent("kimi"),
      syncZcodeVisualContent: syncEditorContent("zcode"),
      h: (auth: string) => { assert.equal(JSON.parse(auth).OPENAI_API_KEY, values.api_key); calls.push("auth"); },
      setDshText: () => calls.push("dsh"), setDshVisual: () => undefined,
      setDshFieldError: () => undefined, setDshSelectedModelId: () => undefined,
      setDshEditorMode: (mode: string) => { editorModes.push(mode); },
    });
    vm.runInNewContext(`const ${section("N = (W) => y(W),", "      saveClaudeSettingsCard =").replace(/,\s*$/, ";")}\nglobalThis.handlers = { D, B, importCliExample };`, sandbox);
    sandbox.handlers.D();
    assert.equal(sandbox.exampleImportOpen, true);
    assert.equal(calls.length, 0);
    assert.ok(nodes(sandbox.handlers.B()).some((node) => node.props.onImport));
    sandbox.handlers.importCliExample(values);
    assert.equal(sandbox.I, null);
    assert.equal(sandbox.exampleImportOpen, false);
    assert.ok(calls.includes("success"));
    const expectedMode = ["codex-config", "codex-auth", "grok-config", "kimi-code-config"].includes(exampleKey) ? "toml" : "json";
    assert.deepEqual(editorModes, [expectedMode], `${exampleKey} 导入后必须切到源码页签`);
    if (exampleKey.startsWith("codex")) assert.deepEqual(calls, ["codex", "auth", "success"]);
    if (exampleKey === "claude-settings") {
      sandbox.I = utils.examples[exampleKey];
      sandbox.S = exampleKey;
      sandbox.exampleImportOpen = true;
      sandbox.syncClaudeVisualContent = () => false;
      sandbox.handlers.importCliExample(values);
      assert.equal(sandbox.exampleImportOpen, true);
      assert.ok(sandbox.I);
    }
  }
});
