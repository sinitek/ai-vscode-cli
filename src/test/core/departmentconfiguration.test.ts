import test = require("node:test");
import assert = require("node:assert/strict");
import { normalizeDepartmentRolePreference, resolveDepartmentConfiguration, resolveDepartmentConfigurationWithHost,
  validateDepartmentRoleCandidate, normalizeDepartmentConfigurationSnapshot, type DepartmentRolePreferences, type DepartmentRoleCandidates } from "../../departmentConfiguration";
import { buildSystemLoopPlusAcceptancePlanSnapshot, type LoopPlusAcceptancePlanSnapshot } from "../../loopPlusAcceptancePlan";
import { readDepartmentRoleCandidates } from "../../extensionHost/departmentConfigurationHost";

const preferences: DepartmentRolePreferences = {
  leader: { cli: "codex", configId: "codex-profile", model: null, thinkingMode: "high", openCodeVariant: null },
  employee: { cli: "opencode", configId: "open-profile", model: "provider/model", thinkingMode: null, openCodeVariant: "high" },
};

test("resolves department role routes, limits and acceptance snapshot without materializing a default model", () => {
  const acceptance: LoopPlusAcceptancePlanSnapshot = { id: "plan", name: "统一方案", checks: ["security"], otherText: "", systemDefault: false };
  const result = resolveDepartmentConfiguration(
    { cli: "codex", configId: "director-profile", model: "gpt-5" },
    preferences,
    {
      hasConfig: (_cli, id) => Boolean(id),
      hasModel: (_cli, _id, model) => model === null || Boolean(model),
      supportsThinkingMode: () => true,
      supportsOpenCodeVariant: () => true,
      getLimits: () => ({ maxLeaders: 4, maxEmployees: 20 }),
      getAcceptancePlan: () => acceptance,
    },
  );
  assert.deepEqual(result.routes.leader, {
    cli: "codex", configId: "codex-profile", thinkingMode: "high",
  });
  assert.equal(result.routes.leader.model, undefined);
  assert.deepEqual(result.routes.employee, {
    cli: "opencode", configId: "open-profile", model: "provider/model", openCodeVariant: "high",
  });
  assert.deepEqual(result.limits, { maxLeaders: 4, maxEmployees: 20 });
  assert.deepEqual(result.loopPlusAcceptancePlan, acceptance);
  assert.notEqual(result.loopPlusAcceptancePlan, acceptance);
  acceptance.checks.push("performance");
  assert.deepEqual(result.loopPlusAcceptancePlan.checks, ["security"]);
});

test("rejects stale profiles and incompatible role capabilities with Chinese errors", () => {
  assert.throws(() => resolveDepartmentConfiguration(
    { cli: "codex", configId: "director-profile" }, preferences,
    { hasConfig: (_cli, id) => id !== "codex-profile", hasModel: () => true,
      supportsThinkingMode: () => true, supportsOpenCodeVariant: () => true,
      getLimits: () => ({ maxLeaders: 4, maxEmployees: 20 }), getAcceptancePlan: buildSystemLoopPlusAcceptancePlanSnapshot },
  ), /组长所选 CLI 档案已失效/);
  assert.throws(() => resolveDepartmentConfiguration(
    { cli: "codex", configId: "director-profile" }, preferences,
    { hasConfig: () => true, hasModel: () => true, supportsThinkingMode: () => false,
      supportsOpenCodeVariant: () => true, getLimits: () => ({ maxLeaders: 4, maxEmployees: 20 }),
      getAcceptancePlan: buildSystemLoopPlusAcceptancePlanSnapshot },
  ), /思考力度不适用于当前模型/);
});

test("role normalization rejects coerced thinking values and distinguishes missing from explicit default", () => {
  for (const thinkingMode of [["high"], { toString: () => "high" }, true, 1, undefined]) {
    assert.equal(normalizeDepartmentRolePreference({ ...preferences.leader, thinkingMode }), null);
  }
  assert.equal(normalizeDepartmentRolePreference({ ...preferences.leader, model: undefined }), null);
  assert.equal(normalizeDepartmentRolePreference({ ...preferences.leader, model: " " }), null);
  assert.equal(normalizeDepartmentRolePreference(preferences.leader)?.model, null);
});

test("director model, effort and variant are validated using its own CLI and profile", () => {
  const base = { hasConfig: () => true, hasModel: () => true, supportsThinkingMode: () => true,
    supportsOpenCodeVariant: () => true, getLimits: () => ({ maxLeaders: 4, maxEmployees: 20 }), getAcceptancePlan: buildSystemLoopPlusAcceptancePlanSnapshot };
  for (const field of ["hasModel", "supportsThinkingMode", "supportsOpenCodeVariant"] as const) {
    assert.throws(() => resolveDepartmentConfiguration({ cli: "codex", configId: "director-profile", model: "gpt-5", thinkingMode: "high" }, preferences,
      { ...base, [field]: (cli: string, ...rest: unknown[]) => cli !== "codex" }), /总监/);
  }
  const scopes: unknown[] = [];
  resolveDepartmentConfiguration({ cli: "codex", configId: "director-profile", model: "gpt-5" }, preferences,
    { ...base, supportsThinkingMode: (cli, model, mode, id) => { scopes.push([cli, id]); return true; } });
  assert.deepEqual(scopes, [["codex", "director-profile"], ["codex", "codex-profile"], ["opencode", "open-profile"]]);
});

function candidates(cli: DepartmentRoleCandidates["cli"], configId: string | null): DepartmentRoleCandidates {
  return { cli, configId, configs: configId ? [{ id: configId, name: configId }] : [], models: ["model"],
    defaultModel: "model", supportsDefaultModel: true, thinkingByModel: { model: ["high"] }, variantsByModel: { model: ["high"] } };
}

test("exact-profile candidates reject cross-profile data and unsupported defaults", () => {
  const route = { ...preferences.leader, model: null };
  assert.throws(() => validateDepartmentRoleCandidate(route, candidates("codex", "other")), /档案已失效/);
  assert.throws(() => validateDepartmentRoleCandidate(route, { ...candidates("codex", route.configId), supportsDefaultModel: false }), /默认模型/);
});

test("all Loop CLI routes resolve for director, leader and employee without an execution whitelist", async () => {
  const { CLI_LIST } = await import("../../cli/types");
  for (const cli of CLI_LIST) {
    const role = { cli, configId: "profile", model: "model", thinkingMode: null, openCodeVariant: null };
    const snapshot = await resolveDepartmentConfigurationWithHost({ getDirector: () => role,
      getPreferences: () => ({ leader: role, employee: role }),
      getCandidates: async (candidateCli, id) => candidates(candidateCli, id),
      getLimits: () => ({ maxLeaders: 4, maxEmployees: 20 }), getAcceptancePlan: buildSystemLoopPlusAcceptancePlanSnapshot });
    for (const key of ["director", "leader", "employee"] as const) assert.equal(snapshot.routes[key].cli, cli);
  }
});

test("trusted host resolver captures independent route, limits and plan snapshots and storage shape", async () => {
  const director = { ...preferences.leader, cli: "codex" as const, configId: "director", model: "model" };
  const roles: DepartmentRolePreferences = { leader: { ...preferences.leader, model: null }, employee: { ...preferences.employee, model: "model" } };
  const limits = { maxLeaders: 4, maxEmployees: 20 };
  const plan = buildSystemLoopPlusAcceptancePlanSnapshot();
  const port = { getDirector: () => director, getPreferences: () => roles, getCandidates: async (cli: DepartmentRoleCandidates["cli"], id: string | null) => candidates(cli, id),
    getLimits: () => limits, getAcceptancePlan: () => plan };
  const snapshot = await resolveDepartmentConfigurationWithHost(port);
  roles.leader.model = "later"; limits.maxEmployees = 999; plan.checks.push("security");
  assert.equal(snapshot.routes.leader.model, undefined);
  assert.equal(snapshot.limits.maxEmployees, 20);
  assert.deepEqual(snapshot.loopPlusAcceptancePlan.checks, []);
  assert.deepEqual(normalizeDepartmentConfigurationSnapshot(JSON.parse(JSON.stringify(snapshot))), snapshot);
  assert.equal(normalizeDepartmentConfigurationSnapshot({ ...snapshot, limits: { maxLeaders: 0, maxEmployees: 20 } }), null);
  await assert.rejects(resolveDepartmentConfigurationWithHost({ ...port, getPreferences: () => ({}) }), /请先完成组长和员工/);
});

test("saved profile candidates read exact CLI/profile without activating or leaking credentials", async () => {
  const content = { a: 'default_model = "one"\n[models.one]\nmodel="one"\ncapabilities=["thinking"]\nsupport_efforts=["high"]\n[providers.api]\napi_key="PRIVATE"',
    b: 'default_model = "two"\n[models.two]\nmodel="two"\ncapabilities=["thinking"]\nsupport_efforts=["low"]' };
  const reads: string[] = [];
  const profiles = Object.entries(content).map(([id, configContent]) => ({ id, platform: "kimi-code" as const, name: id, configContent, createdAt: 1, updatedAt: 1 }));
  const port = { getConfigs: async () => profiles, getConfig: async (_cli: string, id: string) => { reads.push(id); return profiles.find((profile) => profile.id === id) ?? null; },
    getStoredModels: () => ["unrelated"], normalizeThinkingMode: (_cli: string, mode: import("../../cli/types").ThinkingMode) => mode };
  const a = await readDepartmentRoleCandidates("kimi-code", "a", port);
  const b = await readDepartmentRoleCandidates("kimi-code", "b", port);
  assert.deepEqual(a.models, ["one"]); assert.deepEqual(a.thinkingByModel.one, ["high"]);
  assert.deepEqual(b.models, ["two"]); assert.deepEqual(b.thinkingByModel.two, ["low"]);
  assert.deepEqual(reads, ["a", "b"]); assert.equal(JSON.stringify(a).includes("PRIVATE"), false);
});

test("saved candidate efforts match model selector semantics instead of legacy thinking switches", async () => {
  const codex = { id: "codex", platform: "codex" as const, name: "codex", configContent: 'model="model"', createdAt: 1, updatedAt: 1 };
  const kimi = { id: "kimi", platform: "kimi-code" as const, name: "kimi", configContent: 'default_model="model"\n[models.model]\nmodel="model"\ncapabilities=["thinking"]', createdAt: 1, updatedAt: 1 };
  const port = { getConfigs: async () => [codex, kimi], getConfig: async (_cli: string, id: string) => id === "codex" ? codex : kimi,
    getStoredModels: () => [], normalizeThinkingMode: (_cli: string, mode: import("../../cli/types").ThinkingMode) => mode };
  const codexCandidates = await readDepartmentRoleCandidates("codex", "codex", port);
  assert.deepEqual(codexCandidates.thinkingByModel.model, ["low", "medium", "high", "xhigh", "max", "ultra"]);
  const kimiCandidates = await readDepartmentRoleCandidates("kimi-code", "kimi", port);
  assert.deepEqual(kimiCandidates.thinkingByModel.model, [], "missing explicit support_efforts means inherit, never invent on/off effort choices");
});

test("Claude remains valid for director while supported execution roles use their own CLI capabilities", async () => {
  const config = { id: "claude", platform: "claude" as const, name: "Claude", configContent: "{}", createdAt: 1, updatedAt: 1 };
  const choices = await readDepartmentRoleCandidates("claude", "claude", {
    getConfigs: async () => [config], getConfig: async () => config, getStoredModels: () => ["model"], normalizeThinkingMode: (_cli, mode) => mode,
  });
  assert.ok(choices.thinkingByModel.model.includes("off"));
  const director = { cli: "claude" as const, configId: "claude", model: "model", thinkingMode: "off" as const, openCodeVariant: null };
  const execution = { cli: "codex" as const, configId: "codex", model: "model", thinkingMode: "high" as const, openCodeVariant: null };
  const snapshot = await resolveDepartmentConfigurationWithHost({ getDirector: () => director,
    getPreferences: () => ({ leader: execution, employee: execution }),
    getCandidates: async (cli, id) => cli === "claude" ? choices : candidates(cli, id),
    getLimits: () => ({ maxLeaders: 4, maxEmployees: 20 }), getAcceptancePlan: buildSystemLoopPlusAcceptancePlanSnapshot });
  assert.equal(snapshot.routes.director.thinkingMode, "off");
  assert.equal(snapshot.routes.employee.thinkingMode, "high");
});

test("host resolution rejects cross-workspace and ABA generation changes even with identical choices", async () => {
  for (const phase of ["director", "candidates"] as const) {
    let scope = "workspace-a:1";
    const director = { cli: "codex" as const, configId: "director", model: "model", thinkingMode: null, openCodeVariant: null };
    await assert.rejects(resolveDepartmentConfigurationWithHost({ getScope: () => scope,
      getDirector: async () => { if (phase === "director") scope = "workspace-a:3"; return director; },
      getPreferences: () => ({ leader: director, employee: director }),
      getCandidates: async (cli, id) => { scope = "workspace-a:3"; return candidates(cli, id); },
      getLimits: () => ({ maxLeaders: 4, maxEmployees: 20 }), getAcceptancePlan: buildSystemLoopPlusAcceptancePlanSnapshot,
    }), /工作区或配置作用域已变化/);
  }
});

test("new department roots require current active role profiles and reject identity drift during candidate awaits", async () => {
  const director = { cli: "codex" as const, configId: "director", model: "model", thinkingMode: null, openCodeVariant: null };
  const roles: DepartmentRolePreferences = {
    leader: { cli: "opencode", configId: "open-active", model: "model", thinkingMode: null, openCodeVariant: null },
    employee: { cli: "codex", configId: "director", model: null, thinkingMode: null, openCodeVariant: null },
  };
  const active: Record<string, string | null> = { codex: "director", opencode: "open-active" };
  const port = { getDirector: () => director, getActiveConfigIdForCli: (cli: DepartmentRoleCandidates["cli"]) => active[cli],
    getPreferences: () => roles, getCandidates: async (cli: DepartmentRoleCandidates["cli"], id: string | null) => candidates(cli, id),
    getLimits: () => ({ maxLeaders: 4, maxEmployees: 20 }), getAcceptancePlan: buildSystemLoopPlusAcceptancePlanSnapshot };
  const frozen = await resolveDepartmentConfigurationWithHost(port);
  assert.deepEqual(frozen.routes.leader, { cli: "opencode", configId: "open-active", model: "model" });

  roles.leader.configId = "open-saved-but-inactive";
  await assert.rejects(resolveDepartmentConfigurationWithHost(port), /组长角色未绑定当前 CLI 激活档案/);
  roles.leader.configId = "open-active";
  port.getCandidates = async (cli, id) => {
    if (cli === "opencode") active.opencode = "open-replaced";
    return candidates(cli, id);
  };
  await assert.rejects(resolveDepartmentConfigurationWithHost(port), /激活档案在加载期间发生变化/);
});

test("new roots reject target A-to-B-to-A and same-id shared-selection revisions", async () => {
  const director = { cli: "codex" as const, configId: "director", model: "model", thinkingMode: null, openCodeVariant: null };
  const roles: DepartmentRolePreferences = {
    leader: { cli: "opencode", configId: "target", model: "model", thinkingMode: null, openCodeVariant: null },
    employee: { cli: "codex", configId: "director", model: null, thinkingMode: null, openCodeVariant: null },
  };
  let activeTarget: string | null = "target";
  let revision = "a";
  let mutate: (() => void) | null = null;
  const port = {
    getDirector: () => director,
    getActiveConfigIdForCli: (cli: DepartmentRoleCandidates["cli"]) => cli === "opencode" ? activeTarget : "director",
    readConfigBinding: async (cli: DepartmentRoleCandidates["cli"]) => ({
      configId: cli === "opencode" ? activeTarget : "director", revision: cli === "opencode" ? revision : "director-r", ready: true,
    }),
    getPreferences: () => roles,
    getCandidates: async (cli: DepartmentRoleCandidates["cli"], id: string | null) => {
      if (cli === "opencode") mutate?.();
      return candidates(cli, id);
    },
    getLimits: () => ({ maxLeaders: 4, maxEmployees: 20 }),
    getAcceptancePlan: buildSystemLoopPlusAcceptancePlanSnapshot,
  };
  assert.equal((await resolveDepartmentConfigurationWithHost(port)).routes.leader.configId, "target");
  mutate = () => { activeTarget = "temporary"; revision = "b"; activeTarget = "target"; revision = "c"; };
  await assert.rejects(resolveDepartmentConfigurationWithHost(port), /修订或激活状态已变化/);
  mutate = () => { revision = revision === "c" ? "d" : "e"; };
  await assert.rejects(resolveDepartmentConfigurationWithHost(port), /修订或激活状态已变化/);
});

test("new root rejects missing and not-ready shared activation selections", async () => {
  const director = { cli: "codex" as const, configId: "director", model: "model", thinkingMode: null, openCodeVariant: null };
  const port = {
    getDirector: () => director,
    getPreferences: () => ({ leader: { ...preferences.leader, cli: "opencode" as const, configId: "target", model: "model" },
      employee: { ...preferences.leader, cli: "codex" as const, configId: "director", model: null } }),
    getActiveConfigIdForCli: (cli: DepartmentRoleCandidates["cli"]) => cli === "opencode" ? "target" : "director",
    getCandidates: async (cli: DepartmentRoleCandidates["cli"], id: string | null) => candidates(cli, id),
    getLimits: () => ({ maxLeaders: 4, maxEmployees: 20 }),
    getAcceptancePlan: buildSystemLoopPlusAcceptancePlanSnapshot,
  };
  await assert.rejects(resolveDepartmentConfigurationWithHost({ ...port, readConfigBinding: async () => null }), /尚未就绪/);
  await assert.rejects(resolveDepartmentConfigurationWithHost({ ...port, readConfigBinding: async (cli) => ({
    configId: cli === "opencode" ? "target" : "director", revision: "r", ready: false,
  }) }), /尚未就绪/);
});

test("new root rejects a late local mode or model selection context change", async () => {
  const director = { cli: "codex" as const, configId: "director", model: "model", thinkingMode: null, openCodeVariant: null };
  let selectionRevision = 0;
  const port = {
    getScope: () => "workspace:director",
    getSelectionContextRevision: () => selectionRevision,
    getDirector: () => director,
    getPreferences: () => ({ leader: { ...preferences.leader, cli: "codex" as const, configId: "director", model: null },
      employee: { ...preferences.employee, cli: "codex" as const, configId: "director" } }),
    getActiveConfigIdForCli: () => "director",
    readConfigBinding: async () => ({ configId: "director", revision: "stable", ready: true }),
    getCandidates: async (cli: DepartmentRoleCandidates["cli"], id: string | null) => {
      selectionRevision += 1;
      return candidates(cli, id);
    },
    getLimits: () => ({ maxLeaders: 4, maxEmployees: 20 }),
    getAcceptancePlan: buildSystemLoopPlusAcceptancePlanSnapshot,
  };
  await assert.rejects(resolveDepartmentConfigurationWithHost(port), /CLI、模式或模型选择已变化/);
});

test("host save barrier serializes a role and isolates failures by workspace/director scope", async () => {
  const { DepartmentConfigurationSaveBarrier } = await import("../../departmentConfiguration");
  const barrier = new DepartmentConfigurationSaveBarrier();
  const finish = barrier.begin("a:1", "leader");
  assert.throws(() => barrier.begin("a:1", "leader"), /正在保存/);
  assert.match(barrier.issue("a:1")!, /正在保存/); assert.equal(barrier.issue("a:3"), null);
  const employee = barrier.begin("a:1", "employee");
  finish(false); assert.match(barrier.issue("a:1")!, /正在保存/);
  employee(true); assert.match(barrier.issue("a:1")!, /保存失败/);
  barrier.begin("a:1", "leader")(true); assert.equal(barrier.issue("a:1"), null);
});
