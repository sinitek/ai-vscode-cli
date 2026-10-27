import assert = require("node:assert/strict");
import * as fs from "node:fs";
import * as path from "node:path";
import test = require("node:test");

/**
 * Kimi Code 文档契约回归。
 *
 * 这些断言只读仓库内的文档、清单与实现常量，不读用户配置、不读环境变量、
 * 不访问网络，也不依赖本机私有数据。目的是防止文档悄悄退回“安装脚本缺失、
 * 版本检查缺失、把 --auto 当免审批开关、把不支持的压缩写成支持”这类失真。
 */

const repoRoot = process.cwd();

function readProjectFile(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, ...relativePath.split("/")), "utf8");
}

function exists(relativePath: string): boolean {
  return fs.existsSync(path.join(repoRoot, ...relativePath.split("/")));
}

const GUIDE = "docs/kimi-code-guide.md";
const REFERENCE = ".ch/docs/references/kimi-code-official-reference.md";
const RUNBOOK = ".ch/docs/runbooks/kimi-code-config.md";

test("Kimi Code 用户指南存在且给出两条官方安装入口与版本检查", () => {
  assert.ok(exists(GUIDE), "缺少用户向 Kimi Code 指南");
  const guide = readProjectFile(GUIDE);

  // 官方脚本安装（官方推荐，不需要预装 Node）
  assert.match(guide, /curl -fsSL https:\/\/code\.kimi\.com\/kimi-code\/install\.sh \| bash/);
  assert.match(guide, /irm https:\/\/code\.kimi\.com\/kimi-code\/install\.ps1 \| iex/);
  // npm 安装与 Node 版本要求
  assert.match(guide, /npm install -g @moonshot-ai\/kimi-code\n/);
  assert.match(guide, /22\.19\.0/);
  // 版本检查与自检
  assert.match(guide, /kimi --version/);
  assert.match(guide, /kimi doctor config/);
  // 升级与卸载
  assert.match(guide, /kimi upgrade/);
  assert.match(guide, /npm uninstall -g @moonshot-ai\/kimi-code/);
});

test("Kimi Code 用户指南写清 default_model 与免审批配置方式", () => {
  const guide = readProjectFile(GUIDE);

  assert.match(guide, /default_model = "kimi-k3\.1-pro"/);
  assert.doesNotMatch(guide, /subcoco\//);
  // 别名与真实模型 ID 的区分必须写出来，避免用户把表键当模型 ID
  assert.match(guide, /别名 ≠ 模型 ID|与真实模型 ID/);
  assert.match(guide, /\[providers\.subcoco\]/);
  assert.match(guide, /api_key = "<your-kimi-api-key>"/);
  assert.match(guide, /api_key_env = "KIMI_CODE_API_KEY"/);
  assert.match(guide, /不需要 Codex 那样的第二个 `auth\.json`/);
  assert.match(guide, /default_permission_mode = "auto"/);
  // 免审批不能靠 --auto / --yolo：与 -p 互斥
  assert.match(guide, /Cannot combine --prompt with --auto\./);
  assert.match(guide, /Cannot combine --prompt with --yolo\./);
  assert.match(guide, /KIMI_CODE_HOME/);
  assert.match(guide, /kimi acp/);
});

test("Kimi Code 用户指南明确标注不支持的能力与已知缺口，不虚构参数", () => {
  const guide = readProjectFile(GUIDE);

  // ACP 没有压缩方法
  assert.match(guide, /compaction-unsupported/);
  assert.match(guide, /没有压缩方法/);
  // /compact 斜杠命令可经 prompt 通道触发，但只有纯文本完成提示，不得写成可确认按钮
  assert.match(guide, /Context compaction started/);
  assert.match(guide, /没有机器可读的完成事件/);
  // 思考档位需要 capability 声明，默认配置和保存链路自动生成该声明
  assert.match(guide, /support_efforts/);
  assert.match(guide, /capabilities = \["thinking"/);
  assert.match(guide, /默认配置与范例已包含 `capabilities = \["thinking"\]`/);
  assert.match(guide, /重新保存一次即可自动补齐/);
  assert.match(guide, /已知缺口/);
  assert.match(guide, /kimiThinkingOptions/);
  assert.match(guide, /kimi-config-window/);
  // 不发送的 ACP 方法要写明
  assert.match(guide, /session\/load/);
  assert.match(guide, /session\/fork/);
  assert.match(guide, /session\/delete/);
  // 未做图形界面点击验收，不得写成已完成
  assert.match(guide, /图形界面的点击级验收/);
});

test("Kimi Code 文档不包含密钥样式内容或本机私有凭据", () => {
  for (const relativePath of [GUIDE, REFERENCE, RUNBOOK]) {
    const text = readProjectFile(relativePath);
    // 任何 sk- 开头的密钥串、Bearer token、真实设备码都不允许出现在文档里
    assert.doesNotMatch(text, /sk-[A-Za-z0-9]{8,}/, `${relativePath} 含疑似明文密钥`);
    assert.doesNotMatch(text, /Bearer\s+[A-Za-z0-9._-]{8,}/, `${relativePath} 含疑似 token`);
    assert.doesNotMatch(text, /KIMI_CODE_API_KEY\s*=\s*"[^"]+"/, `${relativePath} 把环境变量写成了密钥`);
    assert.doesNotMatch(text, /api_key\s*=\s*"sk-/, `${relativePath} 含明文 api_key`);
  }
});

test("Kimi Code 官方对照参考列出 ACP 能力边界与安装版本事实", () => {
  const reference = readProjectFile(REFERENCE);

  assert.match(reference, /@moonshot-ai\/kimi-code/);
  assert.match(reference, /2\.3\.2/);
  assert.match(reference, /22\.19\.0/);
  // 官方 ACP 能力矩阵：没有压缩方法
  assert.match(reference, /session\/compact/);
  assert.match(reference, /没有.*压缩方法|没有 `session\/compact`/);
  // 三种权限模式的配置值
  for (const mode of ["manual", "yolo", "auto"]) {
    assert.match(reference, new RegExp(`\`${mode}\``), `缺少权限模式 ${mode}`);
  }
  // 思考档位的实测广告集合
  assert.match(reference, /support_efforts/);
  assert.match(reference, /off`、`low`、`medium`、`high`、`xhigh`、`max`/);
  // 与插件的差异清单必须存在，避免只抄官方不提差异
  assert.match(reference, /与插件文档的差异清单|差异清单/);
});

test("Kimi Code 排障 runbook 覆盖隔离验证与已知失败现象", () => {
  const runbook = readProjectFile(RUNBOOK);

  assert.match(runbook, /kimi doctor config/);
  assert.match(runbook, /KIMI_CODE_HOME/);
  assert.match(runbook, /placeholder/);
  assert.match(runbook, /Authentication required/);
  assert.match(runbook, /has no credential configured/);
  assert.match(runbook, /is not advertised/);
  assert.match(runbook, /Cannot combine --prompt with --auto\./);
  // 必须指向具体缺口文件，接手的人能直接定位
  assert.match(runbook, /src\/config\/kimiCodeConfig\.ts/);
  assert.match(runbook, /media\/config\/assets\/config-app-ui\.js/);
  assert.match(runbook, /src\/webview\/viewContentScript\/windowMessageDispatch\.ts/);
});

test("README 与功能清单已把 Kimi Code 计入 CLI 与 skills 目标", () => {
  const readme = readProjectFile("README.md");
  assert.match(readme, /Kimi Code/);
  assert.match(readme, /六个全局 skills 目录/);
  assert.match(readme, /docs\/kimi-code-guide\.md/);

  const featureList = readProjectFile("docs/插件功能清单.md");
  assert.match(featureList, /kimi-code/);
  assert.match(featureList, /npm install -g @moonshot-ai\/kimi-code@latest/);
  assert.match(featureList, /install\.sh/);
  assert.match(featureList, /docs\/kimi-code-guide\.md/);
});

test("功能总表登记了 Kimi Code 条目及其证据与缺口", () => {
  const inventory = readProjectFile(".ch/docs/product-specs/FEATURE_INVENTORY.md");
  const row = inventory
    .split("\n")
    .find((line) => line.startsWith("| AI 对话 / CLI | 官方 Kimi Code ACP"));
  assert.ok(row, "FEATURE_INVENTORY 缺少 Kimi Code 行");
  const cells = String(row).split(" | ");
  assert.equal(cells.length, 8, "Kimi Code 行必须是 8 列");

  assert.match(String(row), /kimi-code/);
  assert.match(String(row), /npm install -g @moonshot-ai\/kimi-code@latest/);
  assert.match(String(row), /kimi --version/);
  assert.match(String(row), /kimi doctor config/);
  assert.match(String(row), /default_permission_mode/);
  assert.match(String(row), /support_efforts/);
  assert.match(String(row), /compaction-unsupported/);
  assert.match(String(row), /kimiCodeDocContract\.test\.js/);
  assert.match(String(row), /kimi-code-official-reference\.md/);
});

test("插件安装常量与文档写的 npm 命令保持一致", () => {
  const installer = readProjectFile("src/cli/installer.ts");
  assert.match(installer, /"kimi-code": "npm install -g @moonshot-ai\/kimi-code@latest"/);

  const guide = readProjectFile(GUIDE);
  assert.match(guide, /npm install -g @moonshot-ai\/kimi-code@latest/);
});

test("Kimi Code 范围文档把窗口来源与能力声明写成已验证事实", () => {
  const runtimeReference = readProjectFile(".ch/docs/references/cli-runtime-reference.md");
  const kimiSection = runtimeReference.slice(runtimeReference.indexOf("### Kimi Code"));
  const section = kimiSection.slice(0, kimiSection.indexOf("### Gemini"));

  assert.match(section, /session\/compact/);
  assert.match(section, /compaction-unsupported/);
  assert.match(section, /max_context_size/);
  // Kimi 的窗口来源是独立的 kimi-config-window，不再借用 DSH 的 adapter-fallback 文案
  assert.match(section, /kimi-config-window/);
  assert.match(section, /interactiveTurnKimi\.ts/);
  // DSH 语义必须继续被说明为独立实现，不能被 Kimi 的改动侵蚀
  assert.match(section, /adapter-fallback/);
  assert.doesNotMatch(section, /不准确/, "窗口悬停文案已修，不得再写成待修");
  assert.doesNotMatch(section, /待修缺口/, "Kimi 缺口已修，不得保留待修清单");
  assert.match(section, /support_efforts/);
  assert.match(section, /kimiThinkingOptions/);
  assert.match(section, /kimiModeUpdate/);
});

test("业务 ontology 登记了 Kimi 规则，且引用文件都在仓库里", () => {
  const domain = JSON.parse(readProjectFile(".ch/docs/ontology/domains/cli-plugin-runtime.json")) as {
    rules: Array<{ id: string; applies_to: string[]; source_refs: Array<{ path: string }> }>;
  };
  const kimiRules = domain.rules.filter((rule) => rule.id.startsWith("plugin.rule.kimi_"));
  assert.deepEqual(
    kimiRules.map((rule) => rule.id).sort(),
    [
    "plugin.rule.kimi_acp_install_and_launch",
    "plugin.rule.kimi_config_model_management",
      "plugin.rule.kimi_no_native_compaction",
      "plugin.rule.kimi_thinking_capability_gated",
    ],
  );

  const conceptIds = new Set(
    (JSON.parse(readProjectFile(".ch/docs/ontology/domains/cli-plugin-runtime.json")) as {
      concepts: Array<{ id: string }>;
    }).concepts.map((concept) => concept.id),
  );
  for (const rule of kimiRules) {
    assert.ok(rule.applies_to.length > 0, `${rule.id} 缺少 applies_to`);
    for (const conceptId of rule.applies_to) {
      assert.ok(conceptIds.has(conceptId), `${rule.id} 引用了不存在的概念 ${conceptId}`);
    }
    for (const ref of rule.source_refs) {
      assert.ok(exists(ref.path), `${rule.id} 引用了不存在的文件 ${ref.path}`);
    }
  }

  // DSH 专属规则不应把 Kimi runner 当成实现证据
  const dshRules = domain.rules.filter((rule) => rule.id.startsWith("plugin.rule.dsh_"));
  for (const rule of dshRules) {
    for (const ref of rule.source_refs) {
      assert.doesNotMatch(
        ref.path,
        /kimi/i,
        `${rule.id} 不应引用 Kimi 实现文件 ${ref.path}`,
      );
    }
  }
});
