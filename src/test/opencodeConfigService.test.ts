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

test("OpenCode config list does not auto-migrate Claude or Codex profiles", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "sinitek-opencode-config-"));
  const homeDir = path.join(tempRoot, "home");
  const originalHome = process.env.HOME;

  process.env.HOME = homeDir;
  const configService = loadConfigService();

  await fs.mkdir(path.join(homeDir, ".claude", "__config"), { recursive: true });
  await fs.mkdir(path.join(homeDir, ".codex", "__config"), { recursive: true });
  await fs.writeFile(path.join(homeDir, ".claude", "__config", "claude-source.json"), JSON.stringify({
    id: "claude-source",
    name: "Claude Source",
    platform: "claude",
    content: "{}",
    mcpContent: "{}",
    createdAt: 1,
    updatedAt: 1,
  }));
  await fs.writeFile(path.join(homeDir, ".codex", "__config", "codex-source.json"), JSON.stringify({
    id: "codex-source",
    name: "Codex Source",
    platform: "codex",
    configContent: "model = \"gpt-5\"\n",
    authContent: "{}",
    createdAt: 2,
    updatedAt: 2,
  }));

  try {
    assert.deepEqual(await configService.getConfigList("opencode"), []);
    await assert.rejects(
      () => configService.copyConfig({
        sourcePlatform: "claude",
        sourceId: "claude-source",
        targetPlatform: "opencode",
      }),
      /OpenCode configs can only be copied as OpenCode configs/,
    );

    const openCodeProfileDir = path.join(homeDir, ".opencode", "__config");
    const files = await fs.readdir(openCodeProfileDir).catch(() => []);
    assert.deepEqual(files, []);
  } finally {
    process.env.HOME = originalHome;
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test("OpenCode config list hides legacy auto-migrated profiles without deleting them", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "sinitek-opencode-legacy-"));
  const homeDir = path.join(tempRoot, "home");
  const originalHome = process.env.HOME;

  process.env.HOME = homeDir;
  const configService = loadConfigService();
  const openCodeProfileDir = path.join(homeDir, ".opencode", "__config");
  const legacyPath = path.join(openCodeProfileDir, "opencode_migrated_claude_old.json");

  await fs.mkdir(openCodeProfileDir, { recursive: true });
  await fs.writeFile(legacyPath, JSON.stringify({
    id: "opencode_migrated_claude_old",
    name: "[Claude] Old",
    platform: "opencode",
    sourcePlatform: "claude",
    sourceId: "old",
    migrationVersion: "opencode-auto-v1",
    content: "{}",
    envContent: "",
    createdAt: 1,
    updatedAt: 1,
  }));
  await fs.writeFile(path.join(openCodeProfileDir, "native.json"), JSON.stringify({
    id: "native",
    name: "Native OpenCode",
    platform: "opencode",
    content: "{}",
    envContent: "",
    createdAt: 2,
    updatedAt: 2,
  }));

  try {
    const configs = await configService.getConfigList("opencode");
    assert.deepEqual(configs.map((config) => config.id), ["native"]);
    assert.ok(await fs.stat(legacyPath));
  } finally {
    process.env.HOME = originalHome;
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test("OpenCode custom provider example is explicitly an OpenAI-compatible gateway", () => {
  const example = {
    $schema: "https://opencode.ai/config.json",
    model: "myAPI/gateway-chat-model",
    small_model: "myAPI/gateway-small-model",
    provider: {
      myAPI: {
        npm: "@ai-sdk/openai-compatible",
        name: "myAPI",
        options: {
          baseURL: "https://api.myapi.example/v1",
          apiKey: "<your api key>",
        },
        models: {
          "gateway-chat-model": { name: "Gateway Chat Model" },
          "gateway-small-model": { name: "Gateway Small Model" },
        },
      },
    },
    mcp: {},
  };

  assert.equal(example.provider.myAPI.npm, "@ai-sdk/openai-compatible");
  assert.equal(example.provider.myAPI.name, "myAPI");
  assert.equal(example.provider.myAPI.options.baseURL, "https://api.myapi.example/v1");
  assert.equal(example.provider.myAPI.options.apiKey, "<your api key>");
  assert.ok(example.model in { "myAPI/gateway-chat-model": true });
  assert.ok(Object.prototype.hasOwnProperty.call(example.provider.myAPI.models, "gateway-chat-model"));
  assert.ok(Object.prototype.hasOwnProperty.call(example, "mcp"));
  assert.equal(Object.prototype.hasOwnProperty.call(example, "mcpServers"), false);
  assert.equal(JSON.stringify(example).includes("PackyAPI"), false);
});

test("OpenCode provider adapters are selected by API protocol", () => {
  const configService = loadConfigService();

  assert.deepEqual(configService.OPENCODE_PROVIDER_ADAPTER_NPM_BY_PROTOCOL, {
    anthropic: "@ai-sdk/anthropic",
    google: "@ai-sdk/google",
    openai: "@ai-sdk/openai",
    openaiCompatible: "@ai-sdk/openai-compatible",
  });
});

test("OpenCode model variants preserve custom names and filter disabled entries", () => {
  const configService = loadConfigService();
  const content = JSON.stringify({
    provider: {
      gateway: {
        npm: "@ai-sdk/openai-compatible",
        models: {
          "exact-model": {
            variants: {
              low: {},
              turbo_reasoning: { budget: 12_345 },
              hidden: { disabled: true },
            },
          },
          "exact-model-plus": {
            variants: {
              high: {},
            },
          },
        },
      },
    },
  });

  assert.deepEqual(
    configService.parseOpenCodeModelVariants(content, "gateway", "exact-model"),
    ["low", "turbo_reasoning"]
  );
  assert.deepEqual(
    configService.parseOpenCodeModelVariants(content, "gateway", "exact-model-plus"),
    ["high"]
  );
  assert.deepEqual(configService.parseOpenCodeModelVariants(content, "gateway", "exact"), []);
});

test("OpenCode model variants do not infer capabilities from provider npm", () => {
  const configService = loadConfigService();
  const content = JSON.stringify({
    provider: {
      gateway: {
        npm: "@ai-sdk/openai-compatible",
        models: {
          "gpt-looking-name": {},
        },
      },
    },
  });

  assert.deepEqual(
    configService.parseOpenCodeModelVariants(content, "gateway", "gpt-looking-name"),
    []
  );
  assert.deepEqual(configService.parseOpenCodeModelVariants("not-json", "gateway", "model"), []);
});

test("OpenCode preflight allows native API adapters without an OpenAI-compatible baseURL", () => {
  const configService = loadConfigService();
  const adapters = [
    ["anthropic", "@ai-sdk/anthropic"],
    ["google", "@ai-sdk/google"],
    ["openai", "@ai-sdk/openai"],
  ] as const;

  for (const [protocol, npmPackage] of adapters) {
    const modelId = `${protocol}-model`;
    const result = configService.validateOpenCodeConfigForRun(JSON.stringify({
      $schema: "https://opencode.ai/config.json",
      model: `myAPI/${modelId}`,
      provider: {
        myAPI: {
          npm: npmPackage,
          options: {
            apiKey: "test-key",
          },
          models: {
            [modelId]: { name: `${protocol} model` },
          },
        },
      },
    }), undefined, {});

    assert.equal(result.ok, true, `${npmPackage} should use its native API defaults`);
    assert.deepEqual(result.issues, []);
  }
});

test("OpenCode preflight requires baseURL for an OpenAI-compatible custom provider", () => {
  const configService = loadConfigService();
  const result = configService.validateOpenCodeConfigForRun(JSON.stringify({
    $schema: "https://opencode.ai/config.json",
    model: "myAPI/gateway-model",
    provider: {
      myAPI: {
        npm: "@ai-sdk/openai-compatible",
        options: {
          apiKey: "test-key",
        },
        models: {
          "gateway-model": { name: "Gateway Model" },
        },
      },
    },
  }), undefined, {});

  assert.equal(result.ok, false);
  assert.deepEqual(result.issues.map((issue) => issue.code), [
    "openai-compatible-base-url-missing",
  ]);
});

test("OpenCode preflight does not infer adapter validity from model brand names", () => {
  const configService = loadConfigService();

  for (const modelId of ["claude-gateway-model", "gemini-gateway-model", "deepseek-gateway-model"]) {
    const result = configService.validateOpenCodeConfigForRun(JSON.stringify({
      $schema: "https://opencode.ai/config.json",
      model: `myAPI/${modelId}`,
      provider: {
        myAPI: {
          npm: "@ai-sdk/openai-compatible",
          options: {
            baseURL: "https://gateway.example.net/v1",
            apiKey: "test-key",
          },
          models: {
            [modelId]: { name: modelId },
          },
        },
      },
    }), undefined, {});

    assert.equal(result.ok, true, `${modelId} can be served by a compatible gateway`);
    assert.deepEqual(result.issues, []);
  }
});

test("OpenCode env parser remains available only for legacy runtime compatibility", () => {
  const configService = loadConfigService();

  assert.deepEqual(configService.parseEnvText([
    "# legacy env input",
    "MY_API_KEY=sk-test",
    "export BASE_URL='http://127.0.0.1:1337/v1'",
    "IGNORED LINE",
  ].join("\n")), {
    MY_API_KEY: "sk-test",
    BASE_URL: "http://127.0.0.1:1337/v1",
  });
});

test("OpenCode preflight blocks placeholder provider and model config", () => {
  const configService = loadConfigService();
  const result = configService.validateOpenCodeConfigForRun(JSON.stringify({
    $schema: "https://opencode.ai/config.json",
    model: "myprovider/my-model-name",
    small_model: "myprovider/my-small-model-name",
    provider: {
      myprovider: {
        npm: "@ai-sdk/openai-compatible",
        options: {
          baseURL: "https://api.example.com",
          apiKey: "{env:MY_PROVIDER_API_KEY}",
        },
        models: {
          "my-model-name": { name: "claude-sonnet-5" },
        },
      },
    },
  }), "MY_PROVIDER_API_KEY=sk-test\n", {});

  assert.equal(result.ok, false);
  assert.ok(result.issues.some((issue) => issue.code === "placeholder-provider"));
  assert.ok(result.issues.some((issue) => issue.code === "placeholder-model"));
  assert.ok(result.issues.some((issue) => issue.code === "placeholder-base-url"));
});

test("OpenCode preflight allows real custom provider ids and env references", () => {
  const configService = loadConfigService();
  const result = configService.validateOpenCodeConfigForRun(JSON.stringify({
    $schema: "https://opencode.ai/config.json",
    model: "myAPI/claude-sonnet-5",
    provider: {
      myAPI: {
        npm: "@ai-sdk/openai-compatible",
        options: {
          baseURL: "https://gateway.example.net/v1",
          apiKey: "{env:MY_API_KEY}",
        },
        models: {
          "claude-sonnet-5": { name: "Claude Sonnet 5" },
        },
      },
    },
  }), undefined, { MY_API_KEY: "sk-test" });

  assert.equal(result.ok, true);
  assert.deepEqual(result.issues, []);
});

test("OpenCode preflight reports missing env keys before running CLI", () => {
  const configService = loadConfigService();
  const result = configService.validateOpenCodeConfigForRun(JSON.stringify({
    $schema: "https://opencode.ai/config.json",
    model: "myAPI/claude-sonnet-5",
    provider: {
      myAPI: {
        npm: "@ai-sdk/openai-compatible",
        options: {
          baseURL: "https://gateway.example.net/v1",
          apiKey: "{env:MY_API_KEY}",
        },
        models: {
          "claude-sonnet-5": { name: "Claude Sonnet 5" },
        },
      },
    },
  }), "", {});

  assert.equal(result.ok, false);
  assert.deepEqual(result.issues.map((issue) => issue.code), ["missing-env"]);
});
