// Primary UI event bindings and conversation reset controls.
export const VIEW_CONTENT_SCRIPT_EVENT_BINDINGS = `      [
          elements.helpButton,
          elements.toolSettingsButton,
          elements.rulesButton,
          elements.newSession,
          elements.resetSession,
          elements.commonCommandButton,
          elements.pathPickerButton,
          elements.attachmentButton,
          elements.historyButton,
        ].filter(Boolean).forEach((element) => {
          element.addEventListener("keydown", (event) => {
            if (event.key !== "Enter" && event.key !== " ") {
              return;
            }
            if (element.getAttribute("aria-disabled") === "true") {
              return;
            }
            event.preventDefault();
            element.click();
          });
        });

      elements.currentCli.addEventListener("change", (event) => {
        armPromptContextForConversationStart();
        const nextCli = event.target.value;
        clearOpenCodeModelOptions();
        syncModelSelectorByInteractiveMode(nextCli);
        vscode.postMessage({ type: "selectCli", cli: nextCli });
      });

      elements.configSelect.addEventListener("change", (event) => {
        state.selectedConfigId = event.target.value || "";
        state.selectedModel = "";
        if (state.selectedModelsByCli) {
          state.selectedModelsByCli[state.currentCli] = "";
        }
        if (state.modelsByCli) {
          state.modelsByCli[state.currentCli] = [];
        }
        if (state.managedModelsByCli) {
          state.managedModelsByCli[state.currentCli] = [];
        }
        if (elements.modelSelect) {
          updateModelSelectOptions();
        }
        clearOpenCodeModelOptions();
        if (elements.addModelOverlay && elements.addModelOverlay.classList.contains("visible")) {
          renderModelManagerList();
        }
        if (!state.selectedConfigId) {
          return;
        }
        vscode.postMessage({
          type: "applyConfig",
          cli: state.currentCli,
          configId: state.selectedConfigId,
        });
      });

      function resetActiveViewForNewConversation() {
        setMessagesForTab(getActiveConversationTabId(), []);
        renderMessages();
        renderTaskList();
      }

      function syncResetSessionAvailability() {
        const resetLocked = isActiveConversationTabResetLocked();
        if (elements.resetSession) {
          elements.resetSession.disabled = resetLocked;
          elements.resetSession.setAttribute("aria-disabled", String(resetLocked));
          elements.resetSession.tabIndex = resetLocked ? -1 : 0;
        }
        if (elements.clearAllHistory) {
          elements.clearAllHistory.disabled = state.historyTab === "sessions" && resetLocked;
        }
      }

      function requestResetConversationTabSession() {
        if (isActiveConversationTabResetLocked()) {
          return;
        }
        armPromptContextForConversationStart();
        vscode.postMessage({ type: "resetConversationTabSession" });
      }

      elements.newSession.addEventListener("click", () => {
        applyAutoInteractiveModeForTab(null);
        resetActiveViewForNewConversation();
        armPromptContextForConversationStart();
        vscode.postMessage({ type: "newSession" });
      });

      if (elements.resetSession) {
        elements.resetSession.addEventListener("click", () => {
          requestResetConversationTabSession();
        });
      }

      if (elements.taskListDetails) {
        elements.taskListDetails.addEventListener("toggle", () => {
          const taskListState = getActiveTaskListState({ create: false });
          const hasItems = Boolean(taskListState && Array.isArray(taskListState.items) && taskListState.items.length);
          if (taskListState) {
            taskListState.open = hasItems ? elements.taskListDetails.open : false;
          }
        });
      }

      if (elements.resultOnlyToggle) {
        elements.resultOnlyToggle.addEventListener("change", (event) => {
          state.onlyShowFinalResults = Boolean(event.target.checked);
          persistWebviewUiState();
          renderMessages();
        });
      }

      function handleOpenCodeThinkingModeChange(role, rawValue) {
        const thinkingState = role === "small" ? state.openCodeSmallThinking : state.openCodeThinking;
        const selectedVariant = typeof rawValue === "string" && rawValue.trim() ? rawValue.trim() : null;
        const configuredDefaultVariant = thinkingState
          ? thinkingState.configuredDefaultVariant
          : null;
        const value = selectedVariant && selectedVariant === configuredDefaultVariant
          ? null
          : selectedVariant;
        if (thinkingState) {
          thinkingState.selectedVariant = value;
        }
        vscode.postMessage({
          type: "updateOpenCodeVariant",
          role,
          value,
        });
      }

      function handleThinkingModeChange(rawValue) {
        if (state.currentCli === "opencode") {
          handleOpenCodeThinkingModeChange("primary", rawValue);
          return;
        }
        const nextMode = rawValue || "off";
        state.thinkingMode = nextMode;
        vscode.postMessage({
          type: "updateSetting",
          key: "thinkingMode",
          value: nextMode,
        });
      }

      elements.thinkingMode.addEventListener("change", (event) => {
        handleThinkingModeChange(event.target.value);
      });
      if (elements.openCodePrimaryThinkingMode) {
        elements.openCodePrimaryThinkingMode.addEventListener("change", (event) => {
          handleOpenCodeThinkingModeChange("primary", event.target.value);
        });
      }
      if (elements.openCodeSmallThinkingMode) {
        elements.openCodeSmallThinkingMode.addEventListener("change", (event) => {
          handleOpenCodeThinkingModeChange("small", event.target.value);
        });
      }

      function handleOpenCodeRoleModelChange(role, rawValue) {
        const selectedRef = typeof rawValue === "string" && rawValue.trim() ? rawValue.trim() : null;
        const configRef = state.openCodeModels
          ? (role === "small" ? state.openCodeModels.configSmallRef : state.openCodeModels.configPrimaryRef)
          : null;
        const value = selectedRef && selectedRef === configRef ? null : selectedRef;
        if (state.openCodeModels) {
          if (role === "small") {
            state.openCodeModels.selectedSmallRef = selectedRef;
            state.openCodeSmallThinking = {
              selectedVariant: null,
              configuredDefaultVariant: null,
              options: [],
              disabled: true,
              messageKey: "loading",
            };
          } else {
            state.openCodeModels.selectedPrimaryRef = selectedRef;
            state.openCodeThinking = {
              selectedVariant: null,
              configuredDefaultVariant: null,
              options: [],
              disabled: true,
              messageKey: "loading",
            };
          }
          syncThinkingOptions();
        }
        vscode.postMessage({
          type: "updateOpenCodeRoleModel",
          role,
          value,
        });
      }

      if (elements.openCodePrimaryModelSelect) {
        elements.openCodePrimaryModelSelect.addEventListener("change", (event) => {
          handleOpenCodeRoleModelChange("primary", event.target.value);
        });
      }

      if (elements.openCodeSmallModelSelect) {
        elements.openCodeSmallModelSelect.addEventListener("change", (event) => {
          handleOpenCodeRoleModelChange("small", event.target.value);
        });
      }

      // Model selection management
      const MODEL_MANAGE_OPTION_VALUE = "__manage__";
      let editingModelName = "";

`;
