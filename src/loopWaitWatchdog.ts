export const LOOP_WAIT_WATCHDOG_INTERVAL_MS = 5 * 60 * 1000;

/** 每个宿主共用一个巡检时钟；单个任务检查失败不影响其它检查。 */
export function startLoopWaitWatchdog(
  checks: readonly (() => void)[],
  onError: (error: unknown) => void,
): () => void {
  const timer = setInterval(() => {
    for (const check of checks) {
      try {
        check();
      } catch (error) {
        onError(error);
      }
    }
  }, LOOP_WAIT_WATCHDOG_INTERVAL_MS);
  timer.unref();
  return () => clearInterval(timer);
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
