#!/usr/bin/env node

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const SCHEMA_VERSION = 1;
const MAX_FILE_BYTES = 64 * 1024;
const MAX_SNAPSHOT_BYTES = 1024 * 1024;
const PACK_ROOT = path.join(__dirname, "..", "media", "loop-workflow-skills");
const SOURCE_METADATA = Object.freeze({
  name: "agent-skills",
  url: "https://github.com/addyosmani/agent-skills",
  version: "1.0.0",
  license: "MIT",
});
const PHASES = Object.freeze(["meta", "define", "plan", "build", "verify", "review", "ship"]);
const TASK_KINDS = Object.freeze([
  "architecture",
  "planning",
  "api",
  "ui",
  "implementation",
  "refactor",
  "migration",
  "test",
  "debug",
  "review",
  "security",
  "performance",
  "documentation",
  "ci",
  "observability",
  "git",
  "release",
]);
const ROLES = Object.freeze(["main", "subtask"]);
const REFERENCE_PATHS = Object.freeze([
  "references/accessibility-checklist.md",
  "references/definition-of-done.md",
  "references/observability-checklist.md",
  "references/orchestration-patterns.md",
  "references/performance-checklist.md",
  "references/security-checklist.md",
  "references/testing-patterns.md",
]);
const UPSTREAM_LICENSE_TEXT = `MIT License

Copyright (c) 2025 Addy Osmani

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`;

function policy({
  phase,
  taskKinds,
  roles = ["subtask"],
  requiredCapabilities = [],
  supportFiles = [],
  positiveTriggers,
  negativeTriggers,
}) {
  return Object.freeze({
    phases: Object.freeze([phase]),
    taskKinds: Object.freeze(taskKinds),
    roles: Object.freeze(roles),
    requiredCapabilities: Object.freeze(requiredCapabilities),
    supportFiles: Object.freeze([...supportFiles].sort()),
    priority: (PHASES.indexOf(phase) + 1) * 10,
    positiveTriggers: Object.freeze(positiveTriggers),
    negativeTriggers: Object.freeze(negativeTriggers),
  });
}

const APPROVED_SKILL_POLICIES = Object.freeze({
  "api-and-interface-design": policy({
    phase: "build",
    taskKinds: ["architecture", "api"],
    positiveTriggers: ["API contract", "public interface"],
    negativeTriggers: ["internal implementation with no contract change"],
  }),
  "browser-testing-with-devtools": policy({
    phase: "verify",
    taskKinds: ["ui", "test", "debug", "performance"],
    requiredCapabilities: ["chrome-devtools-mcp"],
    positiveTriggers: ["browser runtime verification", "DOM inspection"],
    negativeTriggers: ["chrome devtools capability unavailable"],
  }),
  "ci-cd-and-automation": policy({
    phase: "ship",
    taskKinds: ["ci", "release"],
    positiveTriggers: ["continuous integration", "deployment pipeline"],
    negativeTriggers: ["local change with no automation impact"],
  }),
  "code-review-and-quality": policy({
    phase: "review",
    taskKinds: ["review", "security", "performance"],
    supportFiles: ["references/performance-checklist.md", "references/security-checklist.md"],
    positiveTriggers: ["code quality review", "merge readiness"],
    negativeTriggers: ["implementation is still in progress"],
  }),
  "code-simplification": policy({
    phase: "review",
    taskKinds: ["refactor", "review"],
    positiveTriggers: ["behavior-preserving refactor", "simplification"],
    negativeTriggers: ["behavior change is required"],
  }),
  "context-engineering": policy({
    phase: "build",
    taskKinds: ["architecture", "planning", "implementation", "debug", "review"],
    positiveTriggers: ["new session", "unfamiliar codebase"],
    negativeTriggers: ["task context is already bounded and sufficient"],
  }),
  "debugging-and-error-recovery": policy({
    phase: "verify",
    taskKinds: ["test", "debug"],
    positiveTriggers: ["failing test", "root cause analysis"],
    negativeTriggers: ["no reproducible failure or unexpected behavior"],
  }),
  "deprecation-and-migration": policy({
    phase: "ship",
    taskKinds: ["refactor", "migration", "release"],
    positiveTriggers: ["deprecated API", "migration plan"],
    negativeTriggers: ["no consumer migration or removal is involved"],
  }),
  "documentation-and-adrs": policy({
    phase: "ship",
    taskKinds: ["architecture", "api", "documentation", "release"],
    positiveTriggers: ["architecture decision", "technical documentation"],
    negativeTriggers: ["pure copywriting unrelated to software delivery"],
  }),
  "doubt-driven-development": policy({
    phase: "build",
    taskKinds: ["architecture", "planning", "implementation", "review", "security"],
    roles: ["main"],
    supportFiles: ["references/orchestration-patterns.md"],
    positiveTriggers: ["high-stakes decision", "security-sensitive logic"],
    negativeTriggers: ["noninteractive subtask"],
  }),
  "frontend-ui-engineering": policy({
    phase: "build",
    taskKinds: ["ui", "implementation", "refactor", "test"],
    supportFiles: ["references/accessibility-checklist.md"],
    positiveTriggers: ["accessible interface", "user-facing page"],
    negativeTriggers: ["backend-only task"],
  }),
  "git-workflow-and-versioning": policy({
    phase: "ship",
    taskKinds: ["git", "release"],
    positiveTriggers: ["semantic versioning", "version-control conflict"],
    negativeTriggers: ["unauthorized version-control mutation"],
  }),
  "idea-refine": policy({
    phase: "define",
    taskKinds: ["architecture", "planning", "documentation"],
    roles: ["main"],
    requiredCapabilities: ["interactive-user"],
    supportFiles: [
      "skills/idea-refine/examples.md",
      "skills/idea-refine/frameworks.md",
      "skills/idea-refine/refinement-criteria.md",
    ],
    positiveTriggers: ["ambiguous product idea", "MVP definition"],
    negativeTriggers: ["noninteractive subtask"],
  }),
  "incremental-implementation": policy({
    phase: "build",
    taskKinds: ["implementation", "refactor", "migration"],
    supportFiles: ["references/definition-of-done.md"],
    positiveTriggers: ["cross-file change", "vertical slice"],
    negativeTriggers: ["single trivial edit"],
  }),
  "interview-me": policy({
    phase: "define",
    taskKinds: ["architecture", "planning"],
    roles: ["main"],
    requiredCapabilities: ["interactive-user"],
    positiveTriggers: ["ambiguous requirements", "unknown user intent"],
    negativeTriggers: ["noninteractive subtask"],
  }),
  "observability-and-instrumentation": policy({
    phase: "ship",
    taskKinds: ["implementation", "observability", "release"],
    supportFiles: ["references/observability-checklist.md"],
    positiveTriggers: ["production diagnosis", "tracing"],
    negativeTriggers: ["no production runtime or telemetry impact"],
  }),
  "performance-optimization": policy({
    phase: "review",
    taskKinds: ["debug", "review", "performance"],
    supportFiles: ["references/performance-checklist.md"],
    positiveTriggers: ["measured bottleneck", "performance regression"],
    negativeTriggers: ["no measured performance issue or requirement"],
  }),
  "planning-and-task-breakdown": policy({
    phase: "plan",
    taskKinds: ["architecture", "planning"],
    supportFiles: ["references/definition-of-done.md"],
    positiveTriggers: ["implementation plan", "task breakdown"],
    negativeTriggers: ["requirements remain ambiguous"],
  }),
  "security-and-hardening": policy({
    phase: "review",
    taskKinds: ["implementation", "review", "security"],
    supportFiles: ["references/security-checklist.md"],
    positiveTriggers: ["sensitive data", "untrusted input"],
    negativeTriggers: ["no trust boundary or security-sensitive behavior"],
  }),
  "shipping-and-launch": policy({
    phase: "ship",
    taskKinds: ["test", "security", "performance", "ci", "observability", "release"],
    supportFiles: [
      "references/accessibility-checklist.md",
      "references/definition-of-done.md",
      "references/performance-checklist.md",
      "references/security-checklist.md",
    ],
    positiveTriggers: ["production deployment", "release readiness"],
    negativeTriggers: ["implementation is incomplete"],
  }),
  "source-driven-development": policy({
    phase: "build",
    taskKinds: ["api", "ui", "implementation", "documentation"],
    positiveTriggers: ["official documentation", "version-specific API"],
    negativeTriggers: ["version-independent pure logic"],
  }),
  "spec-driven-development": policy({
    phase: "define",
    taskKinds: ["architecture", "planning", "documentation"],
    supportFiles: [
      "skills/context-engineering/SKILL.md",
      "skills/incremental-implementation/SKILL.md",
      "skills/test-driven-development/SKILL.md",
    ],
    positiveTriggers: ["requirements specification", "significant change"],
    negativeTriggers: ["small bounded change with clear requirements"],
  }),
  "test-driven-development": policy({
    phase: "build",
    taskKinds: ["implementation", "refactor", "test", "debug"],
    supportFiles: ["references/testing-patterns.md"],
    positiveTriggers: ["behavior change", "bug fix"],
    negativeTriggers: ["documentation-only change"],
  }),
  "using-agent-skills": policy({
    phase: "meta",
    taskKinds: [...TASK_KINDS],
    roles: ["main"],
    supportFiles: ["references/definition-of-done.md"],
    positiveTriggers: ["lifecycle phase selection", "skill discovery"],
    negativeTriggers: ["non-development task"],
  }),
});

const APPROVED_SKILL_IDS = Object.freeze(Object.keys(APPROVED_SKILL_POLICIES).sort());
const SKILL_ENTRY_PATHS = Object.freeze(APPROVED_SKILL_IDS.map((id) => `skills/${id}/SKILL.md`));
const SUPPORT_PATHS = Object.freeze([
  ...new Set(Object.values(APPROVED_SKILL_POLICIES).flatMap((item) => item.supportFiles)),
].sort());
const EXPECTED_PAYLOAD_PATHS = Object.freeze([
  ...new Set(["THIRD_PARTY_LICENSE.md", ...SKILL_ENTRY_PATHS, ...SUPPORT_PATHS, ...REFERENCE_PATHS]),
].sort());
const EXPECTED_DIRECTORY_PATHS = Object.freeze([
  "references",
  "skills",
  ...APPROVED_SKILL_IDS.map((id) => `skills/${id}`),
].sort());

class ValidationFailure extends Error {
  constructor(errors) {
    super(`Loop workflow skills validation failed with ${errors.length} error(s).`);
    this.name = "ValidationFailure";
    this.errors = errors;
  }
}

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function compareAscii(left, right) {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

function decodeUtf8(buffer, label) {
  if (buffer.includes(0)) {
    throw new Error(`${label} contains a NUL byte.`);
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch (error) {
    throw new Error(`${label} is not valid UTF-8: ${error.message}`);
  }
}

function compactDescription(description) {
  const trimmed = description.trim();
  const sentenceMatch = /^(.+?[.!?])(?:\s|$)/u.exec(trimmed);
  const compact = (sentenceMatch ? sentenceMatch[1] : trimmed).trim();
  if (!compact || compact.length > 240) {
    throw new Error("Frontmatter description must yield one complete sentence of at most 240 JavaScript characters.");
  }
  return compact;
}

function parseYamlScalar(rawValue, label) {
  const value = rawValue.trim();
  if (!value) {
    throw new Error(`${label} must not be empty.`);
  }
  if (value.startsWith('"') || value.endsWith('"')) {
    if (!(value.startsWith('"') && value.endsWith('"'))) {
      throw new Error(`${label} has an unterminated double-quoted scalar.`);
    }
    try {
      const parsed = JSON.parse(value);
      if (typeof parsed !== "string" || !parsed.trim()) {
        throw new Error("must decode to a non-empty string");
      }
      return parsed;
    } catch (error) {
      throw new Error(`${label} has an invalid double-quoted scalar: ${error.message}`);
    }
  }
  if (value.startsWith("'") || value.endsWith("'")) {
    if (!(value.startsWith("'") && value.endsWith("'"))) {
      throw new Error(`${label} has an unterminated single-quoted scalar.`);
    }
    const parsed = value.slice(1, -1).replace(/''/g, "'");
    if (!parsed.trim()) {
      throw new Error(`${label} must decode to a non-empty string.`);
    }
    return parsed;
  }
  return value;
}

function parseSkillFrontmatter(text, label) {
  const withoutBom = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const normalized = withoutBom.replace(/\r\n/g, "\n");
  if (normalized.includes("\r")) {
    throw new Error(`${label} contains a bare carriage return.`);
  }
  if (!normalized.startsWith("---\n")) {
    throw new Error(`${label} must start with YAML frontmatter.`);
  }
  const closingIndex = normalized.indexOf("\n---\n", 4);
  if (closingIndex < 0) {
    throw new Error(`${label} has unterminated YAML frontmatter.`);
  }
  const lines = normalized.slice(4, closingIndex).split("\n");
  const fields = {};
  for (const line of lines) {
    const match = /^([A-Za-z][A-Za-z0-9_-]*):[ \t]*(.*)$/.exec(line);
    if (!match) {
      throw new Error(`${label} has an unsupported frontmatter line: ${line || "<empty>"}.`);
    }
    const key = match[1];
    if (Object.prototype.hasOwnProperty.call(fields, key)) {
      throw new Error(`${label} has duplicate frontmatter key ${key}.`);
    }
    fields[key] = parseYamlScalar(match[2], `${label} frontmatter.${key}`);
  }
  const keys = Object.keys(fields).sort();
  if (keys.length !== 2 || keys[0] !== "description" || keys[1] !== "name") {
    throw new Error(`${label} frontmatter must contain exactly name and description.`);
  }
  return Object.freeze({ name: fields.name, description: fields.description });
}

function buildThirdPartyLicense() {
  return `# Third-Party License

The Markdown resources in this directory are a controlled snapshot of the following upstream project:

- Source name: ${SOURCE_METADATA.name}
- Source URL: ${SOURCE_METADATA.url}
- Declared version: ${SOURCE_METADATA.version}
- License: ${SOURCE_METADATA.license}

The local import source was not a Git checkout, so an exact upstream commit could not be verified. The manifest records the declared version and a SHA-256 snapshot of every approved payload file instead of inventing commit provenance.

## MIT License

${UPSTREAM_LICENSE_TEXT}`;
}

function buildSnapshotSha256(files) {
  const canonical = [...files]
    .sort((left, right) => compareAscii(left.path, right.path))
    .map((file) => `${file.path}\t${file.bytes}\t${file.sha256}\n`)
    .join("");
  return sha256(Buffer.from(canonical, "utf8"));
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function arraysEqual(left, right) {
  return Array.isArray(left)
    && Array.isArray(right)
    && left.length === right.length
    && left.every((value, index) => value === right[index]);
}

function addError(errors, message) {
  errors.push(message);
}

function validateExactKeys(value, expectedKeys, label, errors) {
  if (!isRecord(value)) {
    addError(errors, `${label} must be an object.`);
    return false;
  }
  const actualKeys = Object.keys(value).sort(compareAscii);
  const sortedExpectedKeys = [...expectedKeys].sort(compareAscii);
  if (!arraysEqual(actualKeys, sortedExpectedKeys)) {
    addError(errors, `${label} must contain exactly: ${sortedExpectedKeys.join(", ")}.`);
    return false;
  }
  return true;
}

function validateRelativePosixPath(value, label, errors) {
  if (typeof value !== "string" || value.length === 0 || value !== value.trim()) {
    addError(errors, `${label} must be a non-empty trimmed string.`);
    return false;
  }
  if (value.includes("\\") || value.includes("\0")) {
    addError(errors, `${label} must use a relative POSIX path without backslashes or NUL.`);
    return false;
  }
  if (path.posix.isAbsolute(value) || path.win32.isAbsolute(value) || /^[A-Za-z]:/.test(value) || value.startsWith("//")) {
    addError(errors, `${label} must not be absolute, drive-qualified, or UNC-like.`);
    return false;
  }
  const segments = value.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === ".." || segment.startsWith("."))) {
    addError(errors, `${label} must not contain empty, dot, parent, or hidden path segments.`);
    return false;
  }
  if (path.posix.normalize(value) !== value) {
    addError(errors, `${label} must already be normalized.`);
    return false;
  }
  return true;
}

function isContained(rootPath, candidatePath) {
  return candidatePath === rootPath || candidatePath.startsWith(`${rootPath}${path.sep}`);
}

function collectPackTree(packRoot, errors) {
  const absoluteRoot = path.resolve(packRoot);
  let rootStat;
  try {
    rootStat = fs.lstatSync(absoluteRoot);
  } catch (error) {
    addError(errors, `Pack root is not readable: ${error.message}`);
    return null;
  }
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    addError(errors, "Pack root must be a real directory, not a symlink or special file.");
    return null;
  }

  let realRoot;
  try {
    realRoot = fs.realpathSync(absoluteRoot);
  } catch (error) {
    addError(errors, `Pack root realpath failed: ${error.message}`);
    return null;
  }

  const directories = new Set();
  const files = new Map();

  function walk(currentAbsolute, currentRelative) {
    let names;
    try {
      names = fs.readdirSync(currentAbsolute).sort(compareAscii);
    } catch (error) {
      addError(errors, `${currentRelative || "<root>"} cannot be listed: ${error.message}`);
      return;
    }

    for (const name of names) {
      const relativePath = currentRelative ? `${currentRelative}/${name}` : name;
      const absolutePath = path.join(currentAbsolute, name);
      if (name.startsWith(".")) {
        addError(errors, `${relativePath} is hidden and is not allowed in the snapshot.`);
      }

      let stat;
      try {
        stat = fs.lstatSync(absolutePath);
      } catch (error) {
        addError(errors, `${relativePath} cannot be inspected: ${error.message}`);
        continue;
      }
      if (stat.isSymbolicLink()) {
        addError(errors, `${relativePath} is a symbolic link; links are not allowed.`);
        continue;
      }

      let realPath;
      try {
        realPath = fs.realpathSync(absolutePath);
      } catch (error) {
        addError(errors, `${relativePath} realpath failed: ${error.message}`);
        continue;
      }
      if (!isContained(realRoot, realPath)) {
        addError(errors, `${relativePath} resolves outside the pack root.`);
        continue;
      }

      if (stat.isDirectory()) {
        directories.add(relativePath);
        walk(absolutePath, relativePath);
        continue;
      }
      if (!stat.isFile()) {
        addError(errors, `${relativePath} is not a regular file or directory.`);
        continue;
      }
      files.set(relativePath, Object.freeze({ absolutePath, realPath, stat }));
    }
  }

  walk(absoluteRoot, "");
  return Object.freeze({ absoluteRoot, realRoot, directories, files });
}

function validateStringArray(value, label, options, errors) {
  const { allowEmpty, allowedValues, slugValues, relativePaths, triggers } = options;
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) {
    addError(errors, `${label} must be ${allowEmpty ? "an" : "a non-empty"} array.`);
    return false;
  }
  const seen = new Set();
  let valid = true;
  for (let index = 0; index < value.length; index += 1) {
    const item = value[index];
    const itemLabel = `${label}[${index}]`;
    if (typeof item !== "string" || !item || item !== item.trim()) {
      addError(errors, `${itemLabel} must be a non-empty trimmed string.`);
      valid = false;
      continue;
    }
    if (seen.has(item)) {
      addError(errors, `${itemLabel} duplicates ${item}.`);
      valid = false;
    }
    seen.add(item);
    if (allowedValues && !allowedValues.includes(item)) {
      addError(errors, `${itemLabel} has unsupported value ${item}.`);
      valid = false;
    }
    if (slugValues && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(item)) {
      addError(errors, `${itemLabel} must be lowercase kebab-case.`);
      valid = false;
    }
    if (relativePaths && !validateRelativePosixPath(item, itemLabel, errors)) {
      valid = false;
    }
    if (triggers) {
      if (item.length > 160 || /[\r\n`;&|$<>]/.test(item) || /(?:^|\s)(?:\.{0,2}\/|~\/|[A-Za-z]:\\|\\\\)/.test(item)) {
        addError(errors, `${itemLabel} must be compact metadata, not a path or executable command.`);
        valid = false;
      }
    }
  }
  return valid;
}

function validateCanonicalEnumOrder(value, allowedValues, label, errors) {
  if (!Array.isArray(value)) {
    return;
  }
  const canonical = [...value].sort((left, right) => allowedValues.indexOf(left) - allowedValues.indexOf(right));
  if (!arraysEqual(value, canonical)) {
    addError(errors, `${label} must follow the canonical enum order.`);
  }
}

function validateManifestShape(manifest, rawManifest, errors) {
  if (!validateExactKeys(manifest, ["schemaVersion", "source", "files", "skills"], "manifest", errors)) {
    return Object.freeze({ fileEntries: new Map(), skillEntries: new Map() });
  }
  if (!Number.isSafeInteger(manifest.schemaVersion) || manifest.schemaVersion <= 0) {
    addError(errors, "manifest.schemaVersion must be a positive safe integer.");
  } else if (manifest.schemaVersion !== SCHEMA_VERSION) {
    addError(errors, `manifest.schemaVersion must be ${SCHEMA_VERSION}.`);
  }

  if (validateExactKeys(manifest.source, ["name", "url", "version", "license", "snapshotSha256"], "manifest.source", errors)) {
    for (const [key, expectedValue] of Object.entries(SOURCE_METADATA)) {
      if (manifest.source[key] !== expectedValue) {
        addError(errors, `manifest.source.${key} must equal ${expectedValue}.`);
      }
    }
    if (typeof manifest.source.snapshotSha256 !== "string" || !/^[a-f0-9]{64}$/.test(manifest.source.snapshotSha256)) {
      addError(errors, "manifest.source.snapshotSha256 must be a lowercase SHA-256 hex string.");
    }
  }

  const fileEntries = new Map();
  if (!Array.isArray(manifest.files)) {
    addError(errors, "manifest.files must be an array.");
  } else {
    let previousPath = null;
    manifest.files.forEach((file, index) => {
      const label = `manifest.files[${index}]`;
      if (!validateExactKeys(file, ["path", "bytes", "sha256"], label, errors)) {
        return;
      }
      const pathValid = validateRelativePosixPath(file.path, `${label}.path`, errors);
      if (pathValid) {
        if (fileEntries.has(file.path)) {
          addError(errors, `${label}.path duplicates ${file.path}.`);
        } else {
          fileEntries.set(file.path, file);
        }
        if (previousPath !== null && compareAscii(previousPath, file.path) >= 0) {
          addError(errors, "manifest.files must be strictly sorted by path.");
        }
        previousPath = file.path;
      }
      if (!Number.isSafeInteger(file.bytes) || file.bytes < 0 || file.bytes > MAX_FILE_BYTES) {
        addError(errors, `${label}.bytes must be a safe integer between 0 and ${MAX_FILE_BYTES}.`);
      }
      if (typeof file.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(file.sha256)) {
        addError(errors, `${label}.sha256 must be a lowercase SHA-256 hex string.`);
      }
    });
  }

  const skillEntries = new Map();
  if (!Array.isArray(manifest.skills)) {
    addError(errors, "manifest.skills must be an array.");
  } else {
    let previousId = null;
    manifest.skills.forEach((skill, index) => {
      const label = `manifest.skills[${index}]`;
      const expectedKeys = [
        "id",
        "name",
        "description",
        "path",
        "bytes",
        "sha256",
        "supportFiles",
        "developmentOnly",
        "phases",
        "taskKinds",
        "roles",
        "requiredCapabilities",
        "priority",
        "positiveTriggers",
        "negativeTriggers",
      ];
      if (!validateExactKeys(skill, expectedKeys, label, errors)) {
        return;
      }
      const idValid = typeof skill.id === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(skill.id);
      if (!idValid) {
        addError(errors, `${label}.id must be lowercase kebab-case.`);
      } else {
        if (skillEntries.has(skill.id)) {
          addError(errors, `${label}.id duplicates ${skill.id}.`);
        } else {
          skillEntries.set(skill.id, skill);
        }
        if (previousId !== null && compareAscii(previousId, skill.id) >= 0) {
          addError(errors, "manifest.skills must be strictly sorted by id.");
        }
        previousId = skill.id;
      }
      if (skill.name !== skill.id) {
        addError(errors, `${label}.name must equal its stable id.`);
      }
      if (typeof skill.description !== "string" || !skill.description || skill.description !== skill.description.trim() || skill.description.length > 240) {
        addError(errors, `${label}.description must be a trimmed non-empty string of at most 240 JavaScript characters.`);
      }
      if (!validateRelativePosixPath(skill.path, `${label}.path`, errors) || (idValid && skill.path !== `skills/${skill.id}/SKILL.md`)) {
        addError(errors, `${label}.path must point to skills/<id>/SKILL.md.`);
      }
      if (!Number.isSafeInteger(skill.bytes) || skill.bytes < 0 || skill.bytes > MAX_FILE_BYTES) {
        addError(errors, `${label}.bytes must be a safe integer between 0 and ${MAX_FILE_BYTES}.`);
      }
      if (typeof skill.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(skill.sha256)) {
        addError(errors, `${label}.sha256 must be a lowercase SHA-256 hex string.`);
      }
      validateStringArray(skill.supportFiles, `${label}.supportFiles`, { allowEmpty: true, relativePaths: true }, errors);
      if (Array.isArray(skill.supportFiles) && !arraysEqual(skill.supportFiles, [...skill.supportFiles].sort(compareAscii))) {
        addError(errors, `${label}.supportFiles must be sorted by path.`);
      }
      if (skill.developmentOnly !== true) {
        addError(errors, `${label}.developmentOnly must be true.`);
      }
      validateStringArray(skill.phases, `${label}.phases`, { allowEmpty: false, allowedValues: PHASES }, errors);
      validateCanonicalEnumOrder(skill.phases, PHASES, `${label}.phases`, errors);
      validateStringArray(skill.taskKinds, `${label}.taskKinds`, { allowEmpty: false, allowedValues: TASK_KINDS }, errors);
      validateCanonicalEnumOrder(skill.taskKinds, TASK_KINDS, `${label}.taskKinds`, errors);
      validateStringArray(skill.roles, `${label}.roles`, { allowEmpty: false, allowedValues: ROLES }, errors);
      validateCanonicalEnumOrder(skill.roles, ROLES, `${label}.roles`, errors);
      validateStringArray(skill.requiredCapabilities, `${label}.requiredCapabilities`, { allowEmpty: true, slugValues: true }, errors);
      if (!Number.isSafeInteger(skill.priority) || skill.priority < 0) {
        addError(errors, `${label}.priority must be a non-negative safe integer.`);
      }
      validateStringArray(skill.positiveTriggers, `${label}.positiveTriggers`, { allowEmpty: false, triggers: true }, errors);
      validateStringArray(skill.negativeTriggers, `${label}.negativeTriggers`, { allowEmpty: false, triggers: true }, errors);
    });
  }

  const canonicalManifest = `${JSON.stringify(manifest, null, 2)}\n`;
  if (rawManifest !== canonicalManifest) {
    addError(errors, "manifest.json must use canonical two-space JSON formatting with one trailing newline and no duplicate keys.");
  }

  return Object.freeze({ fileEntries, skillEntries });
}

function validateExpectedSet(actualValues, expectedValues, label, errors) {
  const actual = [...actualValues].sort(compareAscii);
  const expected = [...expectedValues].sort(compareAscii);
  if (!arraysEqual(actual, expected)) {
    const missing = expected.filter((value) => !actual.includes(value));
    const unexpected = actual.filter((value) => !expected.includes(value));
    if (missing.length > 0) {
      addError(errors, `${label} is missing: ${missing.join(", ")}.`);
    }
    if (unexpected.length > 0) {
      addError(errors, `${label} has unexpected entries: ${unexpected.join(", ")}.`);
    }
  }
}

function validatePolicyMetadata(skill, policyValue, label, errors) {
  const fields = [
    "supportFiles",
    "phases",
    "taskKinds",
    "roles",
    "requiredCapabilities",
    "positiveTriggers",
    "negativeTriggers",
  ];
  for (const field of fields) {
    if (!arraysEqual(skill[field], policyValue[field])) {
      addError(errors, `${label}.${field} does not match the approved policy metadata.`);
    }
  }
  if (skill.priority !== policyValue.priority) {
    addError(errors, `${label}.priority does not match the approved phase-derived priority.`);
  }
}

function validatePack(packRoot = PACK_ROOT) {
  const errors = [];
  const tree = collectPackTree(packRoot, errors);
  if (!tree) {
    throw new ValidationFailure(errors);
  }

  validateExpectedSet(tree.directories, EXPECTED_DIRECTORY_PATHS, "Snapshot directories", errors);
  validateExpectedSet(tree.files.keys(), ["manifest.json", ...EXPECTED_PAYLOAD_PATHS], "Snapshot files", errors);

  let snapshotBytes = 0;
  for (const [relativePath, entry] of tree.files) {
    snapshotBytes += entry.stat.size;
    if (entry.stat.size > MAX_FILE_BYTES) {
      addError(errors, `${relativePath} exceeds the ${MAX_FILE_BYTES}-byte single-file limit.`);
    }
  }
  if (snapshotBytes > MAX_SNAPSHOT_BYTES) {
    addError(errors, `Snapshot size ${snapshotBytes} exceeds the ${MAX_SNAPSHOT_BYTES}-byte limit.`);
  }

  const manifestEntry = tree.files.get("manifest.json");
  let manifest = null;
  let rawManifest = "";
  if (manifestEntry) {
    try {
      rawManifest = decodeUtf8(fs.readFileSync(manifestEntry.absolutePath), "manifest.json");
      manifest = JSON.parse(rawManifest);
    } catch (error) {
      addError(errors, `manifest.json is invalid: ${error.message}`);
    }
  }

  let fileEntries = new Map();
  let skillEntries = new Map();
  if (manifest) {
    ({ fileEntries, skillEntries } = validateManifestShape(manifest, rawManifest, errors));
    validateExpectedSet(fileEntries.keys(), EXPECTED_PAYLOAD_PATHS, "manifest.files", errors);
    validateExpectedSet(skillEntries.keys(), APPROVED_SKILL_IDS, "manifest.skills", errors);
  }

  let payloadBytes = 0;
  const decodedPayload = new Map();
  for (const relativePath of EXPECTED_PAYLOAD_PATHS) {
    const treeEntry = tree.files.get(relativePath);
    if (!treeEntry) {
      continue;
    }
    let buffer;
    try {
      buffer = fs.readFileSync(treeEntry.absolutePath);
    } catch (error) {
      addError(errors, `${relativePath} cannot be read: ${error.message}`);
      continue;
    }
    payloadBytes += buffer.length;
    try {
      decodedPayload.set(relativePath, decodeUtf8(buffer, relativePath));
    } catch (error) {
      addError(errors, error.message);
    }
    const fileRecord = fileEntries.get(relativePath);
    if (fileRecord) {
      if (fileRecord.bytes !== buffer.length) {
        addError(errors, `${relativePath} bytes mismatch: manifest=${fileRecord.bytes}, actual=${buffer.length}.`);
      }
      const actualSha256 = sha256(buffer);
      if (fileRecord.sha256 !== actualSha256) {
        addError(errors, `${relativePath} SHA-256 mismatch.`);
      }
    }
  }

  const licenseText = decodedPayload.get("THIRD_PARTY_LICENSE.md");
  if (licenseText !== undefined && licenseText !== buildThirdPartyLicense()) {
    addError(errors, "THIRD_PARTY_LICENSE.md must preserve the approved source, unverifiable-commit note, Addy Osmani copyright, and full MIT license text.");
  }

  for (const id of APPROVED_SKILL_IDS) {
    const relativePath = `skills/${id}/SKILL.md`;
    const skill = skillEntries.get(id);
    const policyValue = APPROVED_SKILL_POLICIES[id];
    if (!skill) {
      continue;
    }
    validatePolicyMetadata(skill, policyValue, `manifest.skills[${id}]`, errors);
    for (const supportPath of policyValue.supportFiles) {
      if (!fileEntries.has(supportPath)) {
        addError(errors, `${id} support file ${supportPath} is not indexed in manifest.files.`);
      }
    }

    const entryFileRecord = fileEntries.get(relativePath);
    if (entryFileRecord) {
      if (skill.bytes !== entryFileRecord.bytes) {
        addError(errors, `${id} bytes must match its manifest.files entry.`);
      }
      if (skill.sha256 !== entryFileRecord.sha256) {
        addError(errors, `${id} SHA-256 must match its manifest.files entry.`);
      }
    }

    const text = decodedPayload.get(relativePath);
    if (text === undefined) {
      continue;
    }
    try {
      const frontmatter = parseSkillFrontmatter(text, relativePath);
      if (frontmatter.name !== id) {
        addError(errors, `${relativePath} frontmatter.name must equal ${id}.`);
      }
      const expectedDescription = compactDescription(frontmatter.description);
      if (skill.description !== expectedDescription) {
        addError(errors, `${id} description must equal the first complete frontmatter sentence.`);
      }
    } catch (error) {
      addError(errors, error.message);
    }
  }

  if (manifest && fileEntries.size === EXPECTED_PAYLOAD_PATHS.length) {
    const calculatedSnapshotSha256 = buildSnapshotSha256([...fileEntries.values()]);
    if (manifest.source && manifest.source.snapshotSha256 !== calculatedSnapshotSha256) {
      addError(errors, `manifest.source.snapshotSha256 mismatch: expected ${calculatedSnapshotSha256}.`);
    }
  }

  if (errors.length > 0) {
    throw new ValidationFailure(errors);
  }

  return Object.freeze({
    skillCount: APPROVED_SKILL_IDS.length,
    skillMarkdownCount: SKILL_ENTRY_PATHS.length + SUPPORT_PATHS.filter((item) => item.startsWith("skills/") && !item.endsWith("/SKILL.md")).length,
    referenceCount: REFERENCE_PATHS.length,
    payloadFileCount: EXPECTED_PAYLOAD_PATHS.length,
    payloadBytes,
    snapshotBytes,
    snapshotSha256: manifest.source.snapshotSha256,
  });
}

function main() {
  if (process.argv.length > 2) {
    console.error("Usage: node scripts/validate_loop_workflow_skills.js");
    process.exit(1);
  }
  try {
    const summary = validatePack(PACK_ROOT);
    console.log(
      `Loop workflow skills validation passed (${summary.skillCount} skills, ${summary.skillMarkdownCount} skill Markdown files, ${summary.referenceCount} references, ${summary.payloadFileCount} payload files, ${summary.payloadBytes} payload bytes, snapshot ${summary.snapshotSha256}).`
    );
  } catch (error) {
    if (error instanceof ValidationFailure) {
      console.error("Loop workflow skills validation failed:");
      for (const message of error.errors) {
        console.error(`- ${message}`);
      }
    } else {
      console.error(`Loop workflow skills validation failed: ${error.message}`);
    }
    process.exit(1);
  }
}

module.exports = {
  APPROVED_SKILL_IDS,
  APPROVED_SKILL_POLICIES,
  EXPECTED_DIRECTORY_PATHS,
  EXPECTED_PAYLOAD_PATHS,
  MAX_FILE_BYTES,
  MAX_SNAPSHOT_BYTES,
  PACK_ROOT,
  REFERENCE_PATHS,
  SCHEMA_VERSION,
  SOURCE_METADATA,
  TASK_KINDS,
  PHASES,
  ROLES,
  UPSTREAM_LICENSE_TEXT,
  ValidationFailure,
  buildSnapshotSha256,
  buildThirdPartyLicense,
  compareAscii,
  compactDescription,
  decodeUtf8,
  parseSkillFrontmatter,
  sha256,
  validatePack,
};

if (require.main === module) {
  main();
}
