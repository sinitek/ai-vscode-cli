import assert = require("node:assert/strict");
import fs = require("node:fs");
import path = require("node:path");
import test = require("node:test");
import * as TOML from "@iarna/toml";
import { MODEL_IMPORT_PLATFORM_STRATEGIES } from "../../config/modelimportplatformstrategies";
import {
  applyModelImport,
  discoverImportModels,
  getModelImportProviders,
  type ModelImportDraft,
  type ModelImportPlatform,
} from "../../config/modelimport";

const PLATFORMS: ModelImportPlatform[] = ["claude", "codex", "opencode", "grok", "dsh", "kimi-code", "zcode"];

const claudeDraft = (): ModelImportDraft => ({ content: JSON.stringify({
  model: "old",
  env: { ANTHROPIC_BASE_URL: "https://claude.example/v1", ANTHROPIC_AUTH_TOKEN: "claude-secret" },
}) });

const codexDraft = (): ModelImportDraft => ({
  configContent: 'model_provider = "gateway"\nmodel = "old"\n\n[model_providers.gateway]\nname = "Gateway"\nbase_url = "https://codex.example/v1"\nwire_api = "responses"\nenv_key = "CODEX_KEY"\n',
  authContent: '{"CODEX_KEY":"codex-secret"}',
});

const openCodeDraft = (): ModelImportDraft => ({ configContent: JSON.stringify({
  provider: {
    gateway: {
      npm: "@ai-sdk/openai-compatible",
      options: { baseURL: "https://opencode.example/v1", apiKey: "opencode-secret" },
      models: { existing: { name: "Existing" } },
    },
  },
}) });

const grokDraft = (): ModelImportDraft => ({ content: `[models]\ndefault = "old"\n\n[model.old]\nmodel = "old"\nbase_url = "https://grok.example/v1"\napi_backend = "responses"\napi_key = "grok-secret"\n` });

const dshDraft = (): ModelImportDraft => ({ content: JSON.stringify({
  schemaVersion: 1,
  provider: "sinitek-custom",
  api: "openai-completions",
  apiKey: "dsh-secret",
  baseURL: "https://dsh.example/v1",
  models: [{ id: "old", name: "Old", input: ["text"] }],
  acpModel: "old",
}) });

const kimiDraft = (): ModelImportDraft => ({ content: `default_model = "old"\n\n[providers.gateway]\ntype = "openai"\nbase_url = "https://kimi.example/v1"\napi_key = "kimi-secret"\n\n[models.old]\nprovider = "gateway"\nmodel = "old"\nmax_context_size = 4096\n` });

const zcodeDraft = (): ModelImportDraft => ({ content: JSON.stringify({
  schemaVersion: 1,
  config: {
    providerConfigRules: {
      providerRules: [{
        providerId: "gateway",
        config: {
          access: { apiKey: "zcode-secret" },
          api: { type: "openai-responses", baseUrl: "https://zcode.example/v1" },
          personalModelIds: ["existing"],
        },
      }],
    },
  },
}) });

const DRAFTS: Record<ModelImportPlatform, () => ModelImportDraft> = {
  claude: claudeDraft,
  codex: codexDraft,
  opencode: openCodeDraft,
  grok: grokDraft,
  dsh: dshDraft,
  "kimi-code": kimiDraft,
  zcode: zcodeDraft,
};

function readSource(fileName: string): string {
  return fs.readFileSync(path.join(process.cwd(), "src", "config", fileName), "utf8");
}

const PUBLIC_PROVIDER_KEYS = new Set(["id", "label", "baseUrl", "protocol", "mode", "disabledReason", "anthropicAuthToken"]);

test("registers one complete strategy per model import platform", () => {
  assert.deepEqual(Object.keys(MODEL_IMPORT_PLATFORM_STRATEGIES).sort(), [...PLATFORMS].sort());
  for (const platform of PLATFORMS) {
    const strategy = MODEL_IMPORT_PLATFORM_STRATEGIES[platform];
    assert.equal(typeof strategy.providers, "function", `${platform} providers`);
    assert.equal(typeof strategy.writeDraft, "function", `${platform} writeDraft`);
  }
  assert.equal(typeof MODEL_IMPORT_PLATFORM_STRATEGIES.claude.discoveryFields, "function");
  for (const platform of PLATFORMS.filter((value) => value !== "claude")) {
    assert.equal(MODEL_IMPORT_PLATFORM_STRATEGIES[platform].discoveryFields, undefined);
  }
});

test("exposes only the public provider contract for all seven platforms", () => {
  for (const platform of PLATFORMS) {
    const draft = DRAFTS[platform]();
    const providers = getModelImportProviders({ platform, draft }, { env: { CODEX_KEY: "codex-secret" } }).providers;
    assert.ok(providers.length > 0, `${platform} providers`);
    for (const provider of providers) {
      for (const key of Object.keys(provider)) {
        assert.ok(PUBLIC_PROVIDER_KEYS.has(key), `${platform} leaked provider field ${key}`);
      }
      assert.match(provider.id, /^provider-[a-f0-9]{20}$/);
    }
    assert.doesNotMatch(JSON.stringify(providers), /claude-secret|codex-secret|opencode-secret|grok-secret|dsh-secret|kimi-secret|zcode-secret/);
  }
});

test("returns the documented result shapes for discovery and apply", async () => {
  const draft = openCodeDraft();
  const provider = getModelImportProviders({ platform: "opencode", draft }).providers[0];
  const discovered = await discoverImportModels({ platform: "opencode", providerId: provider.id, draft }, {
    fetch: async () => new Response(JSON.stringify({ data: [{ id: "new" }] }), { status: 200 }),
  });
  assert.deepEqual(Object.keys(discovered).sort(), ["existingModelIds", "models"]);
  assert.deepEqual(discovered.existingModelIds, ["existing"]);
  const applied = await applyModelImport({ platform: "opencode", providerId: provider.id, draft, selectedModelIds: ["new"] });
  assert.deepEqual(Object.keys(applied), ["draft"]);
  assert.deepEqual(Object.keys(applied.draft).sort(), ["configContent"]);
  const parsed = JSON.parse(applied.draft.configContent ?? "{}") as any;
  assert.deepEqual(parsed.provider.gateway.models.new, { name: "new" });
  assert.deepEqual(parsed.provider.gateway.models.existing, { name: "Existing" });
});

test("treats already imported models as an equivalent cloned draft without mutating the input", async () => {
  const draft = openCodeDraft();
  const snapshot = JSON.parse(JSON.stringify(draft));
  const provider = getModelImportProviders({ platform: "opencode", draft }).providers[0];
  const applied = await applyModelImport({ platform: "opencode", providerId: provider.id, draft, selectedModelIds: ["existing"] });
  assert.deepEqual(applied.draft, draft);
  assert.notEqual(applied.draft, draft);
  assert.deepEqual(draft, snapshot);

  const grok = grokDraft();
  const grokSnapshot = JSON.parse(JSON.stringify(grok));
  const grokProvider = getModelImportProviders({ platform: "grok", draft: grok }).providers[0];
  const grokApplied = await applyModelImport({ platform: "grok", providerId: grokProvider.id, draft: grok, selectedModelIds: ["old"] });
  assert.deepEqual(grokApplied.draft, grok);
  assert.deepEqual(grok, grokSnapshot);
});

test("keeps the caller draft untouched when an import fails", async () => {
  const draft = dshDraft();
  const snapshot = JSON.parse(JSON.stringify(draft));
  const provider = getModelImportProviders({ platform: "dsh", draft }).providers[0];
  await assert.rejects(
    applyModelImport({ platform: "dsh", providerId: provider.id, draft, selectedModelIds: ["bad id"] }),
    /DSH model id/,
  );
  assert.deepEqual(draft, snapshot);

  const kimi = kimiDraft();
  const kimiSnapshot = JSON.parse(JSON.stringify(kimi));
  const kimiProvider = getModelImportProviders({ platform: "kimi-code", draft: kimi }).providers[0];
  const missingTemplate = { content: kimi.content!.replace("max_context_size = 4096", "max_context_size = 0") };
  await assert.rejects(
    applyModelImport({ platform: "kimi-code", providerId: kimiProvider.id, draft: missingTemplate, selectedModelIds: ["new"] }),
    /同一 provider.*max_context_size/,
  );
  assert.deepEqual(kimi, kimiSnapshot);
});

test("rejects unsupported platforms, unknown providers, and empty selections with existing error text", async () => {
  assert.throws(
    () => getModelImportProviders({ platform: "gemini" as never, draft: {} }),
    /getModelImportProviders platform is unsupported\./,
  );
  const draft = openCodeDraft();
  await assert.rejects(
    discoverImportModels({ platform: "opencode", providerId: "provider-00000000000000000000", draft }, { fetch: async () => new Response("{}") }),
    /Provider is not present in the current draft\./,
  );
  const provider = getModelImportProviders({ platform: "opencode", draft }).providers[0];
  await assert.rejects(
    applyModelImport({ platform: "opencode", providerId: provider.id, draft, selectedModelIds: [] }),
    /Select at least one model to import\./,
  );
  await assert.rejects(
    applyModelImport({ platform: "opencode", providerId: provider.id, draft, selectedModelIds: ["new", "new"] }),
    /selectedModelIds contains duplicates\./,
  );
  await assert.rejects(
    applyModelImport({ platform: "opencode", providerId: provider.id, draft, selectedModelIds: ["new"], fields: { model: "new" } } as never),
    /applyModelImport fields are invalid\./,
  );
});

test("keeps Claude field mapping parity through the strategy table", async () => {
  const draft = claudeDraft();
  const provider = getModelImportProviders({ platform: "claude", draft }).providers[0];
  const discovered = await discoverImportModels({ platform: "claude", providerId: provider.id, draft }, {
    fetch: async () => new Response(JSON.stringify({ data: [{ id: "new" }] }), { status: 200 }),
  });
  assert.deepEqual(discovered.fields?.map((field) => field.key), [
    "model",
    "env.ANTHROPIC_DEFAULT_HAIKU_MODEL",
    "env.ANTHROPIC_DEFAULT_SONNET_MODEL",
    "env.ANTHROPIC_DEFAULT_OPUS_MODEL",
    "env.CLAUDE_CODE_SUBAGENT_MODEL",
  ]);
  const applied = await applyModelImport({
    platform: "claude",
    providerId: provider.id,
    draft,
    selectedModelIds: ["new"],
    fields: { model: "new" },
  });
  const parsed = JSON.parse(applied.draft.content ?? "{}");
  assert.equal(parsed.model, "new");
  assert.equal(parsed.env.ANTHROPIC_AUTH_TOKEN, "claude-secret");
});

test("writes Codex through the single-model root setting only", async () => {
  const draft = codexDraft();
  const provider = getModelImportProviders({ platform: "codex", draft }, { env: { CODEX_KEY: "codex-secret" } }).providers[0];
  const applied = await applyModelImport({ platform: "codex", providerId: provider.id, draft, selectedModelIds: ["root-new"] }, { env: { CODEX_KEY: "codex-secret" } });
  const parsed = TOML.parse(applied.draft.configContent ?? "") as any;
  assert.equal(parsed.model, "root-new");
  assert.equal(parsed.model_providers.gateway.name, "Gateway");
  await assert.rejects(
    applyModelImport({ platform: "codex", providerId: provider.id, draft, selectedModelIds: ["one", "two"] }, { env: { CODEX_KEY: "codex-secret" } }),
    /exactly one selected model/,
  );
});

test("keeps the facade table-driven and the lower layers free of facade imports", () => {
  const facade = readSource("modelimport.ts");
  assert.doesNotMatch(facade, /case "(?:claude|codex|opencode|grok|dsh|kimi-code|zcode)"/);
  assert.doesNotMatch(facade, /payload\.platform ===/);
  for (const layer of ["modelimporttypes.ts", "modelimportshared.ts", "modelimportedits.ts", "modelimportdiscovery.ts", "modelimportplatformstrategies.ts"]) {
    const source = readSource(layer);
    assert.doesNotMatch(source, /from "\.\/modelimport"/, `${layer} must not import the facade`);
  }
  assert.match(readSource("modelimport.ts"), /MODEL_IMPORT_PLATFORM_STRATEGIES\[payload\.platform\]\.providers/);
  assert.match(readSource("modelimport.ts"), /MODEL_IMPORT_PLATFORM_STRATEGIES\[validated\.platform\]\.writeDraft/);
});

test("keeps the Claude field whitelist single-sourced between facade and strategies", async () => {
  const facade = readSource("modelimport.ts");
  const shared = readSource("modelimportshared.ts");
  const strategies = readSource("modelimportplatformstrategies.ts");
  assert.match(shared, /export const CLAUDE_FIELD_KEYS = \[/);
  assert.doesNotMatch(facade, /const CLAUDE_FIELD_KEYS = \[/, "facade must not redefine the Claude field whitelist");
  assert.match(facade, /CLAUDE_FIELD_KEYS,/);
  assert.doesNotMatch(strategies, /const CLAUDE_FIELD_KEYS = \[/, "strategies must not redefine the Claude field whitelist");
  assert.equal((facade.match(/CLAUDE_FIELD_KEYS/g) || []).length, 2);
  const declarations = [facade, shared, strategies].flatMap((source) => source.match(/const CLAUDE_FIELD_KEYS[^\]]*\]/g) || []);
  assert.equal(declarations.length, 1);
  assert.deepEqual(
    [...shared.match(/export const CLAUDE_FIELD_KEYS = \[[\s\S]*?\] as const;/)![0].matchAll(/"([^"]+)"/g)].map((match) => match[1]),
    ["model", "env.ANTHROPIC_DEFAULT_HAIKU_MODEL", "env.ANTHROPIC_DEFAULT_SONNET_MODEL", "env.ANTHROPIC_DEFAULT_OPUS_MODEL", "env.CLAUDE_CODE_SUBAGENT_MODEL"],
  );
});

test("rejects invalid Claude fields through the shared whitelist", async () => {
  const draft = claudeDraft();
  const provider = getModelImportProviders({ platform: "claude", draft }).providers[0];
  const base = { platform: "claude" as const, providerId: provider.id, draft };
  await assert.rejects(applyModelImport({ ...base, selectedModelIds: ["new"], fields: { "env.UNKNOWN_MODEL": "new" } }), /fields are invalid/);
  await assert.rejects(applyModelImport({ ...base, selectedModelIds: ["new"], fields: { "model.name": "new" } }), /fields are invalid/);
  await assert.rejects(applyModelImport({ ...base, selectedModelIds: ["new"], fields: { env: "new" } }), /fields are invalid/);
  for (const key of ["model", "env.ANTHROPIC_DEFAULT_HAIKU_MODEL", "env.ANTHROPIC_DEFAULT_SONNET_MODEL", "env.ANTHROPIC_DEFAULT_OPUS_MODEL", "env.CLAUDE_CODE_SUBAGENT_MODEL"]) {
    const applied = await applyModelImport({ ...base, selectedModelIds: ["new"], fields: { [key]: "new" } });
    const parsed = JSON.parse(applied.draft.content ?? "{}");
    assert.equal(key === "model" ? parsed.model : parsed.env[key.slice(4)], "new", key);
  }
});

test("derives the facade platform whitelist from the strategy registry", async () => {
  const facade = readSource("modelimport.ts");
  assert.doesNotMatch(facade, /const MODEL_IMPORT_PLATFORMS = \[/);
  assert.match(facade, /Object\.keys\(MODEL_IMPORT_PLATFORM_STRATEGIES\)/);
  for (const platform of PLATFORMS) {
    assert.ok(getModelImportProviders({ platform, draft: DRAFTS[platform]() }).providers.length > 0, platform);
  }
  assert.throws(() => getModelImportProviders({ platform: "gemini" as ModelImportPlatform, draft: {} }), /platform is unsupported/);
});
