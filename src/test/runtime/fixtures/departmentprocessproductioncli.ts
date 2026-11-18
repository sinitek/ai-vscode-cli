import * as fs from "fs";
import * as path from "path";
import { spawn } from "child_process";
const directory = process.env.DEPARTMENT_FIXTURE_DIRECTORY!;
const mode = process.argv[2];
function waitFor(file: string, done: () => void): void {
  if (fs.existsSync(file)) { done(); return; }
  const timer = setInterval(() => { if (fs.existsSync(file)) { clearInterval(timer); done(); } }, 5);
}
if (mode === "serve") require("./departmentopencodesessioncli");
else if (mode === "export") {
  fs.writeFileSync(path.join(directory, "export-ready"), "ready");
  const exported = () => process.stdout.write(JSON.stringify({ info: { id: process.env.DEPARTMENT_FIXTURE_BAD_SESSION ? "ses_wrong" : process.argv[3], directory: fs.realpathSync(process.cwd()) } }));
  if (process.env.DEPARTMENT_FIXTURE_EXPORT_GATE) waitFor(path.join(directory, "export-open"), exported);
  else exported();
} else if (mode === "tail") {
  fs.writeFileSync(path.join(directory, "tail-ready"), "ready");
  waitFor(path.join(directory, "drain"), () => { process.stdout.write('tail-output\n'); process.stderr.write('tail-error\n'); });
} else if (mode === "run") {
  const runtime = JSON.parse(fs.readFileSync(path.join(directory, "runtime", Buffer.from("root").toString("hex") + ".json"), "utf8"));
  const bindings = runtime.executionBindings;
  if (!bindings?.length || bindings[0].identity.session.id !== "ses_fixture") process.exit(91);
  if (process.env.DEPARTMENT_FIXTURE_TASK_FILE) {
    const saved = JSON.parse(fs.readFileSync(process.env.DEPARTMENT_FIXTURE_TASK_FILE, "utf8"));
    if (!saved.tasks?.find((task: { id: string }) => task.id === "leader")?.subTasks
      .some((subtask: { id: string; executionSession?: { sessionId: string } }) => subtask.id === "subtask" && subtask.executionSession?.sessionId === "ses_fixture")) process.exit(93);
  }
  fs.appendFileSync(path.join(directory, "spawn-count"), "spawn\n");
  fs.writeFileSync(path.join(directory, "observed"), JSON.stringify({ identity: bindings[0].identity,
    ownerPid: process.ppid, pid: process.pid, cwd: process.cwd(), pwd: process.env.PWD }));
  process.stdout.write(JSON.stringify({ type: "text", sessionID: "ses_fixture", part: { type: "text", text: "正确会话回答" } }) + "\n");
  const tail = spawn(process.execPath, [__filename, "tail"], { stdio: ["ignore", process.stdout, process.stderr], env: process.env });
  tail.unref();
  waitFor(path.join(directory, "exit"), () => process.exit(0));
} else {
  process.exitCode = 92;
}
