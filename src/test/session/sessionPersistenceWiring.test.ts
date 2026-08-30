import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "node:test";

function readExtensionSource(): string {
  return fs.readFileSync(path.join(process.cwd(), "src", "extension.ts"), "utf8");
}

test("session store persistence is wired to the storage implementation, not the host wrapper", () => {
  const extensionSource = readExtensionSource();

  assert.match(
    extensionSource,
    /async function persistSessionStoreToStorage\(store: SessionStore\): Promise<void> \{[\s\S]*writeSessionFile\(store,\s*activeWorkspaceKey,[\s\S]*extensionContext\.globalState\.update\(getSessionStoreKey\(\),\s*store\);[\s\S]*\}/,
  );
  assert.match(
    extensionSource,
    /persistSessionStore:\s*\(store\)\s*=>\s*\{\s*void persistSessionStoreToStorage\(store\);\s*\}/,
  );
  assert.match(extensionSource, /persistSessionStore:\s*persistSessionStoreToStorage/);
  assert.doesNotMatch(
    extensionSource,
    /persistSessionStore:\s*\(store\)\s*=>\s*(?:void\s*)?persistSessionStore\(store\)/,
  );
  const sessionTabsHostDestructure = extensionSource
    .split("\n")
    .find((line) => line.includes("} = sessionTabsHost;")) ?? "";
  assert.doesNotMatch(sessionTabsHostDestructure, /\bpersistSessionStore\b/);
});
