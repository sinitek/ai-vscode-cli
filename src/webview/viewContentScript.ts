import { VIEW_CONTENT_SCRIPT_CORE_BOOTSTRAP } from "./viewContentScript/coreBootstrap";
import { VIEW_CONTENT_SCRIPT_CORE_RUNTIME_STATE } from "./viewContentScript/coreRuntimeState";
import { VIEW_CONTENT_SCRIPT_MODEL_AND_PANEL_STATE } from "./viewContentScript/modelAndPanelState";
import { VIEW_CONTENT_SCRIPT_MESSAGE_RENDERING } from "./viewContentScript/messageRendering";
import { VIEW_CONTENT_SCRIPT_HISTORY_PANELS } from "./viewContentScript/historyPanels";
import { VIEW_CONTENT_SCRIPT_TRACE_RENDERING } from "./viewContentScript/traceRendering";
import { VIEW_CONTENT_SCRIPT_TASK_LIST_AND_UI } from "./viewContentScript/taskListAndUi";
import { VIEW_CONTENT_SCRIPT_RUN_STREAM_AND_QUEUE } from "./viewContentScript/runStreamAndQueue";
import { VIEW_CONTENT_SCRIPT_ATTACHMENTS_AND_TIME } from "./viewContentScript/attachmentsAndTime";
import { VIEW_CONTENT_SCRIPT_EVENT_BINDINGS } from "./viewContentScript/eventBindings";
import { VIEW_CONTENT_SCRIPT_MODEL_MANAGER } from "./viewContentScript/modelManager";
import { VIEW_CONTENT_SCRIPT_SETTINGS_AND_OVERLAYS } from "./viewContentScript/settingsAndOverlays";
import { VIEW_CONTENT_SCRIPT_WINDOW_MESSAGE_DISPATCH } from "./viewContentScript/windowMessageDispatch";

export type BuildWebviewRuntimeScriptInput = {
  i18n: unknown;
  cliList: unknown;
  lobsterMaxRoundsDefault: number;
  lobsterMaxRoundsMin: number;
  lobsterMaxRoundsMax: number;
  lobsterExecutionModeMainSubMultiAgent: string;
  lobsterExecutionModeDebateMultiAgent: string;
};

const RUNTIME_SCRIPT_PARTS = [
  VIEW_CONTENT_SCRIPT_CORE_BOOTSTRAP,
  VIEW_CONTENT_SCRIPT_CORE_RUNTIME_STATE,
  VIEW_CONTENT_SCRIPT_MODEL_AND_PANEL_STATE,
  VIEW_CONTENT_SCRIPT_MESSAGE_RENDERING,
  VIEW_CONTENT_SCRIPT_HISTORY_PANELS,
  VIEW_CONTENT_SCRIPT_TRACE_RENDERING,
  VIEW_CONTENT_SCRIPT_TASK_LIST_AND_UI,
  VIEW_CONTENT_SCRIPT_RUN_STREAM_AND_QUEUE,
  VIEW_CONTENT_SCRIPT_ATTACHMENTS_AND_TIME,
  VIEW_CONTENT_SCRIPT_EVENT_BINDINGS,
  VIEW_CONTENT_SCRIPT_MODEL_MANAGER,
  VIEW_CONTENT_SCRIPT_SETTINGS_AND_OVERLAYS,
  VIEW_CONTENT_SCRIPT_WINDOW_MESSAGE_DISPATCH,
];

function replaceLiteral(value: string, search: string, replacement: string): string {
  return value.split(search).join(replacement);
}

export function buildWebviewRuntimeScript(input: BuildWebviewRuntimeScriptInput): string {
  return replaceLiteral(
    replaceLiteral(
      replaceLiteral(
        replaceLiteral(
          replaceLiteral(
            replaceLiteral(
              replaceLiteral(
                RUNTIME_SCRIPT_PARTS.join(""),
                "${JSON.stringify(i18n)}",
                JSON.stringify(input.i18n),
              ),
              "${JSON.stringify(CLI_LIST)}",
              JSON.stringify(input.cliList),
            ),
            "${LOBSTER_MAX_ROUNDS_SETTING_DEFAULT}",
            String(input.lobsterMaxRoundsDefault),
          ),
          "${LOBSTER_MAX_ROUNDS_SETTING_MIN}",
          String(input.lobsterMaxRoundsMin),
        ),
        "${LOBSTER_MAX_ROUNDS_SETTING_MAX}",
        String(input.lobsterMaxRoundsMax),
      ),
      "${LOBSTER_EXECUTION_MODE_MAIN_SUB_MULTI_AGENT}",
      input.lobsterExecutionModeMainSubMultiAgent,
    ),
    "${LOBSTER_EXECUTION_MODE_DEBATE_MULTI_AGENT}",
    input.lobsterExecutionModeDebateMultiAgent,
  );
}
