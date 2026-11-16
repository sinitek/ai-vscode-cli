"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { isPathWithin, parseArgs, realPathWithin } = require("./verify_codex_owned_native_drain");

assert.equal(isPathWithin("C:\\isolated\\codex-home", "C:\\isolated\\codex-home\\thread.json", path.win32), true);
assert.equal(isPathWithin("C:\\isolated\\codex-home", "C:\\isolated\\codex-home-old\\thread.json", path.win32), false);
assert.equal(isPathWithin("C:\\isolated\\codex-home", "C:\\outside\\thread.json", path.win32), false);
assert.equal(isPathWithin("C:\\isolated\\codex-home", "D:\\isolated\\codex-home\\thread.json", path.win32), false);
assert.equal(isPathWithin("C:\\isolated\\codex-home", "c:\\ISOLATED\\CODEX-HOME\\thread.json", path.win32), true);
assert.equal(isPathWithin("/tmp/codex-home", "/tmp/codex-home/thread.json"), true);
assert.equal(isPathWithin("/tmp/codex-home", "/tmp/codex-home-escape/thread.json"), false);

assert.deepEqual(parseArgs(["--live", "--module-root", "/tmp/isolated-build/dist", "--report", "/tmp/new.json"]), {
  live: true, moduleRoot: "/tmp/isolated-build/dist", reportPath: "/tmp/new.json",
});
assert.throws(() => parseArgs(["--live"]), /--module-root/);
assert.throws(() => parseArgs(["--live", "--module-root", "dist"]), /absolute isolated-build/);
assert.throws(() => parseArgs(["--live", "--module-root", "/tmp/build", "--unexpected"]), /unknown option/);

const root = fs.mkdtempSync(path.join(os.tmpdir(), "codex-native-drain-path-test-"));
try {
  const codexHome = path.join(root, "codex-home"), outside = path.join(root, "outside");
  fs.mkdirSync(codexHome); fs.mkdirSync(outside);
  fs.writeFileSync(path.join(codexHome, "thread.json"), "{}");
  fs.writeFileSync(path.join(outside, "thread.json"), "{}");
  assert.equal(realPathWithin(codexHome, path.join(codexHome, "thread.json")), true);
  assert.equal(realPathWithin(codexHome, path.join(outside, "thread.json")), false);
  const escapedLink = path.join(codexHome, "linked-thread.json");
  fs.symlinkSync(path.join(outside, "thread.json"), escapedLink);
  assert.equal(realPathWithin(codexHome, escapedLink), false);
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log("codex native drain path and CLI argument checks passed");
