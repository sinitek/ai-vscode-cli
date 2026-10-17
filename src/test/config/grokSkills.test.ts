import test = require("node:test");
import assert = require("node:assert/strict");

import { parseGrokToml } from "../../config/grokToml";
import { mergeGrokSkillsConfig } from "../../config/grokSkills";

test.describe("grok skills", { concurrency: false }, () => {
  test("merge adds and removes disabled while keeping api_key, marketplace, ui, and other tables", () => {
    const original = [
      "[model.demo]",
      'api_key = "secret-key"',
      'marketplace = "keep-market"',
      "",
      "[marketplace]",
      'name = "keep-market-table"',
      "",
      "[ui]",
      'theme = "dark"',
      "",
      "[skills]",
      'paths = ["~/team"]',
      'ignore = ["~/team/wip"]',
      'disabled = ["kept", "alpha"]',
      "",
      "[extra]",
      'note = "stay"',
      "",
    ].join("\n");

    const disabled = mergeGrokSkillsConfig(original, [
      { name: "alpha", path: "/tmp/alpha", enabled: true },
      { name: "beta", path: "/tmp/beta", enabled: true },
      { name: "gamma", path: "/tmp/gamma", enabled: false },
    ]);
    assert.equal(disabled.ok, true);
    if (!disabled.ok) {
      return;
    }
    const disabledDocument = parseGrokToml(disabled.content);
    assert.equal(disabledDocument.ok, true);
    if (!disabledDocument.ok) {
      return;
    }
    const model = disabledDocument.value.model;
    assert.equal(typeof model, "object");
    assert.ok(model && !Array.isArray(model));
    const demo = (model as { demo: { api_key: string; marketplace: string } }).demo;
    assert.equal(demo.api_key, "secret-key");
    assert.equal(demo.marketplace, "keep-market");
    assert.equal((disabledDocument.value.marketplace as { name: string }).name, "keep-market-table");
    assert.equal((disabledDocument.value.ui as { theme: string }).theme, "dark");
    assert.equal((disabledDocument.value.extra as { note: string }).note, "stay");
    const skills = disabledDocument.value.skills as { disabled: string[]; paths: string[]; ignore: string[] };
    assert.deepEqual(skills.disabled, ["kept", "gamma"]);
    assert.deepEqual(skills.paths, ["~/team"]);
    assert.deepEqual(skills.ignore, ["~/team/wip"]);
    assert.doesNotMatch(disabled.content, /\[\[skills\.config\]\]/);
    assert.doesNotMatch(disabled.content, /enabled = false/);
    assert.doesNotMatch(disabled.content, /sinitek codex skills/);
    assert.doesNotMatch(disabled.content, /\[features\]/);

    const enabled = mergeGrokSkillsConfig(disabled.content, [
      { name: "alpha", path: "/tmp/alpha", enabled: true },
      { name: "gamma", path: "/tmp/gamma", enabled: true },
      { name: "kept", path: "/tmp/kept", enabled: true },
    ]);
    assert.equal(enabled.ok, true);
    if (!enabled.ok) {
      return;
    }
    const enabledDocument = parseGrokToml(enabled.content);
    assert.equal(enabledDocument.ok, true);
    if (!enabledDocument.ok) {
      return;
    }
    const remaining = enabledDocument.value.skills as { disabled?: string[]; paths: string[]; ignore: string[] };
    assert.equal(remaining.disabled, undefined);
    assert.deepEqual(remaining.paths, ["~/team"]);
    assert.deepEqual(remaining.ignore, ["~/team/wip"]);
    const enabledModel = enabledDocument.value.model as { demo: { api_key: string; marketplace: string } };
    assert.equal(enabledModel.demo.api_key, "secret-key");
    assert.equal(enabledModel.demo.marketplace, "keep-market");
    assert.equal((enabledDocument.value.marketplace as { name: string }).name, "keep-market-table");
    assert.equal((enabledDocument.value.ui as { theme: string }).theme, "dark");
  });

  test("invalid TOML is returned unchanged", () => {
    const invalid = "[\nthis is not toml";
    const result = mergeGrokSkillsConfig(invalid, [
      { name: "alpha", path: "/tmp/alpha", enabled: false },
    ]);
    assert.equal(result.ok, false);
    if (result.ok) {
      return;
    }
    assert.equal(result.content, invalid);
    assert.equal(typeof result.error, "string");
    assert.ok(result.error.length > 0);
  });
});
