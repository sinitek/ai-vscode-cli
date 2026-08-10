import test = require("node:test");
import assert = require("node:assert/strict");
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { installVscodeMock } from "./vscodeMock";

installVscodeMock();

import type { CliName, OpenCodeThinkingState } from "../cli/types";
import type { OpenCodeThinkingCapability } from "../cli/openCodeModelCapabilities";
import type { OpenCodeCanonicalModelRole } from "../cli/opencodeconfigmodels";
import type { PromptHistoryStore } from "../promptHistoryStore";
import type { PanelState } from "../webview/types";

type OpenCodeThinkingWithDefault = OpenCodeThinkingState & Pick<OpenCodeThinkingCapability, "configuredDefaultVariant">;

function createDefaultOpenCodeThinkingState(messageKey: OpenCodeThinkingState["messageKey"] = "follow-default"): OpenCodeThinkingWithDefault {
  return {
    providerId: null,
    modelId: null,
    reasoning: "unknown",
    options: [],
    configuredDefaultVariant: null,
    selectedVariant: null,
    status: "unknown",
    source: "fallback",
    disabled: true,
    messageKey,
  };
}

async function waitFor(assertion: () => boolean, timeoutMs = 2_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (assertion()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.equal(assertion(), true);
}

function writeFakeOpenCodeCommand(tempHome: string): string {
  const binDir = path.join(tempHome, "bin");
  fs.mkdirSync(binDir, { recursive: true });
  const commandPath = path.join(binDir, "opencode");
  fs.writeFileSync(
    commandPath,
    [
      "#!/bin/sh",
      "if [ \"$1\" = \"--version\" ]; then",
      "  echo opencode-test",
      "  exit 0",
      "fi",
      "if [ \"$1\" = \"models\" ]; then",
      "  exit 1",
      "fi",
      "exit 0",
      "",
    ].join("\n"),
    "utf8",
  );
  fs.chmodSync(commandPath, 0o755);
  return binDir;
}

function writeOpenCodeConfig(tempHome: string, configId: string, content: string): void {
  const configDir = path.join(tempHome, ".opencode", "__config");
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(
    path.join(configDir, `${configId}.json`),
    JSON.stringify({
      id: configId,
      name: "OpenCode Test",
      platform: "opencode",
      createdAt: 1,
      updatedAt: 1,
      content,
      openCodeSkills: [],
    }, null, 2),
    "utf8",
  );
  fs.writeFileSync(path.join(tempHome, ".opencode", "config.json"), content, "utf8");
}

test("publishes async OpenCode thinking variants before refreshing panel state", async () => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "sinitek-opencode-thinking-refresh-"));
  const originalHome = process.env.HOME;
  const originalPath = process.env.PATH;
  process.env.HOME = tempHome;
  process.env.PATH = `${writeFakeOpenCodeCommand(tempHome)}${path.delimiter}${originalPath ?? ""}`;

  try {
    const configId = "config-a";
    const configContent = JSON.stringify({
      model: "myAPI/gpt-5.6-sol",
      small_model: "myAPI/gpt-5.6-luna",
      provider: {
        myAPI: {
          models: {
            "gpt-5.6-sol": {
              name: "gpt-5.6-sol",
              reasoning: true,
              options: { reasoningEffort: "xhigh" },
              variants: {
                xhigh: { reasoningEffort: "xhigh" },
                max: { reasoningEffort: "max" },
                ultra: { reasoningEffort: "ultra" },
              },
            },
            "gpt-5.6-luna": {
              name: "gpt-5.6-luna",
              reasoning: true,
              options: { reasoningEffort: "medium" },
              variants: {
                medium: { reasoningEffort: "medium" },
              },
            },
          },
        },
      },
    });
    writeOpenCodeConfig(tempHome, configId, configContent);

    const {
      createModelSettingsHost,
    } = require("../extensionHost/modelSettings") as typeof import("../extensionHost/modelSettings");
    const {
      ensureCliModelStore,
    } = require("../modelSelectionStore") as typeof import("../modelSelectionStore");

    let currentCli: CliName = "opencode";
    let modelStore = ensureCliModelStore();
    let workspaceSettings = {};
    let promptHistoryStore: PromptHistoryStore = { items: [] };
    let openCodeThinkingState = createDefaultOpenCodeThinkingState();
    let openCodeSmallThinkingState = createDefaultOpenCodeThinkingState();
    let openCodeModelsState: PanelState["openCodeModels"] = undefined;
    let openCodeThinkingContextKey = "";
    let openCodeThinkingConfigId: string | null = null;
    let openCodeThinkingExactModels: Record<OpenCodeCanonicalModelRole, string | null> = { main: null, subtask: null };
    let openCodeThinkingRequestId = 0;
    let postCount = 0;
    const modelSelectionStoreState = {
      store: modelStore,
      lastReadError: null,
      lastWriteError: null,
    };
    const configState: PanelState["configState"] = {
      configs: [{ id: configId, name: "OpenCode Test", platform: "opencode" }],
      activeConfigId: configId,
    };

    const host = createModelSettingsHost({
      getCurrentCli: () => currentCli,
      setCurrentCli: (cli) => { currentCli = cli; },
      getModelStore: () => modelStore,
      setModelStore: (store) => { modelStore = store; modelSelectionStoreState.store = store; },
      getWorkspaceSettings: () => workspaceSettings,
      setWorkspaceSettings: (settings) => { workspaceSettings = settings; },
      getPromptHistoryStore: () => promptHistoryStore,
      setPromptHistoryStore: (store) => { promptHistoryStore = store; },
      getModelSelectionStoreState: () => modelSelectionStoreState,
      getActiveWorkspaceKey: () => "workspace",
      getConfigHeartbeatSnapshot: () => null,
      getOpenCodeThinkingState: () => openCodeThinkingState,
      setOpenCodeThinkingState: (state) => { openCodeThinkingState = state; },
      getOpenCodeSmallThinkingState: () => openCodeSmallThinkingState,
      setOpenCodeSmallThinkingState: (state) => { openCodeSmallThinkingState = state; },
      getOpenCodeModelsState: () => openCodeModelsState,
      setOpenCodeModelsState: (state) => { openCodeModelsState = state; },
      getOpenCodeThinkingContextKey: () => openCodeThinkingContextKey,
      setOpenCodeThinkingContextKey: (value) => { openCodeThinkingContextKey = value; },
      getOpenCodeThinkingConfigId: () => openCodeThinkingConfigId,
      setOpenCodeThinkingConfigId: (value) => { openCodeThinkingConfigId = value; },
      getOpenCodeThinkingExactModels: () => openCodeThinkingExactModels,
      setOpenCodeThinkingExactModels: (value) => { openCodeThinkingExactModels = value; },
      getOpenCodeThinkingRequestId: () => openCodeThinkingRequestId,
      setOpenCodeThinkingRequestId: (value) => { openCodeThinkingRequestId = value; },
      getWorkspacePreferredConfigIdForCli: () => configId,
      resolveModelConfigIdForCli: () => configId,
      postPanelState: async () => { postCount += 1; },
      resolveWorkspaceCwd: () => undefined,
      getExtensionUri: () => ({ fsPath: tempHome }) as any,
      updateStatusBar: () => undefined,
      getActiveConversationTab: () => null,
      getActiveConversationTabId: () => null,
      getConversationTabById: () => null,
      isTabRunActive: () => false,
      preloadUserMessageForPrompt: (input) => input,
      resolvePromptRunTarget: () => null,
      runPrompt: async () => undefined,
      sanitizeConversationTabRecord: () => null,
      logError: () => undefined,
    });

    await host.refreshOpenCodeThinkingState(configState);
    assert.equal(openCodeThinkingState.messageKey, "loading");

    await waitFor(() => openCodeThinkingState.options.length === 3);

    assert.deepEqual(openCodeThinkingState.options.map((option) => option.value), ["xhigh", "max", "ultra"]);
    assert.equal(openCodeThinkingState.configuredDefaultVariant, "xhigh");
    assert.equal(openCodeThinkingState.disabled, false);
    assert.equal(openCodeThinkingExactModels.main, "myAPI/gpt-5.6-sol");
    assert.ok(postCount > 0);
  } finally {
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
    if (originalPath === undefined) {
      delete process.env.PATH;
    } else {
      process.env.PATH = originalPath;
    }
    fs.rmSync(tempHome, { recursive: true, force: true });
  }
});
