import test = require("node:test");
import assert = require("node:assert/strict");
import fs = require("node:fs");
import os = require("node:os");
import path = require("node:path");
import { spawnSync } from "node:child_process";

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
