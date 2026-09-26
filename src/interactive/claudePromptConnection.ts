const liveClaudeConnections = new Set<ClaudePromptConnection>();

export function countAliveClaudeLongConnections(): number {
  let count = 0;
  for (const connection of liveClaudeConnections) {
    if (connection.isAlive()) {
      count += 1;
    }
  }
  return count;
}

type ClaudePromptQuery = AsyncIterable<unknown> & {
  interrupt?: () => Promise<unknown>;
  close?: () => void;
};

type ClaudePromptTurn = {
  prompt: string;
  onMessage: (message: unknown) => "continue" | "done" | Promise<"continue" | "done">;
  sent: boolean;
  interrupted: boolean;
  userDone: boolean;
  protocolDone: boolean;
  resolve: () => void;
  reject: (error: unknown) => void;
  resolveProtocol: () => void;
  protocol: Promise<void>;
};

function createAbortError(): Error {
  const error = new Error("Claude run aborted");
  error.name = "AbortError";
  return error;
}

function createClosedError(): Error {
  const error = new Error("Claude long connection is closed");
  error.name = "ClaudeConnectionClosedError";
  return error;
}

export class ClaudePromptConnection {
  private readonly queue: ClaudePromptTurn[] = [];
  private active: ClaudePromptTurn | null = null;
  private query: ClaudePromptQuery | null = null;
  private abortController: AbortController | null = null;
  private waiting: ((turn: ClaudePromptTurn | null) => void) | null = null;
  private pendingYield: ClaudePromptTurn | null = null;
  private closed = false;
  private exited = false;
  private deliveredMessage = false;
  private completedTurn = false;
  private readerStarted = false;

  public isAlive(): boolean {
    return this.readerStarted && !this.closed && !this.exited;
  }

  public hasActiveTurn(): boolean {
    return this.active !== null || this.queue.length > 0;
  }

  public hasDeliveredMessage(): boolean {
    return this.deliveredMessage;
  }

  public hasCompletedTurn(): boolean {
    return this.completedTurn;
  }

  public getAbortController(): AbortController | null {
    return this.abortController;
  }

  public async start(
    queryFn: (input: { prompt: AsyncIterable<unknown>; options: Record<string, unknown> }) => AsyncIterable<unknown>,
    options: Record<string, unknown>,
  ): Promise<void> {
    if (this.readerStarted || this.closed) {
      throw createClosedError();
    }
    const abortController = options.abortController instanceof AbortController
      ? options.abortController
      : new AbortController();
    this.abortController = abortController;
    const query = queryFn({
      prompt: this.prompts(),
      options: {
        ...options,
        abortController,
      },
    }) as ClaudePromptQuery;
    this.query = query;
    this.readerStarted = true;
    liveClaudeConnections.add(this);
    void this.read(query);
  }

  public runTurn(
    prompt: string,
    onMessage: ClaudePromptTurn["onMessage"],
  ): Promise<void> {
    if (!this.isAlive()) {
      return Promise.reject(createClosedError());
    }
    return new Promise((resolve, reject) => {
      let resolveProtocol: () => void = () => undefined;
      const protocol = new Promise<void>((resolveProtocolPromise) => {
        resolveProtocol = resolveProtocolPromise;
      });
      this.queue.push({
        prompt,
        onMessage,
        sent: false,
        interrupted: false,
        userDone: false,
        protocolDone: false,
        resolve,
        reject,
        resolveProtocol,
        protocol,
      });
      this.pump();
    });
  }

  public interruptActiveTurn(): boolean {
    const active = this.active;
    if (!active) {
      const queued = this.queue.shift();
      if (!queued) {
        return false;
      }
      this.rejectTurn(queued, createAbortError());
      return true;
    }
    if (!active.sent || typeof this.query?.interrupt !== "function") {
      return false;
    }
    active.interrupted = true;
    this.rejectTurn(active, createAbortError());
    void this.query.interrupt().catch(() => undefined);
    return true;
  }

  public close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.exited = true;
    liveClaudeConnections.delete(this);
    const active = this.active;
    this.active = null;
    if (active) {
      this.finishProtocol(active, createAbortError());
    }
    while (this.queue.length > 0) {
      const turn = this.queue.shift();
      if (turn) {
        this.finishProtocol(turn, createAbortError());
      }
    }
    if (this.pendingYield) {
      const pending = this.pendingYield;
      this.pendingYield = null;
      this.finishProtocol(pending, createAbortError());
    }
    const waiting = this.waiting;
    this.waiting = null;
    waiting?.(null);
    this.abortController?.abort();
    try {
      this.query?.close?.();
    } catch {
      // The process is already being torn down by abort.
    }
  }

  private pump(): void {
    if (this.closed || this.active) {
      return;
    }
    const turn = this.queue.shift();
    if (!turn) {
      return;
    }
    this.active = turn;
    this.requestYield(turn);
  }

  private requestYield(turn: ClaudePromptTurn): void {
    if (this.waiting) {
      const resolve = this.waiting;
      this.waiting = null;
      resolve(turn);
      return;
    }
    this.pendingYield = turn;
  }

  private waitForTurn(): Promise<ClaudePromptTurn | null> {
    if (this.closed) {
      return Promise.resolve(null);
    }
    if (this.pendingYield) {
      const turn = this.pendingYield;
      this.pendingYield = null;
      return Promise.resolve(turn);
    }
    return new Promise((resolve) => {
      this.waiting = resolve;
    });
  }

  private async *prompts(): AsyncGenerator<unknown> {
    while (!this.closed) {
      const turn = await this.waitForTurn();
      if (!turn || this.closed) {
        return;
      }
      if (turn.userDone) {
        this.finishProtocol(turn, createAbortError());
        continue;
      }
      turn.sent = true;
      yield {
        type: "user",
        session_id: "",
        parent_tool_use_id: null,
        message: {
          role: "user",
          content: [{ type: "text", text: turn.prompt }],
        },
      };
      await turn.protocol;
    }
  }

  private async read(query: ClaudePromptQuery): Promise<void> {
    try {
      for await (const message of query) {
        const turn = this.active;
        if (!turn || !turn.sent) {
          continue;
        }
        if (turn.interrupted) {
          if (isResultMessage(message)) {
            this.finishProtocol(turn, createAbortError());
          }
          continue;
        }
        this.deliveredMessage = true;
        try {
          const outcome = await turn.onMessage(message);
          if (outcome === "done") {
            this.finishProtocol(turn, null);
          }
        } catch (error) {
          this.finishProtocol(turn, error);
          this.close();
          return;
        }
      }
      this.failOpenTurn(new Error("Claude stream ended"));
    } catch (error) {
      this.failOpenTurn(error);
    } finally {
      this.exited = true;
      liveClaudeConnections.delete(this);
    }
  }

  private failOpenTurn(error: unknown): void {
    const turn = this.active;
    this.active = null;
    if (turn) {
      this.finishProtocol(turn, error);
    }
    while (this.queue.length > 0) {
      const queued = this.queue.shift();
      if (queued) {
        this.finishProtocol(queued, error);
      }
    }
  }

  private rejectTurn(turn: ClaudePromptTurn, error: unknown): void {
    if (turn.userDone) {
      return;
    }
    turn.userDone = true;
    turn.reject(error);
  }

  private finishProtocol(turn: ClaudePromptTurn, error: unknown): void {
    if (turn.protocolDone) {
      return;
    }
    turn.protocolDone = true;
    turn.resolveProtocol();
    if (this.active === turn) {
      this.active = null;
    }
    if (!turn.userDone) {
      turn.userDone = true;
      if (error) {
        turn.reject(error);
      } else {
        this.completedTurn = true;
        turn.resolve();
      }
    } else if (!error) {
      this.completedTurn = true;
    }
    this.pump();
  }
}

function isResultMessage(message: unknown): boolean {
  return Boolean(message && typeof message === "object" && (message as { type?: unknown }).type === "result");
}
