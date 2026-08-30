import * as assert from "node:assert/strict";
import { test } from "node:test";

import { VIEW_CONTENT_SCRIPT_TASK_LIST_AND_UI } from "../../webview/viewContentScript/taskListAndUi";

function extractFunctionSource(source: string, functionName: string): string {
  const signature = `function ${functionName}`;
  const start = source.indexOf(signature);
  assert.notEqual(start, -1, `Missing ${functionName}`);
  const bodyStart = source.indexOf("{", start);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === "{") {
      depth += 1;
    } else if (source[index] === "}") {
      depth -= 1;
      if (depth === 0) {
        return source.slice(start, index + 1);
      }
    }
  }
  throw new Error(`Unterminated ${functionName}`);
}

function buildPromptHistory(messages: unknown[], currentRunPrompt = "") {
  const functionSource = extractFunctionSource(VIEW_CONTENT_SCRIPT_TASK_LIST_AND_UI, "getRunPromptHistory");
  const runtimeState = { messages, currentRunPrompt };
  return new Function(
    "getConversationRuntimeState",
    "ensureRuntimeStateMessages",
    `${functionSource}; return getRunPromptHistory("tab-1");`,
  )(
    () => runtimeState,
    (state: typeof runtimeState) => state.messages,
  ) as Array<{ content: string; createdAt: number; index: number }>;
}

test("collects all user prompts in reverse chronological order", () => {
  const prompts = buildPromptHistory([
    { role: "user", content: "first prompt", createdAt: 100 },
    { role: "assistant", content: "ignored", createdAt: 200 },
    { role: "user", content: " latest prompt ", createdAt: 300 },
    { role: "system", content: "ignored", createdAt: 400 },
    { role: "user", content: "middle prompt", createdAt: 200 },
  ]);

  assert.deepEqual(prompts.map((item) => item.content), [
    "latest prompt",
    "middle prompt",
    "first prompt",
  ]);
});

test("uses message order when prompt timestamps are unavailable", () => {
  const prompts = buildPromptHistory([
    { role: "user", content: "older" },
    { role: "user", content: "newer" },
  ]);

  assert.deepEqual(prompts.map((item) => item.content), ["newer", "older"]);
});

test("keeps the current run prompt when it is not in restored messages", () => {
  const prompts = buildPromptHistory([
    { role: "user", content: "previous", createdAt: 100 },
  ], "current");

  assert.deepEqual(prompts.map((item) => item.content), ["current", "previous"]);
});

test("keeps a repeated current prompt when only an older duplicate was restored", () => {
  const prompts = buildPromptHistory([
    { role: "user", content: "repeat", createdAt: 100 },
    { role: "user", content: "different", createdAt: 200 },
  ], "repeat");

  assert.deepEqual(prompts.map((item) => item.content), ["repeat", "different", "repeat"]);
});
