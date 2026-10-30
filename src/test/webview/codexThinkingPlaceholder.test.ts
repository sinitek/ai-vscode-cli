import * as assert from "node:assert/strict";
import { test } from "node:test";

import { joinGrokThinkingSoftBreaks } from "../../interactive/grokThinkingText";
import { VIEW_CONTENT_SCRIPT_TRACE_RENDERING } from "../../webview/viewContentScript/traceRendering";
import { VIEW_CONTENT_SCRIPT_MESSAGE_RENDERING } from "../../webview/viewContentScript/messageRendering";

function extractFunctionSource(source: string, functionName: string): string {
  const signature = `function ${functionName}`;
  const start = source.indexOf(signature);
  assert.notEqual(start, -1, `Missing ${functionName}`);
  let parameterDepth = 0;
  let bodyStart = -1;
  for (let index = start + signature.length; index < source.length; index += 1) {
    const char = source[index];
    if (char === "(") {
      parameterDepth += 1;
    } else if (char === ")") {
      parameterDepth -= 1;
    } else if (char === "{" && parameterDepth === 0) {
      bodyStart = index;
      break;
    }
  }
  assert.notEqual(bodyStart, -1, `Missing ${functionName} body`);
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

type AssistantMessage = {
  role: string;
  kind?: string;
  content?: string;
};

function buildDisplayContent(cli = "codex"): (message: AssistantMessage) => string {
  const source = VIEW_CONTENT_SCRIPT_TRACE_RENDERING.replace(/\$\{FINAL_ANSWER_TEXT_MARKER\}/g, "[final_answer]");
  const helper = extractFunctionSource(source, "stripCodexThinkingPlaceholderText");
  const display = extractFunctionSource(source, "getAssistantMessageContentForDisplay");
  return new Function(
    "joinGrokThinkingSoftBreaks",
    "stripParsedTaskListContentFromText",
    "state",
    `${helper}\n${display}\nreturn getAssistantMessageContentForDisplay;`,
  )(
    joinGrokThinkingSoftBreaks,
    (content: string) => content,
    { currentCli: cli },
  ) as (message: AssistantMessage) => string;
}

test("Codex thinking placeholders do not produce visible thinking content", () => {
  const getDisplayContent = buildDisplayContent();
  const placeholder = "**Thinking**\n\n*Thinking process completed.***Thinking**\n\n*Thinking process completed.*";

  assert.equal(getDisplayContent({ role: "assistant", kind: "thinking", content: placeholder }), "");
  assert.equal(
    getDisplayContent({
      role: "assistant",
      kind: "thinking",
      content: `${placeholder}**Inspecting the repository**`,
    }),
    "**Inspecting the repository**",
  );
  assert.equal(
    getDisplayContent({ role: "assistant", content: placeholder }),
    placeholder,
  );
  assert.equal(
    getDisplayContent({ role: "user", content: placeholder }),
    placeholder,
  );
  assert.equal(
    buildDisplayContent("claude")({ role: "assistant", kind: "thinking", content: placeholder }),
    placeholder,
  );
});

test("Codex placeholder-only messages stay hidden during replay and incremental updates", () => {
  const getDisplayContent = buildDisplayContent();
  const hasRenderableMessageContent = new Function(
    "getAssistantMessageContentForDisplay",
    "normalizeMessageActions",
    `${extractFunctionSource(VIEW_CONTENT_SCRIPT_MESSAGE_RENDERING, "hasRenderableMessageContent")}\nreturn hasRenderableMessageContent;`,
  )(getDisplayContent, () => []) as (message: AssistantMessage) => boolean;
  const placeholder = "**Thinking**\n\n*Thinking process completed.*";
  const message: AssistantMessage = { role: "assistant", kind: "thinking", content: "" };
  for (let length = 1; length <= placeholder.length; length += 1) {
    message.content = placeholder.slice(0, length);
    assert.equal(hasRenderableMessageContent(message), false, `prefix ${length}`);
    message.content = placeholder + placeholder.slice(0, length);
    assert.equal(hasRenderableMessageContent(message), false, `repeated prefix ${length}`);
  }
  message.content = `${placeholder}${placeholder}\n\n${placeholder}`;
  assert.equal(hasRenderableMessageContent(message), false);
  message.content += "**Inspecting tests**\n\n继续检查。";
  assert.equal(hasRenderableMessageContent(message), true);
  assert.equal(getDisplayContent(message), "**Inspecting tests**\n\n继续检查。");
});
