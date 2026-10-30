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

test("七个 CLI 新增配置时自动复制对应范例", () => {
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

test("新增配置工厂拒绝未知平台，新增入口保留空名称与保存失败校验", () => {
  const { create } = loadConfigFactory();
  assert.throws(() => create("未知", "unknown"), /不支持的配置平台/);

  const ui = read(uiPath);
  assert.match(ui, /if \(!U\) return \(Kt\.error\("配置名称不能为空"\), Promise\.reject\(\)\)/);
  assert.match(ui, /const T = await l\(createConfigFromExample\(U, k\)\)/);
  assert.match(ui, /Kt\.error\("添加失败: " \+ T\), Promise\.reject\(T\)/);
});
