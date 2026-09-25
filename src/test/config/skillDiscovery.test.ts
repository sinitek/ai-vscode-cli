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
    fs.symlinkSync(path.join(root, "alpha"), path.join(root, "linked-dir"));
    fs.symlinkSync(path.join(root, "notes.txt"), path.join(root, "linked-file"));
    fs.symlinkSync(path.join(root, "missing-target"), path.join(root, "broken-link"));
    fs.symlinkSync(path.join(root, "beta"), path.join(root, ".hidden-link"));

    const names = await listSkillDirNames(root);
    assert.deepEqual(names.slice().sort(), ["alpha", "beta", "linked-dir"]);
    assert.deepEqual(await listSkillDirNames(path.join(root, "empty-missing")), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("treats unreadable skill roots as having no directories", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sinitek-skill-discovery-blocked-"));
  const blocked = path.join(root, "blocked");
  fs.mkdirSync(blocked);
  fs.mkdirSync(path.join(blocked, "visible"));
  fs.chmodSync(blocked, 0);
  try {
    assert.deepEqual(await listSkillDirNames(blocked), []);
  } finally {
    fs.chmodSync(blocked, 0o755);
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
