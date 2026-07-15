import { CLI_LIST } from "../cli/types";
import { logError } from "../logger";
import { resolveLocale } from "../i18n";
import { getWebviewStrings } from "./viewContentI18n";
import { buildWebviewStaticHtml } from "./viewContentHtml";
import { readFileSync } from "fs";
import * as path from "path";
import { WEBVIEW_STYLES } from "./viewContentStyles";
import { buildWebviewRuntimeScript } from "./viewContentScript";
import { FINAL_ANSWER_TEXT_MARKER } from "../finalAnswerProtocol";
import { LOOP_SUBTASK_MAX_THINKING_MODE_DEFAULT } from "../loopSubtaskThinking";

const LOOP_MAX_ROUNDS_SETTING_DEFAULT = 20;
const LOOP_MAX_ROUNDS_SETTING_MIN = 1;
const LOOP_MAX_ROUNDS_SETTING_MAX = 100;
const LOOP_EXECUTION_MODE_MAIN_SUB_MULTI_AGENT = "main_sub_multi_agent";
const LOOP_EXECUTION_MODE_DEBATE_MULTI_AGENT = "debate_multi_agent";

let cachedMarkedScript: string | undefined;

export function getWebviewHtml(webview: { cspSource: string }): string {
  const nonce = getNonce();
  const locale = resolveLocale();
  const i18n = getWebviewStrings(locale);
  const cliOptions = CLI_LIST.map(
    (cli) => `<option value="${cli}">${cli}</option>`,
  ).join("");
  const markedScript = getMarkedScript();

  const staticHtml = buildWebviewStaticHtml({
    locale,
    cspSource: webview.cspSource,
    nonce,
    i18n,
    cliOptions,
    markedScript,
    webviewStyles: WEBVIEW_STYLES,
    loopExecutionModeMainSubMultiAgent:
      LOOP_EXECUTION_MODE_MAIN_SUB_MULTI_AGENT,
    loopExecutionModeDebateMultiAgent:
      LOOP_EXECUTION_MODE_DEBATE_MULTI_AGENT,
  });

  return `${staticHtml}
${buildWebviewRuntimeScript({
    i18n,
    cliList: CLI_LIST,
    loopMaxRoundsDefault: LOOP_MAX_ROUNDS_SETTING_DEFAULT,
    loopMaxRoundsMin: LOOP_MAX_ROUNDS_SETTING_MIN,
    loopMaxRoundsMax: LOOP_MAX_ROUNDS_SETTING_MAX,
    loopSubtaskMaxThinkingModeDefault: LOOP_SUBTASK_MAX_THINKING_MODE_DEFAULT,
    loopExecutionModeMainSubMultiAgent:
      LOOP_EXECUTION_MODE_MAIN_SUB_MULTI_AGENT,
    loopExecutionModeDebateMultiAgent:
      LOOP_EXECUTION_MODE_DEBATE_MULTI_AGENT,
    finalAnswerTextMarker: FINAL_ANSWER_TEXT_MARKER,
  })}
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

function getMarkedScript(): string {
  if (cachedMarkedScript !== undefined) {
    return cachedMarkedScript;
  }
  const candidates = [
    path.join(__dirname, "..", "..", "media", "marked.min.js"),
    path.join(__dirname, "..", "..", "node_modules", "marked", "marked.min.js"),
  ];
  for (const scriptPath of candidates) {
    try {
      cachedMarkedScript = readFileSync(scriptPath, "utf8");
      return cachedMarkedScript;
    } catch {
      // Keep checking next candidate.
    }
  }
  void logError("webview-marked-script-missing", { candidates });
  cachedMarkedScript = "";
  return cachedMarkedScript;
}
