import assert = require("node:assert/strict");
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import test = require("node:test");
import { installVscodeMock } from "../vscodeMock";

installVscodeMock();

const { ZcodeInteractiveRunner } = require("../../interactive/zcodeRunner") as typeof import("../../interactive/zcodeRunner");
const { InteractiveRunnerManager } = require("../../interactive/manager") as typeof import("../../interactive/manager");

type Request = { id: number; method: string; params: Record<string, unknown> };

class FakeZcode extends EventEmitter {
  public readonly stdin = new PassThrough();
  public readonly stdout = new PassThrough();
  public readonly stderr = new PassThrough();
  public readonly exitCode: number | null = null;
  public readonly requests: Request[] = [];
  public beforeSendReply?: (request: Request) => void;
  public sendAccepted = true;
  public contextUsed = 1234;
  public failedMethod?: string;
  public responseForRequest?: (request: Request) => unknown;

  public constructor(private readonly available = ["low", "high", "max"]) {
    super();
    let buffer = "";
    this.stdin.setEncoding("utf8");
    this.stdin.on("data", (chunk: string) => {
      buffer += chunk;
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines.filter((value) => value.trim())) {
        const request = JSON.parse(line) as Request;
        this.requests.push(request);
        if (request.method === this.failedMethod) {
          this.stdout.write(`${JSON.stringify({ id: request.id, error: { code: -32603, message: "startup failure" } })}\n`);
          continue;
        }
        if (request.method === "session/send") {
          this.beforeSendReply?.(request);
        }
        const result = request.method === "session/create" || request.method === "session/resume" ? {
          protocol: { name: "ZCode Protocol", version: 1 },
          session: { sessionId: "sess_test" },
          settings: {
            mode: { current: "yolo" },
            model: { current: request.params.model, available: [] },
            thoughtLevel: {
              current: request.params.thoughtLevel ?? null,
              enabled: this.available.length > 0,
              available: this.available.map((value) => ({ value })),
            },
          },
        } : request.method === "session/send" ? { accepted: this.sendAccepted }
          : request.method === "session/read" ? {
            protocol: { name: "ZCode Protocol", version: 1 },
            projection: { contextUsed: this.contextUsed, contextWindow: 200000 },
          }
            : {};
        this.stdout.write(`${JSON.stringify({ id: request.id, result: this.responseForRequest?.(request) ?? result })}\n`);
      }
    });
  }

  public kill(): boolean {
    this.stdout.end();
    this.stderr.end();
    this.emit("exit", 0);
    return true;
  }

  public completeTurn(content: string): void {
    this.emitEvent("turn.completed", { response: content });
  }

  public emitEvent(type: string, payload: Record<string, unknown>): void {
    this.stdout.write(`${JSON.stringify({
      method: "session/event",
      params: { sessionId: "sess_test", type, payload },
    })}\n`);
  }
}

test("healthy ZCode runners reuse the same session across consecutive task startups", async () => {
  const child = new FakeZcode();
  let spawnCount = 0;
  const runner = new ZcodeInteractiveRunner({
    cwd: process.cwd(),
    spawnImpl: () => { spawnCount += 1; return child; },
    killTreeImpl: (target) => { target.kill(); },
  });
  try {
    const first = await runner.start();
    assert.equal(first.resumed, false);
    await runner.setThoughtLevel("high");
    child.contextUsed = 4321;
    const second = await runner.start();
    assert.equal(second.sessionId, first.sessionId);
    assert.equal(second.resumed, true);
    assert.equal(second.settings.thinking, "high");
    assert.deepEqual(second.usage, { tokensInContextWindow: 4321, modelContextWindow: 200000 });
    assert.equal(runner.isReusable(), true);
    assert.equal(spawnCount, 1);
    assert.equal(child.requests.filter((request) => request.method === "session/create").length, 1);
    assert.equal(child.requests.filter((request) => request.method === "session/subscribe").length, 1);
    assert.equal(child.requests.some((request) => request.method === "session/resume"), false);
  } finally {
    await runner.dispose();
  }
});

test("the runner manager returns a healthy ZCode runner that can start the next task", async () => {
  const child = new FakeZcode();
  const manager = new InteractiveRunnerManager();
  const runner = new ZcodeInteractiveRunner({
    cwd: process.cwd(), spawnImpl: () => child, killTreeImpl: (target) => { target.kill(); },
  });
  try {
    const started = await runner.start();
    manager.setRunner("zcode", "local_zcode", runner, "off", "coding", null, {
      command: "zcode", args: [], cwd: process.cwd(), localSessionId: started.sessionId,
    });
    const reused = manager.getOrCreateZcodeRunner({
      sessionId: "local_zcode", command: "zcode", agentArgs: [], cwd: process.cwd(),
      thinkingMode: "off", interactiveMode: "coding", model: null, localSessionId: started.sessionId,
    });
    assert.equal(reused, runner);
    assert.equal(manager.hasZcodeRunner("local_zcode", reused), true);
    assert.equal((await reused.start()).sessionId, started.sessionId);
    assert.equal(child.requests.filter((request) => request.method === "session/create").length, 1);
  } finally {
    await runner.dispose();
    manager.disposeAll();
  }
});

test("a resumed ZCode session remains reusable on subsequent task startups", async () => {
  const child = new FakeZcode();
  const runner = new ZcodeInteractiveRunner({
    cwd: process.cwd(), localSessionId: "sess_test",
    spawnImpl: () => child, killTreeImpl: (target) => { target.kill(); },
  });
  try {
    const first = await runner.start();
    const second = await runner.start();
    assert.equal(first.resumed, true);
    assert.equal(second.sessionId, first.sessionId);
    assert.equal(second.resumed, true);
    assert.equal(child.requests.filter((request) => request.method === "session/resume").length, 1);
    assert.equal(child.requests.filter((request) => request.method === "session/subscribe").length, 1);
    assert.equal(child.requests.some((request) => request.method === "session/create"), false);
  } finally {
    await runner.dispose();
  }
});

test("disposed and exited ZCode runners cannot restart or claim a healthy session", async () => {
  for (const state of ["disposed", "exited"]) {
    const child = new FakeZcode();
    let spawnCount = 0;
    const runner = new ZcodeInteractiveRunner({
      cwd: process.cwd(),
      spawnImpl: () => { spawnCount += 1; return child; },
      killTreeImpl: (target) => { target.kill(); },
    });
    try {
      await runner.start();
      if (state === "disposed") {
        await runner.dispose();
      } else {
        child.kill();
      }
      assert.equal(runner.isReusable(), false);
      await assert.rejects(runner.start());
      assert.equal(spawnCount, 1);
    } finally {
      await runner.dispose();
    }
  }
});

test("ZCode runners with incomplete subscriptions or model setup are not eligible for reuse", async () => {
  for (const failedMethod of ["session/subscribe", "session/setModel"]) {
    const child = new FakeZcode();
    child.failedMethod = failedMethod;
    const runner = new ZcodeInteractiveRunner({
      cwd: process.cwd(), model: "local-glm/glm-5.3-flash$max",
      spawnImpl: () => child, killTreeImpl: (target) => { target.kill(); },
    });
    try {
      await assert.rejects(runner.start(), /startup failure/);
      assert.equal(runner.isReusable(), false);
    } finally {
      await runner.dispose();
    }
  }
});

test("consecutive ZCode tasks capture streaming and completion before send acknowledgement", async () => {
  const child = new FakeZcode();
  child.beforeSendReply = (request) => {
    child.emitEvent("model.streaming", { kind: "text_delta", delta: String(request.params.content) });
    child.completeTurn("");
  };
  const runner = new ZcodeInteractiveRunner({
    cwd: process.cwd(), spawnImpl: () => child, killTreeImpl: (target) => { target.kill(); },
  });
  const timeout = setTimeout(() => runner.cancelTurn(), 2000);
  try {
    for (const content of ["first task", "second task"]) {
      await runner.start();
      const deltas: string[] = [];
      const usages: unknown[] = [];
      const result = await runner.prompt(content, {
        onAssistantDelta: (delta) => { deltas.push(delta); },
        onTokenUsageUpdate: (usage) => { usages.push(usage); },
      });
      assert.equal(result.text, content);
      assert.deepEqual(deltas, [content]);
      assert.deepEqual(usages, [{ tokensInContextWindow: 1234, modelContextWindow: 200000 }]);
    }
    assert.equal(child.requests.filter((request) => request.method === "session/send").length, 2);
  } finally {
    clearTimeout(timeout);
    await runner.dispose();
  }
});

test("an early failed ZCode turn clears the waiter and allows a subsequent task", async () => {
  const child = new FakeZcode();
  child.beforeSendReply = () => child.emitEvent("turn.failed", { error: { message: "model unavailable" } });
  const runner = new ZcodeInteractiveRunner({
    cwd: process.cwd(), spawnImpl: () => child, killTreeImpl: (target) => { target.kill(); },
  });
  const timeout = setTimeout(() => runner.cancelTurn(), 2000);
  try {
    await runner.start();
    await assert.rejects(runner.prompt("first task"), /model unavailable/);
    assert.equal(runner.isReusable(), true);
    child.beforeSendReply = () => child.completeTurn("recovered");
    assert.equal((await runner.prompt("retry")).text, "recovered");
  } finally {
    clearTimeout(timeout);
    await runner.dispose();
  }
});

test("a rejected ZCode send does not leave an active waiter blocking the next task", async () => {
  const child = new FakeZcode();
  child.sendAccepted = false;
  const runner = new ZcodeInteractiveRunner({
    cwd: process.cwd(), spawnImpl: () => child, killTreeImpl: (target) => { target.kill(); },
  });
  const timeout = setTimeout(() => runner.cancelTurn(), 2000);
  try {
    await runner.start();
    await assert.rejects(runner.prompt("rejected"), /did not accept/);
    child.sendAccepted = true;
    child.beforeSendReply = () => child.completeTurn("accepted");
    assert.equal((await runner.prompt("retry")).text, "accepted");
  } finally {
    clearTimeout(timeout);
    await runner.dispose();
  }
});

test("ZCode rejects overlapping prompts and remains usable after a stopped turn", async () => {
  const child = new FakeZcode();
  const runner = new ZcodeInteractiveRunner({
    cwd: process.cwd(), spawnImpl: () => child, killTreeImpl: (target) => { target.kill(); },
  });
  const timeout = setTimeout(() => runner.cancelTurn(), 2000);
  try {
    await runner.start();
    const first = runner.prompt("first task");
    await assert.rejects(runner.prompt("overlapping task"), /already has an active prompt/);
    runner.cancelTurn();
    await assert.rejects(first, /turn was stopped/);
    child.beforeSendReply = () => child.completeTurn("next task completed");
    assert.equal((await runner.prompt("next task")).text, "next task completed");
  } finally {
    clearTimeout(timeout);
    await runner.dispose();
  }
});

for (const requested of ["medium", "ultra", "off"]) {
  test(`unsupported inherited ${requested} never overrides the configured ZCode reasoning level`, async () => {
    const child = new FakeZcode();
    const runner = new ZcodeInteractiveRunner({
      cwd: process.cwd(),
      model: "local-glm/glm-5.3-flash_sub-coco$max",
      thinkingMode: requested,
      spawnImpl: () => child,
      killTreeImpl: (target) => { target.kill(); },
    });
    try {
      const started = await runner.start();
      const create = child.requests.find((request) => request.method === "session/create");
      assert.deepEqual(create?.params.model, {
        providerId: "local-glm", modelId: "glm-5.3-flash_sub-coco", options: { reasoningLevel: "max" },
      });
      assert.equal(create?.params.thoughtLevel, "max");
      const thoughts = child.requests.filter((request) => request.method === "session/setThoughtLevel");
      assert.deepEqual(thoughts.map((request) => request.params.thoughtLevel), ["max"]);
      assert.equal(started.settings.thinking, "max");
      await assert.rejects(runner.setThoughtLevel(requested), /did not advertise/);
      assert.equal(child.requests.filter((request) => request.method === "session/setThoughtLevel").length, 1);
    } finally {
      await runner.dispose();
    }
  });
}

test("advertised requested thought is applied only after the ZCode snapshot is available", async () => {
  const child = new FakeZcode();
  const runner = new ZcodeInteractiveRunner({
    cwd: process.cwd(), model: "local-glm/glm-5.3-flash$max", thinkingMode: "high",
    spawnImpl: () => child, killTreeImpl: (target) => { target.kill(); },
  });
  try {
    const started = await runner.start();
    assert.equal(child.requests[0].method, "session/create");
    assert.equal(child.requests[0].params.thoughtLevel, "max");
    const selection = child.requests.find((request) => request.method === "session/setModel");
    assert.deepEqual(selection?.params.model, {
      providerId: "local-glm", modelId: "glm-5.3-flash", options: { reasoningLevel: "high" },
    });
    assert.equal(started.settings.thinking, "high");
  } finally {
    await runner.dispose();
  }
});

test("models without advertised reasoning options do not receive a thought override", async () => {
  const child = new FakeZcode([]);
  const runner = new ZcodeInteractiveRunner({
    cwd: process.cwd(), model: "local-provider/plain-model", thinkingMode: "high",
    spawnImpl: () => child, killTreeImpl: (target) => { target.kill(); },
  });
  try {
    const started = await runner.start();
    assert.equal(child.requests[0].params.thoughtLevel, undefined);
    assert.deepEqual(child.requests.find((request) => request.method === "session/setModel")?.params.model, {
      providerId: "local-provider", modelId: "plain-model",
    });
    assert.equal(child.requests.some((request) => request.method === "session/setThoughtLevel"), false);
    assert.equal(started.settings.thinkingEnabled, false);
  } finally {
    await runner.dispose();
  }
});

test("reused and resumed sessions apply each turn's UI reasoning before the configured model default", async () => {
  for (const localSessionId of [null, "sess_existing"]) {
    const child = new FakeZcode();
    const runner = new ZcodeInteractiveRunner({
      cwd: process.cwd(), model: "local-glm/glm-5.3-flash$max", thinkingMode: "max", localSessionId,
      spawnImpl: () => child, killTreeImpl: (target) => { target.kill(); },
    });
    try {
      await runner.start();
      await runner.start();
      await runner.setModel("local-glm/glm-5.3-flash$max", "high");
      const selection = child.requests.filter((request) => request.method === "session/setModel").at(-1);
      assert.deepEqual(selection?.params.model, {
        providerId: "local-glm", modelId: "glm-5.3-flash", options: { reasoningLevel: "high" },
      });
      assert.equal(runner.getSettings().thinking, "high");
      assert.equal(child.requests.filter((request) => request.method === "session/setThoughtLevel").at(-1)?.params.thoughtLevel, "high");
      await runner.setModel("local-glm/glm-5.3-flash$max");
      assert.equal(runner.getSettings().thinking, "max");
      assert.equal(child.requests.filter((request) => request.method === "session/create" || request.method === "session/resume").length, 1);
    } finally {
      await runner.dispose();
    }
  }
});

test("model changes refresh native reasoning capabilities instead of inheriting the previous model's options", async () => {
  const child = new FakeZcode();
  const runner = new ZcodeInteractiveRunner({
    cwd: process.cwd(), model: "local-glm/glm-5.3-flash$max",
    spawnImpl: () => child, killTreeImpl: (target) => { target.kill(); },
  });
  try {
    await runner.start();
    child.responseForRequest = (request) => request.method === "session/setModel" ? {
      snapshot: {
        protocol: { name: "ZCode Protocol", version: 1 },
        settings: {
          model: { current: request.params.model, available: [] },
          mode: { current: "yolo" },
          thoughtLevel: { current: null, available: [], enabled: false },
        },
      },
    } : undefined;
    const thoughtCount = child.requests.filter((request) => request.method === "session/setThoughtLevel").length;
    await runner.setModel("local-provider/plain-model", "high");
    assert.deepEqual(child.requests.filter((request) => request.method === "session/setModel").at(-1)?.params.model, {
      providerId: "local-provider", modelId: "plain-model",
    });
    assert.equal(child.requests.filter((request) => request.method === "session/setThoughtLevel").length, thoughtCount);
    assert.equal(runner.getSettings().thinkingEnabled, false);
    assert.deepEqual(runner.getSettings().thinkingOptions, []);
  } finally {
    await runner.dispose();
  }
});

test("native settings must confirm an applied reasoning level and RPC failures remain visible", async () => {
  const child = new FakeZcode();
  const runner = new ZcodeInteractiveRunner({
    cwd: process.cwd(), model: "local-glm/glm-5.3-flash$max",
    spawnImpl: () => child, killTreeImpl: (target) => { target.kill(); },
  });
  try {
    await runner.start();
    child.responseForRequest = (request) => request.method === "session/setThoughtLevel" ? {
      protocol: { name: "ZCode Protocol", version: 1 },
      settings: {
        model: { current: { providerId: "local-glm", modelId: "glm-5.3-flash" }, available: [] },
        thoughtLevel: { current: "max", available: ["low", "high", "max"].map((value) => ({ value })), enabled: true },
      },
    } : undefined;
    await assert.rejects(runner.setThoughtLevel("high"), /did not apply reasoning level high/);
    assert.equal(runner.getSettings().thinking, "max");
    child.failedMethod = "session/setModel";
    await assert.rejects(runner.setModel("local-glm/glm-5.3-flash$max", "high"), /startup failure/);
  } finally {
    await runner.dispose();
  }
});
