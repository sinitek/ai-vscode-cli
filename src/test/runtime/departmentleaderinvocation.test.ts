import test = require("node:test");
import assert = require("node:assert/strict");
import { isLeaderInvocation } from "../../runtime/departmentleadercodexcontract";
import { isDepartmentLeaderProcessInvocation } from "../../runtime/departmentleaderprocesscontract";
import { isDepartmentLeaderPrivateCommand } from "../../runtime/departmentleaderinvocation";
import { isDepartmentCodexPreparation } from "../../runtime/departmentcodexpreparationcontract";
import { isDepartmentProcessPreparation } from "../../runtime/departmentprocesspreparationcontract";
import * as os from "os";
import { fingerprintDepartmentExecutionSelection, type DepartmentExecutionSelection } from "../../runtime/departmentexecutionidentity";

const selection: DepartmentExecutionSelection = { version: 1, role: "leader", cli: "codex", configId: "profile",
  revision: "revision", model: null, thinkingMode: "medium", openCodeVariant: null };
const identity = { version: 1, role: "leader", cli: "codex", workspace: "workspace", rootTaskId: "root", leaderTaskId: "leader",
  moduleId: "module", generation: 1, ownerId: "owner", executionId: "execution", session: { state: "unbound" },
  ...fingerprintDepartmentExecutionSelection(selection) };
const envelope = (invocation: unknown) => ({ version: 1, token: "a".repeat(64), identity, sequence: 1, operation: "invoke", invocation });

test("department Codex and OpenCode invocations inherit Loop+ prompt size without another budget", () => {
  for (const size of [48 * 1024, 64 * 1024, 4 * 1024 * 1024 + 1]) {
    const invocation = { invocationId: "main-1", prompt: '中文🌛\n"\\'.repeat(Math.ceil(size / 5)) };
    assert.ok(Buffer.byteLength(invocation.prompt, "utf8") > size);
    assert.equal(isLeaderInvocation(invocation), true);
    assert.equal(isDepartmentLeaderProcessInvocation(invocation), true);
    assert.equal(isDepartmentLeaderPrivateCommand(envelope(invocation)), true);
  }
});

test("department prompt data cannot exempt malformed invocations or control frames", () => {
  const invocation = { invocationId: "main-1", prompt: "x".repeat(80 * 1024) };
  for (const bad of [null, {}, { ...invocation, prompt: " \n" }, { ...invocation, prompt: 1 },
    { ...invocation, invocationId: "" }, { ...invocation, extra: true }]) {
    assert.equal(isLeaderInvocation(bad), false);
    assert.equal(isDepartmentLeaderProcessInvocation(bad), false);
    assert.equal(isDepartmentLeaderPrivateCommand(envelope(bad)), false);
  }
  for (const bad of [{ ...envelope(invocation), extra: true }, { ...envelope(invocation), token: "wrong" },
    { ...envelope(invocation), sequence: 0 }, { ...envelope(invocation), identity: {} },
    { ...envelope(invocation), operation: "grant" }, { ...envelope(invocation), operation: "ack" }]) {
    assert.equal(isDepartmentLeaderPrivateCommand(bad), false);
  }
  assert.equal(isDepartmentLeaderPrivateCommand({ operation: "seal" }), true);
  assert.equal(isDepartmentLeaderPrivateCommand({ operation: "ack", result: "x".repeat(80 * 1024) }), false);
});

test("employee preparation budgets configuration without limiting the complete native prompt", () => {
  const prompt = "完整员工提示词".repeat(300000);
  assert.ok(Buffer.byteLength(prompt, "utf8") > 4 * 1024 * 1024);
  const employee = { ...selection, role: "employee" as const };
  const codex = { version: 1, token: "a".repeat(64), ownerDirectory: os.tmpdir(), configurationDirectory: os.tmpdir(), workspaceDirectory: os.tmpdir(),
    identity: { ...identity, role: "employee", subtaskId: "subtask", attemptId: "attempt", ...fingerprintDepartmentExecutionSelection(employee) }, selection: employee,
    runner: { command: "codex", args: [], env: {}, thinkingMode: "medium", interactiveMode: "coding", model: null, threadId: null,
      configFingerprint: fingerprintDepartmentExecutionSelection(employee).configFingerprint },
    macTaskShell: "bash", prompt, requestUserInputEnabled: false };
  assert.equal(isDepartmentCodexPreparation(codex), true);
  assert.equal(isDepartmentCodexPreparation({ ...codex, runner: { ...codex.runner, env: { PADDING: prompt } } }), false);
  const processSelection = { ...employee, cli: "opencode" as const };
  const processPreparation = { version: 1, token: codex.token, ownerDirectory: os.tmpdir(), configurationDirectory: os.tmpdir(), workspaceDirectory: os.tmpdir(),
    identity: { ...identity, role: "employee", subtaskId: "subtask", attemptId: "attempt", cli: "opencode", ...fingerprintDepartmentExecutionSelection(processSelection) }, selection: processSelection,
    launch: { command: "opencode", args: ["run", "--format", "json", prompt] }, overlay: null };
  assert.equal(isDepartmentProcessPreparation(processPreparation), true);
  assert.equal(isDepartmentProcessPreparation({ ...processPreparation, launch: { ...processPreparation.launch, baseEnvironment: { PADDING: prompt } } }), false);
});
