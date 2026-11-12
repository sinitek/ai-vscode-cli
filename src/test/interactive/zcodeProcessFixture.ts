import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { InteractiveTurnAttemptPort } from "../../extensionHost/interactiveTurnStrategy";

export type Request = { id: number; method: string; params: Record<string, unknown> };

export class FakeZcode extends EventEmitter {
  public readonly stdin = new PassThrough();
  public readonly stdout = new PassThrough();
  public readonly stderr = new PassThrough();
  public readonly exitCode: number | null = null;
  public readonly requests: Request[] = [];
  public beforeSendReply?: (request: Request) => void;
  public beforeCompactReply?: (request: Request) => void;
  public sendAccepted = true;
  public compactState = "accepted";
  public contextUsed = 1234;
  public failedMethod?: string;
  public withholdMethod?: string;
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
        if (request.method === this.withholdMethod) continue;
        if (request.method === this.failedMethod) {
          this.stdout.write(`${JSON.stringify({ id: request.id, error: { code: -32603, message: "startup failure" } })}\n`);
          continue;
        }
        if (request.method === "session/send") {
          this.beforeSendReply?.(request);
        }
        if (request.method === "session/compact") {
          this.beforeCompactReply?.(request);
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
          : request.method === "session/compact" ? { compact: { state: this.compactState } }
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
    this.exit(0);
    return true;
  }

  public exit(code: number): void {
    this.stdout.end();
    this.stderr.end();
    this.emit("exit", code);
    setImmediate(() => this.emit("close", code));
  }

  public completeTurn(content: string): void {
    this.emitEvent("turn.completed", { response: content });
  }

  public emitCompactionState(reason: string, sessionId = "sess_test", scope = "session"): void {
    this.stdout.write(`${JSON.stringify({ method: "state.updated", params: { reason, sessionId, scope } })}\n`);
  }

  public emitEvent(type: string, payload: Record<string, unknown>): void {
    this.stdout.write(`${JSON.stringify({
      method: "session/event",
      params: { sessionId: "sess_test", type, payload },
    })}\n`);
  }
}

export function managedZcodeFixture() {
  const zcodeModule = require("../../interactive/zcodeRunner") as typeof import("../../interactive/zcodeRunner");
  const { InteractiveRunnerManager } = require("../../interactive/manager") as typeof import("../../interactive/manager");
  const original = zcodeModule.ZcodeInteractiveRunner;
  const children: FakeZcode[] = [];
  // Only replace process I/O. All manager, strategy and runner lifecycle code is real.
  zcodeModule.ZcodeInteractiveRunner = class extends original {
    constructor(options: import("../../interactive/zcodeRunner").ZcodeRunnerOptions) {
      super({ ...options, spawnImpl: () => {
        const child = new FakeZcode();
        child.beforeSendReply = () => child.completeTurn("done");
        child.beforeCompactReply = () => child.emitCompactionState("session_compacted");
        children.push(child);
        return child;
      }, killTreeImpl: () => {} });
    }
  };
  const manager = new InteractiveRunnerManager();
  const options = (configFingerprint: string, sessionId = "ui-session") => ({
    sessionId, configFingerprint, command: "zcode", agentArgs: [], cwd: process.cwd(),
    thinkingMode: "off" as const, interactiveMode: "coding" as const,
    model: null, localSessionId: "sess_test",
  });
  function port(configFingerprint: string, sessionId = "ui-session") {
    let active = true;
    let stop = () => {};
    const value = {
      cli: "zcode", uiSessionId: sessionId, configFingerprint, cwd: process.cwd(),
      attemptPrompt: "test", interactiveRunsByTabId: new Map(),
      commandForRunner: "zcode", thinkingMode: "off", interactiveMode: "coding",
      zcodeLaunch: { agentArgs: [], env: {}, modeId: null, modelRef: null, thinkingValue: null },
      interactiveRunnerManager: manager, resolveInteractiveMappedId: () => "sess_test",
      setStopCurrentTurn: (fn: () => void) => { stop = fn; }, syncInteractiveRunEntry: () => {},
      isCurrentRunActive: () => active, updateSessionForNewRun: () => {},
      sendPanelMessage: () => {}, appendDebugEvent: () => {},
      appendAssistantChunkForTab: () => {}, appendTraceMessageForTab: () => {},
      settleInteractiveAttempt: async () => "return",
    } as unknown as InteractiveTurnAttemptPort;
    return { value, stop: () => stop(), deactivate: () => { active = false; } };
  }
  function release(child: FakeZcode) {
    child.emit("exit", 0);
    child.emit("close", 0);
    child.stdout.end();
    child.stderr.end();
  }
  return { manager, children, options, port, release, cleanup: async () => {
    manager.disposeAll();
    children.forEach(release);
    await new Promise<void>((resolve) => setImmediate(resolve));
    zcodeModule.ZcodeInteractiveRunner = original;
  } };
}
