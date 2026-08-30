import * as assert from "node:assert/strict";
import { test } from "node:test";

import { WEBVIEW_I18N } from "../../webview/viewContentI18n";
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

function buildToolTitleResolver(locale: "en" | "zh-CN") {
  const functionSource = extractFunctionSource(
    VIEW_CONTENT_SCRIPT_TRACE_RENDERING,
    "getLocalizedToolTitle",
  );
  const strings = WEBVIEW_I18N[locale];
  return new Function(
    "t",
    `${functionSource}; return getLocalizedToolTitle;`,
  )((key: keyof typeof WEBVIEW_I18N.en) => strings[key]) as (toolName: string) => string;
}

test("localizes common OpenCode tool bubble titles in Chinese", () => {
  const resolveTitle = buildToolTitleResolver("zh-CN");

  assert.equal(resolveTitle("read"), "读取文件");
  assert.equal(resolveTitle("grep"), "搜索文本");
  assert.equal(resolveTitle("glob"), "查找文件");
  assert.equal(resolveTitle("bash"), "执行命令");
  assert.equal(resolveTitle("apply_patch"), "应用补丁");
  assert.equal(resolveTitle("todowrite"), "更新任务列表");
  assert.equal(resolveTitle("webfetch"), "获取网页");
});

test("uses English labels and preserves unknown tool names", () => {
  const resolveTitle = buildToolTitleResolver("en");

  assert.equal(resolveTitle("TodoWrite"), "Update Task List");
  assert.equal(resolveTitle("custom_tool"), "custom_tool");
  assert.equal(resolveTitle(""), "tool");
  assert.match(
    VIEW_CONTENT_SCRIPT_TRACE_RENDERING,
    /title:\s*getLocalizedToolTitle\(toolName\)/,
  );
});
