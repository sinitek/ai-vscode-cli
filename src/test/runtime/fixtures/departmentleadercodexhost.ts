import * as fs from "fs";
import * as path from "path";
import { SharedRuntimeConfig } from "../../../config/sharedRuntimeConfig";
import { DepartmentRuntimeStore } from "../../../extensionHost/departmentruntimestore";
import { createDepartmentRuntimeSnapshot } from "../../../extensionHost/departmentruntimestate";
import { createDepartmentLeaderCodexBootstrap, type DepartmentLeaderCodexHost } from "../../../extensionHost/departmentleadercodexbootstrap";
import { fingerprintDepartmentExecutionSelection, type DepartmentExecutionIdentity, type DepartmentExecutionSelection } from "../../../runtime/departmentexecutionidentity";
import { fixtureEmployeeAdmission } from "./departmentemployeeadmission";
import { waitFile } from "./departmentcodexownerworker";

/** Free simulated NDJSON app-server; flags deliberately model missing terminal,
 * delayed raw prepare and held stdio. Not an installed Codex/model test. */
export const SIMULATED_LEADER_CLI = String.raw`
const fs=require('fs'),path=require('path'),readline=require('readline');
if(process.argv.includes('--version')){console.log('codex-cli 0.167.0');return;}
const file=n=>path.join(ROOT,n),exists=n=>fs.existsSync(file(n)),send=v=>process.stdout.write(JSON.stringify(v)+'\n');
fs.appendFileSync(file('native-pids'),String(process.pid)+'\n');
let native,turn,round,done=false,eof=false,replied=false;
function step(){
 if(native&&!exists('hold-native')){send({id:native.id,result:{thread:{id:exists('wrong-thread')?'wrong':'native'}}});native=null;}
 if(turn&&!replied){
  replied=true;send({id:turn.id,result:{turn:{id:'turn-'+round}}});
  for(let n=0;n<(exists('request-burst')?40:exists('request')?1:0);n++)send({id:'approval-'+n,method:'item/commandExecution/requestApproval',params:{threadId:'native',turnId:'turn-'+round}});
  for(let n=0;n<(exists('burst')?40:1);n++)send({method:'item/agentMessage/delta',params:{threadId:'native',turnId:'turn-'+round,itemId:'answer',delta:'fixture answer'}});
  if(exists('oversized-notification'))send({method:'fixture/oversized',params:{threadId:'native',data:'sensitive-native-data'.repeat(500000)}});
  if(exists('large-tool-output')){
   for(const [id,output] of [['compat','c'.repeat(51*1024)],['utf8','工具🌛\\\"\n'.repeat(8192)]]){
    send({method:'item/completed',params:{threadId:'native',turnId:'turn-'+round,item:{id,type:'commandExecution',command:'fixture',status:'completed',aggregatedOutput:output,exitCode:0}}});
    send({method:'item/agentMessage/delta',params:{threadId:'native',turnId:'turn-'+round,itemId:'answer',delta:'short-after-'+id}});
   }
  }
 }
 if(turn&&!done&&!exists('hold-terminal')){done=true;send({method:'turn/completed',params:{threadId:'native',turn:{id:'turn-'+round,status:'completed'}}});}
 if(eof&&!exists('hold-pipe')){watcher.close();process.stdout.end();process.stderr.end();}
}
const watcher=fs.watch(ROOT,step);
readline.createInterface({input:process.stdin}).on('line',line=>{
 const m=JSON.parse(line);fs.appendFileSync(file('wire.jsonl'),line+'\n');
 if(m.method==='initialize')send({id:m.id,result:{}});
 else if(m.method==='thread/start'||m.method==='thread/resume'){native=m;step();}
 else if(m.method==='turn/start'){turn=m;round=(exists('round')?Number(fs.readFileSync(file('round'),'utf8')):0)+1;fs.writeFileSync(file('round'),String(round));fs.writeFileSync(file('started-'+round),'ok');step();}
 else if(m.id!==undefined)send({id:m.id,result:{}});
});
process.stdin.on('end',()=>{eof=true;fs.writeFileSync(file('eof-'+(round||0)),'ok');step();});
`;

export async function leaderFixture(directory: string, options: { bound?: boolean; existing?: boolean } = {}) {
  const file = (n: string) => path.join(directory, n);
  fs.mkdirSync(file("workspace"), { recursive: true });
  fs.writeFileSync(file("workspace/source.txt"), "controlled fixture");
  const config = new SharedRuntimeConfig(file("configuration"));
  const current = options.existing ? JSON.parse(fs.readFileSync(file("current"), "utf8"))
    : await config.change(async () => ({ configId: "profile", profileDigest: null }));
  fs.writeFileSync(file("current"), JSON.stringify(current));
  const selection: DepartmentExecutionSelection = { version: 1, cli: "codex", role: "leader", configId: "profile", revision: current.revision,
    model: null, thinkingMode: "medium", openCodeVariant: null };
  const identity: DepartmentExecutionIdentity = { version: 1, workspace: "workspace", rootTaskId: "root", leaderTaskId: "leader", moduleId: "module", generation: 1,
    role: "leader", cli: "codex", ownerId: "leader-owner", executionId: "leader-execution", session: options.bound ? { state: "bound", id: "native" } : { state: "unbound" },
    ...fingerprintDepartmentExecutionSelection(selection) };
  const script = file("protocol.cjs"), command = file(process.platform === "win32" ? "protocol.cmd" : "protocol");
  fs.writeFileSync(script, `const ROOT=${JSON.stringify(directory)};\n${SIMULATED_LEADER_CLI}`);
  fs.writeFileSync(command, process.platform === "win32" ? `@"${process.execPath}" "${script}" %*\r\n` : `#!/usr/bin/env node\nconst ROOT=${JSON.stringify(directory)};\n${SIMULATED_LEADER_CLI}`);
  fs.chmodSync(command, 0o755);
  const store = new DepartmentRuntimeStore(file("runtime"));
  if (!options.existing) {
    const runtime = createDepartmentRuntimeSnapshot("root"); runtime.leaders.push({ taskId: "leader", leaderSubtaskId: "module", status: "running", generation: 1 });
    const result = store.write({ version: 1, rootTaskId: "root", workspaceKey: "workspace", runtime,
      capacity: { rootTaskId: "root", maxLeaders: 4, maxEmployees: 20, leaders: ["module"], employees: [] } });
    if (!result.ok) throw new Error(result.error);
  }
  const admission = fixtureEmployeeAdmission(store);
  // Use the fixture's complete controlled producer through a new instance only
  // for leader ports. It refuses closure; no production producer is fabricated.
  let revoked = false, tracked = true, active = 0;
  const producer = {
    producerId: "controlled-bootstrap-producer", beginTracking: () => tracked,
    isCurrent: () => tracked && !revoked,
    async withAdmission<T>(_scope: unknown, work: () => Promise<T>) { active++; try { return await work(); } finally { active--; } },
    async closeAdmissionsAndDrain(): Promise<never> { throw new Error("fixture-no-producer-closure"); },
  };
  const description = { configurationDirectory: file("configuration"), workspaceDirectory: file("workspace"), macTaskShell: "bash" as const, requestUserInputEnabled: false,
    runner: { command, args: [], env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, PATHEXT: process.env.PATHEXT,
      HOME: directory, USERPROFILE: directory, CODEX_HOME: file(".codex") }, thinkingMode: "medium" as const, interactiveMode: "coding" as const,
      model: null, threadId: options.bound ? "native" : null, configFingerprint: identity.configFingerprint } };
  let currentAuthority = true, builders = 0;
  if (options.bound && !options.existing) fs.writeFileSync(file("session"), JSON.stringify({ cli: "codex", sessionId: "native", configId: "profile" }));
  const host: DepartmentLeaderCodexHost = {
    store, producer, assertCurrent() { if (!currentAuthority) throw new Error("fixture-task-authority-revoked"); },
    async build() {
      builders++; if (admission.entries().length !== 1 || admission.entries()[0].executionId !== null) throw new Error("fixture-responsibility-missing-before-builder");
      fs.writeFileSync(file("builder"), "ok"); return description;
    },
    async persistSession(s) { fs.writeFileSync(file("session"), JSON.stringify({ cli: "codex", sessionId: s.threadId, configId: "profile" })); },
    readSession() { try { return JSON.parse(fs.readFileSync(file("session"), "utf8")); } catch { return null; } },
    handlers: { onAssistantDelta() {}, onTrace() {}, onTaskListUpdate() {}, onThreadId() {} },
  };
  const wire = () => { try { return fs.readFileSync(file("wire.jsonl"), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; } };
  return { file, directory, identity, selection, store, config, admission, host, description, wire,
    count: (method: string) => wire().filter((v) => v.method === method).length,
    port: () => createDepartmentLeaderCodexBootstrap(identity, selection, file("owner"), host),
    revoke() { revoked = true; }, revokeTask() { currentAuthority = false; }, get builders() { return builders; }, get active() { return active; },
    removeFlag(n: string) { fs.rmSync(file(n), { force: true }); }, flag(n: string) { fs.writeFileSync(file(n), "ok"); },
  };
}

async function main(): Promise<void> {
  const directory = process.argv[2];
  const h = await leaderFixture(directory, { existing: true });
  const port = h.port();
  await port.invoke({ invocationId: "main-1", prompt: "trusted fixture main" });
  await waitFile(h.file("started-1")); fs.writeFileSync(h.file("host-exiting"), String(process.pid));
  process.exit(0); // Original granted worker must survive real startup-host exit.
}
if (require.main === module) void main().catch((e) => { console.error(e); process.exit(1); });
