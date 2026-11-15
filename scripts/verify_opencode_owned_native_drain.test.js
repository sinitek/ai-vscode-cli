"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { parseArgs, isPathWithin, validatePaths, isolatedEnvironment, snapshot, assertEventDirectory } = require("./verify_opencode_owned_native_drain");
const { createOpenCodeLocalProvider } = require("./fixtures/opencode_local_provider_server");
const opts = () => ["--live", "--module-root", "/private/tmp/build/dist", "--product-root", "/private/tmp/product", "--report", "/private/tmp/new.json"];

test("native verifier requires explicit fresh isolation and rejects malformed arguments", () => {
  assert.equal(parseArgs(opts()).live, true);
  for (const args of [[], opts().slice(1), [...opts(), "--live"], [...opts(), "--unknown"], [...opts(), "--report", "/x"],
    ["--live", "--module-root", "relative"], ["--live", "--module-root", "bad\0path"], [...opts(), "--binary", "--live"]])
    assert.throws(() => parseArgs(args));
});

test("containment handles POSIX and Windows boundaries without prefix escapes", () => {
  assert.equal(isPathWithin("/tmp/build", "/tmp/build/module"), true);
  assert.equal(isPathWithin("/tmp/build", "/tmp/build-escape/module"), false);
  assert.equal(isPathWithin("C:\\build", "c:\\BUILD\\module", path.win32), true);
  assert.equal(isPathWithin("C:\\build", "C:\\build-escape\\module", path.win32), false);
  assert.equal(isPathWithin("C:\\build", "D:\\build\\module", path.win32), false);
});

test("module root, product and report cannot adopt shared dist, existing paths or symlink escapes", t => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "opencode-verifier-paths-")));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dist = path.join(root, "build/dist"), src = path.join(root, "build/src");
  fs.mkdirSync(dist, { recursive: true }); fs.mkdirSync(src);
  const names = ["extensionHost/departmentleaderproductionhost.js", "extensionHost/departmentleaderprocessbootstrap.js",
    "runtime/departmentleaderprocessownerworker.js", "runtime/departmentopencodesessionpreparation.js"];
  for (const name of names) { fs.mkdirSync(path.dirname(path.join(dist, name)), { recursive: true }); fs.writeFileSync(path.join(dist, name), ""); }
  const options = { moduleRoot: dist, productRoot: path.join(root, "product"), reportPath: path.join(root, "report.json") };
  assert.equal(validatePaths(options).moduleRoot, dist);
  fs.writeFileSync(options.reportPath, "original"); assert.throws(() => validatePaths(options), /new/);
  fs.unlinkSync(options.reportPath);
  assert.throws(() => validatePaths({ ...options, productRoot: path.join(dist, "product") }), /overlap/);
  const repo = fs.realpathSync(path.join(__dirname, ".."));
  assert.throws(() => validatePaths({ ...options, moduleRoot: path.join(repo, "dist") }), /shared/);
  fs.unlinkSync(path.join(dist, names[0])); fs.symlinkSync(__filename, path.join(dist, names[0]));
  assert.throws(() => validatePaths(options), /escape/);
});

test("environment inherits only the explicit platform whitelist and suppresses remote config/model paths", () => {
  const env = isolatedEnvironment("/isolated", { PATH: "/bin", OPENAI_API_KEY: "secret", OPENCODE_CONFIG: "/user/config",
    NODE_OPTIONS: "--require user.js", HOME: "/user", HTTPS_PROXY: "https://remote", XDG_DATA_HOME: "/user/data" });
  assert.equal(env.OPENAI_API_KEY, undefined); assert.equal(env.OPENCODE_CONFIG, undefined); assert.equal(env.NODE_OPTIONS, undefined);
  assert.equal(env.PATH, "/bin"); assert.equal(env.HOME, path.join("/isolated", "home"));
  assert.equal(env.HTTPS_PROXY, "http://127.0.0.1:9"); assert.equal(env.OPENCODE_DISABLE_MODELS_FETCH, "1");
  assert.equal(env.OPENCODE_DISABLE_PROJECT_CONFIG, "1");
});

function request(base, body, url = "/chat/completions", token = "isolated-free-provider") {
  return new Promise((resolve, reject) => {
    const req = http.request(base + url, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` } }, res => {
      let text = ""; res.setEncoding("utf8"); res.on("data", v => text += v); res.on("end", () => resolve({ status: res.statusCode, text, headers: res.headers }));
    });
    req.on("error", reject); req.end(typeof body === "string" ? body : JSON.stringify(body));
  });
}
const chat = stream => ({ model: "native-drain", stream, messages: [{ role: "user", content: "NATIVE_DRAIN_ROUND_2" }] });

test("loopback provider speaks chat JSON and SSE with bounded deterministic text and no tools", async () => {
  const p = createOpenCodeLocalProvider(), base = await p.listen();
  try {
    assert.equal(p.server.address().address, "127.0.0.1");
    const json = await request(base, chat(false)); assert.equal(json.status, 200); assert.equal(JSON.parse(json.text).choices[0].finish_reason, "stop");
    const sse = await request(base, chat(true)); assert.equal(sse.status, 200); assert.match(sse.headers["content-type"], /event-stream/);
    const events = sse.text.split("\n\n").filter(Boolean).map(line => line.slice(6)); assert.equal(events.pop(), "[DONE]");
    assert.equal(events.map(s => JSON.parse(s).choices[0].delta.content || "").join(""), "NATIVE_DRAIN_TURN_2_OK");
    assert.ok(events.every(s => !s.includes("tool_calls"))); assert.equal(p.requests.length, 2); p.assertHealthy();
  } finally { await p.close(); }
  assert.equal(p.server.listening, false);
});

test("provider rejects Codex/unknown endpoints, auth, malformed JSON, schema and request excess", async () => {
  const p = createOpenCodeLocalProvider({ maxRequests: 1 }), base = await p.listen();
  try {
    assert.equal((await request(base, {}, "/responses")).status, 404);
    assert.equal((await request(base, chat(true), "/chat/completions", "wrong")).status, 401);
    assert.equal((await request(base, "{")).status, 400);
    assert.equal((await request(base, { ...chat(true), model: "remote/model" })).status, 422);
    assert.equal((await request(base, chat(true))).status, 200);
    assert.equal((await request(base, chat(true))).status, 429);
    assert.equal(p.requests.length, 1); assert.throws(() => p.assertHealthy(), /failed/);
  } finally { await p.close(); }
});


test("streaming title generation is bounded separately from the two task responses", async () => {
  const p = createOpenCodeLocalProvider(), base = await p.listen();
  try {
    const body = { ...chat(true), messages: [{ role: "system", content: "You are a title generator. You output ONLY a thread title." },
      { role: "user", content: "Generate a title for this conversation:" }, ...chat(true).messages] };
    const result = await request(base, body); assert.equal(result.status, 200);
    assert.equal(p.requests[0].purpose, "title"); assert.equal(p.requests[0].turn, null);
    assert.equal(p.requests[0].responseText, "Isolated native drain verification");
    await request(base, chat(true)); assert.equal(p.requests[1].purpose, "task"); assert.equal(p.requests[1].turn, 2);
    p.assertHealthy();
  } finally { await p.close(); }
});

test("source correspondence checks transitive production dependencies and records unrelated concurrent edits", t => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "opencode-source-correspondence-")));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const repository = path.join(root, "repo"), source = path.join(root, "build/src"), moduleRoot = path.join(root, "build/dist");
  const verifier = fs.readFileSync(path.join(__dirname, "verify_opencode_owned_native_drain.js"), "utf8");
  const roots = [...verifier.matchAll(/load\("([A-Za-z0-9_/.]+\.js)"\)/g)].map(m => m[1]);
  roots.push("runtime/departmentleaderprocessownerworker.js", "cli/transitive.js", "unrelated.js");
  for (const relative of roots) {
    for (const dir of [source, path.join(repository, "src")]) {
      const file = path.join(dir, relative.replace(/\.js$/, ".ts"));
      fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, "// physical source");
    }
    const compiled = path.join(moduleRoot, relative); fs.mkdirSync(path.dirname(compiled), { recursive: true }); fs.writeFileSync(compiled, "");
  }
  fs.writeFileSync(path.join(moduleRoot, "runtime/departmentleaderprocessownerworker.js"), 'require("../cli/transitive");');
  fs.writeFileSync(path.join(repository, "src/unrelated.ts"), "// concurrent unrelated change");
  const result = snapshot({ repository, source, moduleRoot });
  assert.deepEqual(result.unrelatedDifferences, ["unrelated.ts"]);
  assert.ok(result.relevantSources["cli/transitive.ts"]);
  fs.writeFileSync(path.join(repository, "src/cli/transitive.ts"), "// changed dependency");
  assert.throws(() => snapshot({ repository, source, moduleRoot }), /production dependency mismatch/);
});

test("native event directory evidence rejects split instance, missing history and workspace bypass", () => {
  assert.equal(assertEventDirectory("/tmp/root", ["/tmp/root", "/tmp/root"], "/tmp/root", "/tmp/workspace").samePhysicalDirectory, true);
  assert.throws(() => assertEventDirectory("/tmp/workspace", ["/tmp/root"], "/tmp/workspace", "/tmp/workspace"), /bypasses/);
  assert.throws(() => assertEventDirectory("/tmp/root", ["/tmp/other"], "/tmp/root", "/tmp/workspace"), /mismatch/);
  assert.throws(() => assertEventDirectory("/tmp/root", ["/tmp/root"], undefined, "/tmp/workspace"), /missing absolute/);
  assertEventDirectory("C:\\root", ["c:\\ROOT"], "C:\\root", "C:\\workspace", path.win32);
});
