export function humanInteractionOtherChoiceScript(): string {
  return `
      function bindHumanInteractionOtherChoice(container, fieldId, label, kind, controls, inputClass, optionClass) {
        if (!["radio", "checkbox", "select", "multiselect"].includes(kind) || !controls.length
          || container.querySelector("[data-interaction-other-field]")) return;
        const select = kind === "select" || kind === "multiselect" ? controls[0] : null;
        const choices = select ? Array.from(select.options) : controls;
        let other = choices.find((choice) => {
          const text = select ? choice : choice.parentElement.querySelector("span");
          return /^(?:其它|其他|other)(?:\\s*[（(:：]|$)/i.test(
            String(text?.firstChild?.textContent || text?.textContent || "").trim(),
          );
        });
        if (!other) {
          const used = new Set(choices.map((choice) => choice.value));
          let value = "__sinitek_other__";
          while (used.has(value)) value += "_";
          if (select) {
            other = document.createElement("option");
            other.value = value;
            other.textContent = "其它";
            select.appendChild(other);
          } else {
            const option = document.createElement("label");
            option.className = optionClass;
            other = document.createElement("input");
            other.type = kind;
            other.name = controls[0].name;
            other.value = value;
            for (const attribute of controls[0].attributes) {
              if (attribute.name.startsWith("data-")) other.setAttribute(attribute.name, attribute.value);
            }
            const text = document.createElement("span");
            text.textContent = "其它";
            option.appendChild(other);
            option.appendChild(text);
            controls[0].parentElement.parentElement.appendChild(option);
          }
        } else if (select) {
          other.textContent = "其它";
        } else {
          const text = other.parentElement.querySelector("span");
          if (text.firstChild) text.firstChild.textContent = "其它";
          else text.textContent = "其它";
        }
        if (select && kind === "multiselect") select.size = Math.min(Math.max(select.options.length, 2), 6);
        const textarea = document.createElement("textarea");
        textarea.className = inputClass;
        textarea.rows = 3;
        textarea.placeholder = "请输入其它内容";
        textarea.setAttribute("aria-label", label + "：其它");
        textarea.setAttribute("aria-required", "true");
        textarea.setAttribute("data-interaction-other-field", fieldId);
        textarea.setAttribute("data-interaction-other-value", other.value);
        textarea.setAttribute("data-interaction-other-label", label);
        container.appendChild(textarea);
        function update(focus) {
          const selected = select ? other.selected : other.checked;
          textarea.hidden = !selected;
          textarea.disabled = !selected;
          if (selected && focus) textarea.focus();
        }
        container.addEventListener("change", (event) => {
          if (event.target === select || event.target.type === "radio" || event.target.type === "checkbox") update(true);
        });
        update(false);
      }

      function collectHumanInteractionOtherValues(form, values) {
        form.querySelectorAll("[data-interaction-other-field]").forEach((textarea) => {
          if (textarea.disabled) return;
          const id = textarea.getAttribute("data-interaction-other-field");
          const marker = textarea.getAttribute("data-interaction-other-value");
          const text = textarea.value.trim();
          if (Array.isArray(values[id])) {
            values[id] = values[id].map((value) => value === marker ? text : value).filter(Boolean);
          } else {
            values[id] = text;
          }
        });
        return values;
      }

      function humanInteractionOtherError(form) {
        const empty = Array.from(form.querySelectorAll("[data-interaction-other-field]"))
          .find((textarea) => !textarea.disabled && !textarea.value.trim());
        if (!empty) return "";
        empty.focus();
        return "请填写“" + empty.getAttribute("data-interaction-other-label") + "”的其它内容。";
      }
`;
}
