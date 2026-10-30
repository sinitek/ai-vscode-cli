import assert = require("node:assert/strict");
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import test = require("node:test");
import {
  KIMI_CODE_DEFAULT_MODEL,
  KIMI_CODE_EFFORTS,
  applyKimiCodeVisualPatch,
  changeKimiCodeConfigModelList,
  commitKimiCodeText,
  createKimiCodeDefaultConfigText,
  getKimiCodeConfigRevision,
  isKimiCodeBypassPermissionMode,
  parseKimiCodeConfigModels,
  readKimiCodeConfigText,
  writeKimiCodeConfigText,
  resolveKimiCodeConfigModel,
  serializeKimiCodeDocument,
  validateKimiCodeDocument,
} from "../../config/kimiCodeConfig";
import { parseGrokToml } from "../../config/grokToml";
import {
  resolveKimiCodeConfigPath,
  resolveKimiCodeGlobalRulesPath,
  resolveKimiCodeGlobalSkillsDirectory,
} from "../../shared/userHomePaths";

const VALID_TOML = `default_model = "subcoco/kimi-k3.1-pro"
default_permission_mode = "auto"

[providers.subcoco]
type = "openai"
base_url = "http://127.0.0.1:33391/v1"
api_key_env = "KIMI_CODE_API_KEY"

[models."subcoco/kimi-k3.1-pro"]
provider = "subcoco"
model = "kimi-k3.1-pro"
max_context_size = 262144
display_name = "Kimi K3.1 Pro"
default_effort = "high"
support_efforts = ["low", "medium", "high", "xhigh", "max"]
capabilities = ["thinking", "tool_use"]

[models."subcoco/kimi-k3.1-max"]
provider = "subcoco"
model = "kimi-k3.1-max"
max_context_size = 1048576

[thinking]
enabled = true
effort = "high"

[loop_control]
reserved_context_size = 16384
`;

const LEGACY_DEFAULT_MODEL = "subcoco/kimi-k3.1-pro";

test("kimi-code config paths follow KIMI_CODE_HOME and the official directory names", () => {
  assert.match(resolveKimiCodeConfigPath(), /\.kimi-code[\\/]config\.toml$/);
  assert.match(resolveKimiCodeGlobalSkillsDirectory(), /\.kimi-code[\\/]skills$/);
  assert.match(resolveKimiCodeGlobalRulesPath(), /\.kimi-code[\\/]AGENTS\.md$/);
});

test("model list changes preserve provider credentials and advanced fields", () => {
  const added = changeKimiCodeConfigModelList(VALID_TOML, { type: "add", model: "kimi-k3.1-mini" });
  assert.equal(added.ok, true);
  if (!added.ok) return;
  assert.match(added.content, /\[models\."kimi-k3\.1-mini"\]/);
  assert.match(added.content, /model = "kimi-k3\.1-mini"/);
  assert.match(added.content, /api_key_env = "KIMI_CODE_API_KEY"/);
  assert.match(added.content, /capabilities = \["thinking", "tool_use"\]/);
  assert.deepEqual(parseKimiCodeConfigModels(added.content).models, [LEGACY_DEFAULT_MODEL, "subcoco/kimi-k3.1-max", "kimi-k3.1-mini"]);

  const moved = changeKimiCodeConfigModelList(added.content, { type: "move", model: "kimi-k3.1-mini", direction: "up" });
  assert.equal(moved.ok, true);
  if (!moved.ok) return;
  assert.deepEqual(parseKimiCodeConfigModels(moved.content).models, [LEGACY_DEFAULT_MODEL, "kimi-k3.1-mini", "subcoco/kimi-k3.1-max"]);

  const renamed = changeKimiCodeConfigModelList(moved.content, { type: "rename", model: LEGACY_DEFAULT_MODEL, nextModel: "kimi-k3.1-pro" });
  assert.equal(renamed.ok, true);
  if (!renamed.ok) return;
  assert.equal(parseKimiCodeConfigModels(renamed.content).defaultModel, "kimi-k3.1-pro");

  const deleted = changeKimiCodeConfigModelList(renamed.content, { type: "delete", model: "kimi-k3.1-pro" });
  assert.equal(deleted.ok, true);
  if (!deleted.ok) return;
  assert.deepEqual(parseKimiCodeConfigModels(deleted.content).models, ["kimi-k3.1-mini", "subcoco/kimi-k3.1-max"]);
  assert.equal(parseKimiCodeConfigModels(deleted.content).defaultModel, "kimi-k3.1-mini");
});

test("model list changes reject duplicate, missing and boundary operations", () => {
  assert.deepEqual(changeKimiCodeConfigModelList(VALID_TOML, { type: "add", model: LEGACY_DEFAULT_MODEL }), { ok: false, error: "模型别名已存在。" });
  assert.deepEqual(changeKimiCodeConfigModelList(VALID_TOML, { type: "delete", model: "missing" }), { ok: false, error: "模型不存在，请刷新后重试。" });
  assert.deepEqual(changeKimiCodeConfigModelList(VALID_TOML, { type: "move", model: LEGACY_DEFAULT_MODEL, direction: "up" }), { ok: false, error: "模型已经位于边界。" });
});

test("parses declared models, labels, default model, thinking effort and permission mode", () => {
  const parsed = parseKimiCodeConfigModels(VALID_TOML);
  assert.equal(parsed.error, null);
  assert.deepEqual(parsed.models, ["subcoco/kimi-k3.1-pro", "subcoco/kimi-k3.1-max"]);
  assert.equal(parsed.labels["subcoco/kimi-k3.1-pro"], "Kimi K3.1 Pro");
  assert.equal(parsed.labels["subcoco/kimi-k3.1-max"], "subcoco/kimi-k3.1-max");
  assert.equal(parsed.defaultModel, LEGACY_DEFAULT_MODEL);
  assert.equal(parsed.thinkingEffort, "high");
  assert.equal(parsed.permissionMode, "auto");
});

test("falls back to the first declared model when default_model is missing or unknown", () => {
  const missing = parseKimiCodeConfigModels(`[models."a/one"]\nmodel = "one"\n`);
  assert.equal(missing.error, null);
  assert.equal(missing.defaultModel, "a/one");
  const unknown = parseKimiCodeConfigModels(`default_model = "gone"\n[models."a/one"]\nmodel = "one"\n`);
  assert.equal(unknown.defaultModel, "a/one");
  const none = parseKimiCodeConfigModels(`default_model = "gone"\n`);
  assert.equal(none.defaultModel, null);
  assert.deepEqual(none.models, []);
});

test("reports TOML and schema errors instead of silently accepting them", () => {
  assert.match(parseKimiCodeConfigModels("[models\n").error ?? "", /./);
  assert.match(parseKimiCodeConfigModels("models = 1\n").error ?? "", /models 必须是 TOML 表/);
});

test("validates the documented kimi-code schema", () => {
  const ok = parseGrokToml(VALID_TOML);
  assert.equal(ok.ok, true);
  if (!ok.ok) return;
  assert.equal(validateKimiCodeDocument(ok.value), null);

  const cases: Array<[string, RegExp]> = [
    [`[providers.p]\ntype = "carrier-pigeon"\n`, /providers\.p\.type 无效/],
    [`[providers.p]\napi_key_env = "1BAD"\n`, /providers\.p\.api_key_env 只能是环境变量名/],
    [`[providers.p]\nbase_url = 1\n`, /providers\.p\.base_url 必须是字符串/],
    [`[models."a/b"]\nmax_context_size = -1\n`, /models\.a\/b\.max_context_size 必须是非负整数/],
    [`[models."a/b"]\ndefault_effort = "turbo"\n`, /models\.a\/b\.default_effort 无效/],
    [`[models."a/b"]\nsupport_efforts = ["max", "ultra"]\n`, /support_efforts 含无效档位/],
    [`[models."a/b"]\nsupport_efforts = "max"\n`, /support_efforts 必须是字符串数组/],
    [`[models."a/b"]\ncapabilities = "thinking"\n`, /capabilities 必须是字符串数组/],
    [`[models."a/b"]\ncapabilities = ["thinking", "telepathy"]\n`, /capabilities 含未知能力/],
    [`[thinking]\neffort = "off"\n`, /thinking\.effort 无效/],
    [`default_permission_mode = "never"\n`, /default_permission_mode 无效/],
    [`[loop_control]\nreserved_context_size = "16384"\n`, /loop_control\.reserved_context_size 必须是非负整数/],
  ];
  for (const [toml, pattern] of cases) {
    const parsed = parseGrokToml(toml);
    assert.equal(parsed.ok, true, toml);
    if (!parsed.ok) continue;
    assert.match(validateKimiCodeDocument(parsed.value) ?? "", pattern, toml);
  }
});

test("only auto and yolo count as bypass approval because -p cannot take --auto/--yolo", () => {
  assert.equal(isKimiCodeBypassPermissionMode("auto"), true);
  assert.equal(isKimiCodeBypassPermissionMode("yolo"), true);
  assert.equal(isKimiCodeBypassPermissionMode("manual"), false);
  assert.equal(isKimiCodeBypassPermissionMode(null), false);
  assert.equal(isKimiCodeBypassPermissionMode(""), false);
});

test("commitKimiCodeText keeps the previous text on invalid input and rejects empty overwrite", () => {
  const empty = commitKimiCodeText(VALID_TOML, "   \n");
  assert.deepEqual(empty, { ok: true, reason: "empty", content: "", document: {} });

  const invalid = commitKimiCodeText(VALID_TOML, "default_permission_mode = \"never\"\n");
  assert.equal(invalid.ok, false);
  if (invalid.ok) return;
  assert.equal(invalid.content, VALID_TOML);
  assert.match(invalid.error, /default_permission_mode 无效/);

  const updated = commitKimiCodeText(VALID_TOML, VALID_TOML.replace("high", "max"));
  assert.equal(updated.ok, true);
  if (!updated.ok) return;
  assert.equal(updated.reason, "updated");
  assert.match(updated.content, /effort = "max"/);
});

test("commitKimiCodeText fills missing thinking declarations without replacing explicit restrictions", () => {
  const minimal = `[models.one]\nmodel = "one"\n\n[models.two]\nmodel = "two"\ncapabilities = ["tool_use"]\nsupport_efforts = ["high"]\n\n[models.three]\nmodel = "three"\ncapabilities = []\nsupport_efforts = []\n`;
  const committed = commitKimiCodeText("", minimal);
  assert.equal(committed.ok, true);
  if (!committed.ok) return;
  const models = committed.document.models as Record<string, Record<string, unknown>>;
  assert.deepEqual(models.one.capabilities, ["thinking"]);
  assert.deepEqual(models.one.support_efforts, [...KIMI_CODE_EFFORTS]);
  assert.deepEqual(models.two.capabilities, ["thinking", "tool_use"]);
  assert.deepEqual(models.two.support_efforts, ["high"]);
  assert.deepEqual(models.three.capabilities, ["thinking"]);
  assert.deepEqual(models.three.support_efforts, [], "显式空数组是用户保留的限制，不自动放开");
  assert.match(committed.content, /capabilities = \[\s*"thinking"\s*\]/);
});

test("visual patch rewrites only the targeted fields and keeps unknown keys", () => {
  const parsed = parseGrokToml(VALID_TOML);
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  const patched = applyKimiCodeVisualPatch(parsed.value, {
    defaultModel: "subcoco/kimi-k3.1-max",
    defaultPermissionMode: "manual",
    thinkingEffort: "medium",
    reservedContextSize: "32768",
    model: {
      alias: "subcoco/kimi-k3.1-max",
      provider: "subcoco",
      model: "kimi-k3.1-max",
      displayName: "Kimi K3.1 Max",
      maxContextSize: "1048576",
      defaultEffort: "xhigh",
    },
  });
  assert.equal(patched.ok, true);
  if (!patched.ok) return;
  assert.equal(patched.document.default_model, "subcoco/kimi-k3.1-max");
  assert.equal(patched.document.default_permission_mode, "manual");
  const thinking = patched.document.thinking as Record<string, unknown>;
  assert.equal(thinking.effort, "medium");
  assert.equal(thinking.enabled, true);
  const loopControl = patched.document.loop_control as Record<string, unknown>;
  assert.equal(loopControl.reserved_context_size, 32768);
  const models = patched.document.models as Record<string, Record<string, unknown>>;
  const model = models["subcoco/kimi-k3.1-max"];
  assert.equal(model.display_name, "Kimi K3.1 Max");
  assert.equal(model.max_context_size, 1048576);
  assert.equal(model.default_effort, "xhigh");
  assert.equal(model.model, "kimi-k3.1-max", "别名与真实模型 ID 分开保存");
  // 其他模型的未展示字段保留
  assert.deepEqual(
    models["subcoco/kimi-k3.1-pro"].support_efforts,
    [...KIMI_CODE_EFFORTS],
  );
  assert.deepEqual(models["subcoco/kimi-k3.1-pro"].capabilities, ["thinking", "tool_use"]);
  assert.equal(models["subcoco/kimi-k3.1-pro"].display_name, "Kimi K3.1 Pro");
});

test("visual patch adds a missing model table but validates every written value", () => {
  const parsed = parseGrokToml(VALID_TOML);
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;

  const added = applyKimiCodeVisualPatch(parsed.value, {
    model: { alias: "other/new-model", provider: "subcoco", model: "new-model" },
  });
  assert.equal(added.ok, true);
  if (!added.ok) return;
  const models = added.document.models as Record<string, Record<string, unknown>>;
  assert.equal(models["other/new-model"].model, "new-model");
  assert.equal(models["other/new-model"].provider, "subcoco");

  const badMode = applyKimiCodeVisualPatch(parsed.value, { defaultPermissionMode: "never" });
  assert.equal(badMode.ok, false);
  if (!badMode.ok) assert.match(badMode.error, /default_permission_mode 无效/);

  const badEffort = applyKimiCodeVisualPatch(parsed.value, { thinkingEffort: "off" });
  assert.equal(badEffort.ok, false);
  if (!badEffort.ok) assert.match(badEffort.error, /thinking\.effort 无效/);

  const badReserved = applyKimiCodeVisualPatch(parsed.value, { reservedContextSize: "-5" });
  assert.equal(badReserved.ok, false);
  if (!badReserved.ok) assert.match(badReserved.error, /reserved_context_size 必须是非负整数/);

  const badContext = applyKimiCodeVisualPatch(parsed.value, {
    model: { alias: "subcoco/kimi-k3.1-pro", maxContextSize: "1e6" },
  });
  assert.equal(badContext.ok, false);
  if (!badContext.ok) assert.match(badContext.error, /max_context_size 必须是非负整数/);
});

test("serialized documents round-trip through the parser", () => {
  const parsed = parseGrokToml(VALID_TOML);
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  const serialized = serializeKimiCodeDocument(parsed.value);
  assert.equal(serialized.ok, true);
  if (!serialized.ok) return;
  const text = serialized.content;
  const reparsed = parseGrokToml(text);
  assert.equal(reparsed.ok, true);
  if (!reparsed.ok) return;
  assert.equal(validateKimiCodeDocument(reparsed.value), null);
  const models = parseKimiCodeConfigModels(text);
  assert.deepEqual(models.models, ["subcoco/kimi-k3.1-pro", "subcoco/kimi-k3.1-max"]);
});

test("default config text uses the documented model, provider and context fields", () => {
  const text = createKimiCodeDefaultConfigText();
  const parsed = parseGrokToml(text);
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(validateKimiCodeDocument(parsed.value), null);
  const root = parsed.value as Record<string, any>;
  assert.equal(root.default_model, KIMI_CODE_DEFAULT_MODEL);
  assert.equal(root.default_permission_mode, "auto", "免审批必须写进配置文件，-p 不能带 --auto");
  assert.equal(root.providers.default.base_url, "http://127.0.0.1:33391/v1");
  assert.equal(root.providers.default.api_key_env, "KIMI_CODE_API_KEY");
  assert.equal(root.providers.default.api_key, undefined);
  assert.equal(root.models[KIMI_CODE_DEFAULT_MODEL].window ?? root.models[KIMI_CODE_DEFAULT_MODEL].max_context_size, 262144);
  assert.equal(root.models[KIMI_CODE_DEFAULT_MODEL].model, "kimi-k3.1-pro");
  assert.equal(root.thinking, undefined);
  assert.equal(root.loop_control, undefined);
  assert.deepEqual(root.models[KIMI_CODE_DEFAULT_MODEL].capabilities, ["thinking"]);
  assert.deepEqual(root.models[KIMI_CODE_DEFAULT_MODEL].support_efforts, [...KIMI_CODE_EFFORTS]);
  assert.equal(root.models[KIMI_CODE_DEFAULT_MODEL].display_name, undefined);
  assert.equal(root.models[KIMI_CODE_DEFAULT_MODEL].default_effort, undefined);
  assert.doesNotMatch(text, /subcoco\//);
  assert.equal(validateKimiCodeDocument(parsed.value), null);
});

test("default config text keeps the provider, base_url, alias and real model id stable", () => {
  const text = createKimiCodeDefaultConfigText();
  const parsed = parseGrokToml(text);
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  const root = parsed.value as Record<string, any>;
  assert.equal(root.default_model, "kimi-k3.1-pro");
  assert.deepEqual(Object.keys(root.providers), ["default"]);
  assert.equal(root.providers.default.base_url, "http://127.0.0.1:33391/v1");
  assert.equal(root.models["kimi-k3.1-pro"].provider, "default");
  assert.equal(root.models["kimi-k3.1-pro"].model, "kimi-k3.1-pro");
});

test("default config text prefers an inline api_key when one is supplied", () => {
  const text = createKimiCodeDefaultConfigText({ apiKey: "sk-test", permissionMode: "yolo" });
  const parsed = parseGrokToml(text);
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  const root = parsed.value as Record<string, any>;
  assert.equal(root.providers.default.api_key, "sk-test");
  assert.equal(root.providers.default.api_key_env, undefined);
  assert.equal(root.default_permission_mode, "yolo");
});

test("model resolution keeps an explicit selection and never borrows another CLI's model", () => {
  const config = parseKimiCodeConfigModels(VALID_TOML);
  assert.equal(resolveKimiCodeConfigModel(config, "subcoco/kimi-k3.1-max"), "subcoco/kimi-k3.1-max");
  assert.equal(resolveKimiCodeConfigModel(config, "gpt-5.1-codex"), LEGACY_DEFAULT_MODEL);
  assert.equal(resolveKimiCodeConfigModel(config, null), LEGACY_DEFAULT_MODEL);
  assert.equal(resolveKimiCodeConfigModel(parseKimiCodeConfigModels(""), "x"), null);
});

test("write/read honours KIMI_CODE_HOME and survives a real file round trip", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "sinitek-kimi-code-"));
  try {
    const text = createKimiCodeDefaultConfigText();
    await writeKimiCodeConfigText(text, { ...process.env, KIMI_CODE_HOME: home });
    const written = await fs.readFile(path.join(home, "config.toml"), "utf8");
    assert.equal(written.trim(), text.trim());

    if (process.platform !== "win32") {
      const stat = await fs.stat(path.join(home, "config.toml"));
      assert.equal(stat.mode & 0o777, 0o600, "config.toml 可能含 api_key，必须是 0600");
    }

    const readBack = await readKimiCodeConfigText({ ...process.env, KIMI_CODE_HOME: home });
    assert.equal(readBack.trim(), text.trim());
    const parsed = parseKimiCodeConfigModels(readBack);
    assert.deepEqual(parsed.models, [KIMI_CODE_DEFAULT_MODEL]);
    assert.equal(parsed.defaultModel, KIMI_CODE_DEFAULT_MODEL);
    assert.equal(parsed.permissionMode, "auto");
  } finally {
    await fs.rm(home, { recursive: true, force: true });
  }
});

test("successful writes advance only their own config revision", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "sinitek-kimi-code-revision-"));
  const otherHome = await fs.mkdtemp(path.join(os.tmpdir(), "sinitek-kimi-code-other-"));
  const env = { ...process.env, KIMI_CODE_HOME: home };
  try {
    const before = getKimiCodeConfigRevision(env);
    const otherBefore = getKimiCodeConfigRevision({ ...process.env, KIMI_CODE_HOME: otherHome });
    await assert.rejects(
      () => writeKimiCodeConfigText("default_permission_mode = \"never\"\n", env),
      /default_permission_mode 无效/,
    );
    assert.equal(getKimiCodeConfigRevision(env), before);
    await writeKimiCodeConfigText(createKimiCodeDefaultConfigText(), env);
    assert.equal(getKimiCodeConfigRevision(env), before + 1);
    assert.equal(getKimiCodeConfigRevision({ ...process.env, KIMI_CODE_HOME: otherHome }), otherBefore);
  } finally {
    await fs.rm(home, { recursive: true, force: true });
    await fs.rm(otherHome, { recursive: true, force: true });
  }
});

test("invalid text never overwrites the existing config file", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "sinitek-kimi-code-bad-"));
  try {
    const text = createKimiCodeDefaultConfigText();
    await writeKimiCodeConfigText(text, { ...process.env, KIMI_CODE_HOME: home });
    await assert.rejects(
      () => writeKimiCodeConfigText("default_permission_mode = \"never\"\n", { ...process.env, KIMI_CODE_HOME: home }),
      /default_permission_mode 无效/,
    );
    const stillValid = await readKimiCodeConfigText({ ...process.env, KIMI_CODE_HOME: home });
    assert.equal(stillValid.trim(), text.trim());
  } finally {
    await fs.rm(home, { recursive: true, force: true });
  }
});

test("write persists the completed declarations instead of the uncommitted input", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "sinitek-kimi-code-complete-"));
  try {
    await writeKimiCodeConfigText(
      `[models.one]\nmodel = "one"\n`,
      { ...process.env, KIMI_CODE_HOME: home },
    );
    const parsed = parseGrokToml(await readKimiCodeConfigText({ ...process.env, KIMI_CODE_HOME: home }));
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    const models = parsed.value.models as Record<string, Record<string, unknown>>;
    assert.deepEqual(models.one.capabilities, ["thinking"]);
    assert.deepEqual(models.one.support_efforts, [...KIMI_CODE_EFFORTS]);
  } finally {
    await fs.rm(home, { recursive: true, force: true });
  }
});
