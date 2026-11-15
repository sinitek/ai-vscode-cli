import test = require("node:test");
import assert = require("node:assert/strict");
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import {
  collectAncestorDirs,
  extractSkillDescription,
  listSkillDirNames,
  normalizeWorkspaceRoots,
  skillDescriptionStrategies,
} from "../../config/skillDiscovery";

function frontmatter(body: string): string {
  return `---\n${body}\n---\n# Skill\n`;
}

test("normalizes workspace roots and ignores empty input", () => {
  assert.deepEqual(normalizeWorkspaceRoots(undefined), []);
  assert.deepEqual(normalizeWorkspaceRoots([]), []);
  assert.deepEqual(normalizeWorkspaceRoots(["", "   ", "\t"]), []);
  assert.deepEqual(
    normalizeWorkspaceRoots([undefined as unknown as string, 12 as unknown as string]),
    [],
  );

  const first = path.resolve("workspace", "one");
  const second = path.resolve("workspace", "two");
  assert.deepEqual(
    normalizeWorkspaceRoots([
      "  workspace/one  ",
      path.join("workspace", "one"),
      ` ${path.join("workspace", "two")} `,
      second,
    ]),
    [first, second],
  );
});

test("collects resolved ancestors through the filesystem root", () => {
  assert.deepEqual(collectAncestorDirs(""), collectAncestorDirs(process.cwd()));

  const start = path.resolve("team", "app");
  const ancestors = collectAncestorDirs(path.join("team", "app"));
  assert.equal(ancestors[0], start);
  assert.equal(ancestors[ancestors.length - 1], path.parse(start).root);
  assert.equal(new Set(ancestors).size, ancestors.length);
  for (let index = 1; index < ancestors.length; index += 1) {
    assert.equal(ancestors[index], path.dirname(ancestors[index - 1]));
  }
});

test("lists skill directories, directory symlinks, and ignores other entries", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sinitek-skill-discovery-"));
  try {
    fs.mkdirSync(path.join(root, "alpha"));
    fs.mkdirSync(path.join(root, "beta"));
    fs.mkdirSync(path.join(root, ".hidden"));
    fs.writeFileSync(path.join(root, "notes.txt"), "ignore");
    fs.writeFileSync(path.join(root, "alpha", "marker.txt"), "linked target");
    const linkedDir = path.join(root, "linked-dir");
    if (process.platform === "win32") {
      fs.symlinkSync(path.join(root, "alpha"), linkedDir, "junction");
      fs.writeFileSync(path.join(root, "linked-file"), "ignore");
      fs.symlinkSync(path.join(root, "beta"), path.join(root, ".hidden-link"), "junction");
      const danglingTarget = path.join(root, "temporary-target");
      const brokenLink = path.join(root, "broken-link");
      fs.mkdirSync(danglingTarget);
      fs.symlinkSync(danglingTarget, brokenLink, "junction");
      fs.rmSync(danglingTarget, { recursive: true });
      assert.equal(fs.lstatSync(brokenLink).isSymbolicLink(), true);
      await assert.rejects(fs.promises.stat(brokenLink), { code: "ENOENT" });
    } else {
      fs.symlinkSync(path.join(root, "alpha"), linkedDir);
      fs.symlinkSync(path.join(root, "notes.txt"), path.join(root, "linked-file"));
      fs.symlinkSync(path.join(root, "missing-target"), path.join(root, "broken-link"));
      fs.symlinkSync(path.join(root, "beta"), path.join(root, ".hidden-link"));
    }

    const names = await listSkillDirNames(root);
    assert.deepEqual(names.slice().sort(), ["alpha", "beta", "linked-dir"]);
    assert.equal(fs.readFileSync(path.join(linkedDir, "marker.txt"), "utf8"), "linked target");
    fs.rmSync(linkedDir, { recursive: true, force: true });
    assert.equal(fs.existsSync(path.join(root, "alpha")), true);
    assert.deepEqual(await listSkillDirNames(path.join(root, "empty-missing")), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("excludes a symbolic-link entry when its target is not a directory", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sinitek-skill-discovery-link-contract-"));
  const filePath = path.join(root, "linked-file");
  const originalReaddir = fs.promises.readdir;
  const originalStat = fs.promises.stat;
  let statCalledForLink = false;
  try {
    fs.mkdirSync(path.join(root, "visible"));
    fs.writeFileSync(filePath, "ordinary file used as a stat target");
    fs.promises.readdir = (async (requestedPath, options) => {
      const entries = await originalReaddir.call(fs.promises, requestedPath as never, options as never);
      if (path.resolve(String(requestedPath)) !== path.resolve(root)) {
        return entries;
      }
      const linkedFileEntry = {
        name: "linked-file",
        isDirectory: () => false,
        isSymbolicLink: () => true,
      } as fs.Dirent;
      return [...entries, linkedFileEntry];
    }) as typeof fs.promises.readdir;
    fs.promises.stat = (async (requestedPath, options) => {
      if (path.resolve(String(requestedPath)) === path.resolve(filePath)) {
        statCalledForLink = true;
      }
      return originalStat.call(fs.promises, requestedPath as never, options as never);
    }) as typeof fs.promises.stat;

    assert.deepEqual(await listSkillDirNames(root), ["visible"]);
    assert.equal(statCalledForLink, true);
  } finally {
    fs.promises.readdir = originalReaddir;
    fs.promises.stat = originalStat;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("treats unreadable skill roots as having no directories", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sinitek-skill-discovery-blocked-"));
  const blocked = path.join(root, "blocked");
  fs.mkdirSync(blocked);
  fs.mkdirSync(path.join(blocked, "visible"));
  const originalReaddir = fs.promises.readdir;
  fs.promises.readdir = (async (requestedPath, options) => {
    if (path.resolve(String(requestedPath)) === path.resolve(blocked)) {
      throw Object.assign(new Error("access denied"), { code: "EACCES" });
    }
    return originalReaddir.call(fs.promises, requestedPath as never, options as never);
  }) as typeof fs.promises.readdir;
  try {
    assert.deepEqual(await listSkillDirNames(blocked), []);
  } finally {
    fs.promises.readdir = originalReaddir;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("uses explicit description strategies for empty frontmatter keys", () => {
  const emptyThenValue = frontmatter("description:\ndescription: \"later value\"");
  const quotedEmptyThenValue = frontmatter("description: ''\ndescription: 'kept value'");
  const firstValue = frontmatter("# comment\n\ndescription: \"  first value  \"\ndescription: second");
  const missing = "name: demo\n";

  assert.equal(
    extractSkillDescription(emptyThenValue, skillDescriptionStrategies.stopAtFirstKey),
    undefined,
  );
  assert.equal(
    extractSkillDescription(quotedEmptyThenValue, skillDescriptionStrategies.stopAtFirstKey),
    undefined,
  );
  assert.equal(
    extractSkillDescription(firstValue, skillDescriptionStrategies.stopAtFirstKey),
    "first value",
  );
  assert.equal(
    extractSkillDescription(missing, skillDescriptionStrategies.stopAtFirstKey),
    undefined,
  );

  assert.equal(
    extractSkillDescription(emptyThenValue, skillDescriptionStrategies.continueOnEmpty),
    "later value",
  );
  assert.equal(
    extractSkillDescription(quotedEmptyThenValue, skillDescriptionStrategies.continueOnEmpty),
    "kept value",
  );
  assert.equal(
    extractSkillDescription(firstValue, skillDescriptionStrategies.continueOnEmpty),
    "first value",
  );
  assert.equal(
    extractSkillDescription(missing, skillDescriptionStrategies.continueOnEmpty),
    undefined,
  );
});
