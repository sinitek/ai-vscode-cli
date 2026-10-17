import * as assert from "node:assert/strict";
import { test } from "node:test";

import { buildWebviewStaticHtml } from "../../webview/viewContentHtml";
import { getWebviewStrings } from "../../webview/viewContentStrings";
import { VIEW_CONTENT_SCRIPT_CORE_BOOTSTRAP } from "../../webview/viewContentScript/coreBootstrap";
import { VIEW_CONTENT_SCRIPT_SETTINGS_AND_OVERLAYS } from "../../webview/viewContentScript/settingsAndOverlays";
import { VIEW_CONTENT_SCRIPT_WINDOW_MESSAGE_DISPATCH } from "../../webview/viewContentScript/windowMessageDispatch";

type RuleOption = { value: string; textContent: string };

class FakeRulesSelect {
  value = "codex";
  children: RuleOption[] = [];

  set innerHTML(_value: string) {
    this.children = [];
  }

  appendChild(child: RuleOption): RuleOption {
    this.children.push(child);
    return child;
  }
}

function extractFunctionSource(source: string, functionName: string): string {
  const signature = `function ${functionName}`;
  const start = source.indexOf(signature);
  assert.notEqual(start, -1, `Missing ${functionName}`);
  const bodyStart = source.indexOf("{", start);
  assert.notEqual(bodyStart, -1, `Missing ${functionName} body`);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return source.slice(start, index + 1);
      }
    }
  }
  throw new Error(`Unterminated ${functionName}`);
}

function extractWindowMessageHandlerSource(): string {
  const start = VIEW_CONTENT_SCRIPT_WINDOW_MESSAGE_DISPATCH.indexOf("window.addEventListener(\"message\"");
  assert.notEqual(start, -1, "Missing window message listener");
  const callbackStart = VIEW_CONTENT_SCRIPT_WINDOW_MESSAGE_DISPATCH.indexOf("(event) => {", start);
  const bodyStart = VIEW_CONTENT_SCRIPT_WINDOW_MESSAGE_DISPATCH.indexOf("{", callbackStart);
  let depth = 0;
  for (let index = bodyStart; index < VIEW_CONTENT_SCRIPT_WINDOW_MESSAGE_DISPATCH.length; index += 1) {
    const char = VIEW_CONTENT_SCRIPT_WINDOW_MESSAGE_DISPATCH[index];
    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return `function handleWindowMessage(event) ${VIEW_CONTENT_SCRIPT_WINDOW_MESSAGE_DISPATCH.slice(bodyStart, index + 1)}`;
      }
    }
  }
  throw new Error("Unterminated window message callback");
}

function buildHtml(): string {
  return buildWebviewStaticHtml({
    cspSource: "vscode-resource://test-authority",
    nonce: "grok-rules-nonce",
    i18n: getWebviewStrings(),
    cliOptions: "",
    markedScript: "",
    webviewStyles: "",
    loopExecutionModeMainSubMultiAgent: "main_sub_multi_agent",
    loopExecutionModeDebateMultiAgent: "debate_multi_agent",
  });
}

function createRulesHelpers() {
  const source = [
    "collectRuleTargets",
    "setRulesLoadCliOptions",
    "syncRulesSaveOptions",
    "updateRulesPath",
    "updateRulesScope",
  ].map((name) => extractFunctionSource(VIEW_CONTENT_SCRIPT_SETTINGS_AND_OVERLAYS, name)).join("\n");
  const state = {
    ruleScope: "global",
    rulePaths: {
      global: {
        codex: "/state/global/codex/AGENTS.md",
        claude: "/state/global/claude/CLAUDE.md",
        opencode: "/state/global/opencode/AGENTS.md",
        grok: "/state/global/grok/AGENTS.md",
      },
      project: {
        codex: "/state/project/AGENTS.md",
        claude: "/state/project/CLAUDE.md",
        opencode: "/state/project/AGENTS.md",
        grok: "/state/project/AGENTS.md",
      },
    },
  };
  const rulesLoadCli = new FakeRulesSelect();
  const elements = {
    rulesLoadCli,
    rulesPath: { textContent: "" },
    rulesSaveCodex: { checked: false },
    rulesSaveCodexLabel: { textContent: "codex" },
    rulesSaveClaude: { checked: false },
    rulesSaveOpenCode: { checked: false },
    rulesSaveOpenCodeOption: { style: { display: "" } },
    rulesSaveGrok: { checked: false },
    rulesSaveGrokOption: { style: { display: "" } },
    scopeGlobal: { className: "", setAttribute() { return undefined; } },
    scopeProject: { className: "", setAttribute() { return undefined; } },
  };
  const document = {
    createElement(tagName: string): RuleOption {
      assert.equal(tagName, "option");
      return { value: "", textContent: "" };
    },
  };
  const helpers = new Function(
    "state",
    "elements",
    "document",
    "t",
    `${source}; return { collectRuleTargets, setRulesLoadCliOptions, syncRulesSaveOptions, updateRulesPath, updateRulesScope };`,
  )(state, elements, document, (key: string) => key === "rulesPathPrefix" ? "路径：" : key) as {
    collectRuleTargets: () => string[];
    setRulesLoadCliOptions: (isGlobal: boolean) => void;
    syncRulesSaveOptions: (isGlobal: boolean) => void;
    updateRulesPath: (cli: string) => void;
    updateRulesScope: (scope: string) => void;
  };
  return { state, elements, helpers };
}

test("global rules loader includes an independent grok file option", () => {
  const html = buildHtml();
  const selectMatch = html.match(/<select id="rulesLoadCli"[\s\S]*?<\/select>/);
  assert.ok(selectMatch, "rulesLoadCli select should exist");
  const selectHtml = selectMatch[0];
  assert.match(selectHtml, /<option value="grok">grok<\/option>/);
  assert.match(html, /<label id="rulesSaveGrokOption"><input type="checkbox" id="rulesSaveGrok" \/> grok<\/label>/);
  assert.match(html, /<span id="rulesSaveCodexLabel">codex<\/span>/);
  assert.equal(html.split('id="rulesSaveGrok"').length - 1, 1);
  assert.doesNotMatch(html, /~\/\.grok|[A-Za-z]:\\/);
  assert.doesNotMatch(VIEW_CONTENT_SCRIPT_SETTINGS_AND_OVERLAYS, /~\/\.grok|[A-Za-z]:\\/);
  assert.match(VIEW_CONTENT_SCRIPT_CORE_BOOTSTRAP, /rulesSaveGrokOption: document\.getElementById\("rulesSaveGrokOption"\)/);
  assert.match(VIEW_CONTENT_SCRIPT_CORE_BOOTSTRAP, /rulesSaveGrok: document\.getElementById\("rulesSaveGrok"\)/);

  const { elements, helpers } = createRulesHelpers();
  helpers.updateRulesScope("global");
  assert.deepEqual(
    elements.rulesLoadCli.children.map((option) => [option.value, option.textContent]),
    [
      ["codex", "codex"],
      ["claude", "claude"],
      ["opencode", "opencode"],
      ["grok", "grok"],
    ],
  );
  assert.equal(elements.rulesSaveCodexLabel.textContent, "codex");
  assert.equal(elements.rulesSaveGrokOption.style.display, "");
  elements.rulesLoadCli.value = "grok";
  helpers.updateRulesPath("grok");
  assert.equal(elements.rulesPath.textContent, "路径：/state/global/grok/AGENTS.md");
});

test("project scope keeps one shared AGENTS target and does not submit grok separately", () => {
  const { elements, helpers } = createRulesHelpers();
  elements.rulesSaveCodex.checked = true;
  elements.rulesSaveOpenCode.checked = true;
  elements.rulesSaveGrok.checked = true;

  helpers.updateRulesScope("project");

  assert.deepEqual(
    elements.rulesLoadCli.children.map((option) => [option.value, option.textContent]),
    [
      ["codex", "codex/opencode/grok"],
      ["claude", "claude"],
    ],
  );
  assert.equal(elements.rulesLoadCli.children.some((option) => option.value === "grok"), false);
  assert.equal(elements.rulesLoadCli.children.some((option) => option.value === "opencode"), false);
  assert.equal(elements.rulesSaveCodexLabel.textContent, "codex/opencode/grok");
  assert.equal(elements.rulesSaveOpenCodeOption.style.display, "none");
  assert.equal(elements.rulesSaveOpenCode.checked, false);
  assert.equal(elements.rulesSaveGrokOption.style.display, "none");
  assert.equal(elements.rulesSaveGrok.checked, false);
  assert.deepEqual(helpers.collectRuleTargets(), ["codex"]);
  assert.equal(elements.rulesPath.textContent, "路径：/state/project/AGENTS.md");
});

test("checking global grok adds grok to save targets and hint labels stay separate", () => {
  const { elements, helpers } = createRulesHelpers();
  helpers.updateRulesScope("global");
  elements.rulesSaveGrok.checked = true;
  assert.deepEqual(helpers.collectRuleTargets(), ["grok"]);
  assert.equal(elements.rulesSaveCodexLabel.textContent, "codex");
  assert.equal(elements.rulesSaveGrokOption.style.display, "");

  const handlerSource = extractWindowMessageHandlerSource();
  const translations: Array<{ key: string; params?: { cli?: string; targets?: string } }> = [];
  const errors: unknown[] = [];
  const handler = new Function(
    "setRulesHint",
    "elements",
    "t",
    "reportWebviewFailure",
    `${handlerSource}; return handleWindowMessage;`,
  )(
    () => undefined,
    { rulesInput: { value: "" } },
    (key: string, params?: { cli?: string; targets?: string }) => {
      translations.push({ key, params });
      return key;
    },
    (...args: unknown[]) => {
      errors.push(args);
    },
  ) as (event: { data: Record<string, unknown> }) => void;

  handler({ data: { type: "rulesContent", content: "# grok", scope: "global", cli: "grok" } });
  handler({ data: { type: "rulesContent", content: "# shared", scope: "project", cli: "codex" } });
  handler({ data: { type: "rulesSaved", scope: "global", targets: ["grok"] } });
  handler({ data: { type: "rulesSaved", scope: "project", targets: ["codex"] } });

  assert.deepEqual(errors, []);
  assert.equal(translations.find((entry) => entry.key === "rulesHintLoaded" && entry.params?.cli === "grok")?.params?.cli, "grok");
  assert.equal(
    translations.filter((entry) => entry.key === "rulesHintLoaded").map((entry) => entry.params?.cli).join("|"),
    "grok|codex/opencode/grok",
  );
  assert.equal(
    translations.filter((entry) => entry.key === "rulesHintSaved").map((entry) => entry.params?.targets).join("|"),
    "grok|codex/opencode/grok",
  );
});
