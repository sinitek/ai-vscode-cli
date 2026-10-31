import { CLI_LIST } from "../cli/types";
import { getCliDisplayName } from "../cli/installer";
import { getMarkedScript, getJsonFormatterScript } from "./markdownAssets";
import { getWebviewStrings } from "./viewContentStrings";
import { buildWebviewStaticHtml, neutralizeInlineScriptEndTags } from "./viewContentHtml";
import { WEBVIEW_STYLES } from "./viewContentStyles";
import { buildWebviewRuntimeScript } from "./viewContentScript";
import { FINAL_ANSWER_TEXT_MARKER } from "../finalAnswerProtocol";
import {
  LOOP_PLUS_DECISION_SUBTASK_LIMIT,
  LOOP_PLUS_DECISION_SUBTASK_MAX,
  LOOP_PLUS_DECISION_SUBTASK_MIN,
  LOOP_PLUS_MAX_ACCEPTANCES_DEFAULT,
  LOOP_PLUS_MAX_ACCEPTANCES_LIMIT,
  LOOP_PLUS_MAX_ACCEPTANCES_MIN,
} from "../loopPlusDecision";
import { LOOP_SUBTASK_MAX_THINKING_MODE_DEFAULT } from "../loopSubtaskThinking";

const LOOP_MAX_ROUNDS_SETTING_DEFAULT = 20;
const LOOP_MAX_ROUNDS_SETTING_MIN = 1;
const LOOP_MAX_ROUNDS_SETTING_MAX = 100;


export function getWebviewHtml(webview: { cspSource: string }): string {
  const nonce = getNonce();
  const i18n = getWebviewStrings();
  const cliOptions = CLI_LIST.map(
    (cli) => `<option value="${cli}">${getCliDisplayName(cli)}</option>`,
  ).join("");
  const markedScript = getMarkedScript();
  const jsonFormatterScript = getJsonFormatterScript();

  const staticHtml = buildWebviewStaticHtml({
    cspSource: webview.cspSource,
    nonce,
    i18n,
    cliOptions,
    markedScript,
    jsonFormatterScript,
    webviewStyles: WEBVIEW_STYLES,
  });

  return `${staticHtml}
${neutralizeInlineScriptEndTags(buildWebviewRuntimeScript({
    i18n,
    cliList: CLI_LIST,
    loopMaxRoundsDefault: LOOP_MAX_ROUNDS_SETTING_DEFAULT,
    loopMaxRoundsMin: LOOP_MAX_ROUNDS_SETTING_MIN,
    loopMaxRoundsMax: LOOP_MAX_ROUNDS_SETTING_MAX,
    loopPlusDecisionSubtaskMaxDefault: LOOP_PLUS_DECISION_SUBTASK_MAX,
    loopPlusDecisionSubtaskMaxMin: LOOP_PLUS_DECISION_SUBTASK_MIN,
    loopPlusDecisionSubtaskMaxLimit: LOOP_PLUS_DECISION_SUBTASK_LIMIT,
    loopPlusMaxAcceptancesDefault: LOOP_PLUS_MAX_ACCEPTANCES_DEFAULT,
    loopPlusMaxAcceptancesMin: LOOP_PLUS_MAX_ACCEPTANCES_MIN,
    loopPlusMaxAcceptancesLimit: LOOP_PLUS_MAX_ACCEPTANCES_LIMIT,
    loopSubtaskMaxThinkingModeDefault: LOOP_SUBTASK_MAX_THINKING_MODE_DEFAULT,
    finalAnswerTextMarker: FINAL_ANSWER_TEXT_MARKER,
  }))}
    </script>
  </body>
</html>`;
}

function getNonce(): string {
  let text = "";
  const possible =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

  for (let i = 0; i < 32; i += 1) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }

  return text;
}
