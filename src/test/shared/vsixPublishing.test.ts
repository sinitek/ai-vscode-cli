import test = require("node:test");
import assert = require("node:assert/strict");
import type { TestContext } from "node:test";
import * as childProcess from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

type PublishEvent = { args: string[]; patMatches?: boolean };

const repoRoot = path.resolve(__dirname, "..", "..", "..");
const bashAvailable = childProcess.spawnSync("bash", ["--version"]).status === 0;

function createFixture(context: TestContext, publisher = "sinitek") {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sinitek publish test "));
  context.after(() => fs.rmSync(fixtureRoot, { recursive: true, force: true }));
  const eventFile = path.join(fixtureRoot, "events.jsonl");
  const scriptPath = path.join(fixtureRoot, "publish_vscode_extension.sh");
  fs.copyFileSync(path.join(repoRoot, "publish_vscode_extension.sh"), scriptPath);
  fs.mkdirSync(path.join(fixtureRoot, "scripts"));
  for (const script of ["install_workspace_node_modules.sh", "vsix_target.js"]) {
    fs.copyFileSync(path.join(repoRoot, "scripts", script), path.join(fixtureRoot, "scripts", script));
  }
  fs.writeFileSync(path.join(fixtureRoot, "package.json"), JSON.stringify({
    name: "sinitek-cli-tools", publisher, version: "1.2.0",
  }));
  const vscePath = path.join(fixtureRoot, "node_modules", ".bin", "vsce");
  fs.mkdirSync(path.dirname(vscePath), { recursive: true });
  fs.writeFileSync(vscePath, `#!${process.execPath}
const fs = require("node:fs");
const args = process.argv.slice(2);
fs.appendFileSync(process.env.EVENT_FILE, JSON.stringify({ args, patMatches: process.env.VSCE_PAT === process.env.EXPECTED_PAT }) + "\\n");
if (args[0] === "ls-publishers" && process.env.CACHED_PUBLISHER) console.log(process.env.CACHED_PUBLISHER);
if (args[0] === process.env.FAIL_COMMAND) process.exit(1);
`, { mode: 0o755 });
  fs.writeFileSync(path.join(fixtureRoot, "export_vscode_extension.sh"), `#!${process.execPath}
const fs = require("node:fs");
const path = require("node:path");
const args = process.argv.slice(2);
fs.appendFileSync(process.env.EVENT_FILE, JSON.stringify({ args: ["export", ...args] }) + "\\n");
if (process.env.FAIL_COMMAND === "export") process.exit(1);
const suffix = args[1] === "universal" ? "" : "-" + args[1];
if (!process.env.OMIT_PACKAGE) fs.writeFileSync(path.join(process.cwd(), "dist", "sinitek-cli-tools-1.2.0" + suffix + ".vsix"), "fixture vsix");
`, { mode: 0o755 });
  function run(args: string[] = [], overrides: NodeJS.ProcessEnv = {}) {
    const env = { ...process.env };
    for (const key of ["VSCE_PAT", "VSCODE_MARKETPLACE_PAT", "VSCE_AZURE_CREDENTIAL", "CACHED_PUBLISHER", "FAIL_COMMAND", "OMIT_PACKAGE"]) {
      delete env[key];
    }
    return childProcess.spawnSync("bash", [scriptPath, ...args], {
      cwd: os.tmpdir(),
      encoding: "utf8",
      env: { ...env, EVENT_FILE: eventFile, ...overrides },
      timeout: 15000,
    });
  }
  function events(): PublishEvent[] {
    return fs.existsSync(eventFile)
      ? fs.readFileSync(eventFile, "utf8").trim().split("\n").map((line) => JSON.parse(line))
      : [];
  }
  return { fixtureRoot, run, events };
}

test("市场发布者使用用户指定的 sinitek ID", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
  assert.equal(manifest.publisher, "sinitek");
});

test("发布帮助与无效参数不触发鉴权、导出或发布", { skip: !bashAvailable }, (context) => {
  const fixture = createFixture(context);
  const help = fixture.run(["--help"]);
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /sinitek/);
  for (const args of [["--unknown"], ["--target"], ["--target", "unsupported"]]) {
    assert.equal(fixture.run(args).status, 1);
  }
  assert.deepEqual(fixture.events(), []);
});

for (const tokenSource of ["VSCE_PAT", "VSCODE_MARKETPLACE_PAT"]) {
  test(`发布流程通过环境变量 ${tokenSource} 鉴权且不暴露令牌`, { skip: !bashAvailable }, (context) => {
    const fixture = createFixture(context);
    const token = "fixture-publishing-token";
    const result = fixture.run([], { [tokenSource]: token, EXPECTED_PAT: token });
    assert.equal(result.status, 0, result.stderr);
    const events = fixture.events();
    assert.deepEqual(events.map((event) => event.args), [
      ["verify-pat", "sinitek"],
      ["export", "--target", "universal"],
      ["publish", "--packagePath", path.join(fixture.fixtureRoot, "dist", "sinitek-cli-tools-1.2.0.vsix")],
    ]);
    assert.equal(events[0].patMatches, true);
    assert.equal(events[2].patMatches, true);
    assert.equal(JSON.stringify(events).includes(token), false);
    assert.equal((result.stdout + result.stderr).includes(token), false);
    assert.match(result.stdout, /发布成功：sinitek\.sinitek-cli-tools@1\.2\.0/);
  });
}

test("主令牌优先且平台发布只上传导出脚本生成的对应平台 VSIX", { skip: !bashAvailable }, (context) => {
  const fixture = createFixture(context);
  const result = fixture.run(["--target", "win32-x64"], {
    VSCE_PAT: "primary-token", VSCODE_MARKETPLACE_PAT: "fallback-token", EXPECTED_PAT: "primary-token",
  });
  assert.equal(result.status, 0, result.stderr);
  const events = fixture.events();
  assert.equal(events[0].patMatches, true);
  assert.deepEqual(events[1].args, ["export", "--target", "win32-x64"]);
  assert.deepEqual(events[2].args, ["publish", "--packagePath", path.join(fixture.fixtureRoot, "dist", "sinitek-cli-tools-1.2.0-win32-x64.vsix")]);
});

test("无环境令牌时复用 sinitek 的 vsce 登录缓存", { skip: !bashAvailable }, (context) => {
  const fixture = createFixture(context);
  const result = fixture.run([], { CACHED_PUBLISHER: "sinitek" });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(fixture.events().map((event) => event.args[0]), ["ls-publishers", "verify-pat", "export", "publish"]);
});

test("非交互运行缺少凭据时提示本机登录且不开始导出", { skip: !bashAvailable }, (context) => {
  const fixture = createFixture(context);
  const result = fixture.run([], { CACHED_PUBLISHER: "other-publisher" });
  assert.equal(result.status, 1);
  assert.ok(result.stderr.includes(`"${path.join(fixture.fixtureRoot, "node_modules", ".bin", "vsce")}" login sinitek`));
  assert.doesNotMatch(result.stderr, /npx/);
  assert.deepEqual(fixture.events().map((event) => event.args[0]), ["ls-publishers"]);
});

test("publisher 不匹配时在访问凭据之前拒绝发布", { skip: !bashAvailable }, (context) => {
  const fixture = createFixture(context, "other-publisher");
  const result = fixture.run([], { VSCE_PAT: "fixture-token" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /publisher 必须为 sinitek/);
  assert.deepEqual(fixture.events(), []);
});

for (const failure of ["verify-pat", "export"]) {
  test(`${failure} 失败后不发布 VSIX`, { skip: !bashAvailable }, (context) => {
    const fixture = createFixture(context);
    const result = fixture.run([], { VSCE_PAT: "fixture-token", FAIL_COMMAND: failure });
    assert.equal(result.status, 1);
    assert.deepEqual(fixture.events().map((event) => event.args[0]), failure === "verify-pat" ? ["verify-pat"] : ["verify-pat", "export"]);
  });
}

test("导出未生成有效文件时阻止发布", { skip: !bashAvailable }, (context) => {
  const fixture = createFixture(context);
  const result = fixture.run([], { VSCE_PAT: "fixture-token", OMIT_PACKAGE: "1" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /未找到有效 VSIX/);
  assert.deepEqual(fixture.events().map((event) => event.args[0]), ["verify-pat", "export"]);
});

test("上传失败不输出成功并保留导出的 VSIX", { skip: !bashAvailable }, (context) => {
  const fixture = createFixture(context);
  const result = fixture.run([], { VSCE_PAT: "fixture-token", FAIL_COMMAND: "publish" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /已发布版本不能重复覆盖/);
  assert.doesNotMatch(result.stdout, /发布成功/);
  assert.equal(fs.existsSync(path.join(fixture.fixtureRoot, "dist", "sinitek-cli-tools-1.2.0.vsix")), true);
});
