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

      function getActiveLoopMainTaskId() {
        const conversationTabs = state.conversationTabs && Array.isArray(state.conversationTabs.tabs)
          ? state.conversationTabs
          : { activeTabId: null, tabs: [] };
        const activeTab = conversationTabs.tabs.find((tab) => tab && tab.id === conversationTabs.activeTabId);
        if (!activeTab || activeTab.loopTaskRole !== "main") {
          return "";
        }
        return typeof activeTab.loopTaskId === "string" ? activeTab.loopTaskId.trim() : "";
      }

      function syncOpenCurrentLoopGroupChatButton() {
        if (!elements.openCurrentLoopGroupChat) {
          return;
        }
        const taskId = getActiveLoopMainTaskId();
        elements.openCurrentLoopGroupChat.style.display = taskId ? "inline-flex" : "none";
        elements.openCurrentLoopGroupChat.disabled = !taskId;
        if (elements.runWait) {
          elements.runWait.classList.toggle("has-current-loop-group-chat", Boolean(taskId));
        }
        if (typeof updateRunWait === "function") {
          updateRunWait();
        }
      }

      function openCurrentLoopGroupChat() {
        const taskId = getActiveLoopMainTaskId();
        if (!taskId) {
          return;
        }
        vscode.postMessage({ type: "openLoopGroupChat", taskId });
      }

      function getActiveGraphRunId() {
        const conversationTabs = state.conversationTabs && Array.isArray(state.conversationTabs.tabs)
          ? state.conversationTabs
          : { activeTabId: null, tabs: [] };
        const activeTab = conversationTabs.tabs.find((tab) => tab && tab.id === conversationTabs.activeTabId);
        const meta = typeof getGraphMetaForTabSummary === "function"
          ? getGraphMetaForTabSummary(activeTab)
          : null;
        return meta && typeof meta.graphRunId === "string" ? meta.graphRunId.trim() : "";
      }

      function syncOpenCurrentGraphRunButton() {
        if (!elements.openCurrentGraphRun) {
          return;
        }
        const graphRunId = getActiveGraphRunId();
        elements.openCurrentGraphRun.style.display = graphRunId ? "inline-flex" : "none";
        elements.openCurrentGraphRun.disabled = !graphRunId;
        if (elements.runWait) {
          elements.runWait.classList.toggle("has-current-graph-run", Boolean(graphRunId));
        }
        if (typeof updateRunWait === "function") {
          updateRunWait();
        }
      }

      function openCurrentGraphRun() {
        const graphRunId = getActiveGraphRunId();
        if (!graphRunId) {
          return;
        }
        vscode.postMessage({ type: "openGraphRun", graphRunId });
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
      if (elements.multiAgentEnabled) {
        elements.multiAgentEnabled.addEventListener("change", (event) => {
          const enabled = Boolean(event.target.checked);
          state.multiAgentEnabled = enabled;
          vscode.postMessage({
            type: "updateSetting",
            key: "multiAgentEnabled",
            value: enabled,
          });
        });
      }
      if (elements.loopMaxRounds) {
        const commitLoopMaxRounds = () => {
          const nextValue = normalizeLoopMaxRounds(elements.loopMaxRounds.value);
          state.loopMaxRounds = nextValue;
          elements.loopMaxRounds.value = String(nextValue);
          vscode.postMessage({
            type: "updateSetting",
            key: "loopMaxRounds",
            value: nextValue,
          });
        };
        elements.loopMaxRounds.addEventListener("change", commitLoopMaxRounds);
        elements.loopMaxRounds.addEventListener("blur", commitLoopMaxRounds);
      }
      if (elements.loopSubtaskMaxThinkingMode) {
        elements.loopSubtaskMaxThinkingMode.addEventListener("change", (event) => {
          const nextValue = normalizeLoopSubtaskMaxThinkingMode(event.target.value);
          state.loopSubtaskMaxThinkingMode = nextValue;
          elements.loopSubtaskMaxThinkingMode.value = nextValue;
          vscode.postMessage({
            type: "updateSetting",
            key: "loopSubtaskMaxThinkingMode",
            value: nextValue,
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
        const isSessions = !isPrompts;
        state.historyTab = isPrompts ? "prompts" : "sessions";
        elements.historyTabPrompts.classList.toggle("active", isPrompts);
        elements.historyTabSessions.classList.toggle("active", isSessions);
        elements.historyTabPrompts.setAttribute("aria-selected", String(isPrompts));
        elements.historyTabSessions.setAttribute("aria-selected", String(isSessions));
        elements.historyPanelPrompts.classList.toggle("active", isPrompts);
        elements.historyPanelSessions.classList.toggle("active", isSessions);
        if (elements.clearAllHistory) {
          elements.clearAllHistory.textContent = isPrompts
            ? t("historyClearPrompts")
            : t("historyClearSessions");
        }
        syncResetSessionAvailability();
      }

      function setHelpTab(tab) {
        const isModes = tab === "modes";
        const isInstall = tab === "install";
        const isThinking = tab === "thinking";
        elements.helpTabModes.classList.toggle("active", isModes);
        elements.helpTabInstall.classList.toggle("active", isInstall);
        elements.helpTabThinking.classList.toggle("active", isThinking);
        elements.helpTabModes.setAttribute("aria-selected", String(isModes));
        elements.helpTabInstall.setAttribute("aria-selected", String(isInstall));
        elements.helpTabThinking.setAttribute("aria-selected", String(isThinking));
        elements.helpPanelModes.classList.toggle("active", isModes);
        elements.helpPanelInstall.classList.toggle("active", isInstall);
        elements.helpPanelThinking.classList.toggle("active", isThinking);
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

      function setRulesLoadCliOptions(isGlobal) {
        const currentValue = elements.rulesLoadCli.value;
        const options = isGlobal
          ? [
              { value: "codex", label: "codex" },
              { value: "claude", label: "claude" },
              { value: "opencode", label: "opencode" },
            ]
          : [
              { value: "codex", label: "codex/opencode" },
              { value: "claude", label: "claude" },
            ];
        elements.rulesLoadCli.innerHTML = "";
        options.forEach((option) => {
          const optionElement = document.createElement("option");
          optionElement.value = option.value;
          optionElement.textContent = option.label;
          elements.rulesLoadCli.appendChild(optionElement);
        });
        const nextValue = options.some((option) => option.value === currentValue) ? currentValue : options[0].value;
        elements.rulesLoadCli.value = nextValue;
      }

      function syncRulesSaveOptions(isGlobal) {
        if (elements.rulesSaveCodexLabel) {
          elements.rulesSaveCodexLabel.textContent = isGlobal ? "codex" : "codex/opencode";
        }
        if (elements.rulesSaveOpenCodeOption) {
          elements.rulesSaveOpenCodeOption.style.display = isGlobal ? "" : "none";
        }
        if (!isGlobal && elements.rulesSaveOpenCode) {
          elements.rulesSaveOpenCode.checked = false;
        }
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
        setRulesLoadCliOptions(isGlobal);
        syncRulesSaveOptions(isGlobal);
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
          requestResetConversationTabSession();
        });
      }

      elements.historyTabPrompts.addEventListener("click", () => {
        setHistoryTab("prompts");
      });

      elements.historyTabSessions.addEventListener("click", () => {
        setHistoryTab("sessions");
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
        setHelpTab("modes");
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
        if (isLoopMainConversationTabRunning(getActiveConversationTabId())) {
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

      if (elements.openCurrentLoopGroupChat) {
        elements.openCurrentLoopGroupChat.addEventListener("click", () => {
          openCurrentLoopGroupChat();
        });
      }

      if (elements.openCurrentGraphRun) {
        elements.openCurrentGraphRun.addEventListener("click", () => {
          openCurrentGraphRun();
        });
      }

      if (elements.conversationTabs) {
        elements.conversationTabs.addEventListener("click", () => {
          window.setTimeout(syncOpenCurrentLoopGroupChatButton, 0);
          window.setTimeout(syncOpenCurrentGraphRunButton, 0);
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

      elements.helpTabModes.addEventListener("click", () => {
        setHelpTab("modes");
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
