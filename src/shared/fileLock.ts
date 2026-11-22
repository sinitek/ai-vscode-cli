import * as fs from "fs";
import * as path from "path";
import { performance } from "perf_hooks";

const LOCK_TIMEOUT_MS = 1500;
const LOCK_POLL_INTERVAL_MS = 5;

function acquireFileLockSync(lockPath: string): number {
  const deadline = performance.now() + LOCK_TIMEOUT_MS;
  const pause = new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT));
  while (true) {
    try {
      return fs.openSync(lockPath, "wx", 0o600);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const remaining = deadline - performance.now();
      if (remaining <= 0) throw error;
      Atomics.wait(pause, 0, 0, Math.min(LOCK_POLL_INTERVAL_MS, remaining));
      if (performance.now() >= deadline) throw error;
    }
  }
}

export function withFileLockSync<T>(lockPath: string, replacementMessage: string, action: () => T): T {
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  const descriptor = acquireFileLockSync(lockPath);
  let identity: fs.BigIntStats | undefined;
  try {
    identity = fs.fstatSync(descriptor, { bigint: true });
    return action();
  } finally {
    fs.closeSync(descriptor);
    if (identity) {
      const current = fs.lstatSync(lockPath, { bigint: true });
      if (!current.isFile() || current.isSymbolicLink() || current.dev !== identity.dev || current.ino !== identity.ino) {
        throw new Error(replacementMessage);
      }
      fs.unlinkSync(lockPath);
    }
  }
}
