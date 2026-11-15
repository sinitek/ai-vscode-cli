import test = require("node:test");
import assert = require("node:assert/strict");
import * as fs from "fs";
import type { ConfigItem } from "../../config/types";
import { resolveDepartmentConfigurationWithHost, type DepartmentConfigurationResolvePort,
  type DepartmentConfiguredRoleRoute } from "../../departmentConfiguration";
import { readDepartmentRoleCandidates, resolveDepartmentOpenCodeDirector } from "../../extensionHost/departmentConfigurationHost";
import { buildSystemLoopPlusAcceptancePlanSnapshot } from "../../loopPlusAcceptancePlan";
import { applyModelArg, readModelArg } from "../../cli/modelArgs";
import { createOpenCodeRuntimeConfigOverlay } from "../../cli/opencoderuntimeconfig";
import { fingerprintDepartmentExecutionSelection, type DepartmentExecutionSelection } from "../../runtime/departmentexecutionidentity";

function content(model: string | null = "p/default") {
  return JSON.stringify({ ...(model ? { model } : {}), provider: { p: { npm: "@ai-sdk/openai-compatible", models: {
    default: { variants: { custom: {}, disabled: { disabled: true } } }, chosen: {}, other: {},
  } } } });
}
function fixture() {
  const profiles: Record<string, ConfigItem> = Object.fromEntries(["director", "leader", "employee"].map(id => [id,
    { id, name: id, platform: "opencode", content: content(), createdAt: 1, updatedAt: 1 }]));
  const route = (id: string): DepartmentConfiguredRoleRoute => ({ cli: "opencode", configId: id, model: null, thinkingMode: null, openCodeVariant: null });
  const preferences = { leader: route("leader"), employee: route("employee") };
  const state = { scope: "workspace:target:1", issue: null as string | null, revision: "revision-1" };
  const readPort = { getConfigs: async () => Object.values(profiles),
    getConfig: async (_cli: string, id: string) => profiles[id] ?? null,
    getStoredModels: () => [], normalizeThinkingMode: (_cli: string, mode: import("../../cli/types").ThinkingMode) => mode,
    getRevision: async () => state.revision };
  const port: DepartmentConfigurationResolvePort = { getDirector: () => resolveDepartmentOpenCodeDirector("director", profiles.director.content!, null, () => null),
    getScope: () => state.scope, getReadinessIssue: () => state.issue, getPreferences: () => preferences,
    getCandidates: (cli, id) => readDepartmentRoleCandidates(cli, id, readPort),
    getLimits: () => ({ maxLeaders: 1, maxEmployees: 1 }), getAcceptancePlan: buildSystemLoopPlusAcceptancePlanSnapshot };
  return { profiles, preferences, state, readPort, port };
}

test("all three OpenCode defaults freeze exact-profile models without changing saved preferences or old snapshots", async () => {
  const h = fixture();
  h.profiles.leader.content = content("p/chosen"); h.profiles.employee.content = content("p/other");
  const snapshot = await resolveDepartmentConfigurationWithHost(h.port);
  assert.deepEqual(Object.values(snapshot.routes).map(route => route.model), ["p/default", "p/chosen", "p/other"]);
  assert.equal(h.preferences.leader.model, null); assert.equal(h.preferences.employee.model, null);
  assert.equal("sourceRevision" in snapshot.routes.leader, false, "read revision is not execution authority");
  h.profiles.leader.content = content("p/default"); h.state.revision = "revision-2";
  assert.equal(snapshot.routes.leader.model, "p/chosen", "running root never re-resolves a default");
  assert.equal((await resolveDepartmentConfigurationWithHost(h.port)).routes.leader.model, "p/default");
});

test("three-role resolved selection feeds real argv/overlay builders and fixed Owner fingerprints consistently", async () => {
  const h = fixture(); h.preferences.leader.openCodeVariant = "custom";
  const snapshot = await resolveDepartmentConfigurationWithHost(h.port);
  for (const role of ["director", "leader", "employee"] as const) {
    const route = snapshot.routes[role], configContent = h.profiles[role].content!;
    const selection: DepartmentExecutionSelection = { version: 1, cli: "opencode", role: role === "employee" ? "employee" : "leader",
      configId: route.configId!, revision: h.state.revision, model: route.model!, thinkingMode: route.thinkingMode ?? null,
      openCodeVariant: route.openCodeVariant ?? null };
    const argv = applyModelArg("opencode", ["run", "--model", "p/other"], selection.model, { openCodeConfigContent: configContent });
    assert.equal(readModelArg("opencode", argv), route.model);
    const built = createOpenCodeRuntimeConfigOverlay({ configContent, primaryModel: selection.model!, smallModel: null,
      primaryVariant: selection.openCodeVariant });
    assert.ok(built.ok && built.overlay);
    try {
      const actual = JSON.parse(fs.readFileSync(built.overlay.configPath, "utf8"));
      assert.equal(actual.model, selection.model);
      assert.deepEqual(fingerprintDepartmentExecutionSelection(selection), fingerprintDepartmentExecutionSelection({ ...selection, model: actual.model }));
      assert.notDeepEqual(fingerprintDepartmentExecutionSelection(selection), fingerprintDepartmentExecutionSelection({ ...selection, model: null }));
    } finally { assert.equal(built.overlay.cleanup().status, "confirmed"); }
  }
});

test("explicit OpenCode models and variants remain explicit; Codex default remains absent in the execution route", async () => {
  const h = fixture(); h.preferences.leader.model = "p/chosen";
  h.port.getDirector = () => ({ cli: "codex", configId: "director", model: null, thinkingMode: "high", openCodeVariant: null });
  h.profiles.director = { ...h.profiles.director, platform: "codex", configContent: 'model="gpt-local"' };
  const snapshot = await resolveDepartmentConfigurationWithHost(h.port);
  assert.equal(snapshot.routes.director.model, undefined); assert.equal(snapshot.routes.director.thinkingMode, "high");
  assert.equal(snapshot.routes.leader.model, "p/chosen"); assert.equal(h.preferences.leader.model, "p/chosen");
});

test("missing, malformed, unavailable defaults and cross-profile/CLI reads fail closed", async () => {
  for (const invalid of [content(null), content("bad-ref"), content("p/missing"), "{invalid",
    JSON.stringify({ model: "p/default", disabled_providers: ["p"], provider: { p: { models: { default: {} } } } })]) {
    const h = fixture(); h.profiles.leader.content = invalid;
    await assert.rejects(resolveDepartmentConfigurationWithHost(h.port));
  }
  const h = fixture();
  for (const profile of [h.profiles.employee, { ...h.profiles.leader, platform: "codex" as const }]) {
    await assert.rejects(readDepartmentRoleCandidates("opencode", "leader", { ...h.readPort, getConfig: async () => profile }), /读取所选 CLI 档案失败/);
  }
});

test("default variants are checked against the exact effective model and OpenCode effort is not invented", async () => {
  for (const change of [(h: ReturnType<typeof fixture>) => { h.preferences.leader.openCodeVariant = "disabled"; },
    (h: ReturnType<typeof fixture>) => { h.preferences.leader.openCodeVariant = "unknown"; },
    (h: ReturnType<typeof fixture>) => { h.preferences.leader.thinkingMode = "high"; },
    (h: ReturnType<typeof fixture>) => { h.preferences.leader.model = "p/chosen"; h.preferences.leader.openCodeVariant = "custom"; }]) {
    const h = fixture(); change(h); await assert.rejects(resolveDepartmentConfigurationWithHost(h.port), /变体|思考力度/);
  }
});

test("a deterministic read latch rejects scope, preference, barrier, content and same-model revision drift", async () => {
  for (const kind of ["scope", "preference", "barrier", "content", "revision"] as const) {
    const h = fixture(); let release!: () => void, entered!: () => void;
    const latch = new Promise<void>(resolve => release = resolve), ready = new Promise<void>(resolve => entered = resolve);
    let reads = 0;
    h.port.getDirector = async () => {
      if (++reads === 2) { entered(); await latch; }
      return resolveDepartmentOpenCodeDirector("director", h.profiles.director.content!, null, () => null);
    };
    const pending = resolveDepartmentConfigurationWithHost(h.port); await ready;
    if (kind === "scope") h.state.scope = "workspace:target:3";
    if (kind === "preference") h.preferences.leader.model = "p/chosen";
    if (kind === "barrier") h.state.issue = "角色配置正在保存";
    if (kind === "content") h.profiles.leader.content = h.profiles.leader.content!.replace("@ai-sdk/openai-compatible", "changed-provider");
    if (kind === "revision") h.state.revision = "revision-3";
    release(); await assert.rejects(pending, /变化|正在保存/);
  }
});

test("a selection revision changed inside the exact profile read is rejected before candidates escape", async () => {
  const h = fixture();
  await assert.rejects(readDepartmentRoleCandidates("opencode", "leader", { ...h.readPort,
    getConfig: async () => { h.state.revision = "new-revision"; return h.profiles.leader; } }), /配置修订.*变化/);
});
