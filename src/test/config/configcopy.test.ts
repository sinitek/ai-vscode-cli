import test = require("node:test");
import assert = require("node:assert/strict");
import * as fs from "fs";
import * as fsPromises from "fs/promises";
import * as http from "http";
import * as https from "https";
import * as childProcess from "child_process";
import {
  assertConfigCopyAllowed,
  buildConfigCopy,
  createConfigCopyName,
  type ConfigCopyMetadata,
} from "../../config/configCopy";
import { createKimiCodeDefaultConfigText } from "../../config/kimiCodeConfig";
import { createZcodeExampleText } from "../../config/zcodeConfig";
import type { ConfigItem, CurrentConfigPlatform } from "../../config/types";

const platforms: CurrentConfigPlatform[] = ["claude", "codex", "opencode", "grok", "dsh", "kimi-code", "zcode"];
const metadata: ConfigCopyMetadata = Object.freeze({ id: "fixed-copy", name: "固定副本", createdAt: 123, updatedAt: 456 });
const skill = Object.freeze({ name: "合成技能", path: "/synthetic/skill", enabled: true });
const skills = [skill];

function profile(platform: CurrentConfigPlatform, fields: Record<string, unknown> = {}): ConfigItem {
  return {
    id: "source", name: "原档案", platform, createdAt: 10, updatedAt: 20,
    content: "legacy", configContent: "canonical", authContent: "auth", mcpContent: "mcp", envContent: "env",
    claudeSkills: skills, codexSkills: skills, openCodeSkills: skills, grokSkills: skills,
    sourcePlatform: "codex", sourceId: "old", sourceName: "old", migrationVersion: "old",
    ...fields,
  };
}

function base(platform: CurrentConfigPlatform): ConfigItem {
  return { ...metadata, platform };
}

test("copy naming preserves suffixes, numbering gaps, case and input names", () => {
  const names = ["档案", "档案_副本", "档案_副本2", "档案_副本4"];
  const original = [...names];
  assert.equal(createConfigCopyName("档案", []), "档案_副本");
  assert.equal(createConfigCopyName("档案", names), "档案_副本3");
  assert.equal(createConfigCopyName("档案_副本", names), "档案_副本_副本");
  assert.equal(createConfigCopyName("", []), "_副本");
  assert.equal(createConfigCopyName(" 原名 ", []), " 原名 _副本");
  assert.equal(createConfigCopyName("Name", ["name_副本"]), "Name_副本");
  assert.deepEqual(names, original);
});

test("all 49 platform pairs preserve allowed paths, exact rejection messages and priority", () => {
  const restrictions: [CurrentConfigPlatform, string][] = [
    ["opencode", "OpenCode configs can only be copied as OpenCode configs; Claude/Codex configs are not converted."],
    ["dsh", "DSH configs can only be copied as DSH configs."],
    ["kimi-code", "Kimi Code configs can only be copied as Kimi Code configs."],
    ["zcode", "ZCode configs can only be copied as ZCode configs."],
  ];
  for (const source of platforms) {
    for (const target of platforms) {
      const rejected = source === target ? undefined : restrictions.find(([platform]) => source === platform || target === platform);
      if (rejected) {
        assert.throws(() => assertConfigCopyAllowed(source, target), { message: rejected[1] }, `${source} → ${target}`);
      } else {
        assert.equal(assertConfigCopyAllowed(source, target), undefined);
      }
    }
  }
});

for (const platform of platforms) {
  test(`${platform} constructs exact fields without mutating source and preserves shallow Skills copies`, () => {
    const source = profile(platform, platform === "opencode" ? { content: '{"model":"fixture/model"}' } : {});
    const snapshot = JSON.stringify(source);
    Object.freeze(source);
    for (const values of [source.claudeSkills, source.codexSkills, source.openCodeSkills, source.grokSkills]) Object.freeze(values);
    const result = buildConfigCopy(source, platform, metadata);
    const fields: Record<CurrentConfigPlatform, Partial<ConfigItem>> = {
      claude: { content: "legacy", mcpContent: "mcp", claudeSkills: skills },
      codex: { content: "canonical", configContent: "canonical", authContent: "auth", codexSkills: skills },
      opencode: { content: '{\n  "model": "fixture/model"\n}\n', openCodeSkills: skills },
      grok: { content: "canonical", configContent: "canonical", grokSkills: skills },
      dsh: { content: "canonical", configContent: "canonical" },
      "kimi-code": { content: "canonical", configContent: "canonical" },
      zcode: { content: "canonical", configContent: "canonical" },
    };
    assert.deepEqual(result, { ...base(platform), ...fields[platform] });
    assert.equal(JSON.stringify(source), snapshot);
    assert.notEqual(result, source);
    for (const field of ["claudeSkills", "codexSkills", "openCodeSkills", "grokSkills"] as const) {
      if (result[field]) {
        assert.notEqual(result[field], source[field]);
        assert.equal(result[field]?.[0], source[field]?.[0]);
      }
    }
  });
}

for (const platform of ["codex", "grok", "dsh", "kimi-code", "zcode"] as const) {
  test(`${platform} keeps canonical empty string ahead of content and handles nullish fallback`, () => {
    for (const [configContent, content, expected] of [
      ["", "legacy", ""], [undefined, "legacy", "legacy"], [null, "legacy", "legacy"],
      [undefined, "", ""], [undefined, undefined, ""], [null, null, ""],
    ]) {
      const result = buildConfigCopy(profile(platform, { configContent, content }), platform, metadata);
      assert.equal(result.content, expected);
      assert.equal(result.configContent, expected);
    }
  });
}

test("Claude and Codex preserve empty strings while defaulting only nullish auth, MCP and Skills", () => {
  for (const missing of [undefined, null]) {
    assert.deepEqual(buildConfigCopy(profile("claude", { content: missing, mcpContent: missing, claudeSkills: missing }), "claude", metadata), {
      ...base("claude"), content: "{}", mcpContent: "{}", claudeSkills: [],
    });
    assert.deepEqual(buildConfigCopy(profile("codex", { content: missing, configContent: missing, authContent: missing, codexSkills: missing }), "codex", metadata), {
      ...base("codex"), content: "", configContent: "", authContent: "{}", codexSkills: [],
    });
    assert.deepEqual(buildConfigCopy(profile("grok", { grokSkills: missing }), "grok", metadata).grokSkills, []);
    assert.deepEqual(buildConfigCopy(profile("opencode", { openCodeSkills: missing }), "opencode", metadata).openCodeSkills, []);
  }
  assert.deepEqual(buildConfigCopy(profile("claude", { content: "", mcpContent: "" }), "claude", metadata), {
    ...base("claude"), content: "", mcpContent: "", claudeSkills: skills,
  });
  assert.equal(buildConfigCopy(profile("codex", { authContent: "" }), "codex", metadata).authContent, "");
});

test("historical Claude/Codex/Grok cross copies do not carry credentials or other Skills", () => {
  for (const source of ["claude", "codex", "grok"] as const) {
    for (const target of ["codex", "grok"] as const) {
      if (source === target) continue;
      const result = buildConfigCopy(profile(source), target, metadata);
      assert.deepEqual(result, target === "codex"
        ? { ...base(target), content: "", configContent: "", authContent: "{}", codexSkills: [] }
        : { ...base(target), content: "", configContent: "", grokSkills: [] });
    }
  }
});

test("Codex to Claude retains the limited line-based TOML MCP extractor and formatting", () => {
  const configContent = [
    'model = "ignored"', '[mcp_servers."fixture"]', 'command = "npx"', "args = ['first', 'second']",
    'env = {"KEY":"value"}', 'timeout = 30', 'enabled = true', 'bad = [not-json]',
    'broken line', '[mcp_servers.fixture.env]', 'SECRET = "not-copied"', '[other]', 'command = "ignored"',
  ].join("\r\n");
  assert.deepEqual(buildConfigCopy(profile("codex", { configContent }), "claude", metadata), {
    ...base("claude"), content: "{}", claudeSkills: [],
    mcpContent: JSON.stringify({ mcp: {
      fixture: { command: "npx", args: ["first", "second"], env: { KEY: "value" }, timeout: "30", enabled: "true", bad: "[not-json]" },
      "fixture.env": { SECRET: "not-copied" },
    } }, null, 2),
  });
  assert.equal(buildConfigCopy(profile("codex", { configContent: "", content: configContent }), "claude", metadata).mcpContent, "{}");
});

test("Grok to Claude preserves MCP precedence and strict-JSON empty-object fallback", () => {
  const cases: [string | undefined, Record<string, unknown>][] = [
    ['{"mcpServers":{"first":{}},"mcp":{"second":{}},"mcp_servers":{"third":{}}}', { mcp: { first: {} } }],
    ['{"mcpServers":{},"mcp":{"second":{}}}', {}],
    ['{"mcpServers":[],"mcp":{"second":{}}}', { mcp: { second: {} } }],
    ['{"mcp":null,"mcp_servers":{"third":{}}}', { mcp: { third: {} } }],
    ['{"mcp":[]}', {}], ['{"mcp":{"ignored":{}},}', {}], ['{/* comment */ "mcp":{}}', {}],
    ["invalid", {}], ["[]", {}], ["null", {}], ["", {}], [undefined, {}],
  ];
  for (const [content, expected] of cases) {
    assert.deepEqual(buildConfigCopy(profile("grok", { content }), "claude", metadata), {
      ...base("claude"), content: "{}", mcpContent: JSON.stringify(expected, null, 2), claudeSkills: [],
    });
  }
});

test("OpenCode JSONC preserves formatting, newline and conditional legacy MCP conversion", () => {
  const cases: [string, Record<string, unknown>][] = [
    ['{ // comment\n "model":"fixture/model", "mcpServers":{"fixture":{"command":["run",],},},}', { model: "fixture/model", mcp: { fixture: { command: ["run"] } } }],
    ['{"mcpServers":{"old":{}},"mcp":{"current":{}}}', { mcpServers: { old: {} }, mcp: { current: {} } }],
    ['{"mcpServers":{"old":{}},"mcp":{}}', { mcpServers: { old: {} }, mcp: {} }],
    ['{"mcpServers":{},"mcp":[]}', { mcp: {} }],
    ['{"mcpServers":[],"mcp":null}', { mcpServers: [], mcp: null }],
    ['{"url":"https://synthetic.invalid//path","text":"/*literal*/"}', { url: "https://synthetic.invalid//path", text: "/*literal*/" }],
    ["invalid", {}], ["[]", {}], ["null", {}], [" ", {}], ["{/*unclosed", {}],
  ];
  for (const [content, expected] of cases) {
    const source = Object.freeze(profile("opencode", { content }));
    assert.deepEqual(buildConfigCopy(source, "opencode", metadata), {
      ...base("opencode"), content: `${JSON.stringify(expected, null, 2)}\n`, openCodeSkills: skills,
    });
    assert.equal(source.content, content);
  }
});

test("construction preserves legacy unreachable OpenCode element-copy branches without allowing them in facade", () => {
  for (const platform of ["claude", "codex"] as const) {
    const source = profile(platform, { content: '{"mcpServers":{"fixture":{}}}' });
    const result = buildConfigCopy(source, "opencode", metadata);
    assert.deepEqual(result.openCodeSkills, skills);
    assert.notEqual(result.openCodeSkills, skills);
    assert.notEqual(result.openCodeSkills?.[0], skill);
    assert.equal(result.content, '{\n  "mcp": {\n    "fixture": {}\n  }\n}\n');
    assert.throws(() => assertConfigCopyAllowed(platform, "opencode"));
  }
  assert.deepEqual(buildConfigCopy(profile("grok"), "opencode", metadata).openCodeSkills, []);
});

test("single-document fallbacks stay field-minimal even when directly constructed from other platforms", () => {
  const source = profile("claude");
  for (const [platform, content] of [
    ["dsh", ""], ["kimi-code", createKimiCodeDefaultConfigText()], ["zcode", createZcodeExampleText()],
  ] as const) {
    assert.deepEqual(buildConfigCopy(source, platform, metadata), { ...base(platform), content, configContent: content });
    assert.throws(() => assertConfigCopyAllowed("claude", platform));
  }
});

test("fixed metadata construction performs no filesystem, network, subprocess, clock or randomness operations", (context) => {
  const forbidden = () => { throw new Error("copy strategies must not perform I/O or generate metadata"); };
  for (const method of ["readFileSync", "writeFileSync", "existsSync", "mkdirSync", "statSync", "openSync", "readFile", "writeFile", "mkdir", "stat", "access", "readdir", "unlink", "rename"] as const) {
    context.mock.method(fs, method, forbidden);
  }
  for (const method of ["readFile", "writeFile", "access", "mkdir", "stat", "readdir", "unlink", "rename", "open"] as const) {
    context.mock.method(fsPromises, method, forbidden);
  }
  context.mock.method(http, "request", forbidden);
  context.mock.method(http, "get", forbidden);
  context.mock.method(https, "request", forbidden);
  context.mock.method(https, "get", forbidden);
  context.mock.method(childProcess, "spawn", forbidden);
  context.mock.method(childProcess, "exec", forbidden);
  context.mock.method(Date, "now", forbidden);
  context.mock.method(Math, "random", forbidden);
  for (const source of platforms) {
    for (const target of platforms) {
      assert.deepEqual(buildConfigCopy(profile(source), target, metadata), buildConfigCopy(profile(source), target, metadata));
    }
  }
  assert.equal(createConfigCopyName("原档案", []), "原档案_副本");
  assert.equal(assertConfigCopyAllowed("claude", "codex"), undefined);
  assert.equal(Object.keys(require.cache).some((file) => /[/\\]configService\.js$/.test(file)), false);
});
