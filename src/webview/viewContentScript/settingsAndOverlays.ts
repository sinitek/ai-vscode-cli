// Tool settings, modal tabs, rules, history, and prompt input handlers.
export const VIEW_CONTENT_SCRIPT_SETTINGS_AND_OVERLAYS = `      function setToolSettingsTab(scope) {
        const workspace = scope === "workspace";
        if (elements.toolSettingsGlobalTab) {
          elements.toolSettingsGlobalTab.classList.toggle("active", !workspace);
          elements.toolSettingsGlobalTab.setAttribute("aria-selected", workspace ? "false" : "true");
        }
        if (elements.toolSettingsWorkspaceTab) {
          elements.toolSettingsWorkspaceTab.classList.toggle("active", workspace);
          elements.toolSettingsWorkspaceTab.setAttribute("aria-selected", workspace ? "true" : "false");
        }
        if (elements.toolSettingsGlobalPanel) {
          elements.toolSettingsGlobalPanel.classList.toggle("active", !workspace);
        }
        if (elements.toolSettingsWorkspacePanel) {
          elements.toolSettingsWorkspacePanel.classList.toggle("active", workspace);
        }
      }

      function getActiveLobsterMainTaskId() {
        const conversationTabs = state.conversationTabs && Array.isArray(state.conversationTabs.tabs)
          ? state.conversationTabs
          : { activeTabId: null, tabs: [] };
        const activeTab = conversationTabs.tabs.find((tab) => tab && tab.id === conversationTabs.activeTabId);
        if (!activeTab || activeTab.lobsterTaskRole !== "main") {
          return "";
        }
        return typeof activeTab.lobsterTaskId === "string" ? activeTab.lobsterTaskId.trim() : "";
      }

      function syncOpenCurrentLobsterGroupChatButton() {
        if (!elements.openCurrentLobsterGroupChat) {
          return;
        }
        const taskId = getActiveLobsterMainTaskId();
        elements.openCurrentLobsterGroupChat.style.display = taskId ? "inline-flex" : "none";
        elements.openCurrentLobsterGroupChat.disabled = !taskId;
        if (elements.runWait) {
          elements.runWait.classList.toggle("has-current-lobster-group-chat", Boolean(taskId));
        }
      }

      function openCurrentLobsterGroupChat() {
        const taskId = getActiveLobsterMainTaskId();
        if (!taskId) {
          return;
        }
        vscode.postMessage({ type: "openLobsterDebateChat", taskId });
      }

      function syncCommonCommandOptions() {
        if (!elements.commonCommandButton) {
          return;
        }
        const supported = Boolean(state.interactive && state.interactive.supported);
        const visible = state.currentCli === "opencode"
          || (supported && (state.currentCli === "claude" || state.currentCli === "codex"));
        const disabled = !visible || state.isRunning;
        elements.commonCommandButton.style.display = visible ? "inline-flex" : "none";
        elements.commonCommandButton.disabled = disabled;
        elements.commonCommandButton.setAttribute("aria-disabled", String(disabled));
        elements.commonCommandButton.tabIndex = disabled ? -1 : 0;
        if (elements.commandCompact) {
          elements.commandCompact.disabled = disabled;
        }
      }

      if (elements.toolSettingsGlobalTab) {
        elements.toolSettingsGlobalTab.addEventListener("click", () => setToolSettingsTab("global"));
      }
      if (elements.toolSettingsWorkspaceTab) {
        elements.toolSettingsWorkspaceTab.addEventListener("click", () => setToolSettingsTab("workspace"));
      }
      if (elements.autoCompactContextAfterRun) {
        elements.autoCompactContextAfterRun.addEventListener("change", (event) => {
          const enabled = Boolean(event.target.checked);
          state.autoCompactContextAfterRun = enabled;
          vscode.postMessage({
            type: "updateSetting",
            key: "autoCompactContextAfterRun",
            value: enabled,
          });
        });
      }
      if (elements.codexMultiAgentEnabled) {
        elements.codexMultiAgentEnabled.addEventListener("change", (event) => {
          const enabled = Boolean(event.target.checked);
          state.codexMultiAgentEnabled = enabled;
          vscode.postMessage({
            type: "updateSetting",
            key: "codexMultiAgentEnabled",
            value: enabled,
          });
        });
      }
      if (elements.finalAnswerPolicy) {
        elements.finalAnswerPolicy.addEventListener("change", (event) => {
          const nextValue = event.target.value === "\${FINAL_ANSWER_POLICY_SUCCESSFUL_REPLY_FALLBACK}"
            ? "\${FINAL_ANSWER_POLICY_SUCCESSFUL_REPLY_FALLBACK}"
            : "\${FINAL_ANSWER_POLICY_DEFAULT}";
          state.finalAnswerPolicy = nextValue;
          vscode.postMessage({
            type: "updateSetting",
            key: "finalAnswerPolicy",
            value: nextValue,
          });
        });
      }
      if (elements.lobsterMaxRounds) {
        const commitLobsterMaxRounds = () => {
          const nextValue = normalizeLobsterMaxRounds(elements.lobsterMaxRounds.value);
          state.lobsterMaxRounds = nextValue;
          elements.lobsterMaxRounds.value = String(nextValue);
          vscode.postMessage({
            type: "updateSetting",
            key: "lobsterMaxRounds",
            value: nextValue,
          });
        };
        elements.lobsterMaxRounds.addEventListener("change", commitLobsterMaxRounds);
        elements.lobsterMaxRounds.addEventListener("blur", commitLobsterMaxRounds);
      }
      if (elements.lobsterAutoCloseSubtaskTabs) {
        elements.lobsterAutoCloseSubtaskTabs.addEventListener("change", (event) => {
          const enabled = Boolean(event.target.checked);
          state.lobsterAutoCloseSubtaskTabs = enabled;
          vscode.postMessage({
            type: "updateSetting",
            key: "lobsterAutoCloseSubtaskTabs",
            value: enabled,
          });
        });
      }
      if (elements.languageSelect) {
        elements.languageSelect.addEventListener("change", (event) => {
          const nextValue = event.target.value || "auto";
          state.locale = nextValue;
          vscode.postMessage({
            type: "updateSetting",
            key: "locale",
            value: nextValue,
          });
        });
      }
      if (elements.macTaskShell) {
        elements.macTaskShell.addEventListener("change", (event) => {
          const nextValue = event.target.value === "bash" ? "bash" : "zsh";
          state.macTaskShell = nextValue;
          vscode.postMessage({
            type: "updateSetting",
            key: "macTaskShell",
            value: nextValue,
          });
        });
      }

      elements.openConfig.addEventListener("click", () => {
        vscode.postMessage({ type: "openConfig" });
      });

      elements.attachmentButton.addEventListener("click", () => {
        elements.attachmentInput.click();
      });

      elements.attachmentInput.addEventListener("change", (event) => {
        const input = event.target;
        if (!input || !input.files) {
          return;
        }
        handleFileSelection(input.files);
        input.value = "";
      });

      function openHistory() {
        renderSessionList();
        renderPromptHistoryList();
        renderLobsterGroupChatHistoryList();
        setHistoryTab(state.historyTab);
        elements.historyOverlay.classList.add("visible");
      }

      function closeHistory() {
        elements.historyOverlay.classList.remove("visible");
      }

      function openRules() {
        elements.rulesOverlay.classList.add("visible");
      }

      function closeRules() {
        elements.rulesOverlay.classList.remove("visible");
      }

      function openHelp() {
        elements.helpOverlay.classList.add("visible");
      }

      function closeHelp() {
        elements.helpOverlay.classList.remove("visible");
      }

      function openToolSettings() {
        elements.toolSettingsOverlay.classList.add("visible");
      }

      function closeToolSettings() {
        elements.toolSettingsOverlay.classList.remove("visible");
      }

      function openCommonCommands() {
        elements.commonCommandsOverlay.classList.add("visible");
      }

      function closeCommonCommands() {
        elements.commonCommandsOverlay.classList.remove("visible");
      }

      function setHistoryTab(tab) {
        const isPrompts = tab === "prompts";
        const isLobster = tab === "lobster";
        const isSessions = !isPrompts && !isLobster;
        state.historyTab = isPrompts ? "prompts" : isLobster ? "lobster" : "sessions";
        elements.historyTabPrompts.classList.toggle("active", isPrompts);
        elements.historyTabSessions.classList.toggle("active", isSessions);
        elements.historyTabLobsterGroupChats.classList.toggle("active", isLobster);
        elements.historyTabPrompts.setAttribute("aria-selected", String(isPrompts));
        elements.historyTabSessions.setAttribute("aria-selected", String(isSessions));
        elements.historyTabLobsterGroupChats.setAttribute("aria-selected", String(isLobster));
        elements.historyPanelPrompts.classList.toggle("active", isPrompts);
        elements.historyPanelSessions.classList.toggle("active", isSessions);
        elements.historyPanelLobsterGroupChats.classList.toggle("active", isLobster);
        if (elements.clearAllHistory) {
          elements.clearAllHistory.textContent = isPrompts
            ? t("historyClearPrompts")
            : t("historyClearSessions");
        }
        syncResetSessionAvailability();
      }

      function setHelpTab(tab) {
        const isInstall = tab === "install";
        elements.helpTabInstall.classList.toggle("active", isInstall);
        elements.helpTabThinking.classList.toggle("active", !isInstall);
        elements.helpTabInstall.setAttribute("aria-selected", String(isInstall));
        elements.helpTabThinking.setAttribute("aria-selected", String(!isInstall));
        elements.helpPanelInstall.classList.toggle("active", isInstall);
        elements.helpPanelThinking.classList.toggle("active", !isInstall);
      }

      function setRulesHint(message) {
        elements.rulesHint.textContent = message || "";
      }

      function collectRuleTargets() {
        const targets = [];
        if (elements.rulesSaveCodex.checked) {
          targets.push("codex");
        }
        if (elements.rulesSaveClaude.checked) {
          targets.push("claude");
        }
        if (elements.rulesSaveOpenCode.checked) {
          targets.push("opencode");
        }
        return targets;
      }

      function updateRulesPath(cli) {
        if (!elements.rulesPath) {
          return;
        }
        const scopePaths = state.rulePaths ? state.rulePaths[state.ruleScope] : null;
        const pathText = scopePaths && scopePaths[cli] ? scopePaths[cli] : "";
        if (!pathText && state.ruleScope === "project") {
          elements.rulesPath.textContent = t("rulesPathNoWorkspace");
          return;
        }
        elements.rulesPath.textContent = pathText ? t("rulesPathPrefix") + pathText : "";
      }

      function updateRulesScope(scope) {
        state.ruleScope = scope;
        const isGlobal = scope === "global";
        elements.scopeGlobal.className = isGlobal ? "help-tab active" : "help-tab";
        elements.scopeProject.className = isGlobal ? "help-tab" : "help-tab active";
        elements.scopeGlobal.setAttribute("aria-selected", String(isGlobal));
        elements.scopeProject.setAttribute("aria-selected", String(!isGlobal));
        updateRulesPath(elements.rulesLoadCli.value);
      }

      elements.historyButton.addEventListener("click", () => {
        openHistory();
      });

      elements.closeHistory.addEventListener("click", () => {
        closeHistory();
      });

      elements.closeHistoryMessages.addEventListener("click", () => {
        closeHistorySessionMessages();
      });

      elements.exportHistoryMessages.addEventListener("click", () => {
        requestHistorySessionExport(null);
      });

      if (elements.clearAllHistory) {
        elements.clearAllHistory.addEventListener("click", () => {
          if (state.historyTab === "prompts") {
            vscode.postMessage({ type: "clearPromptHistory" });
            return;
          }
          if (state.historyTab === "lobster") {
            return;
          }
          requestResetConversationTabSession();
        });
      }

      elements.historyTabPrompts.addEventListener("click", () => {
        setHistoryTab("prompts");
      });

      elements.historyTabSessions.addEventListener("click", () => {
        setHistoryTab("sessions");
      });

      elements.historyTabLobsterGroupChats.addEventListener("click", () => {
        setHistoryTab("lobster");
      });

      elements.historyOverlay.addEventListener("click", (event) => {
        if (event.target === elements.historyOverlay) {
          closeHistory();
        }
      });

      elements.historyMessagesOverlay.addEventListener("click", (event) => {
        if (event.target === elements.historyMessagesOverlay) {
          closeHistorySessionMessages();
        }
      });

      elements.rulesButton.addEventListener("click", () => {
        setRulesHint("");
        updateRulesScope(state.ruleScope);
        openRules();
      });

      elements.closeRules.addEventListener("click", () => {
        closeRules();
      });

      elements.rulesOverlay.addEventListener("click", (event) => {
        if (event.target === elements.rulesOverlay) {
          closeRules();
        }
      });

      elements.helpButton.addEventListener("click", () => {
        setHelpTab("install");
        openHelp();
      });

      elements.closeHelp.addEventListener("click", () => {
        closeHelp();
      });

      elements.helpOverlay.addEventListener("click", (event) => {
        if (event.target === elements.helpOverlay) {
          closeHelp();
        }
      });

      elements.toolSettingsButton.addEventListener("click", () => {
        openToolSettings();
      });

      elements.closeToolSettings.addEventListener("click", () => {
        closeToolSettings();
      });

      elements.toolSettingsOverlay.addEventListener("click", (event) => {
        if (event.target === elements.toolSettingsOverlay) {
          closeToolSettings();
        }
      });

      elements.commonCommandButton.addEventListener("click", () => {
        if (elements.commonCommandButton.getAttribute("aria-disabled") === "true") {
          return;
        }
        openCommonCommands();
      });

      elements.closeCommonCommands.addEventListener("click", () => {
        closeCommonCommands();
      });

      elements.commonCommandsOverlay.addEventListener("click", (event) => {
        if (event.target === elements.commonCommandsOverlay) {
          closeCommonCommands();
        }
      });

      elements.commandCompact.addEventListener("click", () => {
        closeCommonCommands();
        vscode.postMessage({ type: "runCommonCommand", command: "compactContext" });
      });

      elements.runConflictOverlay.addEventListener("click", (event) => {
        if (event.target === elements.runConflictOverlay) {
          closeRunConflictOverlay();
        }
      });

      elements.closeRunConflict.addEventListener("click", () => {
        closeRunConflictOverlay();
      });

      elements.queuePrompt.addEventListener("click", () => {
        const runtimeState = getActiveConversationRuntimeState({ create: false });
        const promptPayload = normalizePromptPayload(runtimeState ? runtimeState.pendingRunPrompt : null);
        if (!promptPayload) {
          closeRunConflictOverlay();
          return;
        }
        queuePromptForLater(promptPayload);
        elements.promptInput.value = "";
        closeRunConflictOverlay();
        resetPromptContextForNextPrompt();
      });

      elements.pauseAndSend.addEventListener("click", () => {
        const runtimeState = getActiveConversationRuntimeState({ create: false });
        const promptPayload = normalizePromptPayload(runtimeState ? runtimeState.pendingRunPrompt : null);
        if (!promptPayload) {
          closeRunConflictOverlay();
          return;
        }
        elements.promptInput.value = "";
        closeRunConflictOverlay();
        if (isLobsterMainConversationTabRunning(getActiveConversationTabId())) {
          queuePromptForLater(promptPayload);
          resetPromptContextForNextPrompt();
          return;
        }
        const sent = dispatchPrompt(promptPayload);
        if (sent) {
          resetPromptContextForNextPrompt();
        }
      });

      elements.queueIndicator.addEventListener("click", () => {
        openQueueOverlay();
      });

      elements.continueQueue.addEventListener("click", () => {
        continueQueuedPrompts();
      });

      elements.runPromptButton.addEventListener("click", () => {
        openRunPromptOverlay();
      });

      if (elements.openCurrentLobsterGroupChat) {
        elements.openCurrentLobsterGroupChat.addEventListener("click", () => {
          openCurrentLobsterGroupChat();
        });
      }

      if (elements.conversationTabs) {
        elements.conversationTabs.addEventListener("click", () => {
          window.setTimeout(syncOpenCurrentLobsterGroupChatButton, 0);
        });
      }

      elements.runStreamButton.addEventListener("click", () => {
        openRunStreamOverlay();
      });

      elements.exportRunStream.addEventListener("click", () => {
        requestRunStreamExport();
      });

      elements.runPromptOverlay.addEventListener("click", (event) => {
        if (event.target === elements.runPromptOverlay) {
          closeRunPromptOverlay();
        }
      });

      elements.closeRunPrompt.addEventListener("click", () => {
        closeRunPromptOverlay();
      });

      elements.runStreamOverlay.addEventListener("click", (event) => {
        if (event.target === elements.runStreamOverlay) {
          closeRunStreamOverlay();
        }
      });

      elements.closeRunStream.addEventListener("click", () => {
        closeRunStreamOverlay();
      });

      elements.configApplyErrorOverlay.addEventListener("click", (event) => {
        if (event.target === elements.configApplyErrorOverlay) {
          closeConfigApplyErrorOverlay();
        }
      });

      elements.closeConfigApplyError.addEventListener("click", () => {
        closeConfigApplyErrorOverlay();
      });

      elements.copyConfigApplyError.addEventListener("click", () => {
        const detail = elements.configApplyErrorContent
          ? String(elements.configApplyErrorContent.textContent || "")
          : "";
        if (!detail.trim()) {
          return;
        }
        copyTextToClipboard(detail, t("toastConfigApplyErrorCopied"));
      });

      elements.queueOverlay.addEventListener("click", (event) => {
        if (event.target === elements.queueOverlay) {
          closeQueueOverlay();
        }
      });

      elements.closeQueue.addEventListener("click", () => {
        closeQueueOverlay();
      });

      elements.helpTabInstall.addEventListener("click", () => {
        setHelpTab("install");
      });

      elements.helpTabThinking.addEventListener("click", () => {
        setHelpTab("thinking");
      });

      elements.loadRules.addEventListener("click", () => {
        const cli = elements.rulesLoadCli.value;
        setRulesHint(t("rulesHintLoading"));
        vscode.postMessage({ type: "loadRules", cli, scope: state.ruleScope });
      });

      elements.rulesLoadCli.addEventListener("change", (event) => {
        updateRulesPath(event.target.value);
      });

      elements.scopeGlobal.addEventListener("click", () => {
        updateRulesScope("global");
        setRulesHint("");
      });

      elements.scopeProject.addEventListener("click", () => {
        updateRulesScope("project");
        setRulesHint("");
      });

      elements.saveRules.addEventListener("click", () => {
        const targets = collectRuleTargets();
        if (!targets.length) {
          setRulesHint(t("rulesHintSelectCli"));
          return;
        }
        const content = elements.rulesInput.value || "";
        setRulesHint(t("rulesHintSaving"));
        vscode.postMessage({ type: "saveRules", content, targets, scope: state.ruleScope });
      });

      elements.sendPrompt.addEventListener("click", () => {
        sendPrompt();
      });

      elements.pathPickerButton.addEventListener("click", () => {
        requestWorkspacePathPick();
      });

      elements.scrollToBottomButton.addEventListener("click", () => {
        stickChatToBottom("smooth");
      });

      elements.chatArea.addEventListener("scroll", () => {
        if (shouldForceFollowLatestMessagesForActiveTab()) {
          followLatestMessages = true;
        } else if (!isScrollButtonSuppressed()) {
          followLatestMessages = isChatNearBottom();
        }
        updateScrollToBottomButton();
      });

      elements.stopRun.addEventListener("click", () => {
        vscode.postMessage({ type: "stopRun" });
      });

      elements.promptInput.addEventListener("compositionstart", () => {
        isComposing = true;
      });

      elements.promptInput.addEventListener("compositionend", () => {
        isComposing = false;
        lastCompositionEndAt = Date.now();
      });

      elements.promptInput.addEventListener("keydown", (event) => {
        if (event.key === "@" && !event.ctrlKey && !event.metaKey && !event.altKey) {
          event.preventDefault();
          requestWorkspacePathPick();
          return;
        }
        if (
          event.key === "Enter"
          && !event.shiftKey
          && !event.isComposing
          && !isComposing
          && event.keyCode !== 229
          && Date.now() - lastCompositionEndAt > compositionEnterGuardMs
        ) {
          event.preventDefault();
          sendPrompt();
        }
      });

      elements.promptInput.addEventListener("paste", (event) => {
        const files = getClipboardFiles(event);
        if (!files.length) {
          return;
        }
        event.preventDefault();
        handleFileSelection(files);
      });

      elements.promptInput.addEventListener("dragover", (event) => {
        event.preventDefault();
      });

      elements.promptInput.addEventListener("drop", (event) => {
        const uris = getDropUris(event);
        if (uris.length) {
          event.preventDefault();
          vscode.postMessage({ type: "resolveDropPaths", uris });
          return;
        }
        const files = event.dataTransfer && event.dataTransfer.files
          ? Array.from(event.dataTransfer.files)
          : [];
        if (files.length) {
          event.preventDefault();
          handleFileSelection(files);
        }
      });

`;
