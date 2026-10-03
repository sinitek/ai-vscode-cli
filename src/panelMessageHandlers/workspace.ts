import * as path from "path";
import { getCliCommand } from "../cli/config";
import { getConfiguredCliCommandParts } from "../cli/commandResolution";
import {
  buildRepairedCliCommand,
  inspectUnresolvedCliCommands,
  locateCliExecutableForRepair,
} from "../cli/cliCommandRepair";
import { t } from "../i18n";
import { logDebug, logError } from "../logger";
import {
  exportRunStreamRecordsToJsonl,
  saveUploadedFiles,
} from "../webview/panelFileActions";
import type { PanelMessageHandlerDeps } from "../sessionMessageHandlers";
import type { PanelMessageHandlerRegistry } from "../sessionMessageRouter";

type WorkspacePanelMessageDeps = Pick<
  PanelMessageHandlerDeps,
  | "postWebviewMessage"
  | "getActiveConversationTabId"
  | "getCurrentCli"
  | "postPanelState"
  | "readCliRules"
  | "writeCliRules"
  | "normalizeRuleTargets"
  | "isCliName"
  | "getWorkspaceSettings"
  | "saveWorkspaceSettings"
  | "confirmAndInitializeWorkspaceHarness"
  | "installCodeGraphForWorkspace"
  | "resolveWorkspaceDropPaths"
  | "hasWorkspaceFolder"
  | "pickWorkspacePaths"
  | "persistCliCommand"
>;

export function createWorkspacePanelMessageHandlers(
  deps: WorkspacePanelMessageDeps
): PanelMessageHandlerRegistry {
  return {
    resolveDropPaths: (message) => {
      const uris = Array.isArray(message.uris) ? message.uris : [];
      if (!uris.length) {
        return;
      }
      try {
        deps.postWebviewMessage({
          type: "dropPathsResult",
          paths: deps.resolveWorkspaceDropPaths(uris),
        });
      } catch (error) {
        deps.postWebviewMessage({
          type: "dropPathsResult",
          paths: [],
          error: t("pathPicker.dropParseError"),
        });
        void logError("resolve drop paths failed", error);
      }
    },

    pickWorkspacePath: async () => {
      if (!deps.hasWorkspaceFolder()) {
        deps.postWebviewMessage({
          type: "pickWorkspacePathResult",
          paths: [],
          error: t("pathPicker.noWorkspace"),
          canceled: true,
        });
        return;
      }
      try {
        const paths = await deps.pickWorkspacePaths();
        if (!paths || paths.length === 0) {
          deps.postWebviewMessage({
            type: "pickWorkspacePathResult",
            paths: [],
            canceled: true,
          });
          return;
        }
        deps.postWebviewMessage({
          type: "pickWorkspacePathResult",
          paths,
        });
      } catch (error) {
        deps.postWebviewMessage({
          type: "pickWorkspacePathResult",
          paths: [],
          error: t("pathPicker.readError"),
          canceled: true,
        });
        void logError("pick workspace path failed", error);
      }
    },

    uploadFiles: async (message) => {
      const result = await saveUploadedFiles(message.files);
      deps.postWebviewMessage({
        type: "uploadResult",
        paths: result.paths,
        error: result.error,
      });
    },

    exportRunStream: async (message) => {
      const targetTabId = typeof message.tabId === "string" && message.tabId
        ? message.tabId
        : deps.getActiveConversationTabId();
      const targetCli = message.cli && deps.isCliName(message.cli)
        ? message.cli
        : deps.getCurrentCli();
      try {
        const exportResult = await exportRunStreamRecordsToJsonl(message.records, {
          cli: targetCli,
          tabId: targetTabId,
        });
        deps.postWebviewMessage({
          type: "runStreamExportResult",
          tabId: targetTabId,
          path: exportResult.path,
          fileName: exportResult.fileName,
        });
      } catch (error) {
        const messageText = error instanceof Error && error.message
          ? error.message
          : t("runStream.exportFailed");
        deps.postWebviewMessage({
          type: "runStreamExportResult",
          tabId: targetTabId,
          error: messageText,
        });
        void logError("export run stream failed", error);
      }
    },

    loadRules: async (message) => {
      try {
        const content = await deps.readCliRules(message.cli, message.scope);
        deps.postWebviewMessage({
          type: "rulesContent",
          cli: message.cli,
          content,
          scope: message.scope,
        });
      } catch (error) {
        const noWorkspace = error instanceof Error && error.message === "no-workspace";
        deps.postWebviewMessage({
          type: "rulesContent",
          cli: message.cli,
          scope: message.scope,
          error: noWorkspace ? t("rules.loadNoWorkspace") : t("rules.loadFailed"),
        });
        void logError("load rules failed", error);
      }
    },

    saveRules: async (message) => {
      const targets = deps.normalizeRuleTargets(message.targets);
      if (!targets.length) {
        deps.postWebviewMessage({
          type: "rulesSaved",
          error: t("rules.invalidCli"),
        });
        return;
      }
      try {
        await Promise.all(
          targets.map((cli) => deps.writeCliRules(cli, message.scope, message.content ?? ""))
        );
        deps.postWebviewMessage({
          type: "rulesSaved",
          targets,
          scope: message.scope,
        });
      } catch (error) {
        const noWorkspace = error instanceof Error && error.message === "no-workspace";
        deps.postWebviewMessage({
          type: "rulesSaved",
          error: noWorkspace ? t("rules.saveNoWorkspace") : t("rules.saveFailed"),
        });
        void logError("save rules failed", error);
      }
    },

    initializeWorkspaceHarness: async (message) => {
      const workspaceSettings = deps.getWorkspaceSettings();
      if (message.enabled !== true) {
        workspaceSettings.workspaceMemoryEnabled = false;
        deps.saveWorkspaceSettings(workspaceSettings);
        await deps.postPanelState();
        return;
      }
      const initialized = await deps.confirmAndInitializeWorkspaceHarness();
      workspaceSettings.workspaceMemoryEnabled = initialized;
      deps.saveWorkspaceSettings(workspaceSettings);
      await deps.postPanelState();
    },

    installCodeGraph: async () => {
      await deps.installCodeGraphForWorkspace();
    },

    inspectCliRepairs: (message) => {
      void message;
      deps.postWebviewMessage({
        type: "cliRepairIssues",
        issues: inspectUnresolvedCliCommands({
          codex: getCliCommand("codex"),
          claude: getCliCommand("claude"),
          opencode: getCliCommand("opencode"),
        }),
      });
    },

    repairCliCommand: async (message) => {
      if (!deps.isCliName(message.cli)) {
        deps.postWebviewMessage({
          type: "cliRepairResult",
          error: t("cliRepair.invalidCli"),
        });
        return;
      }
      const cli = message.cli;
      const previousCommand = getCliCommand(cli);
      try {
        const executablePath = await locateCliExecutableForRepair(previousCommand, cli);
        if (!executablePath) {
          const executable = getConfiguredCliCommandParts(previousCommand, cli)[0] ?? cli;
          const command = path.basename(executable).trim() || cli;
          deps.postWebviewMessage({
            type: "cliRepairResult",
            cli,
            status: "not-found",
            error: t("cliRepair.notFound", { command, cli }),
          });
          return;
        }
        const nextCommand = buildRepairedCliCommand(previousCommand, cli, executablePath);
        await deps.persistCliCommand(cli, nextCommand);
        void logDebug("cli-command-repair", { cli, command: nextCommand });
        deps.postWebviewMessage({
          type: "cliRepairResult",
          cli,
          status: "repaired",
          command: nextCommand,
          message: t("cliRepair.repaired", { cli, command: nextCommand }),
        });
      } catch (error) {
        void logError("cli repair failed", error);
        deps.postWebviewMessage({
          type: "cliRepairResult",
          cli,
          status: "failed",
          error: t("cliRepair.persistFailed"),
        });
      }
    },
  };
}
