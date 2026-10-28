import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "node:test";

const extensionSource = fs.readFileSync(path.join(process.cwd(), "src", "extension.ts"), "utf8");

function readFunction(name: string): string {
  const match = extensionSource.match(new RegExp(`(?:async )?function ${name}\\b[\\s\\S]*?^\\}`, "m"));
  assert.ok(match, `Missing ${name} in extension.ts`);
  return match[0];
}

test("does not reject model changes for execution-locked conversation tabs", () => {
  const selectors = [
    ["selectCliModel", "selectCliModelFromStore"],
    ["selectCliLoopModel", "selectCliLoopModelFromStore"],
    ["updateOpenCodeRoleModelForConfig", "updateOpenCodeRoleModelForConfigFromStore"],
  ] as const;

  for (const [selectorName, writerName] of selectors) {
    const source = readFunction(selectorName);
    assert.match(source, new RegExp(`\\b${writerName}\\b`));
    assert.doesNotMatch(source, /isConversationTabExecutionLocked|isActiveConversationTabModelLockedForCli/);
  }
});
