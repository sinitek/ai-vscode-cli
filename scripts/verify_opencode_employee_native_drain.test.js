"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const { parseArgs, validatePaths, snapshot, isolatedEnvironment, assertEventDirectory, assertConsumerGateObservation } = require("./verify_opencode_employee_native_drain");
const opts = () => ["--live", "--module-root", "/private/tmp/build/dist", "--product-root", "/private/tmp/new-product", "--report", "/private/tmp/new-report.json"];
test("employee verifier requires explicit live, absolute unique paths and rejects invalid options", () => {
  assert.equal(parseArgs(opts()).live, true);
  for (const args of [[], opts().slice(1), [...opts(), "--live"], [...opts(), "--unknown"], [...opts(), "--report", "/tmp/a"],
    ["--live", "--module-root", "relative"], [...opts(), "--binary", "/tmp/invalid\0path"]]) assert.throws(() => parseArgs(args));
});
test("employee verifier rejects shared/symlink dependencies, existing products and directory splits", t => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "employee-verifier-paths-")));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dist = path.join(root, "build/dist"), source = path.join(root, "build/src"); fs.mkdirSync(dist, { recursive: true }); fs.mkdirSync(source);
  const names = ["extensionHost/departmentprocesspreparation.js", "extensionHost/departmentprocessbootstrap.js",
    "runtime/departmentprocessownerworker.js", "runtime/departmentopencodesessionpreparation.js"];
  for (const name of names) { fs.mkdirSync(path.dirname(path.join(dist, name)), { recursive: true }); fs.writeFileSync(path.join(dist, name), ""); }
  const options = { moduleRoot: dist, productRoot: path.join(root, "product"), reportPath: path.join(root, "report.json") };
  assert.equal(validatePaths(options).moduleRoot, dist);
  fs.mkdirSync(options.productRoot); assert.throws(() => validatePaths(options), /new/); fs.rmdirSync(options.productRoot);
  assert.throws(() => validatePaths({ ...options, productRoot: path.join(dist, "product") }), /overlap/);
  fs.unlinkSync(path.join(dist, names[2])); fs.symlinkSync(__filename, path.join(dist, names[2])); assert.throws(() => validatePaths(options), /escape/);
  assertEventDirectory("C:\\root", ["c:\\ROOT"], "C:\\root", "C:\\workspace", path.win32);
  assert.throws(() => assertEventDirectory("/tmp/root", ["/tmp/other"], "/tmp/root", "/tmp/workspace"), /mismatch/);
});
test("employee environment excludes credentials/config and isolates all runtime stores", () => {
  const env = isolatedEnvironment("/isolated", { PATH: "/bin", OPENAI_API_KEY: "secret", OPENCODE_CONFIG: "/user/config", HOME: "/user", NODE_OPTIONS: "user-module" });
  for (const key of ["OPENAI_API_KEY", "OPENCODE_CONFIG", "NODE_OPTIONS"]) assert.equal(env[key], undefined);
  for (const key of ["HOME", "USERPROFILE", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_CACHE_HOME", "XDG_STATE_HOME", "OPENCODE_CONFIG_DIR", "TMPDIR"])
    assert.ok(env[key].startsWith("/isolated/"), key);
  assert.equal(env.HTTPS_PROXY, "http://127.0.0.1:9"); assert.equal(env.PATH, "/bin");
});
test("employee source snapshot includes original worker and transitive dependencies", t => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "employee-verifier-source-")));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const repository = path.join(root, "repo"), source = path.join(root, "build/src"), moduleRoot = path.join(root, "build/dist");
  const script = fs.readFileSync(path.join(__dirname, "verify_opencode_employee_native_drain.js"), "utf8");
  const roots = [...script.matchAll(/load\("([A-Za-z0-9_/.]+\.js)"\)/g)].map(m => m[1]); roots.push("runtime/departmentprocessownerworker.js", "runtime/transitive.js");
  for (const file of roots) {
    for (const dir of [source, path.join(repository, "src")]) { const p = path.join(dir, file.replace(/\.js$/, ".ts")); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, "// physical"); }
    const p = path.join(moduleRoot, file); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, "");
  }
  fs.writeFileSync(path.join(moduleRoot, "runtime/departmentprocessownerworker.js"), 'require("./transitive");');
  assert.ok(snapshot({ repository, source, moduleRoot }).relevantSources["runtime/transitive.ts"]);
  fs.writeFileSync(path.join(repository, "src/runtime/transitive.ts"), "changed"); assert.throws(() => snapshot({ repository, source, moduleRoot }), /production dependency mismatch/);
});

test("employee consumer gate accepts read-only finalizing but never receipt or mismatched identity", () => {
  const identity = { executionId: "original", generation: 1 };
  for (const status of ["live", "finalizing"]) {
    const observed = { status, identity, claimGeneration: 1 };
    assert.doesNotThrow(() => assertConsumerGateObservation(observed, identity));
    for (const invalid of [{ ...observed, receipt: {} }, { ...observed, reason: "extra" }, { ...observed, claimGeneration: 0 },
      { ...observed, identity: { ...identity, generation: 2 } }]) assert.throws(() => assertConsumerGateObservation(invalid, identity));
  }
  assert.doesNotThrow(() => assertConsumerGateObservation({ status: "unknown", identity, reason: "unverified" }, identity));
  for (const status of ["cleaned", "conflict"]) assert.throws(() => assertConsumerGateObservation({ status, identity, receipt: {} }, identity));
});
