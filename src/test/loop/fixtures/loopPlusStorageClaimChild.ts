import { claimOrdinaryLaunch } from "../../../loopPlusLaunchReservation";
import { readLoopTaskRecord, updateLoopTaskRecord, type LoopTaskRecord } from "../../../loopTaskStore";

process.once("message", async (expected: LoopTaskRecord) => {
  let reportedWait = false;
  try {
    const started = await claimOrdinaryLaunch(expected, "plot", "plot-2", new AbortController().signal, (id, options) => {
      return readLoopTaskRecord(id, { onUnavailable(reason) {
        if (!reportedWait && reason === "identity-lock-present") {
          reportedWait = true;
          process.send?.("waiting");
        }
        options?.onUnavailable?.(reason);
      } });
    }, (parent, patch) => updateLoopTaskRecord(parent.id, patch, {
      expectedOrdinaryRun: { updatedAt: parent.updatedAt, taskStoreFile: parent.taskStoreFile }, throwOnIdentityLock: true,
    }));
    process.send?.(started ? "started" : "already-claimed");
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally { process.disconnect?.(); }
});
