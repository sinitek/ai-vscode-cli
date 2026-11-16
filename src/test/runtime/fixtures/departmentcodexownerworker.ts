import * as fs from "fs";
import * as path from "path";
import { spawn } from "child_process";
import { createDepartmentCodexExecutionLauncher, type PreparedDepartmentCodexExecution } from "../../../runtime/departmentcodexexecutionlauncher";
import { DepartmentExecutionOwnerServer } from "../../../runtime/departmentexecutionowner";
import { DepartmentExecutionOwnerClient } from "../../../runtime/departmentexecutionownerclient";
import { sameExecution, type DepartmentExecutionIdentity, type DepartmentExecutionSelection } from "../../../runtime/departmentexecutionidentity";

export function waitFile(file: string): Promise<void> {
  return waitCondition(path.dirname(file), () => fs.existsSync(file));
}
export function waitCondition(directory: string, condition: () => boolean): Promise<void> {
  if (condition()) return Promise.resolve();
  return new Promise((resolve) => {
    const check = (): void => { if (condition()) { watcher.close(); resolve(); } };
    const watcher = fs.watch(directory, check); check();
  });
}
export function mark(directory: string, name: string): void { fs.writeFileSync(path.join(directory, name), "fixture\n"); }

/** Test protocol only: does not assert that installed Codex supports EOF shutdown. */
const SERVER = String.raw`
const fs=require('fs'),path=require('path'),readline=require('readline');
if(process.argv.includes('--version')){console.log('codex-cli 0.167.0');return;}
const file=n=>path.join(ROOT,n),mark=n=>fs.writeFileSync(file(n),'ok');
const send=m=>process.stdout.write(JSON.stringify(m)+'\n');
const seen=new Set();let request;
function controls(){for(const name of fs.readdirSync(ROOT)){
 if(!/^control-.*\.json$/.test(name)||seen.has(name))continue;seen.add(name);
 const c=JSON.parse(fs.readFileSync(file(name),'utf8'));
 for(const m of c.messages||[])send(m);
 if(c.response)send({id:request,result:{turn:{id:c.response}}});
 if(c.exit){watcher.close();process.exit(0);}
 if(c.close){send({method:'fixture/tail',params:{threadId:'native'}});mark('tail-written');watcher.close();process.stdout.end();process.stderr.end();}
 mark(name+'.ack');
}}
const watcher=fs.watch(ROOT,controls);
readline.createInterface({input:process.stdin}).on('line',line=>{
 const m=JSON.parse(line);fs.appendFileSync(file('wire.jsonl'),line+'\n');
 if(!m.method)return;
 if(m.method==='initialize')send({id:m.id,result:{}});
 else if(m.method==='thread/start'||m.method==='thread/resume'){
  send({id:m.id,result:{thread:{id:BAD?'wrong':'native'}}});mark('prepared');
 }else if(m.method==='turn/start'){request=m.id;mark('task-started');}
 else if(m.id!==undefined)send({id:m.id,result:{}});
});
process.stdin.on('end',()=>{mark('stdin-eof');
 if(HOLD_PIPE){
  const child=require('child_process').spawn(process.execPath,[WORKER,'tail',ROOT],{stdio:['ignore',process.stdout,process.stderr]});child.unref();
  watcher.close();mark('parent-exiting');process.exit(0);
 }
});
controls();
`;

export function fixturePreparation(directory: string, identity: DepartmentExecutionIdentity, selection: DepartmentExecutionSelection,
  options: { bad?: boolean; holdPipe?: boolean } = {}): { prepared: PreparedDepartmentCodexExecution; signal: AbortController } {
  const script = path.join(directory, "protocol.cjs"), command = path.join(directory, process.platform === "win32" ? "protocol.cmd" : "protocol");
  const source = `const ROOT=${JSON.stringify(directory)},BAD=${!!options.bad},HOLD_PIPE=${!!options.holdPipe},WORKER=${JSON.stringify(__filename)};\n${SERVER}`;
  fs.writeFileSync(script, source);
  fs.writeFileSync(command, process.platform === "win32" ? `@"${process.execPath}" "${script}" %*\r\n` : `#!/usr/bin/env node\n${source}`);
  fs.chmodSync(command, 0o755);
  const signal = new AbortController();
  const prepared: PreparedDepartmentCodexExecution = {
    identity: structuredClone(identity), selection: structuredClone(selection),
    session: identity.session.state === "unbound" ? { intent: "new" } : { intent: "resume", threadId: identity.session.id },
    runner: { command, args: [], cwd: directory, env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot,
      PATHEXT: process.env.PATHEXT, HOME: directory, USERPROFILE: directory, CODEX_HOME: path.join(directory, ".codex") },
      threadId: identity.session.state === "bound" ? identity.session.id : null, thinkingMode: "medium", interactiveMode: "coding" },
    runtime: { macTaskShell: "bash", logInfo: () => {}, logError: () => {} }, prompt: "trusted fixture task", signal: signal.signal,
    confirmSession: async (session) => session,
    handlers: { onAssistantDelta: () => {}, onTrace: () => {}, onTaskListUpdate: () => {}, onThreadId: () => {} },
    resources: { runner: { owned: true, release: () => ({ status: "confirmed", evidence: "fixture-native-resource-released" }) },
      executionRoot: { owned: false }, links: { owned: false }, temp: { owned: false }, tab: { owned: false } },
  };
  return { prepared, signal };
}

async function main(): Promise<void> {
  const [, , mode, directory, option] = process.argv;
  const file = (name: string): string => path.join(directory, name);
  if (mode === "tail") {
    mark(directory, "pipe-ready"); await waitFile(file("release-pipe"));
    await new Promise<void>((resolve) => process.stdout.write(JSON.stringify({ method: "fixture/tail", params: { threadId: "native" } }) + "\n", () => resolve()));
    mark(directory, "tail-written"); return;
  }
  if (mode === "client-start") {
    const { identity } = JSON.parse(fs.readFileSync(file("trusted-input"), "utf8"));
    process.stdout.write(JSON.stringify(await new DepartmentExecutionOwnerClient(directory).startExecution(identity)) + "\n"); return;
  }
  if (mode !== "owner") throw new Error("fixture-mode-invalid");
  const { identity, selection } = JSON.parse(fs.readFileSync(file("trusted-input"), "utf8"));
  const { prepared, signal } = fixturePreparation(directory, identity, selection, { holdPipe: option === "pipe" });
  prepared.confirmSession = async (session) => {
    fs.writeFileSync(file("binding-session"), JSON.stringify(session));
    await waitFile(file("release-binding"));
    if (option === "reject-binding") throw new Error("fixture-binding-refused");
    mark(directory, "persist-confirmed"); return session;
  };
  prepared.handlers.onNotification = async (message) => {
    if (message.method === "fixture/tail") mark(directory, "tail-consumed");
    if (message.method === "fixture/fail") throw new Error("fixture-callback-failed");
    if (message.method === "fixture/callback") { mark(directory, "callback-entered"); await waitFile(file("release-callback")); }
  };
  prepared.handlers.onRequest = async () => {
    mark(directory, "handler-entered"); await waitFile(file("release-handler")); return { result: {} };
  };
  for (const part of ["runner", "executionRoot", "links", "temp", "tab"] as const) {
    if (part !== "runner") mark(directory, "resource-" + part);
    prepared.resources[part] = { owned: true, release: () => {
      fs.appendFileSync(file("releases"), part + "\n");
      if (option === "fail-resource" && part === "links") return { status: "failed", reason: "fixture-links-failure" };
      if (part !== "runner") fs.unlinkSync(file("resource-" + part));
      return { status: "confirmed", evidence: "fixture-resource-removed" };
    } };
  }
  if (option === "missing-resource") prepared.resources.runner = { owned: true };
  const launcher = createDepartmentCodexExecutionLauncher((query) => {
    fs.appendFileSync(file("resolutions"), "resolve\n");
    return sameExecution(query, identity) ? prepared : null;
  });
  const server = new DepartmentExecutionOwnerServer({ directory, ownerId: identity.ownerId, launcher });
  await server.listen();
  if (Object.keys(require.cache).some((key) => /vscodeMock|[\\/]vscode[\\/]|[\\/]codexRuntimeHost.js$/.test(key))) throw new Error("fixture-forbidden-host");
  process.send?.({ ready: true });
  process.on("message", (message: any) => {
    if (message?.cancel) signal.abort(); // private fixture control, never public Owner IPC
    if (message?.shutdown) void server.close().then(() => process.disconnect(), () => process.send?.({ shutdownRejected: true }));
  });
}
if (require.main === module) void main().catch((error) => { process.stderr.write(String(error)); process.exitCode = 2; });
