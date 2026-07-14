import test = require("node:test");
import assert = require("node:assert/strict");

import {
  assertMemoryRuntimeOperationAllowed,
  getLongTermMemoryRuntimeDisableReason,
  isLongTermMemoryRuntimeEnabled,
  isMemoryRuntimeOperationAllowed,
  type MemoryRuntimeOperation,
} from "../memory/runtimeGate";

const blockedWhenDisabled: MemoryRuntimeOperation[] = [
  "recall",
  "inject",
  "generateCandidate",
  "autoExtractAfterCompact",
  "autoExtractAfterLoopTask",
  "create",
  "update",
  "manualSave",
  "acceptCandidate",
  "quickRemember",
];

test("uses the shared long-term memory helper as the runtime gate", () => {
  assert.equal(isLongTermMemoryRuntimeEnabled({}), false);
  assert.equal(isLongTermMemoryRuntimeEnabled({ longTermMemoryEnabled: false }), false);
  assert.equal(isLongTermMemoryRuntimeEnabled({ workspaceSettings: { workspaceMemoryEnabled: true } }), true);
  assert.equal(isLongTermMemoryRuntimeEnabled({ workspaceSettings: { longTermMemoryEnabled: false } }), false);
  assert.equal(isLongTermMemoryRuntimeEnabled({ workspaceSettings: { longTermMemoryEnabled: true }, memoryEnabled: false }), false);
  assert.equal(isLongTermMemoryRuntimeEnabled({ workspaceSettings: { workspaceMemoryEnabled: false } }), false);
  assert.equal(getLongTermMemoryRuntimeDisableReason({ workspaceSettings: { workspaceMemoryEnabled: true } }), null);
});

test("blocks all plugin memory recall injection extraction and writes when disabled", () => {
  for (const operation of blockedWhenDisabled) {
    assert.equal(
      isMemoryRuntimeOperationAllowed(operation, { workspaceSettings: { workspaceMemoryEnabled: false } }),
      false,
      operation,
    );
  }
});

test("still allows viewing exporting and deleting existing memories when disabled", () => {
  assert.equal(isMemoryRuntimeOperationAllowed("view", { workspaceSettings: { workspaceMemoryEnabled: false } }), true);
  assert.equal(isMemoryRuntimeOperationAllowed("export", { workspaceSettings: { workspaceMemoryEnabled: false } }), true);
  assert.equal(isMemoryRuntimeOperationAllowed("delete", { workspaceSettings: { workspaceMemoryEnabled: false } }), true);
});

test("keeps auto extraction as a secondary opt-in after the total switch", () => {
  assert.equal(isMemoryRuntimeOperationAllowed("autoExtractAfterCompact", {}), false);
  assert.equal(isMemoryRuntimeOperationAllowed("autoExtractAfterLoopTask", {}), false);
  assert.equal(
    isMemoryRuntimeOperationAllowed("autoExtractAfterCompact", {
      workspaceSettings: { workspaceMemoryEnabled: true },
      memoryAutoExtractAfterCompact: true,
    }),
    true,
  );
  assert.equal(
    isMemoryRuntimeOperationAllowed("autoExtractAfterCompact", {
      workspaceSettings: { workspaceMemoryEnabled: false },
      memoryAutoExtractAfterCompact: true,
    }),
    false,
  );
});

test("throws a stable gate error for forbidden runtime operations", () => {
  assert.throws(
    () => assertMemoryRuntimeOperationAllowed("manualSave", { workspaceSettings: { workspaceMemoryEnabled: false } }),
    /long-term-memory-disabled:manualSave/,
  );
  assert.doesNotThrow(() => assertMemoryRuntimeOperationAllowed("delete", { workspaceSettings: { workspaceMemoryEnabled: false } }));
});
