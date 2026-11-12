import test = require("node:test");
import assert = require("node:assert/strict");
import * as fs from "fs/promises";
import * as path from "path";
import { installVscodeMock } from "../vscodeMock";
import { withCodexIdentityFixture } from "./codexRuntimeConfigFixture";

installVscodeMock();

function section(project: string, fields: string): string {
  return `[projects.${JSON.stringify(project)}]\n${fields}\n`;
}

test("real fingerprints survive own trust persistence, neighboring project trust and equivalent TOML/JSON", async () => {
  await withCodexIdentityFixture(async (f) => {
    const empty = await f.fingerprint("codex", "profile", f.a);
    await f.trust(f.a);
    assert.equal(await f.fingerprint("codex", "profile", f.a), empty);
    await f.writeConfig('model = "fixture"\nunknown = { b = 2, a = ["x", "y"] }\n');
    await fs.writeFile(f.authPath, '{"token":"synthetic","nested":{"b":2,"a":1}}');
    const before = await f.fingerprint("codex", "profile", f.a);
    await f.trust(f.a);
    await f.trust(f.b);
    assert.equal(await f.fingerprint("codex", "profile", f.a), before);
    await f.writeConfig(`# comment\nunknown={a=['x', 'y'],b=2}\nmodel='fixture'\n${section(f.b, 'trust_level = "untrusted"')}`);
    await fs.writeFile(f.authPath, '{\n "nested": {"a": 1, "b": 2}, "token": "synthetic"\n}');
    assert.equal(await f.fingerprint("codex", "profile", f.a), before);
    assert.match(before, /^[a-f\d]{64}$/);
  });
});

test("effective permissions, provider, unknown config, array order, authentication and profile still isolate", async () => {
  await withCodexIdentityFixture(async (f) => {
    const base = 'model_provider="fixture"\napproval_policy="on-request"\nsandbox_mode="read-only"\nfuture={values=[1,2], flag=true}\n';
    await f.writeConfig(base);
    await fs.writeFile(f.authPath, '{"token":"synthetic-before","unknown":[1,2]}');
    const before = await f.fingerprint("codex", "profile", f.a);
    for (const changed of [
      base.replace('provider="fixture"', 'provider="other"'),
      base.replace('"on-request"', '"never"'),
      base.replace('"read-only"', '"workspace-write"'),
      base.replace('flag=true', 'flag=false'),
      base.replace('[1,2]', '[2,1]'),
      base + section(f.a, 'trust_level="trusted"\nfuture_permission=true'),
      base + section(f.root, 'trust_level="untrusted"'),
    ]) {
      await f.writeConfig(changed);
      assert.notEqual(await f.fingerprint("codex", "profile", f.a), before, changed);
    }
    await f.writeConfig(base);
    assert.notEqual(await f.fingerprint("codex", "other-profile", f.a), before);
    for (const auth of ['{"token":"synthetic-after","unknown":[1,2]}', '{"token":"synthetic-before","unknown":[2,1]}']) {
      await fs.writeFile(f.authPath, auth);
      assert.notEqual(await f.fingerprint("codex", "profile", f.a), before);
    }
  });
});

test("only the exact startup trust override is normalized; ancestors and context-free trust remain visible", async () => {
  await withCodexIdentityFixture(async (f) => {
    const realA = await fs.realpath(f.a);
    await f.writeConfig(section(realA, 'trust_level="untrusted"\nfuture_permission="keep"') + section(f.root, 'trust_level="untrusted"'));
    const before = await f.fingerprint("codex", null, f.a);
    const noContext = await f.fingerprint("codex", null);
    await f.trust(f.a);
    assert.equal(await f.fingerprint("codex", null, f.a), before);
    assert.notEqual(await f.fingerprint("codex", null), noContext);
    await f.trust(f.root);
    assert.notEqual(await f.fingerprint("codex", null, f.a), before);
    const ancestorTrusted = await f.fingerprint("codex", null, f.a);
    await f.writeConfig((await fs.readFile(f.configPath, "utf8")).replace('future_permission="keep"', 'future_permission="changed"'));
    assert.notEqual(await f.fingerprint("codex", null, f.a), ancestorTrusted);
  });
});

test("directory boundaries exclude neighbors while retaining ambiguous and relative project paths", async () => {
  await withCodexIdentityFixture(async (f) => {
    const before = await f.fingerprint("codex", null, f.b);
    await f.trust(f.a); // A is a string prefix of A-neighbor, but not an ancestor.
    assert.equal(await f.fingerprint("codex", null, f.b), before);
    const noContext = await f.fingerprint("codex", null);
    await f.trust(f.b);
    assert.notEqual(await f.fingerprint("codex", null), noContext);
    const known = await f.fingerprint("codex", null, f.a);
    await f.writeConfig((await fs.readFile(f.configPath, "utf8")) + section(path.join(f.root, "missing"), 'trust_level="untrusted"'));
    assert.notEqual(await f.fingerprint("codex", null, f.a), known);
    const missing = await f.fingerprint("codex", null, f.a);
    await f.writeConfig((await fs.readFile(f.configPath, "utf8")) + section("relative-project", 'future=true'));
    assert.notEqual(await f.fingerprint("codex", null, f.a), missing);
    const unresolvedCwd = path.join(f.root, "missing-cwd");
    await f.writeConfig(section(f.b, 'trust_level="trusted"'));
    const ambiguous = await f.fingerprint("codex", null, unresolvedCwd);
    await f.writeConfig(section(f.b, 'trust_level="untrusted"'));
    assert.notEqual(await f.fingerprint("codex", null, unresolvedCwd), ambiguous);
  });
});

test("realpath aliases and Windows case preserve applicable project permissions", async () => {
  await withCodexIdentityFixture(async (f) => {
    const alias = path.join(f.root, "alias");
    await fs.symlink(f.a, alias, process.platform === "win32" ? "junction" : "dir");
    const before = await f.fingerprint("codex", null, alias);
    await f.trust(alias);
    assert.equal(await f.fingerprint("codex", null, alias), before);
    assert.equal(await f.fingerprint("codex", null, f.a), before);
    await f.writeConfig(section(f.root, 'trust_level="untrusted"'));
    const ancestor = await f.fingerprint("codex", null, alias);
    await f.trust(f.root);
    assert.notEqual(await f.fingerprint("codex", null, alias), ancestor);
    if (process.platform === "win32") {
      await f.writeConfig(section(f.root.toUpperCase(), 'trust_level="untrusted"'));
      const upper = await f.fingerprint("codex", null, f.a.toLowerCase());
      await f.writeConfig(section(f.root.toUpperCase(), 'trust_level="trusted"'));
      assert.notEqual(await f.fingerprint("codex", null, f.a.toLowerCase()), upper);
    }
  });
});

test("source HOME changes and symlink retargets isolate equal config values", async () => {
  await withCodexIdentityFixture(async (f) => {
    const before = await f.fingerprint("codex", null, f.a);
    const second = path.join(f.root, "second-home");
    await fs.mkdir(second);
    process.env.CODEX_HOME_DIR = second;
    assert.notEqual(await f.fingerprint("codex", null, f.a), before);
    const alias = path.join(f.root, "home-alias");
    await fs.symlink(f.home, alias, process.platform === "win32" ? "junction" : "dir");
    process.env.CODEX_HOME_DIR = alias;
    const target = await f.fingerprint("codex", null, f.a);
    await fs.unlink(alias);
    await fs.symlink(second, alias, process.platform === "win32" ? "junction" : "dir");
    assert.notEqual(await f.fingerprint("codex", null, f.a), target);
    await fs.rmdir(second);
    await assert.rejects(f.fingerprint("codex", null, f.a), /配置来源链接无效/);
  });
});

test("invalid or unreadable config refuses identity without leaking parser content", async () => {
  await withCodexIdentityFixture(async (f) => {
    for (const invalid of ['secret="synthetic-secret"\ninvalid=[', 'projects=1', section(f.a, 'trust_level=7')]) {
      await f.writeConfig(invalid);
      await assert.rejects(f.fingerprint("codex", null, f.a), (error: Error) => !error.message.includes("synthetic-secret"));
      await assert.rejects(f.fingerprint("codex", null), (error: Error) => !error.message.includes("synthetic-secret"));
    }
    await f.writeConfig("");
    for (const auth of ['{"token":"synthetic-secret",', '', 'null', '[]']) {
      await fs.writeFile(f.authPath, auth);
      await assert.rejects(f.fingerprint("codex", null, f.a), (error: Error) => !error.message.includes("synthetic-secret"));
    }
    await fs.rm(f.authPath);
    await fs.rm(f.configPath);
    await fs.mkdir(f.configPath);
    await assert.rejects(f.fingerprint("codex", null, f.a), /无法读取/);
  });
});

test("TOML numeric and temporal values retain their identities", async () => {
  await withCodexIdentityFixture(async (f) => {
    for (const [first, second] of [
      ['n=9223372036854775806', 'n=9223372036854775807'],
      ['n=inf', 'n=-inf'], ['n=nan', 'n=inf'], ['n=-0.0', 'n=0.0'],
      ['n=2026-11-12', 'n="2026-11-12"'],
      ['n=1979-05-27T07:32:00', 'n=1979-05-27T07:32:00Z'],
    ]) {
      await f.writeConfig(first);
      const before = await f.fingerprint("codex", null, f.a);
      await f.writeConfig(second);
      assert.notEqual(await f.fingerprint("codex", null, f.a), before, `${first} / ${second}`);
    }
  });
});
