export function createRunnerEvidenceFixture(supported = true, command = "C:/isolated CLI/codex.cmd") {
  let sequence = 4;
  const events: { process: number; method: string; direction: string; threadId: string; seq: number; status?: string; persisted?: boolean; failed?: boolean }[] = [];
  const event = (process: number, method: string, direction: string, threadId: string, extra = {}) => {
    events.push({ process, method, direction, threadId, seq: ++sequence, ...extra });
  };
  event(0, "thread/start", "response", "target", { persisted: true });
  event(0, "turn/start", "request", "target");
  event(0, "turn/completed", "notification", "target", { status: "failed" });
  event(0, "thread/start", "response", "peer");
  event(0, "turn/start", "request", "peer");
  event(0, "turn/completed", "notification", "peer", { status: "failed" });
  const migrationSeq = ++sequence;
  event(0, "thread/unsubscribe", "request", "target");
  event(0, "thread/unsubscribe", "response", "target", { status: "unsubscribed" });
  event(0, "thread/closed", "notification", "target");
  event(1, "thread/resume", "request", "target");
  event(1, "thread/resume", "response", "target");
  event(1, "turn/start", "request", "target");
  event(1, "turn/completed", "notification", "target", { status: "failed" });
  const peerCheckSeq = ++sequence;
  event(0, "turn/start", "request", "peer");
  event(0, "turn/completed", "notification", "peer", { status: "failed" });
  if (!supported) {
    for (const entry of events) {
      if (entry.process === 1) entry.process = 2;
      else if (entry.threadId === "peer") entry.process = 1;
      if (entry.method === "thread/closed") { entry.method = "process/exit"; entry.direction = "lifecycle"; }
    }
  }
  return {
    environment: { platform: process.platform, arch: process.arch },
    capabilities: [{ command, supported, reason: supported ? "supported" : "unknown", version: "0.162.1", seq: 1 }],
    probes: [{ command, version: "0.162.1", closed: true }],
    processes: (supported ? [123, 456] : [123, 456, 789]).map((pid, index) => ({ command, pid, seq: index + 2,
      args: ["app-server", "--listen", "stdio://", ...(supported ? ["-c", "thread_unload_delay_secs=0"] : [])] })),
    events, migrationSeq, peerCheckSeq, targetThread: "target", peerThread: "peer", elapsedMs: 43,
    localRequests: 4, cleanup: { processesExited: true, stdioClosed: true, temporaryDirectoryRemoved: true },
  };
}
