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

      function normalizeOpenCodeThinkingPayload(payload) {
        const normalized = {
          selectedVariant: null,
          configuredDefaultVariant: null,
          options: [],
          disabled: false,
          messageKey: "",
        };
        if (!payload || typeof payload !== "object") {
          return normalized;
        }
        const selectedVariant = typeof payload.selectedVariant === "string"
          ? payload.selectedVariant.trim()
          : "";
        normalized.selectedVariant = selectedVariant || null;
        normalized.disabled = payload.disabled === true;
        normalized.messageKey = typeof payload.messageKey === "string" ? payload.messageKey.trim() : "";
        const seen = new Set();
        if (Array.isArray(payload.options)) {
          payload.options.forEach((item) => {
            if (!item || typeof item !== "object") {
              return;
            }
            const value = typeof item.value === "string" ? item.value.trim() : "";
            if (!value || seen.has(value)) {
              return;
            }
            seen.add(value);
            const label = typeof item.label === "string" && item.label.trim()
              ? item.label.trim()
              : value;
            const source = typeof item.source === "string" && item.source.trim()
              ? item.source.trim()
              : undefined;
            normalized.options.push({ value, label, source });
          });
        }
        const configuredDefaultVariant = typeof payload.configuredDefaultVariant === "string"
          ? payload.configuredDefaultVariant.trim()
          : "";
        normalized.configuredDefaultVariant = configuredDefaultVariant && seen.has(configuredDefaultVariant)
          ? configuredDefaultVariant
          : null;
        return normalized;
      }

      function normalizeOpenCodeModelsPayload(payload) {
        const normalized = {
          models: [],
          configPrimaryRef: null,
          configSmallRef: null,
          selectedPrimaryRef: null,
          selectedSmallRef: null,
          issues: [],
        };
        if (!payload || typeof payload !== "object") {
          return normalized;
        }
        ["configPrimaryRef", "configSmallRef", "selectedPrimaryRef", "selectedSmallRef"].forEach((key) => {
          const value = typeof payload[key] === "string" ? payload[key].trim() : "";
          normalized[key] = value || null;
        });
        const seenRefs = new Set();
        if (Array.isArray(payload.models)) {
          payload.models.forEach((item) => {
            if (!item || typeof item !== "object") {
              return;
            }
            const ref = typeof item.ref === "string" ? item.ref.trim() : "";
            if (!ref || seenRefs.has(ref)) {
              return;
            }
            seenRefs.add(ref);
            const label = typeof item.label === "string" && item.label.trim()
              ? item.label.trim()
              : ref;
            normalized.models.push({
              ref,
              label,
              providerId: typeof item.providerId === "string" ? item.providerId.trim() : "",
              modelId: typeof item.modelId === "string" ? item.modelId.trim() : "",
            });
          });
        }
        if (Array.isArray(payload.issues)) {
          payload.issues.forEach((issue) => {
            if (!issue || typeof issue !== "object") {
              return;
            }
            const code = typeof issue.code === "string" ? issue.code.trim() : "";
            if (!code) {
              return;
            }
            const role = issue.role === "primary" || issue.role === "small" ? issue.role : undefined;
            const messageKey = typeof issue.messageKey === "string" && issue.messageKey.trim()
              ? issue.messageKey.trim()
              : undefined;
            normalized.issues.push({ role, code, messageKey });
          });
        }
        return normalized;
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
        });

        state.modelsByCli = nextModelsByCli;
        state.managedModelsByCli = nextManagedModelsByCli;
        state.selectedModelsByCli = nextSelectedModelsByCli;
        state.selectedModel = state.selectedModelsByCli[panelCurrentCli] || "";
      }

      function getNewlyCompletedLobsterTabIds(previousConversationTabs, nextConversationTabs) {
        const previousTabs = previousConversationTabs && Array.isArray(previousConversationTabs.tabs)
          ? previousConversationTabs.tabs
          : [];
        const nextTabs = nextConversationTabs && Array.isArray(nextConversationTabs.tabs)
          ? nextConversationTabs.tabs
          : [];
        const previousById = new Map(previousTabs.map((tab) => [tab.id, tab]));
        return nextTabs
          .filter((tab) => {
            const previous = tab && previousById.get(tab.id);
            const wasRunning = Boolean(
              previous
              && (previous.lobsterTaskRunning === true || previous.lobsterTaskStatus === "running")
            );
            return wasRunning && tab.lobsterTaskStatus === "completed";
          })
          .map((tab) => tab.id);
      }

      function applyState(panelState) {
        const previousCli = state.currentCli;
        const previousConversationTabs = state.conversationTabs || { activeTabId: null, tabs: [] };
        const previousActiveTabId = typeof previousConversationTabs.activeTabId === "string"
          ? previousConversationTabs.activeTabId
          : null;
        state.currentCli = panelState.currentCli;
        state.sessionState = panelState.sessionState;
        const nextConversationTabs = panelState.conversationTabs || { activeTabId: null, tabs: [] };
        const newlyCompletedLobsterTabIds = getNewlyCompletedLobsterTabIds(
          previousConversationTabs,
          nextConversationTabs
        );
        state.conversationTabs = nextConversationTabs;
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
        state.openCodeThinking = normalizeOpenCodeThinkingPayload(panelState.openCodeThinking);
        state.openCodeSmallThinking = normalizeOpenCodeThinkingPayload(panelState.openCodeSmallThinking);
        state.openCodeModels = normalizeOpenCodeModelsPayload(panelState.openCodeModels);
        state.interactiveMode = normalizeInteractiveMode(panelState.interactiveMode);
        const previousAutoAddEditorContextTags = Boolean(state.autoAddEditorContextTags);
        state.debug = Boolean(panelState.debug);
        state.autoAddEditorContextTags = Boolean(panelState.autoAddEditorContextTags);
        state.longTermMemoryEnabled = panelState.longTermMemoryEnabled === true;
        state.workspaceMemoryEnabled = panelState.workspaceMemoryEnabled === true;
        state.autoCompactContextAfterRun = Boolean(panelState.autoCompactContextAfterRun);
        state.codexMultiAgentEnabled = Boolean(panelState.codexMultiAgentEnabled);
        state.finalAnswerPolicy = panelState.finalAnswerPolicy === "\${FINAL_ANSWER_POLICY_SUCCESSFUL_REPLY_FALLBACK}"
          ? "\${FINAL_ANSWER_POLICY_SUCCESSFUL_REPLY_FALLBACK}"
          : "\${FINAL_ANSWER_POLICY_DEFAULT}";
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
        if (elements.modelSelect) {
          updateModelSelectOptions();
        }
        updateOpenCodeModelSelectOptions();
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
        if (elements.finalAnswerPolicy) {
          elements.finalAnswerPolicy.value = state.finalAnswerPolicy;
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
        syncOpenCurrentLobsterGroupChatButton();
        renderSessionList();
        renderPromptHistoryList();
        applyEditorContext(panelState.editorContext);
        newlyCompletedLobsterTabIds.forEach((tabId) => {
          flushPendingPromptQueue(tabId);
        });
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

      function appendThinkingOption(selectElement, value, label) {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = label;
        selectElement.appendChild(option);
      }

      function getOpenCodeThinkingOptionLabel(option) {
        const standardLabelKeys = {
          none: "openCodeThinkingOptionNone",
          minimal: "openCodeThinkingOptionMinimal",
          low: "thinkingOptionLabelLow",
          medium: "thinkingOptionLabelMedium",
          high: "thinkingOptionLabelHigh",
          xhigh: "thinkingOptionLabelXHigh",
          max: "thinkingOptionLabelMax",
          thinking: "openCodeThinkingOptionThinking",
        };
        const labelKey = standardLabelKeys[option.value];
        return labelKey ? t(labelKey) : option.label || option.value;
      }

      function getOpenCodeThinkingMessage(messageKey) {
        const messageKeys = {
          "follow-default": "openCodeThinkingMessageFollowDefault",
          loading: "openCodeThinkingMessageLoading",
          "select-model": "openCodeThinkingMessageSelectModel",
          "metadata-error": "openCodeThinkingMessageMetadataError",
          "no-variants": "openCodeThinkingMessageNoVariants",
          "config-variants": "openCodeThinkingMessageConfigVariants",
        };
        const translationKey = messageKeys[messageKey];
        return translationKey ? t(translationKey) : "";
      }

      function syncOpenCodeThinkingSelect(selectElement, payload, titleFallback) {
        if (!selectElement) {
          return normalizeOpenCodeThinkingPayload(payload);
        }
        const normalizedPayload = normalizeOpenCodeThinkingPayload(payload);
        selectElement.innerHTML = "";
        const options = normalizedPayload.disabled ? [] : normalizedPayload.options;
        const availableValues = new Set();
        options.forEach((option) => {
          availableValues.add(option.value);
          appendThinkingOption(selectElement, option.value, getOpenCodeThinkingOptionLabel(option));
        });
        const displayVariant = normalizedPayload.selectedVariant && availableValues.has(normalizedPayload.selectedVariant)
          ? normalizedPayload.selectedVariant
          : normalizedPayload.configuredDefaultVariant && availableValues.has(normalizedPayload.configuredDefaultVariant)
            ? normalizedPayload.configuredDefaultVariant
            : "";
        selectElement.value = displayVariant;
        const unavailable = normalizedPayload.disabled || options.length === 0;
        selectElement.disabled = unavailable;
        const localizedMessage = getOpenCodeThinkingMessage(normalizedPayload.messageKey);
        selectElement.title = localizedMessage
          || (unavailable ? t("openCodeThinkingMessageFollowDefault") : titleFallback);
        return normalizedPayload;
      }

      function syncOpenCodeThinkingOptions() {
        state.openCodeThinking = syncOpenCodeThinkingSelect(
          elements.openCodePrimaryThinkingMode,
          state.openCodeThinking,
          t("openCodePrimaryThinkingModeAria")
        );
        state.openCodeSmallThinking = syncOpenCodeThinkingSelect(
          elements.openCodeSmallThinkingMode,
          state.openCodeSmallThinking,
          t("openCodeSmallThinkingModeAria")
        );
        if (elements.thinkingMode) {
          elements.thinkingMode.style.display = "none";
        }
        if (elements.openCodePrimaryThinkingMode) {
          elements.openCodePrimaryThinkingMode.style.display = "";
        }
        if (elements.openCodeSmallThinkingMode) {
          elements.openCodeSmallThinkingMode.style.display = state.currentCli === "opencode" ? "" : "none";
        }
      }

      function syncGenericThinkingOptions() {
        const isCodex = state.currentCli === "codex";
        const isClaude = state.currentCli === "claude";
        elements.thinkingMode.innerHTML = "";
        elements.thinkingMode.disabled = false;
        elements.thinkingMode.title = t("thinkingModeAria");
        if (!isCodex) {
          appendThinkingOption(elements.thinkingMode, "off", t("thinkingOptionLabelOff"));
        }
        appendThinkingOption(elements.thinkingMode, "low", t("thinkingOptionLabelLow"));
        appendThinkingOption(elements.thinkingMode, "medium", t("thinkingOptionLabelMedium"));
        appendThinkingOption(elements.thinkingMode, "high", t("thinkingOptionLabelHigh"));
        if (isCodex || isClaude) {
          appendThinkingOption(elements.thinkingMode, "xhigh", t("thinkingOptionLabelXHigh"));
        }
        if (isCodex || isClaude) {
          appendThinkingOption(elements.thinkingMode, "max", t("thinkingOptionLabelMax"));
        }
        if (isCodex && state.thinkingMode === "off") {
          updateThinkingMode("low");
        }
        if (!isCodex && !isClaude && state.thinkingMode === "xhigh") {
          updateThinkingMode("high");
        }
        if (!isCodex && !isClaude && state.thinkingMode === "max") {
          updateThinkingMode("high");
        }
        elements.thinkingMode.value = state.thinkingMode;
      }

      function syncThinkingOptions() {
        if (state.currentCli === "opencode") {
          syncOpenCodeThinkingOptions();
          return;
        }
        if (elements.openCodeSmallThinkingMode) {
          elements.openCodeSmallThinkingMode.style.display = "none";
        }
        if (elements.openCodePrimaryThinkingMode) {
          elements.openCodePrimaryThinkingMode.style.display = "none";
        }
        if (elements.thinkingMode) {
          elements.thinkingMode.style.display = "";
        }
        syncGenericThinkingOptions();
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
        const visible = supported || state.currentCli === "opencode";
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
        const disabled = !visible || state.isRunning;
        elements.commonCommandButton.style.display = visible ? "inline-flex" : "none";
        elements.commonCommandButton.disabled = disabled;
        elements.commonCommandButton.setAttribute("aria-disabled", String(disabled));
        elements.commonCommandButton.tabIndex = disabled ? -1 : 0;
        if (elements.commandCompact) {
          elements.commandCompact.disabled = disabled;
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
