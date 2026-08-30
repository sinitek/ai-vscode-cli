import test = require("node:test");
import assert = require("node:assert/strict");
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { createLoopSubtaskExecutionRoot } from "../../loopSubtaskExecutionRoot";

test("creates a writable Loop subtask execution root without repository rules or skills", () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sinitek-loop-subtask-source-"));
  fs.writeFileSync(path.join(workspaceRoot, "AGENTS.md"), "project rules", "utf8");
  fs.writeFileSync(path.join(workspaceRoot, "CLAUDE.md"), "claude rules", "utf8");
  fs.mkdirSync(path.join(workspaceRoot, ".agents", "skills"), { recursive: true });
  fs.writeFileSync(path.join(workspaceRoot, ".agents", "skills", "SKILL.md"), "skill", "utf8");
  fs.mkdirSync(path.join(workspaceRoot, "src"));
  fs.writeFileSync(path.join(workspaceRoot, "src", "app.ts"), "before", "utf8");

  const executionRoot = createLoopSubtaskExecutionRoot(workspaceRoot);
  try {
    assert.equal(fs.existsSync(path.join(executionRoot.cwd, "AGENTS.md")), false);
    assert.equal(fs.existsSync(path.join(executionRoot.cwd, "CLAUDE.md")), false);
    assert.equal(fs.existsSync(path.join(executionRoot.cwd, ".agents")), false);

    const linkedSource = path.join(executionRoot.cwd, "src", "app.ts");
    assert.equal(fs.readFileSync(linkedSource, "utf8"), "before");
    fs.writeFileSync(linkedSource, "after", "utf8");
    assert.equal(fs.readFileSync(path.join(workspaceRoot, "src", "app.ts"), "utf8"), "after");
  } finally {
    executionRoot.dispose();
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }

  assert.equal(fs.existsSync(executionRoot.cwd), false);
});
