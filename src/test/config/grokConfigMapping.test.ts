import assert = require("node:assert/strict");
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import test = require("node:test");
import {
  GROK_KEDAYA_PROFILE,
  GROK_VISUAL_BLOCKED_KEYS,
  GROK_VISUAL_FIELDS,
  applyGrokKedayaProfile,
  applyGrokVisualPatch,
  commitGrokText,
  serializeGrokDocument,
  grokActiveModelHasOwnCredential,
  isGrokVisualSaveDisabled,
  mergeGrokKedayaProfile,
  resolveGrokEditorStatus,
  validateGrokDocument,
} from "../../config/grokConfig";
import { parseGrokToml } from "../../config/grokToml";
import { resolveGrokConfigPath, resolveGrokHomeDir } from "../../shared/userHomePaths";

test("maps documented Grok fields and merges the kedaya profile without secrets", () => {
  const existing = `
custom_root = "keep"

[models]
default = "old"

[model."grok-4.7"]
custom_note = "keep"
service_tier = "fast"

[projects."/workspace"]
trust_level = "trusted"
`;
  const merged = mergeGrokKedayaProfile(existing);
  assert.equal(merged.ok, true);
  if (!merged.ok) {
    return;
  }
  const parsed = parseGrokToml(merged.content);
  assert.equal(parsed.ok, true);
  if (!parsed.ok) {
    return;
  }
  const models = parsed.value.models as Record<string, unknown>;
  const modelTable = parsed.value.model as Record<string, Record<string, unknown>>;
  const model = modelTable[GROK_KEDAYA_PROFILE.modelId];
  assert.equal(models.default, GROK_KEDAYA_PROFILE.modelId);
  assert.equal(models.default_reasoning_effort, "xhigh");
  assert.equal(model.model, GROK_KEDAYA_PROFILE.modelId);
  assert.equal(model.name, undefined);
  assert.equal(model.base_url, GROK_KEDAYA_PROFILE.baseUrl);
  assert.equal(model.api_backend, "responses");
  assert.equal(model.context_window, 500000);
  assert.equal(model.compaction_at_tokens, 450000);
  assert.equal(model.custom_note, "keep");
  assert.equal(model.service_tier, "fast");
  assert.equal(parsed.value.custom_root, "keep");
  assert.equal((parsed.value.projects as Record<string, unknown>)["/workspace"] !== undefined, true);
  assert.equal(model.wire_api, undefined);
  assert.equal(model.api_key, "");
  assert.equal(model.env_key, undefined);
  assert.match(merged.content, /api_key = ""/);
  assert.doesNotMatch(merged.content, /requires_openai_auth|disable_response_storage|apiKey/);
  assert.match(merged.content, /\[model\."grok-4\.7-kedaya"\]/);
  assert.deepEqual(GROK_VISUAL_FIELDS.map((field) => field.id), [
    "models.default",
    "models.default_reasoning_effort",
    "model.model",
    "model.base_url",
    "model.api_key",
    "model.api_backend",
    "model.env_key",
    "model.context_window",
    "model.reasoning_summary",
    "model.compaction_at_tokens",
  ]);
  assert.equal(GROK_VISUAL_FIELDS.some((field) => GROK_VISUAL_BLOCKED_KEYS.includes(field.id as never)), false);
  assert.equal(GROK_VISUAL_FIELDS.every((field) => field.label.zh && field.label.en && field.tooltip.zh && field.tooltip.en), true);
});

test("Grok model names are optional and hidden legacy names survive visual edits and profile merges", () => {
  const parsed = parseGrokToml(`
[models]
default = "gpt-6.1-sol"
[model."gpt-6.1-sol"]
model = "gpt-6.1-sol"
api_backend = "chat_completions"
[model."grok-4.7"]
model = "grok-4.7"
name = "  Legacy name  "
`);
  assert.ok(parsed.ok);
  if (!parsed.ok) return;
  assert.equal(validateGrokDocument(parsed.value), null);
  const edited = applyGrokVisualPatch(parsed.value, { model: { id: "gpt-6.1-sol", baseUrl: "https://api.example.com/v1" } });
  assert.ok(edited.ok);
  if (!edited.ok) return;
  const serialized = serializeGrokDocument(edited.document);
  assert.ok(serialized.ok);
  if (!serialized.ok) return;
  const merged = mergeGrokKedayaProfile(serialized.content);
  assert.ok(merged.ok);
  if (!merged.ok) return;
  const result = parseGrokToml(merged.content);
  assert.ok(result.ok);
  if (!result.ok) return;
  const models = result.value.model as Record<string, Record<string, unknown>>;
  assert.equal(models["gpt-6.1-sol"].name, undefined);
  assert.equal(models["gpt-6.1-sol"].base_url, "https://api.example.com/v1");
  assert.equal(models["grok-4.7"].name, "  Legacy name  ");
  assert.equal(GROK_VISUAL_FIELDS.some((field) => field.id === "model.name"), false);
});

test("treats empty Grok config input as an empty document", () => {
  const committed = commitGrokText("default = \"keep\"\n", " \n");
  assert.equal(committed.ok, true);
  if (!committed.ok) {
    return;
  }
  assert.equal(committed.reason, "empty");
  assert.equal(committed.content, "");
  assert.deepEqual(committed.document, {});
  assert.equal(resolveGrokEditorStatus({ loading: false, content: "", parseError: null }), "empty");
  assert.equal(resolveGrokEditorStatus({ loading: true, content: "", parseError: null }), "loading");
  assert.equal(isGrokVisualSaveDisabled({ status: "empty", fieldError: null }), false);
  assert.equal(resolveGrokHomeDir({ GROK_HOME: "" }, "/home/user"), path.join("/home/user", ".grok"));
  const windowsConfig = resolveGrokConfigPath(
    { GROK_HOME: "%USERPROFILE%\\grok-home", USERPROFILE: "/Users/tester" },
    "/Users/tester",
    "win32",
  );
  assert.equal(windowsConfig.includes("%USERPROFILE%"), false);
  assert.equal(windowsConfig.includes("grok-home"), true);
  assert.equal(windowsConfig.endsWith(`${path.sep}config.toml`) || windowsConfig.endsWith("config.toml"), true);
});

test("keeps an existing Grok api_key and accepts toml underscores", () => {
  const merged = mergeGrokKedayaProfile(`[model."grok-4.7"]\napi_key = "keep-me"\ncontext_window = 500_000\n`);
  assert.equal(merged.ok, true);
  if (!merged.ok) {
    return;
  }
  const parsed = parseGrokToml(merged.content);
  assert.equal(parsed.ok, true);
  if (!parsed.ok) {
    return;
  }
  const model = (parsed.value.model as Record<string, Record<string, unknown>>)[GROK_KEDAYA_PROFILE.modelId];
  assert.equal(model.api_key, "keep-me");
  assert.equal(model.base_url, GROK_KEDAYA_PROFILE.baseUrl);
  assert.equal(model.context_window, 500000);
  const cleared = applyGrokVisualPatch(parsed.value, {
    model: { id: GROK_KEDAYA_PROFILE.modelId, apiKey: "" },
  });
  assert.equal(cleared.ok, true);
  if (!cleared.ok) {
    return;
  }
  const serialized = serializeGrokDocument(cleared.document);
  assert.equal(serialized.ok, true);
  assert.match(serialized.content, /api_key = ""/);
});

test("keeps the last valid Grok TOML when parsing or visual values fail", () => {
  const previous = "custom_root = \"keep\"\n";
  const invalid = commitGrokText(previous, "[[[");
  assert.equal(invalid.ok, false);
  if (invalid.ok) {
    return;
  }
  assert.equal(invalid.reason, "invalid");
  assert.equal(invalid.content, previous);
  const parsed = parseGrokToml(previous);
  assert.equal(parsed.ok, true);
  if (!parsed.ok) {
    return;
  }
  const rejected = applyGrokVisualPatch(parsed.value, {
    model: { id: "grok-4.7", apiBackend: "wire_api", envKey: "not a var" },
  });
  assert.equal(rejected.ok, false);
  assert.equal(parsed.value.model, undefined);
  assert.equal(validateGrokDocument({
    model: { demo: { context_window: -1 } },
  }), "context_window 必须是非负整数。");
  assert.equal(resolveGrokEditorStatus({ loading: false, content: previous, parseError: "bad" }), "parse-error");
  assert.equal(isGrokVisualSaveDisabled({ status: "ready", fieldError: "api_backend 无效。" }), true);
  assert.equal(isGrokVisualSaveDisabled({ status: "parse-error", fieldError: null }), true);
});

test("writes the kedaya profile by merge without touching settings snapshots", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "grok-config-"));
  const grokHome = path.join(home, ".grok");
  await fs.mkdir(grokHome, { recursive: true });
  await fs.writeFile(path.join(grokHome, "settings.json"), "{\"unrelated\":true}\n", "utf8");
  await fs.writeFile(path.join(grokHome, "config.toml"), "custom_root = \"keep\"\n", "utf8");
  const applied = await applyGrokKedayaProfile({
    env: { GROK_HOME: grokHome },
    homeDir: home,
    now: 10,
  });
  assert.equal(applied.configPath, path.join(grokHome, "config.toml"));
  const saved = await fs.readFile(applied.configPath, "utf8");
  assert.match(saved, /custom_root = "keep"/);
  assert.match(saved, /grok-4\.7-kedaya/);
  assert.match(saved, /api_key = ""/);
  assert.doesNotMatch(saved, /apiKey/);
  const profile = JSON.parse(await fs.readFile(applied.profilePath, "utf8")) as Record<string, unknown>;
  assert.equal(profile.platform, "grok");
  assert.equal(profile.sourceConfigId, GROK_KEDAYA_PROFILE.sourceConfigId);
  assert.equal("authContent" in profile, false);
  assert.equal(await fs.readFile(path.join(grokHome, "settings.json"), "utf8"), "{\"unrelated\":true}\n");
  assert.doesNotMatch(saved, /apiKey/);
  await fs.rm(home, { recursive: true, force: true });
});


test("detects a default model credential without treating env_key as the secret", () => {
  const parsed = parseGrokToml(`
[models]
default = "grok-4.7"

[model."grok-4.7"]
api_key = ""
env_key = "GROK_GATEWAY_KEY"
`);
  assert.equal(parsed.ok, true);
  if (!parsed.ok) {
    return;
  }
  assert.equal(grokActiveModelHasOwnCredential(parsed.value, {}), false);
  assert.equal(grokActiveModelHasOwnCredential(parsed.value, { GROK_GATEWAY_KEY: "present" }), true);
  const keyed = parseGrokToml(`
[models]
default = "grok-4.7"

[model."grok-4.7"]
api_key = "present"
`);
  assert.equal(keyed.ok, true);
  if (!keyed.ok) {
    return;
  }
  assert.equal(grokActiveModelHasOwnCredential(keyed.value, {}), true);
  keyed.value.model = {
    ...(keyed.value.model as Record<string, never>),
    "gpt-6.1-sol": { model: "gpt-6.1-sol", api_key: "" },
    authenticated: { model: "gpt-6.1-sol", env_key: "SOL_TEST_KEY" },
  };
  assert.equal(grokActiveModelHasOwnCredential(keyed.value, {}, "gpt-6.1-sol"), false);
  assert.equal(grokActiveModelHasOwnCredential(keyed.value, {}, "missing"), false);
  assert.equal(grokActiveModelHasOwnCredential(keyed.value, { SOL_TEST_KEY: "present" }, "authenticated"), true);
  delete keyed.value.models;
  assert.equal(grokActiveModelHasOwnCredential(keyed.value, { SOL_TEST_KEY: "present" }, "authenticated"), true);
});
