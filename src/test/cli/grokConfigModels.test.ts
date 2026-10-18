import test = require("node:test");
import assert = require("node:assert/strict");
import { parseGrokConfigModels, resolveGrokConfigModel } from "../../cli/grokConfigModels";

const content = `
[models]
default = "sol"
[model.grok]
model = "grok-4.7-kedaya"
[model.sol]
model = "gpt-6.1-sol"
name = "Display name must not override model"
[model."gpt-6.1-sol"]
model = "gpt-6.1-sol"
`;

test("uses API model fields as labels while keeping config keys as distinct selection values", () => {
  const parsed = parseGrokConfigModels(content);
  assert.deepEqual(parsed.models, ["grok", "sol", "gpt-6.1-sol"]);
  assert.deepEqual(parsed.labels, { grok: "grok-4.7-kedaya", sol: "gpt-6.1-sol", "gpt-6.1-sol": "gpt-6.1-sol" });
  assert.equal(parsed.error, null);
  assert.equal(resolveGrokConfigModel(parsed, null), "sol");
  assert.equal(resolveGrokConfigModel(parsed, " grok "), "grok");
  assert.equal(resolveGrokConfigModel(parsed, "gpt-6.1-sol"), "gpt-6.1-sol");
  assert.equal(resolveGrokConfigModel(parsed, "removed-model"), "sol");
  assert.equal(resolveGrokConfigModel(parsed, "SOL"), "sol");
});

test("falls back to config keys for missing, blank, or non-string model fields", () => {
  const parsed = parseGrokConfigModels(`
[model.missing]
name = "Not the model"
[model.blank]
model = "   "
[model.invalid]
model = 42
[model.trimmed]
model = " gpt-6.1-sol "
`);
  assert.deepEqual(parsed.labels, {
    missing: "missing", blank: "blank", invalid: "invalid", trimmed: "gpt-6.1-sol",
  });
});

test("falls back to the first declaration when the configured default was removed", () => {
  const parsed = parseGrokConfigModels(content.replace('default = "sol"', 'default = "missing"'));
  assert.equal(parsed.defaultModel, "grok");
  assert.equal(resolveGrokConfigModel(parsed, "missing"), "grok");
  assert.equal(parseGrokConfigModels('[model."only.model"]\nname = "Only"').defaultModel, "only.model");
});

test("does not expose stale manual models for empty, malformed, or invalid config tables", () => {
  for (const emptyContent of ["", '[models]\ndefault = "builtin"', '[model]\nnot_a_model = "text"']) {
    const parsed = parseGrokConfigModels(emptyContent);
    assert.deepEqual(parsed.models, []);
    assert.deepEqual(parsed.labels, {});
    assert.equal(resolveGrokConfigModel(parsed, "stale"), null);
  }
  for (const invalidContent of ["[[[", 'model = "wrong"']) {
    const parsed = parseGrokConfigModels(invalidContent);
    assert.ok(parsed.error);
    assert.deepEqual(parsed.labels, {});
    assert.equal(resolveGrokConfigModel(parsed, "stale"), null);
  }
  assert.equal(resolveGrokConfigModel(undefined, "stale"), null);
});
