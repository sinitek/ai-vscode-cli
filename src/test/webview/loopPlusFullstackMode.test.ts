import test = require("node:test");
import assert = require("node:assert/strict");
import { loopModelRoutingFromPromptInput } from "../../continueModelChoice";
import { resolveLoopPlusRoleExecution } from "../../subtaskCliRoute";

import { buildWebviewStaticHtml } from "../../webview/viewContentHtml";
import { INPUT_CONTROLS_STYLES } from "../../webview/viewContentStyles/inputControls";
import { WEBVIEW_STRINGS } from "../../webview/viewContentStrings";
import { VIEW_CONTENT_SCRIPT_EVENT_BINDINGS } from "../../webview/viewContentScript/eventBindings";
import { VIEW_CONTENT_SCRIPT_MODEL_MANAGER } from "../../webview/viewContentScript/modelManager";
import { VIEW_CONTENT_SCRIPT_TASK_LIST_AND_UI } from "../../webview/viewContentScript/taskListAndUi";

function html(): string {
  return buildWebviewStaticHtml({
    cspSource: "vscode-webview:",
    nonce: "test",
    i18n: WEBVIEW_STRINGS,
    cliOptions: "",
    markedScript: "",
    webviewStyles: INPUT_CONTROLS_STYLES,
  });
}

function extractFunctionSource(source: string, functionName: string): string {
  const start = source.indexOf(`function ${functionName}(`);
  assert.notEqual(start, -1, `${functionName} should exist`);
  const bodyStart = source.indexOf("{", start);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === "{") {
      depth += 1;
    } else if (source[index] === "}") {
      depth -= 1;
      if (depth === 0) {
        return source.slice(start, index + 1);
      }
    }
  }
  throw new Error(`Unterminated ${functionName}`);
}

for (const role of ["frontend", "fullstack"]) {
  test(`Loop+ ${role} binds thinking controls for every main CLI layout`, () => {
    const changes: unknown[] = [];
    const controls = Array.from({ length: 3 }, () => ({
      listener: null as null | ((event: unknown) => void),
      addEventListener(_name: string, listener: (event: unknown) => void) { this.listener = listener; },
    }));
    const bind = new Function("handleLoopRoleThinkingChange", extractFunctionSource(VIEW_CONTENT_SCRIPT_MODEL_MANAGER, "bindLoopRoleThinkingControls") + "\nreturn bindLoopRoleThinkingControls;")((...args: unknown[]) => changes.push(args));
    bind(role, [...controls, null]);
    for (const control of controls) control.listener!({ target: { value: "low" } });
    assert.deepEqual(changes, Array.from({ length: 3 }, () => [role, "low"]));
    const label = role === "frontend" ? "Frontend" : "Fullstack";
    assert.ok(VIEW_CONTENT_SCRIPT_MODEL_MANAGER.includes(`bindLoopRoleThinkingControls("${role}", [elements.codexLoop${label}ThinkingMode, elements.openCode${label}ThinkingMode, elements.claudeLoop${label}ThinkingMode])`));
  });
}

test("DSH role controls retain the advertised medium thinking level", () => {
  const normalize = new Function(extractFunctionSource(VIEW_CONTENT_SCRIPT_MODEL_MANAGER, "normalizeSubtaskThinkingValue") + "\nreturn normalizeSubtaskThinkingValue;")();
  assert.equal(normalize("dsh", "medium"), "medium");
  assert.equal(normalize("dsh", "off"), "");
});

for (const role of ["fullstack", "frontend"]) {
  for (const crossCli of [false, true]) {
    for (const explicitModel of [null, "named-model", ""]) {
      test(`Loop+ ${role} snapshots the displayed model with crossCli=${crossCli} and explicit=${JSON.stringify(explicitModel)}`, () => {
        const configId = crossCli ? "child-config" : "main-config";
        const state = {
          loopRoleExplicitModelByConfigId: explicitModel === null ? {} : { [configId]: { [role]: explicitModel } },
        };
        const apply = new Function(
          "state", "getLoopSubtaskMode", "getLoopNamedRoute", "readLoopSubtaskModelSelection",
          [
            extractFunctionSource(VIEW_CONTENT_SCRIPT_MODEL_MANAGER, "readExplicitRoleModel"),
            extractFunctionSource(VIEW_CONTENT_SCRIPT_TASK_LIST_AND_UI, "finishLoopPlusPromptPayload"),
            "return finishLoopPlusPromptPayload;",
          ].join("\n"),
        )(
          state,
          () => "fullstack",
          (requestedRole: string) => requestedRole === role ? {
            mainConfigId: "main-config", subtaskConfigId: configId,
            subtaskCli: crossCli ? "dsh" : "codex", crossCli,
          } : null,
          () => "gpt-6.1-terra",
        );
        const payload = { model: "gpt-6.1-sol", loopMainModel: "gpt-6.1-sol" };
        const result = apply(payload, "loop_plus");
        const prefix = role === "fullstack" ? "loopSubtaskFullstack" : "loopSubtaskFrontend";
        assert.equal(result[prefix + "Model"], (explicitModel ?? "gpt-6.1-terra") || undefined);
        assert.equal(result[prefix + "ConfigId"], configId);
        assert.equal(result[prefix + "Cli"], crossCli ? "dsh" : "codex");
        assert.equal(result.model, "gpt-6.1-sol");
        const routing = loopModelRoutingFromPromptInput(result, { mainCli: "codex" });
        const execution = resolveLoopPlusRoleExecution({
          mainCli: "codex",
          taskType: role === "frontend" ? "frontend" : "backend",
          loopSubtaskMode: role === "fullstack" ? "fullstack" : "split",
          fullstackRoute: routing?.subtaskFullstack,
          frontendRoute: routing?.subtaskFrontend,
          prompt: result,
        });
        assert.equal(execution.unavailableReason, undefined);
        assert.equal(execution.model, (explicitModel ?? "gpt-6.1-terra") || undefined);
        assert.equal(apply(payload, "loop"), payload);
      });
    }
  }
}

test("Loop+ skips unavailable named routes instead of borrowing the main model", () => {
  const apply = new Function(
    "getLoopSubtaskMode", "getLoopNamedRoute",
    extractFunctionSource(VIEW_CONTENT_SCRIPT_TASK_LIST_AND_UI, "finishLoopPlusPromptPayload")
      + "\nreturn finishLoopPlusPromptPayload;",
  )(() => "fullstack", () => ({ subtaskCli: "codex", unavailableReason: "配置不可用" }));
  assert.deepEqual(apply({ model: "gpt-6.1-sol" }, "loop_plus"), { model: "gpt-6.1-sol", loopSubtaskMode: "fullstack" });
  assert.equal(apply(null, "loop_plus"), null);
});

function createRoleVisibilityHarness(cli: string) {
  const state = {
    currentCli: cli,
    interactiveMode: "loop_plus",
    pendingLoopSubtaskMode: null,
    subtaskMode: "fullstack",
  };
  const route = { subtaskCli: "codex", mainConfigId: "main-config", subtaskConfigId: "sub-config" };
  const elements: Record<string, any> = {};
  for (const prefix of ["codexLoop", "openCodeLoop", "claudeLoop"]) {
    for (const role of ["Subtask", "Fullstack", "Frontend"]) {
      const label = { textContent: "" };
      const row = { hidden: false, style: { display: "" }, querySelector: () => label };
      const modelPrefix = prefix === "openCodeLoop" ? "openCode" : prefix;
      const modelRole = prefix === "openCodeLoop" && role === "Subtask" ? "Small" : role;
      for (const id of [
        `${prefix}${role}CliSelect`,
        `${modelPrefix}${modelRole}ModelSelect`,
        `${modelPrefix}${modelRole}ThinkingMode`,
      ]) {
        elements[id] = {
          parentElement: row,
          style: { display: "" },
          disabled: false,
          value: "",
          tabIndex: 0,
          setAttribute() {},
          removeAttribute() {},
        };
      }
    }
  }
  const start = VIEW_CONTENT_SCRIPT_MODEL_MANAGER.indexOf("      function updateLoopSubtaskTargetControls(");
  const end = VIEW_CONTENT_SCRIPT_MODEL_MANAGER.indexOf("      function syncModelSelectorByInteractiveMode(", start);
  assert.ok(start >= 0 && end > start);
  const update = new Function(
    "state", "elements", "document", "getLoopSubtaskRoute", "normalizeInteractiveMode",
    "getLoopSubtaskMode", "isLoopRoleModelMode", "t", "fillSubtaskCliSelect",
    "setRouteControlVisible", "getLoopNamedRoute", "populateSubtaskModelSelect",
    "populateSubtaskThinkingSelect", "isSelectFocused", "readExplicitRoleModel",
    "getActiveConfigIdForStateCli", "getLoopFrontendRoute",
    `${VIEW_CONTENT_SCRIPT_MODEL_MANAGER.slice(start, end)}; return updateLoopSubtaskTargetControls;`,
  )(
    state, elements, { body: { classList: { toggle() {} } }, querySelector: () => null },
    () => route, (value: string) => value, () => state.subtaskMode,
    (currentCli: string, mode: string) => !["opencode", "claude"].includes(currentCli) && ["loop", "loop_plus"].includes(mode),
    (key: string) => WEBVIEW_STRINGS[key as keyof typeof WEBVIEW_STRINGS] || key,
    (control: any, value: string) => { control.value = value; control.tabIndex = 0; },
    (control: any, visible: boolean) => { control.style.display = visible ? "" : "none"; control.disabled = !visible; },
    () => route,
    (control: any) => { control.value = "saved-subtask-model"; },
    (control: any) => { control.value = "high"; },
    () => false, () => null, () => null, () => route,
  ) as () => void;
  const prefix = cli === "opencode" ? "openCodeLoop" : cli === "claude" ? "claudeLoop" : "codexLoop";
  return { state, elements, prefix, route, update };
}

for (const cli of ["codex", "opencode", "claude", "grok", "dsh", "kimi-code", "zcode"]) {
  test(`${cli}: switching from Loop+ fullstack restores the classic Loop subtask controls`, () => {
    const { state, elements, prefix, update } = createRoleVisibilityHarness(cli);
    const subtask = elements[`${prefix}SubtaskCliSelect`];
    const fullstack = elements[`${prefix}FullstackCliSelect`];
    const frontend = elements[`${prefix}FrontendCliSelect`];
    const model = elements[cli === "opencode" ? "openCodeSmallModelSelect" : `${prefix}SubtaskModelSelect`];
    const thinking = elements[cli === "opencode" ? "openCodeSmallThinkingMode" : `${prefix}SubtaskThinkingMode`];
    for (const mode of ["loop", "loop"]) {
      state.interactiveMode = "loop_plus";
      update();
      assert.equal(subtask.parentElement.hidden, true);
      assert.equal(fullstack.parentElement.hidden, false);
      assert.equal(frontend.parentElement.hidden, true);

      state.interactiveMode = mode;
      update();
      assert.equal(subtask.parentElement.hidden, false);
      assert.equal(subtask.parentElement.style.display, "");
      assert.equal(subtask.parentElement.querySelector().textContent, "子模型");
      assert.equal(subtask.disabled, false);
      assert.equal(subtask.tabIndex, 0);
      assert.equal(model.disabled, false);
      assert.equal(model.style.display, "");
      assert.equal(model.value, "saved-subtask-model");
      assert.equal(thinking.disabled, false);
      assert.equal(thinking.value, "high");
      assert.equal(fullstack.parentElement.hidden, true);
      assert.equal(frontend.parentElement.hidden, true);
    }
  });
}

test("Loop+ split visibility and inactive modes remain isolated from classic subtask controls", () => {
  const { state, elements, route, update } = createRoleVisibilityHarness("codex");
  const subtask = elements.codexLoopSubtaskCliSelect;
  const fullstack = elements.codexLoopFullstackCliSelect;
  const frontend = elements.codexLoopFrontendCliSelect;
  state.subtaskMode = "split";
  update();
  assert.equal(subtask.parentElement.hidden, false);
  assert.equal(frontend.parentElement.hidden, false);
  assert.equal(fullstack.parentElement.hidden, true);
  assert.equal(subtask.parentElement.querySelector().textContent, "子-后端");

  state.interactiveMode = "coding";
  update();
  assert.equal(subtask.parentElement.hidden, true);
  assert.equal(subtask.disabled, true);
  assert.equal(frontend.parentElement.hidden, true);
  assert.equal(fullstack.parentElement.hidden, true);

  state.interactiveMode = "loop";
  route.subtaskCli = "claude";
  update();
  assert.equal(subtask.parentElement.hidden, false);
  assert.equal(subtask.disabled, false);
  assert.equal(elements.codexLoopSubtaskModelSelect.style.display, "none");
  assert.equal(elements.codexLoopSubtaskModelSelect.disabled, true);
  assert.equal(elements.codexLoopSubtaskThinkingMode.disabled, false);
});

for (const scenario of [
  { name: "starts at the question mark right edge and prefers the upper side", width: 800, right: 112, top: 220, left: "118px", tooltipTop: "178px" },
  { name: "keeps its right edge inside narrow viewports", width: 320, right: 280, top: 220, left: "132px", tooltipTop: "178px" },
  { name: "opens below the question mark when there is no room above", width: 800, right: 112, top: 10, left: "118px", tooltipTop: "28px" },
]) {
test(`role help tooltip ${scenario.name}`, () => {
  const tooltip = {
    hidden: true,
    textContent: "",
    style: { left: "", top: "" },
    getBoundingClientRect: () => ({ width: 180, height: 36 }),
  };
  const button = {
    offsetParent: {},
    getAttribute: (name: string) => name === "data-help" ? "说明文字" : null,
    setAttribute: () => undefined,
    getBoundingClientRect: () => ({ left: scenario.right - 12, right: scenario.right, top: scenario.top, bottom: scenario.top + 12 }),
  };
  const show = new Function(
    "document", "window", "hideLoopRoleHelpTooltip",
    `${extractFunctionSource(VIEW_CONTENT_SCRIPT_EVENT_BINDINGS, "showLoopRoleHelpTooltip")}; return showLoopRoleHelpTooltip;`,
  )(
    { getElementById: () => tooltip },
    { innerWidth: scenario.width, innerHeight: 600 },
    () => undefined,
  ) as (target: typeof button) => void;

  show(button);
  assert.equal(tooltip.hidden, false);
  assert.equal(tooltip.textContent, "说明文字");
  assert.equal(tooltip.style.left, scenario.left);
  assert.equal(tooltip.style.top, scenario.tooltipTop);
});
}

test("Loop+ fullscreen checkbox and role rows keep the classic labels in static HTML", () => {
  const source = html();
  const actions = source.slice(source.indexOf('class="input-actions"'), source.indexOf('id="commonCommandButton"'));
  assert.match(actions, /<label id="loopPlusFullstackToggleLabel" class="loop-fullstack-toggle" for="loopPlusFullstackToggle">/);
  assert.match(actions, /<input id="loopPlusFullstackToggle" type="checkbox" checked/);
  assert.match(actions, />全栈</);
  assert.ok(source.indexOf('id="loopPlusFullstackToggle"') < source.indexOf('id="commonCommandButton"'));
  assert.match(source, /<label class="open-code-model-label" for="codexLoopMainModelSelect">主模型<\/label>/);
  assert.match(source, /data-help="主模型尽量用高端模型并且思考力度强。"/);
  assert.match(source, /data-help="子模型使用擅长全栈编码的模型"/);
  assert.match(source, /data-help="子模型使用擅长后端编码的模型"/);
  assert.match(source, /data-help="子模型使用擅长前端编码的模型"/);
  assert.match(source, /id="loopRoleHelpTooltip"[^>]*role="tooltip"/);
  assert.doesNotMatch(source, /class="loop-role-help"[^>]*title=/);
  assert.doesNotMatch(source, /loopPlusRoleRoutingHint/);
  assert.doesNotMatch(VIEW_CONTENT_SCRIPT_MODEL_MANAGER, /loopPlusRoleRoutingHint/);
  assert.equal(Object.prototype.hasOwnProperty.call(WEBVIEW_STRINGS, "loopPlusRoleRoutingHint"), false);
  const fullstackAt = source.indexOf('id="codexLoopFullstackCliSelect"');
  const backendAt = source.indexOf('id="codexLoopSubtaskCliSelect"');
  const frontendAt = source.indexOf('id="codexLoopFrontendCliSelect"');
  assert.ok(fullstackAt > source.indexOf('id="codexLoopMainModelSelect"'));
  assert.ok(fullstackAt < backendAt && backendAt < frontendAt);
  assert.match(INPUT_CONTROLS_STYLES, /\.loop-fullstack-toggle \{[\s\S]*margin-right: auto;/);
  assert.match(INPUT_CONTROLS_STYLES, /\.loop-plus-roles \.open-code-model-row\.loop-subtask-route-row \.loop-role-label/);
  assert.match(INPUT_CONTROLS_STYLES, /flex: 0 0 72px/);
  assert.match(INPUT_CONTROLS_STYLES, /\.loop-role-help-tooltip \{[\s\S]*position: fixed;/);
  assert.match(INPUT_CONTROLS_STYLES, /\.loop-role-help-tooltip \{[^}]*transform: none;/);
  assert.match(VIEW_CONTENT_SCRIPT_EVENT_BINDINGS, /function showLoopRoleHelpTooltip/);
  assert.match(VIEW_CONTENT_SCRIPT_EVENT_BINDINGS, /pointerenter/);
  assert.doesNotMatch(VIEW_CONTENT_SCRIPT_EVENT_BINDINGS.slice(VIEW_CONTENT_SCRIPT_EVENT_BINDINGS.indexOf("function showLoopRoleHelpTooltip")), /setTimeout\(/);
  assert.match(VIEW_CONTENT_SCRIPT_MODEL_MANAGER, /loopSubtaskMode\./);
  assert.match(VIEW_CONTENT_SCRIPT_TASK_LIST_AND_UI, /finishLoopPlusPromptPayload/);
});
