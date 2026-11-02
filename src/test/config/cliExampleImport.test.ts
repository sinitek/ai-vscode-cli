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
    KH: "import-icon",
    ...overrides,
  };
  vm.runInNewContext([
    section("function fk(", "const CLI_GLOBAL_SKILL_TARGETS ="),
    section("const DSH_UI_PROVIDER", "const CONFIG_FIELD_HELP_TOOLTIP_TITLE_FALLBACK_DELAY_MS"),
    section("// OPENCODE_VISUAL_EDITOR_UTILS_START", "// CODEX_VISUAL_EDITOR_UTILS_END"),
    section("const GROK_VISUAL_FIELD_IDS", "// Config editor panel"),
    "globalThis.utils = { build: buildCliExampleImport, validate: validateCliExampleImport, modal: CliExampleImportModal, parseToml: g1, examples: Nk, templates: ps, claude: ClaudeConfigVisualEditorUtils, codex: CodexConfigVisualEditorUtils, opencode: OpenCodeConfigVisualEditorUtils, grok: GrokConfigVisualEditorUtils, kimi: KimiCodeConfigVisualEditorUtils, zcode: ZcodeConfigVisualEditorUtils, dsh: DshConfigPageUtils };",
  ].join("\n"), sandbox);
  return { sandbox, utils: sandbox.utils as AnyRecord };
}

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

test("必填弹窗遮蔽密钥、空输入阻止导入、取消不导入、重开清空、失败保留错误", () => {
  const state: unknown[] = [];
  let cursor = 0;
  let closed = 0;
  const imported: AnyRecord[] = [];
  const { utils } = loadUtilities({
    c: {
      useState: (initial: unknown) => {
        const index = cursor++;
        if (!(index in state)) state[index] = initial;
        return [state[index], (next: unknown) => { state[index] = next; }];
      },
      useRef: () => ({ current: null }),
    },
  });
  const render = (onImport = (next: AnyRecord) => imported.push(next)) => {
    cursor = 0;
    return utils.modal({ onClose: () => { closed++; }, onImport });
  };
  render().props.onOk();
  assert.equal(imported.length, 0);
  assert.equal(nodes(render()).filter((node) => node.props.role === "alert").length, 3);
  for (const [key, label] of [["base_url", "base_url"], ["api_key", "api_key"], ["model", "模型名称"]]) {
    const input = nodes(render()).find((node) => node.props["aria-label"] === label);
    assert.ok(input);
    assert.equal(input.props.required, true);
    if (key === "api_key") assert.equal(input.props.type, "password");
    input.props.onChange({ target: { value: values[key as keyof typeof values] } });
  }
  render().props.onCancel();
  assert.equal(closed, 1);
  assert.equal(imported.length, 0);
  render().props.onOk();
  assert.deepEqual({ ...imported[0] }, values);
  render(() => { throw new Error("导入失败测试"); }).props.onOk();
  assert.ok(nodes(render()).some((node) => node.props.role === "alert" && node.props.children === "导入失败测试"));
  state.length = 0;
  assert.ok(nodes(render()).filter((node) => node.type === "input").every((node) => node.props.value === ""));
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
    vm.runInNewContext(`const ${section("N = (W) => y(W),", "      A = async (W) =>").replace(/,\s*$/, ";")}\nglobalThis.handlers = { D, B, importCliExample };`, sandbox);
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
