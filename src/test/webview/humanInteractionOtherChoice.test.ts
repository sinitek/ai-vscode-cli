import test = require("node:test");
import assert = require("node:assert/strict");

import { humanInteractionOtherChoiceScript } from "../../webview/humanInteractionOtherChoice";
import { orchestratorClarificationDialogScript } from "../../webview/orchestratorClarificationDialog";
import { VIEW_CONTENT_SCRIPT_SETTINGS_AND_OVERLAYS } from "../../webview/viewContentScript/settingsAndOverlays";

class ChoiceElement {
  children: ChoiceElement[] = [];
  parentElement: ChoiceElement | null = null;
  values = new Map<string, string>();
  listeners: Array<(event: { target: ChoiceElement }) => void> = [];
  className = "";
  textContent = "";
  type = "";
  name = "";
  value = "";
  checked = false;
  selected = false;
  disabled = false;
  hidden = false;
  focused = false;

  constructor(readonly tagName: string) {}

  get attributes() {
    return [...this.values].map(([name, value]) => ({ name, value }));
  }

  get options() {
    return this.children;
  }

  get firstChild() {
    return this.children[0] ?? null;
  }

  setAttribute(name: string, value: string) {
    this.values.set(name, value);
  }

  getAttribute(name: string) {
    return this.values.get(name) ?? null;
  }

  appendChild(child: ChoiceElement) {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  querySelectorAll(selector: string): ChoiceElement[] {
    const result: ChoiceElement[] = [];
    for (const child of this.children) {
      if (selector === child.tagName || child.values.has(selector.slice(1, -1))) result.push(child);
      result.push(...child.querySelectorAll(selector));
    }
    return result;
  }

  querySelector(selector: string) {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  addEventListener(_type: string, listener: (event: { target: ChoiceElement }) => void) {
    this.listeners.push(listener);
  }

  focus() {
    this.focused = true;
  }
}

function createHarness(kind: string, labels = ["预设方案"], prefix = "human", withDescription = false) {
  const container = new ChoiceElement("div");
  const select = kind === "select" || kind === "multiselect" ? container.appendChild(new ChoiceElement("select")) : null;
  const group = select ?? container.appendChild(new ChoiceElement("div"));
  const choices = labels.map((label, index) => {
    const input = new ChoiceElement(select ? "option" : "input");
    input.type = kind;
    input.name = "question";
    input.value = index === 0 ? "__sinitek_other__" : "value_" + index;
    if (select) {
      input.textContent = label;
      select.appendChild(input);
    } else {
      const wrapper = group.appendChild(new ChoiceElement("label"));
      wrapper.appendChild(input);
      const text = wrapper.appendChild(new ChoiceElement("span"));
      text.textContent = label;
      if (withDescription) {
        text.appendChild(new ChoiceElement("#text")).textContent = label;
        text.appendChild(new ChoiceElement("small")).textContent = "填写自己的方案";
        text.textContent += "填写自己的方案";
      }
    }
    input.setAttribute("data-" + prefix + "-field", "question");
    return input;
  });
  if (select) select.setAttribute("data-" + prefix + "-field", "question");
  const controls = select ? [select] : choices;
  const runtime = new Function("document", `${humanInteractionOtherChoiceScript()}
    return { bindHumanInteractionOtherChoice, collectHumanInteractionOtherValues, humanInteractionOtherError };`)(
    { createElement: (tag: string) => new ChoiceElement(tag) },
  );
  const bind = () => runtime.bindHumanInteractionOtherChoice(
    container, "question", "方案", kind, controls, "existing-input", "existing-option",
  );
  bind();
  const textarea = container.querySelector("[data-interaction-other-field]");
  const other = select ? select.children.at(-1) : group.children.at(-1)?.children[0];
  const change = (selected: boolean) => {
    if (!other) throw new Error("missing other choice");
    if (select) other.selected = selected;
    else other.checked = selected;
    for (const listener of container.listeners) listener({ target: select ?? other });
  };
  return { container, choices, other, textarea, change, runtime, bind };
}

for (const kind of ["radio", "checkbox", "select", "multiselect"]) {
  test(`${kind} offers 其它, validates text and submits the actual answer`, () => {
    const harness = createHarness(kind);
    const { textarea, other, runtime, container } = harness;
    assert.ok(textarea);
    assert.ok(other);
    assert.equal(textarea.hidden, true);
    assert.equal(textarea.disabled, true);
    assert.equal(textarea.getAttribute("aria-required"), "true");
    assert.equal(runtime.humanInteractionOtherError(container), "");
    assert.equal(other.value, "__sinitek_other___");
    if (kind === "multiselect") assert.equal((other.parentElement as ChoiceElement & { size: number }).size, 2);
    harness.change(true);
    assert.equal(textarea.hidden, false);
    assert.equal(textarea.focused, true);
    textarea.value = "  ";
    assert.equal(runtime.humanInteractionOtherError(container), "请填写“方案”的其它内容。");
    textarea.value = "  用户输入 <自己的方案>  ";
    const multiple = kind === "checkbox" || kind === "multiselect";
    const values = { question: multiple ? ["preset", other.value] : other.value };
    assert.deepEqual(runtime.collectHumanInteractionOtherValues(container, values), {
      question: multiple ? ["preset", "用户输入 <自己的方案>"] : "用户输入 <自己的方案>",
    });
    assert.equal(runtime.humanInteractionOtherError(container), "");
    harness.change(false);
    assert.equal(textarea.hidden, true);
    assert.equal(textarea.disabled, true);
    assert.deepEqual(runtime.collectHumanInteractionOtherValues(container, { question: "preset" }), { question: "preset" });
    harness.change(true);
    assert.equal(textarea.value, "  用户输入 <自己的方案>  ");
    harness.bind();
    assert.equal(container.querySelectorAll("[data-interaction-other-field]").length, 1);
  });
}

for (const label of ["其它", "其他（请填写）", "Other"]) {
  for (const kind of ["radio", "select"]) {
    test(`${kind} reuses the existing ${label} choice in clarification forms`, () => {
      const { choices, other, textarea } = createHarness(kind, ["预设方案", label], "clarify");
      assert.equal(other, choices[1]);
      assert.equal(textarea?.getAttribute("data-interaction-other-value"), "value_1");
      if (kind === "radio") assert.equal(other?.getAttribute("data-clarify-field"), "question");
    });
  }
}

test("plain text and boolean controls do not gain an unrelated 其它 choice", () => {
  for (const kind of ["text", "textarea", "password", "checkbox-boolean"]) {
    assert.equal(createHarness(kind).textarea, null);
  }
});

test("reuses an existing Other option without removing its nested description", () => {
  const { choices, other } = createHarness("radio", ["预设方案", "Other"], "clarify", true);
  assert.equal(other, choices[1]);
  assert.equal(other?.parentElement?.querySelector("span")?.firstChild?.textContent, "其它");
  assert.equal(other?.parentElement?.querySelector("small")?.textContent, "填写自己的方案");
});

test("both form entry points share collection and error handling", () => {
  for (const script of [VIEW_CONTENT_SCRIPT_SETTINGS_AND_OVERLAYS, orchestratorClarificationDialogScript()]) {
    assert.match(script, /bindHumanInteractionOtherChoice\(container|bindHumanInteractionOtherChoice\(wrapper/);
    assert.match(script, /return collectHumanInteractionOtherValues\(form, values\)/);
    assert.match(script, /const otherError = humanInteractionOtherError\(/);
  }
});
