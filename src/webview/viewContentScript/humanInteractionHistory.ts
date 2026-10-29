// Read-only human interaction history list and details.
export const VIEW_CONTENT_SCRIPT_HUMAN_INTERACTION_HISTORY = `      function humanInteractionHistoryStatus(record) {
        if (record && record.timedOut) {
          return t("humanInteractionHistoryAuto");
        }
        return record && record.status === "completed"
          ? t("humanInteractionHistoryManual")
          : t("humanInteractionHistoryRejected");
      }

      function humanInteractionHistoryAnswer(record, field) {
        if (!record || record.status !== "completed") {
          return t("humanInteractionHistoryNoAnswer");
        }
        if (field.type === "password") {
          return t("humanInteractionHistoryPassword");
        }
        const raw = record.values && record.values[field.id];
        const values = (Array.isArray(raw) ? raw : [raw])
          .filter((value) => value !== undefined && value !== null && String(value).trim());
        if (!values.length) {
          return record.timedOut ? t("humanInteractionHistoryAuto") : t("humanInteractionHistoryNoAnswer");
        }
        if (record.timedOut && values.every((value) => value === "已隐藏")) {
          return t("humanInteractionHistoryAuto");
        }
        const labels = new Map();
        (field.options || []).forEach((option) => labels.set(option.value, option.label));
        return values.map((value) => labels.get(value) || String(value)).join("、");
      }

      function humanInteractionHistorySelectedValues(record, field) {
        if (!record || record.status !== "completed" || field.type === "password") {
          return [];
        }
        const raw = record.values && record.values[field.id];
        if (raw === true) {
          return ["__checked__"];
        }
        return (Array.isArray(raw) ? raw : [raw])
          .filter((value) => value !== undefined && value !== null && value !== "已隐藏")
          .map((value) => String(value));
      }

      function humanInteractionHistorySummary(record) {
        const fields = Array.isArray(record.formFields) ? record.formFields : [];
        const text = String((fields[0] && (fields[0].label || fields[0].id))
          || record.instruction || record.title || t("humanInteractionHistoryTitle"));
        return Array.from(text).slice(0, 50).join("");
      }

      function renderHumanInteractionHistoryList() {
        if (!elements.humanInteractionHistoryList) {
          return;
        }
        const records = Array.isArray(state.humanInteractionHistory) ? state.humanInteractionHistory : [];
        elements.humanInteractionHistoryList.innerHTML = "";
        if (!records.length) {
          const empty = document.createElement("div");
          empty.className = "human-interaction-history-empty";
          empty.textContent = t("humanInteractionHistoryEmpty");
          elements.humanInteractionHistoryList.appendChild(empty);
          return;
        }
        records.forEach((record) => {
          const summary = humanInteractionHistorySummary(record);
          const status = humanInteractionHistoryStatus(record);
          const button = document.createElement("button");
          button.type = "button";
          button.className = "human-interaction-history-item";
          button.dataset.historyId = record.id;
          button.setAttribute("aria-label", status + " · " + summary + " · " + t("humanInteractionHistoryDetail"));
          const icon = document.createElement("span");
          icon.className = "human-interaction-history-icon" + (record.timedOut ? " automatic" : "");
          icon.title = status;
          icon.setAttribute("aria-hidden", "true");
          icon.innerHTML = record.timedOut
            ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><rect x="4" y="7" width="16" height="14" rx="3"/><path d="M12 3v4M1 12v5m22-5v5M9 17h6M8 12v1m8-1v1"/></svg>'
            : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><circle cx="12" cy="8" r="4"/><path d="M4 21v-2a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v2"/></svg>';
          const question = document.createElement("span");
          question.className = "human-interaction-history-question";
          question.textContent = summary;
          question.title = String((record.formFields || [])[0]?.label || record.title || "");
          const meta = document.createElement("span");
          meta.className = "human-interaction-history-meta";
          meta.textContent = formatDateTime(record.createdAt);
          button.appendChild(icon);
          button.appendChild(question);
          button.appendChild(meta);
          button.addEventListener("click", () => openHumanInteractionHistoryDetail(record.id));
          elements.humanInteractionHistoryList.appendChild(button);
        });
      }

      function openHumanInteractionHistory() {
        renderHumanInteractionHistoryList();
        elements.humanInteractionHistoryOverlay.classList.add("visible");
        vscode.postMessage({ type: "requestHumanInteractionHistory" });
      }

      function applyHumanInteractionHistory(items) {
        state.humanInteractionHistory = Array.isArray(items) ? items : [];
        if (elements.humanInteractionHistoryOverlay.classList.contains("visible")) {
          renderHumanInteractionHistoryList();
        }
      }

      function closeHumanInteractionHistory() {
        elements.humanInteractionHistoryOverlay.classList.remove("visible");
      }

      function openHumanInteractionHistoryDetail(id) {
        const record = (state.humanInteractionHistory || []).find((item) => item.id === id);
        if (!record) {
          return;
        }
        state.selectedHumanInteractionHistoryId = id;
        elements.humanInteractionHistoryDetailTitle.textContent = record.title || t("humanInteractionHistoryTitle");
        elements.humanInteractionHistoryDetailMeta.textContent = humanInteractionHistoryStatus(record)
          + " · " + formatDateTime(record.createdAt);
        elements.humanInteractionHistoryDetailContent.innerHTML = "";
        const instruction = document.createElement("p");
        instruction.className = "human-interaction-history-instruction";
        instruction.textContent = record.instruction || "";
        elements.humanInteractionHistoryDetailContent.appendChild(instruction);
        (record.formFields || []).forEach((field) => {
          const section = document.createElement("section");
          section.className = "human-interaction-history-detail-item";
          const question = document.createElement("div");
          question.className = "human-interaction-history-detail-question";
          question.textContent = t("humanInteractionHistoryQuestion") + "：" + (field.label || field.id);
          const answer = document.createElement("pre");
          answer.className = "human-interaction-history-detail-answer";
          answer.textContent = t("humanInteractionHistoryAnswer") + "：" + humanInteractionHistoryAnswer(record, field);
          section.appendChild(question);
          section.appendChild(answer);
          if (Array.isArray(field.options) && field.options.length) {
            const selectedValues = new Set(humanInteractionHistorySelectedValues(record, field));
            const options = document.createElement("div");
            options.className = "human-interaction-history-detail-options";
            field.options.forEach((option) => {
              const selected = selectedValues.has(String(option.value));
              const item = document.createElement("div");
              item.className = "human-interaction-history-detail-option" + (selected ? " selected" : "");
              const marker = document.createElement("span");
              marker.className = "human-interaction-history-detail-check";
              marker.setAttribute("aria-hidden", "true");
              marker.textContent = selected ? "✓" : "";
              const label = document.createElement("span");
              label.textContent = option.label;
              item.appendChild(marker);
              item.appendChild(label);
              options.appendChild(item);
            });
            section.appendChild(options);
          }
          elements.humanInteractionHistoryDetailContent.appendChild(section);
        });
        elements.humanInteractionHistoryDetailOverlay.classList.add("visible");
      }

      function closeHumanInteractionHistoryDetail() {
        state.selectedHumanInteractionHistoryId = null;
        elements.humanInteractionHistoryDetailOverlay.classList.remove("visible");
      }
`;
