"use strict";

const assert = require("node:assert/strict");
const cp = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { createOpenCodeLocalProvider } = require("./fixtures/opencode_local_provider_server");
const { createLocalResponsesServer } = require("./fixtures/codex_local_responses_server");
const { createDepartmentFullEhScenario, assertLongToolForwarding, LONG_TOOL_COMMAND_SHA256,
  LONG_TOOL_PAYLOAD_BYTES, LONG_TOOL_OUTPUT_SHA256 } = require("./fixtures/department_full_eh_scenario");
const { createDepartmentContinuationEhScenario } = require("./fixtures/department_continuation_eh_scenario");
const { createDepartmentSuccessiveContinuationEhScenario, isStoppedTaskRecord } = require("./fixtures/department_successive_continuation_eh_scenario");
const { driveSuccessiveContinuation } = require("./fixtures/department_successive_continuation_ui");
const { startColdWorkerExitObserver, requireColdWorkerExits } = require("./fixtures/department_worker_exit_observer");
const { createDepartmentColdStartEhScenario } = require("./fixtures/department_cold_start_eh_scenario");

const { createDepartmentColdRecoveryEhScenario, clickColdPublicControl, assertColdSuccessorNotRejected } = require("./fixtures/department_cold_recovery_eh_scenario");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const timeoutMs = Number(process.env.SINITEK_DEPARTMENT_FULL_EH_TIMEOUT_MS || 180000);

function args(argv) {
  const result = {};
  const flags = { "--product": "product", "--report": "report", "--scenario": "scenario", "--leader-cli": "leaderCli", "--leader-model": "leaderModel", "--director-cli": "directorCli", "--employee-cli": "employeeCli" };
  for (let i = 0; i < argv.length; i += 1) {
    const field = flags[argv[i]];
    if (!field) throw new Error(`Unknown argument: ${argv[i]}`);
    if (Object.hasOwn(result, field)) throw new Error(`Duplicate argument: ${argv[i]}`);
    const value = argv[++i];
    if (!value || value.startsWith("--")) throw new Error(`Missing value: ${argv[i - 1]}`);
    result[field] = value;
  }
  if (!result.product || !result.report) throw new Error("Usage: node scripts/verify_department_full_eh_integration.js --product <isolated-built-extension> --report <new-json-path>");
  result.scenario ??= "loop-plus";
  if (result.scenario && !["loop-plus", "stop-continue", "successive-stop-continue", "cold-start", "cold-recovery", "codex-long-tool-output"].includes(result.scenario)) throw new Error("Unknown scenario");
  for (const field of ["directorCli", "leaderCli", "employeeCli"]) {
    result[field] ??= "codex";
    if (!["codex", "opencode"].includes(result[field])) throw new Error(`Unknown role CLI: ${field}`);
  }
  result.leaderModel ??= result.leaderCli === "opencode" ? "explicit" : "default";
  if (!["default", "explicit"].includes(result.leaderModel)
    || result.leaderCli !== "opencode" && result.leaderModel !== "default") throw new Error("Unsupported leader model selection");
  if (result.scenario === "stop-continue" && [result.directorCli, result.leaderCli, result.employeeCli].includes("opencode")
    && (![result.directorCli, result.leaderCli, result.employeeCli].every(cli => cli === "opencode") || result.leaderModel !== "default"))
    throw new Error("OpenCode continuation requires all three roles and default models");
  if (result.scenario === "successive-stop-continue"
    && (![result.directorCli, result.leaderCli, result.employeeCli].every(cli => cli === "opencode") || result.leaderModel !== "default"))
    throw new Error("Successive continuation requires all three OpenCode roles and default models");
  if (result.scenario === "cold-start" && [result.directorCli, result.leaderCli, result.employeeCli].some(cli => cli !== "codex"))
    throw new Error("Cold-start verification currently supports only Codex director/leader/employee");
  if (result.scenario === "cold-recovery" && (result.directorCli !== "codex" || result.employeeCli !== "codex"))
    throw new Error("Cold recovery supports Codex director/employee with Codex or OpenCode leader");
  if (result.scenario === "codex-long-tool-output" && [result.directorCli, result.leaderCli, result.employeeCli].some(cli => cli !== "codex"))
    throw new Error("Codex long-tool-output verification requires Codex director/leader/employee");
  return result;
}

function roleSelection(role, cli = "codex", model = role === "leader" && cli === "opencode" ? "explicit" : "default") {
  if (!["director", "leader", "employee"].includes(role) || !["codex", "opencode"].includes(cli)) throw new Error("Unknown role selection");
  if (!["default", "explicit"].includes(model) || (role !== "leader" || cli !== "opencode") && model !== "default") throw new Error("Unsupported role model selection");
  return { cli, profile: `${cli}-local`, model: model === "explicit" || role === "director" && cli === "opencode" ? "isolated/native-drain" : "__default__" };
}

function isolatedEnvironment(root, inherited = process.env) {
  const env = Object.fromEntries(["PATH", "PATHEXT", "SystemRoot", "WINDIR", "ComSpec", "SYSTEMDRIVE", "DISPLAY", "WAYLAND_DISPLAY", "LANG"]
    .filter((key) => inherited[key]).map((key) => [key, inherited[key]]));
  Object.assign(env, { HOME: path.join(root, "home"), USERPROFILE: path.join(root, "home"), CODEX_HOME: path.join(root, "home/.codex"),
    XDG_CONFIG_HOME: path.join(root, "config"), XDG_DATA_HOME: path.join(root, "data"), XDG_CACHE_HOME: path.join(root, "cache"), XDG_STATE_HOME: path.join(root, "state"),
    APPDATA: path.join(root, "config"), LOCALAPPDATA: path.join(root, "data"), TMPDIR: path.join(root, "tmp"), TMP: path.join(root, "tmp"), TEMP: path.join(root, "tmp"),
    OPENCODE_CONFIG_DIR: path.join(root, "opencode-config"), OPENCODE_TEST_HOME: path.join(root, "home"),
    OPENCODE_DISABLE_MODELS_FETCH: "1", OPENCODE_DISABLE_AUTOUPDATE: "1", OPENCODE_DISABLE_PROJECT_CONFIG: "1", OPENCODE_DISABLE_DEFAULT_PLUGINS: "1",
    OPENCODE_DISABLE_EXTERNAL_SKILLS: "1", OPENCODE_DISABLE_LSP_DOWNLOAD: "1", OPENCODE_DISABLE_CLAUDE_CODE: "1", OPENCODE_DISABLE_AUTOCOMPACT: "1", OPENCODE_PURE: "1",
    OPENAI_API_KEY: "local-only-no-network", HTTP_PROXY: "http://127.0.0.1:9", HTTPS_PROXY: "http://127.0.0.1:9", ALL_PROXY: "http://127.0.0.1:9",
    http_proxy: "http://127.0.0.1:9", https_proxy: "http://127.0.0.1:9", all_proxy: "http://127.0.0.1:9", NO_PROXY: "127.0.0.1,localhost,::1", no_proxy: "127.0.0.1,localhost,::1" });
  return env;
}

function assertMixedEvidence({ cleanup, tasks, snapshot, protocol, roles = { leader: "opencode", employee: "codex" } }) {
  assert.equal(cleanup.complete, true, "mixed cleanup is incomplete");
  const saved = cleanup.saved, bindings = saved.executionBindings, sets = saved.leaderExecutionSets;
  const resumes = continuationRounds(snapshot).length, count = 4 + 2 * resumes;
  assert.equal(bindings.length, count, "scenario original Owner set is incomplete");
  assert.equal(new Set(bindings.map(({ identity }) => identity.ownerId)).size, count, "duplicate original Owner");
  assert.equal(sets.length, 2 + resumes, "scenario requires exact complete CLOSED sets");
  const entries = sets.flatMap((set) => {
    assert.ok(set.state === "closed" && set.closure && set.entries.length === 2, "mixed set is incomplete");
    assert.deepEqual(set.closure.scope, set.scope);
    assert.equal(set.closure.producerId, set.producerId);
    return set.entries;
  });
  assert.equal(new Set(entries.map((entry) => entry.executionId)).size, count, "duplicate or missing responsibility");
  const handshakes = [];
  for (const binding of bindings) {
    const id = binding.identity, cli = roles[id.role];
    assert.ok(["leader", "employee"].includes(id.role) && ["codex", "opencode"].includes(cli), "unknown binding role/CLI");
    assert.equal(id.cli, cli, "unexpected mixed CLI identity");
    assert.equal(id.rootTaskId, snapshot.rootId);
    assert.ok(snapshot.leaders.includes(id.leaderTaskId));
    const set = sets.find((value) => value.scope.leaderTaskId === id.leaderTaskId && value.scope.generation === id.generation);
    assert.ok(set && set.scope.rootTaskId === id.rootTaskId && set.scope.moduleId === id.moduleId && set.scope.workspace === id.workspace, "CLOSED scope identity mismatch");
    const entry = entries.find((value) => value.executionId === id.executionId);
    assert.ok(entry, "binding is not represented by CLOSED set");
    assert.deepEqual(entry.responsibility.selection, binding.selection);
    assert.deepEqual(entry.responsibility.requirements, binding.requirements);
    assert.equal(binding.selection.cli, cli); assert.equal(binding.selection.configId, `${cli}-local`);
    const leader = tasks.find((value) => value.id === id.leaderTaskId);
    const record = id.role === "leader" ? leader : leader.subTasks.find((value) => value.id === id.subtaskId);
    assert.equal(record.executionSession.cli, cli); assert.equal(record.executionSession.sessionId, id.session.id);
    assert.equal(id.session.state, "bound");
    const events = protocol.filter((event) => event.identity?.ownerId === id.ownerId);
    assert.ok(events.length, "missing original private protocol");
    for (const event of events) {
      for (const key of ["rootTaskId", "leaderTaskId", "generation", "executionId", "cli"]) assert.equal(event.identity[key], id[key], "private identity conflict");
      if (event.identity.session.state === "bound") assert.equal(event.identity.session.id, id.session.id);
    }
    const pid = events[0].pid;
    assert.ok(events.every((event) => event.pid === pid), "Owner changed worker");
    const received = events.filter((event) => event.event === "received");
    const required = cli === "opencode" ? id.role === "leader" ? ["ready", "grant-request", "settled", "drained", "stopped"]
      : ["native-session", "prepared", "committed", "launch-request", "terminal", "release-tab", "stopped"]
      : ["prepared", "session", "owner-bound", "granted", "terminal", "resources-released"];
    for (const type of required) assert.ok(received.some((event) => event.type === type), `missing ${cli} ${type} handshake`);
    if (cli === "opencode") {
      if (id.role === "leader") {
        assert.equal(received.filter((event) => event.type === "settled").length, expectedNativeTurns(id, snapshot), "OpenCode leader did not perform expected generation turns");
        for (const grant of received.filter((event) => event.type === "grant-request")) {
          assert.ok(events.some((event) => event.event === "sent" && event.operation === "ack" && event.requestSequence === grant.requestSequence && event.ok === true), "missing successful original grant ACK");
          const settled = received.find((event) => event.type === "settled" && event.invocationId === grant.invocationId);
          for (const part of ["processTerminal", "streams"]) assert.equal(settled?.terminal?.[part]?.status, "confirmed");
        }
      }
      for (const operation of id.role === "leader" ? ["seal", "shutdown"] : ["finalize", "commit", "launch", "shutdown"]) assert.equal(events.filter((event) => event.event === "sent" && event.operation === operation).length, 1, `missing or repeated ${operation}`);
      assert.equal(received.filter((event) => event.type === "stopped").length, 1);
      assert.ok(protocol.some((event) => event.pid === pid && event.event === "owner-close" && event.code === 0 && !event.signal), "OpenCode Owner did not close naturally");
    }
    handshakes.push({ identity: id, pid, required, receivedTypes: received.map((event) => event.type) });
  }
  assert.equal(tasks.find((value) => value.id === snapshot.rootId).status, "completed");
  assert.ok(snapshot.capacityReuse?.complete, "missing pre-dispatch returned capacity");
  return handshakes;
}

// Completed stop snapshots are cumulative; a later snapshot must not make the
// same original execution count twice or substitute for another stop's source.
function continuationRounds(snapshot) {
  return snapshot?.continuation?.rounds ?? (snapshot?.continuation ? [snapshot.continuation] : []);
}
function wasStoppedExecution(id, snapshot) {
  return continuationRounds(snapshot).some(round => round.stopped?.saved.executionBindings
    .some(b => b.identity.executionId === id.executionId));
}
// Read-only native facts; never an execution/cleanup authority or a cold receipt.
function expectedNativeTurns(id, snapshot) {
  return wasStoppedExecution(id, snapshot) ? 1 : id.role === "leader" ? 3 : 1;
}
function readOpenCodeNativeFacts(root, bindings, protocol) {
  const { DatabaseSync } = require("node:sqlite");
  const database = new DatabaseSync(path.join(root, "data/opencode/opencode.db"), { readOnly: true });
  try {
    return bindings.filter(binding => binding.identity.cli === "opencode").map(({ identity }) => {
      const session = database.prepare("SELECT id, directory, time_created FROM session WHERE id = ?").get(identity.session.id);
      const turns = database.prepare("SELECT data, time_created FROM message WHERE session_id = ? ORDER BY time_created, id").all(identity.session.id)
        .map(row => ({ ...JSON.parse(row.data), createdAt: row.time_created })).filter(row => row.role === "assistant")
        .map(row => ({ cwd: row.path?.cwd, finish: row.finish, error: row.error?.name, model: `${row.providerID}/${row.modelID}`, createdAt: row.createdAt, completedAt: row.time?.completed }));
      const events = protocol?.filter(event => event.identity?.ownerId === identity.ownerId);
      const canonicalDirectory = events ? identity.role === "employee"
        ? events.find(event => event.event === "received" && event.type === "prepared")?.directory
        : events.find(event => event.event === "sent" && event.launchEvidence)?.launchEvidence.cwd : session?.directory;
      return { executionId: identity.executionId, session, canonicalDirectory,
        turns: turns.filter(turn => turn.cwd === canonicalDirectory), directoryRemoved: canonicalDirectory ? !fs.existsSync(canonicalDirectory) : false };
    });
  } finally { database.close(); }
}
function assertOpenCodeLaunchEvidence({ bindings, protocol, originals, nativeFacts, isolatedRoot, snapshot }) {
  const result = [];
  for (const binding of bindings) {
    const id = binding.identity;
    const original = originals.filter(value => value.identity.executionId === id.executionId);
    assert.equal(original.length, 1, "missing unique original-client receipt");
    assert.equal(original[0].source, "original-client-waitForCleanup-return");
    assert.deepEqual(original[0].identity, id); assert.deepEqual(original[0].receipt.identity, id);
    assert.deepEqual(original[0].requirements, binding.requirements);
    assert.deepEqual(original[0].receipt.requirements, binding.requirements);
    for (const [part, required] of Object.entries(binding.requirements)) {
      assert.equal(original[0].receipt.cleanup[part].status, required ? "confirmed" : "not-applicable", "original receipt policy mismatch");
    }
    if (id.cli !== "opencode") continue;
    assert.equal(binding.requirements.turnTerminal, false);
    // This scenario always creates a native overlay, so temp is applicable.
    for (const part of ["processTerminal", "streams", "runner", "executionRoot", "links", "temp", "tab"]) assert.equal(binding.requirements[part], true);
    const events = protocol.filter(event => event.identity?.ownerId === id.ownerId);
    const preparation = events.find(event => event.event === "sent" && event.selection);
    assert.deepEqual(preparation?.selection, binding.selection, "native preparation selection differs from persisted binding");
    assert.equal(preparation.launchEvidence?.overlayModel, binding.selection.model, "native overlay model mismatch");
    const launch = id.role === "leader" ? preparation : events.find(event => event.event === "sent" && event.operation === "finalize");
    if (id.role === "employee") {
      assert.deepEqual(launch?.launchEvidence?.sessionArgs, [id.session.id]);
      assert.deepEqual(launch.launchEvidence.modelArgs, [binding.selection.model]);
    } else assert.equal(launch.launchEvidence.sessionId, id.session.id);
    const grants = id.role === "leader" ? events.filter(event => event.event === "received" && event.type === "grant-request") : events.filter(event => event.event === "received" && event.type === "launch-request");
    assert.equal(grants.length, expectedNativeTurns(id, snapshot), "duplicate or missing native task grant");
    for (const grant of grants) {
      const sent = events.find(event => event.event === "sent" && (id.role === "employee" ? event.operation === "launch" : event.operation === "ack" && event.ok === true && event.requestSequence === grant.requestSequence));
      assert.ok(sent?.preGrantReadback?.runtimeOk, "missing pre-grant durable readback");
      assert.equal(sent.preGrantReadback.taskId, id.leaderTaskId);
      assert.deepEqual(sent.preGrantReadback.bindings, [binding], "grant preceded durable original binding");
      assert.equal(sent.preGrantReadback.session.cli, id.cli); assert.equal(sent.preGrantReadback.session.sessionId, id.session.id);
      assert.ok(sent.preGrantReadback.capacity.leaders.includes(id.moduleId));
      if (id.role === "employee") assert.ok(sent.preGrantReadback.capacity.employees.includes(JSON.stringify([id.leaderTaskId, id.attemptId])));
    }
    const native = nativeFacts.filter(value => value.executionId === id.executionId);
    assert.equal(native.length, 1); const facts = native[0];
    assert.equal(facts.session?.id, id.session.id);
    const directory = facts.canonicalDirectory ?? facts.session.directory;
    assert.ok(path.isAbsolute(directory) && directory.startsWith(isolatedRoot + path.sep), "native session escaped its canonical isolated directory");
    const latest = bindings.filter(b => b.identity.cli === "opencode" && b.identity.session.id === id.session.id).at(-1);
    const latestFacts = nativeFacts.find(f => f.executionId === latest.identity.executionId);
    assert.equal(facts.session.directory, latestFacts.canonicalDirectory ?? latestFacts.session.directory, "native session cold read does not match its latest generation");
    const retired = preparation.retired;
    if (retired) {
      const old = bindings.find(b => b.identity.executionId === retired.identity.executionId);
      assert.ok(old, "move has no exact original binding"); assert.deepEqual(retired.identity, old.identity); assert.deepEqual(retired.selection, old.selection);
      assert.equal(retired.directory, nativeFacts.find(f => f.executionId === old.identity.executionId).canonicalDirectory);
      assert.equal(retired.identity.session.id, id.session.id); assert.notEqual(retired.directory, directory);
      assert.ok(originals.some(o => o.identity.executionId === old.identity.executionId), "move source lacks original receipt");
    }
    assert.equal(facts.directoryRemoved, true, "native execution root remains");
    assert.equal(facts.turns.length, expectedNativeTurns(id, snapshot), "unexpected native session task turns");
    for (const turn of facts.turns) {
      assert.equal(turn.cwd, directory, "native preparation/task canonical directory conflict");
      assert.equal(turn.model, binding.selection.model);
      const interrupted = wasStoppedExecution(id, snapshot) && id.role === "employee";
      if (interrupted) {
        assert.ok(turn.finish === undefined || turn.finish === "stop");
        assert.ok(turn.error === undefined || turn.error === "MessageAbortedError", "unexpected stopped native error");
      } else { assert.equal(turn.finish, "stop"); assert.equal(turn.error, undefined); assert.ok(Number.isSafeInteger(turn.completedAt)); }
    }
    assert.ok(facts.session.time_created <= grants[0].at, "native preparation did not precede task grant");
    result.push({ identity: id, receiptId: original[0].receipt.receiptId, canonicalDirectory: directory, turns: facts.turns.length, preGrantDurableReadbacks: grants.length });
  }
  return result;
}

function assertSuccessiveEvidence({ cleanup, tasks, snapshot, protocol, evidence }) {
  const rounds = continuationRounds(snapshot);
  assert.equal(rounds.length, 2, "missing one of the two continuation rounds");
  assert.equal(snapshot.continuation.continueCount, 2);
  assert.ok(snapshot.continuation.acceptedFinalEvent && snapshot.continuation.leaderReport,
    "C must be accepted and reported before final success");
  assert.equal(evidence?.result, "two-stops-and-continues-observed");
  assert.equal(evidence.rounds.length, 2);
  assert.equal(cleanup.complete, true);
  assert.equal(cleanup.saved.executionBindings.length, 8);
  assert.equal(cleanup.saved.leaderExecutionSets.length, 4);
  assert.equal(snapshot.employees.length, 4);
  const finalByExecution = new Map(cleanup.saved.executionBindings.map(b => [b.identity.executionId, b]));
  const firstLeader = rounds[0].held.leaderTaskId;
  assert.equal(rounds[1].held.leaderTaskId, firstLeader);
  const leaderTask = tasks.find(task => task.id === firstLeader);
  const links = [];
  for (const [index, round] of rounds.entries()) {
    const observed = evidence.rounds[index], held = round.held;
    assert.equal(observed.round, index + 1);
    assert.deepEqual(observed.held, held);
    assert.equal(observed.afterStopCleanup.complete, true);
    assert.deepEqual(observed.afterStopCleanup.saved, round.stopped.saved, "round cleanup is not the exact stopped snapshot");
    assert.deepEqual(round.pendingEvent, observed.pendingEvent);
    assert.deepEqual(round.stoppedReview, observed.stoppedReview);
    assert.equal(round.stoppedReview.acceptance, "failed");
    assert.equal(round.stoppedReview.subtaskId, held.subtaskId);
    assert.equal(round.stoppedReview.attemptId, held.attemptId);
    assert.equal(observed.noAutomaticRevival.stable, true);
    const saved = round.stopped.saved;
    assert.equal(saved.executionBindings.length, 2 * (index + 1));
    assert.equal(saved.leaderExecutionSets.length, index + 1);
    assert.ok(saved.leaderExecutionSets.every(set => set.state === "closed" && set.closure && set.entries.length === 2));
    assert.deepEqual(saved.capacity.leaders, [], "stop did not persistently return leader capacity");
    assert.deepEqual(saved.capacity.employees, [], "stop did not persistently return employee capacity");
    for (const historical of saved.executionBindings) {
      assert.deepEqual(finalByExecution.get(historical.identity.executionId), historical, "historical original binding changed");
      const original = observed.afterStopCleanup.observations.filter(o => o.identity?.executionId === historical.identity.executionId);
      assert.equal(original.length, 1);
      assert.equal(original[0].status, "cleaned", "stop has no original complete receipt");
    }
    const sourceEmployee = observed.beforeStop.employeeBinding;
    assert.deepEqual([sourceEmployee.identity.subtaskId, sourceEmployee.identity.attemptId], [held.subtaskId, held.attemptId]);
    assert.equal(saved.runtime.leaders.find(member => member.taskId === held.leaderTaskId)?.generation, sourceEmployee.identity.generation + 1,
      "stop revocation generation was not persisted before continue");
    const sourceLeader = saved.executionBindings.find(b => b.identity.role === "leader"
      && b.identity.generation === sourceEmployee.identity.generation);
    const successor = observed.successorBinding;
    const newLeader = observed.afterContinue.executionBindings.filter(b => b.identity.role === "leader"
      && b.identity.generation > sourceLeader.identity.generation);
    assert.equal(newLeader.length, 1, "round did not produce one exact new leader Owner");
    for (const [source, target] of [[sourceLeader, newLeader[0]], [sourceEmployee, successor]]) {
      assert.deepEqual(finalByExecution.get(target.identity.executionId), target);
      for (const key of ["workspace", "rootTaskId", "moduleId", "leaderTaskId", "role", "cli"])
        assert.equal(target.identity[key], source.identity[key]);
      assert.deepEqual(target.selection, source.selection);
      assert.deepEqual(target.requirements, source.requirements);
      assert.deepEqual(target.identity.session, source.identity.session);
      assert.notEqual(target.identity.ownerId, source.identity.ownerId);
      assert.notEqual(target.identity.executionId, source.identity.executionId);
      assert.ok(target.identity.generation > source.identity.generation);
      const events = protocol.filter(event => event.identity?.executionId === target.identity.executionId);
      const prepared = events.find(event => event.event === "sent" && event.selection);
      if (target.identity.role === "employee") {
        assert.deepEqual(prepared?.retired?.identity, source.identity, "native move skipped its exact direct source");
        assert.deepEqual(prepared.retired.selection, source.selection);
      } else {
        // Leader preparation moves the private retired session before fork;
        // its launch IPC carries the bound session/canonical cwd, not retired.
        const previous = protocol.find(event => event.identity?.executionId === source.identity.executionId
          && event.event === "sent" && event.selection);
        assert.equal(prepared?.launchEvidence?.sessionId, source.identity.session.id);
        assert.equal(previous?.launchEvidence?.sessionId, source.identity.session.id);
        assert.ok(path.isAbsolute(previous.launchEvidence.cwd) && path.isAbsolute(prepared.launchEvidence.cwd));
        assert.notEqual(prepared.launchEvidence.cwd, previous.launchEvidence.cwd, "leader reused its retired execution root");
      }
      const grant = events.find(event => event.event === "received" && ["grant-request", "launch-request"].includes(event.type));
      assert.ok(Number.isSafeInteger(observed.cleanupObservedAt) && grant?.at >= observed.cleanupObservedAt,
        "next native grant preceded observed persistent cleanup/capacity return");
      for (const event of events.filter(event => event.preGrantReadback)) {
        assert.ok(!event.preGrantReadback.capacity.employees.includes(JSON.stringify([held.leaderTaskId, held.attemptId])),
          "source employee capacity is still reserved at successor grant");
      }
      links.push({ round: index + 1, source: source.identity, successor: target.identity });
    }
    const sourceTask = leaderTask.subTasks.find(task => task.id === held.subtaskId);
    assert.ok(isStoppedTaskRecord(sourceTask), "stop history was overwritten");
    const seen = leaderTask.loopPlus.seenAttempts.filter(attempt => attempt.subtaskId === held.subtaskId && attempt.attemptId === held.attemptId);
    assert.equal(seen.length, 1); assert.equal(seen[0].acceptance, "failed"); assert.equal(seen[0].disposition, "reviewed");
    const targetTask = leaderTask.subTasks.find(task => task.id === successor.identity.subtaskId);
    assert.equal(targetTask.continueFromSubtaskId, held.subtaskId);
    assert.deepEqual(targetTask.executionSession, { cli: successor.identity.cli, configId: successor.selection.configId, sessionId: successor.identity.session.id });
    if (index === 0) assert.deepEqual(successor, evidence.rounds[1].beforeStop.employeeBinding, "B was not the source of the second stop");
    else assert.equal(targetTask.status, "completed", "C was not completed");
  }
  return { owners: 8, closedSets: 4, employees: 4, links };
}

async function drivePublicSuccessiveContinuation({ port, product, report, scenario, readTasks, inspectCleanup, readRuntime, healthy,
  budgetMs = timeoutMs, chromium, drive = driveSuccessiveContinuation, webviewFactory = createDepartmentWebviewAdapter }) {
  chromium ??= require(process.env.PLAYWRIGHT_MODULE || "/tmp/zq-playwright-smoke/node_modules/playwright").chromium;
  const cleanupDeadline = Date.now() + budgetMs;
  // Reserve cleanup time inside the original budget, never extend it on failure.
  const deadline = cleanupDeadline - Math.min(1000, Math.max(1, Math.floor(budgetMs / 10)));
  const diagnostics = report.successiveCdpCleanup = [];
  const closeBrowser = browser => cleanupCdpResource(() => browser.close(), cleanupDeadline, "successive browser disconnect", diagnostics);
  let browser, failure, result;
  report.activePhase = "successivePublicContinuation";
  try {
    browser = await withinColdDeadline(() => chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: coldRemaining(deadline) }),
      deadline, "successive browser connection", closeBrowser);
    const { isDepartmentExecutionBinding } = require(path.join(product, "dist/extensionHost/departmentruntimestate.js"));
    result = await drive({ browser, scenario, readTasks, readRuntime, inspectCleanup, healthy, report,
      timeoutMs: coldRemaining(deadline), actionDeadline: deadline, cleanupDeadline, isExecutionBinding: isDepartmentExecutionBinding,
      createWebviewAdapter: (connected, purpose, remaining, adapterOptions = {}) => webviewFactory(connected, purpose, remaining,
        { ...adapterOptions, deadline, cleanupDeadline, diagnostics }) });
  } catch (error) { failure = error; }
  finally {
    scenario.releaseAll();
    if (browser) await closeBrowser(browser);
  }
  if (failure) { failure.cleanupDiagnostics = diagnostics; throw failure; }
  assertCdpCleanup(diagnostics, "successive");
  return result;
}

function vscodeExecutable() {
  if (process.env.SINITEK_VSCODE_EXE) return process.env.SINITEK_VSCODE_EXE;
  if (process.platform === "darwin") return "/Applications/Visual Studio Code.app/Contents/MacOS/Code";
  if (process.platform === "win32") return path.join(process.env.LOCALAPPDATA || "", "Programs/Microsoft VS Code/Code.exe");
  return "/usr/share/code/code";
}

function codexExecutable() {
  if (process.env.SINITEK_CODEX_EXE) return process.env.SINITEK_CODEX_EXE;
  const lookup = process.platform === "win32" ? cp.spawnSync("where.exe", ["codex"], { encoding: "utf8" })
    : cp.spawnSync("which", ["codex"], { encoding: "utf8" });
  if (lookup.status !== 0 || !lookup.stdout.trim()) throw new Error("Codex CLI binary was not found; set SINITEK_CODEX_EXE");
  return lookup.stdout.trim().split(/\r?\n/)[0];
}

async function freePort() {
  const server = http.createServer();
  await new Promise((resolve, reject) => server.once("error", reject).listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

function writeExtensionHostEntry(product, root, options = {}) {
  const fixturePath = path.join(product, "dist/test/extensionHost/fixtures/departmentfullehproductionhost.js");
  assert.ok(fs.existsSync(fixturePath), `Isolated production fixture is missing: ${fixturePath}`);
  const { createDepartmentFullEhHostTestEntry } = require(fixturePath);
  const file = path.join(root, "extension-host-test.js");
  const entry = options.coldRecovery
    ? require(path.join(product, "dist/test/extensionHost/fixtures/departmentcoldrecoveryehhost.js")).createDepartmentColdRecoveryFirstEntry({ root, timeoutMs })
    : createDepartmentFullEhHostTestEntry({ root, timeoutMs, coldStart: options.coldStart === true,
      ...(options.longToolOutput ? { longToolOutput: { commandSha256: LONG_TOOL_COMMAND_SHA256,
        payloadBytes: LONG_TOOL_PAYLOAD_BYTES, payloadSha256: LONG_TOOL_OUTPUT_SHA256 } } : {}) });
  fs.writeFileSync(file, entry, { flag: "wx" });
  return file;
}

function writeColdSecondHostEntry(product, root, home, rootTaskId, deadlines, loopPlusAttempt) {
  const fixturePath = path.join(product, "dist/test/extensionHost/fixtures/departmentcoldstartproductionhost.js");
  assert.ok(fs.existsSync(fixturePath), `Isolated cold-start fixture is missing: ${fixturePath}`);
  const { createDepartmentColdStartHostTestEntry } = require(fixturePath);
  const file = path.join(root, "cold-second-host-test.js");
  fs.writeFileSync(file, createDepartmentColdStartHostTestEntry({ root, home, product, timeoutMs, rootTaskId, deadlines, loopPlusAttempt }), { flag: "wx" });
  return file;
}

function assertColdStartActivationSucceeded(secondHost) {
  assert.equal(secondHost.activationError, null, `second EH activation failed before cold recovery check: ${secondHost.activationError || "unknown activation failure"}`);
}

function classifyColdStartRecovery(secondHost) {
  assertColdStartActivationSucceeded(secondHost);
  const result = secondHost.productionRecovery;
  assert.ok(result && result.trigger === "public-department-stop" && result.observed === true,
    "cold recovery check was not invoked through the production organization-control path");
  if (result.outcome === "blocked" && result.reason === "live-leader-unverifiable") return "production-recovery-blocked-live-leader-unverifiable";
  throw new Error(`cold production recovery did not return the expected fail-closed boundary: ${JSON.stringify(result)}`);
}

function assertColdRestartIdentity(firstHost, secondHost, sameExecution = (a, b) => JSON.stringify(a) === JSON.stringify(b)) {
  const original = firstHost.binding, identity = original?.identity;
  assert.ok(identity && original.selection && original.requirements, "first EH omitted the complete original binding contract");
  const baseline = firstHost.beforeRestart;
  assert.ok(baseline?.rootTask && baseline.leader && baseline.runtime, "first EH omitted its pre-exit authoritative snapshot");
  const inScope = i => i && ["rootTaskId", "workspace", "moduleId", "leaderTaskId", "generation"].every(key => i[key] === identity[key]);
  const bindings = saved => {
    assert.ok(Array.isArray(saved?.executionBindings), "snapshot omitted execution bindings");
    return saved.executionBindings.filter(b => inScope(b.identity)).sort((a, b) => a.identity.executionId.localeCompare(b.identity.executionId));
  };
  const sets = saved => {
    assert.ok(Array.isArray(saved?.leaderExecutionSets), "snapshot omitted leader responsibility sets");
    return saved.leaderExecutionSets.filter(set => inScope(set.scope));
  };
  const originals = bindings(baseline.runtime), originalSets = sets(baseline.runtime);
  assert.equal(originalSets.length, 1, "first EH must retain the exact current leader responsibility set");
  assert.equal(originals.filter(b => b.identity.role === "leader").length, 1, "first EH omitted its original leader binding");
  assert.deepEqual(originals.find(b => b.identity.executionId === identity.executionId), original);
  assert.deepEqual(baseline.binding, original);
  for (const binding of originals) assert.ok(originalSets[0].entries.some(entry => entry.executionId === binding.identity.executionId),
    "original binding is absent from the complete responsibility set");
  const employeeIds = new Set(originalSets[0].entries.filter(e => e.responsibility.target.role === "employee").map(e => e.responsibility.target.subtaskId));
  const taskProjection = (tasks) => {
    assert.ok(Array.isArray(tasks), "snapshot omitted authoritative tasks");
    const root = tasks.find(t => t.id === identity.rootTaskId), leader = tasks.find(t => t.id === identity.leaderTaskId);
    assert.ok(root && leader, "snapshot omitted target root or leader");
    assert.deepEqual(root.department?.routes, leader.department?.routes, "root and leader frozen role routes differ");
    const taskFields = t => ({ id: t.id, workspaceKey: t.workspaceKey, status: t.status, sessionId: t.sessionId,
      executionSession: t.executionSession, department: t.department });
    return { root: taskFields(root), module: root.subTasks?.filter(t => t.id === identity.moduleId), leader: taskFields(leader),
      employees: leader.subTasks?.filter(t => employeeIds.has(t.id)).map(t => ({ id: t.id, status: t.status, executionSession: t.executionSession })),
      running: leader.loopPlus?.running?.filter(attempt => employeeIds.has(attempt.subtaskId)) };
  };
  const capacityProjection = c => {
    assert.ok(c && Array.isArray(c.leaders) && Array.isArray(c.employees), "snapshot omitted capacity");
    const targetEmployee = key => JSON.parse(key)[0] === identity.leaderTaskId;
    return { rootTaskId: c.rootTaskId, maxLeaders: c.maxLeaders, maxEmployees: c.maxEmployees,
      leaders: c.leaders.filter(id => id === identity.moduleId), employees: c.employees.filter(targetEmployee).sort(),
      employeeOverflow: (c.employeeOverflow || []).filter(targetEmployee).sort() };
  };
  const runtimeProjection = saved => ({ bindings: bindings(saved), sets: sets(saved), capacity: capacityProjection(saved.capacity),
    member: saved.runtime.leaders.filter(m => m.taskId === identity.leaderTaskId || m.leaderSubtaskId === identity.moduleId),
    stopping: saved.runtime.stopping });
  const expectedTasks = taskProjection(baseline.tasks || [baseline.rootTask, baseline.leader]), expectedRuntime = runtimeProjection(baseline.runtime);
  assert.deepEqual(capacityProjection(firstHost.capacity), expectedRuntime.capacity, "first EH recorded capacity differs from its pre-exit runtime");
  assert.ok(expectedRuntime.capacity.leaders.includes(identity.moduleId), "original leader has no retained capacity");
  for (const binding of originals) {
    const i = binding.identity, record = i.role === "leader" ? baseline.leader : baseline.leader.subTasks?.find(t => t.id === i.subtaskId);
    assert.equal(record?.executionSession?.cli, i.cli, "original task CLI differs from its binding");
    assert.equal(record?.executionSession?.sessionId, i.session.id, "original task session differs from its binding");
    assert.equal(record?.executionSession?.configId ?? null, binding.selection.configId ?? null);
    if (i.role === "employee") {
      assert.ok(baseline.leader.loopPlus?.running?.some(a => a.subtaskId === i.subtaskId && a.attemptId === i.attemptId), "original binding differs from current scheduler attempt");
      assert.ok(expectedRuntime.capacity.employees.includes(JSON.stringify([i.leaderTaskId, i.attemptId])), "original employee has no retained capacity");
    }
  }
  assert.deepEqual(taskProjection(firstHost.postExitTasks), expectedTasks, "normal first EH exit changed target task/session/attempt/routes");
  assert.deepEqual(runtimeProjection(firstHost.postExitRuntime), expectedRuntime, "normal first EH exit changed target bindings/responsibilities/capacity");
  for (const phase of [secondHost.beforeActivation, secondHost.afterActivation, secondHost.beforeControl, secondHost.afterControl]) {
    assert.deepEqual(taskProjection(phase?.tasks), expectedTasks, "second EH changed target task/session/attempt/routes");
    const saved = phase.roots?.find(r => r.id === identity.rootTaskId && r.workspaceKey === identity.workspace)?.runtime;
    assert.ok(saved, "second EH omitted target persisted runtime");
    assert.deepEqual(runtimeProjection(saved), expectedRuntime, "second EH changed original leader/employee bindings or responsibility set/capacity");
    for (const binding of originals) {
      const matches = phase.observations.filter(o => o.identity.executionId === binding.identity.executionId);
      assert.equal(matches.length, 1, "second EH omitted or duplicated an original binding observation");
      assert.ok(sameExecution(matches[0].identity, binding.identity), "second EH binding does not match the exact production identity");
      assert.deepEqual(matches[0].identity, binding.identity);
      assert.deepEqual(matches[0].selection, binding.selection);
      assert.deepEqual(matches[0].requirements, binding.requirements);
      assert.deepEqual(capacityProjection(matches[0].capacity), expectedRuntime.capacity);
    }
  }
  for (const binding of originals) {
    const owners = secondHost.originalOwnerObservations.filter(o => o.identity.executionId === binding.identity.executionId);
    assert.equal(owners.length, 1, "second EH omitted the exact original Owner observation");
    assert.ok(sameExecution(owners[0].identity, binding.identity), "second EH Owner observation is not the exact production identity");
    assert.ok(sameExecution(owners[0].result?.identity, binding.identity), "original Owner endpoint answered for another identity");
    assert.ok(["live", "finalizing", "unknown", "conflict"].includes(owners[0].result.status), "unrecognized original Owner observation");
  }
  const owner = secondHost.originalOwnerObservations.find(o => o.identity.executionId === identity.executionId);
  return { ownerStatus: owner.result.status, identity, capacity: expectedRuntime.capacity,
    bindings: originals, leaderExecutionSet: originalSets[0] };
}

function assertColdUiRoot(subtitleTitle, expectedRootId) {
  assert.equal(typeof subtitleTitle, "string", "department chat title is unavailable");
  assert.equal(subtitleTitle, expectedRootId, `department chat does not belong to expected root ${expectedRootId}: ${subtitleTitle}`);
  return true;
}

function assertColdUiDepartmentRoster(rosterText) {
  assert.equal(typeof rosterText, "string", "department roster is unavailable");
  const interruptedParticipants = rosterText.match(/本宿主执行已中断/g) ?? [];
  assert.ok(interruptedParticipants.length >= 2, "cold roster must mark the director and leader as interrupted");
  assert.match(rosterText, /运行中\s+0/, "cold roster must exclude stale employee attempts from running counts");
  return true;
}

function isDepartmentWebviewCandidate(info, purpose, options = {}) {
  if (info.type !== "iframe" || options.targetId && info.targetId !== options.targetId) return false;
  try {
    const url = new URL(info.url), actualPurpose = url.searchParams.get("purpose");
    return url.protocol === "vscode-webview:" && url.searchParams.get("extensionId") === "sinitek.sinitek-cli-tools"
      && (actualPurpose === purpose || purpose === "webviewPanel" && !!options.rootId && actualPurpose === null);
  } catch { return false; }
}

// VS Code WebviewPanel URLs can omit purpose (WebviewView URLs include it).
// An absent purpose is only a candidate: inspect the public panel DOM for the
// exact root and director role, and reject duplicate matches before returning.
async function createDepartmentRootPanelAdapter(browser, rootId, timeoutMs, options) {
  const deadline = options.deadline ?? Date.now() + timeoutMs;
  const scoped = { ...options, rootId, deadline, cleanupDeadline: options.cleanupDeadline ?? deadline };
  const diagnostics = options.diagnostics ?? [];
  scoped.diagnostics = diagnostics;
  let discovery, selected, failure;
  const owned = new Set();
  const close = async adapter => {
    owned.delete(adapter);
    await cleanupCdpResource(() => adapter.close(), scoped.cleanupDeadline, "root panel candidate cleanup", diagnostics, true);
    assertCdpCleanup(diagnostics, "root panel candidate");
  };
  try {
    discovery = await withinColdDeadline(() => browser.newBrowserCDPSession(), deadline, "root panel discovery session",
      late => cleanupCdpResource(() => late.detach(), scoped.cleanupDeadline, "late root panel discovery detach", diagnostics));
    while (coldRemaining(deadline) > 0) {
      const { targetInfos } = await withinColdDeadline(() => discovery.send("Target.getTargets"), deadline, "root panel targets");
      const candidates = targetInfos.filter(info => isDepartmentWebviewCandidate(info, "webviewPanel", scoped));
      assert.ok(candidates.length <= 8, "root panel candidate budget exceeded");
      const matches = [];
      for (const target of candidates) {
        const adapter = await createDepartmentWebviewAdapter(browser, "webviewPanel", coldRemaining(deadline), { ...scoped, targetId: target.targetId });
        owned.add(adapter);
        const subtitle = await adapter.locator("#panelSubtitle").getAttribute("title");
        const body = await adapter.locator("body").innerText();
        if (subtitle === rootId && body.includes("产研部群聊") && body.includes(rootId)) matches.push(adapter);
        else await close(adapter);
      }
      assert.ok(matches.length <= 1, "multiple production Webview panels for the exact root");
      if (matches.length === 1) {
        const adapter = matches[0]; selected = adapter;
        adapter.target = { ...adapter.target, verifiedPurpose: "webviewPanel", verifiedRootId: rootId };
        break;
      }
      await withinColdDeadline(() => sleep(Math.min(100, coldRemaining(deadline))), deadline, "root panel public DOM discovery");
    }
  } catch (error) { failure = error; }
  finally {
    if (discovery) await cleanupCdpResource(() => discovery.detach(), scoped.cleanupDeadline, "root panel discovery detach", diagnostics);
    // Transfer the selected target only after discovery cleanup is confirmed.
    if (selected && !failure && diagnostics.length === 0) owned.delete(selected);
    await Promise.all([...owned].map(adapter => cleanupCdpResource(() => close(adapter), scoped.cleanupDeadline,
      "root panel candidate cleanup", diagnostics)));
  }
  if (failure) { failure.cleanupDiagnostics = diagnostics; throw failure; }
  assertCdpCleanup(diagnostics, "root panel");
  assert.ok(selected, "root panel discovery deadline exhausted");
  return selected;
}

function findDepartmentWebviewTarget(targetInfos, purpose) {
  const matches = targetInfos.filter(info => isDepartmentWebviewCandidate(info, purpose));
  assert.equal(matches.length, 1, `expected one production Webview iframe target for ${purpose}, found ${matches.length}`);
  return matches[0];
}

// Runs in the exact public Webview context. SVG role=button controls have no
// HTMLElement.click method; dispatch the same public bubbling mouse event there.
function clickPublicControl(elements) {
  if (elements.length !== 1) return false;
  const e = elements[0], style = getComputedStyle(e);
  if (e.disabled || e.getAttribute("aria-disabled") === "true" || e.closest("[inert]")
    || !e.getClientRects().length || ["hidden", "collapse"].includes(style.visibility)
    || style.display === "none" || style.pointerEvents === "none") return false;
  if (typeof e.click === "function") e.click();
  else e.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
  return true;
}

function assertCdpCleanup(diagnostics, scope) {
  assert.equal(diagnostics.length, 0, `${scope} CDP cleanup unconfirmed: ${JSON.stringify(diagnostics)}`);
}

async function cleanupCdpResource(work, deadline, label, diagnostics, inspectResult = false) {
  // Always initiate release, including after expiry; never wait past the fixed
  // cleanup deadline. A late acquisition may only release its own resource.
  const releasing = Promise.resolve().then(work);
  releasing.catch(() => undefined);
  try {
    const result = await withinColdDeadline(() => releasing, deadline, label);
    if (inspectResult && Array.isArray(result) && result.length) {
      for (const item of result) if (!diagnostics.includes(item)) diagnostics.push(item);
    }
  } catch (error) { diagnostics.push({ operation: label, status: "unconfirmed", error: String(error) }); }
}

// Every bounded operation checks the absolute deadline before starting work.
// Late results can dispose acquired resources, but never resume the action flow.
async function withinColdDeadline(work, deadline, label, onLate) {
  const remaining = coldRemaining(deadline);
  let timer, expired = false;
  const operation = Promise.resolve().then(work);
  operation.then(value => {
    if (expired && onLate) return onLate(value);
  }).catch(() => undefined); // operation rejection is consumed by the race below
  try {
    return await Promise.race([operation, new Promise((_, reject) => {
      timer = setTimeout(() => { expired = true; reject(new Error(`${label} exceeded its absolute deadline`)); }, remaining);
    })]);
  } finally { clearTimeout(timer); }
}

async function createDepartmentWebviewAdapter(browser, purpose, timeoutMs = 30000, options = {}) {
  if (purpose === "webviewPanel" && options.rootId && !options.targetId)
    return createDepartmentRootPanelAdapter(browser, options.rootId, timeoutMs, options);
  const initialDeadline = options.deadline ?? Date.now() + timeoutMs;
  const cleanupDeadline = () => options.cleanupDeadline ?? Date.now() + Math.min(timeoutMs, 1000);
  const diagnostics = options.diagnostics ?? [];
  // Legacy callers retain their per-operation timeout; cold callers fix one
  // deadline for discovery, attachment, context and every public DOM operation.
  let initializing = true, closed = false, cdp, sessionId, onTargetMessage, closePromise;
  const pending = new Map();
  const deadline = () => options.deadline ?? (initializing ? initialDeadline : Date.now() + timeoutMs);
  const cleanup = async (label, work) => {
    await cleanupCdpResource(work, cleanupDeadline(), label, diagnostics);
  };
  const close = () => {
    if (closePromise) return closePromise;
    closed = true;
    if (onTargetMessage) cdp.off("Target.receivedMessageFromTarget", onTargetMessage);
    for (const waiter of pending.values()) waiter.reject(new Error("Webview CDP adapter closed"));
    pending.clear();
    closePromise = (async () => {
      await Promise.all([
        ...(sessionId ? [cleanup("Webview target detach", () => cdp.send("Target.detachFromTarget", { sessionId }))] : []),
        ...(cdp ? [cleanup("Webview browser session detach", () => cdp.detach())] : []),
      ]);
      assertCdpCleanup(diagnostics, "Webview");
      return diagnostics;
    })();
    return closePromise;
  };
  const send = (method, params) => {
    assert.equal(closed, false, "Webview CDP adapter is closed");
    return withinColdDeadline(() => cdp.send(method, params), deadline(), method);
  };
  try {
  cdp = await withinColdDeadline(() => browser.newBrowserCDPSession(), deadline(), "Webview browser session attach",
    late => cleanup("late Webview browser session detach", () => late.detach()));
  await send("Target.setDiscoverTargets", { discover: true });
  let target;
  while (!target) {
    const { targetInfos } = await send("Target.getTargets");
    const matches = targetInfos.filter(info => isDepartmentWebviewCandidate(info, purpose, options));
    if (matches.length > 1) throw new Error(`multiple production Webview targets found for ${purpose}`);
    target = matches[0];
    if (!target) await withinColdDeadline(() => sleep(Math.min(100, coldRemaining(deadline()))), deadline(), "Webview target discovery");
  }
  ({ sessionId } = await withinColdDeadline(() => cdp.send("Target.attachToTarget", { targetId: target.targetId, flatten: false }),
    deadline(), "Webview target attach", late => cleanup("late Webview target detach", () => cdp.send("Target.detachFromTarget", { sessionId: late.sessionId }))));
  let nextId = 0;
  const executionContexts = new Map();
  onTargetMessage = event => {
    if (event.sessionId !== sessionId) return;
    let response;
    try { response = JSON.parse(event.message); } catch { return; }
    if (response.method === "Runtime.executionContextCreated") executionContexts.set(response.params.context.id, response.params.context);
    if (response.method === "Runtime.executionContextDestroyed") executionContexts.delete(response.params.executionContextId);
    if (response.method === "Runtime.executionContextsCleared") executionContexts.clear();
    const waiter = pending.get(response.id);
    if (!waiter) return;
    pending.delete(response.id);
    if (response.error) waiter.reject(new Error(response.error.message)); else waiter.resolve(response.result || {});
  };
  cdp.on("Target.receivedMessageFromTarget", onTargetMessage);
  const sendToTarget = async (method, params = {}) => {
    assert.equal(closed, false, "Webview CDP adapter is closed");
    const until = deadline();
    coldRemaining(until);
    const id = ++nextId;
    try {
      // Await send and response concurrently: a response timer alone cannot bound
      // a transport send that never returns. Both consume the same budget.
      const [, result] = await withinColdDeadline(() => {
        const response = new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
        return Promise.all([
          Promise.resolve().then(() => cdp.send("Target.sendMessageToTarget", { sessionId, message: JSON.stringify({ id, method, params }) })), response,
        ]);
      }, until, `Webview CDP ${method}`);
      return result;
    } finally {
      pending.get(id)?.reject(new Error(`Webview CDP ${method} ended without a response`));
      pending.delete(id);
    }
  };
  await sendToTarget("Runtime.enable");
  await sendToTarget("Page.enable");
  let executionContext;
  while (!executionContext) {
    executionContext = [...executionContexts.values()].find(context => context.auxData?.isDefault) || [...executionContexts.values()][0];
    if (!executionContext) await withinColdDeadline(() => sleep(Math.min(25, coldRemaining(deadline()))), deadline(), "Webview execution context");
  }
  initializing = false;
  assert.ok(executionContext, `production Webview target ${target.targetId} has no execution context`);
  const evaluate = async expression => {
    const result = await sendToTarget("Runtime.evaluate", { expression, contextId: executionContext.id, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(`Webview evaluation failed: ${JSON.stringify({ expression, contextId: executionContext.id,
      exception: result.exceptionDetails.text, description: result.exceptionDetails.exception?.description,
      lineNumber: result.exceptionDetails.lineNumber, columnNumber: result.exceptionDetails.columnNumber })}`);
    return result.result?.value;
  };
  const locator = selector => {
    const query = `Array.from(document.querySelectorAll(${JSON.stringify(selector)}))`;
    const one = `document.querySelector(${JSON.stringify(selector)})`;
    const invoke = callback => evaluate(`(${callback})(${query})`);
    return {
      locator: nested => locator(`${selector} ${nested}`),
      count: async () => evaluate(`${query}.length`),
      click: async () => {
        const result = await evaluate(`(${clickPublicControl.toString()})(${query})`);
        assert.equal(result, true, `public Webview control is not clickable, unique, visible and enabled: ${selector}`);
      },
      waitFor: async ({ state = "visible", timeout = 10000 } = {}) => {
        const until = Math.min(deadline(), Date.now() + timeout);
        while (Date.now() < until) {
          const present = await evaluate(`${one} !== null`);
          const visible = present && await evaluate(`(() => { const e=${one}; return !!e && !!e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden'; })()`);
          if (state === "attached" && present || state === "visible" && visible || state === "hidden" && !visible) return;
          await withinColdDeadline(() => sleep(Math.min(50, coldRemaining(until))), until, "Webview locator wait");
        }
        throw new Error(`Webview control ${selector} did not reach ${state} before its deadline`);
      },
      isChecked: async () => evaluate(`!!(${one} && ${one}.checked)`),
      check: async () => {
        const changed = await evaluate(`(() => { const e=${one}; if (!e || e.disabled) return false; if (!e.checked) { e.checked=true; e.dispatchEvent(new Event('input',{bubbles:true})); e.dispatchEvent(new Event('change',{bubbles:true})); } return true; })()`);
        assert.equal(changed, true, `public Webview checkbox is unavailable: ${selector}`);
      },
      isDisabled: async () => evaluate(`!(${one}) || !!${one}.disabled`),
      isEnabled: async () => evaluate(`!!(${one}) && !${one}.disabled`),
      isVisible: async () => evaluate(`(() => { const e=${one}; return !!e && !!e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden'; })()`),
      selectOption: async value => {
        const selected = await evaluate(`(() => { const e=${one}; if (!e || e.disabled || !Array.from(e.options).some(o=>o.value===${JSON.stringify(value)})) return false; e.value=${JSON.stringify(value)}; e.dispatchEvent(new Event('input',{bubbles:true})); e.dispatchEvent(new Event('change',{bubbles:true})); return true; })()`);
        assert.equal(selected, true, `public Webview select option is unavailable: ${selector}=${value}`);
      },
      evaluateAll: callback => invoke(callback.toString()),
      evaluate: callback => evaluate(`(${callback.toString()})(${one})`),
      innerText: async () => evaluate(`(${one} ? ${one}.innerText : '')`),
      fill: async value => {
        const filled = await evaluate(`(() => { const e=${one}; if (!e || e.disabled) return false; e.value=${JSON.stringify(value)}; e.dispatchEvent(new Event('input',{bubbles:true})); e.dispatchEvent(new Event('change',{bubbles:true})); return true; })()`);
        assert.equal(filled, true, `public Webview input is unavailable: ${selector}`);
      },
      getAttribute: name => evaluate(`(${one} && ${one}.getAttribute(${JSON.stringify(name)}))`),
      inputValue: () => evaluate(`(${one} && ${one}.value)`),
      allInnerTexts: () => evaluate(`${query}.map(e=>e.innerText)`),
    };
  };
  return {
    target,
    locator,
    close,
  };
  } catch (error) {
    await close().catch(() => undefined);
    if (diagnostics.length) error.cleanupDiagnostics = diagnostics;
    throw error;
  }
}

function coldRemaining(deadline) {
  const remaining = deadline - Date.now();
  assert.ok(remaining > 0, "cold EH absolute phase deadline exhausted");
  return remaining;
}

function assertColdHostObservation(root, readFailure = () => {
  const file = path.join(root, "cold-second-host-failure.json");
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : null;
}) {
  const failure = readFailure();
  if (failure) throw new Error(`cold second EH ${failure.phase}: ${failure.error}`);
}

/** On evidence failure the second EH still owns its normal exit. Its fixture
 * waits for our confirmed CDP release before throwing the original error. */
async function settleColdPublicControl(control, hasExited, deadline, pause = sleep, now = Date.now) {
  try { return await control(); }
  catch (error) {
    while (!hasExited() && now() < deadline) await pause(Math.min(100, deadline - now()));
    throw error;
  }
}

async function driveColdProductionRecoveryCheck(port, rootId, root, deadlines, dependencies = {}) {
  const playwrightPath = process.env.PLAYWRIGHT_MODULE;
  assert.ok(dependencies.chromium || playwrightPath, "PLAYWRIGHT_MODULE must name the isolated fixed-version Playwright package");
  const { chromium } = dependencies.chromium ? dependencies : require(playwrightPath);
  const diagnostics = [], evidencePath = path.join(root, "cold-second-host.json");
  const evidenceExists = dependencies.evidenceExists ?? (() => fs.existsSync(evidencePath));
  const signal = dependencies.signal ?? (() => fs.writeFileSync(path.join(root, "cold-recovery-check.signal"), "public-stop-clicked\n", { flag: "wx", mode: 0o600 }));
  const cleanup = async (label, work) => {
    await cleanupCdpResource(work, deadlines.hostDeadline, label, diagnostics, true);
  };
  let browser, webview, failure;
  try {
    browser = await withinColdDeadline(() => chromium.connectOverCDP(`http://127.0.0.1:${port}`,
      { timeout: coldRemaining(deadlines.actionDeadline) }), deadlines.actionDeadline, "cold browser connection",
      late => cleanup("late cold browser close", () => late.close()));
    let page;
    while (!page) {
      coldRemaining(deadlines.actionDeadline);
      page = browser.contexts().flatMap(context => context.pages()).find(candidate => candidate.url().startsWith("vscode-file:"));
      if (!page) await withinColdDeadline(() => sleep(100), deadlines.actionDeadline, "cold workbench discovery");
    }
    webview = await (dependencies.webviewFactory ?? createDepartmentWebviewAdapter)(browser, "webviewPanel", coldRemaining(deadlines.actionDeadline),
      { rootId, deadline: deadlines.actionDeadline, cleanupDeadline: deadlines.hostDeadline, diagnostics });
    const stop = webview.locator('[data-action="stopTask"]');
    await stop.waitFor({ state: "visible", timeout: coldRemaining(deadlines.actionDeadline) });
    assert.equal(await stop.count(), 1, `department group chat stop action is not available for ${rootId}`);
    assertColdUiRoot(await webview.locator("#panelSubtitle").getAttribute("title"), rootId);
    const taskPanel = await webview.locator("#taskPanelSlot").innerText();
    const rosterPanel = await webview.locator("#rosterPanelSlot").innerText();
    const actions = await webview.locator("#departmentContinueBlocked").innerText();
    assert.match(taskPanel, /本宿主执行已中断/, "cold director projection did not identify host-local interruption");
    assertColdUiDepartmentRoster(rosterPanel);
    assert.match(actions, /本宿主执行已中断/, "cold director continuation gate omitted interruption semantics");
    assert.match(actions, /原执行退出未确认/, "cold director projection omitted the outstanding cleanup gate");
    assert.equal(await stop.isEnabled(), true, "cold projection must retain the explicit department Stop/reconciliation action");
    const continueAction = webview.locator('[data-action="continueTask"]');
    assert.equal(await continueAction.count(), 1, "cold projection must preserve its visible continuation gate");
    assert.equal(await continueAction.isDisabled(), true, "cold projection must not enable continuation while original execution ownership is unreconciled");
    const requestEvidence = path.join(root, "cold-provider-requests.ndjson");
    const requestCountBeforeControl = fs.existsSync(requestEvidence)
      ? fs.readFileSync(requestEvidence, "utf8").trim().split("\n").filter(Boolean).length : 0;
    assert.equal(requestCountBeforeControl, dependencies.initialProviderRequestCount ?? 0,
      "second EH dispatched/replayed a model request before the explicit user control");
    fs.writeFileSync(path.join(root, "cold-second-host-ui.json"), JSON.stringify({ rootTaskId: rootId,
      taskPanel, rosterPanel, actions, stopEnabled: true, continueDisabled: true, requestCountBeforeControl }), { mode: 0o600 });
    coldRemaining(deadlines.actionDeadline);
    await stop.click();
    coldRemaining(deadlines.actionDeadline);
    signal();
    while (!evidenceExists()) {
      assertColdHostObservation(root, dependencies.readFailure);
      await withinColdDeadline(() => sleep(Math.min(100, coldRemaining(deadlines.evidenceDeadline))),
        deadlines.evidenceDeadline, "cold recovery evidence");
    }
    assertColdHostObservation(root, dependencies.readFailure);
    coldRemaining(deadlines.evidenceDeadline);
  } catch (error) { failure = error; }
  finally {
    if (webview) await cleanup("cold webview close", () => webview.close());
    // This invocation owns the connection, the adapter owns only its sessions.
    if (browser) await cleanup("cold browser close", () => browser.close());
    fs.writeFileSync(path.join(root, "cold-cdp-cleanup.json"), JSON.stringify({ diagnostics, confirmed: diagnostics.length === 0 }, null, 2));
  }
  if (failure) { failure.cleanupDiagnostics = diagnostics; throw failure; }
  assertCdpCleanup(diagnostics, "cold");
}

async function waitForDebugger(port, deadline) {
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      if (response.ok) return response.json();
    } catch { /* Chromium is starting. */ }
    await sleep(150);
  }
  throw new Error("VS Code Chromium debugger did not start");
}

async function drivePublicEntry(root, port, prompt, report, input) {
  const playwrightPath = process.env.PLAYWRIGHT_MODULE || "/tmp/zq-playwright-smoke/node_modules/playwright";
  const { chromium } = require(playwrightPath);
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const browserErrors = [];
  let webview;
  try {
    const deadline = input.deadline ?? Date.now() + 45000;
    let page;
    while (Date.now() < deadline && !page) {
      page = browser.contexts().flatMap((context) => context.pages()).find((candidate) => candidate.url().startsWith("vscode-file:"));
      if (!page) await sleep(100);
    }
    assert.ok(page, "VS Code workbench page is available over CDP");
    page.on("pageerror", (error) => browserErrors.push({ kind: "pageerror", message: error.message }));
    page.on("console", (message) => {
      if (message.type() === "error") browserErrors.push({ kind: "console", message: message.text() });
    });
    webview = await createDepartmentWebviewAdapter(browser, "webviewView", input.deadline ? coldRemaining(input.deadline) : undefined, input.deadline ? { deadline: input.deadline, cleanupDeadline: input.deadline + 10000 } : {});
    const frame = webview;
    const until = input.deadline ?? Date.now() + 30000;
    while (Date.now() < until && await frame.locator("#interactiveModeSelect").count().catch(() => 0) === 0) await sleep(150);
    if (await frame.locator("#interactiveModeSelect").count().catch(() => 0) === 0) {
      const frames = page.frames().map(candidate => ({ url: candidate.url() }));
      const dom = await page.evaluate(() => {
        const found = [];
        const visit = (root) => {
          for (const element of root.querySelectorAll("*") ) {
            if (["IFRAME", "VSCODE-WEBVIEW"].includes(element.tagName) || element.id === "workbench.parts.sidebar") {
              found.push({ tag: element.tagName, id: element.id, className: String(element.className || "").slice(0, 120), src: element.getAttribute("src"),
                shadowChildren: element.shadowRoot ? [...element.shadowRoot.children].map(child => child.tagName + (child.id ? "#" + child.id : "")) : [] });
            }
            if (element.shadowRoot) visit(element.shadowRoot);
          }
        };
        visit(document);
        return { body: document.body.innerText.slice(0, 1000), elements: found };
      });
      await page.screenshot({ path: path.join(root, "public-entry-webview-debug.png"), fullPage: true }).catch(() => undefined);
      const targetBody = (await frame.locator("body").innerText().catch(() => "")).slice(0, 1000);
      const targetDocument = await frame.locator("html").evaluate(element => ({ ready: document.readyState, body: document.body?.outerHTML?.slice(0, 1000), title: document.title })).catch(error => String(error));
      throw new Error(`production panel Webview with interactiveModeSelect is unavailable; target=${JSON.stringify(webview.target)} document=${JSON.stringify(targetDocument)} body=${JSON.stringify(targetBody)} page=${page.url()} frames=${JSON.stringify(frames)} dom=${JSON.stringify(dom)}`);
    }
    report.publicUi = {};
    const toolSettingsButton = frame.locator("#toolSettingsButton");
    await toolSettingsButton.click();
    const departmentEnabled = frame.locator("#departmentEnabled");
    await departmentEnabled.waitFor({ state: "visible", timeout: 10000 });
    if (!(await departmentEnabled.isChecked())) await departmentEnabled.check();
    const settingsPath = path.join(root, "home", ".sinitek_cli", "settings.json");
    const settingDeadline = Date.now() + 10000;
    let saved = false;
    while (Date.now() < settingDeadline) {
      try { saved = JSON.parse(fs.readFileSync(settingsPath, "utf8")).departmentEnabled === true; } catch { /* wait for persisted update */ }
      if (saved && !(await departmentEnabled.isDisabled())) break;
      await sleep(100);
    }
    assert.equal(saved, true, "departmentEnabled was persisted through the public tool settings control");
    report.publicUi.toolSettings = { departmentEnabled: saved, path: settingsPath };
    await frame.locator("#closeToolSettings").click();
    await frame.locator("#toolSettingsOverlay").waitFor({ state: "hidden", timeout: 10000 });
    const director = roleSelection("director", input.directorCli);
    if (director.cli === "opencode") {
    await frame.locator("#currentCli").selectOption(director.cli);
    const configSelect = frame.locator("#configSelect");
    const configUntil = Date.now() + 15000;
    while (Date.now() < configUntil && !(await configSelect.locator("option").evaluateAll(nodes => nodes.map(node => node.value))).includes(director.profile)) await sleep(100);
    await configSelect.selectOption(director.profile);
    const modelSelect = frame.locator("#openCodePrimaryModelSelect");
    await modelSelect.waitFor({ state: "visible", timeout: 15000 });
    const modelUntil = Date.now() + 15000;
    while (Date.now() < modelUntil && !(await modelSelect.locator("option").evaluateAll(nodes => nodes.map(node => node.value))).includes(director.model)) await sleep(100);
    await modelSelect.selectOption(director.model); // Existing handler stores null when equal to this profile's default.
    }
    report.publicUi.directorSelection = director;
    const mode = frame.locator("#interactiveModeSelect");
    const modeVisible = await mode.isVisible().catch(() => false);
    if (!modeVisible) {
      const frames = [];
      for (const candidate of page.frames()) frames.push({ url: candidate.url(), body: await candidate.locator("body").innerText().catch(() => "") });
      report.publicUi = { frames,
        mode: await mode.evaluate((element) => ({ html: element.outerHTML, style: element.getAttribute("style"), disabled: element.disabled })).catch((error) => String(error)) };
      throw new Error(`production interactiveModeSelect is hidden: ${JSON.stringify(report.publicUi.mode)}`);
    }
    await mode.waitFor({ state: "visible", timeout: 15000 });
    const options = await mode.locator("option").evaluateAll((nodes) => nodes.map((node) => ({ value: node.value, label: node.textContent?.trim() })));
    report.publicUi = { ...report.publicUi, options };
    assert.ok(options.some((option) => option.value === "department"), "production mode selector exposes department");
    await mode.selectOption("department");
    const configureRole = async (role) => {
      const { cli, profile, model: modelValue } = roleSelection(role, input[`${role}Cli`], role === "leader" ? input.leaderModel : "default");
      const cliSelect = frame.locator(`#department-${role}-cli`);
      await cliSelect.waitFor({ state: "visible", timeout: 10000 });
      const cliDeadline = Date.now() + 15000;
      while (Date.now() < cliDeadline && await cliSelect.isDisabled()) await sleep(100);
      await cliSelect.selectOption(cli);
      // The current public form has CLI/model/thinking controls. Its profile
      // follows the exact active CLI profile selected above; no hidden config
      // select is created or changed by this driver. Final preferences and
      // original execution bindings verify the resolved profile below.
      report.publicUi[`${role}Selection`] = { cli, profile, model: modelValue };
      const model = frame.locator(`#department-${role}-model`);
      const modelDeadline = Date.now() + 15000;
      while (Date.now() < modelDeadline) {
        const values = await model.locator("option").evaluateAll((nodes) => nodes.map((node) => node.value));
        if (values.includes(modelValue) && !(await model.isDisabled())) break;
        await sleep(100);
      }
      assert.equal(await model.isDisabled(), false, `${role} default model is available`);
      await model.selectOption(modelValue);
      const savedMessage = frame.locator("#departmentRoleMessage");
      const readyDeadline = Date.now() + 15000;
      while (Date.now() < readyDeadline && (await savedMessage.innerText().catch(() => "")).includes("正在保存")) await sleep(100);
      assert.equal((await savedMessage.innerText().catch(() => "")).includes("正在保存"), false, `${role} role preference save completed`);
    };
    await configureRole("leader");
    await configureRole("employee");
    await frame.locator("#promptInput").fill(prompt);
    const send = frame.locator("#sendPrompt");
    const readiness = { enabled: await send.isEnabled(), title: await send.getAttribute("title"),
      message: await frame.locator("#departmentRoleMessage").innerText().catch(() => "") };
    report.publicUi.readiness = readiness;
    assert.equal(readiness.enabled, true, `department settings must be complete: ${JSON.stringify(readiness)}`);
    await send.click();
    const acceptanceDialog = frame.locator("#acceptancePlanOverlay");
    await acceptanceDialog.waitFor({ state: "visible", timeout: 10000 });
    const acceptancePlanId = await frame.locator("#acceptancePlanSelect").inputValue();
    assert.ok(acceptancePlanId, "public acceptance plan dialog has a selected plan");
    await frame.locator("#confirmAcceptancePlan").click();
    await acceptanceDialog.waitFor({ state: "hidden", timeout: 10000 });
    report.publicUi.acceptancePlanId = acceptancePlanId;
    report.publicUi.sentPrompt = prompt;
    report.publicUi.sentAt = new Date().toISOString();
    await sleep(1500);
    report.publicUi.afterSend = { text: (await frame.locator("body").innerText()).slice(-5000),
      sendDisabled: await send.isDisabled(), mode: await mode.inputValue(),
      promptInput: await frame.locator("#promptInput").inputValue().catch(() => null),
      toast: await frame.locator("#toast").innerText().catch(() => ""),
      acceptanceError: await frame.locator("#acceptancePlanError").innerText().catch(() => ""),
      visibleMessages: await frame.locator(".message").allInnerTexts().catch(() => []) };
    report.publicUi.browserErrors = browserErrors;
    await page.screenshot({ path: path.join(root, "public-entry-after-send.png"), fullPage: true }).catch(() => undefined);
    await browser.close();
  } finally {
    if (webview) await webview.close().catch(() => undefined);
    if (browser.isConnected()) await browser.close();
  }
}

async function driveContinuation({ root, port, report, scenario, readTasks, inspectCleanup, readRuntime, healthy }) {
  const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "/tmp/zq-playwright-smoke/node_modules/playwright");
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  let group;
  const wait = async (label, check) => {
    const until = Date.now() + Math.min(timeoutMs, 60000);
    while (Date.now() < until) {
      healthy();
      const value = await check(); if (value) return value;
      await sleep(100);
    }
    throw new Error(`stop-continue timeout: ${label}`);
  };
  try {
    report.activePhase = "publicStop"; report.stages.publicStop = "running";
    const held = await wait("real leader and employee request", () => scenario.snapshot().continuation.held);
    const rootId = scenario.snapshot().rootId;
    const tasks = readTasks(), originalRoot = tasks.find((task) => task.id === rootId), originalLeader = tasks.find((task) => task.id === held.leaderTaskId);
    assert.ok(originalRoot?.status === "running" && originalLeader?.status === "running");
    assert.equal(originalLeader.department.rootTaskId, rootId);
    assert.deepEqual(originalLeader.loopPlusAcceptancePlan, originalRoot.loopPlusAcceptancePlan);
    const original = readRuntime(rootId);
    const originalBindings = original.executionBindings;
    assert.equal(originalBindings.length, 2, "stop must see both actual original Owner bindings");
    assert.ok(originalBindings.some(({ identity }) => identity.role === "employee" && identity.subtaskId === held.subtaskId && identity.attemptId === held.attemptId));
    report.continuationEvidence = { rootId, originalRoot, originalLeader, originalBindings, originalRuntime: original };
    const view = await createDepartmentWebviewAdapter(browser, "webviewView");
    try { await view.locator("#openCurrentLoopGroupChat").click(); }
    finally { await view.close(); }
    group = await createDepartmentWebviewAdapter(browser, "webviewPanel", 30000, { rootId });
    await group.locator('#panelActions [data-action="stopTask"]').click();
    report.continuationEvidence.stopClickedAt = new Date().toISOString();
    // Wait for the PUBLIC action to persist cancellation, then unblock the local
    // HTTP response. This does not stop, settle or clean any production object.
    await wait("root stop projection", () => readTasks().find((task) => task.id === rootId)?.status === "stopped");
    scenario.releaseEmployee();
    report.stages.publicStop = "passed";
    report.activePhase = "stoppedCleanup"; report.stages.stoppedCleanup = "running";
    const cleanup = await wait("original Owner receipts and persistent stopped capacity", async () => {
      const value = await inspectCleanup(rootId, "stopped");
      return value.complete ? value : null;
    });
    assert.deepEqual(cleanup.saved.executionBindings, originalBindings, "stopping changed original bindings");
    report.continuationEvidence.stoppedCleanup = cleanup;
    report.stages.stoppedCleanup = "passed";
    const continueControl = group.locator('#panelActions [data-action="continueTask"]');
    await wait("public stop settlement", async () => continueControl.isEnabled().catch(() => false));
    const before = JSON.stringify(readRuntime(rootId));
    const requestCount = scenario.history.length;
    await sleep(1000); healthy();
    assert.equal(JSON.stringify(readRuntime(rootId)), before, "stopped organization revived without public continue");
    assert.equal(scenario.history.length, requestCount, "stopped organization issued a model request");
    assert.equal(readTasks().find((task) => task.id === rootId)?.status, "stopped");
    report.continuationEvidence.noAutomaticRevival = { durationMs: 1000, requestCount, unchanged: true };
    report.activePhase = "publicContinue"; report.stages.publicContinue = "running";
    const prompt = scenario.beginContinue(cleanup);
    await continueControl.click();
    await group.locator("#continueDialogInput").fill(prompt);
    await group.locator("#continueDialogConfirm").click();
    report.continuationEvidence.continueClickedAt = new Date().toISOString();
    await wait("same root successor generation", () => {
      const value = readRuntime(rootId);
      return value.leaderExecutionSets.some((set) => set.scope.leaderTaskId === held.leaderTaskId
        && !original.leaderExecutionSets.some((old) => old.scope.generation === set.scope.generation && old.scope.leaderTaskId === set.scope.leaderTaskId)) ? value : null;
    });
    const currentTasks = readTasks();
    assert.equal(currentTasks.filter((task) => task.department?.role === "director").length, 1);
    assert.equal(currentTasks.find((task) => task.id === rootId)?.sessionId, originalRoot.sessionId);
    assert.equal(currentTasks.find((task) => task.id === held.leaderTaskId)?.sessionId, originalLeader.sessionId);
    assert.deepEqual(currentTasks.find((task) => task.id === held.leaderTaskId)?.department, originalLeader.department);
    report.stages.publicContinue = "passed"; report.activePhase = "successorCompletion";
  } finally {
    scenario.releaseEmployee();
    try { await group?.close(); }
    finally { await browser.close(); }
  }
}

// Cold successors may contain only the continued leader. Compare the exact
// already observed production responsibility sets instead of inferring counts.
function matchesExpectedCleanupSets(sets, expected) {
  if (!Array.isArray(expected) || !expected.length || sets.length !== expected.length) return false;
  const key = value => JSON.stringify([value.scope, value.producerId]);
  if (new Set(expected.map(key)).size !== expected.length || new Set(sets.map(key)).size !== sets.length) return false;
  return sets.every(set => {
    const source = expected.find(candidate => key(candidate) === key(set));
    return source && source.entries.length > 0 && source.entries.every(entry => typeof entry.executionId === "string" && entry.executionId)
      && JSON.stringify(set.entries) === JSON.stringify(source.entries);
  });
}

async function main() {
  const input = args(process.argv.slice(2));
  const product = path.resolve(input.product);
  const reportPath = path.resolve(input.report);
  assert.equal(fs.existsSync(reportPath), false, "--report must name a new file");
  assert.ok(fs.existsSync(path.join(product, "dist/extension.js")), "--product must be an isolated built extension directory");
  assert.equal(fs.lstatSync(path.join(product, "dist")).isSymbolicLink(), false, "--product dist must be physical, not a shared symlink");
  assert.equal(fs.realpathSync(path.join(product, "dist")), path.join(fs.realpathSync(product), "dist"), "--product dist must belong to the isolated product copy");
  const tempRoot = process.platform === "darwin" ? "/tmp" : os.tmpdir();
  const root = fs.mkdtempSync(path.join(tempRoot, "s-dept-eh-"));
  const home = path.join(root, "home"), workspace = path.join(root, "workspace");
  const code = vscodeExecutable(), port = await freePort();
  const prompt = `部门公开入口隔离验收 ${require("node:crypto").randomUUID()}：对 isolated protocol 做两次大写转换，按组织流程报告结果；不编写代码，不访问外网。`;
  const report = { startedAt: new Date().toISOString(), platform: process.platform, node: process.version,
    product, vscode: code, isolated: { root, home, workspace, taskStore: path.join(home, ".sinitek_cli/department-tasks-v1"), userData: path.join(root, "user-data") },
    stages: { prerequisites: "running", emptyStore: "pending", extensionHost: "pending", publicUi: "pending", rootCreation: "pending", directorExecution: "pending", leaderExecution: "pending", ...(input.scenario === "codex-long-tool-output" ? { longNativeToolCompletion: "pending" } : {}), eventAcceptance: "pending", unifiedAcceptancePlan: "pending", directorReport: "pending", ownerReceipts: "pending", capacityReturn: "pending" },
    scenarioName: input.scenario || "new-root", roles: { director: input.directorCli, leader: input.leaderCli, employee: input.employeeCli }, leaderModelSelection: input.leaderModel,
    result: "failed", failures: [], notes: ["Only free loopback protocol providers are configured; external model credentials are not copied."] };
  let responses, openCodeProvider, child, secondChild, workerExitObserver, exited = false, forced = false;
  const positiveDeadline = input.scenario === "cold-recovery" ? Date.now() + timeoutMs : undefined;
  const positiveEvidenceDeadline = positiveDeadline ? positiveDeadline - 10000 : undefined;
  const readTasks = () => {
    const directory = report.isolated.taskStore;
    if (!fs.existsSync(directory)) return [];
    return fs.readdirSync(directory).filter((name) => name.endsWith(".json") && !name.startsWith("."))
      .flatMap((name) => { const value = JSON.parse(fs.readFileSync(path.join(directory, name), "utf8"));
        assert.ok(Array.isArray(value.tasks), "production task store schema changed"); return value.tasks; });
  };
  const readJson = (file) => fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : null;
  const { DepartmentRuntimeStore } = require(path.join(product, "dist/extensionHost/departmentruntimestore.js"));
  const { DepartmentExecutionOwnerClient } = require(path.join(product, "dist/runtime/departmentexecutionownerclient.js"));
  const { cleanupComplete, CLEANUP_PARTS, sameExecution } = require(path.join(product, "dist/runtime/departmentexecutionidentity.js"));
  const { isDepartmentExecutionReceipt } = require(path.join(product, "dist/runtime/departmentexecutionreceiptstore.js"));
  const runtimeStore = new DepartmentRuntimeStore(path.join(home, ".sinitek_cli/department-runtime"));
  const receipts = new Map();
  const readRuntime = (rootId) => {
    const task = readTasks().find((value) => value.id === rootId);
    const read = runtimeStore.read(rootId, task.workspaceKey);
    assert.equal(read.ok, true, `runtime state is unreadable: ${read.error}`);
    assert.ok(read.value, "runtime is missing"); return read.value;
  };
  const longToolFixture = input.scenario === "codex-long-tool-output"
    ? require(path.join(product, "dist/test/extensionHost/fixtures/departmentfullehproductionhost.js")) : null;
  const readLongToolEvidence = () => {
    assert.equal(fs.existsSync(path.join(root, "long-tool-observer-errors.ndjson")), false, "long tool event observer reported a diagnostic");
    return readJson(path.join(root, "long-tool-forwarded-event.json"));
  };
  const readLongToolGrant = (rootId, leaderId, invocationId) => {
    const grant = longToolFixture.readDepartmentFullEhLongToolGrant(root, leaderId, invocationId);
    assert.ok(grant && grant.identity.rootTaskId === rootId, "missing original leader invocation grant");
    const saved = readRuntime(rootId), id = grant.identity;
    assert.equal(saved.executionBindings.filter(binding => sameExecution(binding.identity, id)).length, 1, "long-tool grant differs from persisted original binding");
    assert.equal(saved.runtime.leaders.filter(leader => leader.taskId === leaderId && leader.generation === id.generation
      && leader.leaderSubtaskId === id.moduleId).length, 1, "long-tool grant differs from persisted leader generation");
    return grant;
  };
  const inspectCleanup = async (rootId, phase = "completed", expectedSets = null) => {
    const task = readTasks().find((value) => value.id === rootId && value.department?.role === "director");
    assert.ok(task, "original runtime root is missing");
    const read = runtimeStore.read(rootId, task.workspaceKey);
    assert.equal(read.ok, true, `runtime state is unreadable: ${read.error}`);
    const saved = read.value;
    if (!saved) return { complete: false, reason: "runtime-missing" };
    const bindings = saved.executionBindings || [], sets = saved.leaderExecutionSets || [];
    if (input.scenario === "loop-plus") {
      assert.equal(task.department.executionMode, "loop-plus");
      assert.deepEqual(bindings, []);
      assert.deepEqual(sets, []);
      const complete = saved.runtime.leaders.length > 0 && saved.runtime.leaders.every((member) => member.status === "completed")
        && saved.capacity.leaders.length === 0 && saved.capacity.employees.length === 0;
      return { complete, rootId, saved };
    }
    // Owners may have naturally exited by this director decision. The EH test
    // fixture mirrors only successful returns on the original production client;
    // this is not a receipt-store read or a replacement cold client's assertion.
    const observerErrors = path.join(root, "original-owner-observation-errors.ndjson");
    assert.equal(fs.existsSync(observerErrors), false, "original Owner observation recorder failed");
    const capturedPath = path.join(root, "original-owner-observations.ndjson");
    const captured = fs.existsSync(capturedPath) ? fs.readFileSync(capturedPath, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line)) : [];
    assert.ok(captured.length <= 64, "original receipt observation budget exceeded");
    const observations = [];
    for (const binding of bindings) {
      const id = binding.identity;
      let observation = receipts.get(id.executionId);
      if (!observation) {
        const original = captured.find((entry) => sameExecution(entry.identity, id));
        if (original) {
          assert.equal(original.source, "original-client-waitForCleanup-return");
          assert.ok(isDepartmentExecutionReceipt(original.receipt) && sameExecution(original.receipt.identity, id), "invalid original Owner receipt");
          assert.ok(CLEANUP_PARTS.every((part) => original.requirements[part] === binding.requirements[part]), "original observer policy mismatch");
          observation = { status: "cleaned", identity: original.identity, receipt: original.receipt };
        }
      }
      if (!observation) observation = await new DepartmentExecutionOwnerClient(path.join(home, ".sinitek_cli/department-execution-owners", id.ownerId)).observeExecution(id);
      if (observation.status === "cleaned") {
        assert.ok(sameExecution(observation.identity, id), "original Owner identity mismatch");
        assert.ok(CLEANUP_PARTS.every((part) => observation.receipt.requirements[part] === binding.requirements[part]), "receipt policy mismatch");
        assert.ok(cleanupComplete(observation.receipt.cleanup, binding.requirements), "incomplete Owner receipt");
        receipts.set(id.executionId, observation);
      }
      observations.push(observation);
    }
    const ids = new Set(bindings.map((binding) => binding.identity.executionId));
    const represented = sets.flatMap((set) => set.entries.map((entry) => entry.executionId));
    const complete = saved.runtime.leaders.length > 0 && sets.length >= saved.runtime.leaders.length
      && sets.every((set) => set.state === "closed" && set.closure)
      && (expectedSets ? matchesExpectedCleanupSets(sets, expectedSets) : sets.every(set => set.entries.length >= 2))
      && represented.length === ids.size && represented.every((id) => id && ids.has(id))
      && bindings.some((binding) => binding.identity.role === "leader") && bindings.some((binding) => binding.identity.role === "employee")
      && observations.length > 0 && observations.every((observation) => observation.status === "cleaned")
      && saved.runtime.leaders.every((member) => member.status === (phase === "stopped" ? "paused" : "completed"))
      && saved.capacity.leaders.length === 0 && saved.capacity.employees.length === 0;
    const evidence = { complete, rootId, saved, observations, originalClientObservationFile: capturedPath };
    report.cleanupEvidence = evidence;
    return evidence;
  };
    const scenarioFactory = input.scenario === "cold-recovery" ? createDepartmentColdRecoveryEhScenario
      : input.scenario === "cold-start" ? createDepartmentColdStartEhScenario
      : input.scenario === "successive-stop-continue" ? createDepartmentSuccessiveContinuationEhScenario
      : input.scenario === "stop-continue" ? createDepartmentContinuationEhScenario : createDepartmentFullEhScenario;
    const scenario = scenarioFactory({ prompt, readTasks, inspectCleanup, roles: report.roles,
      ...(longToolFixture ? { longToolOutput: true, readLongToolEvidence,
        readLongToolInvocation: (rootId, leaderId) => {
          const grant = readLongToolGrant(rootId, leaderId);
          return longToolFixture.departmentFullEhLongToolIdentity(grant.identity, grant.invocationId);
        } } : {}),
      ...(input.scenario === "successive-stop-continue" ? { holdTimeoutMs: Math.min(timeoutMs, 120000) } : {}) });
  try {
    assert.ok(fs.existsSync(code), `VS Code is not installed at ${code}`);
    const codex = codexExecutable();
    report.codex = { executable: codex, version: cp.spawnSync(codex, ["--version"], { encoding: "utf8", env: { PATH: process.env.PATH, HOME: root, USERPROFILE: root, CODEX_HOME: root } }).stdout.trim() };
    const env = isolatedEnvironment(root);
    for (const key of ["HOME", "USERPROFILE", "CODEX_HOME", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_CACHE_HOME", "XDG_STATE_HOME", "APPDATA", "LOCALAPPDATA", "TMPDIR", "OPENCODE_CONFIG_DIR"])
      fs.mkdirSync(env[key], { recursive: true });
    env.SINITEK_DEPARTMENT_FULL_EH_REPORT = path.resolve(reportPath);
    report.environment = { keys: Object.keys(env).sort(), isolation: Object.fromEntries(Object.entries(env).filter(([key]) => /^(HOME|USERPROFILE|CODEX_HOME|XDG_|APPDATA|LOCALAPPDATA|TMP|TEMP|OPENCODE_CONFIG_DIR)/.test(key))) };
    fs.mkdirSync(home, { recursive: true }); fs.mkdirSync(workspace, { recursive: true });
    fs.mkdirSync(path.join(root, "user-data/User"), { recursive: true }); fs.mkdirSync(path.join(root, "extensions"), { recursive: true });
    fs.mkdirSync(path.join(home, ".sinitek_cli"), { recursive: true }); fs.mkdirSync(path.join(home, ".codex"), { recursive: true });
    fs.writeFileSync(path.join(home, ".sinitek_cli/settings.json"), JSON.stringify({
      debug: true, humanInteractionEnabled: false, cliEnabledByName: { codex: true, claude: false, opencode: Object.values(report.roles).includes("opencode"), grok: false, dsh: false, "kimi-code": false, zcode: false } }), { flag: "wx" });
    const coldRequestEvidence = path.join(root, "cold-provider-requests.ndjson");
    responses = createLocalResponsesServer({ maxRequests: 32, respond: scenario.respond, summarizeRequest: scenario.summarizeRequest,
      ...(input.scenario === "cold-start" ? { onRequest: (index, record) => fs.appendFileSync(coldRequestEvidence,
        JSON.stringify({ index, responseId: record.responseId, at: record.at }) + "\n", { mode: 0o600 }) } : {}) });
    await new Promise((resolve, reject) => responses.server.once("error", reject).listen(0, "127.0.0.1", resolve));
    const providerPort = responses.server.address().port;
    const localConfig = `model = "gpt-5"
model_provider = "sinetik_local"
approval_policy = "never"
sandbox_mode = "danger-full-access"
[model_providers.sinetik_local]
name = "Isolated local protocol fixture"
base_url = "http://127.0.0.1:${providerPort}/v1"
wire_api = "responses"
requires_openai_auth = false
`;
    fs.writeFileSync(path.join(home, ".codex/config.toml"), localConfig, { flag: "wx" });
    const profileDir = path.join(home, ".codex", "__config");
    fs.mkdirSync(profileDir, { recursive: true });
    const now = Date.now();
    fs.writeFileSync(path.join(profileDir, "codex-local.json"), JSON.stringify({ id: "codex-local", name: "隔离本机 Responses", platform: "codex",
      content: localConfig, configContent: localConfig, authContent: "{}", codexSkills: [], createdAt: now, updatedAt: now }, null, 2), { flag: "wx" });
    fs.writeFileSync(path.join(profileDir, "config-order.json"), JSON.stringify({ codex: ["codex-local"] }, null, 2), { flag: "wx" });
    if (Object.values(report.roles).includes("opencode")) {
      const lookup = cp.spawnSync(process.platform === "win32" ? "where.exe" : "which", ["opencode"], { encoding: "utf8", env });
      const binary = process.env.SINITEK_OPENCODE_EXE || lookup.stdout.trim().split(/\r?\n/)[0];
      assert.ok(binary && fs.existsSync(binary), "OpenCode CLI not found; set SINITEK_OPENCODE_EXE");
      const probe = cp.spawnSync(binary, ["--version"], { encoding: "utf8", env, timeout: 10000 });
      assert.equal(probe.status, 0, probe.stderr);
      report.opencode = { executable: binary, version: probe.stdout.trim(), binarySha256: crypto.createHash("sha256").update(fs.readFileSync(fs.realpathSync(binary))).digest("hex") };
      openCodeProvider = createOpenCodeLocalProvider({ maxRequests: 32, respond: scenario.respondChat });
      const baseURL = await openCodeProvider.listen();
      const configContent = JSON.stringify({ enabled_providers: ["isolated"], model: "isolated/native-drain", small_model: "isolated/native-drain",
        share: "disabled", autoupdate: false, compaction: { auto: false, prune: false }, permission: { "*": "deny" },
        provider: { isolated: { npm: "@ai-sdk/openai-compatible", name: "Free loopback department verifier", options: { baseURL, apiKey: "isolated-free-provider" },
          models: { "native-drain": { name: "Deterministic production protocol", limit: { context: 131072, output: 8192 } } } } } });
      const directory = path.join(home, ".opencode", "__config");
      fs.mkdirSync(directory, { recursive: true });
      fs.writeFileSync(path.join(home, ".opencode/config.json"), configContent, { flag: "wx" });
      fs.writeFileSync(path.join(directory, "opencode-local.json"), JSON.stringify({ id: "opencode-local", name: "隔离本机 Chat Completions", platform: "opencode",
        content: configContent, configContent, createdAt: now, updatedAt: now }), { flag: "wx" });
      fs.writeFileSync(path.join(directory, "config-order.json"), JSON.stringify({ opencode: ["opencode-local"] }), { flag: "wx" });
      report.openCodeProvider = { baseURL, maxRequests: openCodeProvider.maxRequests, protocol: "chat-completions" };
    }
    const workspaceKey = `${path.basename(workspace).replace(/[^a-zA-Z0-9-_]/g, "_").slice(0, 32)}_${crypto.createHash("sha256").update(workspace).digest("hex").slice(0, 12)}`;
    const workspaceSettings = path.join(home, ".sinitek_cli", "workspace-settings");
    fs.mkdirSync(workspaceSettings, { recursive: true });
    fs.writeFileSync(path.join(workspaceSettings, `${workspaceKey}.json`), JSON.stringify({ currentCli: "codex", interactiveModeByCli: { codex: "coding" },
      activeConfigIdByCli: { codex: "codex-local" } }, null, 2), { flag: "wx" });
    report.localProvider = { bind: "127.0.0.1", port: providerPort, maxRequests: responses.maxRequests };
    report.stages.prerequisites = "passed";
    assert.equal(fs.readdirSync(path.join(home, ".sinitek_cli")).includes("department-tasks-v1"), false, "task store starts empty");
    report.stages.emptyStore = "passed";
    report.driverExecution = { executedPath: fs.realpathSync(__filename), executedSha256: crypto.createHash("sha256").update(fs.readFileSync(__filename)).digest("hex") };
    const productDriver = path.join(product, "scripts/verify_department_full_eh_integration.js");
    report.driverExecution.productPath = productDriver;
    report.driverExecution.productSha256 = fs.existsSync(productDriver) ? crypto.createHash("sha256").update(fs.readFileSync(productDriver)).digest("hex") : null;
    report.productSourceHashes = Object.fromEntries(["src/extension.ts", "src/departmentConfiguration.ts", "src/extensionHost/departmentConfigurationHost.ts", "src/extensionHost/modelSettings.ts", "src/extensionHost/departmentruntimecomposition.ts",
      "src/extensionHost/departmentorchestration.ts", "src/runtime/departmentexecutionowner.ts", "src/runtime/departmentprocessownerworker.ts", "src/extensionHost/departmentprocesspreparation.ts", "src/extensionHost/promptInteractiveRuntime.ts",
      "src/test/extensionHost/fixtures/departmentfullehproductionhost.ts", "src/test/extensionHost/fixtures/departmentcoldstartproductionhost.ts", "scripts/verify_department_full_eh_integration.js",
      "scripts/fixtures/department_full_eh_scenario.js", "scripts/fixtures/department_cold_start_eh_scenario.js",
      "scripts/fixtures/department_continuation_eh_scenario.js", "scripts/fixtures/department_successive_continuation_eh_scenario.js",
      "scripts/fixtures/department_successive_continuation_ui.js", "scripts/fixtures/opencode_local_provider_server.js"].map((name) => [name,
      crypto.createHash("sha256").update(fs.readFileSync(path.join(product, name))).digest("hex")]));
    const extensionTestPath = writeExtensionHostEntry(product, root, { coldStart: input.scenario === "cold-start", coldRecovery: input.scenario === "cold-recovery",
      longToolOutput: input.scenario === "codex-long-tool-output" });
    const userSettings = { "workbench.startupEditor": "none", "security.workspace.trust.enabled": false,
      "extensions.autoCheckUpdates": false, "extensions.autoUpdate": false, "update.mode": "none", "telemetry.telemetryLevel": "off",
      "window.restoreWindows": "none", "sinitek-cli-tools.autoOpenPanel": false, "sinitek-cli-tools.humanInteractionNotifications": false,
      "sinitek-cli-tools.commands.codex": codex, "sinitek-cli-tools.args.codex": ["--dangerously-bypass-approvals-and-sandbox", "--sandbox", "danger-full-access"] };
    if (report.opencode) {
      userSettings["sinitek-cli-tools.commands.opencode"] = report.opencode.executable;
      userSettings["sinitek-cli-tools.args.opencode"] = ["--pure"];
    }
    fs.writeFileSync(path.join(root, "user-data/User/settings.json"), JSON.stringify(userSettings, null, 2), { flag: "wx" });

    const args = ["--new-window", "--skip-welcome", "--skip-release-notes", "--disable-updates", "--disable-telemetry", "--disable-workspace-trust", "--verbose",
      "--use-inmemory-secretstorage", `--remote-debugging-port=${port}`, "--remote-allow-origins=*", `--user-data-dir=${path.join(root, "user-data")}`,
      `--extensions-dir=${path.join(root, "extensions")}`, `--extensionDevelopmentPath=${product}`, `--extensionTestsPath=${extensionTestPath}`, workspace];
    const logPath = path.join(root, "vscode.log");
    const logFd = fs.openSync(logPath, "w");
    if (input.scenario === "cold-recovery") workerExitObserver = startColdWorkerExitObserver(root, positiveDeadline);
    child = cp.spawn(code, args, { env, detached: process.platform !== "win32", stdio: ["ignore", logFd, logFd], windowsHide: true });
    fs.closeSync(logFd);
    report.vscodeLog = logPath;
    child.once("exit", (exitCode, signal) => { exited = true; report.hostExit = { exitCode, signal }; });
    child.once("error", (error) => { exited = true; report.hostSpawnError = error.message; });
    const hostReady = path.join(root, "host-ready.json");
    const deadline = positiveEvidenceDeadline ?? Date.now() + timeoutMs;
    while (!exited && Date.now() < deadline && !fs.existsSync(hostReady)) await sleep(200);
    assert.ok(fs.existsSync(hostReady), `Extension Host did not become ready: ${JSON.stringify(report.hostSpawnError || report.hostExit)}`);
    report.extensionHost = JSON.parse(fs.readFileSync(hostReady, "utf8"));
    report.stages.extensionHost = "passed";
    await waitForDebugger(port, Math.min(deadline, Date.now() + 30000));
    await drivePublicEntry(root, port, prompt, report, { ...input, deadline: positiveEvidenceDeadline });
    report.stages.publicUi = "passed";
    const taskStore = report.isolated.taskStore;
    const taskDeadline = positiveEvidenceDeadline ?? Date.now() + timeoutMs;
    let records = [];
    while (Date.now() < taskDeadline) {
      if (fs.existsSync(taskStore)) {
        records = fs.readdirSync(taskStore).filter((name) => name.endsWith(".json") && !name.startsWith("."));
        if (records.length) break;
      }
      openCodeProvider?.assertHealthy();
      if (responses.failures.length) throw new Error(`local Responses stage failed: ${JSON.stringify(responses.failures)}`);
      if (exited) break;
      await sleep(250);
    }
    if (!records.length) {
      const storeContents = fs.existsSync(taskStore) ? fs.readdirSync(taskStore).map((name) => {
        const file = path.join(taskStore, name);
        return { name, directory: fs.statSync(file).isDirectory(),
          json: fs.statSync(file).isFile() && name.endsWith(".json") ? (() => { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; } })() : undefined };
      }) : [];
      report.rootCreationEvidence = { taskStoreExists: fs.existsSync(taskStore), storeContents,
        workspaceSettings: (() => { const dir = path.join(home, ".sinitek_cli", "workspace-settings");
          return fs.existsSync(dir) ? fs.readdirSync(dir).map((name) => ({ name, content: fs.readFileSync(path.join(dir, name), "utf8") })) : []; })(),
        responsesRequested: responses.requests.length };
      throw new Error(`public sendPrompt did not persist a runtime-generated department root; post-submit UI=${JSON.stringify(report.publicUi.afterSend)}; browserErrors=${JSON.stringify(report.publicUi.browserErrors)}`);
    }
    report.stages.rootCreation = "observed";
    report.activePhase = "directorExecution";
    report.taskFiles = records;
    report.rootTaskSnapshots = records.map((name) => {
      const file = path.join(taskStore, name);
      try { return { file: name, record: JSON.parse(fs.readFileSync(file, "utf8")) }; }
      catch (error) { return { file: name, parseError: String(error) }; }
    });
    if (input.scenario === "cold-recovery") {
      report.coldRecovery = { snapshots: {}, deadline: positiveDeadline, evidenceDeadline: positiveEvidenceDeadline };
      // Keep established finally ownership/exit accounting for the second host.
      report.coldStart = { purpose: "positive-second-host-exit-accounting" };
      const evidence = report.coldRecovery;
      const healthy = () => {
        openCodeProvider?.assertHealthy();
        assert.equal(responses.failures.length, 0, JSON.stringify(responses.failures));
        const failure = readJson(path.join(root, "cold-positive-failure.json"));
        if (failure) throw new Error(`second EH ${failure.phase}: ${failure.error}`);
      };
      const wait = async (phase, check) => {
        report.activePhase = phase;
        while (Date.now() < positiveEvidenceDeadline) {
          healthy();
          if (phase === "originalFullReceiptBoundary") {
            const failed = readTasks().find(task => task.department?.role === "leader" && task.mainAiLastFailureMessage);
            if (failed) throw new Error("original EH production rejection: " + failed.mainAiLastFailureMessage);
          }
          if (phase === "successorRealNativeRequest") {
            const current = { tasks: readTasks(), runtime: readRuntime(scenario.snapshot().rootId) };
            evidence.latestSuccessor = current;
            assertColdSuccessorNotRejected(current.tasks, current.runtime, evidence.snapshots.beforeExit.runtime.leaderExecutionSets[0].scope.generation);
          }
          const value = await check(); if (value) return value;
          const publicState = readJson(path.join(root, "cold-positive-observer.json"));
          if (publicState?.warnings?.length) throw new Error(`public cold control rejected: ${JSON.stringify(publicState.warnings)}`);
          await sleep(50);
        }
        throw new Error(`cold recovery absolute deadline: ${phase}`);
      };
      const snapshot = () => ({ tasks: readTasks(), runtime: readRuntime(scenario.snapshot().rootId) });
      const first = await wait("originalFullReceiptBoundary", () => readJson(path.join(root, "cold-first-original-cleanup.json")));
      const rootId = scenario.snapshot().rootId;
      assert.equal(first.taskId, scenario.snapshot().employees[0].leaderTaskId);
      evidence.snapshots.beforeExit = snapshot();
      const original = evidence.snapshots.beforeExit.runtime;
      assert.equal(original.executionBindings.length, 2, "original leader and employee set required");
      assert.equal(original.leaderExecutionSets.length, 1);
      const originalSet = original.leaderExecutionSets[0];
      assert.equal(originalSet.state, "closed"); assert.ok(originalSet.closure);
      assert.equal(originalSet.entries.length, 2);
      assert.equal(original.capacity.leaders.length, 1, "first host consumed the leader lease before handoff");
      const originalCleanup = await inspectCleanup(rootId, "stopped");
      assert.ok(originalCleanup.observations.every(o => o.status === "cleaned"), "original full receipt observation missing");
      evidence.originalReceipts = originalCleanup.observations;
      const readOriginalProtocol = () => fs.readFileSync(path.join(root, "original-owner-protocol.ndjson"), "utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line));
      if (input.leaderCli === "opencode") {
        evidence.originalNativeFacts = readOpenCodeNativeFacts(root, original.executionBindings, readOriginalProtocol());
        assert.equal(evidence.originalNativeFacts.length, 1);
        assert.equal(evidence.originalNativeFacts[0].directoryRemoved, true, "original canonical directory was not retired");
      }
      const { DepartmentGenerationAuthorityClient } = require(path.join(product, "dist/runtime/departmentgenerationauthorityclient.js"));
      const { departmentGenerationAuthorityDirectory, departmentGenerationAuthorityEndpoint } = require(path.join(product, "dist/runtime/departmentgenerationauthority.js"));
      const originalDirectory = departmentGenerationAuthorityDirectory(path.join(home, ".sinitek_cli/department-generation-authorities"), originalSet.scope);
      evidence.originalAuthorityBeforeExit = await new DepartmentGenerationAuthorityClient(originalDirectory, originalSet.scope, originalSet.producerId).observe();
      assert.ok(evidence.originalAuthorityBeforeExit.tickets.every(t => t.state === "released"));
      evidence.providerCountBeforeExit = responses.requests.length + (openCodeProvider?.requests.length ?? 0);
      fs.writeFileSync(path.join(root, "host-finish.signal"), "original-receipts-real-consumption-delayed\n", { flag: "wx" });
      await wait("firstHostNaturalExit", () => exited);
      assert.deepEqual(report.hostExit, { exitCode: 0, signal: null });
      evidence.snapshots.afterExit = snapshot();
      assert.deepEqual(evidence.snapshots.afterExit, evidence.snapshots.beforeExit, "first EH exit mutated retained identity/capacity");
      const secondPort = await freePort();
      const secondEntry = path.join(root, "cold-positive-second-host.js");
      const { createDepartmentColdRecoverySecondEntry } = require(path.join(product, "dist/test/extensionHost/fixtures/departmentcoldrecoveryehhost.js"));
      fs.writeFileSync(secondEntry, createDepartmentColdRecoverySecondEntry({ root, home, rootTaskId: rootId, deadline: positiveDeadline }), { flag: "wx" });
      const secondArgs = args.map(arg => arg.startsWith("--remote-debugging-port=") ? `--remote-debugging-port=${secondPort}`
        : arg.startsWith("--extensionTestsPath=") ? `--extensionTestsPath=${secondEntry}` : arg);
      const secondLog = path.join(root, "cold-positive-second-vscode.log"), fd = fs.openSync(secondLog, "wx");
      secondChild = cp.spawn(code, secondArgs, { env, detached: process.platform !== "win32", stdio: ["ignore", fd, fd], windowsHide: true }); fs.closeSync(fd);
      let secondExited = false;
      secondChild.once("exit", (exitCode, signal) => { secondExited = true; report.coldStart.secondHostExit = { exitCode, signal }; });
      secondChild.once("error", error => { secondExited = true; report.coldStart.spawnError = error.message; });
      await wait("secondHostSessionManagerActivation", () => readJson(path.join(root, "cold-positive-ready.json")));
      const capture = async phase => {
        fs.writeFileSync(path.join(root, `cold-positive-capture-${phase}`), "capture\n", { flag: "wx" });
        const value = await wait(phase, () => readJson(path.join(root, `cold-positive-${phase}.json`)));
        evidence.snapshots[phase] = value; return value;
      };
      for (const phase of ["beforeActivation", "afterActivation"]) {
        evidence.snapshots[phase] = readJson(path.join(root, `cold-positive-${phase}.json`));
        assert.deepEqual(evidence.snapshots[phase], evidence.snapshots.afterExit, `${phase} mutated original identity`);
      }
      await capture("beforeControl");
      const providerCount = responses.requests.length + (openCodeProvider?.requests.length ?? 0);
      assert.equal(providerCount, evidence.providerCountBeforeExit, "activation replayed a prompt");
      const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "/tmp/zq-playwright-smoke/node_modules/playwright");
      let browser, adapter, businessFailure;
      const diagnostics = evidence.cdpCleanup = [];
      const control = async (action) => {
        await clickColdPublicControl(adapter, `#panelActions [data-action="${action}"]`, positiveEvidenceDeadline);
      };
      const delivered = async (type, count) => wait(`public-${type}-delivery-${count}`, () => {
        const observation = readJson(path.join(root, "cold-positive-observer.json"));
        if (!observation) return null;
        assert.equal(observation.errors.length, 0); assert.equal(observation.warnings.length, 0);
        const matches = observation.messages.filter(m => m.type === `loopGroupChatChat:${type}`);
        assert.ok(matches.every(m => m.rootTaskId === rootId), "foreign public root message");
        assert.ok(matches.length <= count, "duplicate public control message");
        return matches.length === count && observation;
      });
      await settleColdPublicControl(async () => { try {
        browser = await withinColdDeadline(() => chromium.connectOverCDP(`http://127.0.0.1:${secondPort}`, { timeout: coldRemaining(positiveEvidenceDeadline) }), positiveEvidenceDeadline, "positive CDP", late => late.close());
        adapter = await createDepartmentWebviewAdapter(browser, "webviewPanel", coldRemaining(positiveEvidenceDeadline),
          { rootId, deadline: positiveEvidenceDeadline, cleanupDeadline: positiveDeadline, diagnostics });
        await control("stopTask"); await delivered("stopTask", 1);
        const cleanup = await wait("coldOriginalCLOSEDAndDurableCapacityReturn", async () => {
          const value = await inspectCleanup(rootId, "stopped"); return value.complete ? value : null;
        });
        evidence.originalStopped = cleanup;
        const afterControl = await capture("afterControl");
        assert.deepEqual(afterControl.runtime.executionBindings, original.executionBindings);
        assert.deepEqual(afterControl.runtime.leaderExecutionSets, original.leaderExecutionSets);
        assert.equal(fs.existsSync(path.join(originalDirectory, "authority.lock")), false, "original service did not retire its lock");
        if (process.platform !== "win32") assert.equal(fs.existsSync(departmentGenerationAuthorityEndpoint(originalDirectory)), false, "original service endpoint remains");
        evidence.originalAuthorityRetirementConfirmed = true;
        await wait("originalAuthorityNaturalExit", () => {
          const observation = workerExitObserver.snapshot();
          if (observation.errors.length) throw new Error(observation.errors.join(","));
          const exits = observation.events.filter(e => e.event === "kernel-worker-exit" && e.worker === "departmentgenerationauthorityworker.js"
            && e.producerId === originalSet.producerId && Object.entries(originalSet.scope).every(([key, value]) => e.identity[key] === value));
          if (!exits.length) return false;
          assert.equal(exits.length, 1); assert.equal(exits[0].code, 0); assert.equal(exits[0].signal, null);
          evidence.originalAuthorityNaturalExit = exits[0]; return true;
        });
        assert.equal(responses.requests.length + (openCodeProvider?.requests.length ?? 0), providerCount, "activation/stop replayed prompt");
        const beforeContinue = readJson(path.join(root, "cold-positive-observer.json"));
        assert.equal(beforeContinue.protocol.length, 0, "stop granted or forked a successor before explicit continue");
        const continuationPrompt = scenario.beginContinue(cleanup);
        await control("continueTask");
        await adapter.locator("#continueDialogInput").fill(continuationPrompt);
        await clickColdPublicControl(adapter, "#continueDialogConfirm", positiveEvidenceDeadline);
        await delivered("continueTask", 1);
        await wait("successorRealNativeRequest", () => scenario.snapshot().coldRecovery.successor);
        const next = await capture("afterContinue");
        const oldLeader = original.executionBindings.find(b => b.identity.role === "leader");
        const newBindings = next.runtime.executionBindings.filter(b => !original.executionBindings.some(old => old.identity.executionId === b.identity.executionId));
        assert.equal(newBindings.length, 1, "one unique successor leader required");
        const successor = newBindings[0];
        assert.notEqual(successor.identity.ownerId, oldLeader.identity.ownerId);
        assert.notEqual(successor.identity.executionId, oldLeader.identity.executionId);
        assert.ok(successor.identity.generation > oldLeader.identity.generation);
        assert.deepEqual(successor.identity.session, oldLeader.identity.session);
        assert.deepEqual(successor.selection, oldLeader.selection); assert.deepEqual(successor.requirements, oldLeader.requirements);
        const oldTask = evidence.snapshots.beforeExit.tasks.find(t => t.id === first.taskId), newTask = next.tasks.find(t => t.id === first.taskId);
        assert.equal(newTask.sessionId, oldTask.sessionId); assert.deepEqual(newTask.executionSession, oldTask.executionSession);
        assert.notEqual(newTask.sessionId, newTask.executionSession.sessionId);
        evidence.successor = successor;
        if (successor.identity.cli === "opencode") {
          const observation = readJson(path.join(root, "cold-positive-observer.json"));
          const preparations = observation.nativePreparations.filter(event => event.retired?.identity?.executionId === oldLeader.identity.executionId
            && event.sessionId === successor.identity.session.id);
          assert.equal(preparations.length, 1, "exactly one OpenCode successor preparation/move required");
          const preparation = preparations[0];
          assert.deepEqual(preparation.retired?.identity, oldLeader.identity);
          assert.deepEqual(preparation.retired?.selection, oldLeader.selection);
          assert.equal(preparation.retired?.directory, evidence.originalNativeFacts[0].canonicalDirectory);
          const native = readOpenCodeNativeFacts(root, [successor], observation.protocol)[0];
          assert.notEqual(native.canonicalDirectory, preparation.retired.directory);
          assert.equal(native.canonicalDirectory, preparation.directory, "prepared root differs from actual successor root");
          assert.equal(native.session.id, oldLeader.identity.session.id);
          assert.equal(native.session.directory, native.canonicalDirectory, "move-session native readback failed");
          evidence.openCodeMove = { preparation, native };
        }
        await control("stopTask"); await delivered("stopTask", 2); scenario.releaseAll();
        evidence.finalCleanup = await wait("successorFullCleanupAndCapacityReturn", async () => {
          const value = await inspectCleanup(rootId, "stopped", next.runtime.leaderExecutionSets); return value.complete ? value : null;
        });
        await capture("afterFinalStop");
        evidence.observer = await delivered("stopTask", 2);
        const successorSet = next.runtime.leaderExecutionSets.find(set => set.scope.generation === successor.identity.generation);
        await wait("originalAndSuccessorNaturalWorkerExits", () => {
          evidence.workerExitObservation = workerExitObserver.snapshot();
          try { evidence.naturalWorkerExits = requireColdWorkerExits(evidence.workerExitObservation, originalSet, successorSet, successor); return true; }
          catch (error) {
            if (evidence.workerExitObservation.errors.length) throw error;
            evidence.pendingWorkerExit = error.message; return false;
          }
        });
        delete evidence.pendingWorkerExit;
        report.stages.ownerReceipts = "passed"; report.stages.capacityReturn = "passed";
      } catch (error) {
        businessFailure = error;
        evidence.firstFailure = { stage: report.activePhase, message: String(error?.message ?? error) };
        evidence.failureSnapshot = snapshot();
        evidence.observer = readJson(path.join(root, "cold-positive-observer.json"));
        throw error;
      } finally {
        scenario.releaseAll();
        if (adapter) await cleanupCdpResource(() => adapter.close(), positiveDeadline, "positive root adapter close", diagnostics);
        if (browser) await cleanupCdpResource(() => browser.close(), positiveDeadline, "positive browser close", diagnostics);
        fs.writeFileSync(path.join(root, "cold-positive-finish.signal"), "owned-cdp-released\n", { flag: "wx" });
        if (!businessFailure) assertCdpCleanup(diagnostics, "positive cold");
      } }, () => secondExited, positiveDeadline);
      while (!secondExited && Date.now() < positiveDeadline) await sleep(50);
      assert.deepEqual(report.coldStart.secondHostExit, { exitCode: 0, signal: null }, "second EH did not naturally exit");
      evidence.result = "passed"; report.activePhase = "coldRecoveryComplete";
      return;
    }
    if (input.scenario === "cold-start") {
      report.activePhase = "firstHostActiveBinding";
      const activeDeadline = Date.now() + timeoutMs;
      let activeIdentity;
      while (Date.now() < activeDeadline && !exited && !activeIdentity) {
        activeIdentity = scenario.waitForHeldEmployee ? await Promise.race([scenario.waitForHeldEmployee(), sleep(100).then(() => null)]) : null;
        if (!activeIdentity) { responses.assertHealthy(); await sleep(100); }
      }
      assert.ok(activeIdentity, "publicly created employee never reached the held local-provider request");
      const activeRoot = scenario.snapshot().rootId;
      const beforeRestartTasks = readTasks(), rootTask = beforeRestartTasks.find(value => value.id === activeRoot);
      const runtimeBeforeRestart = readRuntime(activeRoot);
      assert.ok(rootTask && rootTask.department?.executionMode === "loop-plus" && rootTask.department.role === "director"
        && rootTask.status === "running", "cold-start root is not an active production Loop+ director");
      const activeLeader = beforeRestartTasks.find(value => value.id === activeIdentity.leaderTaskId);
      assert.ok(activeLeader?.department?.executionMode === "loop-plus" && activeLeader.department.role === "leader"
        && activeLeader.department.rootTaskId === activeRoot && activeLeader.status === "running", "held attempt leader is not a running Loop+ child");
      assert.deepEqual(rootTask.department.routes, activeLeader.department.routes, "root/leader frozen routes differ before host exit");
      const loopPlusMember = runtimeBeforeRestart.runtime.leaders.find(member => member.taskId === activeLeader.id
        && member.leaderSubtaskId === activeLeader.department.leaderSubtaskId && member.status === "running");
      assert.ok(loopPlusMember, "held Loop+ attempt has no matching durable running runtime member");
      assert.equal(rootTask.subTasks.find(module => module.id === loopPlusMember.leaderSubtaskId)?.status, "running");
      const activeEmployee = activeLeader.subTasks.find(task => task.id === activeIdentity.subtaskId);
      assert.ok(activeEmployee?.status === "running" && activeEmployee.communicationFile === activeIdentity.reportFile,
        "held provider request does not map to its exact running Loop+ employee task");
      const runningAttempts = activeLeader.loopPlus?.running.filter(attempt => attempt.subtaskId === activeIdentity.subtaskId) ?? [];
      assert.equal(runningAttempts.length, 1, "held Loop+ scheduler attempt is missing or ambiguous");
      assert.equal(runningAttempts[0].attemptId, activeIdentity.attemptId, "provider request differs from the persisted Loop+ scheduler attempt");
      const capacityKey = JSON.stringify([activeLeader.id, activeIdentity.attemptId]);
      assert.ok(runtimeBeforeRestart.capacity.leaders.includes(loopPlusMember.leaderSubtaskId), "held Loop+ leader has no matching capacity");
      assert.ok(runtimeBeforeRestart.capacity.employees.includes(capacityKey), "held Loop+ attempt has no matching capacity");
      assert.deepEqual(runtimeBeforeRestart.capacity.employeeOverflow ?? [], [], "simple held attempt unexpectedly overflows employee capacity");
      report.coldStart = { trigger: "normal VS Code process exit while the real Loop+ employee Responses request remains pending",
        firstHost: { rootTask: structuredClone(rootTask), leader: structuredClone(activeLeader),
        beforeRestart: { rootTask: structuredClone(rootTask), leader: structuredClone(activeLeader), tasks: structuredClone(beforeRestartTasks),
            runtime: structuredClone(runtimeBeforeRestart), loopPlusAttempt: { leaderTaskId: activeLeader.id, subtaskId: activeIdentity.subtaskId,
              attemptId: activeIdentity.attemptId, reportFile: activeIdentity.reportFile, member: structuredClone(loopPlusMember),
              schedulerAttempt: structuredClone(runningAttempts[0]), capacityKey } },
          activeIdentity,
          sourceMarkerBeforeExit: readJson(path.join(home, ".sinitek_cli/department-tasks-v1/.department-source.json")),
          ownerMarkerBeforeExit: readJson(path.join(home, ".sinitek_cli/department-tasks-v1/.department-owner.json")),
          capacity: runtimeBeforeRestart.capacity, sourceMarker: fs.existsSync(path.join(home, ".sinitek_cli/department-tasks-v1/.department-source.json")),
          ownerMarker: fs.existsSync(path.join(home, ".sinitek_cli/department-tasks-v1/.department-owner.json")),
          providerRequestCount: responses.requests.length, modelRequestStages: scenario.history.map(entry => entry.stage) } };
      report.stages.firstHostActiveBinding = "observed";
      fs.writeFileSync(path.join(root, "host-finish.signal"), "cold-restart-trigger\n", { flag: "wx" });
      const firstExitDeadline = Date.now() + timeoutMs;
      while (!exited && Date.now() < firstExitDeadline) await sleep(100);
      assert.ok(exited && report.hostExit?.exitCode === 0 && !report.hostExit?.signal, "first VS Code process did not exit normally for cold restart");
      report.coldStart.firstHostExit = report.hostExit;
      report.coldStart.providerRequestCountAfterExit = responses.requests.length;
      report.coldStart.postExitSourceMarker = fs.existsSync(path.join(home, ".sinitek_cli/department-tasks-v1/.department-source.json"));
      report.coldStart.postExitOwnerMarker = fs.existsSync(path.join(home, ".sinitek_cli/department-tasks-v1/.department-owner.json"));
      report.coldStart.postExitSourceMarkerValue = readJson(path.join(home, ".sinitek_cli/department-tasks-v1/.department-source.json"));
      report.coldStart.postExitOwnerMarkerValue = readJson(path.join(home, ".sinitek_cli/department-tasks-v1/.department-owner.json"));
      report.coldStart.postExitRuntime = readRuntime(activeRoot);
      report.coldStart.firstHost.postExitTasks = readTasks();
      report.coldStart.firstHost.postExitRuntime = report.coldStart.postExitRuntime;

      const { createColdDeadlinePlan } = require(path.join(product, "dist/test/extensionHost/fixtures/departmentcoldstartproductionhost.js"));
      const coldDeadlines = createColdDeadlinePlan(Date.now(), timeoutMs);
      report.coldStart.deadlines = coldDeadlines;
      const secondPort = await freePort(), secondEntry = writeColdSecondHostEntry(product, root, home, activeRoot, coldDeadlines,
        report.coldStart.firstHost.beforeRestart.loopPlusAttempt);
      const secondArgs = args.filter(value => !value.startsWith("--remote-debugging-port=") && !value.startsWith("--extensionTestsPath="));
      secondArgs.splice(1, 0, `--remote-debugging-port=${secondPort}`);
      secondArgs.push(`--extensionTestsPath=${secondEntry}`);
      let secondExited = false;
      const secondLog = path.join(root, "vscode-second.log"), secondFd = fs.openSync(secondLog, "w");
      secondChild = cp.spawn(code, secondArgs, { env, detached: process.platform !== "win32", stdio: ["ignore", secondFd, secondFd], windowsHide: true });
      fs.closeSync(secondFd);
      secondChild.once("exit", (exitCode, signal) => { secondExited = true; report.coldStart.secondHostExit = { exitCode, signal }; });
      secondChild.once("error", error => { secondExited = true; report.coldStart.secondHostSpawnError = error.message; });
      const secondDeadline = coldDeadlines.hostDeadline;
      while (!secondExited && Date.now() < coldDeadlines.actionDeadline && !fs.existsSync(path.join(root, "cold-second-host-ready.json"))) {
        assertColdHostObservation(root);
        await sleep(100);
      }
      assertColdHostObservation(root);
      assert.ok(fs.existsSync(path.join(root, "cold-second-host-ready.json")), `second EH did not reach the public recovery control: ${report.coldStart.secondHostSpawnError || "deadline"}`);
      report.activePhase = "coldSecondHostPublicControl";
      try { await settleColdPublicControl(() => driveColdProductionRecoveryCheck(secondPort, activeRoot, root, coldDeadlines,
        { initialProviderRequestCount: report.coldStart.providerRequestCountAfterExit }),
        () => secondExited, secondDeadline); }
      finally {
        report.coldStart.cdpCleanup = readJson(path.join(root, "cold-cdp-cleanup.json"));
        report.coldStart.secondHostFailure = readJson(path.join(root, "cold-second-host-failure.json"));
        report.coldStart.publicObserver = readJson(path.join(root, "cold-public-observer.json"));
      }
      report.coldStart.secondHostUi = readJson(path.join(root, "cold-second-host-ui.json"));
      assert.ok(report.coldStart.secondHostUi, "cold second host did not record its actual Webview projection before Stop");
      assert.match(report.coldStart.secondHostUi.taskPanel, /本宿主执行已中断/);
      assertColdUiDepartmentRoster(report.coldStart.secondHostUi.rosterPanel);
      assert.match(report.coldStart.secondHostUi.actions, /仍有原执行退出未确认/);
      assert.equal(report.coldStart.secondHostUi.stopEnabled, true);
      assert.equal(report.coldStart.secondHostUi.continueDisabled, true);
      report.activePhase = "coldSecondHostEvidence";
      while (!secondExited && Date.now() < coldDeadlines.evidenceDeadline && !fs.existsSync(path.join(root, "cold-second-host.json"))) await sleep(100);
      assert.ok(fs.existsSync(path.join(root, "cold-second-host.json")), "second EH did not write its bounded cold recovery observation");
      while (!secondExited && Date.now() < secondDeadline) await sleep(100);
      assert.ok(secondExited && report.coldStart.secondHostExit?.exitCode === 0 && !report.coldStart.secondHostExit.signal, "second VS Code process did not exit normally");
      report.coldStart.secondHost = JSON.parse(fs.readFileSync(path.join(root, "cold-second-host.json"), "utf8"));
      report.coldStart.providerRequestCountAfterSecondHost = responses.requests.length;
      assert.equal(responses.requests.length, report.coldStart.providerRequestCountAfterExit, "second EH replayed or newly dispatched a model request");
      report.coldStart.classification = classifyColdStartRecovery(report.coldStart.secondHost);
      const heldLoopPlusAttempt = report.coldStart.firstHost.beforeRestart.loopPlusAttempt;
      if (heldLoopPlusAttempt) {
        assert.equal(report.coldStart.secondHost.loopPlusAttempt.attempt.attemptId, heldLoopPlusAttempt.schedulerAttempt.attemptId,
          "second EH did not read the exact persisted Loop+ scheduler attempt");
        assert.equal(report.coldStart.secondHost.loopPlusAttempt.capacityKey, heldLoopPlusAttempt.capacityKey);
        assert.deepEqual(report.coldStart.secondHost.beforeActivation.roots.find(item => item.id === report.coldStart.firstHost.rootTask.id).runtime.capacity,
          report.coldStart.firstHost.beforeRestart.runtime.capacity, "cold observation changed retained Loop+ capacity");
        report.coldStart.crossHostLoopPlusAttempt = { schedulerAttempt: report.coldStart.secondHost.loopPlusAttempt.attempt,
          capacityKey: report.coldStart.secondHost.loopPlusAttempt.capacityKey };
      } else {
        report.coldStart.crossHostIdentity = assertColdRestartIdentity(report.coldStart.firstHost, report.coldStart.secondHost, sameExecution);
      }
      assert.deepEqual(report.coldStart.secondHost.afterActivation.tasks, report.coldStart.secondHost.beforeActivation.tasks,
        "cold observation changed persisted task records");
      assert.deepEqual(report.coldStart.secondHost.afterActivation.roots, report.coldStart.secondHost.beforeActivation.roots,
        "cold observation changed runtime generation/capacity state");
      assert.deepEqual(report.coldStart.secondHost.afterControl.roots, report.coldStart.secondHost.beforeControl.roots,
        "explicit cold Stop changed runtime generation/capacity despite unconfirmed cleanup");
      const explicitlyStoppedRoot = report.coldStart.secondHost.afterControl.tasks.find(task => task.id === activeRoot);
      assert.equal(explicitlyStoppedRoot?.status, "stopped", "explicit Stop did not persist its user-requested stopped root status");
      report.stages.secondHostObservation = "observed";
      assert.equal(report.coldStart.secondHost.productionRecovery.observed, true, "public organization-control rejection was not observed");
      assert.equal(report.coldStart.secondHost.productionRecovery.reason, "live-leader-unverifiable");
      report.stages.ownerReceipts = "not-applicable-read-only-only";
      report.stages.capacityReturn = "not-applicable-observation-does-not-release";
      report.stages.result = "bounded-cold-observation-complete";
      report.activePhase = "coldStartComplete";
      report.coldStart.secondHostLog = secondLog;
      report.coldStart.noAutomaticPromptReplay = true;
      report.coldStart.noNewGrantOrResponsibility = report.coldStart.secondHost.protocolEvents.length === 0;
      assert.equal(report.coldStart.noNewGrantOrResponsibility, true, "second EH created an Owner/grant protocol event");
      report.failures.length = 0;
      return;
    }
    if (responses.failures.length) throw new Error(`Responses protocol stopped after root creation: ${JSON.stringify(responses.failures)}`);
    if (input.scenario === "stop-continue") await driveContinuation({ root, port, report, scenario, readTasks, inspectCleanup, readRuntime,
      healthy: () => { assert.equal(exited, false, "EH exited during stop/continue"); responses.assertHealthy(); } });
    if (input.scenario === "successive-stop-continue") await drivePublicSuccessiveContinuation({ port, product, report, scenario,
      readTasks, inspectCleanup, readRuntime, healthy: () => {
        assert.equal(exited, false, "EH exited during successive stop/continue");
        responses.assertHealthy(); openCodeProvider.assertHealthy();
      } });
    const completionDeadline = Date.now() + timeoutMs;
    let completed = false;
    while (Date.now() < completionDeadline && !exited) {
      records = fs.readdirSync(taskStore).filter((name) => name.endsWith(".json") && !name.startsWith("."));
      const snapshots = records.map((name) => {
        try { return JSON.parse(fs.readFileSync(path.join(taskStore, name), "utf8")); } catch { return null; }
      }).filter(Boolean);
      report.rootTaskSnapshots = snapshots;
      const tasks = snapshots.flatMap((snapshot) => Array.isArray(snapshot.tasks) ? snapshot.tasks : [snapshot]);
      if (scenario.history.some((entry) => entry.stage === "director-dispatch")) report.stages.directorExecution = "observed";
      if (scenario.history.some((entry) => entry.stage === "leader-dispatch")) { report.stages.leaderExecution = "observed"; report.activePhase = "eventAcceptance"; }
      if (scenario.snapshot().longToolEvidence) report.stages.longNativeToolCompletion = "observed";
      if (scenario.history.some((entry) => entry.stage === "leader-accept")) report.stages.eventAcceptance = "observed";
      if (["stop-continue", "successive-stop-continue"].includes(input.scenario)) {
        const saved = readRuntime(scenario.snapshot().rootId);
        const blocked = saved.runtime.leaders.find((member) => member.status === "blocked");
        if (blocked) {
          report.activePhase = "successorCleanup";
          report.stages.successorCleanup = "failed";
          await inspectCleanup(scenario.snapshot().rootId);
          const logFile = path.join(home, ".sinitek_cli/logs", `sinitek-cli.${new Date().toISOString().slice(0, 10)}.log`);
          report.productionCleanupErrors = fs.existsSync(logFile) ? fs.readFileSync(logFile, "utf8").split("\n")
            .filter((line) => line.includes("department-cleanup-observation-failed")).slice(-8) : [];
          report.bindingSessionComparison = saved.executionBindings.map(({ identity }) => {
            const task = tasks.find((value) => value.id === identity.leaderTaskId);
            const recorded = identity.role === "leader" ? task?.executionSession
              : task?.subTasks.find((subtask) => subtask.id === identity.subtaskId)?.executionSession;
            return { identity, recorded, matches: recorded?.cli === identity.cli && recorded.sessionId === identity.session.id };
          });
          throw new Error(`successor generation ${blocked.generation} is blocked with capacity retained; ${report.productionCleanupErrors.join("; ") || "see cleanupEvidence and bindingSessionComparison"}`);
        }
      }
      const rejectedLeader = tasks.find((record) => record.department?.role === "leader"
        && record.department.rootTaskId === scenario.snapshot().rootId && ["stopped", "error", "needs-review"].includes(record.status));
      if (rejectedLeader) {
        report.stages.leaderExecution = "failed";
        await inspectCleanup(rejectedLeader.department.rootTaskId);
        throw new Error(`production leader ${rejectedLeader.id} became ${rejectedLeader.status} before scenario completion; no task status or teardown can replace its original Owner receipt. See rootTaskSnapshots and cleanupEvidence.`);
      }
      completed = tasks.some((record) => record.department?.role === "director" && record.status === "completed");
      if (completed) { report.stages.directorExecution = "completed"; break; }
      const rejectedRoot = tasks.find((record) => record.department?.role === "director" && ["needs-review", "failed", "stopped"].includes(record.status));
      if (rejectedRoot) {
        report.stages.directorExecution = "failed";
        throw new Error(`production director execution ended with task status ${rejectedRoot.status}; UI=${JSON.stringify(report.publicUi.afterSend)}; Responses=${JSON.stringify(responses.failures)}`);
      }
      openCodeProvider?.assertHealthy();
      if (responses.failures.length) throw new Error(`Responses protocol failed after root creation: ${JSON.stringify(responses.failures)}`);
      await sleep(250);
    }
    openCodeProvider?.assertHealthy(); responses.assertHealthy();
    if (!completed) throw new Error(`production root did not complete within the scenario budget; owner receipts and capacity return remain unconfirmed`);
    report.activePhase = input.scenario === "loop-plus" ? "capacityReturn" : "ownerReceipts";
    const snapshot = scenario.snapshot();
    assert.ok(snapshot.rootId && snapshot.moduleCount === 2 && snapshot.leaders.length === 2 && snapshot.employees.length === (2 + continuationRounds(snapshot).length), "both real module executions must be observed");
    const cleanup = await inspectCleanup(snapshot.rootId);
    assert.equal(cleanup.complete, true, "module settlement or capacity return is incomplete");
    const tasks = readTasks(), rootTask = tasks.find((value) => value.id === snapshot.rootId);
    if (input.scenario === "loop-plus") {
      const { createLoopPlusScheduler } = require(path.join(product, "dist/loopPlusScheduler.js"));
      for (const id of snapshot.leaders) {
        const leader = tasks.find((value) => value.id === id);
        assert.equal(leader?.department?.executionMode, "loop-plus");
        assert.equal(leader.status, "completed");
        assert.deepEqual(leader.loopPlusAcceptancePlan, rootTask.loopPlusAcceptancePlan);
        assert.ok(createLoopPlusScheduler({ snapshot: leader.loopPlus }).snapshot().seenAttempts.some((attempt) => attempt.acceptance === "passed"));
        const employee = snapshot.employees.find((value) => value.leaderTaskId === id);
        const subtask = leader.subTasks.find((value) => value.id === employee?.subtaskId);
        assert.ok(subtask?.executionSession?.sessionId, "ordinary Loop+ did not save the employee session");
        assert.equal(subtask.communicationFile, employee.reportFile);
      }
      Object.assign(report.stages, { ownerReceipts: "not-applicable", capacityReturn: "passed", eventAcceptance: "passed",
        unifiedAcceptancePlan: "passed", directorReport: "passed" });
      report.cleanupEvidence = cleanup;
      return;
    }
    report.stages.ownerReceipts = "running";
    assert.equal(cleanup.saved.leaderExecutionSets.length, snapshot.leaders.length + continuationRounds(snapshot).length, "unexpected or missing coordinator generation");
    assert.equal(cleanup.saved.executionBindings.length, snapshot.leaders.length + snapshot.employees.length + continuationRounds(snapshot).length, "unobserved original Owner binding");
    for (const id of snapshot.leaders) {
      const leader = tasks.find((value) => value.id === id);
      assert.deepEqual(leader.loopPlusAcceptancePlan, rootTask.loopPlusAcceptancePlan, "root acceptance plan was not inherited");
      assert.ok(scenario.history.some((entry) => ["leader-accept", "successive-final-accept"].includes(entry.stage) && entry.identity === id), "missing real event acceptance");
      assert.equal(cleanup.saved.executionBindings.filter((binding) => binding.identity.role === "leader" && binding.identity.leaderTaskId === id).length, id === continuationRounds(snapshot)[0]?.held?.leaderTaskId ? 1 + continuationRounds(snapshot).length : 1,
        "missing exact original leader Owner");
    }
    for (const employee of snapshot.employees) {
      assert.ok(snapshot.leaders.includes(employee.leaderTaskId), "employee belongs to an unobserved leader");
      const bindings = cleanup.saved.executionBindings.filter(({ identity }) => identity.role === "employee"
        && identity.leaderTaskId === employee.leaderTaskId && identity.subtaskId === employee.subtaskId && identity.attemptId === employee.attemptId);
      assert.equal(bindings.length, 1, "employee attempt lacks exactly one original Owner binding");
      const subtask = tasks.find((value) => value.id === employee.leaderTaskId)?.subTasks.find((value) => value.id === employee.subtaskId);
      assert.equal(subtask?.communicationFile, employee.reportFile, "employee runtime report path changed");
      assert.equal(subtask?.executionSession?.sessionId, bindings[0].identity.session.id, "employee native binding changed");
    }
    if (input.scenario === "stop-continue") {
      const original = report.continuationEvidence.originalBindings;
      for (const old of original) {
        const successors = cleanup.saved.executionBindings.filter(({ identity }) => identity.role === old.identity.role
          && identity.leaderTaskId === old.identity.leaderTaskId && identity.executionId !== old.identity.executionId);
        assert.equal(successors.length, 1, "missing or duplicate successor Owner");
        assert.equal(successors[0].identity.session.id, old.identity.session.id, "successor changed original native thread");
        assert.notEqual(successors[0].identity.ownerId, old.identity.ownerId, "successor adopted old Owner authority");
        assert.ok(cleanup.observations.some((observation) => sameExecution(observation.identity, old.identity)), "original receipt disappeared");
      }
      assert.ok(snapshot.continuation.repaired && snapshot.continuation.accepted, "missing actual resumed event review");
      report.continuationEvidence.finalCleanup = cleanup;
    }
    assert.ok(scenario.history.some((entry) => entry.stage === "director-report"), "missing final director report");
    assert.ok(snapshot.capacityReuse?.complete, "second legal dispatch did not observe returned capacity");
    if (input.scenario === "codex-long-tool-output") {
      const evidence = snapshot.longToolEvidence;
      assert.ok(evidence?.nativeFunctionCallOutput, "missing native leader function_call_output evidence");
      assert.equal(evidence.modelPayloadBytes, LONG_TOOL_PAYLOAD_BYTES);
      assert.equal(evidence.modelPayloadSha256, LONG_TOOL_OUTPUT_SHA256);
      const grant = readLongToolGrant(snapshot.rootId, snapshot.leaders[0], evidence.invocationId);
      const identity = longToolFixture.departmentFullEhLongToolIdentity(grant.identity, grant.invocationId);
      const forwarded = assertLongToolForwarding(readLongToolEvidence(), identity);
      assert.ok(Object.keys(forwarded).every(key => forwarded[key] === evidence[key]), "forwarded evidence changed after dispatch");
      const captured = fs.readFileSync(cleanup.originalClientObservationFile, "utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line));
      const originals = captured.filter(entry => sameExecution(entry.identity, grant.identity));
      assert.equal(originals.length, 1, "long-tool invocation lacks its unique original Owner receipt");
      const original = originals[0];
      const binding = cleanup.saved.executionBindings.find(entry => sameExecution(entry.identity, grant.identity));
      assert.ok(binding && original.source === "original-client-waitForCleanup-return" && isDepartmentExecutionReceipt(original.receipt)
        && sameExecution(original.receipt.identity, binding.identity) && cleanupComplete(original.receipt.cleanup, binding.requirements),
      "long-tool Owner receipt differs from the exact original persisted binding");
      report.longToolEvidence = { ...evidence, ownerReceiptId: original.receipt.receiptId };
      report.stages.longNativeToolCompletion = "passed";
    }
    if (Object.values(report.roles).includes("opencode")) {
      const savedPreferences = JSON.parse(fs.readFileSync(path.join(workspaceSettings, `${workspaceKey}.json`), "utf8"));
      report.roleDefaultModelEvidence = [];
      for (const role of ["director", "leader", "employee"]) {
        if (report.roles[role] !== "opencode" || role === "leader" && input.leaderModel !== "default") continue;
        if (role !== "director") assert.equal(savedPreferences.departmentRoleRoutesByDirectorConfig[`${input.directorCli}-local`][role].model, null, "default preference must remain null");
        assert.equal(rootTask.department.routes[role].model, "isolated/native-drain", "root must freeze the effective default");
        const matching = cleanup.saved.executionBindings.filter(value => value.identity.role === role);
        for (const binding of matching) {
          const leaderTask = tasks.find(task => task.id === binding.identity.leaderTaskId);
          assert.equal(leaderTask.department.routes[role].model, rootTask.department.routes[role].model);
          assert.equal(binding.selection.model, rootTask.department.routes[role].model, "original Owner model must match the fixed root snapshot");
        }
        report.roleDefaultModelEvidence.push({ role, preferenceModel: null, effectiveModel: rootTask.department.routes[role].model, matchingBindings: matching.length });
      }
      if (input.leaderCli === "opencode" && input.leaderModel === "default") report.defaultModelEvidence = { preferenceModel: null, effectiveModel: rootTask.department.routes.leader.model, matchingLeaderBindings: cleanup.saved.executionBindings.filter(b => b.identity.role === "leader").length };
      if (input.directorCli === "opencode") {
        const modelStore = JSON.parse(fs.readFileSync(path.join(home, ".sinitek_cli/models.json"), "utf8"));
        assert.equal(modelStore.openCodeRoleModelsByConfigId["opencode-local"]?.main ?? null, null, "director default must remain an unset/null override");
      }
      const protocolFile = path.join(root, "original-owner-protocol.ndjson");
      const protocol = fs.readFileSync(protocolFile, "utf8").trim().split("\n").map((line) => JSON.parse(line));
      report.mixedHandshakes = assertMixedEvidence({ cleanup, tasks, snapshot, protocol, roles: report.roles });
      report.protocolFile = protocolFile;
      if (input.scenario === "successive-stop-continue") report.successiveFinalEvidence = assertSuccessiveEvidence({
        cleanup, tasks, snapshot, protocol, evidence: report.successiveContinuation });
      report.nativeFacts = readOpenCodeNativeFacts(root, cleanup.saved.executionBindings, protocol);
      const originals = fs.readFileSync(path.join(root, "original-owner-observations.ndjson"), "utf8").trim().split("\n").map(line => JSON.parse(line));
      report.openCodeLaunchEvidence = assertOpenCodeLaunchEvidence({ bindings: cleanup.saved.executionBindings, protocol, originals,
        nativeFacts: report.nativeFacts, isolatedRoot: fs.realpathSync(root), snapshot });
    }
    report.stages.ownerReceipts = "passed";
    report.stages.capacityReturn = "passed";
    report.stages.eventAcceptance = "passed";
    report.stages.unifiedAcceptancePlan = "passed";
    report.stages.directorReport = "passed";
  } catch (error) {
    report.failures.push({ stage: report.activePhase || Object.entries(report.stages).find(([, value]) => value === "failed")?.[0]
      || Object.entries(report.stages).find(([, value]) => value === "running" || value === "pending")?.[0]
      || "integration", message: error instanceof Error ? error.message : String(error) });
  } finally {
    scenario.releaseAll?.();
    scenario.releaseEmployee?.();
    scenario.releasePendingProviderResponse?.();
    if (openCodeProvider) await openCodeProvider.close();
    if (responses?.server.listening) await new Promise((resolve) => responses.server.close(resolve));
    if (child && !exited) {
      try { fs.writeFileSync(path.join(root, "host-finish.signal"), "verification-failed-or-finished\n", { flag: "wx" }); } catch { /* preserve existing signal */ }
      const closeDeadline = Date.now() + 10000;
      while (!exited && Date.now() < closeDeadline) await sleep(100);
    }
    if (child && !exited) {
      forced = true;
      if (process.platform === "win32") cp.spawnSync("taskkill.exe", ["/pid", String(child.pid), "/t", "/f"], { stdio: "ignore" });
      else { try { process.kill(-child.pid, "SIGKILL"); } catch { try { child.kill("SIGKILL"); } catch { /* report remains failed */ } } }
    }
    if (longToolFixture && report.stages.longNativeToolCompletion === "passed"
      && (!exited || report.hostExit?.exitCode !== 0 || report.hostExit?.signal
        || fs.existsSync(path.join(root, "long-tool-observer-errors.ndjson")))) {
      report.stages.longNativeToolCompletion = "failed";
      report.failures.push({ stage: "longNativeToolCompletion", message: "long tool event observation did not finish cleanly" });
    }
    if (secondChild && report.coldStart?.secondHostExit?.exitCode === undefined) {
      forced = true;
      report.coldStart = report.coldStart || {};
      report.coldStart.secondHostForcedCleanup = true;
      try {
        if (process.platform === "win32") cp.spawnSync("taskkill.exe", ["/pid", String(secondChild.pid), "/t", "/f"], { stdio: "ignore", timeout: 10000 });
        else process.kill(-secondChild.pid, "SIGKILL");
      } catch (error) { report.coldStart.secondHostCleanupError = String(error); }
    }
    if (workerExitObserver) {
      try { await workerExitObserver.close(); }
      catch (error) { report.failures.push({ stage: "workerExitObserverShutdown", message: error.message }); }
      report.workerExitObservation = workerExitObserver.snapshot();
      if (report.workerExitObservation.errors.length) report.failures.push({ stage: "workerExitObservation", message: report.workerExitObservation.errors.join(",") });
    }
    report.forcedTeardown = forced;
    report.finishedAt = new Date().toISOString();
    if (!["passed", "not-applicable"].includes(report.stages.ownerReceipts)) report.stages.ownerReceipts = "not-confirmed";
    if (report.stages.capacityReturn !== "passed") report.stages.capacityReturn = "not-confirmed";
    report.scenario = scenario.snapshot();
    try {
      const originalRoot = readTasks().find((task) => task.department?.role === "director");
      if (originalRoot) await inspectCleanup(originalRoot.id, input.scenario === "cold-recovery" ? "stopped" : "completed",
        input.scenario === "cold-recovery" ? report.coldRecovery?.snapshots.afterContinue?.runtime.leaderExecutionSets ?? null : null);
    } catch (error) { report.cleanupReadError = String(error); }
    if (responses) fs.writeFileSync(path.join(root, "responses-requests.json"), JSON.stringify(responses.requests, null, 2), { flag: "wx" });
    if (openCodeProvider) {
      fs.writeFileSync(path.join(root, "opencode-requests.json"), JSON.stringify(openCodeProvider.requests, null, 2), { flag: "wx" });
      report.openCodeProvider = { ...report.openCodeProvider, requests: openCodeProvider.requests.length, failures: openCodeProvider.failures,
        stages: openCodeProvider.requests.map(({ index, stage, purpose }) => ({ index, stage, purpose })) };
      if (openCodeProvider.failures.length) report.failures.push({ stage: "opencodeProtocol", message: JSON.stringify(openCodeProvider.failures) });
    }
    report.responses = responses ? { requests: responses.requests.length, failures: responses.failures, stages: scenario.history.map(({ index, stage, identity }) => ({ index, stage, identity })) } : null;
    if (report.successiveCdpCleanup?.length || report.coldRecovery?.cdpCleanup?.length || report.coldStart?.cdpCleanup?.confirmed === false)
      report.failures.push({ stage: "cdpCleanup", message: "owned CDP resource release was not confirmed" });
    report.result = report.failures.length === 0 && !forced ? "passed" : "failed";
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), { flag: "wx" });
    console.log(JSON.stringify({ report: reportPath, result: report.result, stages: report.stages, failures: report.failures }, null, 2));
    if (report.result !== "passed") process.exitCode = 1;
  }
}

module.exports = { matchesExpectedCleanupSets, continuationRounds, expectedNativeTurns, assertSuccessiveEvidence, drivePublicSuccessiveContinuation, args, roleSelection, isolatedEnvironment, assertMixedEvidence, readOpenCodeNativeFacts, assertOpenCodeLaunchEvidence,
  assertColdStartActivationSucceeded, classifyColdStartRecovery, assertColdRestartIdentity, assertColdUiRoot, assertColdUiDepartmentRoster,
  findDepartmentWebviewTarget, createDepartmentWebviewAdapter, clickPublicControl, driveColdProductionRecoveryCheck, assertColdHostObservation, settleColdPublicControl };
if (require.main === module) main().catch((error) => { console.error(error); process.exitCode = 1; });
