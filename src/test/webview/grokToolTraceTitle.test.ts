import * as assert from "node:assert/strict";
import { test } from "node:test";

import { WEBVIEW_STRINGS } from "../../webview/viewContentStrings";
import { VIEW_CONTENT_SCRIPT_TRACE_RENDERING } from "../../webview/viewContentScript/traceRendering";

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

type TracePresentation = {
  type: string;
  title: string;
  detail: string;
};

function buildTracePresentation(): (content: string) => TracePresentation {
  const source = [
    "stripLeadingEmptyLines",
    "unwrapShellCommand",
    "stripWrappedQuotes",
    "normalizeCommandForMatching",
    "classifyCommandPurposeTag",
    "getToolStyleBucket",
    "getLocalizedToolTitle",
    "getTraceTypeDefinition",
    "getTracePresentation",
  ].map((name) => extractFunctionSource(VIEW_CONTENT_SCRIPT_TRACE_RENDERING, name)).join("\n");
  const strings = WEBVIEW_STRINGS;
  return new Function(
    "t",
    "expandFileChangeTraceContent",
    `${source}; return getTracePresentation;`,
  )(
    (key: keyof typeof WEBVIEW_STRINGS) => strings[key],
    (value: string) => value,
  ) as (content: string) => TracePresentation;
}

const CALL_ID = "call-2d87b215-0a75-404f-815a-686594e3def5-84";

test("uses the output type as the tool result trace title", () => {
  const present = buildTracePresentation();
  const definitionSource = extractFunctionSource(
    VIEW_CONTENT_SCRIPT_TRACE_RENDERING,
    "getTraceTypeDefinition",
  );
  const toolResultAt = definitionSource.indexOf("tool\\s*result");
  const genericToolAt = definitionSource.indexOf("(?:tool|调用工具)");
  assert.notEqual(toolResultAt, -1);
  assert.notEqual(genericToolAt, -1);
  assert.ok(toolResultAt < genericToolAt);

  const readFile = present([
    `tool result: ${CALL_ID}`,
    "status: completed",
    "output:",
    "{",
    '  "type": "text",',
    '  "text": "skip me"',
    "}",
    "{",
    '  "type": "ReadFile",',
    '  "path": "a.ts"',
    "}",
  ].join("\n"));
  assert.equal(readFile.title, "ReadFile");
  assert.notEqual(readFile.title, `result: ${CALL_ID}`);
  assert.equal(readFile.title.includes(CALL_ID), false);
  assert.equal(readFile.title.includes("result:"), false);

  const bashResult = present("tool result: bash\nstatus: completed\n");
  const bashTool = present("tool: bash\ninput:\n{}\n");
  assert.equal(bashResult.title, WEBVIEW_STRINGS.traceExec);
  assert.notEqual(bashResult.title, "result: bash");
  assert.equal(bashTool.title, WEBVIEW_STRINGS.traceExec);
  assert.equal(bashTool.type.startsWith("tool-use-"), true);
  assert.equal(present("tool result: read").title, WEBVIEW_STRINGS.traceToolReadFile);
  assert.equal(present("tool result: grep").title, WEBVIEW_STRINGS.traceToolSearchText);
  assert.equal(present("tool result: edit").title, WEBVIEW_STRINGS.traceToolEditFile);

  const textOnly = present(`tool result: ${CALL_ID}\noutput:\n{ "type": "text" }\n`);
  assert.equal(textOnly.title, "tool");
  assert.equal(textOnly.title.includes(CALL_ID), false);

  assert.equal(present("exec: npm test").title, WEBVIEW_STRINGS.traceExec);
  assert.equal(present("exec: npm test").type, "exec");
  assert.equal(present("git update origin").title, WEBVIEW_STRINGS.traceGitUpdate);
  assert.equal(present("git update origin").type, "git-update");
  assert.equal(present("apply_patch a.ts").title, WEBVIEW_STRINGS.traceApplyPatch);
  assert.equal(present("apply_patch a.ts").type, "apply-patch");
  assert.equal(present("thinking: look again").title, WEBVIEW_STRINGS.traceThinking);
  assert.equal(present("thinking: look again").type, "thinking");
  assert.equal(present("工具结果: bash").title, WEBVIEW_STRINGS.traceExec);
  assert.equal(present("工具结果: bash").type, "tool-result");
});
