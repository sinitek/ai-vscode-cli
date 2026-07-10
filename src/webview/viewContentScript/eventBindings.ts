// Primary UI event bindings and conversation reset controls.
export const VIEW_CONTENT_SCRIPT_EVENT_BINDINGS = `      elements.currentCli.addEventListener("change", (event) => {
        armPromptContextForConversationStart();
        vscode.postMessage({ type: "selectCli", cli: event.target.value });
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
          const value = typeof rawValue === "string" && rawValue !== "" ? rawValue : null;
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

      // Model selection management
      const MODEL_MANAGE_OPTION_VALUE = "__manage__";
      let editingModelName = "";

`;
