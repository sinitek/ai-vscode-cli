import test = require("node:test");
import assert = require("node:assert/strict");
import fs = require("node:fs");
import os = require("node:os");
import path = require("node:path");
import { spawnSync } from "node:child_process";

for (const scenario of ["empty", "nonempty", "overlap", "contribution", "move-source"] as const) {
  test(`appending a host source preserves the catalog and checks ${scenario} provenance`, () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "identity-new-source-"));
    const child = spawnSync(process.execPath, ["-e", `
      const assert=require('node:assert/strict'),fs=require('fs'),path=require('path');
      const catalog=require(${JSON.stringify(require.resolve("../../loopTaskIdentityCatalog"))});
      const original=path.join(process.env.HOME,'original');fs.mkdirSync(original);
      const ownedFile=path.join(original,'retired.json'),ordinary=path.join(process.env.HOME,'ordinary.json');
      catalog.initializeLoopTaskIdentityCatalog(original,()=>new Map([[ownedFile,[{id:'retired'}]],[ordinary,[{id:'ordinary'}]]]));
      const file=path.join(process.env.HOME,'.sinitek_cli','loop-task-identities','catalog.json');
      const scenario=${JSON.stringify(scenario)};
      const root=path.join(scenario==='overlap'?original:process.env.HOME,'new');fs.mkdirSync(root);
      const snapshot=JSON.parse(fs.readFileSync(file,'utf8'));
      snapshot.ordinaryMoves={moved:{file:path.join(process.env.HOME,'destination.json'),sources:[path.join(process.env.HOME,'previous.json')]}};
      if(scenario==='nonempty')fs.writeFileSync(path.join(root,'existing.json'),'{}');
      if(scenario==='contribution')snapshot.files[path.join(root,'removed.json')]=[];
      if(scenario==='move-source')snapshot.ordinaryMoves.moved.sources=[path.join(root,'removed.json')];
      fs.writeFileSync(file,JSON.stringify(snapshot));const before=fs.readFileSync(file,'utf8');
      assert.throws(()=>catalog.initializeLoopTaskIdentityCatalog(root,()=>assert.fail('must not rescan')));
      const register=()=>catalog.initializeLoopTaskIdentityCatalog(root,()=>assert.fail('must not rescan'),{registerEmptySource:true});
      if(scenario==='empty'){
        register();const next=JSON.parse(fs.readFileSync(file,'utf8'));
        assert.deepEqual(next,{...snapshot,roots:[...snapshot.roots,root]});
        assert.deepEqual(catalog.locateLoopTaskIdentity('retired'),{available:true,files:[ownedFile]});
        assert.deepEqual(catalog.locateLoopTaskIdentity('ordinary'),{available:true,files:[ordinary]});
      }else{
        assert.throws(register);assert.equal(fs.readFileSync(file,'utf8'),before);
      }
    `], { env: { ...process.env, HOME: home, USERPROFILE: home }, encoding: "utf8" });
    try { assert.equal(child.status, 0, child.stdout + child.stderr); }
    finally { fs.rmSync(home, { recursive: true, force: true }); }
  });
}

test("unpublished catalog recovers only when every registered source root is gone", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "identity-missing-root-recovery-"));
  const child = spawnSync(process.execPath, ["-e", `
    const assert=require('node:assert/strict'),fs=require('fs'),path=require('path');
    const catalog=require(${JSON.stringify(require.resolve("../../loopTaskIdentityCatalog"))});
    const oldRoot=path.join(process.env.HOME,'abandoned'),newRoot=path.join(process.env.HOME,'new');
    const oldFile=path.join(oldRoot,'removed.json'),ordinary=path.join(process.env.HOME,'ordinary.json');
    fs.mkdirSync(oldRoot);fs.mkdirSync(newRoot);
    catalog.initializeLoopTaskIdentityCatalog(oldRoot,()=>new Map([[oldFile,[{id:'retired'}]],[ordinary,[{id:'ordinary'}]]]));
    fs.rmSync(oldRoot,{recursive:true});
    const file=path.join(process.env.HOME,'.sinitek_cli','loop-task-identities','catalog.json');
    const before=JSON.parse(fs.readFileSync(file,'utf8'));before.ready=false;
    fs.writeFileSync(file,JSON.stringify(before));
    const recover=()=>catalog.initializeLoopTaskIdentityCatalog(newRoot,()=>new Map([[ordinary,[{id:'ordinary-v2'}]]]),{
      registerEmptySource:true,recoverWhenAllRegisteredRootsAreMissing:true,
    });
    assert.throws(()=>catalog.initializeLoopTaskIdentityCatalog(newRoot,()=>new Map([[ordinary,[{id:'ordinary-v2'}]]])));
    fs.mkdirSync(oldRoot);
    assert.throws(recover,'a registered source still on disk must never be bypassed');
    fs.rmdirSync(oldRoot);
    fs.writeFileSync(file,JSON.stringify({...before,ready:false}));
    recover();
    const recovered=JSON.parse(fs.readFileSync(file,'utf8'));
    assert.equal(recovered.ready,true);
    assert.deepEqual(recovered.roots,[oldRoot,newRoot]);
    assert.equal(recovered.owned.retired,oldFile,'deleted task identities remain reserved at their historical file');
    assert.deepEqual(catalog.locateLoopTaskIdentity('retired'),{available:true,files:[oldFile]});
    assert.deepEqual(catalog.locateLoopTaskIdentity('ordinary-v2'),{available:true,files:[ordinary]});
    assert.deepEqual(catalog.locateLoopTaskIdentity('ordinary'),{available:true,files:[]},'ordinary contribution is rebuilt from current files');
    fs.writeFileSync(path.join(path.dirname(file),'transaction.lock'),'unknown');
    assert.throws(()=>catalog.initializeLoopTaskIdentityCatalog(newRoot,()=>new Map(),{
      registerEmptySource:true,recoverWhenAllRegisteredRootsAreMissing:true,
    }),/EEXIST/);
  `], { env: { ...process.env, HOME: home, USERPROFILE: home }, encoding: "utf8" });
  try { assert.equal(child.status, 0, child.stdout + child.stderr); }
  finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test("batch identity lookup reads one current catalog and preserves duplicates, tombstones and ordinary identity", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "identity-batch-"));
  const child = spawnSync(process.execPath, ["-e", `
    const assert=require('node:assert/strict'),fs=require('fs'),path=require('path');
    const catalog=require(${JSON.stringify(require.resolve("../../loopTaskIdentityCatalog"))});
    const directory=path.join(process.env.HOME,'.sinitek_cli','loop-task-identities'),root=path.join(process.env.HOME,'owned');
    const ownedFile=path.join(root,'owned.json'),other=path.join(process.env.HOME,'ordinary.json');
    fs.mkdirSync(directory,{recursive:true});
    const file=path.join(directory,'catalog.json');
    fs.writeFileSync(file,JSON.stringify({version:1,ready:true,roots:[root],owned:{retired:ownedFile},files:{[ownedFile]:['duplicate','duplicate','shared'],[other]:['ordinary','shared']}}));
    const read=fs.readFileSync;let reads=0;
    fs.readFileSync=(name,...args)=>{if(name===file)reads++;return read(name,...args)};
    const result=catalog.locateLoopTaskIdentities(['duplicate','duplicate','shared','retired','ordinary','unknown','__proto__']);
    assert.equal(reads,1);assert.equal(result.available,true);
    assert.deepEqual([...result.locations], [['duplicate',[ownedFile,ownedFile]],['shared',[ownedFile,other]],['retired',[ownedFile]],['ordinary',[other]],['unknown',[]],['__proto__',[]]]);
    fs.writeFileSync(path.join(directory,'transaction.lock'),'unknown');
    assert.deepEqual(catalog.locateLoopTaskIdentities(['ordinary']),{available:false});
    assert.equal(reads,1,'locked catalog is not read');fs.unlinkSync(path.join(directory,'transaction.lock'));
    fs.writeFileSync(file,'broken');assert.deepEqual(catalog.locateLoopTaskIdentities(['ordinary']),{available:false});
    fs.unlinkSync(file);assert.deepEqual(catalog.locateLoopTaskIdentities(['ordinary']),{available:false});
  `], { env: { ...process.env, HOME: home }, encoding: "utf8" });
  try { assert.equal(child.status, 0, child.stdout + child.stderr); }
  finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test("ordinary migration authority survives bootstrap and atomic failures without relaxing owned identities", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "identity-move-"));
  const child = spawnSync(process.execPath, ["-e", `
    const assert=require('node:assert/strict'),fs=require('fs'),path=require('path');
    const catalog=require(${JSON.stringify(require.resolve("../../loopTaskIdentityCatalog"))});
    const store=require(${JSON.stringify(require.resolve("../../loopTaskStore"))});
    const root=path.join(process.env.HOME,'owned');fs.mkdirSync(root);
    const task={id:'ordinary',cli:'codex',workspaceKey:'ordinary',sessionId:null,rootPrompt:'ordinary',status:'running',
      createdAt:Date.now(),updatedAt:Date.now(),maxRounds:20,currentRound:0,communicationDir:process.env.HOME,
      mainCommunicationFile:path.join(process.env.HOME,'main.md'),subTasks:[],rounds:[],completionRoundSummaries:[],completionRequirementCoverage:[]};
    task.taskStoreFile=store.buildLoopTaskStoreFile(task.cli,task.workspaceKey,null,task.id);
    const target=store.getLoopTaskStoreSessionFile(task.workspaceKey,task.cli,'moved');
    store.writeLoopTaskStore(task.taskStoreFile,{tasks:[task]});
    const unlink=fs.unlinkSync;fs.unlinkSync=(file,...args)=>{if(String(file)===task.taskStoreFile)throw Object.assign(Error('cleanup denied'),{code:'EACCES'});return unlink(file,...args)};
    const moved=store.updateLoopTaskRecord(task.id,{taskStoreFile:target,sessionId:'moved'});fs.unlinkSync=unlink;
    assert.equal(moved.taskStoreFile,target);
    assert.deepEqual(catalog.locateOrdinaryLoopTaskMove(task.id),{available:true,file:target});
    assert.throws(()=>catalog.withLoopTaskIdentityRetention(()=>assert.fail('partial catalog cannot authorize GC')),/跳过通信清理/);
    assert.equal(catalog.canMigrateOrdinaryLoopTaskIdentity(task.id,task.taskStoreFile),true);
    assert.equal(catalog.canMigrateOrdinaryLoopTaskIdentity(task.id,path.join(process.env.HOME,'unregistered.json')),false);
    // Bootstrap scans actual bytes, including a stale old copy. Only the committed destination contributes.
    const ownedFile=path.join(root,'owned.json');
    catalog.initializeLoopTaskIdentityCatalog(root,()=>new Map([[task.taskStoreFile,[task]],[target,[moved]],[ownedFile,[{id:'owned'}]]]));
    assert.deepEqual(catalog.locateLoopTaskIdentity(task.id),{available:true,files:[target]});
    const catalogFile=path.join(process.env.HOME,'.sinitek_cli','loop-task-identities','catalog.json');
    const before=fs.readFileSync(target,'utf8'),rename=fs.renameSync,original=Object.assign(Error('disk full'),{code:'ENOSPC',errno:-28});
    fs.renameSync=(from,to)=>{if(String(to)===target)throw original;return rename(from,to)};
    assert.throws(()=>store.updateLoopTaskRecord(task.id,{finalSummary:'uncommitted'}),error=>error===original);
    fs.renameSync=rename;assert.equal(fs.readFileSync(target,'utf8'),before);
    assert.deepEqual(catalog.locateLoopTaskIdentity(task.id),{available:true,files:[target]});
    assert.deepEqual(catalog.locateLoopTaskIdentity('owned'),{available:true,files:[ownedFile]});
    assert.equal(store.tryWriteLoopTaskStore(path.join(process.env.HOME,'spoof.json'),{tasks:[{...task,id:'owned'}]}),false);
    assert.equal(catalog.commitLoopTaskIdentities(new Map([[ownedFile,[]]]),()=>false,root),false);
    assert.deepEqual(catalog.locateLoopTaskIdentity('owned'),{available:false},'uncertain owner failure stays closed');
    assert.deepEqual(catalog.locateOrdinaryLoopTaskMove(task.id),{available:false});
    assert.equal(JSON.parse(fs.readFileSync(catalogFile,'utf8')).ready,false);
  `], { env: { ...process.env, HOME: home, USERPROFILE: home }, encoding: "utf8" });
  try { assert.equal(child.status, 0, child.stdout + child.stderr); }
  finally { fs.rmSync(home, { recursive: true, force: true }); }
});

for (const invalid of [null, {}, { file: "relative", sources: [] }, { file: "/ordinary.json", sources: ["relative"] }]) {
  test(`malformed ordinary move ${JSON.stringify(invalid)} cannot authorize fallback`, () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "identity-invalid-move-"));
    const child = spawnSync(process.execPath, ["-e", `
      const assert=require('node:assert/strict'),fs=require('fs'),path=require('path');
      const catalog=require(${JSON.stringify(require.resolve("../../loopTaskIdentityCatalog"))});
      const directory=path.join(process.env.HOME,'.sinitek_cli','loop-task-identities');fs.mkdirSync(directory,{recursive:true});
      fs.writeFileSync(path.join(directory,'catalog.json'),JSON.stringify({version:1,ready:true,roots:[],owned:{},files:{},ordinaryMoves:{task:${JSON.stringify(invalid)}}}));
      assert.deepEqual(catalog.locateOrdinaryLoopTaskMove('task'),{available:false});
      assert.deepEqual(catalog.locateLoopTaskIdentity('task'),{available:false});
      assert.equal(catalog.isDepartmentOwnedLoopTaskIdentity('task'),null);
      assert.equal(catalog.canMigrateOrdinaryLoopTaskIdentity('task',path.join(process.env.HOME,'tasks.json')),false);
    `], { env: { ...process.env, HOME: home, USERPROFILE: home }, encoding: "utf8" });
    try { assert.equal(child.status, 0, child.stdout + child.stderr); }
    finally { fs.rmSync(home, { recursive: true, force: true }); }
  });
}

test("ordinary retention and known-source readers refuse damaged, unpublished and owned identities under one gate", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "identity-retention-"));
  const child = spawnSync(process.execPath, ["-e", `
    const assert=require('node:assert/strict'),fs=require('fs'),path=require('path');
    const catalog=require(${JSON.stringify(require.resolve("../../loopTaskIdentityCatalog"))});
    const directory=path.join(process.env.HOME,'.sinitek_cli','loop-task-identities');fs.mkdirSync(directory,{recursive:true});
    const file=path.join(directory,'catalog.json'),lock=path.join(directory,'transaction.lock');
    const root=path.join(process.env.HOME,'owned'),owned=path.join(root,'store.json'),ordinary=path.join(process.env.HOME,'ordinary.json');
    const valid={version:1,ready:true,roots:[root],owned:{retired:owned},files:{[owned]:['live'],[ordinary]:['plain']}};
    for(const invalid of ['broken',JSON.stringify({...valid,ready:false}),JSON.stringify({...valid,ordinaryMoves:{plain:null}})]) {
      fs.writeFileSync(file,invalid);
      assert.throws(()=>catalog.retainOrdinaryLoopTaskIdentities(ordinary,()=>assert.fail('unknown must abort the entire file')));
      assert.equal(catalog.readKnownOrdinaryLoopTaskIdentity('plain',ordinary,()=>assert.fail('unknown read')),null);
      assert.equal(fs.readFileSync(file,'utf8'),invalid);
    }
    fs.writeFileSync(file,JSON.stringify(valid));
    for(const id of ['live','retired']) assert.equal(catalog.readKnownOrdinaryLoopTaskIdentity(id,ordinary,()=>assert.fail('owned fallback')),null);
    assert.throws(()=>catalog.retainOrdinaryLoopTaskIdentities(owned,()=>assert.fail('owned source')),/部门来源/);
    assert.equal(catalog.readKnownOrdinaryLoopTaskIdentity('plain',ordinary,(source)=>{
      assert.equal(source,ordinary);assert.equal(fs.existsSync(lock),true);
      assert.throws(()=>catalog.commitLoopTaskIdentities(new Map(),()=>assert.fail('nested writer')),e=>e.code==='EEXIST');
      return 'fresh';
    }),'fresh');
    assert.equal(fs.existsSync(lock),false);
  `], { env: { ...process.env, HOME: home, USERPROFILE: home }, encoding: "utf8" });
  try { assert.equal(child.status, 0, child.stdout + child.stderr); }
  finally { fs.rmSync(home, { recursive: true, force: true }); }
});
