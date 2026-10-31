import assert = require("node:assert/strict");
import test = require("node:test");
import * as fs from "node:fs";
import * as path from "node:path";
import * as vm from "node:vm";
import { assertConfigSourceFormat } from "../../config/configSourceValidation";
import { normalizeJsonObjectText } from "../../shared/jsonObject";
import type { ConfigItem, CurrentConfigPlatform } from "../../config/types";

function profile(platform: CurrentConfigPlatform, content: string, fields: Partial<ConfigItem> = {}): ConfigItem {
  return { id: "syntax-test", name: "格式测试", platform, content, createdAt: 1, updatedAt: 1, ...fields };
}

for (const platform of ["claude", "opencode", "dsh", "zcode"] as const) {
  test(`${platform} rejects invalid JSON and non-object roots before saving`, () => {
    for (const source of ['{"model":', "[]", "null", '"text"', "true", "42"]) {
      assert.throws(() => assertConfigSourceFormat(profile(platform, source)), /JSON 格式错误/);
    }
    assert.doesNotThrow(() => assertConfigSourceFormat(profile(platform, '{"描述":"中文","nested":{"enabled":true}}')));
  });
}

for (const platform of ["codex", "grok", "kimi-code"] as const) {
  test(`${platform} rejects invalid TOML, repeated keys and repeated tables`, () => {
    for (const source of ['model = "broken', 'model = "a"\nmodel = "b"', "[models\n", "[models]\n[models]\n", "items = [1,\n"]) {
      assert.throws(() => assertConfigSourceFormat(profile(platform, source)), /config\.toml：TOML 格式错误（第 \d+ 行，第 \d+ 列）/);
    }
  });
  test(`${platform} accepts full TOML syntax without converting source`, () => {
    const source = `# 保留注释\nmodel = "example"\ncreated = 2026-10-31T12:00:00Z\nitems = [\n  "one",\n  "two",\n]\n["quoted.provider"]\nparams = { enabled = true, limit = 1_024 }\nmessage = """\n多行内容\n"""\n[[agents]]\nname = "助手"\n`;
    const config = profile(platform, source);
    assert.doesNotThrow(() => assertConfigSourceFormat(config));
    assert.equal(config.content, source);
  });
}

test("canonical configContent wins over stale content without checking the unused alias", () => {
  for (const platform of ["codex", "grok", "kimi-code", "dsh", "zcode"] as const) {
    const valid = platform === "dsh" || platform === "zcode" ? "{}" : 'model = "example"';
    assert.doesNotThrow(() => assertConfigSourceFormat(profile(platform, "broken", { configContent: valid })));
    assert.throws(() => assertConfigSourceFormat(profile(platform, valid, { configContent: "broken" })), /格式错误/);
  }
});

test("Codex auth.json is checked independently and identifies the failed file", () => {
  assert.throws(() => assertConfigSourceFormat(profile("codex", 'model = "example"', { authContent: '{"token":' })), /auth\.json：JSON 格式错误/);
  assert.throws(() => assertConfigSourceFormat(profile("codex", "", { authContent: "[]" })), /auth\.json/);
  assert.doesNotThrow(() => assertConfigSourceFormat(profile("codex", "", { authContent: "{}" })));
});

test("existing empty drafts and OpenCode JSONC remain supported", () => {
  assert.doesNotThrow(() => assertConfigSourceFormat(profile("codex", "")));
  assert.doesNotThrow(() => assertConfigSourceFormat(profile("claude", "")));
  assert.doesNotThrow(() => assertConfigSourceFormat(profile("opencode", '{\n// note\n"model": "api/model",\n}')));
  assert.throws(() => assertConfigSourceFormat(profile("claude", '{/*comment*/"model":"example"}')), /JSON 格式错误/);
});

function loadBrowserValidation() {
  const source = fs.readFileSync(path.resolve(__dirname, "../../../media/config/assets/config-app-ui.js"), "utf8");
  const start = source.indexOf("function showConfigSaveError(");
  const end = source.indexOf("const GROK_VISUAL_FIELD_IDS", start);
  assert.ok(start >= 0 && end > start);
  const dialogs: Array<{ title: string; content: { children: string } }> = [];
  const helpers = vm.runInNewContext(`${source.slice(start, end)}\n({ parseConfigJsonText, validateConfigJsonForSave })`, {
    xr: { error: (dialog: (typeof dialogs)[number]) => dialogs.push(dialog) },
    be: { jsx: (_tag: string, props: unknown) => props },
  }) as {
    parseConfigJsonText: (source: string, jsonc?: boolean) => unknown;
    validateConfigJsonForSave: (source: string, file: string, jsonc?: boolean) => boolean;
  };
  return { ...helpers, dialogs };
}

test("browser JSON validation matches host parsing without changing string contents", () => {
  const browser = loadBrowserValidation();
  for (const jsonc of [false, true]) {
    for (const source of [
      '\uFEFF{"note":"keep,} and ,]","url":"https://example.test/*literal*/"}',
      JSON.stringify({ escaped: 'quote" and slash\\', nested: { value: "中文,}" } }),
      ...(jsonc ? ['{/*注释*/"note":"keep,}","items":[true, false,],//注释\n}'] : []),
    ]) {
      const expected = JSON.parse(normalizeJsonObjectText(source, jsonc ? "jsonc" : "strict"));
      assert.equal(JSON.stringify(browser.parseConfigJsonText(source, jsonc)), JSON.stringify(expected));
      assert.equal(browser.validateConfigJsonForSave(source, "config.json", jsonc), true);
    }
  }
  assert.equal(browser.dialogs.length, 0);
});

test("browser and host reject malformed JSONC before saving", () => {
  const browser = loadBrowserValidation();
  for (const source of ['{}/*未闭合', '{"value":1/*注释*/2}', '{"value":"未闭合}', '{"value":,}']) {
    assert.equal(browser.validateConfigJsonForSave(source, "config.json", true), false);
    assert.throws(() => assertConfigSourceFormat(profile("opencode", source)), /JSON 格式错误/);
  }
  for (const source of ['{/*注释*/"value":true}', '{"value":true,}', "[]", "null"]) {
    assert.equal(browser.validateConfigJsonForSave(source, "auth.json"), false);
    assert.throws(() => assertConfigSourceFormat(profile("codex", "", { authContent: source })), /auth\.json/);
  }
  assert.equal(browser.dialogs.length, 8);
  assert.ok(browser.dialogs.every((dialog) => dialog.title === "配置保存失败" && /JSON 格式错误/.test(dialog.content.children)));
});
