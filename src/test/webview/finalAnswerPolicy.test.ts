import test = require("node:test");
import assert = require("node:assert/strict");

import { buildWebviewStaticHtml } from "../webview/viewContentHtml";
import { WEBVIEW_I18N } from "../webview/viewContentI18n";
import { buildWebviewRuntimeScript } from "../webview/viewContentScript";
import { FINAL_ANSWER_TEXT_MARKER } from "../finalAnswerProtocol";

function buildStaticHtml(locale: "en" | "zh-CN"): string {
  return buildWebviewStaticHtml({
    locale,
    cspSource: "self",
    nonce: "nonce",
    i18n: WEBVIEW_I18N[locale],
    cliOptions: "",
    markedScript: "",
    webviewStyles: "",
    loopExecutionModeMainSubMultiAgent: "main_sub_multi_agent",
    loopExecutionModeDebateMultiAgent: "debate_multi_agent",
  });
}

function buildRuntimeScript(): string {
  return buildWebviewRuntimeScript({
    i18n: WEBVIEW_I18N.en,
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
  const zhHtml = buildStaticHtml("zh-CN");
  const enHtml = buildStaticHtml("en");

  assert.doesNotMatch(zhHtml, /id="finalAnswerPolicy"/);
  assert.doesNotMatch(enHtml, /Final Reply Detection/);
  assert.doesNotMatch(zhHtml, /最终答复判定/);
  assert.doesNotMatch(zhHtml, /successful_reply_fallback/);
});

test("webview runtime contains no final-answer policy state or update message", () => {
  const script = buildRuntimeScript();

  assert.doesNotMatch(script, /finalAnswerPolicy/);
  assert.doesNotMatch(script, /successful_reply_fallback/);
  assert.doesNotMatch(script, /\$\{FINAL_ANSWER_POLICY_/);
  assert.doesNotMatch(script, /\$\{FINAL_ANSWER_TEXT_MARKER\}/);
});

test("webview hides final-answer text markers only from assistant bubble display content", () => {
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
    "Completed.  Details ",
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
