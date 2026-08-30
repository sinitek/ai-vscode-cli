import test = require("node:test");
import assert = require("node:assert/strict");
import * as fs from "fs";
import * as path from "path";
import {
  createLoopSubtaskProgressMonitor,
  extractLoopSubtaskVisibleText,
  mapLoopRunStatusToSubagentStatus,
} from "../../loopSubtaskProgress";
import type { SubagentProgressUpdate } from "../../subagentProgress";
import type { ChatMessage } from "../../webview/types";

function assistant(content: string, overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: `message-${content}`,
    role: "assistant",
    content,
    taskRole: "subtask",
    loopTaskId: "task-1",
    loopRound: 2,
    loopSubtaskId: "subtask-a",
    ...overrides,
  };
}

test("extracts only visible assistant text for the matching Loop subtask", () => {
  const messages: ChatMessage[] = [
    assistant("first"),
    assistant("hidden reasoning", { kind: "thinking" }),
    assistant("nested child", { subagentId: "child-1", subagentProvider: "opencode" }),
    assistant("other round", { loopRound: 1 }),
    assistant("second"),
    { id: "trace", role: "trace", content: "tool input" },
  ];

  assert.equal(extractLoopSubtaskVisibleText(messages, {
    taskId: "task-1",
    round: 2,
    subtaskId: "subtask-a",
  }), "first\n\nsecond");
});

test("emits an immediate waiting update, deduplicates snapshots, and finishes", () => {
  const messages: ChatMessage[] = [];
  const updates: SubagentProgressUpdate[] = [];
  const intervalCallbacks: Array<() => void> = [];
  let cleared = false;
  const monitor = createLoopSubtaskProgressMonitor({
    taskId: "task-1",
    round: 2,
    subtaskId: "subtask-a",
    subtaskTitle: "Audit active plans",
    waitingText: "Waiting for visible output.",
    readMessages: () => messages,
    onUpdate: (update) => updates.push(update),
    scheduler: {
      setInterval: (callback, delayMs) => {
        assert.equal(delayMs, 1000);
        intervalCallbacks.push(callback);
        return "interval";
      },
      clearInterval: (handle) => {
        assert.equal(handle, "interval");
        cleared = true;
      },
    },
  });

  monitor.start();
  assert.equal(updates.length, 1);
  assert.deepEqual(updates[0], {
    provider: "loop",
    id: "task-1:2:subtask-a",
    agentName: "Audit active plans",
    status: "running",
    text: "Waiting for visible output.",
  });

  intervalCallbacks[0]?.();
  assert.equal(updates.length, 1);

  messages.push(assistant("Streaming result"));
  intervalCallbacks[0]?.();
  assert.equal(updates.length, 2);
  assert.equal(updates[1]?.text, "Streaming result");

  monitor.finish("completed");
  assert.equal(updates.length, 3);
  assert.equal(updates[2]?.status, "completed");
  assert.equal(updates[2]?.text, "Streaming result");
  assert.equal(cleared, true);
});

test("maps Loop run terminal states to subagent bubble states", () => {
  assert.equal(mapLoopRunStatusToSubagentStatus("end"), "completed");
  assert.equal(mapLoopRunStatusToSubagentStatus("error"), "failed");
  assert.equal(mapLoopRunStatusToSubagentStatus("stopped"), "interrupted");
});

test("wires Loop subtask progress snapshots into the main conversation bubble", () => {
  const loopOrchestrationSource = fs.readFileSync(
    path.join(process.cwd(), "src", "extensionHost", "loopOrchestration.ts"),
    "utf8",
  );
  const runnerStart = loopOrchestrationSource.indexOf("async function runLoopSubtaskWithRetry");
  const runnerEnd = loopOrchestrationSource.indexOf("async function waitForLoopSubtaskRetryDelay", runnerStart);
  assert.ok(runnerStart >= 0 && runnerEnd > runnerStart);
  const runnerSource = loopOrchestrationSource.slice(runnerStart, runnerEnd);

  assert.match(runnerSource, /createSubagentProgressController\(\{/u);
  assert.match(runnerSource, /createLoopSubtaskProgressMonitor\(\{/u);
  assert.match(runnerSource, /readMessages: \(\) => currentSubtaskTarget/u);
  assert.match(runnerSource, /sendPanelMessage\(\{ type: "appendMessage", message, tabId: target\.tabId \}\)/u);
  assert.match(runnerSource, /progressMonitor\.finish\(terminalProgressStatus \?\? "interrupted"\)/u);
});
