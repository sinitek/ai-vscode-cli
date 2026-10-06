import test = require("node:test");
import assert = require("node:assert/strict");

import { buildWebviewStaticHtml } from "../../webview/viewContentHtml";
import { WEBVIEW_STRINGS } from "../../webview/viewContentStrings";
import { buildWebviewRuntimeScript } from "../../webview/viewContentScript";
import { FINAL_ANSWER_TEXT_MARKER } from "../../finalAnswerProtocol";

function buildStaticHtml(): string {
  return buildWebviewStaticHtml({
    cspSource: "self",
    nonce: "nonce",
    i18n: WEBVIEW_STRINGS,
    cliOptions: "",
    markedScript: "",
    webviewStyles: "",
    loopExecutionModeMainSubMultiAgent: "main_sub_multi_agent",
    loopExecutionModeDebateMultiAgent: "debate_multi_agent",
  });
}

function buildRuntimeScript(): string {
  return buildWebviewRuntimeScript({
    i18n: WEBVIEW_STRINGS,
    cliList: ["codex", "claude", "opencode"],
    loopMaxRoundsDefault: 20,
    loopMaxRoundsMin: 1,
    loopMaxRoundsMax: 100,
    loopSubtaskMaxThinkingModeDefault: "xhigh",
    loopExecutionModeMainSubMultiAgent: "main_sub_multi_agent",
    loopExecutionModeDebateMultiAgent: "debate_multi_agent",
    finalAnswerTextMarker: FINAL_ANSWER_TEXT_MARKER,
  });
}

test("does not render a configurable final-answer policy", () => {
  const html = buildStaticHtml();

  assert.doesNotMatch(html, /id="finalAnswerPolicy"/);
  assert.doesNotMatch(html, /Final Reply Detection/);
  assert.doesNotMatch(html, /最终答复判定/);
  assert.doesNotMatch(html, /successful_reply_fallback/);
});

test("webview runtime contains no final-answer policy state or update message", () => {
  const script = buildRuntimeScript();

  assert.doesNotMatch(script, /finalAnswerPolicy/);
  assert.doesNotMatch(script, /successful_reply_fallback/);
  assert.doesNotMatch(script, /\$\{FINAL_ANSWER_POLICY_/);
  assert.doesNotMatch(script, /\$\{FINAL_ANSWER_TEXT_MARKER\}/);
});

test("webview hides only a leading final-answer protocol prefix from assistant bubble display content", () => {
  const script = buildRuntimeScript();
  const functionSource = script.match(
    /function getAssistantMessageContentForDisplay\(message\) \{[\s\S]*?\n      \}/,
  )?.[0];
  assert.ok(functionSource, "assistant display filter should be present in the webview runtime");
  const getDisplayContent = new Function(
    `${functionSource}; return getAssistantMessageContentForDisplay;`,
  )() as (message: { role: string; content: string }) => string;

  assert.equal(
    getDisplayContent({ role: "assistant", content: "[final_answer]\n\nCompleted." }),
    "Completed.",
  );
  assert.equal(
    getDisplayContent({
      role: "assistant",
      content: "Completed. [final_answer] Details [final_answer]",
    }),
    "Completed. [final_answer] Details [final_answer]",
  );
  assert.equal(
    getDisplayContent({
      role: "assistant",
      content: "最终气泡判定包含 `[final_answer]` 标记。",
    }),
    "最终气泡判定包含 `[final_answer]` 标记。",
  );
  assert.equal(
    getDisplayContent({ role: "assistant", content: "Ordinary reply" }),
    "Ordinary reply",
  );
  assert.equal(
    getDisplayContent({ role: "user", content: "Please include [final_answer]" }),
    "Please include [final_answer]",
  );
  assert.match(script, /const content = getAssistantMessageContentForDisplay\(message\);/);
});
