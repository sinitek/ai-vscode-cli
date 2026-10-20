import * as assert from "node:assert/strict";
import { test } from "node:test";

import { WEBVIEW_STRINGS } from "../../webview/viewContentStrings";
import { getTraceInstructionSummary } from "../../webview/instructionGroupSummary";
import { VIEW_CONTENT_SCRIPT_TRACE_RENDERING } from "../../webview/viewContentScript/traceRendering";

type TracePresentation = {
  type: string;
  title: string;
  detail: string;
};

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

const present = buildTracePresentation();

function collapsedLabel(content: string): string {
  const presentation = present(content);
  const summary = getTraceInstructionSummary(content, presentation);
  if (!presentation.title) {
    return summary;
  }
  return summary ? `${presentation.title}： ${summary}` : presentation.title;
}

test("collapsed exec bubbles keep the command after the title", () => {
  assert.equal(
    collapsedLabel("exec /bin/zsh -lc 'rg -n title src/webview/messageRendering.ts'"),
    "执行命令： rg -n title src/webview/messageRendering.ts",
  );
  assert.equal(
    collapsedLabel("exec /bin/zsh -lc 'cat /Users/fangjiawei/sinitek/sinitek-ai-vscode-cli/src/webview/messageRendering.ts'"),
    "执行命令： cat …/src/webview/messageRendering.ts",
  );
  assert.equal(collapsedLabel("【执行命令】 npm test"), "执行命令： npm test");
  assert.equal(collapsedLabel("exec"), "执行命令");
});

test("collapsed tool bubbles use the cli-specific summary and skip empty metadata", () => {
  assert.equal(
    collapsedLabel([
      "tool: run_terminal_command",
      "status: completed",
      "command: npx tsc -p apps/server-frontend/tsconfig.json --noEmit",
      "exit_code: 0",
    ].join("\n")),
    "run_terminal_command： npx tsc -p apps/server-frontend/tsconfig.json --noEmit",
  );
  assert.equal(
    collapsedLabel([
      "tool: read_file",
      "input:",
      "{",
      '"target_file": "/Users/fangjiawei/sinitek/ops_evolution_platform/apps/server-frontend/src/pages/replaypage.tsx"',
      '"limit": 80',
      "}",
    ].join("\n")),
    "read_file： …/src/pages/replaypage.tsx",
  );
  assert.equal(
    collapsedLabel("tool: read_file\nstatus: completed\nlimit: 80"),
    "read_file",
  );
  assert.equal(
    collapsedLabel("tool: grep\nstatus: completed\npattern: 执行指令\nglob: *.{ts,js}"),
    "搜索文本： 执行指令",
  );
  assert.equal(
    collapsedLabel("tool read\nstatus: completed\ndocs/02_原型/ops-evolution-ui-style-guide.md"),
    "读取文件： docs/02_原型/ops-evolution-ui-style-guide.md",
  );
  assert.equal(
    collapsedLabel("tool bash\nstatus: completed\nnode -e 'console.log(\"node works\")'"),
    "执行命令： node -e 'console.log(\"node works\")'",
  );
  assert.equal(
    collapsedLabel("tool todowrite\nstatus: completed\n5 todos"),
    "更新任务列表： 5 todos",
  );
  assert.equal(
    collapsedLabel([
      "tool: Read",
      "输入:",
      "{",
      '"file_path": "/Users/fangjiawei/sinitek/ops_evolution_platform/docs/02_设计/ops-evolution-prototype.html"',
      "}",
    ].join("\n")),
    "读取文件： …/docs/02_设计/ops-evolution-prototype.html",
  );
  assert.equal(collapsedLabel("tool: edit\ninput:\n{}\n"), "编辑文件");
  assert.equal(collapsedLabel("工具结果: Read"), "读取文件");
  assert.equal(
    collapsedLabel("工具结果: Edit\n输出:\nThe file /Users/fangjiawei/sinitek/ops_evolution_platform/docs/02_设计/ops-evolution-prototype.html has been updated."),
    "编辑文件： The file …/docs/02_设计/ops-evolution-prototype.html has been updated.",
  );
});

test("collapsed file, search, warning, and error bubbles keep one readable line", () => {
  assert.equal(
    collapsedLabel("file update\nstatus: completed\nupdate: /Users/fangjiawei/sinitek/sinitek-ai-vscode-cli/src/webview/viewContentScript/messageRendering.ts"),
    "文件变更： …/webview/viewContentScript/messageRendering.ts",
  );
  assert.equal(
    collapsedLabel("web search Vite reportCompressedSize minify"),
    "网络查询： Vite reportCompressedSize minify",
  );
  assert.equal(collapsedLabel("warning Reconnecting... 1/5"), "警告： Reconnecting... 1/5");
  assert.equal(
    collapsedLabel("error\nexceeded retry limit, last status: 429 Too Many Requests"),
    "错误： exceeded retry limit, last status: 429 Too Many Requests",
  );
  assert.equal(getTraceInstructionSummary("", null), "");
  assert.equal(getTraceInstructionSummary("exec pwd", { type: "exec", title: "pwd", detail: "pwd" }), "");
});
