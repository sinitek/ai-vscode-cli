import assert = require("node:assert/strict");
import * as fs from "node:fs";
import * as path from "node:path";
import test = require("node:test");
import * as vm from "node:vm";

const uiPath = path.join(process.cwd(), "media", "config", "assets", "config-app-ui.js");
const storePath = path.join(process.cwd(), "media", "config", "assets", "config-app-store.js");

function read(filePath: string): string {
  return fs.readFileSync(filePath, "utf8");
}

function loadConfigFactory() {
  const ui = read(uiPath);
  const examplesStart = ui.indexOf("const ps = {");
  const examplesEnd = ui.indexOf("const Nk = {", examplesStart);
  assert.ok(examplesStart >= 0 && examplesEnd > examplesStart, "找不到配置范例");
  const zcodeStart = ui.indexOf("// ZCODE_VISUAL_EDITOR_UTILS_START");
  const zcodeEnd = ui.indexOf("// ZCODE_VISUAL_EDITOR_UTILS_END", zcodeStart);
  assert.ok(zcodeStart >= 0 && zcodeEnd > zcodeStart, "找不到 ZCode 配置工具");

  const store = read(storePath);
  const factoryStart = store.indexOf("createConfigFromExample =");
  const factoryEnd = store.indexOf("// Config store", factoryStart);
  assert.ok(factoryStart >= 0 && factoryEnd > factoryStart, "找不到新增配置工厂");

  const sandbox: Record<string, any> = {
    createDshUiProfileText: () => JSON.stringify({ provider: "dsh", models: [{ id: "example" }] }),
    createKimiCodeVisualExampleText: () => 'default_model = "kimi-k3.1-pro"\n',
  };
  vm.runInNewContext(
    `${ui.slice(zcodeStart, zcodeEnd)}\n${ui.slice(examplesStart, examplesEnd)}\n${store.slice(factoryStart, factoryEnd).replace(/,\s*$/, ";")}\nglobalThis.__create = createConfigFromExample; globalThis.__examples = ps;`,
    sandbox,
  );
  return { create: sandbox.__create, examples: sandbox.__examples };
}

function plain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

test("七个 CLI 配置工厂保留对应范例与初始字段", () => {
  const { create, examples } = loadConfigFactory();

  assert.deepEqual(plain(create("Claude 测试", "claude")), {
    name: "Claude 测试",
    platform: "claude",
    content: examples.claude.settings,
    mcpContent: "{}",
    claudeSkills: [],
  });
  assert.deepEqual(plain(create("Codex 测试", "codex")), {
    name: "Codex 测试",
    platform: "codex",
    configContent: examples.codex.config,
    authContent: examples.codex.auth,
    codexSkills: [],
  });
  assert.deepEqual(plain(create("OpenCode 测试", "opencode")), {
    name: "OpenCode 测试",
    platform: "opencode",
    content: examples.opencode.settings,
    openCodeSkills: [],
  });
  assert.deepEqual(plain(create("Grok 测试", "grok")), {
    name: "Grok 测试",
    platform: "grok",
    content: examples.grok.config,
    configContent: examples.grok.config,
  });
  assert.deepEqual(plain(create("DSH 测试", "dsh")), {
    name: "DSH 测试",
    platform: "dsh",
    content: examples.dsh.config,
    configContent: examples.dsh.config,
  });
  assert.deepEqual(plain(create("kimi 测试", "kimi-code")), {
    name: "kimi 测试",
    platform: "kimi-code",
    content: examples["kimi-code"].config,
    configContent: examples["kimi-code"].config,
  });
  assert.deepEqual(plain(create("ZCode 测试", "zcode")), {
    name: "ZCode 测试",
    platform: "zcode",
    content: examples.zcode.config,
    configContent: examples.zcode.config,
  });
});

test("新增配置工厂拒绝未知平台", () => {
  const { create } = loadConfigFactory();
  assert.throws(() => create("未知", "unknown"), /不支持的配置平台/);
});

function loadNewConfigFlow(platform: string, saveError?: Error) {
  const ui = read(uiPath);
  const section = (startMarker: string, endMarker: string) => {
    const start = ui.indexOf(startMarker);
    const end = ui.indexOf(endMarker, start);
    assert.ok(start >= 0 && end > start, `找不到 ${startMarker}`);
    return ui.slice(start, end);
  };
  const saved: Record<string, any>[] = [];
  const selected: unknown[][] = [];
  const messages: string[] = [];
  const { create } = loadConfigFactory();
  const sandbox: Record<string, any> = {
    URL, Error,
    createConfigFromExample: create,
    newConfigPlatform: null,
    setNewConfigPlatform: (next: string | null) => { sandbox.newConfigPlatform = next; },
    configPlatformLabel: (value: string) => value,
    addBlankConfig: (name: string, draftPlatform: string) => {
      const draft = { id: "blank-profile", name, platform: draftPlatform, content: "", isDraft: true };
      sandbox.draft = draft;
      return draft;
    },
    onMobileClose: () => { sandbox.mobileClosed = true; },
    l: async (payload: Record<string, any>) => {
      if (saveError) throw saveError;
      saved.push(payload);
      return { ...payload, id: "created-profile" };
    },
    o: (...selection: unknown[]) => selected.push(selection),
    Kt: { success: (message: string) => messages.push(message) },
  };
  vm.runInNewContext([
    section("function fk(", "const CLI_GLOBAL_SKILL_TARGETS ="),
    section("const DSH_UI_PROVIDER", "const CONFIG_FIELD_HELP_TOOLTIP_TITLE_FALLBACK_DELAY_MS"),
    section("// OPENCODE_VISUAL_EDITOR_UTILS_START", "// CODEX_VISUAL_EDITOR_UTILS_END"),
    section("const GROK_VISUAL_FIELD_IDS", "// Config editor panel"),
    `const ${section("I = (platform) => setNewConfigPlatform(platform),", "      R = async (k, L) =>").replace(/,\s*$/, ";")}`,
    "globalThis.handlers = { open: I, submit: addImportedConfig, skip: skipImportedConfig, build: buildCliExampleImport };",
  ].join("\n"), sandbox);
  sandbox.handlers.open(platform);
  return { sandbox, saved, selected, messages };
}

test("七个 CLI 可跳过导入并选择未保存的空白草稿", () => {
  for (const platform of ["claude", "codex", "opencode", "grok", "dsh", "kimi-code", "zcode"]) {
    const { sandbox, saved, selected } = loadNewConfigFlow(platform);
    sandbox.handlers.skip({ name: "  我的草稿  " });
    assert.equal(sandbox.draft.name, "我的草稿");
    assert.equal(sandbox.draft.platform, platform);
    assert.equal(sandbox.draft.content, "");
    assert.equal(sandbox.draft.isDraft, true);
    assert.equal(saved.length, 0);
    assert.deepEqual(selected, [["blank-profile", platform]]);
    assert.equal(sandbox.newConfigPlatform, null);
    assert.equal(sandbox.mobileClosed, true);
  }
  const { sandbox } = loadNewConfigFlow("codex");
  sandbox.handlers.skip({ name: " " });
  assert.match(sandbox.draft.name, /^Codex 配置 \d+$/);
});

test("空白草稿仅在成功保存后持久化，失败可重试且删除不请求宿主", async () => {
  const storeSource = read(storePath);
  const start = storeSource.indexOf("useConfigStore = QH(");
  assert.ok(start >= 0);
  let state: Record<string, any> = {};
  const saved: Record<string, any>[] = [];
  const deleted: unknown[][] = [];
  let fail = true;
  let nextId = 0;
  const sandbox: Record<string, any> = {
    QH: (factory: any) => {
      state = factory((patch: Record<string, any>) => Object.assign(state, patch), () => state);
      return state;
    },
    createEmptyActiveIds: () => ({}),
    loadStoredOrder: () => ({ dsh: [] }),
    createConfigId: () => `draft-${++nextId}`,
    saveConfigItem: async (config: Record<string, any>) => {
      if (fail) throw new Error("保存失败");
      saved.push(config);
    },
    deleteConfigItem: async (...args: unknown[]) => { deleted.push(args); },
    appendOrderForConfigs: (configs: Record<string, any>[], orders: Record<string, string[]>) => ({
      ...orders, dsh: [...orders.dsh, ...configs.map((config) => config.id)],
    }),
    storeJson: () => undefined,
    saveConfigOrder: async () => undefined,
    CONFIG_STORAGE_KEYS: { CONFIG_ORDER: "order" },
    console: { error: () => undefined },
  };
  vm.runInNewContext(`const ${storeSource.slice(start)}\nglobalThis.store = useConfigStore;`, sandbox);
  const draft = sandbox.store.addBlankConfig("测试", "dsh");
  assert.equal(draft.content, "");
  assert.equal(saved.length, 0);
  await assert.rejects(sandbox.store.updateConfig(draft.id, { content: "{}" }), /保存失败/);
  assert.equal(state.configs[0].isDraft, true);
  fail = false;
  await sandbox.store.updateConfig(draft.id, { content: "{}" });
  assert.equal(saved.length, 1);
  assert.equal(saved[0].isDraft, undefined);
  assert.equal(state.configs[0].isDraft, undefined);
  assert.deepEqual(Array.from(state.configOrders.dsh), [draft.id]);
  const discarded = sandbox.store.addBlankConfig("待删除", "dsh");
  await sandbox.store.deleteConfig("dsh", discarded.id);
  assert.equal(deleted.length, 0);
  assert.equal(state.configs.length, 1);
});

test("七个 CLI 点击添加直接打开导入弹窗，确认输入后才保存并选中新档案", async () => {
  const values = { name: "  自定义配置  ", base_url: "https://api.example.com/v1", api_key: "test-import-key", model: "custom-model" };
  for (const platform of ["claude", "codex", "opencode", "grok", "dsh", "kimi-code", "zcode"]) {
    const { sandbox, saved, selected, messages } = loadNewConfigFlow(platform);
    assert.equal(sandbox.newConfigPlatform, platform);
    assert.equal(saved.length, 0);
    assert.equal(selected.length, 0);
    await sandbox.handlers.submit(values);
    assert.equal(saved.length, 1);
    assert.equal(saved[0].name, "自定义配置");
    assert.equal(saved[0].platform, platform);
    const exampleKey = `${platform}-${["claude", "opencode"].includes(platform) ? "settings" : "config"}`;
    const imported = sandbox.handlers.build(exampleKey, values);
    for (const [key, content] of Object.entries(imported)) assert.equal(saved[0][key], content);
    if (["grok", "dsh", "kimi-code", "zcode"].includes(platform)) {
      assert.equal(saved[0].configContent, saved[0].content);
    }
    if (platform === "claude") {
      assert.equal(saved[0].mcpContent, "{}");
      assert.deepEqual(plain(saved[0].claudeSkills), []);
    }
    if (platform === "codex") assert.deepEqual(plain(saved[0].codexSkills), []);
    if (platform === "opencode") assert.deepEqual(plain(saved[0].openCodeSkills), []);
    assert.equal(sandbox.newConfigPlatform, null);
    assert.deepEqual(selected, [["created-profile", platform]]);
    assert.deepEqual(messages, ["添加成功"]);
  }
  assert.match(read(uiPath), /newConfigPlatform \? be\.jsx\(CliExampleImportModal, \{\s*key: `cli-example-import-\$\{newConfigPlatform\}`,?\s*platform: newConfigPlatform,\s*onClose: \(\) => setNewConfigPlatform\(null\),\s*onImport: addImportedConfig/);
  assert.match(read(uiPath), /exampleImportOpen \? be\.jsx\(CliExampleImportModal, \{\s*key: `cli-example-import-\$\{S\}`,?\s*exampleKey: S,/);
});

test("新增配置按弹窗选择写入各 CLI 的协议字段", async () => {
  const values = { name: "协议配置", base_url: "https://api.example.com/v1", api_key: "test-import-key", model: "custom-model" };
  for (const [platform, protocol] of [
    ["codex", "responses"], ["opencode", "@example/custom-provider"],
    ["grok", "messages"], ["dsh", "anthropic-messages"],
    ["kimi-code", "openai_responses"], ["zcode", "openai-responses"],
  ]) {
    const { sandbox, saved, selected } = loadNewConfigFlow(platform);
    await sandbox.handlers.submit({ ...values, protocol });
    assert.equal(saved.length, 1);
    assert.equal(selected.length, 1);
    const content = saved[0].configContent || saved[0].content;
    assert.ok(content.includes(protocol), `${platform}: ${protocol}`);
    if (platform !== "codex") assert.equal(saved[0].content, saved[0].configContent || saved[0].content);
  }
  const { sandbox, saved } = loadNewConfigFlow("codex");
  await assert.rejects(() => sandbox.handlers.submit({ ...values, protocol: "chat" }), /当前 CLI 支持/);
  assert.equal(saved.length, 0);
  assert.equal(sandbox.newConfigPlatform, "codex");
});

test("新增配置校验失败或保存失败不关闭导入弹窗，也不选择或激活档案", async () => {
  const values = { name: "测试配置", base_url: "https://api.example.com/v1", api_key: "test-import-key", model: "custom-model" };
  const invalid = loadNewConfigFlow("claude");
  await assert.rejects(invalid.sandbox.handlers.submit({ ...values, base_url: "" }), /请填写/);
  assert.equal(invalid.sandbox.newConfigPlatform, "claude");
  assert.equal(invalid.saved.length, 0);
  assert.equal(invalid.selected.length, 0);

  const failure = loadNewConfigFlow("codex", new Error("保存失败测试"));
  await assert.rejects(failure.sandbox.handlers.submit(values), /保存失败测试/);
  assert.equal(failure.sandbox.newConfigPlatform, "codex");
  assert.equal(failure.saved.length, 0);
  assert.equal(failure.selected.length, 0);
  assert.equal(failure.messages.length, 0);
});
