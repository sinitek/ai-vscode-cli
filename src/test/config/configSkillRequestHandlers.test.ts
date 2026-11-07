import test = require("node:test");
import assert = require("node:assert/strict");
import {
  createConfigSkillRequestHandlers,
  type ConfigSkillRequestInteraction,
  type ConfigSkillRequestServices,
} from "../../webview/configRequestHandlers/skills";
import type { ConfigRequestMessage, ConfigResponseMessage } from "../../webview/configProtocol";

type Handlers = ReturnType<typeof createConfigSkillRequestHandlers>;
type ForwardAction = Exclude<keyof Handlers, "pickAndInstallLocalSkillZip">;
type Call = { method: string; args: unknown[] };

function fixture() {
  const calls: Call[] = [];
  const snapshot = { directory: "/memory/skills", displayDirectory: "~/skills", skills: [] };
  const installation = { identifier: "memory-skill", skills: [{ name: "memory-skill" }], targets: [] };
  const results = {
    getCliSkillsList: snapshot,
    openCliSkillsDirectory: "/memory/skills",
    deleteCliSkill: snapshot,
    copyCliSkill: snapshot,
    searchLobehubSkills: { query: "memory", items: [], currentPage: 2, pageSize: 10, totalCount: 0, totalPages: 0 },
    installLobehubSkill: installation,
    installLocalSkillZipFromPath: installation,
  };
  function spy<Result>(method: string, result: Result) {
    return async (...args: unknown[]): Promise<Result> => {
      calls.push({ method, args });
      return result;
    };
  }
  const services: ConfigSkillRequestServices = {
    getCliSkillsList: spy("getCliSkillsList", results.getCliSkillsList),
    openCliSkillsDirectory: spy("openCliSkillsDirectory", results.openCliSkillsDirectory),
    deleteCliSkill: spy("deleteCliSkill", results.deleteCliSkill),
    copyCliSkill: spy("copyCliSkill", results.copyCliSkill),
    searchLobehubSkills: spy("searchLobehubSkills", results.searchLobehubSkills),
    installLobehubSkill: spy("installLobehubSkill", results.installLobehubSkill),
    installLocalSkillZipFromPath: spy("installLocalSkillZipFromPath", results.installLocalSkillZipFromPath),
  };
  const platforms = ["zcode", "claude", "custom-platform", "zcode"];
  const filePath = "/memory/selected skill.zip";
  const interaction: ConfigSkillRequestInteraction = {
    pickLocalSkillZip: spy("pickLocalSkillZip", filePath),
    pickSkillPlatforms: spy("pickSkillPlatforms", platforms),
  };
  const handlers = createConfigSkillRequestHandlers(services, interaction);
  const response: ConfigResponseMessage = {
    type: "config:response",
    requestId: "response-id",
    success: false,
    error: "owned by transport",
    data: { previous: true },
  };
  return { calls, results, services, interaction, handlers, response, platforms, filePath };
}

const requestBase = { type: "config:request", requestId: "request-id" } as const;
const zipRequest = { ...requestBase, action: "pickAndInstallLocalSkillZip" } as const;
const searchPayload = { query: "  unchanged query  ", page: -2 };
const installPayload = { identifier: " raw/identifier ", platforms: ["zcode", "custom", "claude"] };
const forwardingCases: Array<{ action: ForwardAction; request: ConfigRequestMessage; args: unknown[]; name?: string }> = [
  { action: "getCliSkillsList", request: { ...requestBase, action: "getCliSkillsList", platform: " raw-platform " }, args: [" raw-platform "] },
  { action: "openCliSkillsDirectory", request: { ...requestBase, action: "openCliSkillsDirectory", platform: "custom" }, args: ["custom"] },
  { action: "deleteCliSkill", request: { ...requestBase, action: "deleteCliSkill", platform: "custom", name: " raw name " }, args: ["custom", " raw name "] },
  { action: "copyCliSkill", request: { ...requestBase, action: "copyCliSkill", platform: "zcode", name: " raw name ", targetPlatform: "custom" }, args: ["zcode", " raw name ", "custom"] },
  { action: "searchLobehubSkills", request: { ...requestBase, action: "searchLobehubSkills", payload: searchPayload }, args: [searchPayload] },
  { action: "installLobehubSkill", request: { ...requestBase, action: "installLobehubSkill", payload: installPayload }, args: [installPayload] },
  { action: "searchLobehubSkills", name: "without payload", request: { ...requestBase, action: "searchLobehubSkills" }, args: [undefined] },
  { action: "installLobehubSkill", name: "without payload", request: { ...requestBase, action: "installLobehubSkill" }, args: [undefined] },
];

for (const entry of forwardingCases) {
  test(`${entry.action} forwards arguments and result ${entry.name ?? "unchanged"}`, async () => {
    const { calls, results, handlers, response } = fixture();
    const initial = { ...response };
    const handler = handlers[entry.action] as (request: ConfigRequestMessage, response: ConfigResponseMessage) => Promise<void>;

    assert.equal(await handler(entry.request, response), undefined);

    assert.deepEqual(calls, [{ method: entry.action, args: entry.args }]);
    entry.args.forEach((argument, index) => assert.strictEqual(calls[0].args[index], argument));
    assert.strictEqual(response.data, results[entry.action]);
    assert.deepEqual(response, { ...initial, data: results[entry.action] });
  });

  test(`${entry.action} propagates rejection ${entry.name ?? "unchanged"}`, async () => {
    const { calls, services, handlers, response } = fixture();
    const failure = new Error("service rejected");
    const initial = { ...response };
    services[entry.action] = async (...args: unknown[]): Promise<never> => {
      calls.push({ method: entry.action, args });
      throw failure;
    };
    const handler = handlers[entry.action] as (request: ConfigRequestMessage, response: ConfigResponseMessage) => Promise<void>;

    await assert.rejects(handler(entry.request, response), (error: unknown) => error === failure);

    assert.deepEqual(calls, [{ method: entry.action, args: entry.args }]);
    assert.deepEqual(response, initial);
  });
}

test("factory creates exactly seven plain-object handlers without calling dependencies", () => {
  const { calls, handlers } = fixture();

  assert.strictEqual(Object.getPrototypeOf(handlers), Object.prototype);
  assert.deepEqual(Object.keys(handlers), [
    "getCliSkillsList",
    "openCliSkillsDirectory",
    "deleteCliSkill",
    "copyCliSkill",
    "searchLobehubSkills",
    "installLobehubSkill",
    "pickAndInstallLocalSkillZip",
  ]);
  assert.deepEqual(calls, []);
});

test("ZIP installation forwards the selected path and original platform array in order", async () => {
  const { calls, handlers, response, platforms, filePath, results } = fixture();
  const initial = { ...response };

  assert.equal(await handlers.pickAndInstallLocalSkillZip(zipRequest, response), undefined);

  assert.deepEqual(calls, [
    { method: "pickLocalSkillZip", args: [] },
    { method: "pickSkillPlatforms", args: [] },
    { method: "installLocalSkillZipFromPath", args: [{ platforms }, filePath] },
  ]);
  assert.strictEqual((calls[2].args[0] as { platforms: string[] }).platforms, platforms);
  assert.deepEqual(platforms, ["zcode", "claude", "custom-platform", "zcode"]);
  assert.strictEqual(response.data, results.installLocalSkillZipFromPath);
  assert.deepEqual(response, { ...initial, data: results.installLocalSkillZipFromPath });
});

test("canceling the file picker skips platform selection and installation", async () => {
  const { calls, interaction, handlers, response } = fixture();
  const initial = { ...response };
  interaction.pickLocalSkillZip = async () => {
    calls.push({ method: "pickLocalSkillZip", args: [] });
    return null;
  };

  await handlers.pickAndInstallLocalSkillZip(zipRequest, response);

  assert.deepEqual(calls, [{ method: "pickLocalSkillZip", args: [] }]);
  assert.deepEqual(response, { ...initial, data: null });
});

for (const platforms of [null, []] as Array<string[] | null>) {
  test(`${platforms === null ? "canceling" : "empty selection in"} the platform picker skips installation`, async () => {
    const { calls, interaction, handlers, response } = fixture();
    const initial = { ...response };
    interaction.pickSkillPlatforms = async () => {
      calls.push({ method: "pickSkillPlatforms", args: [] });
      return platforms;
    };

    await handlers.pickAndInstallLocalSkillZip(zipRequest, response);

    assert.deepEqual(calls.map((call) => call.method), ["pickLocalSkillZip", "pickSkillPlatforms"]);
    assert.deepEqual(response, { ...initial, data: null });
  });
}

for (const method of ["pickLocalSkillZip", "pickSkillPlatforms", "installLocalSkillZipFromPath"] as const) {
  test(`ZIP propagates ${method} rejection without running subsequent steps`, async () => {
    const { calls, interaction, services, handlers, response } = fixture();
    const failure = new Error(`${method} rejected`);
    const initial = { ...response };
    const reject = async (...args: unknown[]): Promise<never> => {
      calls.push({ method, args });
      throw failure;
    };
    if (method === "installLocalSkillZipFromPath") {
      services[method] = reject;
    } else {
      interaction[method] = reject;
    }

    await assert.rejects(handlers.pickAndInstallLocalSkillZip(zipRequest, response), (error: unknown) => error === failure);

    const stages = ["pickLocalSkillZip", "pickSkillPlatforms", "installLocalSkillZipFromPath"];
    assert.deepEqual(calls.map((call) => call.method), stages.slice(0, stages.indexOf(method) + 1));
    assert.deepEqual(response, initial);
  });
}

test("ZIP awaits each picker and uses the current installation method", async () => {
  const { calls, interaction, services, handlers, response, platforms, filePath, results } = fixture();
  let resolveFile!: (value: string) => void;
  let resolvePlatforms!: (value: string[]) => void;
  interaction.pickLocalSkillZip = () => {
    calls.push({ method: "pickLocalSkillZip", args: [] });
    return new Promise<string>((resolve) => { resolveFile = resolve; });
  };
  interaction.pickSkillPlatforms = () => {
    calls.push({ method: "pickSkillPlatforms", args: [] });
    return new Promise<string[]>((resolve) => { resolvePlatforms = resolve; });
  };

  const pending = handlers.pickAndInstallLocalSkillZip(zipRequest, response);
  assert.deepEqual(calls.map((call) => call.method), ["pickLocalSkillZip"]);
  resolveFile(filePath);
  await Promise.resolve();
  assert.deepEqual(calls.map((call) => call.method), ["pickLocalSkillZip", "pickSkillPlatforms"]);
  services.installLocalSkillZipFromPath = async (...args) => {
    assert.strictEqual(services.installLocalSkillZipFromPath, replacement);
    calls.push({ method: "replacementInstall", args });
    return results.installLocalSkillZipFromPath;
  };
  const replacement = services.installLocalSkillZipFromPath;
  resolvePlatforms(platforms);
  await pending;

  assert.deepEqual(calls.map((call) => call.method), ["pickLocalSkillZip", "pickSkillPlatforms", "replacementInstall"]);
  assert.strictEqual(response.data, results.installLocalSkillZipFromPath);
});
