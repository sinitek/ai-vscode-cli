#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const {
  APPROVED_SKILL_IDS,
  APPROVED_SKILL_POLICIES,
  EXPECTED_PAYLOAD_PATHS,
  MAX_FILE_BYTES,
  PACK_ROOT,
  REFERENCE_PATHS,
  SCHEMA_VERSION,
  SOURCE_METADATA,
  UPSTREAM_LICENSE_TEXT,
  buildSnapshotSha256,
  buildThirdPartyLicense,
  compactDescription,
  compareAscii,
  decodeUtf8,
  parseSkillFrontmatter,
  sha256,
  validatePack,
} = require("./validate_loop_workflow_skills");

const SOURCE_PLUGIN_PATH = ".codex-plugin/plugin.json";
const SOURCE_LICENSE_PATH = "LICENSE";
const SOURCE_SKILL_MARKDOWN_PATHS = Object.freeze([
  ...new Set([
    ...APPROVED_SKILL_IDS.map((id) => `skills/${id}/SKILL.md`),
    ...Object.values(APPROVED_SKILL_POLICIES).flatMap((item) => item.supportFiles.filter((supportPath) => supportPath.startsWith("skills/"))),
  ]),
].sort(compareAscii));
const OPTIONAL_EXCLUDED_SOURCE_FILES = Object.freeze([
  "skills/.DS_Store",
  "skills/idea-refine/scripts/idea-refine.sh",
]);

function usage() {
  return "Usage:\n  node scripts/sync_loop_workflow_skills.js --source <agent-skills-root>\n  node scripts/sync_loop_workflow_skills.js --check";
}

function parseArguments(argv) {
  let source = null;
  let check = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--check") {
      check = true;
      continue;
    }
    if (argument === "--source") {
      if (index + 1 >= argv.length) {
        throw new Error("--source requires a path.");
      }
      source = argv[index + 1];
      index += 1;
      continue;
    }
    if (argument.startsWith("--source=")) {
      source = argument.slice("--source=".length);
      continue;
    }
    if (argument === "--help" || argument === "-h") {
      return Object.freeze({ help: true, source: null, check: false });
    }
    throw new Error(`Unknown argument: ${argument}`);
  }
  if (check === Boolean(source)) {
    throw new Error("Choose exactly one mode: --source <path> or --check.");
  }
  return Object.freeze({ help: false, source, check });
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isContained(rootPath, candidatePath) {
  return candidatePath === rootPath || candidatePath.startsWith(`${rootPath}${path.sep}`);
}

function inspectSourceRoot(sourceArgument) {
  const absoluteRoot = path.resolve(sourceArgument);
  const rootStat = fs.lstatSync(absoluteRoot);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    throw new Error("Source root must be a real directory, not a symlink or special file.");
  }
  const realRoot = fs.realpathSync(absoluteRoot);
  return Object.freeze({ absoluteRoot, realRoot });
}

function collectSourceSubtree(sourceRoot, relativeRoot) {
  const absoluteSubtree = path.join(sourceRoot.absoluteRoot, ...relativeRoot.split("/"));
  const subtreeStat = fs.lstatSync(absoluteSubtree);
  if (subtreeStat.isSymbolicLink() || !subtreeStat.isDirectory()) {
    throw new Error(`${relativeRoot} must be a real directory.`);
  }
  const realSubtree = fs.realpathSync(absoluteSubtree);
  if (!isContained(sourceRoot.realRoot, realSubtree)) {
    throw new Error(`${relativeRoot} resolves outside the source root.`);
  }

  const directories = new Set();
  const files = new Map();

  function walk(currentAbsolute, currentRelative) {
    const names = fs.readdirSync(currentAbsolute).sort(compareAscii);
    for (const name of names) {
      const relativePath = `${currentRelative}/${name}`;
      const absolutePath = path.join(currentAbsolute, name);
      const stat = fs.lstatSync(absolutePath);
      if (stat.isSymbolicLink()) {
        throw new Error(`${relativePath} is a symbolic link; source links are not allowed.`);
      }
      const realPath = fs.realpathSync(absolutePath);
      if (!isContained(sourceRoot.realRoot, realPath)) {
        throw new Error(`${relativePath} resolves outside the source root.`);
      }
      if (stat.isDirectory()) {
        directories.add(relativePath);
        walk(absolutePath, relativePath);
        continue;
      }
      if (!stat.isFile()) {
        throw new Error(`${relativePath} is not a regular file or directory.`);
      }
      files.set(relativePath, Object.freeze({ absolutePath, realPath, stat }));
    }
  }

  walk(absoluteSubtree, relativeRoot);
  return Object.freeze({ directories, files });
}

function assertRequiredAndAllowed(actualValues, requiredValues, optionalValues, label) {
  const actual = new Set(actualValues);
  const required = new Set(requiredValues);
  const allowed = new Set([...requiredValues, ...optionalValues]);
  const missing = [...required].filter((value) => !actual.has(value)).sort(compareAscii);
  const unexpected = [...actual].filter((value) => !allowed.has(value)).sort(compareAscii);
  if (missing.length > 0 || unexpected.length > 0) {
    const details = [];
    if (missing.length > 0) {
      details.push(`missing ${missing.join(", ")}`);
    }
    if (unexpected.length > 0) {
      details.push(`unexpected ${unexpected.join(", ")}`);
    }
    throw new Error(`${label} inventory mismatch: ${details.join("; ")}.`);
  }
}

function inspectSourcePathSegments(sourceRoot, relativePath) {
  const segments = relativePath.split("/");
  let absolutePath = sourceRoot.absoluteRoot;
  let stat = null;
  for (let index = 0; index < segments.length; index += 1) {
    absolutePath = path.join(absolutePath, segments[index]);
    stat = fs.lstatSync(absolutePath);
    if (stat.isSymbolicLink()) {
      throw new Error(`${segments.slice(0, index + 1).join("/")} is a symbolic link; source links are not allowed.`);
    }
    if (index < segments.length - 1 && !stat.isDirectory()) {
      throw new Error(`${segments.slice(0, index + 1).join("/")} must be a source directory.`);
    }
  }
  return Object.freeze({ absolutePath, stat });
}

function readSourceFile(sourceRoot, relativePath, options = {}) {
  const { absolutePath, stat } = inspectSourcePathSegments(sourceRoot, relativePath);
  if (!stat.isFile()) {
    throw new Error(`${relativePath} must be a regular source file, not a symlink or special file.`);
  }
  const realPath = fs.realpathSync(absolutePath);
  if (!isContained(sourceRoot.realRoot, realPath)) {
    throw new Error(`${relativePath} resolves outside the source root.`);
  }
  if (options.enforcePayloadLimit && stat.size > MAX_FILE_BYTES) {
    throw new Error(`${relativePath} exceeds the ${MAX_FILE_BYTES}-byte single-file limit.`);
  }
  const buffer = fs.readFileSync(absolutePath);
  if (options.requireUtf8) {
    decodeUtf8(buffer, relativePath);
  }
  return buffer;
}

function validateSourcePlugin(buffer) {
  const raw = decodeUtf8(buffer, SOURCE_PLUGIN_PATH);
  let plugin;
  try {
    plugin = JSON.parse(raw);
  } catch (error) {
    throw new Error(`${SOURCE_PLUGIN_PATH} is invalid JSON: ${error.message}`);
  }
  if (!isRecord(plugin)) {
    throw new Error(`${SOURCE_PLUGIN_PATH} must contain an object.`);
  }
  const checks = [
    ["name", SOURCE_METADATA.name],
    ["version", SOURCE_METADATA.version],
    ["repository", SOURCE_METADATA.url],
    ["license", SOURCE_METADATA.license],
    ["skills", "./skills/"],
  ];
  for (const [key, expectedValue] of checks) {
    if (plugin[key] !== expectedValue) {
      throw new Error(`${SOURCE_PLUGIN_PATH}.${key} must equal ${expectedValue}.`);
    }
  }
}

function validateSourceInventory(sourceRoot) {
  const skillsTree = collectSourceSubtree(sourceRoot, "skills");
  const expectedSkillDirectories = APPROVED_SKILL_IDS.map((id) => `skills/${id}`);
  assertRequiredAndAllowed(
    skillsTree.directories,
    expectedSkillDirectories,
    ["skills/idea-refine/scripts"],
    "Source skills directories"
  );
  assertRequiredAndAllowed(
    skillsTree.files.keys(),
    SOURCE_SKILL_MARKDOWN_PATHS,
    OPTIONAL_EXCLUDED_SOURCE_FILES,
    "Source skills files"
  );

  const referencesTree = collectSourceSubtree(sourceRoot, "references");
  assertRequiredAndAllowed(referencesTree.directories, [], [], "Source reference directories");
  assertRequiredAndAllowed(referencesTree.files.keys(), REFERENCE_PATHS, [], "Source reference files");
}

function createPayload(sourceArgument) {
  const sourceRoot = inspectSourceRoot(sourceArgument);
  validateSourceInventory(sourceRoot);
  validateSourcePlugin(readSourceFile(sourceRoot, SOURCE_PLUGIN_PATH, { requireUtf8: true }));

  const upstreamLicense = decodeUtf8(readSourceFile(sourceRoot, SOURCE_LICENSE_PATH, { requireUtf8: true }), SOURCE_LICENSE_PATH);
  if (upstreamLicense !== UPSTREAM_LICENSE_TEXT) {
    throw new Error("Upstream LICENSE does not match the approved Addy Osmani MIT license text.");
  }

  const payload = new Map();
  for (const relativePath of [...SOURCE_SKILL_MARKDOWN_PATHS, ...REFERENCE_PATHS].sort(compareAscii)) {
    const buffer = readSourceFile(sourceRoot, relativePath, { enforcePayloadLimit: true, requireUtf8: true });
    payload.set(relativePath, buffer);
  }
  payload.set("THIRD_PARTY_LICENSE.md", Buffer.from(buildThirdPartyLicense(), "utf8"));

  const files = [...payload.entries()]
    .map(([relativePath, buffer]) => Object.freeze({ path: relativePath, bytes: buffer.length, sha256: sha256(buffer) }))
    .sort((left, right) => compareAscii(left.path, right.path));
  const fileRecords = new Map(files.map((file) => [file.path, file]));

  const skills = APPROVED_SKILL_IDS.map((id) => {
    const relativePath = `skills/${id}/SKILL.md`;
    const buffer = payload.get(relativePath);
    const text = decodeUtf8(buffer, relativePath);
    const frontmatter = parseSkillFrontmatter(text, relativePath);
    if (frontmatter.name !== id) {
      throw new Error(`${relativePath} frontmatter.name must equal ${id}.`);
    }
    const fileRecord = fileRecords.get(relativePath);
    const policyValue = APPROVED_SKILL_POLICIES[id];
    return Object.freeze({
      id,
      name: frontmatter.name,
      description: compactDescription(frontmatter.description),
      path: relativePath,
      bytes: fileRecord.bytes,
      sha256: fileRecord.sha256,
      supportFiles: [...policyValue.supportFiles],
      developmentOnly: true,
      phases: [...policyValue.phases],
      taskKinds: [...policyValue.taskKinds],
      roles: [...policyValue.roles],
      requiredCapabilities: [...policyValue.requiredCapabilities],
      priority: policyValue.priority,
      positiveTriggers: [...policyValue.positiveTriggers],
      negativeTriggers: [...policyValue.negativeTriggers],
    });
  });

  const manifest = Object.freeze({
    schemaVersion: SCHEMA_VERSION,
    source: Object.freeze({
      name: SOURCE_METADATA.name,
      url: SOURCE_METADATA.url,
      version: SOURCE_METADATA.version,
      license: SOURCE_METADATA.license,
      snapshotSha256: buildSnapshotSha256(files),
    }),
    files,
    skills,
  });

  const actualPayloadPaths = [...payload.keys()].sort(compareAscii);
  if (actualPayloadPaths.length !== EXPECTED_PAYLOAD_PATHS.length
    || actualPayloadPaths.some((value, index) => value !== EXPECTED_PAYLOAD_PATHS[index])) {
    throw new Error("Generated payload does not match the approved closure.");
  }

  return Object.freeze({ payload, manifest });
}

function assertTargetParent() {
  const parentRoot = path.dirname(PACK_ROOT);
  const stat = fs.lstatSync(parentRoot);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error("Snapshot parent must be a real directory.");
  }
  return parentRoot;
}

function writeStagingSnapshot(generated) {
  assertTargetParent();
  const stagingRoot = fs.mkdtempSync(`${PACK_ROOT}.staging-`);
  try {
    for (const [relativePath, buffer] of [...generated.payload.entries()].sort(([left], [right]) => compareAscii(left, right))) {
      const absolutePath = path.join(stagingRoot, ...relativePath.split("/"));
      fs.mkdirSync(path.dirname(absolutePath), { recursive: true, mode: 0o755 });
      fs.writeFileSync(absolutePath, buffer, { flag: "wx", mode: 0o644 });
    }
    const manifestBuffer = Buffer.from(`${JSON.stringify(generated.manifest, null, 2)}\n`, "utf8");
    fs.writeFileSync(path.join(stagingRoot, "manifest.json"), manifestBuffer, { flag: "wx", mode: 0o644 });
    const summary = validatePack(stagingRoot);
    return Object.freeze({ stagingRoot, summary });
  } catch (error) {
    fs.rmSync(stagingRoot, { recursive: true, force: true });
    throw error;
  }
}

function replaceSnapshot(stagingRoot) {
  const backupRoot = `${stagingRoot}.previous`;
  let previousMoved = false;

  if (fs.existsSync(PACK_ROOT)) {
    const targetStat = fs.lstatSync(PACK_ROOT);
    if (targetStat.isSymbolicLink() || !targetStat.isDirectory()) {
      throw new Error("Existing snapshot target must be a real directory.");
    }
    fs.renameSync(PACK_ROOT, backupRoot);
    previousMoved = true;
  }

  try {
    fs.renameSync(stagingRoot, PACK_ROOT);
  } catch (error) {
    if (previousMoved) {
      try {
        fs.renameSync(backupRoot, PACK_ROOT);
      } catch (rollbackError) {
        throw new Error(`Snapshot replacement failed (${error.message}) and rollback failed (${rollbackError.message}); previous snapshot remains at ${backupRoot}.`);
      }
    }
    throw error;
  }

  if (previousMoved) {
    fs.rmSync(backupRoot, { recursive: true, force: true });
  }
}

function syncFromSource(sourceArgument) {
  const generated = createPayload(sourceArgument);
  const { stagingRoot, summary } = writeStagingSnapshot(generated);
  try {
    replaceSnapshot(stagingRoot);
  } finally {
    if (fs.existsSync(stagingRoot)) {
      fs.rmSync(stagingRoot, { recursive: true, force: true });
    }
  }
  return summary;
}

function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }
  if (options.check) {
    const summary = validatePack(PACK_ROOT);
    console.log(
      `Loop workflow skills snapshot check passed (${summary.skillCount} skills, ${summary.payloadFileCount} payload files, ${summary.payloadBytes} payload bytes, snapshot ${summary.snapshotSha256}).`
    );
    return;
  }
  const summary = syncFromSource(options.source);
  console.log(
    `Loop workflow skills snapshot synced (${summary.skillCount} skills, ${summary.skillMarkdownCount} skill Markdown files, ${summary.referenceCount} references, ${summary.payloadFileCount} payload files, ${summary.payloadBytes} payload bytes, snapshot ${summary.snapshotSha256}).`
  );
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`Loop workflow skills sync failed: ${error.message}`);
    process.exit(1);
  }
}

module.exports = {
  createPayload,
  parseArguments,
  syncFromSource,
  validateSourceInventory,
};
