import test = require("node:test");
import assert = require("node:assert/strict");
import { CLI_LIST } from "../../cli/types";
import type { ConfigItem, ConfigOrder, CopyConfigPayload, ApplyPayload } from "../../config/types";
import type { ConfigRequestPayload, ConfigResponseMessage } from "../../webview/configProtocol";
import {
  createConfigProfileRequestHandlers,
  type ConfigProfileRequestHost,
  type ConfigProfileRequestServices,
} from "../../webview/configRequestHandlers/profiles";

type Handlers = ReturnType<typeof createConfigProfileRequestHandlers>;
type Call = { service: keyof ConfigProfileRequestServices; args: unknown[] };

const platform = "gemini";
const config: ConfigItem = {
  id: "input-id", name: "Input profile", platform, createdAt: 1, updatedAt: 2,
};
const copied: ConfigItem = { ...config, id: "copied-id", platform: "codex" };
const defaultConfig: ConfigItem = { ...config, id: "default-id" };
const list = [config];
const order: ConfigOrder = { gemini: [config.id] };
const current = { content: "runtime content", authContent: "runtime auth", activeConfigId: "stale-service-id" };
const backups = ["backup-one", "backup-two"];
const copyPayload: CopyConfigPayload = {
  sourcePlatform: platform, sourceId: config.id, targetPlatform: "codex", name: "Copy name",
};
const applyPayload: ApplyPayload = { profileId: config.id, content: "apply content" };

function request<Payload extends ConfigRequestPayload>(payload: Payload) {
  return { ...payload, type: "config:request" as const, requestId: "request-id" };
}

function response(): ConfigResponseMessage {
  return {
    type: "config:response", requestId: "response-id", success: false,
    error: "existing error", data: "previous data",
  };
}

function fixture() {
  const calls: Call[] = [];
  function stub<Result>(service: keyof ConfigProfileRequestServices, result: Result) {
    return async (...args: unknown[]) => {
      calls.push({ service, args });
      return result;
    };
  }
  const services: ConfigProfileRequestServices = {
    getConfigList: stub("getConfigList", list),
    getConfigOrder: stub("getConfigOrder", order),
    setConfigOrder: stub("setConfigOrder", undefined),
    getConfigById: stub("getConfigById", config),
    saveConfig: stub("saveConfig", undefined),
    copyConfig: stub("copyConfig", copied),
    deleteConfig: stub("deleteConfig", undefined),
    getCurrentConfig: stub("getCurrentConfig", current),
    applyConfig: stub("applyConfig", undefined),
    backupConfig: stub("backupConfig", backups),
    getBackupList: stub("getBackupList", backups),
    initDefaultConfig: stub("initDefaultConfig", defaultConfig),
  };
  return { services, calls };
}

type ProfileCase = {
  action: keyof Handlers;
  service: keyof ConfigProfileRequestServices;
  args: unknown[];
  result: unknown;
  writes: boolean;
  invoke: (handlers: Handlers, result: ConfigResponseMessage) => Promise<void>;
};

const cases: ProfileCase[] = [
  {
    action: "getList", service: "getConfigList", args: [platform], result: list, writes: false,
    invoke: (handlers, result) => handlers.getList(request({ action: "getList", platform }), result),
  },
  {
    action: "getOrder", service: "getConfigOrder", args: [platform], result: order, writes: false,
    invoke: (handlers, result) => handlers.getOrder(request({ action: "getOrder", platform }), result),
  },
  {
    action: "setOrder", service: "setConfigOrder", args: [platform, order], result: true, writes: true,
    invoke: (handlers, result) => handlers.setOrder(request({ action: "setOrder", platform, order }), result),
  },
  {
    action: "getById", service: "getConfigById", args: [platform, config.id], result: config, writes: false,
    invoke: (handlers, result) => handlers.getById(request({ action: "getById", platform, id: config.id }), result),
  },
  {
    action: "save", service: "saveConfig", args: [config], result: config, writes: true,
    invoke: (handlers, result) => handlers.save(request({ action: "save", config }), result),
  },
  {
    action: "copy", service: "copyConfig", args: [copyPayload], result: copied, writes: true,
    invoke: (handlers, result) => handlers.copy(request({ action: "copy", payload: copyPayload }), result),
  },
  {
    action: "delete", service: "deleteConfig", args: [platform, config.id], result: true, writes: true,
    invoke: (handlers, result) => handlers.delete(request({ action: "delete", platform, id: config.id }), result),
  },
  {
    action: "getCurrent", service: "getCurrentConfig", args: [platform],
    result: { ...current, activeConfigId: null }, writes: false,
    invoke: (handlers, result) => handlers.getCurrent(request({ action: "getCurrent", platform }), result),
  },
  {
    action: "apply", service: "applyConfig", args: [platform, applyPayload], result: undefined, writes: true,
    invoke: (handlers, result) => handlers.apply(request({ action: "apply", platform, payload: applyPayload }), result),
  },
  {
    action: "backup", service: "backupConfig", args: [platform], result: backups, writes: false,
    invoke: (handlers, result) => handlers.backup(request({ action: "backup", platform }), result),
  },
  {
    action: "getBackups", service: "getBackupList", args: [platform], result: backups, writes: false,
    invoke: (handlers, result) => handlers.getBackups(request({ action: "getBackups", platform }), result),
  },
  {
    action: "initDefault", service: "initDefaultConfig", args: [platform], result: defaultConfig, writes: true,
    invoke: (handlers, result) => handlers.initDefault(request({ action: "initDefault", platform }), result),
  },
];

test("profile command table has exactly twelve own handlers", () => {
  const { services } = fixture();
  const handlers = createConfigProfileRequestHandlers(services);
  assert.equal(Object.getPrototypeOf(handlers), Object.prototype);
  assert.deepEqual(Reflect.ownKeys(handlers), cases.map((entry) => entry.action));
});

for (const entry of cases) {
  test(`${entry.action} preserves service arguments, results and notification policy`, async () => {
    const { services, calls } = fixture();
    const result = response();
    let notifications = 0;
    const handlers = createConfigProfileRequestHandlers(services, {
      onConfigChanged: () => {
        notifications += 1;
        assert.strictEqual(result.data, entry.result);
        assert.equal(calls.length, 1);
      },
    });
    assert.equal(await entry.invoke(handlers, result), undefined);
    assert.deepEqual(calls, [{ service: entry.service, args: entry.args }]);
    entry.args.forEach((argument, index) => assert.strictEqual(calls[0].args[index], argument));
    if (entry.action === "getCurrent") {
      assert.deepEqual(result.data, entry.result);
      assert.equal(current.activeConfigId, "stale-service-id");
    } else {
      assert.strictEqual(result.data, entry.result);
    }
    assert.equal(notifications, entry.writes ? 1 : 0);
    assert.deepEqual({ ...result, data: "previous data" }, response());
  });

  test(`${entry.action} propagates service rejection without notifying or changing response`, async () => {
    const { services } = fixture();
    const result = response();
    const failure = new Error(`${entry.service} rejected`);
    let calls = 0;
    services[entry.service] = async () => { calls += 1; throw failure; };
    const handlers = createConfigProfileRequestHandlers(services, {
      onConfigChanged: () => assert.fail("failed service must not notify"),
      getActiveConfigId: async () => assert.fail("failed current read must not call host"),
    });
    await assert.rejects(entry.invoke(handlers, result), (error) => error === failure);
    assert.equal(calls, 1);
    assert.deepEqual(result, response());
  });

  test(`${entry.action} reads the current injected service method on every call`, async () => {
    const { services, calls } = fixture();
    const handlers = createConfigProfileRequestHandlers(services);
    await entry.invoke(handlers, response());
    const failure = new Error("replacement service");
    services[entry.service] = async () => { throw failure; };
    await assert.rejects(entry.invoke(handlers, response()), (error) => error === failure);
    assert.equal(calls.length, 1);
  });
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}

for (const entry of cases.filter((candidate) => candidate.writes)) {
  test(`${entry.action} awaits the service then data assignment then async notification`, async () => {
    const { services } = fixture();
    const result = response();
    const serviceGate = deferred();
    const notificationGate = deferred();
    const notificationStarted = deferred();
    const events: string[] = [];
    const service = services[entry.service];
    Object.assign(services, {
      [entry.service]: async (...args: unknown[]) => {
        events.push("service:start");
        await serviceGate.promise;
        events.push("service:end");
        return Reflect.apply(service, services, args);
      },
    });
    const handlers = createConfigProfileRequestHandlers(services, {
      onConfigChanged: async () => {
        assert.strictEqual(result.data, entry.result);
        events.push("notification:start");
        notificationStarted.resolve();
        await notificationGate.promise;
        events.push("notification:end");
      },
    });
    const pending = entry.invoke(handlers, result).then(() => { events.push("handler:end"); });
    assert.deepEqual(events, ["service:start"]);
    assert.equal(result.data, "previous data");
    serviceGate.resolve();
    await notificationStarted.promise;
    assert.deepEqual(events, ["service:start", "service:end", "notification:start"]);
    notificationGate.resolve();
    await pending;
    assert.deepEqual(events, ["service:start", "service:end", "notification:start", "notification:end", "handler:end"]);
  });

  test(`${entry.action} propagates notification rejection while retaining assigned data`, async () => {
    const { services } = fixture();
    const result = response();
    const failure = new Error("notification rejected");
    const handlers = createConfigProfileRequestHandlers(services, {
      onConfigChanged: async () => { throw failure; },
    });
    await assert.rejects(entry.invoke(handlers, result), (error) => error === failure);
    assert.strictEqual(result.data, entry.result);
    assert.equal(result.success, false);
    assert.equal(result.error, "existing error");
  });

  test(`${entry.action} reads replacement host callback after the service completes`, async () => {
    const { services } = fixture();
    const serviceGate = deferred();
    const service = services[entry.service];
    Object.assign(services, {
      [entry.service]: async (...args: unknown[]) => { await serviceGate.promise; return Reflect.apply(service, services, args); },
    });
    const host: ConfigProfileRequestHost = { onConfigChanged: () => assert.fail("stale host callback") };
    const handlers = createConfigProfileRequestHandlers(services, host);
    const pending = entry.invoke(handlers, response());
    let notifications = 0;
    host.onConfigChanged = () => { notifications += 1; };
    serviceGate.resolve();
    await pending;
    assert.equal(notifications, 1);
    delete host.onConfigChanged;
    await entry.invoke(handlers, response());
    assert.equal(notifications, 1);
  });
}

test("initDefault notifies even when the default profile is null", async () => {
  const { services } = fixture();
  services.initDefaultConfig = async () => null;
  const result = response();
  let notifications = 0;
  const handlers = createConfigProfileRequestHandlers(services, {
    onConfigChanged: () => { notifications += 1; assert.equal(result.data, null); },
  });
  await handlers.initDefault(request({ action: "initDefault", platform }), result);
  assert.equal(result.data, null);
  assert.equal(notifications, 1);
});

test("getById retains a missing profile result", async () => {
  const { services } = fixture();
  services.getConfigById = async () => null;
  const result = response();
  await createConfigProfileRequestHandlers(services).getById(request({ action: "getById", platform, id: "missing" }), result);
  assert.equal(result.data, null);
});

for (const input of [...CLI_LIST, "gemini"] as const) {
  test(`getCurrent uses the authoritative host identity for ${input}`, async () => {
    const { services, calls } = fixture();
    const result = response();
    let activeReads = 0;
    const handlers = createConfigProfileRequestHandlers(services, {
      getActiveConfigId: async (cli) => {
        activeReads += 1;
        assert.equal(cli, input === "gemini" ? "opencode" : input);
        assert.deepEqual(calls, [{ service: "getCurrentConfig", args: [input] }]);
        assert.equal(result.data, "previous data");
        return "host-active-id";
      },
      onConfigChanged: () => assert.fail("read must not notify"),
    });
    await handlers.getCurrent(request({ action: "getCurrent", platform: input }), result);
    assert.equal(activeReads, 1);
    assert.deepEqual(result.data, { ...current, activeConfigId: "host-active-id" });
    assert.equal(current.activeConfigId, "stale-service-id");
  });
}

test("getCurrent waits for both reads and uses the latest host callback", async () => {
  const { services } = fixture();
  const currentGate = deferred();
  const activeGate = deferred();
  const activeStarted = deferred();
  const result = response();
  const events: string[] = [];
  services.getCurrentConfig = async () => { await currentGate.promise; events.push("current"); return current; };
  const host: ConfigProfileRequestHost = { getActiveConfigId: async () => assert.fail("stale active callback") };
  const handlers = createConfigProfileRequestHandlers(services, host);
  const pending = handlers.getCurrent(request({ action: "getCurrent", platform }), result);
  assert.equal(events.length, 0);
  host.getActiveConfigId = async (cli) => {
    assert.equal(cli, "opencode");
    events.push("active:start");
    activeStarted.resolve();
    await activeGate.promise;
    events.push("active:end");
    return "latest-host-id";
  };
  currentGate.resolve();
  await activeStarted.promise;
  assert.deepEqual(events, ["current", "active:start"]);
  assert.equal(result.data, "previous data");
  activeGate.resolve();
  await pending;
  assert.deepEqual(events, ["current", "active:start", "active:end"]);
  assert.deepEqual(result.data, { ...current, activeConfigId: "latest-host-id" });
  host.getActiveConfigId = async () => null;
  await handlers.getCurrent(request({ action: "getCurrent", platform }), result);
  assert.deepEqual(result.data, { ...current, activeConfigId: null });
  delete host.getActiveConfigId;
  await handlers.getCurrent(request({ action: "getCurrent", platform }), result);
  assert.deepEqual(result.data, { ...current, activeConfigId: null });
});

test("getCurrent propagates host identity rejection without replacing response data", async () => {
  const { services, calls } = fixture();
  const result = response();
  const failure = new Error("active identity failed");
  const handlers = createConfigProfileRequestHandlers(services, {
    getActiveConfigId: async () => { throw failure; },
  });
  await assert.rejects(handlers.getCurrent(request({ action: "getCurrent", platform }), result), (error) => error === failure);
  assert.deepEqual(calls, [{ service: "getCurrentConfig", args: [platform] }]);
  assert.deepEqual(result, response());
});
