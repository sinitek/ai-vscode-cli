// Model config, panel state application, controls, and scrolling.
export const VIEW_CONTENT_SCRIPT_MODEL_AND_PANEL_STATE = `      function updateAppHeight() {
        document.documentElement.style.setProperty("--app-height", window.innerHeight + "px");
      }

      function scheduleAppHeightUpdate() {
        if (resizeFrame) {
          cancelAnimationFrame(resizeFrame);
        }
        resizeFrame = requestAnimationFrame(() => {
          resizeFrame = 0;
          updateAppHeight();
        });
      }

      function normalizeModelNameList(value) {
        if (!Array.isArray(value)) {
          return [];
        }
        const seen = new Set();
        const result = [];
        value.forEach((item) => {
          const modelName = typeof item === "string" ? item.trim() : "";
          const key = modelName.toLowerCase();
          if (!modelName || seen.has(key)) {
            return;
          }
          seen.add(key);
          result.push(modelName);
        });
        return result;
      }

      function normalizeModelSelection(value) {
        return typeof value === "string" ? value.trim() : "";
      }

      function shouldPreserveCurrentCliModelsOnEmptySnapshot(cli, nextModels, nextManagedModels, previousModels, previousManagedModels) {
        if (cli !== state.currentCli) {
          return false;
        }
        if (nextModels.length > 0 || nextManagedModels.length > 0) {
          return false;
        }
        if (previousModels.length === 0 && previousManagedModels.length === 0) {
          return false;
        }
        const activeConfigId = state.configState && typeof state.configState.activeConfigId === "string"
          ? state.configState.activeConfigId
          : "";
        const selectedConfigId = typeof state.selectedConfigId === "string" ? state.selectedConfigId : "";
        if (!selectedConfigId) {
          return false;
        }
        return !activeConfigId || activeConfigId !== selectedConfigId;
      }

      function applyModelState(modelState, panelCurrentCli) {
        if (!modelState) {
          return;
        }
        const nextModelsByCli = {};
        const nextManagedModelsByCli = {};
        const nextSelectedModelsByCli = {};
        const nextLobsterMainModelsByCli = {};
        const nextLobsterSubtaskModelsByCli = {};
        const nextSelectedLobsterMainModelsByCli = {};
        const nextSelectedLobsterSubtaskModelsByCli = {};
        const nextManagedModelRolesByCli = {};

        CLI_NAMES.forEach((cli) => {
          const incomingModels = normalizeModelNameList(modelState.optionsByCli && modelState.optionsByCli[cli]);
          const incomingManagedModels = normalizeModelNameList(modelState.managedByCli && modelState.managedByCli[cli]);
          const previousModels = normalizeModelNameList(state.modelsByCli && state.modelsByCli[cli]);
          const previousManagedModels = normalizeModelNameList(state.managedModelsByCli && state.managedModelsByCli[cli]);
          const preservePrevious = shouldPreserveCurrentCliModelsOnEmptySnapshot(
            cli,
            incomingModels,
            incomingManagedModels,
            previousModels,
            previousManagedModels
          );

          nextModelsByCli[cli] = preservePrevious ? previousModels : incomingModels;
          nextManagedModelsByCli[cli] = preservePrevious ? previousManagedModels : incomingManagedModels;
          nextSelectedModelsByCli[cli] = preservePrevious
            ? normalizeModelSelection(state.selectedModelsByCli && state.selectedModelsByCli[cli])
            : normalizeModelSelection(modelState.selectedByCli && modelState.selectedByCli[cli]);
          nextLobsterMainModelsByCli[cli] = preservePrevious
            ? normalizeModelNameList(state.lobsterMainModelsByCli && state.lobsterMainModelsByCli[cli])
            : normalizeModelNameList(modelState.lobsterOptionsByCli && modelState.lobsterOptionsByCli[cli] && modelState.lobsterOptionsByCli[cli].main);
          nextLobsterSubtaskModelsByCli[cli] = preservePrevious
            ? normalizeModelNameList(state.lobsterSubtaskModelsByCli && state.lobsterSubtaskModelsByCli[cli])
            : normalizeModelNameList(modelState.lobsterOptionsByCli && modelState.lobsterOptionsByCli[cli] && modelState.lobsterOptionsByCli[cli].subtask);
          nextSelectedLobsterMainModelsByCli[cli] = preservePrevious
            ? normalizeModelSelection(state.selectedLobsterMainModelsByCli && state.selectedLobsterMainModelsByCli[cli])
            : normalizeModelSelection(modelState.selectedLobsterByCli && modelState.selectedLobsterByCli[cli] && modelState.selectedLobsterByCli[cli].main);
          nextSelectedLobsterSubtaskModelsByCli[cli] = preservePrevious
            ? normalizeModelSelection(state.selectedLobsterSubtaskModelsByCli && state.selectedLobsterSubtaskModelsByCli[cli])
            : normalizeModelSelection(modelState.selectedLobsterByCli && modelState.selectedLobsterByCli[cli] && modelState.selectedLobsterByCli[cli].subtask);
          nextManagedModelRolesByCli[cli] = preservePrevious
            ? ((state.managedModelRolesByCli && state.managedModelRolesByCli[cli]) || {})
            : ((modelState.managedLobsterRolesByCli && modelState.managedLobsterRolesByCli[cli]) || {});
        });

        state.modelsByCli = nextModelsByCli;
        state.managedModelsByCli = nextManagedModelsByCli;
        state.selectedModelsByCli = nextSelectedModelsByCli;
        state.lobsterMainModelsByCli = nextLobsterMainModelsByCli;
        state.lobsterSubtaskModelsByCli = nextLobsterSubtaskModelsByCli;
        state.selectedLobsterMainModelsByCli = nextSelectedLobsterMainModelsByCli;
        state.selectedLobsterSubtaskModelsByCli = nextSelectedLobsterSubtaskModelsByCli;
        state.managedModelRolesByCli = nextManagedModelRolesByCli;
        state.selectedModel = state.selectedModelsByCli[panelCurrentCli] || "";
      }

      function applyState(panelState) {
        const previousCli = state.currentCli;
        const previousActiveTabId = state.conversationTabs && typeof state.conversationTabs.activeTabId === "string"
          ? state.conversationTabs.activeTabId
          : null;
        state.currentCli = panelState.currentCli;
        state.sessionState = panelState.sessionState;
        state.conversationTabs = panelState.conversationTabs || { activeTabId: null, tabs: [] };
        const nextActiveTabId = state.conversationTabs && typeof state.conversationTabs.activeTabId === "string"
          ? state.conversationTabs.activeTabId
          : null;
        if (previousCli !== state.currentCli || previousActiveTabId !== nextActiveTabId) {
          state.autoAppliedConfig = false;
        }
        const tabIds = Array.isArray(state.conversationTabs.tabs)
          ? state.conversationTabs.tabs.map((tab) => tab.id)
          : [];
        pruneConversationRuntimeStates(tabIds);
        if (Array.isArray(state.conversationTabs.tabs)) {
          state.conversationTabs.tabs.forEach((tab) => {
            updateLobsterMetaForTabFromSummary(tab);
          });
        }
        syncActiveMessagesFromRuntime();
        state.promptHistory = Array.isArray(panelState.promptHistory) ? panelState.promptHistory : [];
        state.lobsterGroupChatHistory = Array.isArray(panelState.lobsterGroupChatHistory)
          ? panelState.lobsterGroupChatHistory
          : [];
        state.configState = panelState.configState || { configs: [], activeConfigId: null };
        const configs = Array.isArray(state.configState.configs)
          ? state.configState.configs
          : [];
        let nextSelected = state.configState.activeConfigId || "";
        let shouldAutoApplyConfig = false;

        // 如果后端返回的 activeConfigId 为 null，但前端已有有效选择，且该选择仍然在配置列表中，则保持前端选择
        if (!nextSelected && state.selectedConfigId) {
          const configExists = configs.some(c => c.id === state.selectedConfigId);
          if (configExists) {
            nextSelected = state.selectedConfigId;
            shouldAutoApplyConfig = true;
          }
        }

        if (!nextSelected && configs.length > 0) {
          nextSelected = configs[0].id;
          shouldAutoApplyConfig = true;
        }
        const autoApplyConfigKey = state.currentCli + ":" + nextSelected;
        const canAutoApplyConfig = shouldAutoApplyConfig && (
          !state.autoAppliedConfig
          || lastAutoApplyConfigKey !== autoApplyConfigKey
          || Date.now() - lastAutoApplyConfigAt > autoApplyConfigRetryMs
        );
        if (canAutoApplyConfig) {
          state.autoAppliedConfig = true;
          lastAutoApplyConfigKey = autoApplyConfigKey;
          lastAutoApplyConfigAt = Date.now();
          vscode.postMessage({
            type: "applyConfig",
            cli: state.currentCli,
            configId: nextSelected,
          });
        }
        state.selectedConfigId = nextSelected;
        state.thinkingMode = panelState.thinkingMode || "medium";
        state.interactiveMode = normalizeInteractiveMode(panelState.interactiveMode);
        const previousAutoAddEditorContextTags = Boolean(state.autoAddEditorContextTags);
        state.debug = Boolean(panelState.debug);
        state.autoAddEditorContextTags = Boolean(panelState.autoAddEditorContextTags);
        state.longTermMemoryEnabled = panelState.longTermMemoryEnabled === true;
        state.workspaceMemoryEnabled = panelState.workspaceMemoryEnabled === true;
        state.autoCompactContextAfterRun = Boolean(panelState.autoCompactContextAfterRun);
        state.codexMultiAgentEnabled = Boolean(panelState.codexMultiAgentEnabled);
        state.lobsterMaxRounds = normalizeLobsterMaxRounds(panelState.lobsterMaxRounds);
        state.lobsterAutoCloseSubtaskTabs = Boolean(panelState.lobsterAutoCloseSubtaskTabs);
        state.lobsterExecutionModeByCli = normalizeLobsterExecutionModeByCli(
          panelState.lobsterExecutionModeByCli,
          state.lobsterExecutionModeByCli
        );
        if (!state.autoAddEditorContextTags) {
          state.promptContext.autoIncludeArmed = true;
          state.promptContext.includeCurrentFile = false;
          state.promptContext.includeSelection = false;
          state.promptContext.dismissedFileKey = "";
          state.promptContext.dismissedSelectionKey = "";
        } else if (!previousAutoAddEditorContextTags) {
          state.promptContext.autoIncludeArmed = true;
          state.promptContext.dismissedFileKey = "";
          state.promptContext.dismissedSelectionKey = "";
        }
        state.locale = typeof panelState.locale === "string" ? panelState.locale : "auto";
        state.isMac = Boolean(panelState.isMac);
        state.macTaskShell = panelState.macTaskShell === "bash" ? "bash" : "zsh";
        state.interactive = panelState.interactive || { supported: false, enabled: false };
        state.rulePaths = panelState.rulePaths || { global: {}, project: {} };
        // Handle modelState
        if (panelState.modelState) {
          applyModelState(panelState.modelState, panelState.currentCli);
        }
        elements.currentCli.value = panelState.currentCli;
        if (elements.rulesLoadCli) {
          elements.rulesLoadCli.value = panelState.currentCli;
        }
        updateRulesScope(state.ruleScope);
        syncThinkingOptions();
        elements.thinkingMode.value = state.thinkingMode;
        if (elements.modelSelect) {
          updateModelSelectOptions();
        }
        updateLobsterModelSelectOptions();
        syncModelSelectorByInteractiveMode();
        if (elements.addModelOverlay && elements.addModelOverlay.classList.contains("visible")) {
          renderModelManagerList();
          syncModelManageForm();
        }
        if (elements.debugMode) {
          elements.debugMode.checked = state.debug;
        }
        if (elements.autoAddEditorContextTags) {
          elements.autoAddEditorContextTags.checked = state.autoAddEditorContextTags;
        }
        syncLongTermMemoryWorkspaceControl();
        if (elements.autoCompactContextAfterRun) {
          elements.autoCompactContextAfterRun.checked = state.autoCompactContextAfterRun;
        }
        if (elements.codexMultiAgentEnabled) {
          elements.codexMultiAgentEnabled.checked = state.codexMultiAgentEnabled;
        }
        if (elements.lobsterMaxRounds) {
          elements.lobsterMaxRounds.value = String(state.lobsterMaxRounds);
        }
        if (elements.lobsterAutoCloseSubtaskTabs) {
          elements.lobsterAutoCloseSubtaskTabs.checked = state.lobsterAutoCloseSubtaskTabs;
        }
        if (elements.languageSelect) {
          elements.languageSelect.value = state.locale || "auto";
        }
        if (elements.macTaskShellRow) {
          elements.macTaskShellRow.style.display = state.isMac ? "flex" : "none";
        }
        if (elements.macTaskShell) {
          elements.macTaskShell.value = state.macTaskShell;
        }
        if (elements.resultOnlyToggle) {
          elements.resultOnlyToggle.checked = state.onlyShowFinalResults;
        }
        syncInteractiveOptions();
        if (elements.interactiveModeSelect) {
          elements.interactiveModeSelect.value = state.interactiveMode;
        }
        renderConfigOptions();
        syncRunningStateForActiveTab();
        renderConversationTabs();
        renderSessionList();
        renderPromptHistoryList();
        renderLobsterGroupChatHistoryList();
        applyEditorContext(panelState.editorContext);
      }

      function renderConfigOptions() {
        elements.configSelect.innerHTML = "";
        const configs = Array.isArray(state.configState.configs)
          ? state.configState.configs
          : [];
        if (configs.length === 0) {
          const option = document.createElement("option");
          option.value = "";
          option.textContent = t("noConfigOption");
          elements.configSelect.appendChild(option);
          elements.configSelect.value = "";
          return;
        }
        configs.forEach((config) => {
          const option = document.createElement("option");
          option.value = config.id;
          option.textContent = config.name || config.id;
          elements.configSelect.appendChild(option);
        });
        elements.configSelect.value = state.selectedConfigId || "";
      }

      function syncThinkingOptions() {
        const isOpenCode = state.currentCli === "opencode";
        const isCodex = state.currentCli === "codex";
        const isClaude = state.currentCli === "claude";
        const mediumOption = elements.thinkingMode.querySelector('option[value="medium"]');
        const xhighOption = elements.thinkingMode.querySelector('option[value="xhigh"]');
        const maxOption = elements.thinkingMode.querySelector('option[value="max"]');
        if (isOpenCode && mediumOption) {
          mediumOption.remove();
        }
        if (!isOpenCode && !mediumOption) {
          const option = document.createElement("option");
          option.value = "medium";
          option.textContent = t("thinkingOptionLabelMedium");
          const highOption = elements.thinkingMode.querySelector('option[value="high"]');
          if (highOption && highOption.parentElement) {
            highOption.parentElement.insertBefore(option, highOption);
          } else {
            elements.thinkingMode.appendChild(option);
          }
        }
        const offOption = elements.thinkingMode.querySelector('option[value="off"]');
        if (isCodex && offOption) {
          offOption.remove();
        }
        if (!isCodex && !offOption) {
          const option = document.createElement("option");
          option.value = "off";
          option.textContent = t("thinkingOptionLabelOff");
          const lowOption = elements.thinkingMode.querySelector('option[value="low"]');
          if (lowOption && lowOption.parentElement) {
            lowOption.parentElement.insertBefore(option, lowOption);
          } else {
            elements.thinkingMode.appendChild(option);
          }
        }
        if (!isCodex && !isClaude && xhighOption) {
          xhighOption.remove();
        }
        if ((isCodex || isClaude) && !xhighOption) {
          const option = document.createElement("option");
          option.value = "xhigh";
          option.textContent = t("thinkingOptionLabelXHigh");
          elements.thinkingMode.appendChild(option);
        }
        if (!isClaude && maxOption) {
          maxOption.remove();
        }
        if (isClaude && !maxOption) {
          const option = document.createElement("option");
          option.value = "max";
          option.textContent = t("thinkingOptionLabelMax");
          elements.thinkingMode.appendChild(option);
        }
        if (isOpenCode && state.thinkingMode === "medium") {
          updateThinkingMode("low");
        }
        if (isCodex && state.thinkingMode === "off") {
          updateThinkingMode("low");
        }
        if (!isCodex && !isClaude && state.thinkingMode === "xhigh") {
          updateThinkingMode("high");
        }
        if (!isClaude && state.thinkingMode === "max") {
          updateThinkingMode(isCodex ? "xhigh" : "high");
        }
      }

      function syncInteractiveOptions() {
        syncInteractiveModeSelector();
        syncCommonCommandOptions();
      }

      function syncInteractiveModeSelector() {
        if (!elements.interactiveModeSelect) {
          return;
        }
        const supported = Boolean(state.interactive && state.interactive.supported);
        const visible = supported;
        elements.interactiveModeSelect.style.display = visible ? "" : "none";
        elements.interactiveModeSelect.disabled = !visible;
        elements.interactiveModeSelect.value = normalizeInteractiveMode(state.interactiveMode);
        syncModelSelectorByInteractiveMode();
      }

      function syncCommonCommandOptions() {
        if (!elements.commonCommandButton) {
          return;
        }
        const supported = Boolean(state.interactive && state.interactive.supported);
        const visible = supported && (state.currentCli === "claude" || state.currentCli === "codex");
        elements.commonCommandButton.style.display = visible ? "inline-flex" : "none";
        elements.commonCommandButton.disabled = !visible || state.isRunning;
        if (elements.commandCompact) {
          elements.commandCompact.disabled = !visible || state.isRunning;
        }
      }

      function updateThinkingMode(nextMode) {
        state.thinkingMode = nextMode;
        elements.thinkingMode.value = nextMode;
        vscode.postMessage({
          type: "updateSetting",
          key: "thinkingMode",
          value: nextMode,
        });
      }

      function getChatDistanceToBottom() {
        return elements.chatArea.scrollHeight - (elements.chatArea.scrollTop + elements.chatArea.clientHeight);
      }

      function isChatNearBottom(threshold = CHAT_BOTTOM_THRESHOLD_PX) {
        return getChatDistanceToBottom() <= threshold;
      }

      function isScrollButtonSuppressed() {
        return Date.now() < suppressScrollButtonUntil;
      }

      function scrollChatToBottom(behavior = "auto") {
        elements.chatArea.scrollTo({ top: elements.chatArea.scrollHeight, behavior });
      }

      function stickChatToBottom(behavior = "auto") {
        followLatestMessages = true;
        suppressScrollButtonUntil = Date.now() + AUTO_SCROLL_BUTTON_SUPPRESS_MS;
        updateScrollToBottomButton(true);
        scrollChatToBottom(behavior);
        requestAnimationFrame(() => {
          scrollChatToBottom("auto");
          updateScrollToBottomButton(true);
        });
        setTimeout(() => {
          updateScrollToBottomButton();
        }, AUTO_SCROLL_BUTTON_SUPPRESS_MS + 20);
      }

      function updateScrollToBottomButton(forceHide = false) {
        if (!elements.scrollToBottomButton) {
          return;
        }
        const forceFollowLatest = shouldForceFollowLatestMessagesForActiveTab();
        const hasMessages = state.messages.length > 0;
        const hasOverflow = elements.chatArea.scrollHeight > (elements.chatArea.clientHeight + 1);
        const distanceToBottom = getChatDistanceToBottom();
        const buttonSuppressed = isScrollButtonSuppressed();
        const shouldShow = !forceHide && !buttonSuppressed && hasMessages && hasOverflow && distanceToBottom > CHAT_BOTTOM_THRESHOLD_PX;
        elements.scrollToBottomButton.classList.toggle("visible", shouldShow);
        elements.scrollToBottomButton.setAttribute("aria-hidden", String(!shouldShow));
        if (elements.scrollToBottomWrap) {
          elements.scrollToBottomWrap.setAttribute("aria-hidden", String(!shouldShow));
        }
        if (state.debug && shouldShow !== lastScrollToBottomVisible) {
          const debugPayload = {
            visible: shouldShow,
            forceHide,
            forceFollowLatest,
            buttonSuppressed,
            followLatestMessages,
            distanceToBottom,
            scrollTop: elements.chatArea.scrollTop,
            scrollHeight: elements.chatArea.scrollHeight,
            clientHeight: elements.chatArea.clientHeight,
            threshold: CHAT_BOTTOM_THRESHOLD_PX,
          };
          console.debug("[scroll-to-bottom]", debugPayload);
          postWebviewDebug("scroll-to-bottom-visibility", debugPayload);
        }
        lastScrollToBottomVisible = shouldShow;
      }

`;
