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
  LOOP_PLUS_SUBTASK_MAX_ROUNDS_DEFAULT,
  LOOP_PLUS_SUBTASK_MAX_ROUNDS_LIMIT,
  LOOP_PLUS_SUBTASK_MAX_ROUNDS_MIN,
} from "../loopPlusDecision";



export function getWebviewHtml(webview: { cspSource: string }, promptInputHeight?: number): string {
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
    promptInputHeight,
  });

  return `${staticHtml}
${neutralizeInlineScriptEndTags(buildWebviewRuntimeScript({
    i18n,
    cliList: CLI_LIST,
    loopPlusDecisionSubtaskMaxDefault: LOOP_PLUS_DECISION_SUBTASK_MAX,
    loopPlusDecisionSubtaskMaxMin: LOOP_PLUS_DECISION_SUBTASK_MIN,
    loopPlusDecisionSubtaskMaxLimit: LOOP_PLUS_DECISION_SUBTASK_LIMIT,
    loopPlusSubtaskMaxRoundsDefault: LOOP_PLUS_SUBTASK_MAX_ROUNDS_DEFAULT,
    loopPlusSubtaskMaxRoundsMin: LOOP_PLUS_SUBTASK_MAX_ROUNDS_MIN,
    loopPlusSubtaskMaxRoundsLimit: LOOP_PLUS_SUBTASK_MAX_ROUNDS_LIMIT,
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
