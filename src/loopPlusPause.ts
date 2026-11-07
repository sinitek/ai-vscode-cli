import * as fs from "fs";
import * as path from "path";
import { buildLoopMainSubChatTranscriptFile } from "./loopGroupChat";
import { buildLoopBlockedPauseText } from "./loopBlockedSummary";
import type { LoopTaskRecord } from "./loopTaskStore";

export function buildLoopPlusPauseText(task: LoopTaskRecord, message: string): string {
  if (message === "loop-plus-blocked") {
    return buildLoopBlockedPauseText(task);
  }
  return [
    "Loop+ 已暂停，整体任务尚未完成。",
    "",
    "### 暂停原因与未完成事项",
    "自动调度需要复核，请检查最近的运行提示与任务记录。",
    "",
    "### 如何继续",
    "补充上述所需证据或条件后，在群聊点击“继续执行”，或提交补充需求。继续后由主模型重新判断，不会自动移除安全门槛。",
  ].join("\n");
}

export function recordLoopPlusPause(task: LoopTaskRecord, message: string): void {
  const marker = `<!-- loop-plus-pause:${encodeURIComponent(task.id)}:${task.updatedAt}:${encodeURIComponent(message)} -->`;
  const section = `\n## 主任务暂停\n${marker}\n- 时间：${new Date(task.updatedAt).toISOString()}\n\n${buildLoopPlusPauseText(task, message)}\n`;
  const files = new Set([
    task.mainCommunicationFile,
    buildLoopMainSubChatTranscriptFile(task.communicationDir),
  ]);
  for (const file of files) {
    const existing = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
    if (existing.includes(marker)) {
      continue;
    }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, section, "utf8");
  }
}
