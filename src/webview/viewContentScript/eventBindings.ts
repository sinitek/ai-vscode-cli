// Primary UI event bindings and conversation reset controls.
export const VIEW_CONTENT_SCRIPT_EVENT_BINDINGS = `      elements.currentCli.addEventListener("change", (event) => {
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
        if (state.selectedLobsterMainModelsByCli) {
          state.selectedLobsterMainModelsByCli[state.currentCli] = "";
        }
        if (state.selectedLobsterSubtaskModelsByCli) {
          state.selectedLobsterSubtaskModelsByCli[state.currentCli] = "";
        }
        if (state.modelsByCli) {
          state.modelsByCli[state.currentCli] = [];
        }
        if (state.lobsterMainModelsByCli) {
          state.lobsterMainModelsByCli[state.currentCli] = [];
        }
        if (state.lobsterSubtaskModelsByCli) {
          state.lobsterSubtaskModelsByCli[state.currentCli] = [];
        }
        if (state.managedModelsByCli) {
          state.managedModelsByCli[state.currentCli] = [];
        }
        if (state.managedModelRolesByCli) {
          state.managedModelRolesByCli[state.currentCli] = {};
        }
        if (elements.modelSelect) {
          updateModelSelectOptions();
        }
        clearOpenCodeModelOptions();
        updateLobsterModelSelectOptions();
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
        }
        if (elements.clearAllHistory) {
          elements.clearAllHistory.disabled = state.historyTab === "lobster" || (state.historyTab === "sessions" && resetLocked);
        }
      }

      function requestResetConversationTabSession() {
        if (isActiveConversationTabResetLocked()) {
          return;
        }
        applyAutoInteractiveModeForTab(null);
        const activeTabId = getActiveConversationTabId();
        if (activeTabId) {
          resetConversationRuntimeState(activeTabId);
        }
        resetActiveViewForNewConversation();
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

      function handleThinkingModeChange(rawValue) {
        if (state.currentCli === "opencode") {
          const selectedVariant = typeof rawValue === "string" && rawValue.trim() ? rawValue.trim() : null;
          const configuredDefaultVariant = state.openCodeThinking
            ? state.openCodeThinking.configuredDefaultVariant
            : null;
          const value = selectedVariant && selectedVariant === configuredDefaultVariant
            ? null
            : selectedVariant;
          if (state.openCodeThinking) {
            state.openCodeThinking.selectedVariant = value;
          }
          vscode.postMessage({
            type: "updateOpenCodeVariant",
            value,
          });
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

      function handleOpenCodeRoleModelChange(role, rawValue) {
        const selectedRef = typeof rawValue === "string" && rawValue.trim() ? rawValue.trim() : null;
        const configRef = state.openCodeModels
          ? (role === "small" ? state.openCodeModels.configSmallRef : state.openCodeModels.configPrimaryRef)
          : null;
        const value = selectedRef && selectedRef === configRef ? null : selectedRef;
        if (state.openCodeModels) {
          if (role === "small") {
            state.openCodeModels.selectedSmallRef = selectedRef;
          } else {
            state.openCodeModels.selectedPrimaryRef = selectedRef;
            state.openCodeThinking = {
              selectedVariant: null,
              configuredDefaultVariant: null,
              options: [],
              disabled: true,
              messageKey: "loading",
            };
            syncThinkingOptions();
          }
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
