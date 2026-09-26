import test = require("node:test");
import assert = require("node:assert/strict");

import { installVscodeMock } from "../vscodeMock";

installVscodeMock();

const { t } = require("../../i18n") as typeof import("../../i18n");
const { parseLoopDebateChatTranscript } = require("../../loopDebate") as typeof import("../../loopDebate");
const {
  buildLoopPlusGroupChatSection,
  buildLoopPlusSubtaskParentMessage,
} = require("../../extensionHost/loopPlusSubtaskChat") as typeof import("../../extensionHost/loopPlusSubtaskChat");
type LoopPlusSubtaskChatNotice = import("../../extensionHost/loopPlusSubtaskChat").LoopPlusSubtaskChatNotice;

const filePath = "/Users/demo/.sinitek_cli/loop-communications/task-1/subtasks/alpha.md";

function notice(overrides: Partial<LoopPlusSubtaskChatNotice> = {}): LoopPlusSubtaskChatNotice {
  return {
    taskId: "task-1",
    subtaskId: "alpha",
    title: "实现执行群聊",
    phase: "finished",
    round: 1,
    communicationFile: filePath,
    runStatus: "end",
    assistantContent: "已完成修复。",
    ...overrides,
  };
}

test("Loop+ completion chat includes the communication file beside the final reply", () => {
  const section = buildLoopPlusGroupChatSection(notice(), "子任务 1：实现执行群聊");
  const parsed = parseLoopDebateChatTranscript(`## ${section.heading}\n${section.body}\n`);
  assert.equal(parsed.segments[0]?.kind, "subtask-turn");
  assert.equal(parsed.segments[0]?.actorId, "alpha");
  assert.match(section.body, /已完成修复。/u);
  assert.ok(section.body.includes(`沟通文件：${filePath}`));
});

test("Loop+ completion chat does not duplicate a communication file already in the reply", () => {
  const section = buildLoopPlusGroupChatSection(notice({
    runStatus: "error",
    assistantContent: null,
  }), "子任务 1：实现执行群聊");
  assert.equal(section.body.match(/沟通文件：/gu)?.length, 1);
  assert.match(section.body, /未捕获到子任务最终回复/u);
});

test("Loop+ parent chat shows the communication file when a subtask starts and finishes", () => {
  const started = buildLoopPlusSubtaskParentMessage(notice({
    phase: "started",
    assistantContent: null,
    runStatus: undefined,
  }), (key, params) => t(key, params, "zh-CN"));
  assert.match(started, /Loop 子任务已启动：实现执行群聊/u);
  assert.ok(started.includes(`沟通文件：${filePath}`));

  const finished = buildLoopPlusSubtaskParentMessage(notice(), (key, params) => t(key, params, "zh-CN"));
  assert.match(finished, /Loop\+ 子任务已结束：实现执行群聊/u);
  assert.match(finished, /运行结果：已完成/u);
  assert.ok(finished.includes(`沟通文件：${filePath}`));

  const english = buildLoopPlusSubtaskParentMessage(notice({
    communicationFile: "  ",
  }), (key, params) => t(key, params, "en"));
  assert.match(english, /Loop\+ subtask finished: 实现执行群聊/u);
  assert.match(english, /Result: completed/u);
  assert.equal(english.includes("Communication file"), false);
  assert.equal(english.includes("沟通文件"), false);
});

test("Loop+ join chat records the communication file before the subtask finishes", () => {
  const section = buildLoopPlusGroupChatSection(notice({
    phase: "started",
    assistantContent: null,
    runStatus: undefined,
  }), "子任务 1：实现执行群聊");
  const parsed = parseLoopDebateChatTranscript(`## ${section.heading}\n${section.body}\n`);
  assert.equal(parsed.segments[0]?.kind, "subtask-joined");
  assert.ok(section.body.includes(`沟通文件：${filePath}`));
  assert.match(section.body, /状态：running/u);
});
