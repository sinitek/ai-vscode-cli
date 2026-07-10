import test = require("node:test");
import assert = require("node:assert/strict");

import {
  FINAL_ANSWER_POLICY_DEFAULT,
  FINAL_ANSWER_POLICY_SUCCESSFUL_REPLY_FALLBACK,
  FINAL_ANSWER_POLICY_STRICT,
} from "../toolSettings";
import { buildWebviewStaticHtml } from "../webview/viewContentHtml";
import { WEBVIEW_I18N } from "../webview/viewContentI18n";
import { buildWebviewRuntimeScript } from "../webview/viewContentScript";
import { TOAST_MISC_STYLES } from "../webview/viewContentStyles/toastMisc";

function buildStaticHtml(locale: "en" | "zh-CN"): string {
  return buildWebviewStaticHtml({
    locale,
    cspSource: "self",
    nonce: "nonce",
    i18n: WEBVIEW_I18N[locale],
    cliOptions: "",
    markedScript: "",
    webviewStyles: "",
    lobsterExecutionModeMainSubMultiAgent: "main_sub_multi_agent",
    lobsterExecutionModeDebateMultiAgent: "debate_multi_agent",
    finalAnswerPolicySuccessfulReplyFallback:
      FINAL_ANSWER_POLICY_SUCCESSFUL_REPLY_FALLBACK,
    finalAnswerPolicyStrict: FINAL_ANSWER_POLICY_STRICT,
  });
}

test("renders both global final-answer policies with strict mode as the default", () => {
  const zhHtml = buildStaticHtml("zh-CN");
  const enHtml = buildStaticHtml("en");

  assert.match(zhHtml, /id="finalAnswerPolicy"/);
  assert.match(zhHtml, /value="strict_final_answer">严格 final_answer（默认）/);
  assert.match(zhHtml, /value="successful_reply_fallback">成功回复兼容/);
  assert.match(enHtml, /Strict final_answer \(Default\)/);
  assert.match(enHtml, /Successful reply compatibility/);
  assert.ok(zhHtml.indexOf("strict_final_answer") < zhHtml.indexOf("successful_reply_fallback"));
  assert.match(zhHtml, /tool-settings-row tool-settings-policy-row/);
  assert.match(TOAST_MISC_STYLES, /\.tool-settings-policy-row\s*\{[^}]*flex-wrap:\s*wrap/s);
});

test("webview runtime defaults and updates the global final-answer policy", () => {
  const script = buildWebviewRuntimeScript({
    i18n: WEBVIEW_I18N.en,
    cliList: ["codex", "claude", "opencode"],
    lobsterMaxRoundsDefault: 20,
    lobsterMaxRoundsMin: 1,
    lobsterMaxRoundsMax: 100,
    lobsterExecutionModeMainSubMultiAgent: "main_sub_multi_agent",
    lobsterExecutionModeDebateMultiAgent: "debate_multi_agent",
    finalAnswerPolicyDefault:
      FINAL_ANSWER_POLICY_DEFAULT,
    finalAnswerPolicySuccessfulReplyFallback:
      FINAL_ANSWER_POLICY_SUCCESSFUL_REPLY_FALLBACK,
  });

  assert.match(script, /finalAnswerPolicy:\s*"strict_final_answer"/);
  assert.match(script, /key:\s*"finalAnswerPolicy"/);
  assert.match(script, /event\.target\.value === "successful_reply_fallback"/);
  assert.doesNotMatch(script, /\$\{FINAL_ANSWER_POLICY_/);
});
