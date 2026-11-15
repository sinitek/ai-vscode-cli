import test = require("node:test");
import assert = require("node:assert/strict");
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { createDepartmentOpenCodeSession } from "../../runtime/departmentopencodesessionpreparation";

async function fixture(t: test.TestContext, mode: string) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "native-directory-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const root = path.join(directory, "root"); fs.mkdirSync(root);
  const script = path.join(directory, "server.cjs"), events = path.join(directory, "events");
  fs.writeFileSync(events, "");
  fs.writeFileSync(script, `const fs=require('fs'),http=require('http');
const mode=${JSON.stringify(mode)},events=${JSON.stringify(events)},root=${JSON.stringify(root)};
const log=v=>fs.appendFileSync(events,v+'\\n');
const server=http.createServer((req,res)=>{log(req.method);if(mode==='cancel'){return;}
const directory=mode==='wrong-create'||mode==='wrong-get'&&req.method==='GET'?${JSON.stringify(directory)}:root;
res.setHeader('content-type','application/json');res.end(JSON.stringify({id:'ses_directoryTest',directory}));});
server.listen(0,'127.0.0.1',()=>console.log('http://127.0.0.1:'+server.address().port));
process.on('SIGTERM',()=>{log('stop');server.closeAllConnections();server.close(()=>log('closed'));});`);
  return { directory, root, events, input: { workspaceDirectory: root, sessionState: "unbound" as "unbound" | "bound",
    sessionId: undefined as string | undefined, requireDirectory: true as const, overlay: null,
    launch: { command: process.execPath, args: [script, "run"], baseEnvironment: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot } } },
    lines: () => fs.readFileSync(events, "utf8").trim().split("\n").filter(Boolean) };
}
for (const mode of ["correct", "wrong-create", "wrong-get", "bound-wrong"]) {
  test(`native preparation validates the physical event directory: ${mode}`, { timeout: 15000 }, async t => {
    const h = await fixture(t, mode === "bound-wrong" ? "wrong-get" : mode);
    if (mode === "bound-wrong") { h.input.sessionState = "bound"; h.input.sessionId = "ses_directoryTest"; }
    const preparation = createDepartmentOpenCodeSession(h.input, new AbortController().signal);
    if (mode === "correct") assert.equal(await preparation, "ses_directoryTest");
    else await assert.rejects(preparation, /native-session-directory-conflict/);
    assert.deepEqual(h.lines().slice(-2), ["stop", "closed"], "service lifecycle has joined before returning");
    assert.equal(h.lines().filter(v => v === "POST").length, mode === "bound-wrong" ? 0 : 1);
  });
}
test("native directory check accepts a realpath alias without changing native identity", { timeout: 15000 }, async t => {
  const h = await fixture(t, "correct"), alias = path.join(h.directory, "alias");
  fs.symlinkSync(h.root, alias, process.platform === "win32" ? "junction" : "dir");
  h.input.workspaceDirectory = alias;
  assert.equal(await createDepartmentOpenCodeSession(h.input, new AbortController().signal), "ses_directoryTest");
  assert.deepEqual(h.lines(), ["POST", "GET", "stop", "closed"]);
});
test("cancelled native preparation joins its own service without producing a bound result", { timeout: 15000 }, async t => {
  const h = await fixture(t, "cancel"), abort = new AbortController();
  const result = createDepartmentOpenCodeSession(h.input, abort.signal);
  const rejected = assert.rejects(result, /revoked|request-failed/);
  const deadline = Date.now() + 5000;
  while (!h.lines().includes("POST")) {
    assert.ok(Date.now() < deadline, "creation request gate timeout");
    await new Promise(r => setTimeout(r, 5));
  }
  abort.abort(); await rejected;
  assert.deepEqual(h.lines(), ["POST", "stop", "closed"]);
});

import { assertRetiredOpenCodeSession, type DepartmentOpenCodeRetiredSession } from "../../runtime/departmentopencodesessionpreparation";
import { fingerprintDepartmentExecutionSelection, type DepartmentExecutionIdentity, type DepartmentExecutionSelection } from "../../runtime/departmentexecutionidentity";
function retired(directory: string) {
  const selection: DepartmentExecutionSelection = { version: 1, cli: "opencode", role: "leader", configId: "profile", revision: "revision",
    model: "fixture/model", thinkingMode: null, openCodeVariant: null };
  const identity: DepartmentExecutionIdentity = { version: 1, workspace: "workspace", rootTaskId: "root", leaderTaskId: "leader", moduleId: "module",
    generation: 1, role: "leader", cli: "opencode", ownerId: "original", executionId: "original", session: { state: "bound", id: "ses_directoryTest" },
    ...fingerprintDepartmentExecutionSelection(selection) };
  return { source: { identity, selection, directory }, target: { ...identity, generation: 2, ownerId: "successor", executionId: "successor" }, selection };
}
async function moveFixture(t: test.TestContext, mode: string) {
  const h = await fixture(t, "correct"), source = path.join(h.directory, "removed-source");
  fs.mkdirSync(source); const canonical = fs.realpathSync(source); fs.rmdirSync(source);
  const proof = retired(canonical);
  fs.writeFileSync(path.join(h.directory, "server.cjs"), `const fs=require('fs'),http=require('http');
const mode=${JSON.stringify(mode)},root=fs.realpathSync(${JSON.stringify(h.root)}),source=${JSON.stringify(canonical)},events=${JSON.stringify(h.events)};let moved=false;
const log=v=>fs.appendFileSync(events,v+'\\n');
const server=http.createServer((req,res)=>{const url=new URL(req.url,'http://localhost');log(req.method+' '+url.pathname);
if(req.method==='POST'){let body='';req.on('data',v=>body+=v);req.on('end',()=>{
log(body);if(mode==='cancel'){fs.writeFileSync(events+'.gate','yes');return;}
if(mode==='http'){res.writeHead(409);res.end('{}');return;}
const b=JSON.parse(body);if(b.sessionID!=='ses_directoryTest'||b.moveChanges!==false||b.destination.directory!==root){res.writeHead(400);res.end('{}');return;}
moved=true;if(mode==='response')res.end('{}');else res.writeHead(204).end();});return;}
res.end(JSON.stringify({id:mode==='id'&&moved?'ses_foreign':'ses_directoryTest',projectID:mode==='project'&&moved?'foreign':'global',
directory:mode==='source'?root:moved&&mode!=='readback'?root:source}));});
server.listen(0,'127.0.0.1',()=>console.log('http://127.0.0.1:'+server.address().port));
process.on('SIGTERM',()=>{log('stop');server.closeAllConnections();server.close(()=>log('closed'));});`);
  return { ...h, proof, input: { ...h.input, sessionState: "bound" as const, sessionId: "ses_directoryTest", retired: proof.source } };
}
for (const mode of ["correct", "source", "http", "response", "id", "project", "readback"]) {
  test(`retired native directory move and cold verification: ${mode}`, { timeout: 15000 }, async t => {
    const h = await moveFixture(t, mode);
    assertRetiredOpenCodeSession(h.proof.source, h.proof.target, h.proof.selection);
    const work = createDepartmentOpenCodeSession(h.input, new AbortController().signal);
    if (mode === "correct") assert.equal(await work, "ses_directoryTest"); else await assert.rejects(work);
    const lines = h.lines();
    assert.equal(lines.filter(v => v === "POST /session").length, 0, "bound never creates a replacement");
    assert.equal(lines.filter(v => v === "POST /experimental/control-plane/move-session").length, mode === "source" ? 0 : 1);
    assert.deepEqual(lines.slice(-2), ["stop", "closed"], "no return before service close/drain");
    if (mode === "correct") assert.equal(lines.filter(v => v.startsWith("GET ")).length, 2);
  });
}
for (const mode of ["workspace", "rootTaskId", "moduleId", "leaderTaskId", "generation", "ownerId", "session", "selection", "reoccupied"]) {
  test(`retired native source rejects ${mode} without starting preparation`, async t => {
    const h = await moveFixture(t, "correct");
    const target = structuredClone(h.proof.target), selection = structuredClone(h.proof.selection);
    if (["workspace", "rootTaskId", "moduleId", "leaderTaskId"].includes(mode)) (target as any)[mode] = "foreign";
    if (mode === "generation") target.generation = 1;
    if (mode === "ownerId") target.ownerId = "original";
    if (mode === "session") target.session = { state: "bound", id: "ses_foreign" };
    if (mode === "selection") selection.revision = "foreign";
    if (mode === "reoccupied") fs.symlinkSync(h.root, h.proof.source.directory, process.platform === "win32" ? "junction" : "dir");
    assert.throws(() => assertRetiredOpenCodeSession(h.proof.source, target, selection));
    assert.deepEqual(h.lines(), []);
  });
}
test("retired native preparation cancellation and configuration drift cannot return a grantable session", { timeout: 15000 }, async t => {
  const h = await moveFixture(t, "cancel"), abort = new AbortController();
  const work = createDepartmentOpenCodeSession(h.input, abort.signal), rejected = assert.rejects(work);
  const until = Date.now() + 5000;
  while (!fs.existsSync(h.events + ".gate")) { assert.ok(Date.now() < until); await new Promise(r => setTimeout(r, 5)); }
  abort.abort(); await rejected;
  assert.equal(h.lines().filter(v => v.startsWith("POST ")).length, 1);
  assert.deepEqual(h.lines().slice(-2), ["stop", "closed"]);
  const drift = await moveFixture(t, "correct"); let checks = 0;
  await assert.rejects(createDepartmentOpenCodeSession({ ...drift.input, assertCurrent() { if (++checks === 4) throw new Error("configuration-drift"); } }, new AbortController().signal), /configuration-drift/);
  assert.equal(drift.lines().some(v => v.startsWith("POST ")), false);
});
