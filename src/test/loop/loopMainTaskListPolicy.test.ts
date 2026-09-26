import * as assert from "node:assert/strict";
import * as fs from "fs";
import * as path from "path";
import { test } from "node:test";

import {
  LOOP_MAIN_STALE_TASK_LIST_RULE_EN,
  LOOP_MAIN_STALE_TASK_LIST_RULE_ZH,
} from "../../loopMainTaskListPolicy";

test("Loop and Loop+ main prompts forbid repeating a stale task list", () => {
  const classic = fs.readFileSync(
    path.resolve(process.cwd(), "src/extensionHost/loopOrchestration.ts"),
    "utf8",
  );
  const plus = fs.readFileSync(
    path.resolve(process.cwd(), "src/extensionHost/loopPlusPromptBuilders.ts"),
    "utf8",
  );
  assert.match(classic, /LOOP_MAIN_STALE_TASK_LIST_RULE_ZH/);
  assert.match(plus, /LOOP_MAIN_STALE_TASK_LIST_RULE_EN/);
  assert.match(LOOP_MAIN_STALE_TASK_LIST_RULE_ZH, /不得复述/);
  assert.match(LOOP_MAIN_STALE_TASK_LIST_RULE_EN, /earlier task list in this thread is stale/);
  assert.doesNotMatch(
    fs.readFileSync(path.resolve(process.cwd(), "src/extensionHost/loopPlusPromptBuilders.ts"), "utf8").split("export function buildLoopPlusSubtaskModelPrompt")[1] ?? "",
    /LOOP_MAIN_STALE_TASK_LIST_RULE_EN/,
  );
});
