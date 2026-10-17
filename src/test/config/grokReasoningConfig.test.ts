import assert = require("node:assert/strict");
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import test = require("node:test");
import { GROK_REASONING_EFFORTS } from "../../cli/types";
import { ensureGrokReasoningConfig, mergeGrokReasoningConfig } from "../../config/grokReasoningConfig";
import { parseGrokToml, type GrokTomlTable } from "../../config/grokToml";

function readModels(content: string): Record<string, GrokTomlTable> {
  const parsed = parseGrokToml(content);
  if (!parsed.ok) {
    throw new Error(parsed.error);
  }
  return parsed.value.model as Record<string, GrokTomlTable>;
}

test("adds missing reasoning options for the default model while preserving original TOML", () => {
  const content = '# Keep this comment\r\n[models]\r\ndefault = "custom.v1"\r\n[model."custom.v1"]\r\nmodel = "remote-model"\r\napi_key = "fixture"\r\ncustom_note = "keep"\r\n';
  const merged = mergeGrokReasoningConfig(content);
  assert.equal(merged.changed, true);
  assert.equal(merged.modelId, "custom.v1");
  assert.equal(merged.content.startsWith(content), true);
  assert.equal(merged.content.replace(/\r\n/gu, "").includes("\n"), false);
  const model = readModels(merged.content)["custom.v1"];
  assert.equal(model.api_key, "fixture");
  assert.equal(model.custom_note, "keep");
  assert.deepEqual(model.reasoning_efforts, GROK_REASONING_EFFORTS.map((value) => ({ value, label: value })));
  assert.deepEqual(mergeGrokReasoningConfig(merged.content), { ...merged, changed: false });
});

test("prefers the selected config key or remote model ID without modifying other models", () => {
  const content = '[models]\ndefault = "default"\n[model.default]\nmodel = "default-model"\n[model.selected]\nmodel = "selected-model"\n';
  for (const selectedModel of ["selected", " selected-model "]) {
    const merged = mergeGrokReasoningConfig(content, selectedModel);
    const models = readModels(merged.content);
    assert.equal(merged.modelId, "selected");
    assert.equal(models.default.reasoning_efforts, undefined);
    assert.ok(Array.isArray(models.selected.reasoning_efforts));
  }
});

test("keeps existing options, explicit disable, unknown models and empty configurations unchanged", () => {
  for (const declaration of [
    'reasoning_efforts = [{ value = "high", label = "Custom high" }]',
    "reasoning_efforts = []",
    "supports_reasoning_effort = false",
  ]) {
    const content = `[models]\ndefault = "custom"\n[model.custom]\nmodel = "custom"\n${declaration}\n`;
    assert.equal(mergeGrokReasoningConfig(content).content, content);
    assert.equal(mergeGrokReasoningConfig(content).changed, false);
  }
  for (const content of ["", '[models]\ndefault = "built-in"\n']) {
    assert.equal(mergeGrokReasoningConfig(content).changed, false);
  }
  assert.equal(mergeGrokReasoningConfig('[model.custom]\nmodel = "custom"\n', "built-in").changed, false);
  assert.throws(() => mergeGrokReasoningConfig('[model."broken"'), /Invalid Grok configuration/);
});

test("handles literal model headers, no final newline and inline model definitions", () => {
  for (const content of [
    "[models]\ndefault = 'custom.v1'\n[model.'custom.v1'] # Keep header\nmodel = 'remote'",
    '[models]\ndefault = "custom.v1"\n[model]\n"custom.v1" = { model = "remote", custom_note = "keep" }\n',
    'model = { "custom.v1" = { model = "remote", custom_note = "keep" } }\n[models]\ndefault = "custom.v1"\n',
  ]) {
    const merged = mergeGrokReasoningConfig(content);
    assert.equal(merged.changed, true);
    assert.equal(readModels(merged.content)["custom.v1"].model, "remote");
    assert.ok(Array.isArray(readModels(merged.content)["custom.v1"].reasoning_efforts));
    assert.equal(mergeGrokReasoningConfig(merged.content).changed, false);
  }
});

test("persists preflight changes atomically, preserving permissions and concurrent model updates", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "sinitek-grok-reasoning-"));
  const configPath = path.join(home, "config.toml");
  const env = { GROK_HOME: home };
  try {
    assert.equal(await ensureGrokReasoningConfig({ env, thinkingMode: "high" }), false);
    const content = '[models]\ndefault = "first"\n[model.first]\nmodel = "first"\n[model.second]\nmodel = "second"\n';
    await fs.writeFile(configPath, content, { mode: 0o600 });
    assert.equal(await ensureGrokReasoningConfig({ env, thinkingMode: "invalid" }), false);
    assert.equal(await fs.readFile(configPath, "utf8"), content);
    assert.deepEqual(await Promise.all([
      ensureGrokReasoningConfig({ env, model: "first", thinkingMode: "off" }),
      ensureGrokReasoningConfig({ env, model: "second", thinkingMode: "ultra" }),
      ensureGrokReasoningConfig({ env, model: "first", thinkingMode: "high" }),
    ]), [true, true, false]);
    const updated = await fs.readFile(configPath, "utf8");
    assert.ok(Array.isArray(readModels(updated).first.reasoning_efforts));
    assert.ok(Array.isArray(readModels(updated).second.reasoning_efforts));
    assert.equal(updated.startsWith(content), true);
    if (process.platform !== "win32") {
      assert.equal((await fs.stat(configPath)).mode & 0o777, 0o600);
    }
    assert.deepEqual(await fs.readdir(home), ["config.toml"]);
  } finally {
    await fs.rm(home, { recursive: true, force: true });
  }
});

test("preserves malformed configurations and recovers the preflight queue after a failure", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "sinitek-grok-reasoning-failure-"));
  const configPath = path.join(home, "config.toml");
  const env = { GROK_HOME: home };
  try {
    const invalid = '[model."unfinished"';
    await fs.writeFile(configPath, invalid);
    await assert.rejects(ensureGrokReasoningConfig({ env, thinkingMode: "high" }), /Invalid Grok configuration/);
    assert.equal(await fs.readFile(configPath, "utf8"), invalid);
    await fs.writeFile(configPath, '[models]\ndefault = "custom"\n[model.custom]\nmodel = "custom"\n');
    assert.equal(await ensureGrokReasoningConfig({ env, thinkingMode: "high" }), true);
    await fs.rm(configPath);
    await fs.mkdir(configPath);
    await assert.rejects(ensureGrokReasoningConfig({ env, thinkingMode: "high" }));
  } finally {
    await fs.rm(home, { recursive: true, force: true });
  }
});

test("updates symlinked configurations without replacing the symlink", { skip: process.platform === "win32" }, async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "sinitek-grok-reasoning-link-"));
  const configPath = path.join(home, "config.toml");
  const targetPath = path.join(home, "actual-config.toml");
  try {
    await fs.writeFile(targetPath, '[models]\ndefault = "custom"\n[model.custom]\nmodel = "custom"\n', { mode: 0o600 });
    await fs.symlink(targetPath, configPath);
    assert.equal(await ensureGrokReasoningConfig({ env: { GROK_HOME: home }, thinkingMode: "high" }), true);
    assert.equal((await fs.lstat(configPath)).isSymbolicLink(), true);
    assert.ok(Array.isArray(readModels(await fs.readFile(targetPath, "utf8")).custom.reasoning_efforts));
  } finally {
    await fs.rm(home, { recursive: true, force: true });
  }
});
