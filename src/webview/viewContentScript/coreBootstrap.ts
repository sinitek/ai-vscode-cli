// Bootstrap API, i18n helpers, DOM refs, and base state.
export const VIEW_CONTENT_SCRIPT_CORE_BOOTSTRAP = `      const vscode = acquireVsCodeApi();
      const persistedWebviewState = (() => {
        try {
          return vscode.getState() || {};
        } catch {
          return {};
        }
      })();
      const i18n = \${JSON.stringify(i18n)};
      const CLI_NAMES = \${JSON.stringify(CLI_LIST)};
      const LOOP_SUBTASK_MAX_THINKING_MODE_DEFAULT = "\${LOOP_SUBTASK_MAX_THINKING_MODE_DEFAULT}";
      const traceMarkers = {
        input: ["Input", "输入"],
        output: ["Output", "输出"],
        toolResult: ["Tool result", "工具结果"],
        fileChanges: ["File changes", "文件变更"],
      };
      function formatTemplate(template, params) {
        if (!params) {
          return template;
        }
        return template.replace(/\\{(\\w+)\\}/g, (match, key) => {
          if (Object.prototype.hasOwnProperty.call(params, key)) {
            return String(params[key]);
          }
          return match;
        });
      }
      function t(key, params) {
        const template = i18n[key] || key;
        return formatTemplate(template, params);
      }
      function reportWebviewFailure(message, error, extra) {
        const reason = error && error.message ? String(error.message) : String(error || "");
        const stack = error && error.stack ? String(error.stack) : undefined;
        console.error("[sinitek-webview]", message, {
          reason,
          stack,
          extra: extra || null,
        });
        try {
          vscode.postMessage(Object.assign({
            type: "webviewError",
            message,
            reason,
            stack,
          }, extra || {}));
        } catch {
          // ignore
        }
      }
      function postWebviewError(payload) {
        console.error("[sinitek-webview]", payload && payload.message ? payload.message : "webview-error", payload || null);
        try {
          vscode.postMessage(Object.assign({ type: "webviewError" }, payload));
        } catch {
          // ignore
        }
      }
      function postWebviewDebug(event, payload) {
        try {
          vscode.postMessage({ type: "webviewDebug", event, payload });
        } catch {
          // ignore
        }
      }
      function normalizeReason(reason) {
        if (!reason) {
          return "";
        }
        if (reason instanceof Error) {
          return reason.message || String(reason);
        }
        if (typeof reason === "string") {
          return reason;
        }
        try {
          return JSON.stringify(reason);
        } catch {
          return String(reason);
        }
      }
      window.addEventListener("error", (event) => {
        postWebviewError({
          message: event && event.message ? event.message : "webview-error",
          source: event && event.filename ? event.filename : undefined,
          lineno: event && typeof event.lineno === "number" ? event.lineno : undefined,
          colno: event && typeof event.colno === "number" ? event.colno : undefined,
          stack: event && event.error && event.error.stack ? String(event.error.stack) : undefined,
        });
      });
      window.addEventListener("unhandledrejection", (event) => {
        const reason = event ? normalizeReason(event.reason) : "";
        const stack = event && event.reason && event.reason.stack ? String(event.reason.stack) : undefined;
        postWebviewError({
          message: "webview-unhandledrejection",
          reason,
          stack,
        });
      });

      const state = {
        currentCli: "codex",
        messages: [],
        isRunning: false,
        configState: {
          configs: [],
          activeConfigId: null,
        },
        selectedConfigId: "",
        selectedModel: "",
        selectedModelsByCli: {
          codex: "",
          claude: "",
          opencode: "",
        },
        modelsByCli: {
          codex: [],
          claude: [],
          opencode: [],
        },
        managedModelsByCli: {
          codex: [],
          claude: [],
          opencode: [],
        },
        autoAppliedConfig: false,
        sessionState: {
          currentSessionId: null,
          sessions: [],
        },
        conversationTabs: {
          activeTabId: null,
          tabs: [],
        },
        promptHistory: [],
        debug: false,
        autoAddEditorContextTags: false,
        longTermMemoryEnabled: false,
        workspaceMemoryEnabled: false,
        autoCompactContextAfterRun: true,
        multiAgentEnabled: false,
        loopMaxRounds: \${LOOP_MAX_ROUNDS_SETTING_DEFAULT},
        loopSubtaskMaxThinkingMode: LOOP_SUBTASK_MAX_THINKING_MODE_DEFAULT,
        loopExecutionModeByCli: {
          codex: "\${LOOP_EXECUTION_MODE_MAIN_SUB_MULTI_AGENT}",
          claude: "\${LOOP_EXECUTION_MODE_MAIN_SUB_MULTI_AGENT}",
          opencode: "\${LOOP_EXECUTION_MODE_MAIN_SUB_MULTI_AGENT}",
        },
        locale: "auto",
        isMac: false,
        macTaskShell: "zsh",
        thinkingMode: "medium",
        openCodeThinking: {
          selectedVariant: null,
          configuredDefaultVariant: null,
          options: [],
          disabled: true,
          messageKey: "follow-default",
        },
        openCodeSmallThinking: {
          selectedVariant: null,
          configuredDefaultVariant: null,
          options: [],
          disabled: true,
          messageKey: "follow-default",
        },
        openCodeModels: {
          models: [],
          configPrimaryRef: null,
          configSmallRef: null,
          selectedPrimaryRef: null,
          selectedSmallRef: null,
          issues: [],
        },
        interactiveMode: "coding",
        interactive: { supported: false, enabled: true },
        rulePaths: { global: {}, project: {} },
        ruleScope: "global",
        historyTab: "sessions",
        promptHistoryExpandedId: null,
        historySessionMessages: {
          cli: "",
          sessionId: "",
          resolvedSessionId: "",
          label: "",
          createdAt: 0,
          messages: [],
          loading: false,
          error: "",
        },
        onlyShowFinalResults: Boolean(persistedWebviewState.onlyShowFinalResults),
        editorContext: {
          filePath: null,
          fileLabel: null,
          hasSelection: false,
          selectionLabel: null,
        },
        promptContext: {
          includeCurrentFile: false,
          includeSelection: false,
          dismissedFileKey: "",
          dismissedSelectionKey: "",
          autoIncludeArmed: true,
        },
      };
      const traceCollapsibleOpenKeys = new Set();
      const DUPLICATE_STATUS_TRACE_WINDOW_MS = 3000;

      const elements = {
        currentCli: document.getElementById("currentCli"),
        openConfig: document.getElementById("openConfig"),
        newSession: document.getElementById("newSession"),
        resetSession: document.getElementById("resetSession"),
        conversationTabs: document.getElementById("conversationTabs"),
        resultOnlyToggle: document.getElementById("resultOnlyToggle"),
        stopRun: document.getElementById("stopRun"),
        chatArea: document.getElementById("chatArea"),
        messages: document.getElementById("messages"),
        emptyState: document.getElementById("emptyState"),
        runWait: document.getElementById("runWait"),
        runStatusText: document.getElementById("runStatusText"),
        runStreamButton: document.getElementById("runStreamButton"),
        runStreamStaleBadge: document.getElementById("runStreamStaleBadge"),
        runWaitTime: document.getElementById("runWaitTime"),
        runPromptButton: document.getElementById("runPromptButton"),
        openCurrentLoopGroupChat: document.getElementById("openCurrentLoopGroupChat"),
        openCurrentGraphRun: document.getElementById("openCurrentGraphRun"),
        queueIndicator: document.getElementById("queueIndicator"),
        queueCount: document.getElementById("queueCount"),
        scrollToBottomWrap: document.getElementById("scrollToBottomWrap"),
        scrollToBottomButton: document.getElementById("scrollToBottomButton"),
        configSelect: document.getElementById("configSelect"),
        interactiveModeSelect: document.getElementById("interactiveModeSelect"),
        promptInput: document.getElementById("promptInput"),
        promptContextTags: document.getElementById("promptContextTags"),
        thinkingMode: document.getElementById("thinkingMode"),
        openCodePrimaryThinkingMode: document.getElementById("openCodePrimaryThinkingMode"),
        openCodeSmallThinkingMode: document.getElementById("openCodeSmallThinkingMode"),
        openCodeModelGroup: document.getElementById("openCodeModelGroup"),
        openCodePrimaryModelSelect: document.getElementById("openCodePrimaryModelSelect"),
        openCodeSmallModelSelect: document.getElementById("openCodeSmallModelSelect"),
        openCodeModelIssue: document.getElementById("openCodeModelIssue"),
        loopExecutionModeSelect: document.getElementById("loopExecutionModeSelect"),
        modelSelect: document.getElementById("modelSelect"),
        debugMode: document.getElementById("debugMode"),
        autoAddEditorContextTags: document.getElementById("autoAddEditorContextTags"),
        longTermMemoryEnabled: document.getElementById("longTermMemoryEnabled"),
        longTermMemoryNote: document.getElementById("longTermMemoryNote"),
        installCodeGraph: document.getElementById("installCodeGraph"),
        toolSettingsGlobalTab: document.getElementById("toolSettingsGlobalTab"),
        toolSettingsWorkspaceTab: document.getElementById("toolSettingsWorkspaceTab"),
        toolSettingsGlobalPanel: document.getElementById("toolSettingsGlobalPanel"),
        toolSettingsWorkspacePanel: document.getElementById("toolSettingsWorkspacePanel"),
        autoCompactContextAfterRun: document.getElementById("autoCompactContextAfterRun"),
        multiAgentEnabled: document.getElementById("multiAgentEnabled"),
        loopMaxRounds: document.getElementById("loopMaxRounds"),
        loopSubtaskMaxThinkingMode: document.getElementById("loopSubtaskMaxThinkingMode"),
        languageSelect: document.getElementById("languageSelect"),
        macTaskShellRow: document.getElementById("macTaskShellRow"),
        macTaskShell: document.getElementById("macTaskShell"),
        commonCommandButton: document.getElementById("commonCommandButton"),
        pathPickerButton: document.getElementById("pathPickerButton"),
        attachmentButton: document.getElementById("attachmentButton"),
        attachmentInput: document.getElementById("attachmentInput"),
        sendPrompt: document.getElementById("sendPrompt"),
        historyButton: document.getElementById("historyButton"),
        historyOverlay: document.getElementById("historyOverlay"),
        closeHistory: document.getElementById("closeHistory"),
        clearAllHistory: document.getElementById("clearAllHistory"),
        historyTabPrompts: document.getElementById("historyTabPrompts"),
        historyTabSessions: document.getElementById("historyTabSessions"),
        historyPanelPrompts: document.getElementById("historyPanelPrompts"),
        historyPanelSessions: document.getElementById("historyPanelSessions"),
        promptHistoryList: document.getElementById("promptHistoryList"),
        sessionList: document.getElementById("sessionList"),
        historyMessagesOverlay: document.getElementById("historyMessagesOverlay"),
        closeHistoryMessages: document.getElementById("closeHistoryMessages"),
        historyMessagesTitle: document.getElementById("historyMessagesTitle"),
        historyMessagesSubtitle: document.getElementById("historyMessagesSubtitle"),
        historyMessagesStatus: document.getElementById("historyMessagesStatus"),
        exportHistoryMessages: document.getElementById("exportHistoryMessages"),
        historyMessagesContent: document.getElementById("historyMessagesContent"),
        rulesButton: document.getElementById("rulesButton"),
        rulesOverlay: document.getElementById("rulesOverlay"),
        closeRules: document.getElementById("closeRules"),
        rulesLoadCli: document.getElementById("rulesLoadCli"),
        loadRules: document.getElementById("loadRules"),
        rulesInput: document.getElementById("rulesInput"),
        rulesSaveCodexOption: document.getElementById("rulesSaveCodexOption"),
        rulesSaveCodex: document.getElementById("rulesSaveCodex"),
        rulesSaveCodexLabel: document.getElementById("rulesSaveCodexLabel"),
        rulesSaveClaudeOption: document.getElementById("rulesSaveClaudeOption"),
        rulesSaveClaude: document.getElementById("rulesSaveClaude"),
        rulesSaveOpenCodeOption: document.getElementById("rulesSaveOpenCodeOption"),
        rulesSaveOpenCode: document.getElementById("rulesSaveOpenCode"),
        saveRules: document.getElementById("saveRules"),
        rulesHint: document.getElementById("rulesHint"),
        rulesPath: document.getElementById("rulesPath"),
        scopeGlobal: document.getElementById("scopeGlobal"),
        scopeProject: document.getElementById("scopeProject"),
        helpButton: document.getElementById("helpButton"),
        helpOverlay: document.getElementById("helpOverlay"),
        closeHelp: document.getElementById("closeHelp"),
        toolSettingsButton: document.getElementById("toolSettingsButton"),
        toolSettingsOverlay: document.getElementById("toolSettingsOverlay"),
        closeToolSettings: document.getElementById("closeToolSettings"),
        commonCommandsOverlay: document.getElementById("commonCommandsOverlay"),
        closeCommonCommands: document.getElementById("closeCommonCommands"),
        commandCompact: document.getElementById("commandCompact"),
        runConflictOverlay: document.getElementById("runConflictOverlay"),
        closeRunConflict: document.getElementById("closeRunConflict"),
        queuePrompt: document.getElementById("queuePrompt"),
        pauseAndSend: document.getElementById("pauseAndSend"),
        runConflictPrompt: document.getElementById("runConflictPrompt"),
        queueOverlay: document.getElementById("queueOverlay"),
        closeQueue: document.getElementById("closeQueue"),
        queueBody: document.getElementById("queueBody"),
        continueQueue: document.getElementById("continueQueue"),
        runPromptOverlay: document.getElementById("runPromptOverlay"),
        closeRunPrompt: document.getElementById("closeRunPrompt"),
        runPromptContent: document.getElementById("runPromptContent"),
        runStreamOverlay: document.getElementById("runStreamOverlay"),
        closeRunStream: document.getElementById("closeRunStream"),
        exportRunStream: document.getElementById("exportRunStream"),
        runStreamContent: document.getElementById("runStreamContent"),
        configApplyErrorOverlay: document.getElementById("configApplyErrorOverlay"),
        closeConfigApplyError: document.getElementById("closeConfigApplyError"),
        copyConfigApplyError: document.getElementById("copyConfigApplyError"),
        configApplyErrorContent: document.getElementById("configApplyErrorContent"),
        helpTabModes: document.getElementById("helpTabModes"),
        helpTabInstall: document.getElementById("helpTabInstall"),
        helpPanelModes: document.getElementById("helpPanelModes"),
        helpPanelInstall: document.getElementById("helpPanelInstall"),
        toast: document.getElementById("toast"),
        taskListPanel: document.getElementById("taskListPanel"),
        taskListDetails: document.getElementById("taskListDetails"),
        taskListCount: document.getElementById("taskListCount"),
        taskListBody: document.getElementById("taskListBody"),
        addModelOverlay: document.getElementById("addModelOverlay"),
        closeAddModel: document.getElementById("closeAddModel"),
        cancelAddModel: document.getElementById("cancelAddModel"),
        clearModelEdit: document.getElementById("clearModelEdit"),
        confirmAddModel: document.getElementById("confirmAddModel"),
        modelManagerList: document.getElementById("modelManagerList"),
        modelInput: document.getElementById("modelInput"),
        modelEditHint: document.getElementById("modelEditHint"),
        modelAddError: document.getElementById("modelAddError"),
      };
      let isComposing = false;
      let lastCompositionEndAt = 0;
      const compositionEnterGuardMs = 150;
      const autoApplyConfigRetryMs = 30000;
      let lastAutoApplyConfigKey = "";
      let lastAutoApplyConfigAt = 0;
      const assistantRedirects = {};
      let toastTimer = null;
      let runStreamExportPending = false;
      let historySessionExportPendingKey = "";
      let resizeFrame = 0;
      const TAB_RUNTIME_DEFAULT_KEY = "__default__";
      const conversationRuntimeByTabId = Object.create(null);
      let runWaitTimer = null;
      let runWaitStartAt = 0;
      let runStreamStaleTimer = null;
      let lastScrollToBottomVisible = false;
      let followLatestMessages = true;
      let suppressScrollButtonUntil = 0;
      const queuePromptPreviewLimit = 200;
      const queuePromptPreviewSuffix = "...";
      const CHAT_BOTTOM_THRESHOLD_PX = 50;
      const AUTO_SCROLL_BUTTON_SUPPRESS_MS = 240;
      const RUN_STREAM_PREVIEW_MAX_LENGTH = 220;
      const RUN_STREAM_AUTO_SCROLL_THRESHOLD_PX = 50;
      const RUN_STREAM_MAX_RECORDS = 2000;
      const RUN_STREAM_MAX_BYTES = 8 * 1024 * 1024;
      const RUN_STREAM_STALE_THRESHOLD_MULTIPLIER = 1.5;
      const RUN_STREAM_STALE_WARNING_BASE_MS = 30 * 1000;
      const RUN_STREAM_STALE_CRITICAL_BASE_MS = 2 * 60 * 1000;
      const RUN_STREAM_STALE_WARNING_MS = RUN_STREAM_STALE_WARNING_BASE_MS * RUN_STREAM_STALE_THRESHOLD_MULTIPLIER;
      const RUN_STREAM_STALE_CRITICAL_MS = RUN_STREAM_STALE_CRITICAL_BASE_MS * RUN_STREAM_STALE_THRESHOLD_MULTIPLIER;
      const RUN_STREAM_STALE_REFRESH_INTERVAL_MS = 1000;
      const CONVERSATION_TAB_PAGE_SIZE = 5;
      const LOOP_EXECUTION_MODE_MAIN_SUB_MULTI_AGENT = "\${LOOP_EXECUTION_MODE_MAIN_SUB_MULTI_AGENT}";
      const LOOP_EXECUTION_MODE_DEBATE_MULTI_AGENT = "\${LOOP_EXECUTION_MODE_DEBATE_MULTI_AGENT}";
      const runningTabStartedAtById = Object.create(null);
      const erroredTabIds = new Set();
      const loopMetaByTabId = Object.create(null);
      const graphMetaByTabId = Object.create(null);
      let conversationTabPageIndex = 0;
      let conversationTabPageAnchorTabId = null;

      function normalizeLoopExecutionMode(value) {
        return value === LOOP_EXECUTION_MODE_DEBATE_MULTI_AGENT
          ? LOOP_EXECUTION_MODE_DEBATE_MULTI_AGENT
          : LOOP_EXECUTION_MODE_MAIN_SUB_MULTI_AGENT;
      }

      function normalizeLoopExecutionModeByCli(value, fallbackByCli) {
        const nextByCli = {};
        const hasIncomingByCli = Boolean(value && typeof value === "object");
        CLI_NAMES.forEach((cli) => {
          const hasIncomingCli = hasIncomingByCli && Object.prototype.hasOwnProperty.call(value, cli);
          const candidate = hasIncomingCli ? value[cli] : undefined;
          const fallback = !hasIncomingByCli && fallbackByCli && typeof fallbackByCli === "object"
            ? fallbackByCli[cli]
            : undefined;
          nextByCli[cli] = normalizeLoopExecutionMode(hasIncomingCli ? candidate : fallback);
        });
        return nextByCli;
      }

      function getLoopExecutionModeForCli(cli = state.currentCli) {
        return normalizeLoopExecutionMode(
          state.loopExecutionModeByCli && state.loopExecutionModeByCli[cli]
        );
      }

      function setLoopExecutionModeForCli(cli, value) {
        const normalized = normalizeLoopExecutionMode(value);
        state.loopExecutionModeByCli = normalizeLoopExecutionModeByCli(
          state.loopExecutionModeByCli,
          state.loopExecutionModeByCli
        );
        state.loopExecutionModeByCli[cli] = normalized;
        return normalized;
      }

      function normalizeLoopSubtaskMaxThinkingMode(value) {
        return ["low", "medium", "high", "xhigh"].includes(value)
          ? value
          : LOOP_SUBTASK_MAX_THINKING_MODE_DEFAULT;
      }

      function normalizeLoopMaxRounds(value) {
        const numeric = typeof value === "number"
          ? value
          : (typeof value === "string" && value.trim() ? Number(value) : NaN);
        if (!Number.isFinite(numeric)) {
          return \${LOOP_MAX_ROUNDS_SETTING_DEFAULT};
        }
        return Math.min(
          Math.max(Math.floor(numeric), \${LOOP_MAX_ROUNDS_SETTING_MIN}),
          \${LOOP_MAX_ROUNDS_SETTING_MAX}
        );
      }

`;
