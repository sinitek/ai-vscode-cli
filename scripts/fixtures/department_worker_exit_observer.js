"use strict";
const fs = require("node:fs");
const path = require("node:path");
const cp = require("node:child_process");

/** Harness-only OS observation, independent of both Extension Hosts. */
function startColdWorkerExitObserver(root, deadline) {
  if (process.platform !== "darwin") throw new Error("cold worker exit observation requires a platform-specific kernel observer");
  const child = cp.spawn("python3", ["-u", path.join(__dirname, "department_worker_exit_observer.py")], {
    stdio: ["pipe", "pipe", "pipe"], env: { PATH: process.env.PATH }, windowsHide: true,
  });
  const events = [], errors = [], seen = new Set();
  let output = "", finished = false, exited = false;
  const file = path.join(root, "cold-worker-registrations.ndjson");
  child.stdout.on("data", chunk => {
    output += chunk;
    if (output.length > 65536) { errors.push("exit observer frame budget"); return; }
    let index;
    while ((index = output.indexOf("\n")) >= 0) {
      const line = output.slice(0, index); output = output.slice(index + 1);
      try {
        const value = JSON.parse(line);
        if (events.length >= 192) throw new Error("exit observer event budget");
        events.push(value);
        fs.appendFileSync(path.join(root, "cold-worker-exits.ndjson"), JSON.stringify(value) + "\n", { mode: 0o600 });
      } catch { errors.push("exit observer invalid output"); }
    }
  });
  child.stderr.on("data", () => errors.push("exit observer stderr"));
  child.stdin.on("error", () => errors.push("exit observer input failed"));
  child.once("error", () => errors.push("exit observer spawn failed"));
  const closed = new Promise(resolve => child.once("close", (code, signal) => {
    exited = true;
    if (!finished || code !== 0 || signal !== null) errors.push("exit observer unexpected exit");
    resolve();
  }));
  const scan = () => {
    if (finished || exited) return;
    if (Date.now() >= deadline) { errors.push("exit observer absolute deadline"); return; }
    try {
      if (!fs.existsSync(file)) return;
      const text = fs.readFileSync(file, "utf8");
      const lines = text.split("\n"); lines.pop(); // Never parse a partial append.
      if (lines.length > 256) throw new Error("exit observer registration budget");
      for (const line of lines) {
        const event = JSON.parse(line);
        if (event.event !== "worker-initialized" || seen.has(event.pid)) continue;
        if (seen.size >= 64 || !Number.isSafeInteger(event.pid) || event.pid <= 0
          || !/^department(?:generationauthority|leaderprocessowner|leadercodexowner|codexowner|processowner)worker\.js$/.test(event.worker)
          || !event.identity?.rootTaskId || !event.identity?.leaderTaskId || !Number.isSafeInteger(event.identity.generation)) throw new Error("exit observer invalid registration");
        seen.add(event.pid); child.stdin.write(JSON.stringify(event) + "\n");
      }
    } catch { errors.push("exit observer registration read failed"); }
  };
  const timer = setInterval(scan, 10); timer.unref();
  return {
    snapshot() { scan(); return { events: structuredClone(events), errors: [...errors] }; },
    async close() {
      if (finished) return; scan(); finished = true; clearInterval(timer);
      if (!exited) child.stdin.end('{"operation":"finish"}\n');
      let timeout;
      try { await Promise.race([closed, new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error("exit observer did not stop")), 2000); })]); }
      finally { clearTimeout(timeout); }
    },
  };
}

function requireColdWorkerExits(observed, originalSet, successorSet, successorBinding) {
  if (observed.errors.length) throw new Error("passive worker observer failed: " + observed.errors.join(","));
  const matches = (event, set) => event.identity.rootTaskId === set.scope.rootTaskId
    && event.identity.workspace === set.scope.workspace && event.identity.leaderTaskId === set.scope.leaderTaskId
    && event.identity.moduleId === set.scope.moduleId && event.identity.generation === set.scope.generation;
  const checks = [
    e => e.worker === "departmentgenerationauthorityworker.js" && matches(e, originalSet) && e.producerId === originalSet.producerId,
    e => e.worker === "departmentgenerationauthorityworker.js" && matches(e, successorSet) && e.producerId === successorSet.producerId,
    e => e.worker === (successorBinding.identity.cli === "opencode" ? "departmentleaderprocessownerworker.js" : "departmentleadercodexownerworker.js")
      && e.identity.role === "leader" && e.identity.ownerId === successorBinding.identity.ownerId && e.identity.executionId === successorBinding.identity.executionId && matches(e, successorSet),
  ];
  return checks.map((match, index) => {
    const exits = observed.events.filter(e => e.event === "kernel-worker-exit" && match(e));
    if (exits.length !== 1 || exits[0].code !== 0 || exits[0].signal !== null) throw new Error(`cold worker natural exit unconfirmed: ${["original authority", "successor authority", "successor Owner"][index]}`);
    return exits[0];
  });
}
module.exports = { startColdWorkerExitObserver, requireColdWorkerExits };
