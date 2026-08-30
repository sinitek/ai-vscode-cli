import test = require("node:test");
import assert = require("node:assert/strict");

import { VIEW_CONTENT_SCRIPT_MESSAGE_RENDERING } from "../../webview/viewContentScript/messageRendering";

type PagerDirection = "prev" | "next";

function extractFunctionSource(script: string, name: string): string {
  const start = script.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} should exist in webview script`);

  const bodyStart = script.indexOf("{", start);
  assert.notEqual(bodyStart, -1, `${name} should have a body`);

  let depth = 0;
  for (let index = bodyStart; index < script.length; index += 1) {
    const char = script[index];
    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return script.slice(start, index + 1);
      }
    }
  }

  throw new Error(`${name} body was not terminated`);
}

function buildShouldShowConversationTabPagerButton(): (
  direction: PagerDirection,
  pageIndex: number,
  pageCount: number,
) => boolean {
  const functionSource = extractFunctionSource(
    VIEW_CONTENT_SCRIPT_MESSAGE_RENDERING,
    "shouldShowConversationTabPagerButton",
  );

  return new Function(
    `${functionSource}; return shouldShowConversationTabPagerButton;`,
  )() as (direction: PagerDirection, pageIndex: number, pageCount: number) => boolean;
}

test("hides unavailable conversation tab pager directions", () => {
  const shouldShow = buildShouldShowConversationTabPagerButton();

  assert.equal(shouldShow("prev", 0, 3), false);
  assert.equal(shouldShow("next", 0, 3), true);
  assert.equal(shouldShow("prev", 1, 3), true);
  assert.equal(shouldShow("next", 1, 3), true);
  assert.equal(shouldShow("prev", 2, 3), true);
  assert.equal(shouldShow("next", 2, 3), false);
  assert.equal(shouldShow("prev", 0, 1), false);
  assert.equal(shouldShow("next", 0, 1), false);
});
