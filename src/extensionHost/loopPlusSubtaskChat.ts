import type { I18nKey } from "../i18n";
import { t as translate } from "../i18n";
import {
  buildLoopSubtaskFinishedChatSection,
  buildLoopSubtaskJoinedChatSection,
} from "../loopDebate";

export type LoopPlusSubtaskChatPhase = "started" | "finished";
export type LoopPlusSubtaskChatRunStatus = "end" | "error" | "stopped";

export type LoopPlusSubtaskChatNotice = {
  taskId: string;
  subtaskId: string;
  title: string;
  phase: LoopPlusSubtaskChatPhase;
  round: number;
  communicationFile?: string;
  runStatus?: LoopPlusSubtaskChatRunStatus;
  assistantContent?: string | null;
};

type Translate = (
  key: I18nKey,
  params?: Record<string, string | number | boolean>,
) => string;

export function buildLoopPlusGroupChatSection(
  notice: LoopPlusSubtaskChatNotice,
  displayTitle: string,
): { heading: string; body: string } {
  if (notice.phase === "started") {
    return buildLoopSubtaskJoinedChatSection({
      subtaskId: notice.subtaskId,
      title: displayTitle,
      round: notice.round,
      communicationFile: notice.communicationFile,
    });
  }
  return buildLoopSubtaskFinishedChatSection({
    subtaskId: notice.subtaskId,
    title: displayTitle,
    runStatus: notice.runStatus ?? "error",
    assistantContent: notice.assistantContent,
    communicationFile: notice.communicationFile,
    includeCommunicationFile: true,
  });
}

export function buildLoopPlusSubtaskParentMessage(
  notice: LoopPlusSubtaskChatNotice,
  translateFn: Translate = translate,
): string {
  const communicationFile = notice.communicationFile?.trim() ?? "";
  if (notice.phase === "started") {
    const lines = [
      `Loop 子任务已启动：${notice.title}`,
      `Loop 任务：${notice.taskId}`,
      `轮次：${notice.round}`,
    ];
    if (communicationFile) {
      lines.push(`沟通文件：${communicationFile}`);
    }
    return lines.join("\n");
  }
  const status = notice.runStatus === "end"
    ? translateFn("run.subagent.completed")
    : notice.runStatus === "stopped"
      ? translateFn("run.subagent.interrupted")
      : translateFn("run.subagent.failed");
  const message = translateFn("run.loopPlusSubtaskFinished", {
    title: notice.title,
    taskId: notice.taskId,
    status,
  });
  return communicationFile
    ? `${message}\n${translateFn("run.loopPlusCommunicationFile", { file: communicationFile })}`
    : message;
}
