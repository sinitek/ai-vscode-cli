import test = require("node:test");
import assert = require("node:assert/strict");
import fs = require("node:fs");
import os = require("node:os");
import path = require("node:path");
import { spawnSync } from "node:child_process";

const setup = `
  const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
  const {createDepartmentProductionTaskStore:createAtRoot,createDepartmentProductionTaskStoreForHost:createSource}=require(${JSON.stringify(require.resolve("../../extensionHost/departmentProductionTaskStore"))});
  const {prepareDepartmentTaskRecord}=require(${JSON.stringify(require.resolve("../../extensionHost/departmentOwnedTaskRepository"))});
  const {departmentRecords}=require(${JSON.stringify(require.resolve("../loop/departmentGroupChatHost.fixture"))});
  const store=require(${JSON.stringify(require.resolve("../../loopTaskStore"))});
  const identities=require(${JSON.stringify(require.resolve("../../loopTaskIdentityCatalog"))});
  const data=path.join(process.env.HOME,'.sinitek_cli');
  function record(id){
    const task=departmentRecords().root;task.id=id;task.department.rootTaskId=id;
    task.createdAt=task.updatedAt=Date.now();task.subTasks=[];
    task.department.routes={director:{cli:'codex'},leader:{cli:'codex'},employee:{cli:'claude',thinkingMode:'off'}};
    return prepareDepartmentTaskRecord(task,task.department,task.loopPlusAcceptancePlan);
  }
`;

function run(home: string, script: string) {
  const child = spawnSync(process.execPath, ["-e", setup + script], {
    env: { ...process.env, HOME: home, USERPROFILE: home }, encoding: "utf8", timeout: 30000,
  });
  assert.equal(child.status, 0, child.stdout + child.stderr);
  return child.stdout.trim();
}

const secondHost = `
  (async()=>{
    const source=createSource(data);
    assert.equal(source.ready,true);
    assert.notEqual(source.descriptor.root,fs.realpathSync(path.join(data,'department-tasks-v1')));
    assert.throws(()=>source.create(record('old-task')),/冲突/);
    assert.equal(store.readLoopTaskRecord('old-task'),null,'new host cannot take over old tasks');
    const task=source.create(record('new-'+path.basename(source.descriptor.root)+'-'+process.pid));
    assert.equal(store.updateLoopTaskRecord(task.id,{finalSummary:'saved'}).finalSummary,'saved');
    assert.equal(source.readTaskRecord(task.id).finalSummary,'saved');
    const ordinary=path.join(process.env.HOME,'ordinary.json');
    assert.equal(store.tryWriteLoopTaskStore(ordinary,{tasks:[{...task,taskStoreFile:ordinary}]}),false);
    assert.equal(source.deleteTaskRecord(task.id),true);
    assert.equal(identities.isDepartmentOwnedLoopTaskIdentity(task.id),true,'deleted identity remains reserved');
    assert.equal(await source.close(),true);
    console.log(source.descriptor.root);
  })().catch(error=>{console.error(error);process.exitCode=1});
`;

for (const state of ["live", "exited"] as const) {
  test(`new department work starts in another real Node host with a ${state} original owner`, () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "department-host-source-"));
    try {
      if (state === "live") {
        run(home, `
          (async()=>{
            const source=createSource(data),task=source.create(record('old-task'));
            const marker=path.join(source.descriptor.root,'.department-owner.json');
            const before=fs.readFileSync(marker,'utf8'),bytes=fs.readFileSync(task.taskStoreFile,'utf8');
            const child=cp.spawnSync(process.execPath,['-e',${JSON.stringify(setup + secondHost)}],{env:process.env,encoding:'utf8',timeout:15000});
            assert.equal(child.status,0,child.stdout+child.stderr);
            assert.equal(fs.readFileSync(marker,'utf8'),before);
            assert.equal(fs.readFileSync(task.taskStoreFile,'utf8'),bytes);
            assert.equal(source.ready,true);
            assert.equal(store.updateLoopTaskRecord(task.id,{finalSummary:'original host still owns task'}).finalSummary,'original host still owns task');
            assert.equal(await source.close(),true);
          })().catch(error=>{console.error(error);process.exitCode=1});
        `);
      } else {
        run(home, "const source=createSource(data);source.create(record('old-task'));assert.equal(source.ready,true);");
        const root = path.join(home, ".sinitek_cli", "department-tasks-v1");
        const marker = fs.readFileSync(path.join(root, ".department-owner.json"), "utf8");
        const first = run(home, secondHost);
        const second = run(home, secondHost);
        assert.equal(first, second, "a later host reopens the prior host's registered source");
        assert.equal(fs.readFileSync(path.join(root, ".department-owner.json"), "utf8"), marker);
      }
    } finally { fs.rmSync(home, { recursive: true, force: true }); }
  });
}

test("host admission recovers an unpublished catalog only after its registered roots disappeared", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "department-host-catalog-recovery-"));
  try {
    run(home, `
      (async()=>{
      const oldRoot=path.join(data,'abandoned-source'),oldFile=path.join(oldRoot,'retired.json');
      fs.mkdirSync(data,{recursive:true});
      fs.mkdirSync(oldRoot);
      identities.initializeLoopTaskIdentityCatalog(oldRoot,()=>new Map([[oldFile,[{id:'retired-task'}]]]));
      fs.rmSync(oldRoot,{recursive:true});
      const catalogFile=path.join(data,'loop-task-identities','catalog.json');
      const snapshot=JSON.parse(fs.readFileSync(catalogFile,'utf8'));
      fs.writeFileSync(catalogFile,JSON.stringify({...snapshot,ready:false}));
      assert.throws(()=>createAtRoot(path.join(data,'department-tasks-v1')),'ordinary initialization cannot guess-recover');
      const originalMarker=path.join(data,'department-tasks-v1','.department-owner.json');
      assert.equal(fs.existsSync(originalMarker),true,'failed initialization retains the source marker');
      const source=createSource(data);
      assert.notEqual(source.descriptor.root,path.join(data,'department-tasks-v1'));
      assert.equal(source.ready,true);
      const recovered=JSON.parse(fs.readFileSync(catalogFile,'utf8'));
      assert.equal(recovered.ready,true);
      assert.deepEqual(recovered.roots,[oldRoot,source.descriptor.root]);
      assert.equal(recovered.owned['retired-task'],oldFile,'recovery preserves the original identity tombstone');
      assert.equal(identities.isDepartmentOwnedLoopTaskIdentity('retired-task'),true);
      assert.equal(source.create(record('new-after-safe-recovery')).id,'new-after-safe-recovery');
      assert.equal(await source.close(),true);
      const reopened=createSource(data);
      assert.equal(reopened.descriptor.root,source.descriptor.root);
      assert.equal(reopened.readTaskRecord('new-after-safe-recovery').id,'new-after-safe-recovery');
      assert.equal(await reopened.close(),true);
      })().catch(error=>{console.error(error);process.exitCode=1});
    `);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

for (const failure of ["locked", "corrupt", "unpublished", "recovery"] as const) {
  test(`host source admission refuses ${failure} state without silently recovering it`, () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "department-host-refusal-"));
    try {
      run(home, `
        const source=createSource(data),directory=path.join(data,'loop-task-identities');
        const catalog=path.join(directory,'catalog.json'),before=fs.readFileSync(catalog,'utf8');
        const marker=path.join(source.descriptor.root,'.department-owner.json'),owner=fs.readFileSync(marker,'utf8');
        const failure=${JSON.stringify(failure)};
        if(failure==='locked')fs.writeFileSync(path.join(directory,'transaction.lock'),'unknown');
        else if(failure==='corrupt')fs.writeFileSync(catalog,'broken');
        else if(failure==='unpublished')fs.writeFileSync(catalog,JSON.stringify({...JSON.parse(before),ready:false}));
        else {
          fs.unlinkSync(marker);
          fs.writeFileSync(path.join(source.descriptor.root,'.department-recovery-abcd.recovery'),'[]');
        }
        assert.throws(()=>createSource(data));
        if(failure!=='recovery')assert.equal(fs.readFileSync(marker,'utf8'),owner);
        if(failure==='locked')assert.equal(fs.readFileSync(path.join(directory,'transaction.lock'),'utf8'),'unknown');
        if(failure==='corrupt')assert.equal(fs.readFileSync(catalog,'utf8'),'broken');
        if(failure==='unpublished')assert.equal(JSON.parse(fs.readFileSync(catalog,'utf8')).ready,false);
        if(failure==='recovery')assert.equal(fs.existsSync(path.join(data,'department-task-sources-v1')),false);
      `);
    } finally { fs.rmSync(home, { recursive: true, force: true }); }
  });
}
