import test = require("node:test");
import assert = require("node:assert/strict");
import { ConfiguredModelRepository, type ConfiguredModelReadPort } from "../../config/configuredModelRepository";
import { parseCodexConfigModel } from "../../cli/codexConfigModel";
import { parseGrokConfigModels } from "../../cli/grokConfigModels";
import { createDshExampleDocument, parseDshConfigModels, toDshModelWireValue, DSH_VERIFIED_MODEL_ID } from "../../cli/dshConfigModels";
import { parseKimiCodeConfigModels } from "../../config/kimiCodeConfig";
import { createZcodeExampleText, readZcodeConfigModels, resolveZcodeModelWireForRun, ZCODE_EXAMPLE_MODEL_ID } from "../../config/zcodeConfig";
import { t } from "../../i18n";

type ConfiguredCli = Parameters<ConfiguredModelReadPort["getCurrentConfig"]>[0];
type Current = Awaited<ReturnType<ConfiguredModelReadPort["getCurrentConfig"]>>;

function grokText(alias: string): string {
  return `[models]\ndefault = "${alias}"\n[model."${alias}"]\nmodel = "underlying-${alias}"`;
}

function kimiText(alias: string): string {
  return `default_model = "${alias}"\n[models."${alias}"]\nprovider = "fixture"\nmodel = "underlying-${alias}"`;
}

function dshText(model: string = DSH_VERIFIED_MODEL_ID): string {
  const document = createDshExampleDocument();
  document.models[0].id = model;
  document.acpModel = model;
  return JSON.stringify(document);
}

function zcodeText(model: string): string {
  return createZcodeExampleText().split(ZCODE_EXAMPLE_MODEL_ID).join(model);
}

function fixture(logError?: (event: string, payload: { error: string }) => Promise<void> | void) {
  const current: Record<ConfiguredCli, Current> = {
    codex: { configContent: 'model = "codex-model"', content: 'model = "wrong-field"' },
    grok: { content: grokText("wrong-source") },
    dsh: { content: dshText("native-dsh"), configContent: "invalid ignored content" },
    "kimi-code": { content: kimiText("kimi-alias"), configContent: "invalid ignored content" },
    zcode: { content: createZcodeExampleText(), configContent: "invalid ignored content" },
  };
  const state = { grok: grokText("grok-alias"), failure: undefined as unknown, onRead: (_source: string) => undefined as void };
  const profiles = new Map<string, Current | null>([["profile", { content: dshText(), configContent: "invalid ignored content" }]]);
  const reads: string[] = [];
  const errors: { event: string; payload: { error: string } }[] = [];
  const read = (source: string) => {
    reads.push(source);
    state.onRead(source);
    if (state.failure !== undefined) throw state.failure;
  };
  const port: ConfiguredModelReadPort = {
    async getCurrentConfig(cli) { read(`current:${cli}`); return current[cli]; },
    async getConfigById(cli, configId) { read(`profile:${cli}:${configId}`); return profiles.get(configId) ?? null; },
    async readGrokConfigText() { read("grok-text"); return state.grok; },
  };
  const repository = new ConfiguredModelRepository(port, (event, payload) => {
    errors.push({ event, payload });
    return logError?.(event, payload);
  });
  return { repository, port, current, profiles, state, reads, errors };
}

async function refreshAll(repository: ConfiguredModelRepository, configId: string | null): Promise<void> {
  await Promise.all([
    repository.refreshCodexConfigModel(configId),
    repository.refreshGrokConfigModels(configId),
    repository.refreshKimiCodeConfigModels(configId),
    repository.refreshZcodeConfigModels(configId),
    repository.refreshDshConfigModels(configId),
  ]);
}

function snapshots(repository: ConfiguredModelRepository, configId: string | null | undefined) {
  return [
    repository.getCodexConfigModel(configId),
    repository.getGrokConfigModels(configId),
    repository.getDshConfigModels(configId),
    repository.getKimiCodeConfigModels(configId),
    repository.getZcodeConfigModels(configId),
  ];
}

test("construction and all cache getters perform no I/O; undefined is never the null key", async () => {
  const { repository, reads } = fixture();
  assert.deepEqual(snapshots(repository, undefined), Array(5).fill(undefined));
  assert.deepEqual(snapshots(repository, null), Array(5).fill(undefined));
  assert.deepEqual(snapshots(repository, "unloaded"), Array(5).fill(undefined));
  assert.deepEqual(reads, []);
  await refreshAll(repository, null);
  assert.ok(snapshots(repository, null).every((value) => value !== undefined));
  assert.deepEqual(snapshots(repository, undefined), Array(5).fill(undefined));
  assert.deepEqual(snapshots(repository, "unloaded"), Array(5).fill(undefined));
  assert.equal(reads.length, 5);
});

test("five refresh methods retain their exact sources, parse helpers and field priority", async () => {
  const { repository, current, state, profiles, reads, errors } = fixture();
  await refreshAll(repository, "profile");
  assert.deepEqual(reads, ["current:codex", "grok-text", "current:kimi-code", "current:zcode", "profile:dsh:profile"]);
  assert.deepEqual(snapshots(repository, "profile"), [
    parseCodexConfigModel(current.codex.configContent!), parseGrokConfigModels(state.grok),
    parseDshConfigModels(profiles.get("profile")!.content!), parseKimiCodeConfigModels(current["kimi-code"].content!),
    readZcodeConfigModels(current.zcode.content!),
  ]);
  assert.equal(repository.getCodexConfigModel("profile"), "codex-model");
  assert.equal(repository.getGrokConfigModels("profile")?.defaultModel, "grok-alias");
  assert.equal(repository.getDshConfigModels("profile")?.defaultModel, DSH_VERIFIED_MODEL_ID);
  assert.equal(repository.getKimiCodeConfigModels("profile")?.defaultModel, "kimi-alias");
  assert.deepEqual(errors, []);
});

test("nullish field fallbacks preserve empty content rather than coalescing it", async () => {
  const { repository, current, profiles } = fixture();
  current.codex = { content: 'model = "legacy-codex"' };
  profiles.set("profile", { configContent: dshText("legacy-dsh") });
  await refreshAll(repository, "profile");
  assert.equal(repository.getCodexConfigModel("profile"), "legacy-codex");
  assert.equal(repository.getDshConfigModels("profile")?.defaultModel, "legacy-dsh");
  current.codex = { configContent: "", content: 'model = "must-not-use"' };
  profiles.set("profile", { content: "", configContent: dshText("must-not-use") });
  current["kimi-code"] = { configContent: kimiText("must-not-use") };
  current.zcode = { configContent: createZcodeExampleText() };
  await refreshAll(repository, "profile");
  assert.equal(repository.getCodexConfigModel("profile"), null);
  assert.deepEqual(repository.getDshConfigModels("profile"), parseDshConfigModels(""));
  assert.deepEqual(repository.getKimiCodeConfigModels("profile"), parseKimiCodeConfigModels(""));
  assert.deepEqual(repository.getZcodeConfigModels("profile"), readZcodeConfigModels(""));
  current.codex = {};
  profiles.set("profile", {});
  await refreshAll(repository, "profile");
  assert.equal(repository.getCodexConfigModel("profile"), null);
  assert.deepEqual(repository.getDshConfigModels("profile"), parseDshConfigModels(""));
});

test("CLI, config ID, null key and repository instances have independent caches", async () => {
  const first = fixture();
  const second = fixture();
  await refreshAll(first.repository, "profile");
  const saved = snapshots(first.repository, "profile");
  first.current.codex = { content: 'model = "other-codex"' };
  first.state.grok = grokText("other-grok");
  first.current["kimi-code"] = { content: kimiText("other-kimi") };
  first.current.zcode = { content: zcodeText("other-zcode") };
  first.profiles.set("other", { content: dshText("other-dsh") });
  await refreshAll(first.repository, "other");
  const other = snapshots(first.repository, "other");
  first.current.codex = { content: 'model = "null-codex"' };
  first.state.grok = grokText("null-grok");
  first.current["kimi-code"] = { content: kimiText("null-kimi") };
  first.current.zcode = { content: zcodeText("null-zcode") };
  await refreshAll(first.repository, null);
  assert.deepEqual(snapshots(first.repository, "profile"), saved);
  assert.deepEqual(snapshots(first.repository, "other"), other);
  assert.equal(first.repository.getCodexConfigModel("other"), "other-codex");
  assert.equal(first.repository.getGrokConfigModels("other")?.defaultModel, "other-grok");
  assert.equal(first.repository.getKimiCodeConfigModels("other")?.defaultModel, "other-kimi");
  assert.equal(first.repository.getDshConfigModels("other")?.defaultModel, "other-dsh");
  assert.equal(first.repository.getCodexConfigModel(null), "null-codex");
  assert.equal(first.repository.getGrokConfigModels(null)?.defaultModel, "null-grok");
  assert.equal(first.repository.getKimiCodeConfigModels(null)?.defaultModel, "null-kimi");
  assert.ok(first.repository.getZcodeConfigModels("other")?.defaultModel?.endsWith("/other-zcode"));
  assert.ok(first.repository.getZcodeConfigModels(null)?.defaultModel?.endsWith("/null-zcode"));
  assert.equal(first.repository.getDshConfigModels(null)?.defaultModel, "native-dsh");
  for (const configId of ["profile", "other", null]) {
    assert.deepEqual(snapshots(second.repository, configId), Array(5).fill(undefined));
  }
  await refreshAll(second.repository, "profile");
  second.state.failure = new Error("second instance failure");
  await refreshAll(second.repository, "profile");
  assert.deepEqual(snapshots(first.repository, "profile"), saved);
  assert.deepEqual(second.repository.getZcodeConfigModels("profile")?.models, []);
  assert.ok(first.repository.getZcodeConfigModels("profile")!.models.length > 0);
});

test("editing cache ports replace entries without I/O and share the getter storage", () => {
  const { repository, reads } = fixture();
  const grok = parseGrokConfigModels(grokText("edited-grok"));
  const dsh = parseDshConfigModels(dshText("edited-dsh"));
  const kimi = parseKimiCodeConfigModels(kimiText("edited-kimi"));
  repository.cacheGrokConfigModels(null, grok);
  repository.cacheDshConfigModels(null, dsh);
  repository.cacheKimiCodeConfigModels(null, kimi);
  assert.equal(repository.getGrokConfigModels(null), grok);
  assert.equal(repository.getDshConfigModels(null), dsh);
  assert.equal(repository.getKimiCodeConfigModels(null), kimi);
  const parsed = repository.cacheKimiCodeConfigContent(null, kimiText("saved-kimi"));
  assert.equal(repository.getKimiCodeConfigModels(null), parsed);
  assert.equal(parsed.defaultModel, "saved-kimi");
  assert.deepEqual(reads, []);
});

test("read failures replace every stale cache with its original fallback and fire non-awaited logs", async () => {
  const { repository, state, errors } = fixture(() => new Promise<void>(() => undefined));
  await refreshAll(repository, "profile");
  state.failure = new Error("synthetic read failure");
  await refreshAll(repository, "profile");
  const empty = { models: [], labels: {}, defaultModel: null, error: "synthetic read failure" };
  assert.deepEqual(snapshots(repository, "profile"), [
    null, empty, { ...empty, wireByModelId: {}, reasoningOptionsByModelId: {} },
    { ...empty, thinkingEffort: null, permissionMode: null }, empty,
  ]);
  assert.deepEqual(errors.map(({ event }) => event).sort(), [
    "codex-config-model-read-failed", "grok-config-models-read-failed", "dsh-config-models-read-failed",
    "kimi-code-config-models-read-failed", "zcode-config-models-read-failed",
  ].sort());
  assert.ok(errors.every(({ payload }) => JSON.stringify(payload) === '{"error":"synthetic read failure"}'));
});

test("a synchronous error reporter failure still propagates after the fallback was cached", async () => {
  const reporterFailure = new Error("reporter failed");
  const { repository, state } = fixture(() => { throw reporterFailure; });
  state.failure = new Error("reader failed");
  await assert.rejects(repository.refreshGrokConfigModels("profile"), (error: unknown) => error === reporterFailure);
  assert.equal(repository.getGrokConfigModels("profile")?.error, "reader failed");
});

for (const failure of [new Error(""), "non-Error failure"]) {
  test(`refresh preserves error formatting for ${String(failure)}`, async () => {
    const { repository, state, errors } = fixture();
    state.failure = failure;
    await refreshAll(repository, null);
    assert.ok(errors.every(({ payload }) => payload.error === String(failure)));
    assert.equal(errors.length, 5);
  });
}

test("parser failures replace stale models without inventing read-failed log events", async () => {
  const { repository, current, state, profiles, errors } = fixture();
  await refreshAll(repository, "profile");
  current.codex = { content: "[" };
  state.grok = "[";
  current["kimi-code"] = { content: "[" };
  current.zcode = { content: "{" };
  profiles.set("profile", { content: "{" });
  await refreshAll(repository, "profile");
  assert.equal(repository.getCodexConfigModel("profile"), null);
  for (const config of snapshots(repository, "profile").slice(1)) {
    assert.equal(typeof config, "object");
    assert.ok(config && typeof config === "object" && config.error);
    assert.deepEqual(config && typeof config === "object" ? config.models : undefined, []);
  }
  assert.deepEqual(errors, []);
});

test("DSH missing profile produces the original empty shape without current-config fallback", async () => {
  const { repository, profiles, reads, errors } = fixture();
  await repository.refreshDshConfigModels("profile");
  profiles.delete("profile");
  await repository.refreshDshConfigModels("profile");
  assert.deepEqual(repository.getDshConfigModels("profile"), {
    models: [], labels: {}, defaultModel: null, wireByModelId: {}, reasoningOptionsByModelId: {}, error: "DSH profile was not found.",
  });
  assert.deepEqual(reads, ["profile:dsh:profile", "profile:dsh:profile"]);
  assert.deepEqual(errors, []);
  await repository.refreshDshConfigModels(null);
  assert.equal(repository.getDshConfigModels(null)?.defaultModel, "native-dsh");
});

test("concurrent refresh starts all five reads and a handled failure cannot stop other cache updates", async () => {
  const { port, reads } = fixture();
  let releaseCodex!: (value: Current) => void;
  const pendingCodex = new Promise<Current>((resolve) => { releaseCodex = resolve; });
  const repository = new ConfiguredModelRepository({
    ...port,
    getCurrentConfig: (cli) => cli === "codex" ? pendingCodex : port.getCurrentConfig(cli),
    async readGrokConfigText() { reads.push("failed-grok-text"); throw new Error("only Grok fails"); },
  }, () => undefined);
  const refreshing = refreshAll(repository, "profile");
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(reads, ["failed-grok-text", "current:kimi-code", "current:zcode", "profile:dsh:profile"]);
  assert.equal(repository.getCodexConfigModel("profile"), undefined);
  assert.equal(repository.getGrokConfigModels("profile")?.error, "only Grok fails");
  assert.equal(repository.getKimiCodeConfigModels("profile")?.defaultModel, "kimi-alias");
  assert.ok(repository.getZcodeConfigModels("profile")?.models.length);
  assert.equal(repository.getDshConfigModels("profile")?.defaultModel, DSH_VERIFIED_MODEL_ID);
  releaseCodex({ content: 'model = "late-codex"' });
  await refreshing;
  assert.equal(repository.getCodexConfigModel("profile"), "late-codex");
});

test("Grok execution reads fresh native TOML and obtains its cache identity only after reading", async () => {
  const { repository, state, reads } = fixture();
  await repository.refreshGrokConfigModels("before");
  state.grok = grokText("fresh-grok");
  let activeId = "before";
  state.onRead = () => { activeId = "after"; };
  const model = await repository.resolveGrokModelForRun("missing", () => {
    reads.push(`identity:${activeId}`);
    return activeId;
  });
  assert.equal(model, "fresh-grok");
  assert.equal(repository.getGrokConfigModels("before")?.defaultModel, "grok-alias");
  assert.equal(repository.getGrokConfigModels("after")?.defaultModel, "fresh-grok");
  assert.deepEqual(reads, ["grok-text", "grok-text", "identity:after"]);
});

test("Kimi execution reads fresh content, uses aliases not provider model names, then resolves cache identity", async () => {
  const { repository, current, state, reads } = fixture();
  await repository.refreshKimiCodeConfigModels("before");
  current["kimi-code"] = { content: kimiText("fresh-alias"), configContent: kimiText("wrong-field") };
  let activeId = "before";
  state.onRead = () => { activeId = "after"; };
  assert.equal(await repository.resolveKimiCodeModelForRun(null, () => {
    reads.push(`identity:${activeId}`);
    return activeId;
  }), "fresh-alias");
  assert.equal(repository.getKimiCodeConfigModels("before")?.defaultModel, "kimi-alias");
  assert.equal(repository.getKimiCodeConfigModels("after")?.defaultModel, "fresh-alias");
  assert.deepEqual(reads, ["current:kimi-code", "current:kimi-code", "identity:after"]);
});

test("ZCode execution rereads current content and preserves native wire and late identity", async () => {
  const { repository, current, state, reads } = fixture();
  await repository.refreshZcodeConfigModels("before");
  const content = zcodeText("synthetic-fresh-model");
  current.zcode = { content, configContent: "must not parse" };
  let activeId = "before";
  state.onRead = () => { activeId = "after"; };
  const wire = await repository.resolveZcodeModelWireForRun(null, () => {
    reads.push(`identity:${activeId}`);
    return activeId;
  });
  assert.equal(wire, resolveZcodeModelWireForRun(content, null));
  assert.match(wire, /\/synthetic-fresh-model\$/);
  assert.deepEqual(repository.getZcodeConfigModels("after"), readZcodeConfigModels(content));
  assert.deepEqual(reads, ["current:zcode", "current:zcode", "identity:after"]);
});

test("runtime parse errors keep Grok/Kimi old caches but replace ZCode before throwing", async () => {
  const { repository, current, state, errors } = fixture();
  await refreshAll(repository, "profile");
  const grok = repository.getGrokConfigModels("profile");
  const kimi = repository.getKimiCodeConfigModels("profile");
  let identityReads = 0;
  const identity = () => { identityReads += 1; return "profile"; };
  state.grok = "[";
  current["kimi-code"] = { content: "[" };
  current.zcode = { content: "{" };
  await assert.rejects(repository.resolveGrokModelForRun(null, identity), { message: t("grok.invalidConfig") });
  await assert.rejects(repository.resolveKimiCodeModelForRun(null, identity), { message: t("kimi.invalidConfig") });
  assert.equal(identityReads, 0);
  assert.equal(repository.getGrokConfigModels("profile"), grok);
  assert.equal(repository.getKimiCodeConfigModels("profile"), kimi);
  await assert.rejects(repository.resolveZcodeModelWireForRun(null, identity), { message: "ZCode provider config could not be parsed." });
  assert.equal(identityReads, 1);
  assert.deepEqual(repository.getZcodeConfigModels("profile"), readZcodeConfigModels("{"));
  assert.deepEqual(errors, []);
});

test("runtime empty-model failures preserve their cache-write and error contracts", async () => {
  const { repository, current, state } = fixture();
  await refreshAll(repository, null);
  state.grok = "";
  current["kimi-code"] = { content: "" };
  current.zcode = { content: "" };
  await assert.rejects(repository.resolveGrokModelForRun(null, () => null), { message: t("grok.noConfiguredModels") });
  await assert.rejects(repository.resolveKimiCodeModelForRun(null, () => null), { message: t("kimi.noConfiguredModels") });
  await assert.rejects(repository.resolveZcodeModelWireForRun(null, () => null), { message: "请先在 ZCode provider_config.json 中添加模型。" });
  assert.deepEqual(repository.getGrokConfigModels(null), parseGrokConfigModels(""));
  assert.deepEqual(repository.getKimiCodeConfigModels(null), parseKimiCodeConfigModels(""));
  assert.deepEqual(repository.getZcodeConfigModels(null), readZcodeConfigModels(""));
});

test("runtime missing content keeps Kimi/ZCode content-only reads and DSH empty-profile parsing", async () => {
  const { repository, current, profiles } = fixture();
  current["kimi-code"] = { configContent: kimiText("must-not-use") };
  current.zcode = { configContent: createZcodeExampleText() };
  profiles.set("profile", {});
  await assert.rejects(repository.resolveKimiCodeModelForRun(null, () => null), { message: t("kimi.noConfiguredModels") });
  await assert.rejects(repository.resolveZcodeModelWireForRun(null, () => null), { message: "请先在 ZCode provider_config.json 中添加模型。" });
  await assert.rejects(repository.resolveDshModelForRun(null, "profile"), { message: parseDshConfigModels("").error! });
  assert.deepEqual(repository.getKimiCodeConfigModels(null), parseKimiCodeConfigModels(""));
  assert.deepEqual(repository.getZcodeConfigModels(null), readZcodeConfigModels(""));
  assert.deepEqual(repository.getDshConfigModels("profile"), parseDshConfigModels(""));
});

test("runtime read errors propagate unchanged without identity reads, stale writes or refresh logging", async () => {
  const { repository, state, errors } = fixture();
  await refreshAll(repository, "profile");
  const before = snapshots(repository, "profile");
  const failure = new Error("runtime read error");
  state.failure = failure;
  let identityReads = 0;
  const identity = () => { identityReads += 1; return "profile"; };
  for (const resolving of [
    repository.resolveGrokModelForRun(null, identity),
    repository.resolveKimiCodeModelForRun(null, identity),
    repository.resolveZcodeModelWireForRun(null, identity),
    repository.resolveDshModelForRun(null, "profile"),
    repository.resolveDshModelWireForRun(null, "profile"),
  ]) await assert.rejects(resolving, (error: unknown) => error === failure);
  assert.equal(identityReads, 0);
  assert.deepEqual(snapshots(repository, "profile"), before);
  assert.deepEqual(errors, []);
});

test("DSH execution requires an active existing profile and never falls back to native config or cached models", async () => {
  const { repository, profiles, reads } = fixture();
  await repository.refreshDshConfigModels("profile");
  for (const resolve of [repository.resolveDshModelForRun.bind(repository), repository.resolveDshModelWireForRun.bind(repository)]) {
    const readCount = reads.length;
    await assert.rejects(resolve(null, null), { message: "DSH profile is not active." });
    assert.equal(reads.length, readCount);
    await assert.rejects(resolve(null, "absent"), { message: "DSH profile was not found." });
    profiles.delete("profile");
    await assert.rejects(resolve(null, "profile"), { message: "DSH profile was not found." });
  }
  assert.equal(repository.getDshConfigModels("profile")?.defaultModel, DSH_VERIFIED_MODEL_ID);
  assert.ok(reads.every((source) => source.startsWith("profile:dsh:")));
});

test("DSH fresh profile resolution preserves captured identity, field precedence, wire and exact failures", async () => {
  const { repository, profiles, state, reads } = fixture();
  await repository.refreshDshConfigModels("profile");
  profiles.set("profile", { content: dshText("fresh-dsh"), configContent: dshText("wrong-field") });
  let activeId = "profile";
  state.onRead = () => { activeId = "changed-during-read"; };
  assert.equal(await repository.resolveDshModelForRun(null, activeId), "fresh-dsh");
  assert.equal(repository.getDshConfigModels("profile")?.defaultModel, "fresh-dsh");
  assert.equal(repository.getDshConfigModels(activeId), undefined);
  assert.equal(await repository.resolveDshModelWireForRun("fresh-dsh", "profile"), toDshModelWireValue("fresh-dsh"));
  await assert.rejects(repository.resolveDshModelForRun("removed", "profile"), { message: "DSH has no configured executable model." });
  await assert.rejects(repository.resolveDshModelWireForRun("removed", "profile"), { message: "DSH model selection is not the configured wire value." });
  await assert.rejects(repository.resolveDshModelWireForRun('["other-provider","fresh-dsh"]', "profile"), { message: "DSH model selection is not the configured wire value." });
  profiles.set("profile", { configContent: dshText("legacy-dsh") });
  assert.equal(await repository.resolveDshModelForRun(null, "profile"), "legacy-dsh");
  profiles.set("profile", { content: "{" });
  const expectedError = parseDshConfigModels("{").error!;
  await assert.rejects(repository.resolveDshModelForRun(null, "profile"), { message: expectedError });
  await assert.rejects(repository.resolveDshModelWireForRun(null, "profile"), { message: expectedError });
  assert.equal(repository.getDshConfigModels("profile")?.error, expectedError);
  assert.equal(reads.length, 9);
  assert.ok(reads.every((source) => source === "profile:dsh:profile"));
});
