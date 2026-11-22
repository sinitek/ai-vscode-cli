import { performance } from "node:perf_hooks";

export const LOOP_WAIT_WATCHDOG_INTERVAL_MS = 5 * 60 * 1000;
const LOOP_WAIT_WATCHDOG_TICK_MS = 60 * 1000;

/** 每个宿主共用一个巡检时钟；单个任务检查失败不影响其它检查。 */
export function startLoopWaitWatchdog(
  checks: readonly (() => void)[],
  onError: (error: unknown) => void,
  checkLoopPlusMain?: () => void,
): () => void {
  let disposed = false;
  let lastWaitCheckAt = performance.now();
  const runCheck = (check: () => void): void => {
    if (disposed) return;
    try {
      check();
    } catch (error) {
      onError(error);
    }
  };
  const timer = setInterval(() => {
    if (checkLoopPlusMain) runCheck(checkLoopPlusMain);
    const now = performance.now();
    if (now - lastWaitCheckAt < LOOP_WAIT_WATCHDOG_INTERVAL_MS) return;
    lastWaitCheckAt = now;
    for (const check of checks) runCheck(check);
  }, LOOP_WAIT_WATCHDOG_TICK_MS);
  timer.unref();
  return () => {
    disposed = true;
    clearInterval(timer);
  };
}

/** 放弃已确认失联的等待，同时消费迟到的 resolve/reject。 */
export function waitForLoopInvocation<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => {
      signal.removeEventListener("abort", onAbort);
      reject(signal.reason);
    };
    if (signal.aborted) onAbort();
    else signal.addEventListener("abort", onAbort, { once: true });
    promise.then((value) => {
      signal.removeEventListener("abort", onAbort);
      resolve(value);
    }, (error) => {
      signal.removeEventListener("abort", onAbort);
      reject(error);
    });
  });
}
