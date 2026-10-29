import test = require("node:test");
import assert = require("node:assert/strict");
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { installVscodeMock } from "../vscodeMock";

installVscodeMock();

function loadConfigService(): typeof import("../../config/configService") {
  const configPathsModulePath = require.resolve("../../config/configPaths");
  const modulePath = require.resolve("../../config/configService");
  delete require.cache[configPathsModulePath];
  delete require.cache[modulePath];
  return require("../../config/configService") as typeof import("../../config/configService");
}

function restoreEnvironmentVariable(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}

async function withTempHome<T>(run: (homeDir: string) => Promise<T>): Promise<T> {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "sinitek-config-service-"));
  const homeDir = path.join(tempRoot, "home");
  const original = {
    HOME: process.env.HOME,
    USERPROFILE: process.env.USERPROFILE,
    CODEX_HOME: process.env.CODEX_HOME,
    CODEX_HOME_DIR: process.env.CODEX_HOME_DIR,
  };

  try {
    process.env.HOME = homeDir;
    process.env.USERPROFILE = homeDir;
    delete process.env.CODEX_HOME;
    delete process.env.CODEX_HOME_DIR;
    return await run(homeDir);
  } finally {
    restoreEnvironmentVariable("HOME", original.HOME);
    restoreEnvironmentVariable("USERPROFILE", original.USERPROFILE);
    restoreEnvironmentVariable("CODEX_HOME", original.CODEX_HOME);
    restoreEnvironmentVariable("CODEX_HOME_DIR", original.CODEX_HOME_DIR);
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
}

test("Codex runtime config only manages ~/.codex/config.toml and auth.json", async () => {
  await withTempHome(async (homeDir) => {
    const configService = loadConfigService();
    const paths = configService.getCodexRuntimePaths();

    assert.equal(paths.config, path.join(homeDir, ".codex", "config.toml"));
    assert.equal(Object.prototype.hasOwnProperty.call(paths, "env"), false);

    assert.deepEqual(await configService.getCurrentConfig("codex"), {
      content: "",
      configContent: "",
      authContent: "{}",
    });

    await assert.rejects(
      () => fs.stat(path.join(homeDir, ".codex", ".env")),
      (error: NodeJS.ErrnoException) => error.code === "ENOENT",
    );

    await fs.writeFile(path.join(homeDir, ".codex", "config.toml"), "model = \"gpt-5\"\n");
    await fs.writeFile(path.join(homeDir, ".codex", ".env"), "OPENAI_API_KEY=from-env\n");

    assert.deepEqual(await configService.getCurrentConfig("codex"), {
      content: "model = \"gpt-5\"\n",
      configContent: "model = \"gpt-5\"\n",
      authContent: "{}",
    });
  });
});

test("Codex applyConfig writes TOML and auth without changing an existing .env", async () => {
  await withTempHome(async (homeDir) => {
    const configService = loadConfigService();
    await fs.mkdir(path.join(homeDir, ".codex"), { recursive: true });
    await fs.writeFile(path.join(homeDir, ".codex", ".env"), "OPENAI_API_KEY=from-existing-env\n");

    await configService.applyConfig("codex", {
      content: "model = \"gpt-5\"\nmodel_provider = \"openai\"\n",
      authContent: "{\n  \"token\": \"from-profile\"\n}\n",
    });

    assert.equal(
      await fs.readFile(path.join(homeDir, ".codex", "config.toml"), "utf-8"),
      "model = \"gpt-5\"\nmodel_provider = \"openai\"\n",
    );
    assert.equal(
      await fs.readFile(path.join(homeDir, ".codex", ".env"), "utf-8"),
      "OPENAI_API_KEY=from-existing-env\n",
    );
    assert.equal(
      await fs.readFile(path.join(homeDir, ".codex", "auth.json"), "utf-8"),
      "{\n  \"token\": \"from-profile\"\n}\n",
    );

    await configService.applyConfig("codex", {
      content: "model = \"gpt-5-mini\"\n",
    });

    assert.equal(
      await fs.readFile(path.join(homeDir, ".codex", "config.toml"), "utf-8"),
      "model = \"gpt-5-mini\"\n",
    );
    assert.equal(
      await fs.readFile(path.join(homeDir, ".codex", ".env"), "utf-8"),
      "OPENAI_API_KEY=from-existing-env\n",
    );
  });
});

test("Codex backup writes config and auth files without backing up .env", async () => {
  await withTempHome(async (homeDir) => {
    const configService = loadConfigService();

    await fs.mkdir(path.join(homeDir, ".codex"), { recursive: true });
    await fs.writeFile(path.join(homeDir, ".codex", "config.toml"), "model = \"gpt-5\"\n");
    await fs.writeFile(path.join(homeDir, ".codex", ".env"), "OPENAI_API_KEY=from-env\n");
    await fs.writeFile(path.join(homeDir, ".codex", "auth.json"), "{\n  \"token\": \"from-auth\"\n}\n");

    const backups = await configService.backupCodexConfig();
    assert.equal(backups.length, 2);

    const configBackupPath = backups.find((filePath) => path.basename(filePath).startsWith("codex_config_"));
    const authBackupPath = backups.find((filePath) => path.basename(filePath).startsWith("codex_auth_"));

    assert.ok(configBackupPath, "config.toml backup should be returned");
    assert.ok(authBackupPath, "auth.json backup should be returned");
    assert.match(path.basename(configBackupPath), /^codex_config_.*\.toml$/);
    assert.match(path.basename(authBackupPath), /^codex_auth_.*\.json$/);
    assert.equal(await fs.readFile(configBackupPath, "utf-8"), "model = \"gpt-5\"\n");
    assert.equal(await fs.readFile(authBackupPath, "utf-8"), "{\n  \"token\": \"from-auth\"\n}\n");
    assert.equal(
      await fs.readFile(path.join(homeDir, ".codex", ".env"), "utf-8"),
      "OPENAI_API_KEY=from-env\n",
    );
  });
});

test("Codex saved profiles discard legacy envContent", async () => {
  await withTempHome(async (homeDir) => {
    const configService = loadConfigService();
    const config = {
      id: "codex-toml-env",
      name: "Codex TOML Env",
      platform: "codex" as const,
      content: "model = \"gpt-5\"\n",
      envContent: "OPENAI_API_KEY=from-profile\n",
      codexSkills: [],
      createdAt: 1,
      updatedAt: 1,
    };

    await configService.saveConfig(config);
    const savedPath = path.join(homeDir, ".codex", "__config", "codex-toml-env.json");
    const saved = JSON.parse(await fs.readFile(savedPath, "utf-8"));

    assert.equal(saved.platform, "codex");
    assert.equal(saved.content, "model = \"gpt-5\"\n");
    assert.equal(saved.configContent, "model = \"gpt-5\"\n");
    assert.equal(saved.envContent, undefined);
    assert.equal(saved.authContent, "{}");

    const loaded = await configService.getConfigById("codex", "codex-toml-env");
    assert.equal(loaded?.content, "model = \"gpt-5\"\n");
    assert.equal(loaded?.configContent, "model = \"gpt-5\"\n");
    assert.equal(loaded?.envContent, undefined);
    assert.equal(loaded?.authContent, "{}");

    const list = await configService.getConfigList("codex");
    assert.equal(list[0]?.envContent, undefined);
  });
});

test("Codex profile saves the edited configContent over stale legacy content", async () => {
  await withTempHome(async (homeDir) => {
    const configService = loadConfigService();
    const config = {
      id: "codex-edited-profile",
      name: "Codex Edited Profile",
      platform: "codex" as const,
      content: "model = \"stale-model\"\n",
      configContent: "model = \"updated-model\"\n",
      envContent: "OPENAI_API_KEY=from-profile\n",
      codexSkills: [],
      createdAt: 1,
      updatedAt: 2,
    };

    await configService.saveConfig(config);

    const savedPath = path.join(homeDir, ".codex", "__config", "codex-edited-profile.json");
    const saved = JSON.parse(await fs.readFile(savedPath, "utf-8"));
    assert.equal(saved.content, "model = \"updated-model\"\n");
    assert.equal(saved.configContent, "model = \"updated-model\"\n");
    assert.equal(saved.envContent, undefined);

    const reopened = await configService.getConfigById("codex", "codex-edited-profile");
    assert.equal(reopened?.content, "model = \"updated-model\"\n");
    assert.equal(reopened?.configContent, "model = \"updated-model\"\n");
  });
});

test("OpenCode runtime model config writes only ~/.opencode/config.json", async () => {
  await withTempHome(async (homeDir) => {
    const configService = loadConfigService();
    const paths = configService.getOpenCodeRuntimePaths();

    assert.equal(paths.config, path.join(homeDir, ".opencode", "config.json"));
    assert.equal(Object.prototype.hasOwnProperty.call(paths, "env"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(paths, "legacyConfig"), false);

    await configService.writeOpenCodeConfig("{\n  \"model\": \"myAPI/claude-sonnet-5\"\n}\n", "IGNORED=1\n");

    assert.equal(
      await fs.readFile(path.join(homeDir, ".opencode", "config.json"), "utf-8"),
      "{\n  \"model\": \"myAPI/claude-sonnet-5\"\n}\n",
    );
    await assert.rejects(
      () => fs.stat(path.join(homeDir, ".opencode", ".env")),
      (error: NodeJS.ErrnoException) => error.code === "ENOENT",
    );
    await assert.rejects(
      () => fs.stat(path.join(homeDir, ".config", "opencode", ".env")),
      (error: NodeJS.ErrnoException) => error.code === "ENOENT",
    );
  });
});

test("OpenCode saved profiles omit envContent and keep myAPI config content", async () => {
  await withTempHome(async (homeDir) => {
    const configService = loadConfigService();
    const config = {
      id: "native-opencode",
      name: "Native OpenCode",
      platform: "opencode" as const,
      content: JSON.stringify({
        $schema: "https://opencode.ai/config.json",
        model: "myAPI/claude-sonnet-5",
        provider: {
          myAPI: {
            npm: "@ai-sdk/openai-compatible",
            name: "myAPI",
            options: {
              baseURL: "https://gateway.example.net/v1",
              apiKey: "<your api key>",
            },
            models: {
              "claude-sonnet-5": { name: "Claude Sonnet 5" },
            },
          },
        },
      }),
      envContent: "SHOULD_NOT_PERSIST=1",
      openCodeSkills: [],
      createdAt: 1,
      updatedAt: 1,
    };

    await configService.saveConfig(config);
    const savedPath = path.join(homeDir, ".opencode", "__config", "native-opencode.json");
    const saved = JSON.parse(await fs.readFile(savedPath, "utf-8"));

    assert.equal(saved.platform, "opencode");
    assert.equal(saved.envContent, undefined);
    assert.match(saved.content, /"myAPI"/);
    assert.doesNotMatch(saved.content, /PackyAPI|packyapi|PACKYAPI/);

    const loaded = await configService.getConfigById("opencode", "native-opencode");
    assert.equal(loaded?.envContent, undefined);
  });
});

test("OpenCode saved profiles allow an empty draft while runtime validation still requires a primary model", async () => {
  await withTempHome(async (homeDir) => {
    const configService = loadConfigService();
    const config = {
      id: "empty-opencode-draft",
      name: "Empty OpenCode Draft",
      platform: "opencode" as const,
      content: "{}",
      openCodeSkills: [],
      createdAt: 1,
      updatedAt: 1,
    };

    await configService.saveConfig(config);

    const savedPath = path.join(homeDir, ".opencode", "__config", "empty-opencode-draft.json");
    const saved = JSON.parse(await fs.readFile(savedPath, "utf-8"));
    assert.equal(saved.content, "{}");

    const validation = configService.validateOpenCodeConfigForRun(saved.content, undefined, {});
    assert.equal(validation.ok, false);
    assert.ok(validation.issues.some((issue) => issue.code === "role-model-missing"));
  });
});

test("OpenCode current model config ignores the separate global MCP opencode.json", async () => {
  await withTempHome(async (homeDir) => {
    await fs.mkdir(path.join(homeDir, ".config", "opencode"), { recursive: true });
    await fs.writeFile(
      path.join(homeDir, ".config", "opencode", "opencode.json"),
      "{\n  \"mcp\": {\n    \"pencil\": {\n      \"enabled\": true\n    }\n  }\n}\n",
    );

    const configService = loadConfigService();
    assert.deepEqual(await configService.getCurrentConfig("opencode"), {
      content: "{}",
    });

    await configService.applyConfig("opencode", {
      content: "{\n  \"model\": \"myAPI/claude-sonnet-5\"\n}\n",
    });

    assert.equal(
      await fs.readFile(path.join(homeDir, ".opencode", "config.json"), "utf-8"),
      "{\n  \"model\": \"myAPI/claude-sonnet-5\"\n}\n",
    );
    assert.equal(
      await fs.readFile(path.join(homeDir, ".config", "opencode", "opencode.json"), "utf-8"),
      "{\n  \"mcp\": {\n    \"pencil\": {\n      \"enabled\": true\n    }\n  }\n}\n",
    );
  });
});

test("OpenCode config UI exposes separate model and MCP config paths", async () => {
  const uiScript = await fs.readFile(
    path.join(process.cwd(), "media", "config", "assets", "config-app-ui.js"),
    "utf-8",
  );

  assert.match(uiScript, /OpenCode 模型配置 config\.json/);
  assert.match(uiScript, /~\/\.opencode\/config\.json/);
  assert.match(uiScript, /\$\{XDG_CONFIG_HOME:-~\/\.config\}\/opencode\/opencode\.json/);
  assert.match(uiScript, /模型\/Provider 配置/);
  assert.match(uiScript, /全局 MCP 配置/);
  assert.match(uiScript, /myAPI 双模型范例/);
  assert.match(uiScript, /myAPI\/main-chat-model/);
  assert.doesNotMatch(uiScript, /opencode-env|插件辅助档案/);
  assert.doesNotMatch(uiScript, /PackyAPI|packyapi|PACKYAPI/);

  const sampleMatch = uiScript.match(/opencode:\s*\{\s*settings:\s*`([\s\S]*?)`,\s*\},/);
  assert.ok(sampleMatch, "OpenCode config.json sample should be present");

  const sampleText = sampleMatch[1];
  const sample = JSON.parse(sampleText);

  assert.equal(sampleText, JSON.stringify(sample, null, 2));
  assert.doesNotMatch(sampleText, /\.env/i);
  assert.equal(sample.$schema, "https://opencode.ai/config.json");
  assert.equal(sample.model, "myAPI/main-chat-model");
  assert.equal(sample.small_model, "myAPI/small-task-model");
  assert.equal(sample.provider.myAPI.npm, "@ai-sdk/openai-compatible");
  assert.equal(sample.provider.myAPI.name, "myAPI");
  assert.equal(sample.provider.myAPI.options.baseURL, "http://127.0.0.1:33391/v1");
  assert.equal(sample.provider.myAPI.options.apiKey, "your_apikey");
  assert.ok(Object.prototype.hasOwnProperty.call(sample.provider.myAPI.models, "main-chat-model"));
  assert.ok(Object.prototype.hasOwnProperty.call(sample.provider.myAPI.models, "small-task-model"));
  assert.equal(Object.prototype.hasOwnProperty.call(sample, "mcp"), false);

  const configService = loadConfigService();
  const validation = configService.validateOpenCodeConfigForRun(sampleText, undefined, {});
  assert.equal(validation.ok, true);
  assert.deepEqual(validation.issues, []);
});

async function withGrokHome<T>(homeDir: string, run: (grokHome: string) => Promise<T>): Promise<T> {
  const grokHome = path.join(homeDir, "grok-home");
  const original = process.env.GROK_HOME;
  process.env.GROK_HOME = grokHome;
  try {
    return await run(grokHome);
  } finally {
    restoreEnvironmentVariable("GROK_HOME", original);
  }
}

function backupStamp(filePath: string): string {
  const match = path.basename(filePath).match(/_(\d{4}-\d{2}-\d{2}T.*)\.(json|toml)$/);
  assert.ok(match, `backup name should include a timestamp: ${filePath}`);
  return match[1];
}

test("legacy gemini runtime calls follow OpenCode and unknown platforms stay rejected", async () => {
  await withTempHome(async (homeDir) => {
    const configService = loadConfigService();
    const openCodeConfig = path.join(homeDir, ".opencode", "config.json");
    const globalMcp = path.join(homeDir, ".config", "opencode", "opencode.json");
    await fs.mkdir(path.dirname(globalMcp), { recursive: true });
    await fs.writeFile(globalMcp, "{\"mcp\":{\"pencil\":true}}\n");

    assert.deepEqual(await configService.getCurrentConfig("gemini"), { content: "{}" });
    assert.equal(Object.prototype.hasOwnProperty.call(await configService.getCurrentConfig("gemini"), "envContent"), false);
    await configService.applyConfig("gemini", { content: "not json" });
    assert.equal(await fs.readFile(openCodeConfig, "utf8"), "not json");
    assert.equal(await fs.readFile(globalMcp, "utf8"), "{\"mcp\":{\"pencil\":true}}\n");
    await assert.rejects(
      () => fs.stat(path.join(homeDir, ".opencode", ".env")),
      (error: NodeJS.ErrnoException) => error.code === "ENOENT",
    );

    await configService.applyConfig("opencode", {
      content: "{}",
      geminiSkills: [{ name: "legacy", path: "/tmp/legacy", enabled: false }],
    } as Parameters<typeof configService.applyConfig>[1]);
    assert.match(await fs.readFile(openCodeConfig, "utf8"), /legacy/);

    await assert.rejects(
      () => configService.getCurrentConfig("unknown-platform" as "claude"),
      /Unsupported config platform: unknown-platform/,
    );
    await assert.rejects(
      () => configService.applyConfig("unknown-platform" as "claude", { content: "{}" }),
      /Unsupported config platform: unknown-platform/,
    );
    await assert.rejects(
      () => configService.backupConfig("unknown-platform" as "claude"),
      /Unsupported config platform: unknown-platform/,
    );
  });
});

test("Claude apply keeps MCP object checks, shallow merge, and settings-before-MCP order", async () => {
  await withTempHome(async (homeDir) => {
    const configService = loadConfigService();
    const settingsPath = path.join(homeDir, ".claude", "settings.json");
    const mcpPath = path.join(homeDir, ".claude.json");
    await fs.mkdir(path.dirname(settingsPath), { recursive: true });
    await fs.writeFile(mcpPath, JSON.stringify({ keep: true, mcpServers: { a: 1 } }));

    await assert.rejects(
      () => configService.applyConfig("claude", { content: "{\"ok\":true}", mcpContent: "[]" }),
      /MCP 配置必须是对象/,
    );
    assert.equal(await fs.readFile(settingsPath, "utf8"), "{\"ok\":true}");
    assert.equal(await fs.readFile(mcpPath, "utf8"), JSON.stringify({ keep: true, mcpServers: { a: 1 } }));

    await configService.applyConfig("claude", {
      content: "{\"ok\":true}",
      mcpContent: "",
    });
    assert.equal(await fs.readFile(mcpPath, "utf8"), JSON.stringify({ keep: true, mcpServers: { a: 1 } }));

    await configService.applyConfig("claude", {
      content: "{\"ok\":true}",
      mcpContent: JSON.stringify({ mcpServers: { b: 2 } }),
    });
    assert.deepEqual(JSON.parse(await fs.readFile(mcpPath, "utf8")), {
      keep: true,
      mcpServers: { b: 2 },
    });
  });
});

test("Codex apply prefers content over configContent and preserves auth when omitted", async () => {
  await withTempHome(async (homeDir) => {
    const configService = loadConfigService();
    const codexDir = path.join(homeDir, ".codex");
    await fs.mkdir(codexDir, { recursive: true });
    await fs.writeFile(path.join(codexDir, "config.toml"), "model = \"old\"\n");
    await fs.writeFile(path.join(codexDir, "auth.json"), "{\"token\":\"kept\"}");
    await fs.writeFile(path.join(codexDir, ".env"), "OPENAI_API_KEY=keep\n");

    await configService.applyConfig("codex", {
      content: "",
      configContent: "model = \"from-config-content\"\n",
    });
    assert.equal(await fs.readFile(path.join(codexDir, "config.toml"), "utf8"), "");
    assert.equal(await fs.readFile(path.join(codexDir, "auth.json"), "utf8"), "{\"token\":\"kept\"}");

    await configService.applyConfig("codex", {
      configContent: "model = \"from-config-content\"\n",
      authContent: "",
    });
    assert.equal(await fs.readFile(path.join(codexDir, "config.toml"), "utf8"), "model = \"from-config-content\"\n");
    assert.equal(await fs.readFile(path.join(codexDir, "auth.json"), "utf8"), "");
    assert.equal(await fs.readFile(path.join(codexDir, ".env"), "utf8"), "OPENAI_API_KEY=keep\n");

    await assert.rejects(
      () => configService.applyConfig("codex", {}),
      /Codex 配置不完整/,
    );
    assert.equal(await fs.readFile(path.join(codexDir, "config.toml"), "utf8"), "model = \"from-config-content\"\n");
  });
});

test("runtime backups keep prefixes, shared timestamps, content, and backup list order", async () => {
  await withTempHome(async (homeDir) => {
    await withGrokHome(homeDir, async (grokHome) => {
      const configService = loadConfigService();
      await fs.mkdir(path.join(homeDir, ".claude"), { recursive: true });
      await fs.mkdir(path.join(homeDir, ".codex"), { recursive: true });
      await fs.mkdir(path.join(homeDir, ".opencode"), { recursive: true });
      await fs.writeFile(path.join(homeDir, ".claude", "settings.json"), "{\"claude\":true}");
      await fs.writeFile(path.join(homeDir, ".claude.json"), "{\"mcp\":true}");
      await fs.writeFile(path.join(homeDir, ".codex", "config.toml"), "model = \"codex\"\n");
      await fs.writeFile(path.join(homeDir, ".codex", "auth.json"), "{\"token\":\"auth\"}");
      await fs.writeFile(path.join(homeDir, ".codex", ".env"), "SECRET=1\n");
      await fs.writeFile(path.join(homeDir, ".opencode", "config.json"), "{\"model\":\"open\"}");
      await fs.mkdir(grokHome, { recursive: true });
      await fs.writeFile(path.join(grokHome, "config.toml"), "kept = true\n");

      const claudeBackups = await configService.backupConfig("claude");
      const codexBackups = await configService.backupConfig("codex");
      const openCodeBackups = await configService.backupConfig("opencode");
      const grokBackups = await configService.backupConfig("grok");
      const directClaude = await configService.backupClaudeConfig();

      assert.deepEqual(claudeBackups.map((filePath) => path.basename(filePath).replace(/_\d{4}-\d{2}-\d{2}T.*(?=\.(json|toml)$)/, "_STAMP")), [
        "claude_settings_STAMP.json",
        "claude_mcp_STAMP.json",
      ]);
      assert.equal(backupStamp(claudeBackups[0]), backupStamp(claudeBackups[1]));
      assert.equal(await fs.readFile(claudeBackups[0], "utf8"), "{\"claude\":true}");
      assert.equal(await fs.readFile(claudeBackups[1], "utf8"), "{\"mcp\":true}");
      assert.deepEqual(codexBackups.map((filePath) => path.basename(filePath).replace(/_\d{4}-\d{2}-\d{2}T.*(?=\.(json|toml)$)/, "_STAMP")), [
        "codex_config_STAMP.toml",
        "codex_auth_STAMP.json",
      ]);
      assert.equal(backupStamp(codexBackups[0]), backupStamp(codexBackups[1]));
      assert.equal(await fs.readFile(codexBackups[0], "utf8"), "model = \"codex\"\n");
      assert.equal(await fs.readFile(codexBackups[1], "utf8"), "{\"token\":\"auth\"}");
      assert.deepEqual(openCodeBackups.map((filePath) => path.basename(filePath)), [
        `opencode_config_${backupStamp(openCodeBackups[0])}.json`,
      ]);
      assert.equal(await fs.readFile(openCodeBackups[0], "utf8"), "{\"model\":\"open\"}");
      assert.deepEqual(grokBackups.map((filePath) => path.basename(filePath)), [
        `grok_config_${backupStamp(grokBackups[0])}.toml`,
      ]);
      assert.equal(await fs.readFile(grokBackups[0], "utf8"), "kept = true\n");
      assert.equal(directClaude.length, 2);
      assert.match(path.basename(directClaude[0]), /^claude_settings_.*\.json$/);
      assert.equal(path.dirname(claudeBackups[0]), path.join(homeDir, ".ai_cli_tools_backups"));

      const backupNames = (await fs.readdir(path.join(homeDir, ".ai_cli_tools_backups"))).join("\n");
      assert.doesNotMatch(backupNames, /\.env/);
      assert.equal(await fs.readFile(path.join(homeDir, ".codex", ".env"), "utf8"), "SECRET=1\n");

      const claudeList = await configService.getBackupList("claude");
      assert.deepEqual(claudeList, claudeList.slice().sort().reverse());
      assert.ok(claudeList.includes(path.basename(claudeBackups[0])));
      assert.ok(claudeList.includes(path.basename(directClaude[1])));
      const openCodeList = await configService.getBackupList("gemini");
      assert.deepEqual(openCodeList, [path.basename(openCodeBackups[0])]);
    });
  });
});

async function useHome<T>(homeDir: string, run: () => Promise<T>): Promise<T> {
  process.env.HOME = homeDir;
  process.env.USERPROFILE = homeDir;
  return run();
}

test("default profiles skip native archives, ignore hidden OpenCode migrations, and isolate read and save failures", async () => {
  await withTempHome(async (homeDir) => {
    const configService = loadConfigService();
    const claudeProfileDir = path.join(homeDir, ".claude", "__config");
    await fs.mkdir(claudeProfileDir, { recursive: true });
    await fs.writeFile(path.join(claudeProfileDir, "existing.json"), JSON.stringify({
      id: "existing",
      name: "Existing",
      platform: "claude",
      content: "{}",
      createdAt: 1,
      updatedAt: 1,
    }));
    await fs.mkdir(path.join(homeDir, ".claude", "settings.json"), { recursive: true });
    assert.equal(await configService.initDefaultConfig("claude"), null);
    assert.equal((await fs.readdir(claudeProfileDir)).filter((file) => file.endsWith(".json")).length, 1);

    const claudeFallbackHome = path.join(homeDir, "claude-fallback");
    const fallback = await useHome(claudeFallbackHome, async () => {
      const reloaded = loadConfigService();
      await fs.mkdir(path.join(claudeFallbackHome, ".claude", "settings.json"), { recursive: true });
      await fs.mkdir(path.join(claudeFallbackHome, ".claude.json"), { recursive: true });
      return reloaded.initDefaultConfig("claude");
    });
    assert.ok(fallback);
    assert.equal(fallback?.content, "{}");
    assert.equal(fallback?.mcpContent, "{}");
    assert.deepEqual(fallback?.claudeSkills, []);
    assert.equal(fallback?.name, "默认");
    const savedFallback = JSON.parse(await fs.readFile(
      path.join(claudeFallbackHome, ".claude", "__config", `${fallback?.id}.json`),
      "utf8",
    ));
    assert.equal(savedFallback.content, "{}");
    assert.equal(savedFallback.mcpContent, "{}");
    assert.deepEqual(savedFallback.claudeSkills, []);
    assert.equal(await useHome(claudeFallbackHome, () => loadConfigService().initDefaultConfig("claude")), null);

    const codexFallback = await useHome(path.join(homeDir, "codex-fallback"), async () => {
      const reloaded = loadConfigService();
      const codexDir = path.join(homeDir, "codex-fallback", ".codex");
      await fs.mkdir(path.join(codexDir, "config.toml"), { recursive: true });
      await fs.mkdir(path.join(codexDir, "auth.json"), { recursive: true });
      return reloaded.initDefaultConfig("codex");
    });
    assert.equal(codexFallback?.content, "");
    assert.equal(codexFallback?.configContent, "");
    assert.equal(codexFallback?.authContent, "{}");
    assert.deepEqual(codexFallback?.codexSkills, []);

    const openCodeFallback = await useHome(path.join(homeDir, "opencode-fallback"), async () => {
      const reloaded = loadConfigService();
      await fs.mkdir(path.join(homeDir, "opencode-fallback", ".opencode", "config.json"), { recursive: true });
      return reloaded.initDefaultConfig("opencode");
    });
    assert.equal(openCodeFallback?.content, "{}");
    assert.deepEqual(openCodeFallback?.openCodeSkills, []);

    await useHome(homeDir, async () => undefined);
    const openCodeService = loadConfigService();
    const openCodeProfileDir = path.join(homeDir, ".opencode", "__config");
    await fs.mkdir(openCodeProfileDir, { recursive: true });
    await fs.writeFile(path.join(openCodeProfileDir, "opencode_migrated_old.json"), JSON.stringify({
      id: "opencode_migrated_old",
      name: "[Claude] hidden",
      platform: "opencode",
      content: "{}",
      createdAt: 1,
      updatedAt: 1,
    }));
    await fs.mkdir(path.dirname(path.join(homeDir, ".opencode", "config.json")), { recursive: true });
    await fs.writeFile(path.join(homeDir, ".opencode", "config.json"), "{}\n");
    const created = await openCodeService.initDefaultConfig("opencode");
    assert.ok(created);
    assert.equal(created?.platform, "opencode");
    assert.deepEqual(created?.openCodeSkills, []);
    assert.equal((await openCodeService.getConfigList("opencode")).length, 1);
    assert.equal((await openCodeService.getConfigList("gemini")).length, 1);
    assert.equal(await openCodeService.initDefaultConfig("gemini"), null);

    const saveFailureHome = path.join(homeDir, "opencode-save-failure");
    await useHome(saveFailureHome, async () => {
      const saveFailureService = loadConfigService();
      await fs.mkdir(path.join(saveFailureHome, ".opencode"), { recursive: true });
      const invalidRuntime = "{\n  \"provider\": {\n    \"myprovider\": {}\n  }\n}\n";
      await fs.writeFile(path.join(saveFailureHome, ".opencode", "config.json"), invalidRuntime);
      await assert.rejects(
        () => saveFailureService.initDefaultConfig("opencode"),
        /placeholder provider "myprovider"/,
      );
      assert.equal(await fs.readFile(path.join(saveFailureHome, ".opencode", "config.json"), "utf8"), invalidRuntime);
      const savedNames = (await fs.readdir(path.join(saveFailureHome, ".opencode", "__config")))
        .filter((file) => file.endsWith(".json") && file !== "config-order.json");
      assert.deepEqual(savedNames, []);
    });
  });
});

test("Grok runtime keeps a missing file empty and does not replace invalid content", async () => {
  await withTempHome(async (homeDir) => {
    await withGrokHome(homeDir, async (grokHome) => {
      const configService = loadConfigService();
      const configPath = path.join(grokHome, "config.toml");
      assert.deepEqual(await configService.getCurrentConfig("grok"), {
        content: "",
        configContent: "",
      });
      await assert.rejects(
        () => fs.stat(configPath),
        (error: NodeJS.ErrnoException) => error.code === "ENOENT",
      );

      const valid = "[models]\ndefault = \"grok\"\n\n[model.grok]\nmodel = \"grok-4\"\nkept_note = \"leave-me\"\n";
      await configService.applyConfig("grok", { configContent: valid });
      assert.equal(await fs.readFile(configPath, "utf8"), valid);

      await assert.rejects(() => configService.applyConfig("grok", { content: "   ", configContent: valid }));
      await assert.rejects(() => configService.applyConfig("grok", { content: "models = [\n" }));
      await assert.rejects(
        () => configService.applyConfig("grok", {
          content: "[models]\ndefault_reasoning_effort = \"nope\"\n\n[model.grok]\nmodel = \"grok-4\"\n",
        }),
        /default_reasoning_effort/,
      );
      assert.equal(await fs.readFile(configPath, "utf8"), valid);

      await fs.rm(configPath);
      await fs.mkdir(configPath);
      await assert.rejects(() => configService.getCurrentConfig("grok"), (error: NodeJS.ErrnoException) => error.code === "EISDIR");
      const created = await configService.initDefaultConfig("grok");
      assert.equal(created?.content, "");
      assert.equal(created?.configContent, "");
      assert.deepEqual(created?.grokSkills, []);
      const saved = JSON.parse(await fs.readFile(
        path.join(grokHome, "__config", `${created?.id}.json`),
        "utf8",
      ));
      assert.equal(saved.content, "");
      assert.equal(saved.configContent, "");
      assert.deepEqual(saved.grokSkills, []);
    });
  });
});

test("Kimi Code runtime reads and writes ~/.kimi-code/config.toml without replacing invalid content", async () => {
  await withTempHome(async (homeDir) => {
    const kimiHome = path.join(homeDir, "kimi-home");
    const originalKimiHome = process.env.KIMI_CODE_HOME;
    process.env.KIMI_CODE_HOME = kimiHome;
    try {
      const configService = loadConfigService();
      const { createKimiCodeDefaultConfigText, parseKimiCodeConfigModels } =
        require("../../config/kimiCodeConfig") as typeof import("../../config/kimiCodeConfig");
      const configPath = path.join(kimiHome, "config.toml");
      assert.deepEqual(await configService.getCurrentConfig("kimi-code"), {
        content: "",
        configContent: "",
      });

      // 首次进入：没有文件时按默认模型生成，且可直接被官方 CLI 校验。
      const created = await configService.initDefaultConfig("kimi-code");
      assert.ok(created);
      assert.equal(created?.platform, "kimi-code");
      assert.equal(parseKimiCodeConfigModels(created?.configContent ?? "").defaultModel, "kimi-k3.1-pro");
      assert.equal(created?.content, created?.configContent);

      // 应用有效配置后落盘内容与传入一致（TOML 不做 JSON 格式化）。
      const valid = createKimiCodeDefaultConfigText({ permissionMode: "manual" })
        .replace("max_context_size = 262144", "max_context_size = 262144\nkept_note = \"leave-me\"");
      await configService.applyConfig("kimi-code", { content: valid, configContent: valid });
      assert.equal(await fs.readFile(configPath, "utf8"), valid);

      // 非法内容不覆盖上一份有效文件。
      await assert.rejects(
        () => configService.applyConfig("kimi-code", { content: "default_permission_mode = \"never\"\n" }),
        /default_permission_mode 无效/,
      );
      await assert.rejects(
        () => configService.applyConfig("kimi-code", { content: "models = [\n" }),
      );
      assert.equal(await fs.readFile(configPath, "utf8"), valid);
      const keptNote = await fs.readFile(configPath, "utf8");
      assert.match(keptNote, /kept_note = "leave-me"/, "未展示字段要保留");

      const current = await configService.getCurrentConfig("kimi-code");
      assert.equal(parseKimiCodeConfigModels(current.content ?? "").permissionMode, "manual");
    } finally {
      restoreEnvironmentVariable("KIMI_CODE_HOME", originalKimiHome);
    }
  });
});

test("Kimi Code config profiles persist TOML and reject a cross-platform copy", async () => {
  await withTempHome(async (homeDir) => {
    const kimiHome = path.join(homeDir, "kimi-home");
    const originalKimiHome = process.env.KIMI_CODE_HOME;
    process.env.KIMI_CODE_HOME = kimiHome;
    try {
      const configService = loadConfigService();
      const { createKimiCodeDefaultConfigText } =
        require("../../config/kimiCodeConfig") as typeof import("../../config/kimiCodeConfig");
      const text = createKimiCodeDefaultConfigText();
      await configService.saveConfig({
        id: "kimi-profile",
        name: "Kimi",
        platform: "kimi-code",
        content: text,
        configContent: text,
        createdAt: 1,
        updatedAt: 1,
      });
      const stored = JSON.parse(await fs.readFile(
        path.join(kimiHome, "__config", "kimi-profile.json"),
        "utf8",
      ));
      assert.equal(stored.platform, "kimi-code");
      assert.match(stored.content, /default_model = "kimi-k3\.1-pro"/);
      assert.equal(stored.codexSkills, undefined);
      assert.equal(stored.grokSkills, undefined);

      const back = await configService.getConfigById("kimi-code", "kimi-profile");
      assert.equal(back?.configContent, text);

      // 同平台复制保留内容
      const copy = await configService.copyConfig({
        sourceId: "kimi-profile",
        sourcePlatform: "kimi-code",
        targetPlatform: "kimi-code",
        name: "Kimi 副本",
      });
      assert.equal(copy.platform, "kimi-code");
      assert.match(String(copy.configContent), /kimi-k3\.1-pro/);

      // 跨平台复制被拒绝：TOML 不能搬进 Codex/Grok，也不能把别的平台内容伪装成 kimi-code
      await assert.rejects(
        () => configService.copyConfig({
          sourceId: "kimi-profile",
          sourcePlatform: "kimi-code",
          targetPlatform: "codex",
        }),
        /Kimi Code configs can only be copied as Kimi Code configs/,
      );
    } finally {
      restoreEnvironmentVariable("KIMI_CODE_HOME", originalKimiHome);
    }
  });
});

test("DSH profile storage keeps only root apiKey, drops skill toggles, and accepts dsh skills", async () => {
  await withTempHome(async (homeDir) => {
    const previousHome = process.env.DSH_HOME;
    const previousKey = process.env.SINITEK_DSH_API_KEY;
    const secret = "sk-fixturekey123456";
    process.env.DSH_HOME = homeDir;
    process.env.SINITEK_DSH_API_KEY = secret;
    try {
      const configService = loadConfigService();
      const { createDshExampleProfileText } = require("../../cli/dshConfigModels") as typeof import("../../cli/dshConfigModels");
      const example = createDshExampleProfileText();
      const config = {
        id: "dsh-profile",
        name: "DSH",
        platform: "dsh" as const,
        content: example,
        configContent: example,
        claudeSkills: [{ name: "x", path: "/tmp/x", enabled: true }],
        codexSkills: [{ name: "x", path: "/tmp/x", enabled: true }],
        openCodeSkills: [{ name: "x", path: "/tmp/x", enabled: true }],
        grokSkills: [{ name: "x", path: "/tmp/x", enabled: true }],
        createdAt: 1,
        updatedAt: 1,
      };
      await configService.saveConfig(config);
      const saved = JSON.parse(await fs.readFile(path.join(homeDir, "__config", "dsh-profile.json"), "utf8"));
      assert.equal(saved.claudeSkills, undefined);
      assert.equal(saved.codexSkills, undefined);
      assert.equal(saved.openCodeSkills, undefined);
      assert.equal(saved.grokSkills, undefined);
      assert.equal(JSON.stringify(saved).includes(secret), false);
      const loaded = await configService.getConfigById("dsh", "dsh-profile");
      assert.equal(loaded?.claudeSkills, undefined);
      assert.equal(loaded?.grokSkills, undefined);
      assert.deepEqual(
        [...configService.CLI_GLOBAL_SKILL_PLATFORMS],
        ["claude", "codex", "opencode", "grok", "dsh", "kimi-code", "zcode"],
      );
      assert.equal(configService.readDshUnsupportedCapability("explicitSkillsApi").supported, false);
      assert.equal(configService.readDshUnsupportedCapability("nativeCompaction").supported, false);

      await fs.mkdir(path.join(homeDir, "skills", "demo"), { recursive: true });
      await fs.writeFile(path.join(homeDir, "skills", "demo", "SKILL.md"), "---\ndescription: demo\n---\n# demo\n", "utf8");
      const listed = await configService.getCliSkillsList("dsh");
      assert.equal(listed.directory, path.join(homeDir, "skills"));
      assert.deepEqual(listed.skills.map((skill) => skill.name), ["demo"]);

      const poisoned = example.replace('"apiKey": "your_apikey"', `"apiKey": "${secret}"`);
      await configService.saveConfig({
        ...config,
        id: "dsh-secret",
        content: poisoned,
        configContent: poisoned,
      });
      const savedSecret = JSON.parse(await fs.readFile(path.join(homeDir, "__config", "dsh-secret.json"), "utf8"));
      assert.equal(JSON.parse(savedSecret.content).apiKey, secret);
      if (process.platform !== "win32") {
        const secretStat = await fs.stat(path.join(homeDir, "__config", "dsh-secret.json"));
        assert.equal(secretStat.mode & 0o777, 0o600);
      }
    } finally {
      if (previousHome === undefined) {
        delete process.env.DSH_HOME;
      } else {
        process.env.DSH_HOME = previousHome;
      }
      if (previousKey === undefined) {
        delete process.env.SINITEK_DSH_API_KEY;
      } else {
        process.env.SINITEK_DSH_API_KEY = previousKey;
      }
    }
  });
});

test("reloading configService after HOME changes does not keep the previous runtime paths", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "sinitek-config-reload-"));
  const homeA = path.join(tempRoot, "home-a");
  const homeB = path.join(tempRoot, "home-b");
  const original = {
    HOME: process.env.HOME,
    USERPROFILE: process.env.USERPROFILE,
    CODEX_HOME: process.env.CODEX_HOME,
    CODEX_HOME_DIR: process.env.CODEX_HOME_DIR,
    GROK_HOME: process.env.GROK_HOME,
  };
  try {
    process.env.HOME = homeA;
    process.env.USERPROFILE = homeA;
    delete process.env.CODEX_HOME;
    delete process.env.CODEX_HOME_DIR;
    process.env.GROK_HOME = path.join(tempRoot, "grok-a");
    const first = loadConfigService();
    await first.getCurrentConfig("claude");
    await fs.stat(path.join(homeA, ".claude", "settings.json"));

    process.env.HOME = homeB;
    process.env.USERPROFILE = homeB;
    process.env.GROK_HOME = path.join(tempRoot, "grok-b");
    const second = loadConfigService();
    await second.getCurrentConfig("codex");
    await fs.stat(path.join(homeB, ".codex", "config.toml"));
    await fs.stat(path.join(homeB, ".codex", "auth.json"));
    await assert.rejects(
      () => fs.stat(path.join(homeA, ".codex", "config.toml")),
      (error: NodeJS.ErrnoException) => error.code === "ENOENT",
    );
    assert.deepEqual(await second.getCurrentConfig("grok"), { content: "", configContent: "" });
    await assert.rejects(
      () => fs.stat(path.join(tempRoot, "grok-a", "config.toml")),
      (error: NodeJS.ErrnoException) => error.code === "ENOENT",
    );
    await assert.rejects(
      () => fs.stat(path.join(tempRoot, "grok-b", "config.toml")),
      (error: NodeJS.ErrnoException) => error.code === "ENOENT",
    );
  } finally {
    restoreEnvironmentVariable("HOME", original.HOME);
    restoreEnvironmentVariable("USERPROFILE", original.USERPROFILE);
    restoreEnvironmentVariable("CODEX_HOME", original.CODEX_HOME);
    restoreEnvironmentVariable("CODEX_HOME_DIR", original.CODEX_HOME_DIR);
    restoreEnvironmentVariable("GROK_HOME", original.GROK_HOME);
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});
