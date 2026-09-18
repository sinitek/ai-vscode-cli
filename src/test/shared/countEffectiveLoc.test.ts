import test = require("node:test");
import assert = require("node:assert/strict");
import * as childProcess from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const SCRIPT_PATH = path.join(process.cwd(), "scripts", "count_effective_loc.js");

test("effective loc counter splits source and tests then totals them", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sinitek-loc-count-"));
  try {
    const srcDir = path.join(tempDir, "src");
    const testDir = path.join(srcDir, "test");
    const mediaDir = path.join(tempDir, "media");
    fs.mkdirSync(testDir, { recursive: true });
    fs.mkdirSync(mediaDir, { recursive: true });

    fs.writeFileSync(
      path.join(srcDir, "hello.ts"),
      [
        "// comment",
        "",
        "export const value = 1;",
        "/* block",
        "comment */",
        "export const other = 2;",
        "",
      ].join("\n"),
      "utf8",
    );
    fs.writeFileSync(
      path.join(testDir, "hello.test.ts"),
      [
        "import test = require(\"node:test\");",
        "",
        "test(\"ok\", () => {",
        "  const value = 1; // note",
        "});",
        "",
      ].join("\n"),
      "utf8",
    );
    fs.writeFileSync(
      path.join(mediaDir, "app.js"),
      [
        "function main() {",
        "  return 1;",
        "}",
        "",
      ].join("\n"),
      "utf8",
    );
    fs.writeFileSync(path.join(mediaDir, "vendor.min.js"), "function x(){return 1;}\n", "utf8");
    fs.writeFileSync(path.join(mediaDir, "readme.md"), "# not code\n", "utf8");
    fs.writeFileSync(
      path.join(mediaDir, "bundle.js"),
      `${"const x=1;".repeat(2000)}\n`,
      "utf8",
    );

    const result = childProcess.spawnSync(
      process.execPath,
      [SCRIPT_PATH, "--json", path.join(tempDir, "src"), path.join(tempDir, "media")],
      {
        cwd: process.cwd(),
        encoding: "utf8",
      },
    );

    assert.equal(result.status, 0, result.stderr || result.stdout);
    const report = JSON.parse(result.stdout);
    assert.equal(report.groups.src.source.effective, 2);
    assert.equal(report.groups.src.test.effective, 4);
    assert.equal(report.groups.src.subtotal.effective, 6);
    assert.equal(report.groups.media.source.effective, 3);
    assert.equal(report.groups.media.test.effective, 0);
    assert.equal(report.totals.source.effective, 5);
    assert.equal(report.totals.test.effective, 4);
    assert.equal(report.totals.all.effective, 9);
    assert.equal(report.totals.all.files, 3);
    assert.ok(report.skipped.reasons.minified >= 2);
    assert.ok(report.skipped.reasons.nonCode >= 1);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("effective loc counter keeps http strings as code", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sinitek-loc-url-"));
  try {
    const srcDir = path.join(tempDir, "src");
    fs.mkdirSync(srcDir, { recursive: true });
    fs.writeFileSync(
      path.join(srcDir, "url.ts"),
      [
        "export const endpoint = \"http://example.com\";",
        "export const pattern = /https:\\/\\/foo/;",
        "",
      ].join("\n"),
      "utf8",
    );

    const result = childProcess.spawnSync(
      process.execPath,
      [SCRIPT_PATH, "--json", srcDir],
      {
        cwd: process.cwd(),
        encoding: "utf8",
      },
    );

    assert.equal(result.status, 0, result.stderr || result.stdout);
    const report = JSON.parse(result.stdout);
    assert.equal(report.totals.source.effective, 2);
    assert.equal(report.totals.source.comment, 0);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("effective loc counter recovers after quoted strings inside template expressions", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sinitek-loc-template-"));
  try {
    const srcDir = path.join(tempDir, "src");
    fs.mkdirSync(srcDir, { recursive: true });
    fs.writeFileSync(
      path.join(srcDir, "template.ts"),
      [
        "const label = `${buildProcessLabel(\"opencode\", runId)}-server`;",
        "// comment after template",
        "const value = 1;",
        "",
      ].join("\n"),
      "utf8",
    );

    const result = childProcess.spawnSync(
      process.execPath,
      [SCRIPT_PATH, "--json", srcDir],
      {
        cwd: process.cwd(),
        encoding: "utf8",
      },
    );

    assert.equal(result.status, 0, result.stderr || result.stdout);
    const report = JSON.parse(result.stdout);
    assert.equal(report.totals.source.effective, 2);
    assert.equal(report.totals.source.comment, 1);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
