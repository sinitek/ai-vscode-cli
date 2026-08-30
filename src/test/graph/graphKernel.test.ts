import test = require("node:test");
import assert = require("node:assert/strict");
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import {
  tickGraphRun,
  type GraphNodeExecutionRequest,
} from "../../graph/graphKernel";
import type { GraphEventAppendInput } from "../../graph/graphEvents";
import { resumeGraphRunRecord } from "../../graph/graphRunControl";
import {
  GRAPH_SCHEMA_VERSION,
  type GraphEdgeRecord,
  type GraphNodeRecord,
  type GraphRunRecord,
} from "../../graph/types";

function createTempBaseDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "sinitek-graph-kernel-"));
}

function createNode(overrides: Partial<GraphNodeRecord> = {}): GraphNodeRecord {
  return {
    id: "node-1",
    title: "Graph node",
    kind: "plan",
    status: "pending",
    ownerRole: "main",
    maxAttempts: 2,
    attempts: 0,
    dependsOn: [],
    unlocks: [],
    ...overrides,
  };
}

function createRun(
  baseDir: string,
  nodes: GraphNodeRecord[],
  edges: GraphEdgeRecord[] = [],
  overrides: Partial<GraphRunRecord> = {},
): GraphRunRecord {
  return {
    id: "run-1",
    workspaceKey: "workspace-a",
    cli: "codex",
    sessionId: null,
    rootPrompt: "Run kernel tests.",
    status: "running",
    createdAt: 1,
    updatedAt: 1,
    graphVersion: GRAPH_SCHEMA_VERSION,
    runStoreFile: path.join(baseDir, "graph-runs.json"),
    nodes,
    edges,
    activeNodeIds: [],
    maxConcurrent: 5,
    eventsFile: path.join(baseDir, "events.jsonl"),
    communicationDir: path.join(baseDir, "graph"),
    mainCommunicationFile: path.join(baseDir, "graph", "main.md"),
    graphFile: path.join(baseDir, "graph", "graph.json"),
    ...overrides,
  };
}

function getNode(run: GraphRunRecord, nodeId: string): GraphNodeRecord {
  const node = run.nodes.find((item) => item.id === nodeId);
  assert.ok(node);
  return node;
}

test("starts the selected CLI batch before invoking the injected executor", async () => {
  const baseDir = createTempBaseDir();
  try {
    const order: string[] = [];
    const run = createRun(baseDir, [
      createNode({ id: "plan-1", title: "Plan" }),
      createNode({ id: "review-1", title: "Review", kind: "review", ownerRole: "reviewer", writeFiles: ["src/a.ts"] }),
    ]);

    const result = await tickGraphRun(run, {
      now: () => 1_000,
      appendEvent: (_run, event: GraphEventAppendInput) => {
        order.push(`event:${event.type}:${event.nodeId ?? "run"}`);
        return {
          eventId: `${event.type}-${event.nodeId ?? "run"}`,
          runId: event.runId,
          type: event.type,
          timestamp: event.timestamp ?? 1_000,
          ...(event.nodeId ? { nodeId: event.nodeId } : {}),
        };
      },
      persistRun: (nextRun) => nextRun,
      buildPrompt: ({ node }) => `prompt:${node.id}`,
      executor: {
        execute: async (request: GraphNodeExecutionRequest) => {
          order.push(`exec:${request.node.id}`);
          assert.equal(getNode(request.run, request.node.id).status, "running");
          assert.ok(request.run.activeNodeIds.includes(request.node.id));
          assert.equal(request.prompt, `prompt:${request.node.id}`);
          return { status: "passed", summary: `${request.node.id} passed` };
        },
      },
    });

    assert.deepEqual(result.batch.selectedNodeIds, ["plan-1", "review-1"]);
    assert.deepEqual(result.startedNodeIds, ["plan-1", "review-1"]);
    assert.equal(getNode(result.run, "plan-1").status, "passed");
    assert.equal(getNode(result.run, "review-1").status, "passed");
    assert.deepEqual(result.run.activeNodeIds, []);
    assert.deepEqual(order.slice(0, 2), ["event:node.started:plan-1", "event:node.started:review-1"]);
    assert.deepEqual(order.filter((item) => item.startsWith("exec:")), ["exec:plan-1", "exec:review-1"]);
  } finally {
    fs.rmSync(baseDir, { recursive: true, force: true });
  }
});

test("writes blocked executor results through the failed lifecycle", async () => {
  const baseDir = createTempBaseDir();
  try {
    const events: string[] = [];
    const run = createRun(baseDir, [
      createNode({ id: "success", title: "Success" }),
      createNode({ id: "failed", title: "Failed", maxAttempts: 3 }),
      createNode({ id: "blocked", title: "Blocked" }),
    ]);

    const result = await tickGraphRun(run, {
      now: () => 2_000,
      appendEvent: (_run, event) => {
        events.push(`${event.type}:${event.nodeId ?? "run"}`);
        return {
          eventId: `${events.length}`,
          runId: event.runId,
          type: event.type,
          timestamp: event.timestamp ?? 2_000,
          ...(event.nodeId ? { nodeId: event.nodeId } : {}),
        };
      },
      executor: {
        execute: async (request) => {
          if (request.node.id === "success") {
            return { status: "passed", summary: "ok" };
          }
          if (request.node.id === "failed") {
            return { status: "failed", error: "retry later" };
          }
          return { status: "blocked", error: "needs decision" };
        },
      },
    });

    assert.equal(getNode(result.run, "success").status, "passed");
    assert.equal(getNode(result.run, "failed").status, "failed");
    assert.equal(getNode(result.run, "blocked").status, "failed");
    assert.deepEqual(result.completedNodeIds, ["success"]);
    assert.deepEqual(result.failedNodeIds, ["failed", "blocked"]);
    assert.deepEqual(result.blockedNodeIds, []);
    assert.ok(events.includes("node.completed:success"));
    assert.ok(events.includes("node.failed:failed"));
    assert.ok(events.includes("node.failed:blocked"));
    assert.equal(events.includes("node.blocked:blocked"), false);
  } finally {
    fs.rmSync(baseDir, { recursive: true, force: true });
  }
});

test("records executor throws as failed events even when maxAttempts is exhausted", async () => {
  const baseDir = createTempBaseDir();
  try {
    const events: string[] = [];
    const run = createRun(baseDir, [
      createNode({ id: "throwing", title: "Throwing", maxAttempts: 1 }),
    ]);

    const result = await tickGraphRun(run, {
      now: () => 3_000,
      appendEvent: (_run, event) => {
        events.push(`${event.type}:${event.nodeId ?? "run"}:${event.error ?? ""}`);
        return {
          eventId: `${events.length}`,
          runId: event.runId,
          type: event.type,
          timestamp: event.timestamp ?? 3_000,
          ...(event.nodeId ? { nodeId: event.nodeId } : {}),
          ...(event.error ? { error: event.error } : {}),
        };
      },
      executor: {
        execute: async () => {
          throw new Error("executor exploded");
        },
      },
    });

    assert.equal(getNode(result.run, "throwing").status, "failed");
    assert.equal(getNode(result.run, "throwing").lastError, "executor exploded");
    assert.deepEqual(result.failedNodeIds, ["throwing"]);
    assert.deepEqual(result.blockedNodeIds, []);
    assert.ok(events.some((event) => event === "node.failed:throwing:executor exploded"));
    assert.equal(events.some((event) => event === "node.blocked:throwing:executor exploded"), false);
  } finally {
    fs.rmSync(baseDir, { recursive: true, force: true });
  }
});

test("does not create human gate actions and completes due sleep nodes without ordinary CLI execution", async () => {
  const baseDir = createTempBaseDir();
  try {
    const executed: string[] = [];
    const events: string[] = [];
    const run = createRun(baseDir, [
      createNode({
        id: "cli",
        title: "CLI",
        kind: "implement",
        ownerRole: "subtask",
        writeFiles: ["src/graph/graphKernel.ts"],
      }),
      createNode({
        id: "gate",
        title: "Approve",
        kind: "human_gate",
        ownerRole: "human",
        status: "pending",
      }),
      createNode({
        id: "sleep",
        title: "Wait",
        kind: "sleep",
        ownerRole: "system",
        status: "sleeping",
        wakeAt: 900,
      }),
    ]);

    const result = await tickGraphRun(run, {
      now: () => 1_000,
      appendEvent: (_run, event) => {
        events.push(`${event.type}:${event.nodeId ?? "run"}`);
        return {
          eventId: `${events.length}`,
          runId: event.runId,
          type: event.type,
          timestamp: event.timestamp ?? 1_000,
          ...(event.nodeId ? { nodeId: event.nodeId } : {}),
        };
      },
      executor: {
        execute: async (request) => {
          executed.push(request.node.id);
          return { status: "passed", summary: "cli passed" };
        },
      },
    });

    assert.deepEqual(executed, ["cli"]);
    assert.deepEqual(result.pendingActions, []);
    assert.deepEqual(result.systemActions, [{ type: "sleep_due_completed", nodeId: "sleep", title: "Wait", wakeAt: 900 }]);
    assert.equal(getNode(result.run, "gate").status, "pending");
    assert.equal(getNode(result.run, "sleep").status, "passed");
    assert.equal(getNode(result.run, "cli").status, "passed");
    assert.equal(events.includes("human_gate.waiting:gate"), false);
    assert.ok(events.includes("node.completed:sleep"));
    assert.ok(!executed.includes("gate"));
    assert.ok(!executed.includes("sleep"));
  } finally {
    fs.rmSync(baseDir, { recursive: true, force: true });
  }
});

test("puts future sleep nodes into sleeping without invoking the CLI executor", async () => {
  const baseDir = createTempBaseDir();
  try {
    const executed: string[] = [];
    const events: string[] = [];
    const run = createRun(baseDir, [
      createNode({
        id: "sleep-future",
        title: "Wait for timer",
        kind: "sleep",
        ownerRole: "system",
        status: "pending",
        wakeAt: 5_000,
      }),
    ]);

    const result = await tickGraphRun(run, {
      now: () => 1_000,
      appendEvent: (_run, event) => {
        events.push(`${event.type}:${event.nodeId ?? "run"}`);
        return {
          eventId: `${events.length}`,
          runId: event.runId,
          type: event.type,
          timestamp: event.timestamp ?? 1_000,
          ...(event.nodeId ? { nodeId: event.nodeId } : {}),
        };
      },
      executor: {
        execute: async (request) => {
          executed.push(request.node.id);
          return { status: "passed", summary: "unexpected" };
        },
      },
    });

    assert.deepEqual(executed, []);
    assert.deepEqual(result.sleepingNodeIds, ["sleep-future"]);
    assert.deepEqual(result.systemActions, [{
      type: "sleep_waiting",
      nodeId: "sleep-future",
      title: "Wait for timer",
      wakeAt: 5_000,
    }]);
    assert.equal(getNode(result.run, "sleep-future").status, "sleeping");
    assert.equal(result.run.status, "sleeping");
    assert.deepEqual(events, ["node.sleeping:sleep-future"]);
  } finally {
    fs.rmSync(baseDir, { recursive: true, force: true });
  }
});

test("continues after resume by completing due sleep before a dependent CLI tick", async () => {
  const baseDir = createTempBaseDir();
  try {
    const executed: string[] = [];
    const sleep = createNode({
      id: "sleep",
      title: "Wait",
      kind: "sleep",
      ownerRole: "system",
      status: "sleeping",
      wakeAt: 900,
    });
    const implement = createNode({
      id: "implement",
      title: "Implement",
      kind: "implement",
      ownerRole: "subtask",
      status: "pending",
      dependsOn: ["sleep"],
      writeFiles: ["src/graph/graphKernel.ts"],
    });
    const sleepingRun = createRun(baseDir, [sleep, implement], [], { status: "sleeping" });
    const resumed = await resumeGraphRunRecord(sleepingRun, { now: () => 1_000, source: "system" });

    const afterWake = await tickGraphRun(resumed.run, {
      now: () => 1_000,
      appendEvent: (_run, event) => ({
        eventId: `${event.type}-${event.nodeId ?? "run"}`,
        runId: event.runId,
        type: event.type,
        timestamp: event.timestamp ?? 1_000,
        ...(event.nodeId ? { nodeId: event.nodeId } : {}),
      }),
      executor: {
        execute: async (request) => {
          executed.push(request.node.id);
          return { status: "passed", summary: "implemented" };
        },
      },
    });
    assert.deepEqual(afterWake.systemActions, [{
      type: "sleep_due_completed",
      nodeId: "sleep",
      title: "Wait",
      wakeAt: 900,
    }]);
    assert.equal(getNode(afterWake.run, "sleep").status, "passed");
    assert.equal(executed.length, 0);

    const afterCli = await tickGraphRun(afterWake.run, {
      now: () => 1_100,
      executor: {
        execute: async (request) => {
          executed.push(request.node.id);
          return { status: "passed", summary: "implemented" };
        },
      },
    });
    assert.deepEqual(executed, ["implement"]);
    assert.equal(getNode(afterCli.run, "implement").status, "passed");
  } finally {
    fs.rmSync(baseDir, { recursive: true, force: true });
  }
});

test("starts the first planned CLI node even when downstream if_fail rework edges point back to it", async () => {
  const baseDir = createTempBaseDir();
  try {
    const executed: string[] = [];
    const plan = createNode({
      id: "plan",
      title: "Plan",
      kind: "plan",
      ownerRole: "main",
      status: "passed",
      attempts: 1,
      unlocks: ["implement-prototype"],
    });
    const implement = createNode({
      id: "implement-prototype",
      title: "Implement prototype",
      kind: "implement",
      ownerRole: "subtask",
      status: "pending",
      dependsOn: ["plan"],
      writeFiles: ["employee-management-prototype/**"],
    });
    const testNode = createNode({
      id: "test-file-structure",
      title: "Test file structure",
      kind: "test",
      ownerRole: "subtask",
      status: "pending",
      dependsOn: ["implement-prototype"],
    });
    const run = createRun(baseDir, [plan, implement, testNode], [{
      id: "edge-test-implement-if_fail",
      from: "test-file-structure",
      to: "implement-prototype",
      kind: "if_fail",
      active: true,
      conditionExpression: {
        type: "source_status",
        operator: "equals",
        status: "failed",
      },
      metadata: {
        feedbackReason: "File structure failed; rework implementation.",
        reworkTargetNodeId: "implement-prototype",
        reworkScopeNodeIds: ["implement-prototype", "test-file-structure"],
      },
    }, {
      id: "edge-plan-implement",
      from: "plan",
      to: "implement-prototype",
      kind: "depends_on",
      active: true,
    }]);

    const result = await tickGraphRun(run, {
      now: () => 2_000,
      executor: {
        execute: async (request) => {
          executed.push(request.node.id);
          return { status: "passed", summary: `${request.node.id} passed` };
        },
      },
    }, {
      maxConcurrent: 1,
    });

    assert.deepEqual(result.batch.selectedNodeIds, ["implement-prototype"]);
    assert.deepEqual(result.startedNodeIds, ["implement-prototype"]);
    assert.deepEqual(executed, ["implement-prototype"]);
    assert.equal(getNode(result.run, "implement-prototype").status, "passed");
    assert.equal(getNode(result.run, "test-file-structure").status, "pending");
  } finally {
    fs.rmSync(baseDir, { recursive: true, force: true });
  }
});
