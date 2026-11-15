import type test = require("node:test");
import * as fs from "fs";
import * as path from "path";
import { productionWiring } from "./departmentproductionwiringfixture";
import { parseOpenCodeRunOutput, extractOpenCodeRuntimeSessionId } from "../../../cli/openCodeRunOutput";
import { createDepartmentLeaderNativeSessionValidator } from "../../../extensionHost/departmentleadernativesessionvalidation";
import type { DepartmentExecutionReceipt } from "../../../runtime/departmentexecutionreceiptstore";

/** File gates control fixture CLI timing; they are never cleanup evidence. */
const CLI = String.raw`
const fs=require('fs'),http=require('http'),path=require('path');
const file=n=>path.join(ROOT,n),log=v=>fs.appendFileSync(file('tree-events.jsonl'),JSON.stringify(v)+'\n');
const args=process.argv.slice(2);
fs.appendFileSync(file('native-pids'),String(process.pid)+'\n');
if(args.includes('serve')) {
 let session;
 const server=http.createServer((req,res)=>{
  const pathname=new URL(req.url,'http://127.0.0.1').pathname;
  if(req.method==='POST'&&pathname==='/session') {
   let body='';req.on('data',c=>body+=c);req.on('end',()=>{
    const n=fs.existsSync(file('session-count'))?Number(fs.readFileSync(file('session-count'),'utf8'))+1:1;
    fs.writeFileSync(file('session-count'),String(n));session='ses_tree'+n;
    log({kind:'session-created',session,body});res.setHeader('content-type','application/json');res.end(JSON.stringify({id:session,directory:process.cwd()}));
   });return;
  }
  if(req.method==='GET'&&pathname==='/session/'+session){log({kind:'session-verified',session});res.end(JSON.stringify({id:session,directory:process.cwd()}));return;}
  res.statusCode=404;res.end('{}');
 });
 server.listen(0,'127.0.0.1',()=>console.log('http://127.0.0.1:'+server.address().port));
 process.on('SIGTERM',()=>server.close(()=>{log({kind:'preparation-server-closed'});process.exit(0);}));
} else {
 const n=fs.existsSync(file('tree-round'))?Number(fs.readFileSync(file('tree-round'),'utf8'))+1:1;
 fs.writeFileSync(file('tree-round'),String(n));
 const i=args.indexOf('--session'),session=args[i+1];
 if(i<0||!/^ses_tree\d+$/.test(session)||args.filter(a=>a==='--session').length!==1||args.includes('-s'))process.exit(31);
 log({kind:'task-run',round:n,session,ownerPid:process.ppid});
 const reply=JSON.parse(fs.readFileSync(file('answer-'+n),'utf8'));
 const review=args[args.length-1].match(/^Current review eventId: (.+)$/m)?.[1];
 // Echo the actual scheduler prompt's single-event confirmation, like a model.
 // The production parser and scheduler still decide whether to accept it.
 if(reply.status==='completed'&&review&&review!=='(none)')reply.reviewEventId=review;
 log({kind:'decision-response',round:n,status:reply.status,reviewEventId:reply.reviewEventId??null});
 const answer=JSON.stringify(reply),half=Math.floor(answer.length/2);
 for(const text of [answer.slice(0,half),answer.slice(half)])process.stdout.write(JSON.stringify({type:'text',sessionID:session,part:{type:'text',text}})+'\n');
 const finish=()=>{if(fs.existsSync(file('hold-main-'+n)))return;watcher.close();process.stdout.end();process.stderr.end();};
 const watcher=fs.watch(ROOT,finish);finish();
}
`;

type Event = { kind: string; [key: string]: unknown };
export async function openCodeGroupCapacityFixture(t: test.TestContext) {
  // One OpenCode leader + one Codex employee per module. Reuse the real
  // organization/adapter/scheduler and both original production Owner paths.
  const h = await productionWiring(t, "codex", true, true, 2, undefined, "opencode");
  fs.writeFileSync(h.file("tree-events.jsonl"), "");
  const events = (): Event[] => fs.readFileSync(h.file("tree-events.jsonl"), "utf8").trim().split("\n").filter(Boolean).map(v => JSON.parse(v));
  const record = (event: Event) => fs.appendFileSync(h.file("tree-events.jsonl"), JSON.stringify(event) + "\n");
  const receipts = new Map<string, DepartmentExecutionReceipt>();
  const originals = new Map<string, NonNullable<ReturnType<typeof h.producer.originalClient>>>();
  const lifecycles: Array<{ taskId: string; round: number; processTerminal: string; streams: string }> = [];
  const transcripts: Array<{ taskId: string; tabId: string; localSessionId: string; content: string }> = [];
  let beforeConsumerFinish: ((round: number) => Promise<void>) | undefined;
  const register = h.store.registerLeaderExecution.bind(h.store);
  h.store.registerLeaderExecution = (...args) => { const result = register(...args); if (result.ok) record({ kind: "responsibility-persisted" }); return result; };
  const bind = h.store.bindLeaderExecution.bind(h.store);
  h.store.bindLeaderExecution = (...args) => { const result = bind(...args); if (result.ok) record({ kind: "binding-persisted" }); return result; };
  const coldRead = h.store.readLeaderExecutionSet.bind(h.store);
  h.store.readLeaderExecutionSet = (...args) => {
    const result = coldRead(...args);
    if (result.ok && result.value?.bindings.length) record({ kind: "binding-cold-read", state: result.value.set.state,
      executions: result.value.bindings.map(b => b.identity.executionId) });
    return result;
  };
  h.onSessionWritten(id => {
    const session = h.read(id)?.executionSession;
    record({ kind: "task-session-readback", taskId: id, session: session?.sessionId, configId: session?.configId });
  });
  const retain = h.producer.retainOriginalClient.bind(h.producer);
  h.producer.retainOriginalClient = (binding, client) => {
    originals.set(binding.identity.executionId, client);
    const wait = client.waitForCleanup.bind(client);
    client.waitForCleanup = async (...args) => {
      const receipt = await wait(...args);
      receipts.set(binding.identity.executionId, receipt);
      record({ kind: "original-receipt", execution: binding.identity.executionId });
      return receipt;
    };
    retain(binding, client);
  };
  const write = h.store.write.bind(h.store);
  h.store.write = (value) => {
    const memoryBefore = h.composition.capacity.snapshot("root")[0];
    const result = write(value);
    if (result.ok) {
      const read = h.store.read("root", "workspace");
      record({ kind: "capacity-persisted", leaders: read.ok ? read.value?.capacity.leaders : null,
        employees: read.ok ? read.value?.capacity.employees : null, memoryLeadersBefore: memoryBefore?.leaders ?? [],
        receipts: [...receipts.keys()], closedSets: read.ok ? read.value?.leaderExecutionSets?.filter(s => s.state === "closed").length : null });
    }
    return result;
  };
  const subscription = h.composition.capacity.subscribe(() => {
    const memory = h.composition.capacity.snapshot("root")[0], saved = h.store.read("root", "workspace");
    record({ kind: "capacity-memory", leaders: memory?.leaders ?? [], employees: memory?.employees ?? [],
      durableLeaders: saved.ok ? saved.value?.capacity.leaders : null });
  });
  t.after(() => subscription.dispose());
  const script = h.file("opencode-tree.cjs"), command = h.file(process.platform === "win32" ? "opencode-tree.cmd" : "opencode-tree");
  const body = `const ROOT=${JSON.stringify(h.directory)};\n${CLI}`;
  fs.writeFileSync(script, body);
  fs.writeFileSync(command, process.platform === "win32" ? `@"${process.execPath}" "${script}" %*\r\n` : `#!/usr/bin/env node\n${body}`);
  fs.chmodSync(command, 0o755);
  h.setOpenCodeMain(async (input, options, tabTarget) => {
    const round = h.mainCalls, taskId = input.loopTaskId!, localSessionId = h.read(taskId)!.sessionId!;
    Object.assign(h.fixture.target, { tabId: options.targetTabId, cli: "opencode", sessionId: localSessionId });
    const validate = createDepartmentLeaderNativeSessionValidator({ localSessionId, configId: h.expected.configId,
      readExecutionSession: () => h.read(taskId)?.executionSession });
    let stdout = "", stderr = "";
    const errors: Error[] = [];
    const handle = h.leaderHost.runOpenCode(taskId, options.invocationId, input.modelPrompt, {
      onStdout(chunk) { stdout += chunk; const native = extractOpenCodeRuntimeSessionId(stdout); if (native) validate(native); },
      onStderr(chunk) { stderr += chunk; }, onError(error) { errors.push(error); }, onExit() {},
    }, h.expected, h.file("configuration"), {
      command, baseArgs: ["run", "--format", "json"], cwd: h.file("workspace"),
      baseEnvironment: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, PATHEXT: process.env.PATHEXT,
        HOME: h.directory, USERPROFILE: h.directory },
      overlay: { configContent: JSON.stringify({ provider: { fixture: { models: { model: {} } } } }), primaryModel: "fixture/model", smallModel: null },
    }, options.signal, tabTarget);
    const terminal = await handle.lifecycle;
    if (errors.length) throw errors[0];
    if (terminal?.processTerminal.status !== "confirmed" || terminal.streams.status !== "confirmed") throw new Error("tree-original-physical-drain-unknown");
    lifecycles.push({ taskId, round, processTerminal: terminal.processTerminal.status, streams: terminal.streams.status });
    const parsed = parseOpenCodeRunOutput(stdout, stderr);
    if (parsed.errorText || !parsed.finalText) throw new Error("tree-parser-no-valid-answer");
    const native = extractOpenCodeRuntimeSessionId(stdout); if (!native) throw new Error("tree-parser-missing-native-session");
    validate(native);
    if (h.read(taskId)?.sessionId !== localSessionId || h.tabs.get(options.targetTabId)?.sessionId !== localSessionId)
      throw new Error("tree-local-transcript-key-changed");
    transcripts.push({ taskId, tabId: options.targetTabId, localSessionId, content: parsed.finalText });
    record({ kind: "parsed-invocation-drained", taskId, round, localSessionId });
    await beforeConsumerFinish?.(round);
    return parsed.finalText;
  });
  return { ...h, events, receipts, originals, lifecycles, transcripts,
    // Keep getters live rather than snapshotting productionWiring counters.
    get mainCalls() { return h.mainCalls; }, get employeeBuilders() { return h.employeeBuilders; }, get localRuns() { return h.localRuns; },
    beforeMainConsumerFinish(fn: (round: number) => Promise<void>) { beforeConsumerFinish = fn; },
    hold(name: string) { fs.writeFileSync(h.file(name), "gate"); },
    release(name: string) { fs.rmSync(h.file(name), { force: true }); },
    configurationLeases() { return JSON.parse(fs.readFileSync(h.file("configuration/selection.json"), "utf8")).leases as unknown[]; },
    diagnostic() { return JSON.stringify({ events: events().slice(-15), taskLogs: h.fixture.logs.slice(-5),
      snapshot: h.composition.host.runtimeSnapshot("root"), capacity: h.composition.readCapacity("root"), mainCalls: h.mainCalls,
      employeeBuilders: h.employeeBuilders, tasks: h.mainInvocations.map(i => h.read(i.taskId)?.status) }); },
  };
}

/** No wait or teardown completion is used to manufacture cleanup evidence. */
export async function bounded<T>(promise: Promise<T>, label: string, diagnostic: () => string, timeoutMs = 12000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([promise, new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(label + ": " + diagnostic())), timeoutMs);
  })]); } finally { clearTimeout(timer); }
}
export async function eventually(check: () => boolean | Promise<boolean>, label: string, diagnostic: () => string): Promise<void> {
  const deadline = Date.now() + 12000;
  while (!await check()) {
    if (Date.now() >= deadline) throw new Error(label + ": " + diagnostic());
    await new Promise<void>(r => setTimeout(r, 5));
  }
}
