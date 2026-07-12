import test = require("node:test");
import assert = require("node:assert/strict");

import { sanitizeCodexReasoningContent } from "../codexReasoningContent";
import { sanitizeMessages } from "../sessionStore";
import { ChatMessage } from "../webview/types";

test("sanitizeCodexReasoningContent removes standalone empty comment separators", () => {
  assert.equal(
    sanitizeCodexReasoningContent(
      "**Planning first step**\n\n<!-- -->\n\n**Planning second step**\n\n<!--\t-->\n"
    ),
    "**Planning first step**\n\n**Planning second step**"
  );
});

test("sanitizeCodexReasoningContent preserves inline and non-empty comments", () => {
  const content = [
    "Keep inline <!-- --> example",
    "<!-- keep this explanation -->",
  ].join("\n");
  assert.equal(sanitizeCodexReasoningContent(content), content);
});

test("sanitizeCodexReasoningContent removes internal thinking wrapper tags", () => {
  assert.equal(
    sanitizeCodexReasoningContent("<thinking>**Mapping execution flow**</thinking>"),
    "**Mapping execution flow**",
  );
  assert.equal(
    sanitizeCodexReasoningContent("Keep <div>real markup</div> intact"),
    "Keep <div>real markup</div> intact",
  );
});

test("sanitizeMessages removes thinking wrappers from persisted OpenCode assistant output", () => {
  const messages: ChatMessage[] = [
    {
      id: "opencode-assistant",
      role: "assistant",
      content: "<thinking>**Inspecting tests**</thinking>\n继续处理。",
      createdAt: 1,
    },
    {
      id: "opencode-user",
      role: "user",
      content: "请解释 <thinking> 标签",
      createdAt: 2,
    },
  ];

  const result = sanitizeMessages(messages, "opencode");
  assert.equal(result.changed, true);
  assert.equal(result.messages[0]?.content, "**Inspecting tests**\n继续处理。");
  assert.equal(result.messages[1]?.content, "请解释 <thinking> 标签");
});

test("sanitizeMessages repairs only persisted Codex thinking messages", () => {
  const messages: ChatMessage[] = [
    {
      id: "codex-thinking",
      role: "assistant",
      kind: "thinking",
      content: "**Planning**\n\n<!-- -->\n",
      createdAt: 1,
    },
    {
      id: "normal-assistant",
      role: "assistant",
      content: "Document this example:\n\n<!-- -->",
      createdAt: 2,
    },
  ];

  const codexResult = sanitizeMessages(messages, "codex");
  assert.equal(codexResult.changed, true);
  assert.equal(codexResult.messages[0]?.content, "**Planning**");
  assert.equal(codexResult.messages[1]?.content, "Document this example:\n\n<!-- -->");

  const claudeResult = sanitizeMessages(messages, "claude");
  assert.equal(claudeResult.messages[0]?.content, "**Planning**\n\n<!-- -->\n");
});

test("sanitizeMessages drops a Codex thinking message containing only empty markers", () => {
  const messages: ChatMessage[] = [{
    id: "empty-thinking",
    role: "assistant",
    kind: "thinking",
    content: "<!-- -->\n<!--\t-->",
    createdAt: 1,
  }];

  assert.deepEqual(sanitizeMessages(messages, "codex"), {
    messages: [],
    changed: true,
  });
});
