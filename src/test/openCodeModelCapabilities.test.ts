import test = require("node:test");
import assert = require("node:assert/strict");
import { installVscodeMock } from "./vscodeMock";

installVscodeMock();

function loadCapabilities(): typeof import("../cli/openCodeModelCapabilities") {
  const modulePath = require.resolve("../cli/openCodeModelCapabilities");
  delete require.cache[modulePath];
  return require("../cli/openCodeModelCapabilities") as typeof import("../cli/openCodeModelCapabilities");
}

function verboseModel(
  providerId: string,
  modelId: string,
  metadata: Record<string, unknown>
): string {
  return `${providerId}/${modelId}\n${JSON.stringify({
    id: modelId,
    providerID: providerId,
    ...metadata,
  }, null, 2)}`;
}

test("splits the exact provider from a model id containing slashes", () => {
  const { splitOpenCodeModelReference } = loadCapabilities();
  assert.deepEqual(splitOpenCodeModelReference("gateway/org/model"), {
    providerId: "gateway",
    modelId: "org/model",
  });
  assert.equal(splitOpenCodeModelReference("missing-provider"), null);
  assert.equal(splitOpenCodeModelReference("/missing"), null);
});

test("parses reasoning false with an explicitly empty variants object", () => {
  const { parseOpenCodeModelsVerboseOutput } = loadCapabilities();
  const parsed = parseOpenCodeModelsVerboseOutput(
    verboseModel("gateway", "plain-model", {
      capabilities: { reasoning: false },
      variants: {},
    }),
    "gateway",
    "plain-model"
  );

  assert.deepEqual(parsed, {
    reasoning: false,
    options: [],
  });
});

test("keeps provider variant subsets, custom names, and filters disabled variants", () => {
  const { parseOpenCodeModelsVerboseOutput } = loadCapabilities();
  const fixtures = [
    ["openai", "gpt-5", ["none", "low", "medium", "high", "xhigh"]],
    ["anthropic", "claude-sonnet", ["low", "high", "max"]],
    ["google", "gemini-2.5-pro", ["low", "high"]],
  ] as const;

  for (const [providerId, modelId, variants] of fixtures) {
    const variantEntries = Object.fromEntries(variants.map((variant) => [variant, {}]));
    const parsed = parseOpenCodeModelsVerboseOutput(
      verboseModel(providerId, modelId, {
        capabilities: { reasoning: true },
        variants: {
          ...variantEntries,
          custom_budget_64k: { budget: 65_536 },
          disabled_variant: { disabled: true },
        },
      }),
      providerId,
      modelId
    );

    assert.equal(parsed?.reasoning, true);
    assert.deepEqual(
      parsed?.options.map((option) => option.value),
      [...variants, "custom_budget_64k"]
    );
    assert.ok(parsed?.options.every((option) => option.source === "resolved-cli"));
  }
});

test("tolerates logs, dirty JSON, ANSI output, and multiple JSON blocks", () => {
  const { parseOpenCodeModelsVerboseOutput } = loadCapabilities();
  const output = [
    'INFO startup {"event":"boot"}',
    '{"broken": true',
    verboseModel("other", "other-model", {
      capabilities: { reasoning: true },
      variants: { high: {} },
    }),
    "\u001b[32mgateway/exact-model\u001b[0m",
    JSON.stringify({ event: "model-loading" }),
    JSON.stringify({
      id: "exact-model",
      providerID: "gateway",
      capabilities: { reasoning: true },
      variants: {
        thinking: {},
        unavailable: { disabled: true },
      },
    }, null, 2),
  ].join("\n");

  assert.deepEqual(parseOpenCodeModelsVerboseOutput(output, "gateway", "exact-model"), {
    reasoning: true,
    options: [{
      value: "thinking",
      label: "thinking",
      source: "resolved-cli",
    }],
  });
});

test("does not reuse a neighboring model block after a single-model failure", () => {
  const { parseOpenCodeModelsVerboseOutput } = loadCapabilities();
  const output = [
    "gateway/exact-model",
    "Error: metadata unavailable for this model",
    JSON.stringify({
      id: "exact-model",
      providerID: "gateway",
      error: { name: "ProviderError" },
    }),
    verboseModel("gateway", "exact-model-plus", {
      capabilities: { reasoning: true },
      variants: { high: {} },
    }),
  ].join("\n");

  assert.equal(parseOpenCodeModelsVerboseOutput(output, "gateway", "exact-model"), null);
  assert.deepEqual(
    parseOpenCodeModelsVerboseOutput(output, "gateway", "exact-model-plus")?.options.map((option) => option.value),
    ["high"]
  );
});

test("resolved CLI metadata takes precedence over configured variants", async () => {
  const capabilities = loadCapabilities();
  capabilities.clearOpenCodeThinkingCapabilityCache();
  const requests: Array<{ command: string; args: string[]; timeoutMs: number }> = [];
  const executor: import("../cli/openCodeModelCapabilities").OpenCodeCapabilityCommandExecutor = async (request) => {
    requests.push(request);
    return {
      stdout: verboseModel("gateway", "model", {
        capabilities: { reasoning: true },
        variants: { high: {} },
      }),
      stderr: "",
      exitCode: 0,
    };
  };

  const result = await capabilities.resolveOpenCodeThinkingCapability({
    command: "custom-opencode",
    version: "1.2.3",
    configIdentity: "active-config",
    configContent: JSON.stringify({
      provider: {
        gateway: {
          models: {
            model: { variants: { low: {} } },
          },
        },
      },
    }),
    model: "gateway/model",
    selectedVariant: "high",
    timeoutMs: 321,
    executor,
  });

  assert.deepEqual(result, {
    providerId: "gateway",
    modelId: "model",
    reasoning: true,
    options: [{ value: "high", label: "high", source: "resolved-cli" }],
    configuredDefaultVariant: null,
    selectedVariant: "high",
    status: "ready",
    source: "resolved-cli",
  });
  assert.deepEqual(requests, [{
    command: "custom-opencode",
    args: ["models", "gateway", "--verbose"],
    timeoutMs: 321,
  }]);
});

test("falls back to exact active-config variants after CLI failure", async () => {
  const capabilities = loadCapabilities();
  capabilities.clearOpenCodeThinkingCapabilityCache();
  const result = await capabilities.resolveOpenCodeThinkingCapability({
    version: "1.2.3",
    configIdentity: "active-config",
    configContent: JSON.stringify({
      provider: {
        gateway: {
          npm: "@ai-sdk/openai-compatible",
          models: {
            model: {
              variants: {
                custom: {},
                disabled: { disabled: true },
              },
            },
          },
        },
      },
    }),
    model: "gateway/model",
    selectedVariant: "disabled",
    executor: async () => ({
      stdout: "provider failed",
      stderr: "metadata unavailable",
      exitCode: 1,
    }),
  });

  assert.equal(result.source, "config");
  assert.equal(result.status, "ready");
  assert.equal(result.reasoning, "unknown");
  assert.deepEqual(result.options, [{ value: "custom", label: "custom", source: "config" }]);
  assert.equal(result.configuredDefaultVariant, null);
  assert.equal(result.selectedVariant, null);
  assert.equal(result.messageKey, "config-variants");
});

test("maps the exact configured default without converting it into an explicit override", async () => {
  const capabilities = loadCapabilities();
  capabilities.clearOpenCodeThinkingCapabilityCache();
  const result = await capabilities.resolveOpenCodeThinkingCapability({
    version: "1",
    configContent: JSON.stringify({
      model: "gateway/main",
      provider: {
        gateway: {
          models: {
            main: { options: { reasoningEffort: " xhigh " } },
          },
        },
      },
    }),
    model: "gateway/main",
    selectedVariant: "low",
    executor: async () => ({
      stdout: verboseModel("gateway", "main", {
        capabilities: { reasoning: true },
        variants: { low: {}, xhigh: {} },
      }),
      stderr: "",
      exitCode: 0,
    }),
  });

  assert.equal(result.configuredDefaultVariant, "xhigh");
  assert.equal(result.selectedVariant, "low");
});

test("ignores a configured default that is absent from the resolved variants", async () => {
  const capabilities = loadCapabilities();
  capabilities.clearOpenCodeThinkingCapabilityCache();
  const result = await capabilities.resolveOpenCodeThinkingCapability({
    version: "1",
    configContent: JSON.stringify({
      provider: {
        gateway: {
          models: {
            main: { options: { reasoningEffort: "medium" } },
          },
        },
      },
    }),
    model: "gateway/main",
    executor: async () => ({
      stdout: verboseModel("gateway", "main", {
        capabilities: { reasoning: true },
        variants: { xhigh: {} },
      }),
      stderr: "",
      exitCode: 0,
    }),
  });

  assert.equal(result.configuredDefaultVariant, null);
});

test("returns Default-only for unknown models without guessing from npm or model name", async () => {
  const capabilities = loadCapabilities();
  capabilities.clearOpenCodeThinkingCapabilityCache();
  const result = await capabilities.resolveOpenCodeThinkingCapability({
    version: "1.2.3",
    configIdentity: "active-config",
    configContent: JSON.stringify({
      provider: {
        gateway: {
          npm: "@ai-sdk/openai-compatible",
          models: { "gpt-5-looking-name": {} },
        },
      },
    }),
    model: "gateway/gpt-5-looking-name",
    selectedVariant: "high",
    executor: async () => ({
      stdout: verboseModel("gateway", "another-model", {
        capabilities: { reasoning: true },
        variants: { high: {} },
      }),
      stderr: "",
      exitCode: 0,
    }),
  });

  assert.deepEqual(result.options, []);
  assert.equal(result.selectedVariant, null);
  assert.equal(result.source, "fallback");
  assert.equal(result.status, "unknown");
  assert.equal(result.messageKey, "no-variants");
});

test("returns safe status message keys for missing models and metadata failures", async () => {
  const capabilities = loadCapabilities();
  capabilities.clearOpenCodeThinkingCapabilityCache();

  const missingModel = await capabilities.resolveOpenCodeThinkingCapability({ model: null });
  assert.equal(missingModel.messageKey, "select-model");

  const metadataFailure = await capabilities.resolveOpenCodeThinkingCapability({
    version: "1.2.3",
    configIdentity: "active-config",
    configContent: JSON.stringify({
      provider: {
        myAPI: {
          npm: "@ai-sdk/openai-compatible",
          models: { model: {} },
        },
      },
    }),
    model: "myAPI/model",
    executor: async () => ({
      stdout: "",
      stderr: "metadata unavailable",
      exitCode: 1,
    }),
  });
  assert.equal(metadataFailure.status, "error");
  assert.equal(metadataFailure.messageKey, "metadata-error");
});

test("uses the injected timeout and then falls back without starting a real CLI", async () => {
  const capabilities = loadCapabilities();
  capabilities.clearOpenCodeThinkingCapabilityCache();
  const requests: Array<{ command: string; args: string[]; timeoutMs: number }> = [];
  const result = await capabilities.resolveOpenCodeThinkingCapability({
    command: "never-started-opencode",
    version: "1.2.3",
    configIdentity: "timeout-config",
    configContent: JSON.stringify({
      provider: {
        gateway: {
          models: {
            model: { variants: { custom: {} } },
          },
        },
      },
    }),
    model: "gateway/model",
    timeoutMs: 5,
    executor: (request) => {
      requests.push(request);
      return new Promise(() => undefined);
    },
  });

  assert.equal(result.source, "config");
  assert.deepEqual(result.options.map((option) => option.value), ["custom"]);
  assert.equal(result.messageKey, "config-variants");
  assert.deepEqual(requests, [{
    command: "never-started-opencode",
    args: ["models", "gateway", "--verbose"],
    timeoutMs: 5,
  }]);
});

test("isolates cache entries by command, version, config, provider, and model", async () => {
  const capabilities = loadCapabilities();
  capabilities.clearOpenCodeThinkingCapabilityCache();
  let modelQueries = 0;
  const executor: import("../cli/openCodeModelCapabilities").OpenCodeCapabilityCommandExecutor = async (request) => {
    modelQueries += 1;
    const providerId = request.args[1];
    return {
      stdout: [
        verboseModel(providerId, "model-a", {
          capabilities: { reasoning: true },
          variants: { low: {} },
        }),
        verboseModel(providerId, "model-b", {
          capabilities: { reasoning: true },
          variants: { high: {} },
        }),
      ].join("\n"),
      stderr: "",
      exitCode: 0,
    };
  };

  const resolve = (overrides: Partial<import("../cli/openCodeModelCapabilities").ResolveOpenCodeThinkingCapabilityOptions> = {}) => (
    capabilities.resolveOpenCodeThinkingCapability({
      command: "opencode-a",
      version: "1",
      configIdentity: "config-a",
      configContent: JSON.stringify({
        provider: {
          "provider-a": { models: { "model-a": {}, "model-b": {} } },
          "provider-b": { models: { "model-a": {} } },
        },
      }),
      model: "provider-a/model-a",
      executor,
      ...overrides,
    })
  );

  await resolve();
  await resolve({ selectedVariant: "low" });
  await resolve({ command: "opencode-b" });
  await resolve({ version: "2" });
  await resolve({ configIdentity: "config-b" });
  await resolve({ model: "provider-a/model-b" });
  await resolve({ model: "provider-b/model-a" });

  assert.equal(modelQueries, 6);
});

test("binds config variants only to the validated exact primary model", async () => {
  const capabilities = loadCapabilities();
  capabilities.clearOpenCodeThinkingCapabilityCache();
  const configContent = JSON.stringify({
    model: "gateway/main",
    small_model: "gateway/small",
    provider: {
      gateway: {
        models: {
          main: { options: { reasoningEffort: "high" }, variants: { high: {} } },
          small: { options: { reasoningEffort: "low" }, variants: { low: {} } },
        },
      },
    },
  });
  const result = await capabilities.resolveOpenCodeThinkingCapability({
    version: "1",
    configContent,
    model: "gateway/main",
    executor: async () => ({ stdout: "", stderr: "failed", exitCode: 1 }),
  });

  assert.deepEqual(result.options.map((option) => option.value), ["high"]);
  assert.equal(result.configuredDefaultVariant, "high");
  assert.equal(result.options.some((option) => option.value === "low"), false);
});

test("refreshes configured defaults across active config and primary model changes", async () => {
  const capabilities = loadCapabilities();
  capabilities.clearOpenCodeThinkingCapabilityCache();
  const executor = async () => ({ stdout: "", stderr: "failed", exitCode: 1 });
  const resolve = (
    configIdentity: string,
    model: string,
    configContent: Record<string, unknown>
  ) => capabilities.resolveOpenCodeThinkingCapability({
    version: "1",
    configIdentity,
    configContent: JSON.stringify(configContent),
    model,
    executor,
  });

  const configA = await resolve("config-a", "gateway/main", {
    provider: {
      gateway: {
        models: {
          main: { options: { reasoningEffort: "low" }, variants: { low: {}, high: {} } },
        },
      },
    },
  });
  const configB = await resolve("config-b", "gateway/main", {
    provider: {
      gateway: {
        models: {
          main: { options: { reasoningEffort: "high" }, variants: { low: {}, high: {} } },
          alternate: { options: { reasoningEffort: "xhigh" }, variants: { xhigh: {} } },
        },
      },
    },
  });
  const alternate = await resolve("config-b", "gateway/alternate", {
    provider: {
      gateway: {
        models: {
          main: { options: { reasoningEffort: "high" }, variants: { high: {} } },
          alternate: { options: { reasoningEffort: "xhigh" }, variants: { xhigh: {} } },
        },
      },
    },
  });

  assert.equal(configA.configuredDefaultVariant, "low");
  assert.equal(configB.configuredDefaultVariant, "high");
  assert.equal(alternate.configuredDefaultVariant, "xhigh");
});

test("does not query variant metadata for a model absent from active config", async () => {
  const capabilities = loadCapabilities();
  capabilities.clearOpenCodeThinkingCapabilityCache();
  let queryCount = 0;
  const result = await capabilities.resolveOpenCodeThinkingCapability({
    version: "1",
    configContent: JSON.stringify({
      provider: { gateway: { models: { main: {} } } },
    }),
    model: "gateway/missing",
    executor: async () => {
      queryCount += 1;
      return { stdout: "", stderr: "", exitCode: 0 };
    },
  });

  assert.equal(queryCount, 0);
  assert.equal(result.messageKey, "select-model");
});
