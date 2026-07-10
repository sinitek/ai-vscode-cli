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

test("OpenCode runtime config writes only ~/.opencode/config.json", async () => {
  await withTempHome(async (homeDir) => {
    const configService = loadConfigService();
    const paths = configService.getOpenCodeRuntimePaths();

    assert.equal(paths.config, path.join(homeDir, ".opencode", "config.json"));
    assert.equal(Object.prototype.hasOwnProperty.call(paths, "env"), false);

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

test("OpenCode current config falls back to legacy opencode.json but rewrites config.json only", async () => {
  await withTempHome(async (homeDir) => {
    await fs.mkdir(path.join(homeDir, ".config", "opencode"), { recursive: true });
    await fs.writeFile(
      path.join(homeDir, ".config", "opencode", "opencode.json"),
      "{\n  \"model\": \"legacy/model\"\n}\n",
    );

    const configService = loadConfigService();
    assert.deepEqual(await configService.getCurrentConfig("opencode"), {
      content: "{\n  \"model\": \"legacy/model\"\n}\n",
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
      "{\n  \"model\": \"legacy/model\"\n}\n",
    );
  });
});

test("OpenCode config UI exposes only the config.json editor entry", async () => {
  const uiScript = await fs.readFile(
    path.join(process.cwd(), "media", "config", "assets", "config-app-ui.js"),
    "utf-8",
  );

  assert.match(uiScript, /OpenCode config\.json/);
  assert.match(uiScript, /~\/\.opencode\/config\.json/);
  assert.match(uiScript, /OpenAI-compatible 网关范例/);
  assert.match(uiScript, /npm 按 API 协议选择，不按模型名称选择/);
  assert.match(uiScript, /myAPI\/gateway-chat-model/);
  assert.doesNotMatch(uiScript, /opencode-env|插件辅助档案|请输入 \.env 配置/);
  assert.doesNotMatch(uiScript, /PackyAPI|packyapi|PACKYAPI/);

  const sampleMatch = uiScript.match(/opencode:\s*\{\s*settings:\s*`([\s\S]*?)`,\s*\},/);
  assert.ok(sampleMatch, "OpenCode config.json sample should be present");

  const sampleText = sampleMatch[1];
  const sample = JSON.parse(sampleText);

  assert.equal(sampleText, JSON.stringify(sample, null, 2));
  assert.equal(sample.$schema, "https://opencode.ai/config.json");
  assert.equal(sample.model, "myAPI/gateway-chat-model");
  assert.equal(sample.small_model, "myAPI/gateway-small-model");
  assert.equal(sample.provider.myAPI.npm, "@ai-sdk/openai-compatible");
  assert.equal(sample.provider.myAPI.name, "myAPI");
  assert.equal(sample.provider.myAPI.options.baseURL, "https://api.myapi.example/v1");
  assert.equal(sample.provider.myAPI.options.apiKey, "<你的 api key>");
  assert.ok(Object.prototype.hasOwnProperty.call(sample.provider.myAPI.models, "gateway-chat-model"));
  assert.ok(Object.prototype.hasOwnProperty.call(sample.provider.myAPI.models, "gateway-small-model"));
  assert.deepEqual(sample.mcp, {});

  const configService = loadConfigService();
  const validation = configService.validateOpenCodeConfigForRun(sampleText, undefined, {});
  assert.equal(validation.ok, false);
  assert.ok(validation.issues.some((issue) => issue.code === "placeholder-model"));
  assert.ok(validation.issues.some((issue) => issue.code === "placeholder-base-url"));
});
