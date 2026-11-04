import assert = require("node:assert/strict");
import test = require("node:test");
import { parse as parseJsonc } from "jsonc-parser";
import * as TOML from "@iarna/toml";
import {
  applyModelImport,
  discoverImportModels,
  getModelImportProviders,
  type ModelImportFetch,
} from "../../config/modelimport";

const jsonResponse = (value: unknown, status = 200, headers?: Record<string, string>): Response => (
  new Response(JSON.stringify(value), { status, headers })
);

function fetchFor(handler: (url: URL, init?: RequestInit) => Response | Promise<Response>): ModelImportFetch {
  return async (input, init) => handler(new URL(input), init);
}

const openCodeDraft = `{
  // keep this comment
  "model": "one/shared",
  "provider": {
    "one": {"npm": "@ai-sdk/openai-compatible", "options": {"baseURL": "https://gateway.example/v1?region=cn", "apiKey": "secret-one"}, "models": {"shared": {"name": "Shared one"}}},
    "two": {"npm": "@ai-sdk/openai-compatible", "options": {"baseURL": "https://gateway.example/v1?region=cn", "apiKey": "secret-two"}, "models": {"shared": {"name": "Shared two"}}}
  },
}`;

function providerId(platform: Parameters<typeof getModelImportProviders>[0]["platform"], draft: Parameters<typeof getModelImportProviders>[0]["draft"], index = 0): string {
  const item = getModelImportProviders({ platform, draft }).providers[index];
  assert.ok(item, `expected a ${platform} provider at index ${index}`);
  return item.id;
}

test("discovers OpenCode models per provider, follows bounded pagination, and authenticates", async () => {
  const providers = getModelImportProviders({ platform: "opencode", draft: { configContent: openCodeDraft } });
  assert.equal(new Set(providers.providers.map((provider) => provider.id)).size, 2);
  assert.ok(providers.providers.every((provider) => /^provider-[a-f0-9]{20}$/.test(provider.id)));
  assert.equal(providers.providers[0].baseUrl, "https://gateway.example/v1");
  assert.equal(providers.providers[0].protocol, "openai-chat-completions");

  const calls: Array<{ url: string; authorization: string | null }> = [];
  const result = await discoverImportModels({
    platform: "opencode",
    providerId: providers.providers[0].id,
    draft: { configContent: openCodeDraft },
  }, {
    fetch: fetchFor((url, init) => {
      calls.push({ url: url.toString(), authorization: new Headers(init?.headers).get("authorization") });
      return url.searchParams.has("after")
        ? jsonResponse({ data: [{ id: "second", owned_by: "safe" }] })
        : jsonResponse({ data: [{ id: "shared" }, { id: "first" }], next_cursor: "next" });
    }),
  });
  assert.deepEqual(result.existingModelIds, ["shared"]);
  assert.deepEqual(result.models.map((model) => model.id), ["shared", "first", "second"]);
  assert.equal(calls[0].url, "https://gateway.example/v1/models?region=cn");
  assert.equal(calls[0].authorization, "Bearer secret-one");
  assert.equal(calls[1].url, "https://gateway.example/v1/models?region=cn&after=next");
  await discoverImportModels({ platform: "opencode", providerId: providers.providers[1].id, draft: { configContent: openCodeDraft } }, {
    fetch: fetchFor((_url, init) => {
      assert.equal(new Headers(init?.headers).get("authorization"), "Bearer secret-two");
      return jsonResponse({ data: [{ id: "second-provider-model" }] });
    }),
  });
});

test("applies OpenCode imports without cross-provider duplicate filtering or comment loss", async () => {
  const result = await applyModelImport({
    platform: "opencode",
    providerId: providerId("opencode", { configContent: openCodeDraft }, 0),
    draft: { configContent: openCodeDraft },
    selectedModelIds: ["shared", "new-model"],
  }, { fetch: fetchFor(() => jsonResponse({ data: [{ id: "shared" }, { id: "new-model" }] }))
  });
  assert.match(result.draft.configContent ?? "", /keep this comment/);
  const parsed = parseJsonc(result.draft.configContent ?? "") as Record<string, any>;
  assert.deepEqual(parsed.provider.one.models.shared, { name: "Shared one" });
  assert.equal(parsed.provider.one.models["new-model"].name, "new-model");
  assert.deepEqual(parsed.provider.two.models, { shared: { name: "Shared two" } });
});

test("discovers and replaces one Codex model while preserving providers and auth draft", async () => {
  const configContent = `custom_root = "keep"\nmodel_provider = "gateway"\nmodel = "old"\n\n[model_providers.gateway]\nname = "Gateway"\nbase_url = "https://codex.example/v1/"\nwire_api = "responses"\nenv_key = "CODEX_KEY"\n\n[model_providers.other]\nname = "Other"\nbase_url = "https://other.example/v1"\nwire_api = "responses"\napi_key = "other-key"\n`;
  const payload = { platform: "codex" as const, providerId: providerId("codex", { configContent, authContent: '{"CODEX_KEY":"not-used"}' }), draft: { configContent, authContent: '{"CODEX_KEY":"not-used"}' } };
  assert.equal(getModelImportProviders({ platform: "codex", draft: payload.draft }).providers.length, 1);
  const discovered = await discoverImportModels(payload, {
    env: { CODEX_KEY: "test-key" },
    fetch: fetchFor((url, init) => {
      assert.equal(url.toString(), "https://codex.example/v1/models");
      assert.equal(new Headers(init?.headers).get("authorization"), "Bearer test-key");
      return jsonResponse({ data: [{ id: "new-codex" }] });
    }),
  });
  assert.deepEqual(discovered.existingModelIds, ["old"]);
  const applied = await applyModelImport({ ...payload, selectedModelIds: ["new-codex"] }, { env: { CODEX_KEY: "test-key" } });
  assert.match(applied.draft.configContent ?? "", /custom_root = "keep"/);
  assert.match(applied.draft.configContent ?? "", /^model = "new-codex"/m);
  assert.match(applied.draft.configContent ?? "", /\[model_providers\.gateway\]/);
});

test("Claude returns independent field mappings and keeps unknown settings", async () => {
  const draft = { content: `{
    // preserve JSONC comments
    "custom": { "keep": true }, "model": "old", "env": {
    "ANTHROPIC_BASE_URL": "https://anthropic.example/v1",
    "ANTHROPIC_AUTH_TOKEN": "claude-secret",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL": "old"
  } }` };
  const claudeProviderId = providerId("claude", draft);
  const discovered = await discoverImportModels({ platform: "claude", providerId: claudeProviderId, draft }, {
    fetch: fetchFor((url, init) => {
      assert.equal(url.pathname, "/v1/models");
      assert.equal(new Headers(init?.headers).get("authorization"), "Bearer claude-secret");
      assert.equal(new Headers(init?.headers).get("x-api-key"), null);
      return jsonResponse({ data: [{ id: "haiku-new", display_name: "Haiku new" }, { id: "opus-new" }] });
    }),
  });
  assert.ok(discovered.fields?.every((field) => field.key));
  const fields = Object.fromEntries((discovered.fields ?? []).map((field) => [field.key, "haiku-new"]));
  fields.model = "opus-new";
  const applied = await applyModelImport({ platform: "claude", providerId: claudeProviderId, draft, selectedModelIds: ["haiku-new", "opus-new"], fields });
  const parsed = parseJsonc(applied.draft.content ?? "{}") as Record<string, any>;
  assert.equal(parsed.custom.keep, true);
  assert.equal(parsed.model, "opus-new");
  assert.equal(parsed.env.ANTHROPIC_DEFAULT_HAIKU_MODEL, "haiku-new");
  assert.equal(parsed.env.CLAUDE_CODE_SUBAGENT_MODEL, "haiku-new");
  assert.equal(parsed.env.ANTHROPIC_AUTH_TOKEN, "claude-secret");

  const preserved = await applyModelImport({
    platform: "claude", providerId: claudeProviderId, draft,
    selectedModelIds: ["opus-new", "haiku-new"],
    fields: Object.fromEntries(discovered.fields!.map((field) => [field.key, field.key === "model" ? "opus-new" : field.value])),
  });
  const preservedParsed = parseJsonc(preserved.draft.content ?? "") as Record<string, any>;
  assert.equal(preservedParsed.env.ANTHROPIC_DEFAULT_HAIKU_MODEL, "old");
  assert.match(preserved.draft.content ?? "", /preserve JSONC comments/);
});

test("Codex matches runtime credential priority without borrowing unrelated auth keys", async () => {
  for (const scenario of [
    { settings: 'env_key = "CODEX_KEY"\nexperimental_bearer_token = "token-key"\nrequires_openai_auth = true', env: { CODEX_KEY: "env-key" }, key: "env-key" },
    { settings: 'experimental_bearer_token = "token-key"', env: {}, key: "token-key" },
    { settings: 'requires_openai_auth = true', env: {}, key: "auth-key" },
    { settings: 'requires_openai_auth = false', env: {}, key: null },
    { settings: '', env: {}, key: null },
  ]) {
    const draft = { configContent: `model_provider = "gateway"\nmodel = "old"\n[model_providers.gateway]\nbase_url = "https://codex.example/v1"\n${scenario.settings}`, authContent: '{"OPENAI_API_KEY":"auth-key","CODEX_KEY":"unrelated-key"}' };
    const item = getModelImportProviders({ platform: "codex", draft }, { env: scenario.env }).providers[0];
    assert.equal(item.disabledReason, undefined);
    await discoverImportModels({ platform: "codex", draft, providerId: item.id }, { env: scenario.env, fetch: fetchFor((_url, init) => {
      assert.equal(new Headers(init?.headers).get("authorization"), scenario.key ? `Bearer ${scenario.key}` : null);
      return jsonResponse({ data: [{ id: "new" }] });
    }) });
  }
  const draft = { configContent: 'model_provider = "gateway"\n[model_providers.gateway]\nbase_url = "https://codex.example/v1"\nenv_key = "UNSET_KEY"\nexperimental_bearer_token = "token-key"', authContent: '{"UNSET_KEY":"not-an-environment-value","OPENAI_API_KEY":"auth-key"}' };
  const item = getModelImportProviders({ platform: "codex", draft }, { env: {} }).providers[0];
  assert.match(item.disabledReason ?? "", /没有可用的 API key/);
  let called = false;
  await assert.rejects(discoverImportModels({ platform: "codex", draft, providerId: item.id }, { env: {}, fetch: fetchFor(() => { called = true; return jsonResponse({}); }) }), /没有可用的 API key/);
  assert.equal(called, false);
});

test("Claude uses its effective host environment and settings overrides without persisting secrets", async () => {
  const env = { ANTHROPIC_BASE_URL: "https://host.example/v1", ANTHROPIC_AUTH_TOKEN: "host-token", ANTHROPIC_API_KEY: "host-api-key" };
  for (const scenario of [
    { values: {}, url: "https://host.example/v1/models", header: "authorization", key: "Bearer host-token" },
    { values: { ANTHROPIC_AUTH_TOKEN: "", ANTHROPIC_API_KEY: "draft-key", ANTHROPIC_BASE_URL: "https://draft.example/v1" }, url: "https://draft.example/v1/models", header: "x-api-key", key: "draft-key" },
  ]) {
    const draft = { content: JSON.stringify({ model: "old", env: scenario.values }) };
    const item = getModelImportProviders({ platform: "claude", draft }, { env }).providers[0];
    assert.equal(item.disabledReason, undefined);
    assert.doesNotMatch(JSON.stringify(item), /host-token|host-api-key|draft-key/);
    const payload = { platform: "claude" as const, draft, providerId: item.id };
    await discoverImportModels(payload, { env, fetch: fetchFor((url, init) => {
      assert.equal(url.toString(), scenario.url);
      assert.equal(new Headers(init?.headers).get(scenario.header), scenario.key);
      return jsonResponse({ data: [{ id: "new" }] });
    }) });
    const applied = await applyModelImport({ ...payload, selectedModelIds: ["new"], fields: { model: "new" } }, { env });
    assert.deepEqual(JSON.parse(applied.draft.content!).env, scenario.values);
  }
});

test("Kimi uses provider-local environment credentials and URLs, not foreign host defaults", async () => {
  for (const [type, keyName, urlName, header] of [
    ["kimi", "KIMI_API_KEY", "KIMI_BASE_URL", "authorization"],
    ["openai", "OPENAI_API_KEY", "OPENAI_BASE_URL", "authorization"],
    ["openai_responses", "OPENAI_API_KEY", "OPENAI_BASE_URL", "authorization"],
    ["anthropic", "ANTHROPIC_API_KEY", "ANTHROPIC_BASE_URL", "x-api-key"],
    ["google-genai", "GOOGLE_API_KEY", "GOOGLE_GEMINI_BASE_URL", "x-goog-api-key"],
  ]) {
    const draft = { content: `default_model = "old"\n[providers.gateway]\ntype = "${type}"\n[providers.gateway.env]\n${keyName} = "provider-secret"\n${urlName} = "https://kimi.example/v1"\n[models.old]\nprovider = "gateway"\nmodel = "old"\nmax_context_size = 8192\n` };
    const env = { [keyName]: "foreign-host-secret" };
    const item = getModelImportProviders({ platform: "kimi-code", draft }, { env }).providers[0];
    assert.equal(item.disabledReason, undefined);
    assert.doesNotMatch(JSON.stringify(item), /provider-secret|foreign-host-secret/);
    const payload = { platform: "kimi-code" as const, draft, providerId: item.id };
    await discoverImportModels(payload, { env, fetch: fetchFor((url, init) => {
      assert.equal(url.origin + url.pathname, "https://kimi.example/v1/models");
      assert.equal(new Headers(init?.headers).get(header), header === "authorization" ? "Bearer provider-secret" : "provider-secret");
      return jsonResponse(type === "google-genai" ? { models: [{ name: "models/new" }] } : { data: [{ id: "new" }] });
    }) });
    const applied = await applyModelImport({ ...payload, selectedModelIds: ["new"] }, { env });
    assert.ok(applied.draft.content!.startsWith(draft.content.trimEnd()));
    assert.equal((TOML.parse(applied.draft.content!) as any).models.new.provider, "gateway");
    const missing = { content: draft.content.replace(`[providers.gateway.env]`, `api_key_env = "UNSET_KEY"\n[providers.gateway.env]`) };
    assert.match(getModelImportProviders({ platform: "kimi-code", draft: missing }, { env }).providers[0].disabledReason ?? "", /没有可用的 API key/);
    const noCredentials = { content: draft.content.replace(`${keyName} = "provider-secret"`, "") };
    assert.match(getModelImportProviders({ platform: "kimi-code", draft: noCredentials }, { env }).providers[0].disabledReason ?? "", /没有可用的 API key/);
    const conflicting = { content: draft.content.replace("[providers.gateway]\n", '[providers.gateway]\napi_key = "literal-key"\napi_key_env = "UNSET_KEY"\n') };
    assert.match(getModelImportProviders({ platform: "kimi-code", draft: conflicting }, { env }).providers[0].disabledReason ?? "", /只保留一种凭据来源/);
  }
});

test("OpenCode resolves configured URL and key environment references together", async () => {
  const draft = { configContent: '{"provider":{"gateway":{"npm":"@ai-sdk/openai-compatible","options":{"baseURL":"{env:GATEWAY_URL}","apiKey":"{env:GATEWAY_KEY}"}}}}' };
  const env = { GATEWAY_URL: "https://gateway.example/v1", GATEWAY_KEY: "provider-secret" };
  const item = getModelImportProviders({ platform: "opencode", draft }, { env }).providers[0];
  assert.equal(item.disabledReason, undefined);
  const payload = { platform: "opencode" as const, draft, providerId: item.id };
  await discoverImportModels(payload, { env, fetch: fetchFor((url, init) => {
    assert.equal(url.toString(), "https://gateway.example/v1/models");
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer provider-secret");
    return jsonResponse({ data: [{ id: "new" }] });
  }) });
  const applied = await applyModelImport({ ...payload, selectedModelIds: ["new"] }, { env });
  const options = (parseJsonc(applied.draft.configContent!) as any).provider.gateway.options;
  assert.deepEqual(options, { baseURL: "{env:GATEWAY_URL}", apiKey: "{env:GATEWAY_KEY}" });
});

test("supports Google GenAI pagination and DSH key boundary without expanding env into draft", async () => {
  const kimi = `default_model = "old"\n\n[providers.gateway]\ntype = "google-genai"\nbase_url = "https://google.example/v1beta/"\napi_key_env = "GOOGLE_KEY"\n\n[models.old]\nprovider = "gateway"\nmodel = "old"\n`;
  const providers = getModelImportProviders({ platform: "kimi-code", draft: { content: kimi } }, { env: { GOOGLE_KEY: "google-secret" } });
  assert.equal(providers.providers[0].protocol, "google-genai");
  const kimiDraft = { content: kimi };
  const discovered = await discoverImportModels({ platform: "kimi-code", providerId: providerId("kimi-code", kimiDraft), draft: kimiDraft }, {
    env: { GOOGLE_KEY: "google-secret" },
    fetch: fetchFor((url, init) => {
      assert.equal(new Headers(init?.headers).get("x-goog-api-key"), "google-secret");
      return url.searchParams.has("pageToken")
        ? jsonResponse({ models: [{ name: "models/gemini-2" }] })
        : jsonResponse({ models: [{ name: "models/gemini-1" }], nextPageToken: "next" });
    }),
  });
  assert.deepEqual(discovered.models.map((model) => model.id), ["gemini-1", "gemini-2"]);
  const dshContent = JSON.stringify({ schemaVersion: 1, provider: "sinitek-custom", api: "openai-completions", apiKeyEnv: "SINITEK_DSH_API_KEY", apiKey: "keep-me", baseURL: "https://dsh.example/v1", models: [{ id: "old", name: "Old", input: ["text"] }], acpModel: "old", unknown: { keep: true } });
  const dshDraft = { content: dshContent };
  await discoverImportModels({ platform: "dsh", providerId: providerId("dsh", dshDraft), draft: dshDraft }, {
    env: { SINITEK_DSH_API_KEY: "unrelated-host-key" }, fetch: fetchFor((_url, init) => {
      assert.equal(new Headers(init?.headers).get("authorization"), "Bearer keep-me");
      return jsonResponse({ data: [{ id: "new-dsh" }] });
    }),
  });
  const dsh = await applyModelImport({ platform: "dsh", providerId: providerId("dsh", dshDraft), draft: dshDraft, selectedModelIds: ["new-dsh"] });
  const parsed = JSON.parse(dsh.draft.content ?? "{}");
  assert.equal(parsed.apiKey, "keep-me");
  assert.equal(parsed.apiKeyEnv, "SINITEK_DSH_API_KEY");
  assert.equal(parsed.unknown.keep, true);
  assert.equal(parsed.models[1].id, "new-dsh");
});

test("imports Grok and ZCode model lists while keeping existing secrets and fields", async () => {
  const grok = `[models]\ndefault = "old"\n\n[model.old]\nmodel = "old"\nbase_url = "https://grok.example/v1"\napi_backend = "chat_completions"\napi_key = "secret"\nenv_key = "GROK_KEY"\n`;
  const grokDraft = { content: grok };
  const grokResult = await applyModelImport({ platform: "grok", providerId: providerId("grok", grokDraft), draft: grokDraft, selectedModelIds: ["new-grok"] }, { env: { GROK_KEY: "secret" } });
  assert.match(grokResult.draft.content ?? "", /\[model\.old\][\s\S]*api_key = "secret"/);
  assert.match(grokResult.draft.content ?? "", /\[model\.new-grok\]/);
  assert.match((grokResult.draft.content ?? "").split("[model.new-grok]")[1] ?? "", /api_key = "secret"/);

  const referencedKeyConfig = `[models]\ndefault = "legacy-name"\n\n[model.legacy-name]\nmodel = "provider/model"\nbase_url = "https://grok.example/v1"\napi_backend = "responses"\napi_key = "$GROK_KEY"\n`;
  const referencedKeyDraft = { content: referencedKeyConfig };
  const grokProvider = getModelImportProviders({ platform: "grok", draft: referencedKeyDraft }, { env: { GROK_KEY: "test-secret" } }).providers[0];
  const noDuplicate = await applyModelImport({
    platform: "grok", providerId: grokProvider.id, draft: referencedKeyDraft,
    selectedModelIds: ["provider/model"],
  }, { env: { GROK_KEY: "test-secret" } });
  assert.equal(noDuplicate.draft.content, referencedKeyConfig);
  const referencedImport = await applyModelImport({
    platform: "grok", providerId: grokProvider.id, draft: referencedKeyDraft,
    selectedModelIds: ["new-model"],
  }, { env: { GROK_KEY: "test-secret" } });
  assert.match(referencedImport.draft.content ?? "", /\[model\.new-model\][\s\S]*env_key = "GROK_KEY"/);

  const zcode = JSON.stringify({ schemaVersion: 1, config: {
    defaultModelSelection: { providerId: "gateway", modelId: "old" },
    providerConfigRules: { providerRules: [{ providerId: "gateway", config: { access: { apiKey: "secret" }, api: { type: "openai-responses", baseUrl: "https://zcode.example/v1" }, personalModelIds: ["old"] } }] },
    modelConfigRules: { providerModelRules: [], manualProviderModelRules: [] },
  }});
  const zcodeDraft = { content: zcode };
  await discoverImportModels({ platform: "zcode", providerId: providerId("zcode", zcodeDraft), draft: zcodeDraft }, {
    env: {}, fetch: fetchFor((_url, init) => {
      assert.equal(new Headers(init?.headers).get("authorization"), "Bearer secret");
      return jsonResponse({ data: [{ id: "new-zcode" }] });
    }),
  });
  const zcodeResult = await applyModelImport({ platform: "zcode", providerId: providerId("zcode", zcodeDraft), draft: zcodeDraft, selectedModelIds: ["new-zcode"] });
  const zcodeParsed = JSON.parse(zcodeResult.draft.content ?? "{}");
  assert.deepEqual(zcodeParsed.config.providerConfigRules.providerRules[0].config.personalModelIds, ["old", "new-zcode"]);
  assert.equal(zcodeParsed.config.providerConfigRules.providerRules[0].config.access.apiKey, "secret");
});

test("returns disabled reasons and rejects malformed, redirected, and timed-out providers", async () => {
  const unsupportedDraft = { configContent: 'model_provider = "gateway"\nmodel = "old"\n[model_providers.gateway]\nbase_url = "https://gateway.example/v1"\nenv_key = "GATEWAY_KEY"\nwire_api = "mystery"', authContent: '{"GATEWAY_KEY":"test-secret"}' };
  const unsupported = getModelImportProviders({ platform: "codex", draft: unsupportedDraft });
  assert.match(unsupported.providers[0].disabledReason ?? "", /仅允许 Responses|未知/);
  const codexDraft = { configContent: 'model_provider = "gateway"\nmodel = "old"\n[model_providers.gateway]\nbase_url = "https://gateway.example/v1"\nenv_key = "GATEWAY_KEY"\nwire_api = "responses"', authContent: '{"GATEWAY_KEY":"test-secret"}' };
  await assert.rejects(
    discoverImportModels({ platform: "codex", providerId: providerId("codex", codexDraft), draft: codexDraft }, {
      env: { GATEWAY_KEY: "test-secret" },
      fetch: fetchFor(() => jsonResponse({}, 302, { location: "https://evil.example/models" })),
    }),
    /crosses origins/,
  );
  await assert.rejects(
    discoverImportModels({ platform: "codex", providerId: providerId("codex", codexDraft), draft: codexDraft }, {
      env: { GATEWAY_KEY: "test-secret" },
      fetch: fetchFor(() => Promise.reject(Object.assign(new Error("aborted"), { name: "AbortError" }))),
    }),
    /超时/,
  );
  assert.throws(() => getModelImportProviders({ platform: "not-a-platform" as never, draft: {} }), /unsupported/);
  assert.throws(() => getModelImportProviders({ platform: "codex", draft: {}, extra: true } as never), /unsupported field/);
});

test("does not rewrite a nested Codex model and rejects credential-bearing URL targets", async () => {
  const configContent = `model_provider = "gateway"
model = "root-old"

[model_providers.gateway]
base_url = "https://codex.example/v1/models"
wire_api = "responses"
env_key = "CODEX_KEY"
model = "provider-model"
`;
  const draft = { configContent, authContent: '{"CODEX_KEY":"test-key"}' };
  const result = await applyModelImport({
    platform: "codex",
    providerId: providerId("codex", draft),
    draft,
    selectedModelIds: ["root-new"],
  }, { env: { CODEX_KEY: "test-key" } });
  assert.match(result.draft.configContent ?? "", /model_provider = "gateway"\nmodel = "root-new"/);
  assert.match(result.draft.configContent ?? "", /\[model_providers\.gateway\][\s\S]*model = "provider-model"/);
  assert.equal(getModelImportProviders({
    platform: "codex",
    draft: { configContent: configContent.replace("https://codex.example/v1/models", "https://codex.example/v1?api_key=leak") },
  }).providers[0].disabledReason, "Provider URL query contains credential material; configure the key in the provider credentials instead.");
  const listed = await discoverImportModels({
    platform: "codex",
    providerId: providerId("codex", draft),
    draft: { ...draft, configContent: configContent.replace("https://codex.example/v1/models", "https://codex.example/v1/models/?region=cn") },
  }, {
    env: { CODEX_KEY: "test-key" },
    fetch: fetchFor((url) => {
      assert.equal(url.pathname, "/v1/models");
      assert.equal(url.searchParams.get("region"), "cn");
      return jsonResponse({ data: [{ id: "listed" }] });
    }),
  });
  assert.deepEqual(listed.models.map((model) => model.id), ["listed"]);
});

test("rejects redirects that place even short configured keys in URL values", async () => {
  const configContent = 'model_provider = "gateway"\nmodel = "old"\n[model_providers.gateway]\nbase_url = "https://gateway.example/v1"\nenv_key = "GATEWAY_KEY"\nwire_api = "responses"';
  const draft = { configContent, authContent: '{"GATEWAY_KEY":"k1"}' };
  await assert.rejects(
    discoverImportModels({ platform: "codex", providerId: providerId("codex", draft), draft }, {
      env: { GATEWAY_KEY: "k1" },
      fetch: fetchFor(() => jsonResponse({}, 302, { location: "/v1/models?region=k1" })),
    }),
    /redirect contains credential material/,
  );
});

test("redacts and disables provider URLs that contain a configured key in the path", () => {
  const configContent = 'model_provider = "gateway"\nmodel = "old"\n[model_providers.gateway]\nbase_url = "https://gateway.example/v1/k1"\nwire_api = "responses"\nenv_key = "GATEWAY_KEY"';
  const providers = getModelImportProviders({
    platform: "codex",
    draft: { configContent, authContent: '{"GATEWAY_KEY":"k1"}' },
  }, { env: { GATEWAY_KEY: "k1" } });
  assert.match(providers.providers[0].disabledReason ?? "", /credential material/);
  assert.doesNotMatch(providers.providers[0].baseUrl, /k1/);
});

test("rejects prototype-polluting TOML keys and returns quickly on fetch failure", async () => {
  assert.throws(() => getModelImportProviders({
    platform: "grok",
    draft: { content: '[model."__proto__"]\nbase_url = "https://grok.example/v1"\napi_backend = "responses"' },
  }), /invalid|无效|非法/);
  const draft = { configContent: 'model_provider = "gateway"\nmodel = "old"\n[model_providers.gateway]\nbase_url = "https://gateway.example/v1"\nenv_key = "GATEWAY_KEY"\nwire_api = "responses"', authContent: '{"GATEWAY_KEY":"test-secret"}' };
  const started = Date.now();
  await assert.rejects(
    discoverImportModels({ platform: "codex", providerId: providerId("codex", draft), draft }, {
      env: { GATEWAY_KEY: "test-secret" },
      fetch: fetchFor(() => Promise.reject(new Error("network down"))),
    }),
    /请求失败/,
  );
  assert.ok(Date.now() - started < 1000, "a failed fetch must not retain the timeout timer");
});

test("enforces timeout even when an injected fetcher ignores AbortSignal", async () => {
  const draft = { configContent: 'model_provider = "gateway"\nmodel = "old"\n[model_providers.gateway]\nbase_url = "https://gateway.example/v1"\nenv_key = "GATEWAY_KEY"\nwire_api = "responses"', authContent: '{"GATEWAY_KEY":"test-secret"}' };
  await assert.rejects(
    discoverImportModels({ platform: "codex", providerId: providerId("codex", draft), draft }, {
      env: { GATEWAY_KEY: "test-secret" },
      timeoutMs: 100,
      fetch: fetchFor(() => new Promise<Response>(() => undefined)),
    }),
    /超时/,
  );
});

test("uses the real Grok models default and model tables", async () => {
  const draft = { content: `[models]\ndefault = "gpt-4.1"\n\n[model."gpt-4.1"]\nmodel = "gpt-4.1"\nbase_url = "https://grok.example/v1/"\napi_backend = "responses"\nenv_key = "GROK_KEY"\n\n[model.other]\nmodel = "other"\nbase_url = "https://other.example/v1"\napi_backend = "responses"\nenv_key = "GROK_KEY"\n` };
  const providers = getModelImportProviders({ platform: "grok", draft }, { env: { GROK_KEY: "safe-key" } });
  assert.equal(providers.providers[0].disabledReason, undefined);
  const result = await applyModelImport({ platform: "grok", providerId: providers.providers[0].id, draft, selectedModelIds: ["gpt-4.1-new"] }, { env: { GROK_KEY: "safe-key" } });
  assert.match(result.draft.content ?? "", /\[model\."gpt-4\.1-new"\]/);
  assert.match(result.draft.content ?? "", /\[models\]\n/);
  assert.doesNotMatch(result.draft.content ?? "", /\[models\.gpt-4\.1-new\]/);
});

test("Grok selects each model's own URL and key and isolates duplicate models", async () => {
  const draft = { content: `# keep source
[models]
default = "first"
[model.first]
model = "shared"
base_url = "https://first.example/v1"
api_backend = "responses"
api_key = "first-secret"
[model.second]
model = "second-old"
base_url = "https://second.example/v1"
api_backend = "chat_completions"
api_key = "second-secret"
[model.same-url-other-key]
model = "third-old"
base_url = "https://second.example/v1"
api_backend = "chat_completions"
api_key = "third-secret"
[model.shared]
model = "unrelated"
base_url = "https://first.example/v1"
api_backend = "responses"
api_key = "first-secret"
[model."second/shared"]
model = "alias-collision"
base_url = "https://first.example/v1"
api_backend = "responses"
api_key = "first-secret"
` };
  const providers = getModelImportProviders({ platform: "grok", draft }, { env: {} }).providers;
  assert.equal(providers.length, 5);
  assert.equal(new Set(providers.map((item) => item.id)).size, 5);
  assert.ok(providers.every((item) => !item.disabledReason));
  assert.doesNotMatch(JSON.stringify(providers), /first-secret|second-secret|third-secret/);
  for (const [index, host, key, existing] of [
    [0, "first.example", "first-secret", ["shared", "unrelated", "alias-collision"]],
    [1, "second.example", "second-secret", ["second-old"]],
    [2, "second.example", "third-secret", ["third-old"]],
  ] as const) {
    const discovered = await discoverImportModels({ platform: "grok", draft, providerId: providers[index].id }, {
      env: {}, fetch: fetchFor((url, init) => {
        assert.equal(url.host, host);
        assert.equal(new Headers(init?.headers).get("authorization"), `Bearer ${key}`);
        return jsonResponse({ data: [{ id: "shared" }, { id: "new" }] });
      }),
    });
    assert.deepEqual(discovered.existingModelIds, existing);
  }
  const request = { platform: "grok" as const, draft, providerId: providers[1].id, selectedModelIds: ["shared", "new", "second-old"] };
  const applied = await applyModelImport(request, { env: {} });
  const content = applied.draft.content!;
  const parsed = TOML.parse(content) as any;
  assert.ok(content.startsWith(draft.content.trimEnd()));
  assert.equal(parsed.models.default, "first");
  assert.equal(parsed.model.shared.model, "unrelated");
  assert.equal(parsed.model["second/shared"].model, "alias-collision");
  const originalModels = (TOML.parse(draft.content) as any).model;
  const imported = Object.entries(parsed.model).filter(([alias]) => !Object.prototype.hasOwnProperty.call(originalModels, alias));
  assert.equal(imported.length, 2);
  for (const [, raw] of imported) {
    const model = raw as Record<string, unknown>;
    assert.equal(model.base_url, "https://second.example/v1");
    assert.equal(model.api_key, "second-secret");
    assert.equal(model.api_backend, "chat_completions");
  }
  const repeated = await applyModelImport({ ...request, draft: applied.draft }, { env: {} });
  assert.equal(repeated.draft.content, content);
});

test("Grok can discover a non-default configuration and keeps failed credentials isolated", async () => {
  for (const defaults of ["", '[models]\ndefault = "missing"\n']) {
    const draft = { content: `${defaults}[model.broken]\nmodel = "old"\nbase_url = "https://broken.example/v1"\napi_backend = "responses"\nenv_key = "UNSET_KEY"\n[model.usable]\nmodel = "usable-old"\nbase_url = "https://usable.example/v1"\napi_backend = "messages"\napi_key = "literal-key"\n` };
    const providers = getModelImportProviders({ platform: "grok", draft }, { env: {} }).providers;
    assert.match(providers[0].disabledReason ?? "", /没有可用的 API key/);
    assert.equal(providers[1].disabledReason, undefined);
    const payload = { platform: "grok" as const, draft, providerId: providers[1].id };
    await discoverImportModels(payload, { env: {}, fetch: fetchFor((url, init) => {
      assert.equal(url.toString(), "https://usable.example/v1/models");
      assert.equal(new Headers(init?.headers).get("x-api-key"), "literal-key");
      return jsonResponse({ data: [{ id: "new" }] });
    }) });
    const applied = await applyModelImport({ ...payload, selectedModelIds: ["new"] }, { env: {} });
    assert.equal((TOML.parse(applied.draft.content!) as any).model.new.api_key, "literal-key");
  }
});

test("Grok discovery accepts configured keys and preserves their credential source on import", async () => {
  const draftFor = (credentials: string) => ({ content: `[models]\ndefault = "old"\n\n[model.old]\nmodel = "old"\nbase_url = "https://grok.example/v1"\napi_backend = "responses"\n${credentials}\n# preserve, comment\nunknown = "keep"\n` });
  const scenarios = [
    { credentials: 'api_key = "fake-literal"', env: {}, secret: "fake-literal", expected: { api_key: "fake-literal" } },
    { credentials: 'api_key = "fake-literal"\nenv_key = "KEY_A"', env: { KEY_A: "fake-other" }, secret: "fake-literal", expected: { api_key: "fake-literal", env_key: "KEY_A" } },
    { credentials: 'api_key = "fake-literal"\nenv_key = "KEY_A"', env: {}, secret: "fake-literal", expected: { api_key: "fake-literal", env_key: "KEY_A" } },
    { credentials: 'api_key = "$KEY_A"\nenv_key = "KEY_B"', env: { KEY_A: "fake-a", KEY_B: "fake-b" }, secret: "fake-a", expected: { env_key: "KEY_A" } },
    { credentials: 'api_key = "${KEY_A}"', env: { KEY_A: "fake-a" }, secret: "fake-a", expected: { env_key: "KEY_A" } },
    { credentials: 'api_key = "{env:KEY_A}"', env: { KEY_A: "fake-a" }, secret: "fake-a", expected: { env_key: "KEY_A" } },
    { credentials: 'env_key = "KEY_A"', env: { KEY_A: "fake-env" }, secret: "fake-env", expected: { env_key: "KEY_A" } },
  ];
  for (const scenario of scenarios) {
    const draft = draftFor(scenario.credentials);
    const item = getModelImportProviders({ platform: "grok", draft }, { env: scenario.env }).providers[0];
    assert.equal(item.disabledReason, undefined);
    assert.ok(!JSON.stringify(item).includes(scenario.secret));
    const payload = { platform: "grok" as const, providerId: item.id, draft };
    await discoverImportModels(payload, { env: scenario.env, fetch: fetchFor((_url, init) => {
      assert.equal(new Headers(init?.headers).get("authorization"), `Bearer ${scenario.secret}`);
      return jsonResponse({ data: [{ id: "new-model" }] });
    }) });
    const applied = await applyModelImport({ ...payload, selectedModelIds: ["new-model"] }, { env: scenario.env });
    const output = applied.draft.content ?? "";
    const parsed = TOML.parse(output) as any;
    const sourceCredentials: { api_key?: string; env_key?: string } = scenario.expected;
    assert.equal(parsed.model["new-model"].env_key, sourceCredentials.env_key);
    assert.equal(parsed.model["new-model"].api_key, sourceCredentials.api_key);
    assert.equal(parsed.model.old.unknown, "keep");
    assert.match(output, /# preserve, comment/);
    if (sourceCredentials.api_key !== scenario.secret) {
      assert.ok(!output.slice(output.indexOf("[model.new-model]")).includes(scenario.secret));
    }
  }

  const invalid = [
    { credentials: 'api_key = "$KEY_A"\nenv_key = "KEY_B"', env: { KEY_B: "fake-b" } },
    { credentials: 'env_key = "KEY_A"', env: {} },
  ];
  for (const scenario of invalid) {
    const draft = draftFor(scenario.credentials);
    const item = getModelImportProviders({ platform: "grok", draft }, { env: scenario.env }).providers[0];
    assert.match(item.disabledReason ?? "", /没有可用的 API key/);
    const payload = { platform: "grok" as const, providerId: item.id, draft };
    let called = false;
    await assert.rejects(discoverImportModels(payload, { env: scenario.env, fetch: fetchFor(() => { called = true; return jsonResponse({}); }) }), /没有可用的 API key/);
    await assert.rejects(applyModelImport({ ...payload, selectedModelIds: ["new-model"] }, { env: scenario.env }), /没有可用的 API key/);
    assert.equal(called, false);
  }

  const draft = draftFor('env_key = "KEY_A"');
  const env: NodeJS.ProcessEnv = { KEY_A: "fake-literal" };
  const item = getModelImportProviders({ platform: "grok", draft }, { env }).providers[0];
  const payload = { platform: "grok" as const, providerId: item.id, draft };
  await discoverImportModels(payload, { env, fetch: fetchFor(() => jsonResponse({ data: [{ id: "new-model" }] })) });
  delete env.KEY_A;
  await assert.rejects(applyModelImport({ ...payload, selectedModelIds: ["new-model"] }, { env }), /没有可用的 API key/);
  let calledAfterChange = false;
  await assert.rejects(discoverImportModels(payload, { env, fetch: fetchFor(() => { calledAfterChange = true; return jsonResponse({}); }) }), /没有可用的 API key/);
  assert.equal(calledAfterChange, false);
});

test("keeps Claude empty mappings empty and allows partial updates", async () => {
  const draft = { content: '{\n  "env": {"ANTHROPIC_BASE_URL": "https://claude.example/v1", "ANTHROPIC_AUTH_TOKEN": "$CLAUDE_KEY", "ANTHROPIC_DEFAULT_HAIKU_MODEL": "old"}\n}' };
  const provider = providerId("claude", draft);
  const discovered = await discoverImportModels({ platform: "claude", providerId: provider, draft }, { env: { CLAUDE_KEY: "safe" }, fetch: fetchFor(() => jsonResponse({ data: [{ id: "new" }] })) });
  assert.deepEqual(discovered.fields?.map((field) => field.value), ["", "old", "", "", ""]);
  const applied = await applyModelImport({ platform: "claude", providerId: provider, draft, selectedModelIds: ["new"], fields: { "env.ANTHROPIC_DEFAULT_HAIKU_MODEL": "new" } }, { env: { CLAUDE_KEY: "safe" } });
  const parsed = parseJsonc(applied.draft.content ?? "{}") as Record<string, any>;
  assert.equal(parsed.env.ANTHROPIC_DEFAULT_HAIKU_MODEL, "new");
  assert.equal(parsed.model, undefined);
});

test("quotes Kimi aliases, isolates duplicate aliases, and rejects invalid DSH ids", async () => {
  const kimi = { content: `[providers.gateway]\ntype = "openai"\nbase_url = "https://kimi.example/v1"\napi_key_env = "KIMI_KEY"\n\n[models."shared.model"]\nprovider = "gateway"\nmodel = "old"\nmax_context_size = 1000\n\n[models.shared]\nprovider = "other"\nmodel = "shared"\n` };
  const provider = providerId("kimi-code", kimi);
  const result = await applyModelImport({ platform: "kimi-code", providerId: provider, draft: kimi, selectedModelIds: ["gpt-4.1", "shared"] }, { env: { KIMI_KEY: "safe" } });
  assert.match(result.draft.content ?? "", /\[models\."gpt-4\.1"\]/);
  assert.match(result.draft.content ?? "", /\[models\."gateway\/shared"\]/);
  const dshDraft = { content: JSON.stringify({ schemaVersion: 1, provider: "sinitek-custom", api: "openai-completions", apiKeyEnv: "SINITEK_DSH_API_KEY", baseURL: "https://dsh.example/v1", models: [{ id: "old", input: ["text"] }], acpModel: "old" }) };
  await assert.rejects(() => applyModelImport({ platform: "dsh", providerId: providerId("dsh", dshDraft), draft: dshDraft, selectedModelIds: ["bad id"] }, { env: { SINITEK_DSH_API_KEY: "safe" } }), /DSH model id|invalid/);
});

test("preserves JSONC comments and disables providers without URLs", () => {
  const draft = { configContent: `{"provider":{"gateway":{"npm":"@ai-sdk/openai-compatible","options":{"apiKey":"secret"},"models":{"old":{"name":"old"}}}}, // trailing comment\n"unknown": {"keep": true}}` };
  const providers = getModelImportProviders({ platform: "opencode", draft });
  assert.match(providers.providers[0].disabledReason ?? "", /baseURL/);
});

test("treats an omitted Codex wire_api as the supported Responses default", () => {
  const draft = { configContent: 'model_provider = "gateway"\nmodel = "old"\n[model_providers.gateway]\nbase_url = "https://codex.example/v1"\nenv_key = "CODEX_KEY"', authContent: '{"CODEX_KEY":"safe"}' };
  const provider = getModelImportProviders({ platform: "codex", draft }, { env: { CODEX_KEY: "safe" } }).providers[0];
  assert.equal(provider.protocol, "openai-responses");
  assert.equal(provider.disabledReason, undefined);
});

test("Kimi imports from a same-provider template with a positive context and keeps other settings", async () => {
  const draft = { content: `# retained config comment
default_model = "old"
[providers.gateway]
type = "openai"
base_url = "https://kimi.example/v1"
api_key_env = "KIMI_KEY"
[providers.other]
type = "openai"
base_url = "https://other.example/v1"
api_key = "other-secret"
[models.shared]
provider = "other"
model = "other-model"
max_context_size = 9999
capabilities = ["image_in"]
[models.old]
provider = "gateway"
model = "old-id"
max_context_size = 4096
max_output_size = 512
capabilities = ["thinking"]
custom = "keep only in template"
` };
  const options = { env: { KIMI_KEY: "fake-kimi-key" } };
  const id = getModelImportProviders({ platform: "kimi-code", draft }, options).providers[0].id;
  const result = await applyModelImport({ platform: "kimi-code", providerId: id, draft, selectedModelIds: ["gpt-4.1", "shared", "a/b:model"] }, options);
  const content = result.draft.content ?? "";
  const parsed = TOML.parse(content) as any;
  assert.match(content, /# retained config comment/);
  assert.equal(parsed.default_model, "old");
  assert.equal(parsed.providers.other.api_key, "other-secret");
  assert.equal(parsed.models.shared.max_context_size, 9999);
  for (const [alias, modelId] of [["gpt-4.1", "gpt-4.1"], ["gateway/shared", "shared"], ["a/b:model", "a/b:model"]]) {
    assert.deepEqual(parsed.models[alias], { provider: "gateway", model: modelId, max_context_size: 4096, max_output_size: 512, capabilities: ["thinking"] });
  }
  assert.equal(parsed.models.old.custom, "keep only in template");
  const repeated = await applyModelImport({ platform: "kimi-code", providerId: id, draft: result.draft, selectedModelIds: ["gpt-4.1", "shared", "a/b:model"] }, options);
  assert.equal(repeated.draft.content, content);
});

test("Kimi rejects missing, invalid, or cross-provider context templates", async () => {
  const provider = `[providers.gateway]\ntype = "openai"\nbase_url = "https://kimi.example/v1"\napi_key_env = "KIMI_KEY"\n`;
  for (const models of ["", `[models.old]\nprovider = "gateway"\nmodel = "old"\n`, `[models.old]\nprovider = "gateway"\nmax_context_size = 4096\n`, `[models.old]\nprovider = "gateway"\nmodel = "old"\nmax_context_size = 0\n`, `[models.old]\nprovider = "other"\nmodel = "old"\nmax_context_size = 4096\n`]) {
    const draft = { content: provider + models };
    const options = { env: { KIMI_KEY: "fake-kimi-key" } };
    const id = getModelImportProviders({ platform: "kimi-code", draft }, options).providers[0].id;
    await assert.rejects(() => applyModelImport({ platform: "kimi-code", providerId: id, draft, selectedModelIds: ["new"] }, options), /同一 provider.*max_context_size/);
  }
});

test("OpenCode appends multiple models while preserving JSONC empty and nonempty object comments", async () => {
  for (const modelText of [
    `{ // provider-models-comment, keep me\n /* block, keep me */\n }`,
    `{ /* block, keep me */ // provider-models-comment, keep me\n }`,
    `{ "old": {"name":"old"}, // provider-models-comment, keep me\n /* block, keep me */ }`,
  ]) {
    const draft = { configContent: `{"unknown":{"keep":true},"provider":{"one":{"npm":"@ai-sdk/openai-compatible","options":{"baseURL":"https://example.test/v1","apiKey":"fake-key"},"models":${modelText}},"two":{"npm":"@ai-sdk/openai-compatible","options":{"baseURL":"https://example.test/v1","apiKey":"other-key"},"models":{"new":{}}}}}` };
    const id = providerId("opencode", draft);
    const result = await applyModelImport({ platform: "opencode", providerId: id, draft, selectedModelIds: ["new", "second", "old"] });
    const content = result.draft.configContent ?? "";
    assert.ok(content.includes("// provider-models-comment, keep me"));
    assert.ok(content.includes("/* block, keep me */"));
    const errors: any[] = [];
    const parsed = parseJsonc(content, errors, { allowTrailingComma: true }) as any;
    assert.deepEqual(errors, []);
    assert.equal(parsed.unknown.keep, true);
    assert.deepEqual(Object.keys(parsed.provider.one.models).sort(), ["new", "old", "second"]);
    assert.deepEqual(parsed.provider.two.models, { new: {} });
  }
});

test("Claude chooses token or API key authentication without disclosing credentials", async () => {
  const cases = [
    { env: { ANTHROPIC_AUTH_TOKEN: "fake-token", ANTHROPIC_API_KEY: "fake-api-key" }, hostEnv: {}, expected: "Bearer fake-token", api: null },
    { env: { ANTHROPIC_AUTH_TOKEN: "$TOKEN_REF", ANTHROPIC_API_KEY: "$KEY_REF" }, hostEnv: { TOKEN_REF: "fake-env-token", KEY_REF: "fake-env-key" }, expected: "Bearer fake-env-token", api: null },
    { env: { ANTHROPIC_API_KEY: "$KEY_REF" }, hostEnv: { KEY_REF: "fake-env-key" }, expected: null, api: "fake-env-key" },
    { env: { ANTHROPIC_AUTH_TOKEN: "$MISSING", ANTHROPIC_API_KEY: "fake-api-key" }, hostEnv: {}, expected: null, api: "fake-api-key" },
  ];
  for (const item of cases) {
    const draft = { content: JSON.stringify({ env: { ...item.env, ANTHROPIC_BASE_URL: "https://example.test/v1" } }) };
    const options = { env: item.hostEnv };
    const providers = getModelImportProviders({ platform: "claude", draft }, options);
    const discovered = await discoverImportModels({ platform: "claude", providerId: providers.providers[0].id, draft }, {
      ...options,
      fetch: fetchFor((url, init) => {
        assert.equal(url.toString(), "https://example.test/v1/models");
        const headers = new Headers(init?.headers);
        assert.equal(headers.get("authorization"), item.expected);
        assert.equal(headers.get("x-api-key"), item.api);
        assert.equal(headers.get("anthropic-version"), "2023-06-01");
        return jsonResponse({ data: [{ id: "new" }] });
      }),
    });
    const applied = await applyModelImport({ platform: "claude", providerId: providers.providers[0].id, draft, selectedModelIds: ["new"], fields: { model: "new" } }, options);
    const publicData = JSON.stringify({ providers, discovered });
    for (const secret of ["fake-token", "fake-api-key", "fake-env-token", "fake-env-key"]) assert.ok(!publicData.includes(secret));
    assert.deepEqual((JSON.parse(applied.draft.content ?? "{}") as any).env, JSON.parse(draft.content).env);
    await assert.rejects(() => discoverImportModels({ platform: "claude", providerId: providers.providers[0].id, draft }, { ...options, fetch: async () => { throw new Error("fake-token fake-api-key fake-env-token fake-env-key"); } }), (error: Error) => !/fake-(?:token|api-key|env-token|env-key)/.test(error.message));
  }
});
