import test = require("node:test");
import assert = require("node:assert/strict");
import { t } from "../../i18n";
import {
  createCliRuntimeConfigStrategies,
  type CliRuntimeConfigIoPorts,
} from "../../config/cliRuntimeConfigStrategies";
import type { ApplyPayload, CurrentConfigPlatform } from "../../config/types";

const VALID_GROK_TOML = [
  "# keep comment",
  "[models]",
  "default = \"grok\"",
  "",
  "[model.grok]",
  "model = \"grok-4\"",
  "kept_note = \"leave-me\"",
  "",
  "[custom]",
  "kept = true",
  "",
].join("\n");

function unused(name: string): () => Promise<never> {
  return async () => {
    throw new Error(`unexpected ${name}`);
  };
}

function createPorts(): CliRuntimeConfigIoPorts {
  return {
    claude: {
      readClaudeConfig: unused("readClaudeConfig"),
      readClaudeMcpConfig: unused("readClaudeMcpConfig"),
      writeClaudeConfig: unused("writeClaudeConfig"),
      writeClaudeMcpConfig: unused("writeClaudeMcpConfig"),
      backupClaudeConfig: unused("backupClaudeConfig"),
    },
    codex: {
      readCodexConfig: unused("readCodexConfig"),
      writeCodexConfig: unused("writeCodexConfig"),
      backupCodexConfig: unused("backupCodexConfig"),
    },
    opencode: {
      readOpenCodeConfig: unused("readOpenCodeConfig"),
      writeOpenCodeConfig: unused("writeOpenCodeConfig"),
      backupOpenCodeConfig: unused("backupOpenCodeConfig"),
    },
    grok: {
      readGrokConfigText: unused("readGrokConfigText"),
      writeGrokConfigText: unused("writeGrokConfigText"),
      backupGrokConfig: unused("backupGrokConfig"),
    },
    dsh: {
      readDshConfigText: unused("readDshConfigText"),
      writeDshConfigText: unused("writeDshConfigText"),
      backupDshConfig: unused("backupDshConfig"),
    },
  };
}

function strategiesFrom(ports: CliRuntimeConfigIoPorts) {
  return createCliRuntimeConfigStrategies(ports);
}

test("strategy registration covers four platforms without calling IO", () => {
  const ports = createPorts();
  const strategies = strategiesFrom(ports);
  assert.deepEqual(Object.keys(strategies).sort(), ["claude", "codex", "dsh", "grok", "opencode"]);
});

test("Claude read, apply, backup, and default fields keep settings and MCP rules", async () => {
  const calls: string[] = [];
  let settings = "{\"theme\":\"dark\"}";
  let mcp = "{\"keep\":true}";
  const ports = createPorts();
  ports.claude.readClaudeConfig = async () => {
    calls.push("read-settings");
    return settings;
  };
  ports.claude.readClaudeMcpConfig = async () => {
    calls.push("read-mcp");
    return mcp;
  };
  ports.claude.writeClaudeConfig = async (content) => {
    calls.push("write-settings");
    settings = content;
  };
  ports.claude.writeClaudeMcpConfig = async (content) => {
    calls.push("write-mcp");
    mcp = content;
  };
  ports.claude.backupClaudeConfig = async () => {
    calls.push("backup");
    return ["/tmp/claude-settings.json", "/tmp/claude-mcp.json"];
  };
  const strategy = strategiesFrom(ports).claude;

  assert.deepEqual(await strategy.readCurrent(), {
    content: "{\"theme\":\"dark\"}",
    mcpContent: "{\"keep\":true}",
  });
  assert.deepEqual(await strategy.readInitialFields(), {
    content: "{\"theme\":\"dark\"}",
    mcpContent: "{\"keep\":true}",
    claudeSkills: [],
  });
  assert.deepEqual(strategy.fallbackInitialFields(), {
    content: "{}",
    mcpContent: "{}",
    claudeSkills: [],
  });
  assert.deepEqual(await strategy.backup(), ["/tmp/claude-settings.json", "/tmp/claude-mcp.json"]);

  await strategy.apply({ content: "{\"raw\":true}", claudeSkills: undefined, mcpContent: "" });
  assert.equal(settings, "{\"raw\":true}");
  assert.equal(calls.includes("write-mcp"), false);

  await strategy.apply({
    content: "{\"raw\":true}",
    claudeSkills: [{ name: "demo", path: "/tmp/demo", enabled: false }],
    mcpContent: "{\"mcpServers\":{\"b\":2}}",
  });
  assert.match(settings, /Skill\(demo\)/);
  assert.equal(mcp, "{\"mcpServers\":{\"b\":2}}");
  assert.deepEqual(calls.filter((call) => call.startsWith("write")), [
    "write-settings",
    "write-settings",
    "write-mcp",
  ]);
});

test("Claude apply writes settings before a failing MCP write and skips falsy MCP", async () => {
  let settings = "";
  let mcpWrites = 0;
  const ports = createPorts();
  ports.claude.writeClaudeConfig = async (content) => {
    settings = content;
  };
  ports.claude.writeClaudeMcpConfig = async () => {
    mcpWrites += 1;
    throw new Error("mcp failed");
  };
  const strategy = strategiesFrom(ports).claude;

  await strategy.apply({ content: undefined });
  assert.equal(settings, "{}");
  assert.equal(mcpWrites, 0);

  await assert.rejects(
    () => strategy.apply({ content: "{", claudeSkills: [] }),
    /JSON|object|Claude/i,
  );
  assert.equal(settings, "{}");

  await assert.rejects(
    () => strategy.apply({ content: "{\"ok\":true}", mcpContent: "[]" }),
    /mcp failed/,
  );
  assert.equal(settings, "{\"ok\":true}");
  assert.equal(mcpWrites, 1);
});

test("Claude initial field reads reject without using the fallback object", async () => {
  const ports = createPorts();
  ports.claude.readClaudeConfig = async () => {
    throw new Error("settings unreadable");
  };
  ports.claude.readClaudeMcpConfig = async () => "{}";
  const strategy = strategiesFrom(ports).claude;
  await assert.rejects(() => strategy.readInitialFields(), /settings unreadable/);
  await assert.rejects(() => strategy.readCurrent(), /settings unreadable/);
});

test("Codex apply keeps content priority, auth retention, and skills boundaries", async () => {
  const calls: string[] = [];
  let writtenConfig = "";
  let writtenAuth: string | undefined;
  const ports = createPorts();
  ports.codex.readCodexConfig = async () => {
    calls.push("read");
    return { config: "model = \"current\"\n", auth: "{\"token\":\"kept\"}" };
  };
  ports.codex.writeCodexConfig = async (config, auth) => {
    calls.push("write");
    writtenConfig = config;
    writtenAuth = auth;
  };
  ports.codex.backupCodexConfig = async () => ["/tmp/codex.toml", "/tmp/codex-auth.json"];
  const strategy = strategiesFrom(ports).codex;

  assert.deepEqual(await strategy.readCurrent(), {
    content: "model = \"current\"\n",
    configContent: "model = \"current\"\n",
    authContent: "{\"token\":\"kept\"}",
  });
  assert.deepEqual(await strategy.readInitialFields(), {
    content: "model = \"current\"\n",
    configContent: "model = \"current\"\n",
    authContent: "{\"token\":\"kept\"}",
    codexSkills: [],
  });
  assert.deepEqual(strategy.fallbackInitialFields(), {
    content: "",
    configContent: "",
    authContent: "{}",
    codexSkills: [],
  });
  assert.deepEqual(await strategy.backup(), ["/tmp/codex.toml", "/tmp/codex-auth.json"]);

  await strategy.apply({
    content: "model = \"from-content\"\n",
    configContent: "model = \"from-config-content\"\n",
    authContent: undefined,
  });
  assert.equal(writtenConfig, "model = \"from-content\"\n");
  assert.equal(writtenAuth, "{\"token\":\"kept\"}");

  await strategy.apply({
    configContent: "model = \"only-config-content\"",
    authContent: "",
  });
  assert.equal(writtenConfig, "model = \"only-config-content\"");
  assert.equal(writtenAuth, "");
  assert.equal(calls.filter((call) => call === "read").length, 3);

  await strategy.apply({
    content: "",
    configContent: "model = \"ignored\"\n",
    authContent: "{}",
  });
  assert.equal(writtenConfig, "");
  assert.equal(writtenAuth, "{}");

  await strategy.apply({
    content: "model = \"exact\"",
    authContent: "{}",
  });
  assert.equal(writtenConfig, "model = \"exact\"");

  await strategy.apply({
    content: "model = \"exact\"",
    authContent: "{}",
    codexSkills: [],
  });
  assert.equal(writtenConfig, "model = \"exact\"\n");

  await strategy.apply({
    content: "model = \"exact\"",
    authContent: "{}",
    codexSkills: [{ name: "demo", path: "/tmp/codex-skill", enabled: false }],
  });
  assert.match(writtenConfig, /path = "\/tmp\/codex-skill"/);
  assert.match(writtenConfig, /enabled = false/);

  await assert.rejects(
    () => strategy.apply({ authContent: "{\"token\":\"unused\"}" }),
    new Error(t("config.codexIncomplete")),
  );
  assert.equal(writtenAuth, "{}");
});

test("OpenCode runtime strategy returns only content and preserves skills priority", async () => {
  const writes: Array<{ config: string; env: string | undefined }> = [];
  const ports = createPorts();
  ports.opencode.readOpenCodeConfig = async () => ({
    config: "{\"model\":\"myAPI/claude-sonnet-5\"}",
    env: "",
  });
  ports.opencode.writeOpenCodeConfig = async (config, env) => {
    writes.push({ config, env });
  };
  ports.opencode.backupOpenCodeConfig = async () => ["/tmp/opencode.json"];
  const strategy = strategiesFrom(ports).opencode;

  const current = await strategy.readCurrent();
  assert.deepEqual(current, { content: "{\"model\":\"myAPI/claude-sonnet-5\"}" });
  assert.equal(Object.prototype.hasOwnProperty.call(current, "envContent"), false);
  assert.deepEqual(await strategy.readInitialFields(), {
    content: "{\"model\":\"myAPI/claude-sonnet-5\"}",
    openCodeSkills: [],
  });
  assert.deepEqual(strategy.fallbackInitialFields(), {
    content: "{}",
    openCodeSkills: [],
  });
  assert.deepEqual(await strategy.backup(), ["/tmp/opencode.json"]);

  await strategy.apply({ content: "not json" });
  await strategy.apply({
    content: "{\"model\":\"raw\"}",
    openCodeSkills: [{ name: "native", path: "/tmp/native", enabled: false }],
    geminiSkills: [{ name: "legacy", path: "/tmp/legacy", enabled: false }],
  } as ApplyPayload);
  await strategy.apply({
    content: "{\"model\":\"raw\"}",
    geminiSkills: [{ name: "legacy", path: "/tmp/legacy", enabled: false }],
  } as ApplyPayload);
  await strategy.apply({
    content: undefined,
    openCodeSkills: [],
  });

  assert.equal(writes[0]?.config, "not json");
  assert.equal(writes[0]?.env, undefined);
  assert.match(writes[1]?.config ?? "", /native/);
  assert.doesNotMatch(writes[1]?.config ?? "", /legacy/);
  assert.match(writes[2]?.config ?? "", /legacy/);
  assert.match(writes[3]?.config ?? "", /"enabled": true/);
});

test("OpenCode skill merge failure does not write", async () => {
  let writes = 0;
  const ports = createPorts();
  ports.opencode.writeOpenCodeConfig = async () => {
    writes += 1;
  };
  const strategy = strategiesFrom(ports).opencode;
  await assert.rejects(
    () => strategy.apply({ content: "{", openCodeSkills: [] }),
    /JSON|object|OpenCode/i,
  );
  assert.equal(writes, 0);
});

test("Grok strategy rejects blank or invalid content without writing", async () => {
  const calls: string[] = [];
  let stored = VALID_GROK_TOML;
  let written = "";
  const ports = createPorts();
  ports.grok.readGrokConfigText = async () => {
    calls.push("read");
    return stored;
  };
  ports.grok.writeGrokConfigText = async (content) => {
    calls.push("write");
    written = content;
    stored = content;
  };
  ports.grok.backupGrokConfig = async () => ["/tmp/grok.toml"];
  const strategy = strategiesFrom(ports).grok;

  assert.deepEqual(await strategy.readCurrent(), {
    content: VALID_GROK_TOML,
    configContent: VALID_GROK_TOML,
  });
  assert.equal(Object.prototype.hasOwnProperty.call(await strategy.readCurrent(), "authContent"), false);
  assert.deepEqual(await strategy.readInitialFields(), {
    content: VALID_GROK_TOML,
    configContent: VALID_GROK_TOML,
    grokSkills: [],
  });
  assert.deepEqual(strategy.fallbackInitialFields(), {
    content: "",
    configContent: "",
    grokSkills: [],
  });
  assert.deepEqual(await strategy.backup(), ["/tmp/grok.toml"]);

  stored = "";
  assert.deepEqual(await strategy.readCurrent(), { content: "", configContent: "" });
  stored = VALID_GROK_TOML;

  await assert.rejects(
    () => strategy.apply({ content: "   ", configContent: VALID_GROK_TOML }),
    new Error(t("grok.invalidConfig")),
  );
  await assert.rejects(
    () => strategy.apply({ content: undefined, configContent: undefined }),
    new Error(t("grok.invalidConfig")),
  );
  await assert.rejects(
    () => strategy.apply({ content: "models = [\n", grokSkills: [] }),
    /TOML|非法|无效/,
  );
  await assert.rejects(
    () => strategy.apply({
      content: "[models]\ndefault_reasoning_effort = \"nope\"\n\n[model.grok]\nmodel = \"grok-4\"\n",
    }),
    /default_reasoning_effort/,
  );
  assert.equal(calls.includes("write"), false);
  assert.equal(stored, VALID_GROK_TOML);

  await strategy.apply({ content: undefined, configContent: VALID_GROK_TOML });
  assert.equal(written, VALID_GROK_TOML);
  assert.match(written, /kept_note = "leave-me"/);
  assert.match(written, /# keep comment/);

  await strategy.apply({
    content: VALID_GROK_TOML,
    grokSkills: [{ name: "demo", path: "/tmp/grok-skill", enabled: false }],
  });
  assert.match(written, /disabled/);
  assert.match(written, /demo/);
  assert.equal(stored, written);
});

test("Grok read errors propagate and do not write", async () => {
  let writes = 0;
  const ports = createPorts();
  ports.grok.readGrokConfigText = async () => {
    throw new Error("grok read failed");
  };
  ports.grok.writeGrokConfigText = async () => {
    writes += 1;
  };
  const strategy = strategiesFrom(ports).grok;
  await assert.rejects(() => strategy.readCurrent(), /grok read failed/);
  await assert.rejects(() => strategy.readInitialFields(), /grok read failed/);
  await assert.rejects(() => strategy.apply({ content: VALID_GROK_TOML }), /grok read failed/);
  assert.equal(writes, 0);
});

test("every platform backup delegates to its own port in return order", async () => {
  const expected: Record<CurrentConfigPlatform, string[]> = {
    claude: ["/claude/settings", "/claude/mcp"],
    codex: ["/codex/config", "/codex/auth"],
    opencode: ["/opencode/config"],
    grok: ["/grok/config"],
    dsh: ["/dsh/config"],
  };
  const ports = createPorts();
  ports.claude.backupClaudeConfig = async () => expected.claude;
  ports.codex.backupCodexConfig = async () => expected.codex;
  ports.opencode.backupOpenCodeConfig = async () => expected.opencode;
  ports.grok.backupGrokConfig = async () => expected.grok;
  ports.dsh.backupDshConfig = async () => expected.dsh;
  const strategies = strategiesFrom(ports);
  for (const platform of Object.keys(expected) as CurrentConfigPlatform[]) {
    assert.deepEqual(await strategies[platform].backup(), expected[platform]);
  }
});

