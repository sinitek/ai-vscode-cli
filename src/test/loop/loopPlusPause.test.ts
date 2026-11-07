import test = require("node:test");
import assert = require("node:assert/strict");
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { buildLoopPlusPauseText, recordLoopPlusPause } from "../../loopPlusPause";
import { parseLoopGroupChatTranscript } from "../../loopGroupChat";
import type { LoopTaskRecord } from "../../loopTaskStore";

function task(root: string): LoopTaskRecord {
  return {
    id: "pause-task", cli: "codex", workspaceKey: "workspace", taskStoreFile: path.join(root, "tasks.json"),
    rootPrompt: "complete implementation", schedulingMode: "event_driven", status: "needs-review",
    createdAt: 1, updatedAt: 2, maxRounds: 20, currentRound: 0,
    communicationDir: root, mainCommunicationFile: path.join(root, "main-task.md"), subTasks: [], rounds: [],
    finalSummary: "### 当前结论\n暂时无法继续，任务尚未完成。\n### 阻塞原因与未完成事项\n页面真实测试未完成：当前缺少隔离环境的确认依据。\n### 继续前需要解决的事项\n1. 平台维护方提供隔离证据。\n2. 主模型核验依据，确认符合测试要求后，在群聊点击“继续执行”。",
    completionRoundSummaries: [], completionRequirementCoverage: [],
  };
}

test("pause records the same evidence and recovery action once in both communication files", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sinitek-loopplus-pause-"));
  try {
    const paused = task(root);
    fs.writeFileSync(paused.mainCommunicationFile, "# 原始任务\n");
    fs.writeFileSync(path.join(root, "group-chat.md"), "# 群聊\n\n## 验收结果\n阶段交付通过\n");
    recordLoopPlusPause(paused, "loop-plus-blocked");
    recordLoopPlusPause(paused, "loop-plus-blocked");
    for (const file of [paused.mainCommunicationFile, path.join(root, "group-chat.md")]) {
      const content = fs.readFileSync(file, "utf8");
      assert.equal((content.match(/## 主任务暂停/g) ?? []).length, 1);
      assert.ok(content.includes(paused.finalSummary ?? ""));
      assert.match(content, /整体任务尚未完成/);
      assert.match(content, /继续执行/);
    }
    const transcript = parseLoopGroupChatTranscript(fs.readFileSync(path.join(root, "group-chat.md"), "utf8"));
    assert.equal(transcript.segments.at(-1)?.heading, "主任务暂停");
    assert.equal(transcript.segments.at(-1)?.kind, "main-turn");
    assert.doesNotMatch(transcript.segments.at(-1)?.body ?? "", /loop-plus-pause:/);
    assert.equal(transcript.closed, false);
    recordLoopPlusPause({ ...paused, updatedAt: 3 }, "loop-plus-blocked");
    assert.equal((fs.readFileSync(paused.mainCommunicationFile, "utf8").match(/## 主任务暂停/g) ?? []).length, 2);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("missing reasons have a safe fallback while other pause causes cannot reuse a stale business summary", () => {
  const paused = task(os.tmpdir());
  assert.match(buildLoopPlusPauseText({ ...paused, finalSummary: " " }, "loop-plus-blocked"), /未提供具体阻塞原因/);
  assert.doesNotMatch(buildLoopPlusPauseText(paused, "loop-plus-protocol-paused"), /平台维护方/);
});

test("impossible work is explained without appending an ineffective continue instruction", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sinitek-loopplus-impossible-"));
  try {
    const summary = "### 当前结论\n按当前要求无法完成。\n### 阻塞原因与未完成事项\n原始数据已删除且无备份，无法还原真实数据。\n### 可行替代方案\n只能调整范围处理现存数据，不能补造已删除记录。";
    const paused = { ...task(root), finalSummary: summary };
    const text = buildLoopPlusPauseText(paused, "loop-plus-blocked");
    assert.ok(text.endsWith(summary));
    assert.doesNotMatch(text, /继续执行|补充上述所需证据/);
    recordLoopPlusPause(paused, "loop-plus-blocked");
    for (const file of [paused.mainCommunicationFile, path.join(root, "group-chat.md")]) {
      const content = fs.readFileSync(file, "utf8");
      assert.ok(content.includes(text));
      assert.doesNotMatch(content, /继续执行/);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("partial transcript writes are deduplicated when recording is retried", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sinitek-loopplus-pause-retry-"));
  try {
    const paused = task(root);
    fs.mkdirSync(path.join(root, "group-chat.md"));
    assert.throws(() => recordLoopPlusPause(paused, "loop-plus-blocked"));
    fs.rmdirSync(path.join(root, "group-chat.md"));
    recordLoopPlusPause(paused, "loop-plus-blocked");
    assert.equal((fs.readFileSync(paused.mainCommunicationFile, "utf8").match(/## 主任务暂停/g) ?? []).length, 1);
    assert.match(fs.readFileSync(path.join(root, "group-chat.md"), "utf8"), /主任务暂停/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
