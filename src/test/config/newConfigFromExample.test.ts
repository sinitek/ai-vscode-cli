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
    "globalThis.handlers = { open: I, submit: addImportedConfig, build: buildCliExampleImport };",
  ].join("\n"), sandbox);
  sandbox.handlers.open(platform);
  return { sandbox, saved, selected, messages };
}

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
  assert.match(read(uiPath), /newConfigPlatform \? be\.jsx\(CliExampleImportModal, \{\s*platform: newConfigPlatform,\s*onClose: \(\) => setNewConfigPlatform\(null\),\s*onImport: addImportedConfig/);
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
