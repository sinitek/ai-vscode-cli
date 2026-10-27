import test = require("node:test");
import assert = require("node:assert/strict");
import { installVscodeMock } from "../vscodeMock";

installVscodeMock();

const { createSessionPanelMessageHandlers } = require("../../panelMessageHandlers/session") as typeof import("../../panelMessageHandlers/session");
const { parseKimiCodeConfigModels } = require("../../config/kimiCodeConfig") as typeof import("../../config/kimiCodeConfig");

test("kimi model messages persist config changes and refresh panel state", async () => {
  const changes: unknown[] = [];
  let refreshed = 0;
  let cached = "";
  let selected: unknown;
  const config = parseKimiCodeConfigModels('default_model = "next"\n[models.next]\nmodel = "next"\n');
  const handlers = createSessionPanelMessageHandlers({
    getActiveConfigIdForCli: () => "cfg-kimi",
    manageKimiCodeModelList: async (change: unknown, configId: string) => {
      changes.push({ change, configId });
      return { applied: true, model: "next", config };
    },
    cacheKimiCodeConfigModels: (configId: string) => { cached = configId; },
    deleteCliModel: () => undefined,
    selectCliModel: (_cli: string, model: string) => { selected = model; },
    postPanelState: async () => { refreshed += 1; },
  } as never);
  await handlers.addCliModel?.({ type: "addCliModel", cli: "kimi-code", model: "next" });
  await handlers.deleteCliModel?.({ type: "deleteCliModel", cli: "kimi-code", model: "next" });
  assert.equal(changes.length, 2);
  assert.deepEqual(changes[0], { change: { type: "add", model: "next" }, configId: "cfg-kimi" });
  assert.equal(cached, "cfg-kimi");
  assert.equal(selected, "next");
  assert.equal(refreshed, 2);
});

test("kimi model persistence failures show the real error and still refresh", async () => {
  let refreshed = 0;
  let error = "";
  const handlers = createSessionPanelMessageHandlers({
    getActiveConfigIdForCli: () => "cfg-kimi",
    manageKimiCodeModelList: async () => { throw new Error("config.toml 写入失败"); },
    showWebviewError: (_title: string, detail: unknown) => { error = String(detail); },
    postPanelState: async () => { refreshed += 1; },
  } as never);
  await handlers.addCliModel?.({ type: "addCliModel", cli: "kimi-code", model: "next" });
  assert.equal(error, "config.toml 写入失败");
  assert.equal(refreshed, 1);
});
