import test = require("node:test");
import assert = require("node:assert/strict");
import { parseCodexConfigModel } from "../../cli/codexConfigModel";

test("Codex reads only the root string model from valid TOML", () => {
  for (const content of [
    'model = "configured-model"',
    "model = ' configured-model ' # active model",
    '"model" = "configured-model"\n[model_providers.gateway]\nmodel = "nested-model"',
    '\uFEFFmodel = "configured-model"\r\n[projects."C:\\\\workspace"]\r\ntrust_level = "trusted"',
    'model = "configured\\u002dmodel"',
  ]) {
    assert.equal(parseCodexConfigModel(content), "configured-model", content);
  }
});

test("Codex retains the CLI default for absent, nested, empty or invalid models", () => {
  for (const content of [
    "",
    '# model = "commented-model"',
    '[model_providers.gateway]\nmodel = "nested-model"',
    '[profiles.work]\nmodel = "profile-model"',
    'model = "  "',
    'model = ["not-a-string"]',
    "model = true",
    "model = 42",
    'model = "unterminated',
    'model = "first"\nmodel = "duplicate"',
  ]) {
    assert.equal(parseCodexConfigModel(content), null, content);
  }
});
