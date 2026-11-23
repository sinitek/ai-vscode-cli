import type { Readable } from "stream";
import { StringDecoder } from "string_decoder";
import type { CleanupResult } from "../runtime/departmentexecutionidentity";

const UNICODE_LINE_SEPARATOR = /[\u2028\u2029]/g;

export type CodexAppServerNdjsonReader = {
  lines: AsyncIterable<string>;
  close: () => void;
  /** Natural EOF AND consumption of all queued lines; close() is not a drain. */
  drained: Promise<CleanupResult>;
};

export function serializeCodexAppServerMessage(message: Record<string, unknown>): string {
  const json = JSON.stringify(message).replace(UNICODE_LINE_SEPARATOR, (separator) => (
    separator === "\u2028" ? "\\u2028" : "\\u2029"
  ));
  return `${json}\n`;
}

export function createCodexAppServerNdjsonReader(stdout: Readable): CodexAppServerNdjsonReader {
  const decoder = new StringDecoder("utf8");
  const lineParts: string[] = [];
  const pendingLines: string[] = [];
  let streamEnded = false;
  let closed = false;
  let streamError: Error | null = null;
  let waiter: (() => void) | null = null;
  let consumedToEnd = false;
  let resolveDrain!: (result: CleanupResult) => void;
  const drained = new Promise<CleanupResult>((resolve) => { resolveDrain = resolve; });

  const wake = (): void => {
    const resolve = waiter;
    waiter = null;
    resolve?.();
  };

  const finishLine = (tail: string): void => {
    let line = tail;
    if (lineParts.length > 0) {
      if (tail.length > 0) lineParts.push(tail);
      line = lineParts.join("");
      lineParts.length = 0;
    }
    pendingLines.push(line.endsWith("\r") ? line.slice(0, -1) : line);
  };

  const enqueue = (text: string): void => {
    let start = 0;
    let index = text.indexOf("\n");
    while (index !== -1) {
      finishLine(text.slice(start, index));
      start = index + 1;
      index = text.indexOf("\n", start);
    }
    if (start < text.length) lineParts.push(text.slice(start));
    if (pendingLines.length > 0) wake();
  };

  const onData = (chunk: Buffer | string): void => {
    if (closed) {
      return;
    }
    enqueue(typeof chunk === "string" ? chunk : decoder.write(chunk));
  };

  const onEnd = (): void => {
    if (!closed) {
      enqueue(decoder.end());
      if (lineParts.length > 0) finishLine("");
    }
    streamEnded = true;
    wake();
  };

  const onError = (error: Error): void => {
    streamError = error;
    streamEnded = true;
    wake();
  };

  const onClose = (): void => {
    if (!closed && !streamEnded) {
      streamError = new Error("Codex NDJSON stream closed before natural EOF");
      streamEnded = true;
      wake();
    }
  };

  stdout.on("close", onClose);
  stdout.on("data", onData);
  stdout.on("end", onEnd);
  stdout.on("error", onError);

  const close = (): void => {
    if (closed) {
      return;
    }
    closed = true;
    resolveDrain(streamError ? { status: "failed", reason: "ndjson-stream-error" }
      : consumedToEnd ? { status: "confirmed", evidence: "ndjson-natural-eof-and-queue-drained" }
        : { status: "unobservable", reason: "ndjson-reader-closed-before-drain" });
    streamEnded = true;
    lineParts.length = 0;
    pendingLines.length = 0;
    stdout.off("close", onClose);
    stdout.off("data", onData);
    stdout.off("end", onEnd);
    stdout.off("error", onError);
    wake();
  };

  async function* iterate(): AsyncGenerator<string> {
    try {
      while (!closed) {
        if (pendingLines.length === 0) {
          if (streamError) {
            throw streamError;
          }
          if (streamEnded) {
            consumedToEnd = true;
            return;
          }
          await new Promise<void>((resolve) => {
            waiter = resolve;
            if (pendingLines.length > 0 || streamEnded || closed || streamError) {
              wake();
            }
          });
          continue;
        }
        const line = pendingLines.shift();
        if (line !== undefined) {
          yield line;
        }
      }
    } finally {
      close();
    }
  }

  return {
    lines: {
      [Symbol.asyncIterator]: () => iterate(),
    },
    close,
    drained,
  };
}
