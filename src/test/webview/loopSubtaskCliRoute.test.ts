import test = require("node:test");
import assert = require("node:assert/strict");

import { buildWebviewStaticHtml } from "../../webview/viewContentHtml";
import { VIEW_CONTENT_SCRIPT_MODEL_AND_PANEL_STATE } from "../../webview/viewContentScript/modelAndPanelState";
import { VIEW_CONTENT_SCRIPT_MODEL_MANAGER } from "../../webview/viewContentScript/modelManager";
import { VIEW_CONTENT_SCRIPT_TASK_LIST_AND_UI } from "../../webview/viewContentScript/taskListAndUi";
import { WEBVIEW_STRINGS } from "../../webview/viewContentStrings";

function extractFunctionSource(source: string, functionName: string): string {
  const signature = `function ${functionName}`;
  const start = source.indexOf(signature);
  assert.notEqual(start, -1, `Missing ${functionName}`);
  let parameterDepth = 0;
  let bodyStart = -1;
  for (let index = start + signature.length; index < source.length; index += 1) {
    const char = source[index];
    if (char === "(") parameterDepth += 1;
    else if (char === ")") parameterDepth -= 1;
    else if (char === "{" && parameterDepth === 0) {
      bodyStart = index;
      break;
    }
  }
  let depth = 0;
  let quote: string | null = null;
  let escaped = false;
  for (let index = bodyStart; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === "\"" || char === "'" || char === "`") {
      quote = char;
      continue;
    }
    if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  throw new Error(`Unterminated ${functionName}`);
}

function createRouteApi(state: Record<string, any>) {
  const posted: Array<Record<string, unknown>> = [];
  const source = [
    "const CLI_NAMES = ['codex', 'claude', 'opencode', 'grok'];",
    ...[
      "normalizeModelSelection",
      "normalizeThinkingModeSelection",
      "getSelectedLoopRoleThinkingModeForCli",
    ].map((name) => extractFunctionSource(VIEW_CONTENT_SCRIPT_MODEL_AND_PANEL_STATE, name)),
    ...[
      "getLoopRoleModelsForCli",
      "getSelectedLoopRoleModelForCli",
      "getActiveConfigIdForStateCli",
      "getLoopSubtaskRoute",
      "getLoopSubtaskOpenCodeModelState",
      "normalizeSubtaskThinkingValue",
      "readLoopSubtaskModelSelection",
      "readLoopSubtaskThinkingSelection",
      "handleLoopSubtaskCliChange",
      "postOpenCodeSubtaskRouteModel",
      "handleLoopSubtaskModelChange",
      "handleLoopSubtaskThinkingChange",
    ].map((name) => extractFunctionSource(VIEW_CONTENT_SCRIPT_MODEL_MANAGER, name)),
    ...[
      "shouldIncludeCodexLoopRoleModels",
      "resolvePromptLoopRoleModel",
      "applyCodexLoopRoleModelsToPromptPayload",
    ].map((name) => extractFunctionSource(VIEW_CONTENT_SCRIPT_TASK_LIST_AND_UI, name)),
    "return { getLoopSubtaskRoute, handleLoopSubtaskCliChange, handleLoopSubtaskModelChange, handleLoopSubtaskThinkingChange, applyCodexLoopRoleModelsToPromptPayload };",
  ].join("\n");
  return {
    posted,
    api: new Function("state", "vscode", "t", source)(
      state,
      { postMessage: (message: Record<string, unknown>) => posted.push(message) },
      (key: string) => WEBVIEW_STRINGS[key as keyof typeof WEBVIEW_STRINGS] || key,
    ) as {
      getLoopSubtaskRoute: () => any;
      handleLoopSubtaskCliChange: (value: string) => void;
      handleLoopSubtaskModelChange: (value: string) => void;
      handleLoopSubtaskThinkingChange: (value: string) => void;
      applyCodexLoopRoleModelsToPromptPayload: (payload: any, cli: string, mode: string, tab: any) => any;
    },
  };
}

function baseState() {
  return {
    currentCli: "codex",
    interactiveMode: "loop",
    selectedConfigId: "codex-config",
    configState: { activeConfigId: "codex-config" },
    activeConfigIdByCli: {
      codex: "codex-config",
      claude: "claude-config",
      opencode: "opencode-config",
      grok: "grok-config",
    } as Record<string, string | null>,
    selectedLoopSubtaskCliByConfigId: {} as Record<string, string>,
    pendingLoopSubtaskCliSelection: null as { configId: string; cli: string } | null,
    modelIssuesByCli: {} as Record<string, string>,
    thinkingModeByCli: { claude: "medium", grok: "low" },
    selectedLoopModelsByCli: {
      codex: { main: "gpt-main", subtask: "gpt-sub" },
      grok: { main: "grok-main", subtask: "grok-sub" },
    },
    selectedLoopThinkingByCli: {
      codex: { main: "high", subtask: "low" },
      grok: { main: "low", subtask: "high" },
      claude: { main: "medium", subtask: "off" },
    },
    loopModelsByCli: {
      codex: { main: ["gpt-main"], subtask: ["gpt-sub"] },
      grok: { main: ["grok-main"], subtask: ["grok-sub"] },
    },
    modelsByCli: {},
    openCodeModels: { models: [], selectedSubtaskRef: "oc-sub", configSubtaskRef: "oc-sub" },
    loopSubtaskOpenCodeModels: {
      models: [{ ref: "oc-live" }],
      selectedSubtaskRef: "oc-live",
      configSubtaskRef: "oc-live",
    },
  };
}

test("subtask CLI choices stay on the main config and do not rewrite main or target main roles", () => {
  const state = baseState();
  const { api, posted } = createRouteApi(state);
  assert.equal(api.getLoopSubtaskRoute().subtaskCli, "codex");
  assert.equal(api.getLoopSubtaskRoute().crossCli, false);

  api.handleLoopSubtaskCliChange("claude");
  assert.equal(state.currentCli, "codex");
  assert.equal(state.selectedLoopModelsByCli.codex.main, "gpt-main");
  assert.equal(state.selectedLoopSubtaskCliByConfigId["codex-config"], "claude");
  assert.equal(posted[0]?.type, "selectLoopSubtaskCli");
  assert.equal(posted[0]?.cli, "claude");
  assert.equal(posted[0]?.configId, "codex-config");
  const claudeRoute = api.getLoopSubtaskRoute();
  assert.equal(claudeRoute.subtaskCli, "claude");
  assert.equal(claudeRoute.subtaskConfigId, "claude-config");
  assert.equal(claudeRoute.crossCli, true);

  const beforeModel = posted.length;
  api.handleLoopSubtaskModelChange("should-not-write");
  assert.equal(posted.length, beforeModel);
  api.handleLoopSubtaskThinkingChange("off");
  const thinkingMessage = posted[posted.length - 1] as Record<string, unknown>;
  assert.equal(thinkingMessage.type, "updateSetting");
  assert.equal(thinkingMessage.key, "selectedLoopThinkingMode.claude.subtask");
  assert.equal(thinkingMessage.value, "off");
  assert.equal(state.selectedLoopThinkingByCli.codex.subtask, "low");
  assert.equal(state.selectedLoopThinkingByCli.claude.main, "medium");

  api.handleLoopSubtaskCliChange("grok");
  api.handleLoopSubtaskModelChange("grok-sub");
  const modelMessage = posted[posted.length - 1] as Record<string, unknown>;
  assert.equal(modelMessage.type, "selectCliLoopModel");
  assert.equal(modelMessage.cli, "grok");
  assert.equal(modelMessage.role, "subtask");
  assert.equal(modelMessage.configId, "grok-config");
  assert.equal(state.selectedLoopModelsByCli.grok.main, "grok-main");
  assert.equal(state.selectedLoopModelsByCli.codex.main, "gpt-main");
  assert.equal(state.selectedLoopModelsByCli.codex.subtask, "gpt-sub");
});

test("prompt payload carries a cross-CLI route, blocks a missing config, and keeps Claude without a model", () => {
  const state = baseState();
  const { api } = createRouteApi(state);
  const basePayload = {
    prompt: "run",
    contextOptions: { includeCurrentFile: true, includeSelection: true },
  };
  const sameCli = api.applyCodexLoopRoleModelsToPromptPayload(basePayload, "codex", "loop", null);
  assert.equal(sameCli.loopSubtaskCli, undefined);
  assert.equal(sameCli.loopMainModel, "gpt-main");
  assert.equal(sameCli.loopSubtaskModel, "gpt-sub");

  api.handleLoopSubtaskCliChange("claude");
  const claude = api.applyCodexLoopRoleModelsToPromptPayload(basePayload, "codex", "loop", null);
  assert.equal(claude.loopSubtaskCli, "claude");
  assert.equal(claude.loopSubtaskConfigId, "claude-config");
  assert.equal(claude.loopSubtaskModel, undefined);
  assert.equal(claude.loopSubtaskThinkingMode, "off");
  assert.equal(claude.loopMainModel, "gpt-main");

  state.activeConfigIdByCli.opencode = null;
  api.handleLoopSubtaskCliChange("opencode");
  const blocked = api.applyCodexLoopRoleModelsToPromptPayload(basePayload, "codex", "graph", null);
  assert.equal(blocked.loopSubtaskRouteBlocked, "目标 CLI 没有可用配置，不能派发子任务。");
  assert.equal(blocked.loopSubtaskCli, undefined);

  state.currentCli = "claude";
  state.selectedConfigId = "claude-config";
  state.selectedLoopSubtaskCliByConfigId = {};
  const claudeMain = api.applyCodexLoopRoleModelsToPromptPayload(basePayload, "claude", "loop_plus", null);
  assert.equal(claudeMain.loopSubtaskCli, undefined);
  assert.equal(claudeMain.loopMainModel, undefined);
  assert.equal(claudeMain.loopSubtaskThinkingMode, "off");
});

test("static subtask rows expose a CLI group for every main CLI and hide Claude model choices", () => {
  const html = buildWebviewStaticHtml({
    cspSource: "vscode-webview:",
    nonce: "test",
    i18n: WEBVIEW_STRINGS,
    cliOptions: "",
    markedScript: "",
    webviewStyles: "",
    loopExecutionModeMainSubMultiAgent: "main_sub_multi_agent",
    loopExecutionModeDebateMultiAgent: "debate_multi_agent",
  });
  for (const id of ["codexLoopSubtaskCliSelect", "openCodeLoopSubtaskCliSelect", "claudeLoopSubtaskCliSelect"]) {
    assert.match(html, new RegExp(`id="${id}"[^>]*aria-label="子模型 CLI 分组"`));
  }
  assert.match(html, /id="claudeLoopSubtaskGroup"/);
  assert.match(html, /id="claudeLoopSubtaskModelSelect"[^>]*style="display: none;"/);
  const claudeGroup = html.slice(html.indexOf('id="claudeLoopSubtaskGroup"'), html.indexOf('id="loopSubtaskRouteIssue"'));
  assert.doesNotMatch(claudeGroup, /<option value="__manage__">/);
  const rows = [
    ["codexLoopSubtaskCliSelect", "codexLoopSubtaskModelSelect", "codexLoopSubtaskThinkingMode"],
    ["openCodeLoopSubtaskCliSelect", "openCodeSmallModelSelect", "openCodeSmallThinkingMode"],
    ["claudeLoopSubtaskCliSelect", "claudeLoopSubtaskModelSelect", "claudeLoopSubtaskThinkingMode"],
  ];
  for (const [cliId, modelId, thinkingId] of rows) {
    const cliAt = html.indexOf(`id="${cliId}"`);
    const rowStart = html.lastIndexOf("<div", cliAt);
    const rowEnd = html.indexOf("</div>", cliAt);
    const row = html.slice(rowStart, rowEnd);
    assert.match(row, /loop-subtask-route-row/);
    assert.ok(row.indexOf("子模型") >= 0 && row.indexOf("子模型") < row.indexOf(`id="${cliId}"`));
    assert.ok(row.indexOf("子模型 CLI 分组") > row.indexOf(`id="${cliId}"`));
    assert.ok(row.indexOf(`id="${cliId}"`) < row.indexOf(`id="${modelId}"`));
    assert.ok(row.indexOf(`id="${modelId}"`) < row.indexOf(`id="${thinkingId}"`));
  }
});
