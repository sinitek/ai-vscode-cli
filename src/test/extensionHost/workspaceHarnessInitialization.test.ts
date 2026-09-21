import test = require("node:test");
import assert = require("node:assert/strict");
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { installVscodeMock } from "../vscodeMock";
import type { ModelSettingsHostDeps } from "../../extensionHost/modelSettings";

installVscodeMock();

const vscode = require("vscode") as typeof import("vscode");
const { createModelSettingsHost } = require("../../extensionHost/modelSettings") as typeof import("../../extensionHost/modelSettings");
const { ensureCliModelStore } = require("../../modelSelectionStore") as typeof import("../../modelSelectionStore");
const { t } = require("../../i18n") as typeof import("../../i18n");

function createHarnessHost(workspaceRoot?: string) {
  const modelStore = ensureCliModelStore();
  const thinkingState: ReturnType<ModelSettingsHostDeps["getOpenCodeThinkingState"]> = {
    providerId: null,
    modelId: null,
    reasoning: "unknown",
    options: [],
    configuredDefaultVariant: null,
    selectedVariant: null,
    status: "unknown",
    source: "fallback",
    disabled: true,
    messageKey: "follow-default",
  };
  return createModelSettingsHost({
    getCurrentCli: () => "codex",
    setCurrentCli: () => undefined,
    getModelStore: () => modelStore,
    setModelStore: () => undefined,
    getWorkspaceSettings: () => ({}),
    setWorkspaceSettings: () => undefined,
    getPromptHistoryStore: () => ({ items: [] }),
    setPromptHistoryStore: () => undefined,
    getModelSelectionStoreState: () => ({ store: modelStore, lastReadError: null, lastWriteError: null }),
    getActiveWorkspaceKey: () => "workspace",
    getConfigHeartbeatSnapshot: () => null,
    getOpenCodeThinkingState: () => thinkingState,
    setOpenCodeThinkingState: () => undefined,
    getOpenCodeSmallThinkingState: () => thinkingState,
    setOpenCodeSmallThinkingState: () => undefined,
    getOpenCodeModelsState: () => undefined,
    setOpenCodeModelsState: () => undefined,
    getOpenCodeThinkingContextKey: () => "",
    setOpenCodeThinkingContextKey: () => undefined,
    getOpenCodeThinkingConfigId: () => null,
    setOpenCodeThinkingConfigId: () => undefined,
    getOpenCodeThinkingExactModels: () => ({ main: null, subtask: null }),
    setOpenCodeThinkingExactModels: () => undefined,
    getOpenCodeThinkingRequestId: () => 0,
    setOpenCodeThinkingRequestId: () => undefined,
    getWorkspacePreferredConfigIdForCli: () => null,
    resolveModelConfigIdForCli: () => null,
    postPanelState: async () => undefined,
    resolveWorkspaceCwd: () => workspaceRoot,
    getExtensionUri: () => vscode.Uri.file(path.resolve(__dirname, "../../..")),
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
}

for (const scenario of ["confirmed", "cancelled", "no-workspace", "scaffold-error"] as const) {
  test(`workspace harness initialization ${scenario} never starts CodeGraph`, async (context) => {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sinitek harness 测试-"));
    context.after(() => fs.rmSync(workspaceRoot, { recursive: true, force: true }));
    const terminal = context.mock.method(vscode.window, "createTerminal", () => {
      throw new Error("Harness initialization must not open a CodeGraph terminal");
    });
    const warnings = context.mock.method(vscode.window, "showWarningMessage", async (message: string) => {
      if (scenario !== "cancelled" && message === t("workspaceHarness.confirmInitialize", { workspace: workspaceRoot })) {
        return t("workspaceHarness.confirmInitializeAction");
      }
      return undefined;
    });
    const information = context.mock.method(vscode.window, "showInformationMessage", async () => undefined);
    if (scenario === "scaffold-error") {
      fs.writeFileSync(path.join(workspaceRoot, ".ch"), "not a directory", "utf8");
    }
    const host = createHarnessHost(scenario === "no-workspace" ? undefined : workspaceRoot);

    assert.equal(await host.confirmAndInitializeWorkspaceHarness(), scenario === "confirmed");
    assert.equal(terminal.mock.callCount(), 0);
    assert.equal(host.isCodeGraphInstalling(), false);
    assert.equal(fs.existsSync(path.join(workspaceRoot, ".codegraph")), false);
    assert.equal(fs.existsSync(path.join(workspaceRoot, "AGENTS.md")), scenario === "confirmed");
    if (scenario === "confirmed") {
      for (const entry of [".ch", ".agents", "ARCHITECTURE.md", "CLAUDE.md"]) {
        assert.ok(fs.existsSync(path.join(workspaceRoot, entry)), entry);
      }
      assert.match(fs.readFileSync(path.join(workspaceRoot, ".gitignore"), "utf8"), /^\.codegraph\/$/m);
      assert.equal(information.mock.calls[0].arguments[0], t("workspaceHarness.initStarted"));
      assert.equal(warnings.mock.calls[1].arguments[0], t("workspaceHarness.confirmArchitectureInitialize"));
    } else {
      assert.equal(information.mock.callCount(), 0);
      const lastWarning = warnings.mock.calls.at(-1)?.arguments[0];
      if (scenario === "no-workspace") {
        assert.equal(lastWarning, t("workspaceHarness.noWorkspace"));
      } else if (scenario === "scaffold-error") {
        assert.equal(lastWarning, t("workspaceHarness.initFailed"));
      }
    }
  });
}
