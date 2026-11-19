"use strict";

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const { scripts } = require("../package.json");

test("development build preserves the runnable worker after a TypeScript error", (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sinitek-build-"));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "dist"));
  const source = path.join(root, "worker.ts");
  const worker = path.join(root, "dist", "worker.js");
  const previousOutput = 'process.stdout.write("previous");';
  fs.writeFileSync(worker, previousOutput);
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ scripts }));
  fs.writeFileSync(path.join(root, "tsconfig.json"), JSON.stringify({
    compilerOptions: { outDir: "dist", types: [] },
    files: ["worker.ts"],
  }));
  const build = () => spawnSync("npm", ["run", "build"], {
    cwd: root,
    env: { ...process.env, PATH: [path.resolve(__dirname, "..", "node_modules", ".bin"), process.env.PATH].join(path.delimiter) },
    encoding: "utf8",
    shell: process.platform === "win32",
    timeout: 20000,
  });

  fs.writeFileSync(source, 'const result: number = "invalid";');
  const failed = build();
  assert.ifError(failed.error);
  assert.notEqual(failed.status, 0);
  assert.match(failed.stdout, /TS2322/);
  assert.equal(fs.readFileSync(worker, "utf8"), previousOutput);
  assert.equal(spawnSync(process.execPath, [worker], { encoding: "utf8" }).stdout, "previous");

  fs.writeFileSync(source, 'const result: string = "current"; console.log(result);');
  const succeeded = build();
  assert.equal(succeeded.status, 0, succeeded.error?.message || succeeded.stderr || succeeded.stdout);
  assert.equal(spawnSync(process.execPath, [worker], { encoding: "utf8" }).stdout.trim(), "current");
});
