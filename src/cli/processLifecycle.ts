import type { ChildProcess } from "child_process";
import type { CleanupResult } from "../runtime/departmentexecutionidentity";

export type ProcessLifecycleEvidence = {
  processTerminal: CleanupResult;
  streams: CleanupResult;
};

/** Observe the actual child and its owned stdio, before callers end stdin or read
 * output. No PID probing, kill request, exit event or timer settles this port.
 * This does not prove descendant-process, runner/session or filesystem cleanup.
 */
export function observeChildProcessLifecycle(child: ChildProcess): Promise<ProcessLifecycleEvidence> {
  return new Promise((resolve) => {
    let spawned = false;
    let childClosed = false;
    const streams: { ended: boolean; closed: boolean; failed: boolean }[] = [];
    const removers: (() => void)[] = [];
    const finish = (): void => {
      // Node's own last-stdio close listener can emit ChildProcess.close before
      // our listener on that very same stream runs. Join the actual events.
      if (!childClosed || streams.some((state) => !state.closed)) return;
      for (const remove of removers) remove();
      child.removeListener("spawn", onSpawn);
      child.removeListener("error", onError);
      resolve({
        processTerminal: spawned ? { status: "confirmed", evidence: "child-process-close" }
          : { status: "unobservable", reason: "child-never-observed-spawn" },
        streams: streams.every((state) => state.ended && !state.failed)
          ? { status: "confirmed", evidence: "owned-stdio-ended-and-closed" }
          : { status: "unobservable", reason: "owned-stdio-not-drained" },
      });
    };
    for (const [stream, endEvent] of [[child.stdin, "finish"], [child.stdout, "end"], [child.stderr, "end"]] as const) {
      if (!stream) continue; // stdio explicitly ignored/inherited by the launcher
      // An incomplete/custom process port must keep legacy callbacks usable,
      // while contributing no positive lifecycle evidence.
      if (typeof stream.once !== "function" || typeof stream.removeListener !== "function") {
        streams.push({ ended: false, closed: true, failed: true });
        continue;
      }
      const state = { ended: false, closed: false, failed: false };
      streams.push(state);
      const onEnd = (): void => { state.ended = true; };
      const onClose = (): void => { state.closed = true; finish(); };
      const onError = (): void => { state.failed = true; };
      stream.once(endEvent, onEnd);
      stream.once("close", onClose);
      stream.on("error", onError);
      removers.push(() => { stream.removeListener(endEvent, onEnd); stream.removeListener("close", onClose); stream.removeListener("error", onError); });
    }
    const onSpawn = (): void => { spawned = true; };
    // A ChildProcess error may concern a signal or IPC write, not termination.
    // Consume it for this observer, but continue waiting for real close.
    const onError = (): void => undefined;
    child.once("spawn", onSpawn);
    child.on("error", onError);
    child.once("close", () => {
      childClosed = true;
      finish();
    });
  });
}
