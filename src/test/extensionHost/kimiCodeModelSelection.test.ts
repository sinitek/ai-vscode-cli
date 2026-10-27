import assert = require("node:assert/strict");
import test = require("node:test");
import { CLI_LIST } from "../../cli/types";
import { parseKimiCodeConfigModels } from "../../config/kimiCodeConfig";
import { installVscodeMock } from "../vscodeMock";

installVscodeMock();

const { createCliModelSelectionStrategies } = require("../../extensionHost/cliModelSelectionStrategies") as typeof import("../../extensionHost/cliModelSelectionStrategies");
const { ensureCliModelStore } = require("../../modelSelectionStore") as typeof import("../../modelSelectionStore");

const KIMI_TOML = `default_model = "subcoco/kimi-k3.1-pro"
default_permission_mode = "auto"

[providers.subcoco]
type = "openai"
base_url = "http://127.0.0.1:33391/v1"
api_key_env = "KIMI_CODE_API_KEY"

[models."subcoco/kimi-k3.1-pro"]
provider = "subcoco"
model = "kimi-k3.1-pro"
display_name = "Kimi K3.1 Pro"

[models."subcoco/kimi-k3.1-max"]
provider = "subcoco"
model = "kimi-k3.1-max"
display_name = "Kimi K3.1 Max"
`;

function createDeps(configs: Record<string, ReturnType<typeof parseKimiCodeConfigModels>>) {
  return {
    getGrokConfigModels: () => undefined,
    resolveDefaultGrokStoreKey: () => "grok:unconfigured",
    getDshConfigModels: () => undefined,
    resolveDefaultDshStoreKey: () => "dsh:unconfigured",
    getKimiCodeConfigModels: (configId: string | null | undefined) =>
      configs[configId ?? ""] ?? configs.default,
    resolveDefaultKimiCodeStoreKey: () => "kimi-code:unconfigured",
  };
}

test("kimi-code 是已注册的 CLI，且模型选择策略按配置声明读取", () => {
  assert.ok((CLI_LIST as readonly string[]).includes("kimi-code"));
  const parsed = parseKimiCodeConfigModels(KIMI_TOML);
  const strategies = createCliModelSelectionStrategies(createDeps({ default: parsed }));
  const strategy = strategies["kimi-code"];

  assert.deepEqual(strategy.getModelOptions(ensureCliModelStore(), "cfg"), [
    "subcoco/kimi-k3.1-pro",
    "subcoco/kimi-k3.1-max",
  ]);
  assert.deepEqual(strategy.getManagedModelOptions(ensureCliModelStore(), "cfg"), [
    "subcoco/kimi-k3.1-pro",
    "subcoco/kimi-k3.1-max",
  ]);
  assert.equal(strategy.getModelDisplayName("subcoco/kimi-k3.1-pro", "cfg"), "Kimi K3.1 Pro");
  assert.equal(strategy.getModelDisplayName("subcoco/kimi-k3.1-max", "cfg"), "Kimi K3.1 Max");
});

test("kimi-code 默认模型来自 default_model，选择会被持久化到独立 store key", () => {
  const parsed = parseKimiCodeConfigModels(KIMI_TOML);
  const strategies = createCliModelSelectionStrategies(createDeps({ default: parsed }));
  const strategy = strategies["kimi-code"];
  const empty = ensureCliModelStore();

  assert.equal(strategy.getSelectedModel(empty, "cfg"), "subcoco/kimi-k3.1-pro");
  assert.equal(strategy.resolveStoreConfigKey("cfg"), "cfg");
  assert.equal(strategy.resolveStoreConfigKey(null), "kimi-code:unconfigured");

  const selected = strategy.selectModel(empty, "subcoco/kimi-k3.1-max", "cfg");
  assert.equal(strategy.getSelectedModel(selected, "cfg"), "subcoco/kimi-k3.1-max");

  const mainOnly = strategy.selectLoopModel(empty, "main", "subcoco/kimi-k3.1-max", "cfg");
  assert.equal(strategy.getSelectedLoopModel(mainOnly, "main", "cfg"), "subcoco/kimi-k3.1-max");
  assert.equal(
    strategy.getSelectedLoopModel(mainOnly, "subtask", "cfg"),
    "subcoco/kimi-k3.1-pro",
    "未单独配置子任务模型时与 Grok 一致，回落到配置默认模型而不是主任务模型",
  );

  const both = strategy.selectLoopModel(mainOnly, "subtask", "subcoco/kimi-k3.1-pro", "cfg");
  assert.equal(strategy.getSelectedLoopModel(both, "main", "cfg"), "subcoco/kimi-k3.1-max");
  assert.equal(strategy.getSelectedLoopModel(both, "subtask", "cfg"), "subcoco/kimi-k3.1-pro");
});

test("kimi-code 不会继承其他 CLI 的模型，也不会写入其他 CLI 的 store key", () => {
  const parsed = parseKimiCodeConfigModels(KIMI_TOML);
  const deps = createDeps({ default: parsed });
  const strategies = createCliModelSelectionStrategies(deps);
  const strategy = strategies["kimi-code"];
  const store = ensureCliModelStore();

  // 选中一个不存在的模型时回落到 default_model，而不是保留跨 CLI 的值
  const selected = strategy.selectModel(store, "gpt-5.1-codex", "kimi-cfg");
  assert.equal(strategy.getSelectedModel(selected, "kimi-cfg"), "subcoco/kimi-k3.1-pro");
  assert.equal(selected.selectedByConfigId["kimi-cfg"], "subcoco/kimi-k3.1-pro");
  assert.equal(selected.selectedByConfigId["codex-cfg"], undefined);

  // 另一个配置 id 的模型互不影响
  const otherConfig = parseKimiCodeConfigModels(`default_model = "other/model"
[models."other/model"]
provider = "other"
model = "model"
`);
  const withOther = createCliModelSelectionStrategies(createDeps({
    default: parsed,
    "other-cfg": otherConfig,
  }))["kimi-code"];
  assert.equal(withOther.getSelectedModel(selected, "other-cfg"), "other/model");
  assert.equal(withOther.getSelectedModel(selected, "kimi-cfg"), "subcoco/kimi-k3.1-pro");
});

test("kimi-code 空配置时没有可选模型，选中项为空而不是回落到别的 CLI", () => {
  const empty = parseKimiCodeConfigModels("");
  const strategy = createCliModelSelectionStrategies(createDeps({ default: empty }))["kimi-code"];
  const store = ensureCliModelStore();
  assert.deepEqual(strategy.getModelOptions(store, null), []);
  assert.equal(strategy.getSelectedModel(store, null), null);
  const selected = strategy.selectModel(store, "gpt-5.1-codex", null);
  assert.equal(selected.selectedByConfigId["kimi-code:unconfigured"], "");
  assert.equal(strategy.getSelectedModel(selected, null), null);
});
