import test = require("node:test");
import assert = require("node:assert/strict");
import {
  DSH_EXAMPLE_BASE_URL,
  DSH_REASONING_OPTIONS,
  DSH_RESPONSE_MODEL_ALIAS,
  DSH_SUPPORTS_CONFIGURED_MODEL_LIST,
  DSH_VERIFIED_MODEL_ID,
  commitDshDocument,
  createDshExampleProfileText,
  isDshExecutableModel,
  parseDshConfigModels,
  readDshModelWireForRun,
  resolveDshConfigModel,
  serializeDshPatchYaml,
  toDshModelWireValue,
} from "../../cli/dshConfigModels";
import { installVscodeMock } from "../vscodeMock";

installVscodeMock();

const { readExplicitDshPatchArgs } = require("../../cli/config") as typeof import("../../cli/config");

const EXAMPLE = createDshExampleProfileText();

test("parses only the verified complete model id", () => {
  const parsed = parseDshConfigModels(EXAMPLE);
  assert.equal(parsed.error, null);
  assert.deepEqual(parsed.models, [DSH_VERIFIED_MODEL_ID]);
  assert.equal(parsed.labels[DSH_VERIFIED_MODEL_ID], DSH_VERIFIED_MODEL_ID);
  assert.equal(parsed.defaultModel, DSH_VERIFIED_MODEL_ID);
  assert.deepEqual(parsed.reasoningOptionsByModelId[DSH_VERIFIED_MODEL_ID], [...DSH_REASONING_OPTIONS]);
  assert.equal(parsed.wireByModelId[DSH_VERIFIED_MODEL_ID], toDshModelWireValue(DSH_VERIFIED_MODEL_ID));
  assert.equal(toDshModelWireValue(DSH_VERIFIED_MODEL_ID), "[\"sinitek-custom\",\"subcoco/deepseek-v4.1-flash\"]");
  assert.equal(readDshModelWireForRun(parsed, DSH_VERIFIED_MODEL_ID), toDshModelWireValue(DSH_VERIFIED_MODEL_ID));
  assert.equal(readDshModelWireForRun(parsed, null), toDshModelWireValue(DSH_VERIFIED_MODEL_ID));
  assert.throws(() => readDshModelWireForRun(parsed, DSH_RESPONSE_MODEL_ALIAS), /wire value/);
  assert.throws(() => readDshModelWireForRun(parsed, "[\"subcoco\",\"deepseek-v4.1-flash\"]"), /wire value/);
  assert.equal(isDshExecutableModel(DSH_VERIFIED_MODEL_ID, parsed.models), true);
  assert.equal(isDshExecutableModel("any-string-initialize-accepted", parsed.models), false);
});

test("normalizes legacy verified models and keeps custom reasoning opt-in", () => {
  const legacy = JSON.parse(EXAMPLE) as {
    models: Array<Record<string, unknown>>;
  };
  delete legacy.models[0].reasoningEfforts;
  delete legacy.models[0].compat;
  const legacyParsed = parseDshConfigModels(JSON.stringify(legacy));
  assert.equal(legacyParsed.error, null);
  assert.deepEqual(legacyParsed.reasoningOptionsByModelId[DSH_VERIFIED_MODEL_ID], [...DSH_REASONING_OPTIONS]);

  const customId = "gateway/custom-model";
  const custom = JSON.parse(EXAMPLE) as {
    models: Array<Record<string, unknown>>;
    acpModel: string;
  };
  custom.models[0] = {
    id: customId,
    name: customId,
    input: ["text"],
    maxTokens: 256,
  };
  custom.acpModel = customId;
  const customParsed = parseDshConfigModels(JSON.stringify(custom));
  assert.equal(customParsed.error, null);
  assert.deepEqual(customParsed.reasoningOptionsByModelId[customId], []);

  custom.models[0].reasoningEfforts = {
    off: null,
    low: "low",
    high: "high",
    max: "max",
  };
  custom.models[0].compat = {
    thinkingFormat: "deepseek",
    supportsReasoningEffort: true,
  };
  const configuredCustom = parseDshConfigModels(JSON.stringify(custom));
  assert.equal(configuredCustom.error, null);
  assert.deepEqual(configuredCustom.reasoningOptionsByModelId[customId], [...DSH_REASONING_OPTIONS]);
  const configuredCustomCommit = commitDshDocument(JSON.stringify(custom));
  assert.equal(configuredCustomCommit.ok, true);
  if (configuredCustomCommit.ok) {
    const configuredCustomPatch = serializeDshPatchYaml(configuredCustomCommit.document);
    assert.match(configuredCustomPatch, /xhigh: xhigh/);
    assert.equal(configuredCustomPatch.includes("off: null"), false);
  }

  custom.models[0].reasoningEfforts = {
    off: null,
    low: "low",
    medium: "medium",
    high: "high",
  };
  assert.match(parseDshConfigModels(JSON.stringify(custom)).error ?? "", /reasoningEfforts/);
});

test("rejects slash splits, aliases, overrides, secrets, and unverified fields", () => {
  const split = commitDshDocument(JSON.stringify({
    ...JSON.parse(EXAMPLE),
    provider: "subcoco",
    acpModel: "deepseek-v4.1-flash",
  }));
  assert.equal(split.ok, false);

  const alias = JSON.parse(EXAMPLE) as { models: Array<{ id: string; name: string }>; acpModel: string };
  alias.models[0].id = DSH_RESPONSE_MODEL_ALIAS;
  alias.models[0].name = DSH_RESPONSE_MODEL_ALIAS;
  alias.acpModel = DSH_RESPONSE_MODEL_ALIAS;
  const aliasResult = parseDshConfigModels(JSON.stringify(alias));
  assert.equal(aliasResult.models.length, 0);
  assert.match(aliasResult.error ?? "", /alias/);
  assert.equal(resolveDshConfigModel(aliasResult, DSH_RESPONSE_MODEL_ALIAS), null);

  const overrides = JSON.parse(EXAMPLE) as { modelOverrides?: unknown };
  overrides.modelOverrides = { id: DSH_VERIFIED_MODEL_ID };
  assert.match(parseDshConfigModels(JSON.stringify(overrides)).error ?? "", /modelOverrides/);

  const secret = EXAMPLE.replace(DSH_EXAMPLE_BASE_URL, "https://gateway.example/v1?api_key=sk-secretvalue");
  assert.match(parseDshConfigModels(secret).error ?? "", /credential|baseURL/);

  const unverified = JSON.parse(EXAMPLE) as { headers?: unknown };
  unverified.headers = { authorization: "Bearer example" };
  assert.match(parseDshConfigModels(JSON.stringify(unverified)).error ?? "", /headers/);
});

test("falls back only when the model selection is missing", () => {
  const parsed = parseDshConfigModels(EXAMPLE);
  const wire = JSON.stringify(["sinitek-custom", DSH_VERIFIED_MODEL_ID]);
  assert.equal(wire, toDshModelWireValue(DSH_VERIFIED_MODEL_ID));
  assert.equal(resolveDshConfigModel(parsed, null), DSH_VERIFIED_MODEL_ID);
  assert.equal(resolveDshConfigModel(parsed, undefined), DSH_VERIFIED_MODEL_ID);
  assert.equal(resolveDshConfigModel(parsed, ""), DSH_VERIFIED_MODEL_ID);
  assert.equal(resolveDshConfigModel(parsed, "   "), DSH_VERIFIED_MODEL_ID);
  assert.equal(resolveDshConfigModel(parsed, DSH_VERIFIED_MODEL_ID), DSH_VERIFIED_MODEL_ID);
  assert.equal(resolveDshConfigModel(parsed, wire), DSH_VERIFIED_MODEL_ID);
  assert.equal(readDshModelWireForRun(parsed, wire), wire);

  assert.equal(resolveDshConfigModel(parsed, DSH_RESPONSE_MODEL_ALIAS), null);
  assert.equal(resolveDshConfigModel(parsed, "not-configured-model"), null);
  assert.equal(resolveDshConfigModel(parsed, JSON.stringify(["subcoco", "deepseek-v4.1-flash"])), null);
  assert.equal(resolveDshConfigModel(parsed, JSON.stringify(["sinitek-custom", "not-configured-model"])), null);
  assert.equal(resolveDshConfigModel(parsed, JSON.stringify(["Sinitek-custom", DSH_VERIFIED_MODEL_ID])), null);
  assert.equal(resolveDshConfigModel(undefined, null), null);
  assert.equal(resolveDshConfigModel({ ...parsed, error: "invalid" }, ""), null);
  assert.notEqual(resolveDshConfigModel(parsed, DSH_RESPONSE_MODEL_ALIAS), DSH_RESPONSE_MODEL_ALIAS);
  assert.throws(() => readDshModelWireForRun(parsed, "not-configured-model"), /wire value/);
  assert.throws(() => readDshModelWireForRun(parsed, JSON.stringify(["sinitek-custom", "not-configured-model"])), /wire value/);
});

test("accepts loopback http baseURL and rejects remote plaintext http, credentials, and unverified fields", () => {
  const loopbackUrls = [
    "http://127.0.0.1:9/v1",
    "http://127.0.0.2:9/v1",
    "http://localhost:9/v1",
    "http://LOCALHOST:9/v1",
    "http://[::1]:9/v1",
    "http://[::ffff:127.0.0.1]:9/v1",
  ];
  for (const baseURL of loopbackUrls) {
    const committed = commitDshDocument(profileWithBaseUrl(baseURL));
    assert.equal(committed.ok, true, baseURL);
    if (!committed.ok) {
      continue;
    }
    assert.equal(committed.document.baseURL.startsWith("http://"), true);
    assert.equal(committed.document.baseURL.includes("@"), false);
    assert.equal(committed.content.includes("sk-"), false);
    assert.equal(committed.document.apiKeyEnv, "SINITEK_DSH_API_KEY");
    const yaml = serializeDshPatchYaml(committed.document);
    assert.equal(yaml.includes("sk-"), false);
    assert.match(yaml, /baseURL: "/);
  }

  const remoteOrUnsafe = [
    "http://gateway.example/v1",
    "http://8.8.8.8/v1",
    "http://10.1.2.3/v1",
    "http://192.168.1.8/v1",
    "http://172.16.0.4/v1",
    "http://[::2]:9/v1",
    "http://user:secretpass@127.0.0.1:9/v1",
    "https://user:secretpass@gateway.example/v1",
    "http://127.0.0.1:9/v1?api_key=example",
    "https://gateway.example/v1#sk-secretvalue",
    "file:///etc/passwd",
    "file:///C:/Windows/system32",
    "C:\\Users\\tester\\.dsh\\patch.yaml",
    "http://127.0.0.1:9\\v1",
  ];
  for (const baseURL of remoteOrUnsafe) {
    const rejected = commitDshDocument(profileWithBaseUrl(baseURL));
    assert.equal(rejected.ok, false, baseURL);
    if (!rejected.ok) {
      assert.match(rejected.error, /credential|baseURL/);
    }
  }

  const unverified = JSON.parse(profileWithBaseUrl("http://127.0.0.1:9/v1")) as { transport?: string };
  unverified.transport = "websocket";
  assert.match(parseDshConfigModels(JSON.stringify(unverified)).error ?? "", /transport/);

  const assignedSecret = EXAMPLE.replace(
    "\"apiKeyEnv\": \"SINITEK_DSH_API_KEY\"",
    "\"apiKeyEnv\": \"SINITEK_DSH_API_KEY=sk-examplesecret\"",
  );
  assert.match(parseDshConfigModels(assignedSecret).error ?? "", /credential/);
});

test("example profile does not embed secrets and keeps the model id off platform path separators", () => {
  assert.equal(EXAMPLE.includes("sk-"), false);
  assert.equal(EXAMPLE.includes("127.0.0.1"), false);
  assert.match(EXAMPLE, /https:\/\/gateway\.example\/v1/);
  assert.equal(DSH_VERIFIED_MODEL_ID, "subcoco/deepseek-v4.1-flash");
  assert.equal(DSH_VERIFIED_MODEL_ID.includes("\\"), false);
  assert.notEqual(String(DSH_VERIFIED_MODEL_ID), String(DSH_RESPONSE_MODEL_ALIAS));
  assert.equal(EXAMPLE.includes(`"acpModel": "${DSH_RESPONSE_MODEL_ALIAS}"`), false);
  const committed = commitDshDocument(EXAMPLE);
  assert.equal(committed.ok, true);
  if (committed.ok) {
    assert.equal(committed.document.baseURL, DSH_EXAMPLE_BASE_URL);
    assert.equal(serializeDshPatchYaml(committed.document).includes("\\"), false);
  }
});

function profileWithBaseUrl(baseURL: string): string {
  const document = JSON.parse(EXAMPLE) as { baseURL: string };
  document.baseURL = baseURL;
  return JSON.stringify(document);
}

test("patch yaml uses the verified provider contract and omits unverified fields", () => {
  const committed = commitDshDocument(EXAMPLE);
  assert.equal(committed.ok, true);
  if (!committed.ok) {
    return;
  }
  const yaml = serializeDshPatchYaml(committed.document);
  assert.match(yaml, /sinitek-custom:/);
  assert.match(yaml, /api: openai-completions/);
  assert.match(yaml, /apiKeyEnv: SINITEK_DSH_API_KEY/);
  assert.match(yaml, /subcoco\/deepseek-v4\.1-flash/);
  assert.equal(yaml.includes("modelOverrides"), false);
  assert.equal(yaml.includes("headers:"), false);
  assert.match(yaml, /reasoningEfforts:/);
  assert.match(yaml, /low: low/);
  assert.match(yaml, /high: high/);
  assert.match(yaml, /xhigh: xhigh/);
  assert.match(yaml, /max: max/);
  assert.equal(yaml.includes("off: null"), false);
  assert.equal(yaml.includes("contextWindow"), false);
  assert.equal(yaml.includes("sk-"), false);
  assert.match(yaml, /https:\/\/gateway\.example\/v1/);
});

test("treats DSH as an interactive CLI and not an auto-compaction CLI", () => {
  const { isInteractiveSupported } = require("../../cli/config") as typeof import("../../cli/config");
  const { isAutoContextCompactionCli } = require("../../contextCompactionRunner") as typeof import("../../contextCompactionRunner");
  assert.equal(isInteractiveSupported("dsh"), true);
  assert.equal(isInteractiveSupported("codex"), true);
  assert.equal(isInteractiveSupported("claude"), true);
  assert.equal(isInteractiveSupported("grok"), true);
  assert.equal(isInteractiveSupported("opencode"), false);
  assert.equal(isAutoContextCompactionCli("dsh"), false);
  assert.equal(isAutoContextCompactionCli("grok"), true);
});

test("keeps configured model order and selects only listed acpModel values", () => {
  assert.equal(DSH_SUPPORTS_CONFIGURED_MODEL_LIST, true);
  const document = JSON.parse(EXAMPLE) as {
    models: Array<{ id: string; name: string; input: string[]; maxTokens: number }>;
    acpModel: string;
  };
  const second = "gateway/other-model";
  document.models.push({
    id: second,
    name: second,
    input: ["text"],
    maxTokens: 256,
  });
  document.acpModel = second;
  const text = JSON.stringify(document);
  const committed = commitDshDocument(text);
  assert.equal(committed.ok, true);
  if (!committed.ok) {
    return;
  }
  assert.deepEqual(committed.document.models.map((model) => model.id), [DSH_VERIFIED_MODEL_ID, second]);
  assert.equal(committed.document.acpModel, second);
  assert.equal(committed.content.includes(DSH_RESPONSE_MODEL_ALIAS) && !committed.content.includes(DSH_VERIFIED_MODEL_ID), false);
  const parsed = parseDshConfigModels(committed.content);
  assert.deepEqual(parsed.models, [DSH_VERIFIED_MODEL_ID, second]);
  assert.equal(parsed.defaultModel, second);
  assert.equal(resolveDshConfigModel(parsed, null), second);
  assert.equal(resolveDshConfigModel(parsed, DSH_VERIFIED_MODEL_ID), DSH_VERIFIED_MODEL_ID);
  assert.equal(resolveDshConfigModel(parsed, toDshModelWireValue(second)), second);
  assert.equal(readDshModelWireForRun(parsed, second), toDshModelWireValue(second));
  assert.equal(isDshExecutableModel(second, parsed.models), true);
  assert.equal(isDshExecutableModel(DSH_RESPONSE_MODEL_ALIAS, parsed.models), false);
  assert.equal(isDshExecutableModel("not-configured-model", parsed.models), false);
  const yaml = serializeDshPatchYaml(committed.document);
  assert.equal(yaml.indexOf(DSH_VERIFIED_MODEL_ID) < yaml.indexOf(second), true);
  assert.match(yaml, new RegExp(`model: ${JSON.stringify(second)}`));

  const reversed = JSON.parse(committed.content) as typeof document;
  reversed.models.reverse();
  const reversedCommit = commitDshDocument(JSON.stringify(reversed));
  assert.equal(reversedCommit.ok, true);
  if (reversedCommit.ok) {
    assert.deepEqual(reversedCommit.document.models.map((model) => model.id), [second, DSH_VERIFIED_MODEL_ID]);
  }

  const alias = JSON.parse(committed.content) as typeof document;
  alias.models[1].id = DSH_RESPONSE_MODEL_ALIAS;
  alias.models[1].name = DSH_RESPONSE_MODEL_ALIAS;
  alias.acpModel = DSH_RESPONSE_MODEL_ALIAS;
  assert.match(parseDshConfigModels(JSON.stringify(alias)).error ?? "", /alias/);

  const duplicate = JSON.parse(committed.content) as typeof document;
  duplicate.models[1].id = DSH_VERIFIED_MODEL_ID;
  duplicate.models[1].name = DSH_VERIFIED_MODEL_ID;
  assert.match(parseDshConfigModels(JSON.stringify(duplicate)).error ?? "", /unique/);

  const missingCurrent = JSON.parse(committed.content) as typeof document;
  missingCurrent.acpModel = "not-configured-model";
  assert.match(parseDshConfigModels(JSON.stringify(missingCurrent)).error ?? "", /acpModel/);

  const empty = JSON.parse(EXAMPLE) as { models: unknown[] };
  empty.models = [];
  assert.match(parseDshConfigModels(JSON.stringify(empty)).error ?? "", /at least one/);
});

test("keeps accepted extension fields and rejects secrets or closed unknown keys", () => {
  const extended = JSON.parse(EXAMPLE) as {
    uiExtensionMetadata?: { preserved: boolean };
    defaultMaxTokens?: number;
    models: Array<Record<string, unknown>>;
    acpModel: string;
  };
  extended.uiExtensionMetadata = { preserved: true };
  extended.defaultMaxTokens = 1024;
  extended.models[0].vendorMeta = { tier: "flash", preserved: true };
  const committed = commitDshDocument(JSON.stringify(extended));
  assert.equal(committed.ok, true);
  if (!committed.ok) {
    return;
  }
  const round = JSON.parse(committed.content) as typeof extended;
  assert.deepEqual(round.uiExtensionMetadata, { preserved: true });
  assert.equal(round.defaultMaxTokens, 1024);
  assert.deepEqual(round.models[0].vendorMeta, { tier: "flash", preserved: true });
  assert.equal(round.acpModel, DSH_VERIFIED_MODEL_ID);
  assert.equal(round.models[0].id, DSH_VERIFIED_MODEL_ID);
  const again = commitDshDocument(committed.content);
  assert.equal(again.ok, true);
  if (again.ok) {
    assert.equal(again.content, committed.content);
  }
  const yaml = serializeDshPatchYaml(committed.document);
  assert.equal(yaml.includes("uiExtensionMetadata"), false);
  assert.equal(yaml.includes("vendorMeta"), false);
  assert.equal(yaml.includes("defaultMaxTokens"), false);
  assert.equal(yaml.includes("preserved"), false);
  assert.match(yaml, /subcoco\/deepseek-v4\.1-flash/);

  const renamed = JSON.parse(committed.content) as typeof extended;
  renamed.models[0].id = "gateway/other-model";
  renamed.models[0].name = "gateway/other-model";
  renamed.models.push({
    id: "vendor/second-model",
    name: "vendor/second-model",
    input: ["text"],
    maxTokens: 256,
    catalogNote: { kept: true },
  });
  renamed.acpModel = "vendor/second-model";
  const renamedCommit = commitDshDocument(JSON.stringify(renamed));
  assert.equal(renamedCommit.ok, true);
  if (!renamedCommit.ok) {
    return;
  }
  const renamedRound = JSON.parse(renamedCommit.content) as typeof extended & {
    models: Array<Record<string, unknown>>;
  };
  assert.deepEqual(renamedRound.models.map((model) => model.id), ["gateway/other-model", "vendor/second-model"]);
  assert.equal(renamedRound.acpModel, "vendor/second-model");
  assert.deepEqual(renamedRound.uiExtensionMetadata, { preserved: true });
  assert.deepEqual(renamedRound.models[0].vendorMeta, { tier: "flash", preserved: true });
  assert.deepEqual(renamedRound.models[1].catalogNote, { kept: true });
  assert.equal(serializeDshPatchYaml(renamedCommit.document).includes("catalogNote"), false);

  const secretField = JSON.parse(EXAMPLE) as { apiKey?: string };
  secretField.apiKey = "not-a-token-shape";
  const directKey = parseDshConfigModels(JSON.stringify(secretField));
  assert.equal(directKey.error, null);
  const nestedSecret = JSON.parse(EXAMPLE) as { models: Array<Record<string, unknown>> };
  nestedSecret.models[0].token = "example-token";
  assert.match(parseDshConfigModels(JSON.stringify(nestedSecret)).error ?? "", /token|credential/);
  const nestedApiKey = JSON.parse(EXAMPLE) as { models: Array<Record<string, unknown>> };
  nestedApiKey.models[0].apiKey = "nested-key";
  assert.match(parseDshConfigModels(JSON.stringify(nestedApiKey)).error ?? "", /apiKey/);
  const rawSecret = EXAMPLE.replace(
    "\"apiKeyEnv\": \"SINITEK_DSH_API_KEY\"",
    "\"apiKey\": \"sk-fixturetoken\",\n  \"apiKeyEnv\": \"SINITEK_DSH_API_KEY\"",
  );
  const rawDirectKey = parseDshConfigModels(rawSecret);
  assert.equal(rawDirectKey.error, null);
  const withoutApiKeyEnv = JSON.parse(EXAMPLE) as Record<string, unknown>;
  delete withoutApiKeyEnv.apiKeyEnv;
  const normalizedEnvReference = commitDshDocument(JSON.stringify(withoutApiKeyEnv));
  assert.equal(normalizedEnvReference.ok, true);
  if (normalizedEnvReference.ok) {
    assert.equal(normalizedEnvReference.document.apiKeyEnv, "SINITEK_DSH_API_KEY");
    assert.match(serializeDshPatchYaml(normalizedEnvReference.document), /apiKeyEnv: SINITEK_DSH_API_KEY/);
  }
  const closed = JSON.parse(EXAMPLE) as { retryPolicy: { note?: string } };
  closed.retryPolicy.note = "drop-me";
  const closedResult = commitDshDocument(JSON.stringify(closed));
  assert.equal(closedResult.ok, false);
  if (!closedResult.ok) {
    assert.match(closedResult.error, /retryPolicy\.note/);
  }
  const headers = JSON.parse(EXAMPLE) as { headers?: unknown };
  headers.headers = { authorization: "Bearer example" };
  const headersResult = commitDshDocument(JSON.stringify(headers));
  assert.equal(headersResult.ok, false);
  if (!headersResult.ok) {
    assert.match(headersResult.error, /headers/);
    assert.equal(headersResult.error.includes("Bearer example"), false);
  }
});

test("configured launch args allow only explicit patch paths", () => {
  assert.deepEqual(readExplicitDshPatchArgs([]), []);
  assert.deepEqual(readExplicitDshPatchArgs(["--patch", "profile.yaml"]), ["--patch", "profile.yaml"]);
  assert.throws(() => readExplicitDshPatchArgs(["--profile", "headless"]), /profile|agent arg/);
  assert.throws(() => readExplicitDshPatchArgs(["--profile", "acp"]), /profile|agent arg/);
  assert.throws(() => readExplicitDshPatchArgs(["sdk"]), /sdk|agent arg/);
  assert.throws(() => readExplicitDshPatchArgs(["tui"]), /tui|agent arg/);
  assert.throws(() => readExplicitDshPatchArgs(["--model", DSH_VERIFIED_MODEL_ID]), /--model|agent arg/);
});
