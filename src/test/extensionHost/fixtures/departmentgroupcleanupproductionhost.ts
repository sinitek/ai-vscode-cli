import assert = require("node:assert/strict");
import * as path from "path";
import type { DepartmentRuntimeCompositionDeps } from "../../../extensionHost/departmentruntimecomposition";

/** Installed EH uses its activated extension and a test-only getter appended to
 * the ISOLATED compiled artifact. Capture real factory deps; no producer/client
 * injection and no production test API is exported. */
export async function verifyProductionGroupCleanup() {
  const factory = require("../../../extensionHost/departmentruntimecomposition") as typeof import("../../../extensionHost/departmentruntimecomposition");
  const original = factory.createDepartmentRuntimeComposition;
  let installed: DepartmentRuntimeCompositionDeps | undefined;
  factory.createDepartmentRuntimeComposition = (deps) => { installed = deps; return original(deps); };
  try {
    const extension = require(path.join(__dirname, "../../../extension.js")) as { __round231Composition(): unknown };
    assert.equal(typeof extension.__round231Composition, "function");
    extension.__round231Composition();
    assert.ok(installed); assert.equal(typeof installed.observeLeaderCleanup, "function");
    assert.equal(typeof installed.leaderReleased, "function");
    const unsupported = { id: "unregistered-cold-task", cli: "codex", workspaceKey: "isolated", department: undefined };
    assert.equal(installed.observeLeaderCleanup!(unsupported as never, 1), null);
    assert.equal(installed.observeLeaderCleanup!(unsupported as never, 2), null);
    return { callbackInstalled: true, releaseHookInstalled: true, unknownRejected: true, capacityReleased: false,
      scope: "activated extension real composition factory callback; unsupported/cold identity fails closed; no CLI or full UI" };
  } finally { factory.createDepartmentRuntimeComposition = original; }
}
