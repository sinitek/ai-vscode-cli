import test = require("node:test");
import assert = require("node:assert/strict");
import {
  getCanonicalConfigContent,
  normalizeConfigProfileFields,
  type ConfigProfileNormalizationPhase,
} from "../../config/configprofilenormalization";
import type { ConfigItem, CurrentConfigPlatform } from "../../config/types";

const phases: ConfigProfileNormalizationPhase[] = ["list", "read", "save"];
const separateFields = ["authContent", "mcpContent", "envContent"];
const skillFields = ["claudeSkills", "codexSkills", "openCodeSkills", "grokSkills"];
const cases: { platform: CurrentConfigPlatform; synchronized: ConfigProfileNormalizationPhase[]; removed: string[] }[] = [
  { platform: "claude", synchronized: [], removed: [] },
  { platform: "codex", synchronized: phases, removed: ["envContent"] },
  { platform: "opencode", synchronized: [], removed: ["envContent"] },
  { platform: "grok", synchronized: ["list", "save"], removed: separateFields },
  { platform: "dsh", synchronized: phases, removed: [...separateFields, ...skillFields] },
  { platform: "kimi-code", synchronized: phases, removed: [...separateFields, ...skillFields] },
  { platform: "zcode", synchronized: phases, removed: [...separateFields, ...skillFields] },
];

function profile(platform: CurrentConfigPlatform, fields: Record<string, unknown> = {}): ConfigItem {
  return { id: "fixture", name: "合成档案", platform, createdAt: 10, updatedAt: 20, ...fields };
}

for (const { platform, synchronized, removed } of cases) {
  for (const phase of phases) {
    test(`${platform}/${phase} preserves exact fields and existing references, in place and idempotently`, () => {
      const skills = [{ name: "fixture", path: "/synthetic/skill", enabled: true }];
      const unknown = { nested: ["kept"] };
      const input = profile(platform, {
        content: "legacy", configContent: "canonical", authContent: "auth", mcpContent: "mcp", envContent: "env",
        claudeSkills: skills, codexSkills: skills, openCodeSkills: skills, grokSkills: skills, geminiSkills: skills,
        sourcePlatform: "codex", sourceId: "source", sourceName: "source", migrationVersion: "unchanged",
        unknown, experimentalSkills: skills,
      });
      const expected: Record<string, unknown> = { ...input };
      if (synchronized.includes(phase)) {
        expected.content = "canonical";
        expected.configContent = "canonical";
      }
      if (!(platform === "grok" && phase === "read")) {
        for (const field of removed) delete expected[field];
      }
      if (phase !== "list") delete expected.geminiSkills;
      assert.equal(normalizeConfigProfileFields(input, platform, phase), undefined);
      assert.deepEqual(input, expected);
      const fields = input as unknown as Record<string, unknown>;
      assert.equal(fields.unknown, unknown);
      assert.equal(fields.experimentalSkills, skills);
      for (const field of [...skillFields, "geminiSkills"]) {
        if (field in expected) assert.equal(fields[field], skills);
      }
      normalizeConfigProfileFields(input, platform, phase);
      assert.deepEqual(input, expected);
      assert.equal(fields.unknown, unknown);
    });

    test(`${platform}/${phase} retains canonical empty strings and nullish fallback rules`, () => {
      for (const [configContent, content, canonical] of [
        ["", "legacy", ""], ["canonical", "legacy", "canonical"],
        [undefined, "legacy", "legacy"], [null, "legacy", "legacy"],
        [undefined, "", ""], [undefined, undefined, ""], [null, null, ""],
      ] as const) {
        const input = profile(platform, { configContent, content });
        normalizeConfigProfileFields(input, platform, phase);
        if (synchronized.includes(phase)) {
          assert.equal(input.content, canonical);
          assert.equal(input.configContent, canonical);
        } else {
          assert.equal(input.content, content);
          assert.equal(input.configContent, configContent);
        }
      }
    });

    test(`${platform}/${phase} distinguishes undefined and null defaults`, () => {
      for (const value of [undefined, null]) {
        const input = profile(platform, {
          mcpContent: value, authContent: value, claudeSkills: value, codexSkills: value,
          openCodeSkills: value, grokSkills: value,
        });
        normalizeConfigProfileFields(input, platform, phase);
        if (platform === "claude") {
          assert.equal(input.mcpContent, phase !== "save" && value === undefined ? "{}" : value);
          assert.deepEqual(input.claudeSkills, phase !== "save" && value === undefined ? [] : value);
        } else if (platform === "codex") {
          assert.equal(input.authContent, "{}");
          assert.deepEqual(input.codexSkills, []);
        } else if (platform === "grok") {
          assert.deepEqual(input.grokSkills, phase === "read" ? value : []);
        } else if (platform === "opencode") {
          assert.deepEqual(input.openCodeSkills, value === undefined ? [] : null);
        } else {
          for (const field of [...separateFields, ...skillFields]) assert.equal(field in input, false);
        }
      }
      if (platform === "claude") {
        const input = profile(platform, { mcpContent: "", claudeSkills: null });
        normalizeConfigProfileFields(input, platform, phase);
        assert.equal(input.mcpContent, "");
        assert.equal(input.claudeSkills, null);
      }
      if (platform === "codex") {
        const input = profile(platform, { authContent: "", codexSkills: [] });
        const skills = input.codexSkills;
        normalizeConfigProfileFields(input, platform, phase);
        assert.equal(input.authContent, "");
        assert.equal(input.codexSkills, skills);
      }
    });
  }
}

for (const phase of phases) {
  test(`opencode/${phase} migrates legacy skills only at read/save and never replaces explicit skills`, () => {
    const legacy = [{ name: "legacy", path: "/synthetic/legacy", enabled: true }];
    const explicit: ConfigItem["openCodeSkills"] = [];
    for (const skills of [undefined, null, explicit]) {
      const input = profile("opencode", { geminiSkills: legacy, openCodeSkills: skills });
      normalizeConfigProfileFields(input, "opencode", phase);
      if (skills === undefined) {
        assert.deepEqual(input.openCodeSkills, phase === "list" ? [] : legacy);
        if (phase !== "list") assert.equal(input.openCodeSkills, legacy);
      } else {
        assert.equal(input.openCodeSkills, skills);
      }
      assert.equal("geminiSkills" in input, phase === "list");
      const snapshot = structuredClone(input);
      normalizeConfigProfileFields(input, "opencode", phase);
      assert.deepEqual(input, snapshot);
    }
    for (const geminiSkills of [undefined, null]) {
      const input = profile("opencode", { geminiSkills });
      normalizeConfigProfileFields(input, "opencode", phase);
      assert.deepEqual(input.openCodeSkills, []);
    }
  });
}

test("canonical content getter is shared with private copy callers and never mutates its input", () => {
  for (const [fields, expected] of [
    [{ configContent: "", content: "legacy" }, ""],
    [{ configContent: "canonical", content: "legacy" }, "canonical"],
    [{ content: "legacy" }, "legacy"], [{}, ""],
  ] as const) {
    assert.equal(getCanonicalConfigContent(Object.freeze(fields)), expected);
  }
});
