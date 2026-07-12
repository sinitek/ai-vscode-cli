import test = require("node:test");
import assert = require("node:assert/strict");
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { installVscodeMock } from "./vscodeMock";

installVscodeMock();

function loadConfigService(): typeof import("../config/configService") {
  const modulePath = require.resolve("../config/configService");
  delete require.cache[modulePath];
  return require("../config/configService") as typeof import("../config/configService");
}

async function withTempHome<T>(run: (homeDir: string) => Promise<T>): Promise<T> {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "sinitek-config-service-"));
  const homeDir = path.join(tempRoot, "home");
  const originalHome = process.env.HOME;

  try {
    process.env.HOME = homeDir;
    return await run(homeDir);
  } finally {
    process.env.HOME = originalHome;
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
}

test("Codex runtime config uses ~/.codex/config.toml and ~/.codex/.env", async () => {
  await withTempHome(async (homeDir) => {
    const configService = loadConfigService();
    const paths = configService.getCodexRuntimePaths();

    assert.equal(paths.config, path.join(homeDir, ".codex", "config.toml"));
    assert.equal(paths.env, path.join(homeDir, ".codex", ".env"));

    assert.deepEqual(await configService.getCurrentConfig("codex"), {
      content: "",
      envContent: "",
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
      envContent: "OPENAI_API_KEY=from-env\n",
      configContent: "model = \"gpt-5\"\n",
      authContent: "{}",
    });
  });
});

test("Codex applyConfig writes TOML content and envContent", async () => {
  await withTempHome(async (homeDir) => {
    const configService = loadConfigService();

    await configService.applyConfig("codex", {
      content: "model = \"gpt-5\"\nmodel_provider = \"openai\"\n",
      envContent: "OPENAI_API_KEY=from-profile\n",
    });

    assert.equal(
      await fs.readFile(path.join(homeDir, ".codex", "config.toml"), "utf-8"),
      "model = \"gpt-5\"\nmodel_provider = \"openai\"\n",
    );
    assert.equal(
      await fs.readFile(path.join(homeDir, ".codex", ".env"), "utf-8"),
      "OPENAI_API_KEY=from-profile\n",
    );
    assert.equal(
      await fs.readFile(path.join(homeDir, ".codex", "auth.json"), "utf-8"),
      "{}",
    );

    await configService.applyConfig("codex", {
      content: "model = \"gpt-5-mini\"\n",
      envContent: "",
    });

    assert.equal(
      await fs.readFile(path.join(homeDir, ".codex", "config.toml"), "utf-8"),
      "model = \"gpt-5-mini\"\n",
    );
    assert.equal(await fs.readFile(path.join(homeDir, ".codex", ".env"), "utf-8"), "");
  });
});

test("Codex backup writes config, env, and auth files", async () => {
  await withTempHome(async (homeDir) => {
    const configService = loadConfigService();

    await fs.mkdir(path.join(homeDir, ".codex"), { recursive: true });
    await fs.writeFile(path.join(homeDir, ".codex", "config.toml"), "model = \"gpt-5\"\n");
    await fs.writeFile(path.join(homeDir, ".codex", ".env"), "OPENAI_API_KEY=from-env\n");
    await fs.writeFile(path.join(homeDir, ".codex", "auth.json"), "{\n  \"token\": \"from-auth\"\n}\n");

    const backups = await configService.backupCodexConfig();
    assert.equal(backups.length, 3);

    const configBackupPath = backups.find((filePath) => path.basename(filePath).startsWith("codex_config_"));
    const envBackupPath = backups.find((filePath) => path.basename(filePath).startsWith("codex_env_"));
    const authBackupPath = backups.find((filePath) => path.basename(filePath).startsWith("codex_auth_"));

    assert.ok(configBackupPath, "config.toml backup should be returned");
    assert.ok(envBackupPath, ".env backup should be returned");
    assert.ok(authBackupPath, "auth.json backup should be returned");
    assert.match(path.basename(configBackupPath), /^codex_config_.*\.toml$/);
    assert.match(path.basename(envBackupPath), /^codex_env_.*\.env$/);
    assert.match(path.basename(authBackupPath), /^codex_auth_.*\.json$/);
    assert.equal(await fs.readFile(configBackupPath, "utf-8"), "model = \"gpt-5\"\n");
    assert.equal(await fs.readFile(envBackupPath, "utf-8"), "OPENAI_API_KEY=from-env\n");
    assert.equal(await fs.readFile(authBackupPath, "utf-8"), "{\n  \"token\": \"from-auth\"\n}\n");
  });
});

test("Codex backup writes an empty env backup when ~/.codex/.env is missing", async () => {
  await withTempHome(async () => {
    const configService = loadConfigService();

    await configService.writeCodexConfig("model = \"gpt-5\"\n", "{}");

    const backups = await configService.backupCodexConfig();
    const envBackupPath = backups.find((filePath) => path.basename(filePath).startsWith("codex_env_"));

    assert.ok(envBackupPath, ".env backup should be returned");
    assert.equal(await fs.readFile(envBackupPath, "utf-8"), "");
  });
});

test("Codex saved profiles preserve content and envContent", async () => {
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
    assert.equal(saved.envContent, "OPENAI_API_KEY=from-profile\n");
    assert.equal(saved.authContent, "{}");

    const loaded = await configService.getConfigById("codex", "codex-toml-env");
    assert.equal(loaded?.content, "model = \"gpt-5\"\n");
    assert.equal(loaded?.configContent, "model = \"gpt-5\"\n");
    assert.equal(loaded?.envContent, "OPENAI_API_KEY=from-profile\n");
    assert.equal(loaded?.authContent, "{}");

    const list = await configService.getConfigList("codex");
    assert.equal(list[0]?.envContent, "OPENAI_API_KEY=from-profile\n");
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
  assert.match(uiScript, /myAPI 双模型与思考力度范例/);
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
  assert.equal(sample.provider.myAPI.options.baseURL, "{env:MY_API_BASE_URL}");
  assert.equal(sample.provider.myAPI.options.apiKey, "{env:MY_API_KEY}");
  assert.ok(Object.prototype.hasOwnProperty.call(sample.provider.myAPI.models, "main-chat-model"));
  assert.ok(Object.prototype.hasOwnProperty.call(sample.provider.myAPI.models, "small-task-model"));
  assert.equal(Object.prototype.hasOwnProperty.call(sample, "mcp"), false);

  const configService = loadConfigService();
  const validation = configService.validateOpenCodeConfigForRun(sampleText, undefined, {});
  assert.equal(validation.ok, false);
  assert.ok(validation.issues.some((issue) => issue.code === "missing-env"));
  assert.equal(validation.issues.some((issue) => issue.code === "placeholder-model"), false);
  assert.equal(validation.issues.some((issue) => issue.code === "placeholder-base-url"), false);
});
