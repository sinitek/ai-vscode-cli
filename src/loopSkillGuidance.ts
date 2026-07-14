import { createHash } from "crypto";
import * as fs from "fs/promises";
import * as path from "path";
import { TextDecoder } from "util";

export const LOOP_SKILL_MANIFEST_SCHEMA_VERSION = 1;
export const LOOP_SKILL_PACK_RELATIVE_PATH = "media/loop-workflow-skills";
export const LOOP_SKILL_MAX_FILE_BYTES = 64 * 1024;
export const LOOP_SKILL_MAX_PACK_BYTES = 1024 * 1024;
export const LOOP_SKILL_MAX_MANIFEST_BYTES = 1024 * 1024;
export const LOOP_SKILL_MAX_DESCRIPTION_CHARS = 240;
export const LOOP_SKILL_MAX_CATALOG_ITEMS = 32;
export const LOOP_SKILL_MAX_CATALOG_CHARS = 12_000;
export const LOOP_SKILL_MAX_SELECTED_IDS = 3;
export const LOOP_SKILL_MAX_GUIDANCE_FILE_CHARS = 24_000;
export const LOOP_SKILL_MAX_GUIDANCE_CHARS = 32_000;
export const LOOP_SKILL_GUIDANCE_DELIMITER_PREFIX = "<<<SINITEK_LOOP_SKILL_GUIDANCE";

export const LOOP_SKILL_PHASES = [
  "meta",
  "define",
  "plan",
  "build",
  "verify",
  "review",
  "ship",
] as const;

export type LoopSkillPhase = (typeof LOOP_SKILL_PHASES)[number];

export const LOOP_SKILL_TASK_KINDS = [
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
] as const;

export type LoopSkillTaskKind = (typeof LOOP_SKILL_TASK_KINDS)[number];
export type LoopSkillRole = "main" | "subtask";
export type LoopTaskClassification = "development" | "non_development" | "unknown";

export type LoopRootTaskInput = {
  displayPrompt?: unknown;
  contextTags?: unknown;
  workspacePaths?: unknown;
};

export type LoopSubtaskSkillInput = {
  title?: unknown;
  prompt?: unknown;
  writeFiles?: unknown;
  conflictGroup?: unknown;
};

export type LoopSubtaskClassification = {
  classification: LoopTaskClassification;
  phases: LoopSkillPhase[];
  taskKinds: LoopSkillTaskKind[];
};

export type LoopSkillManifestFile = {
  path: string;
  bytes: number;
  sha256: string;
};

export type LoopSkillMetadata = {
  id: string;
  name: string;
  description: string;
  path: string;
  bytes: number;
  sha256: string;
  supportFiles: string[];
  developmentOnly: true;
  phases: LoopSkillPhase[];
  taskKinds: LoopSkillTaskKind[];
  roles: LoopSkillRole[];
  requiredCapabilities: string[];
  priority: number;
  positiveTriggers: string[];
  negativeTriggers: string[];
};

export type LoopSkillManifest = {
  schemaVersion: number;
  source: {
    name: string;
    url: string;
    version: string;
    license: string;
    snapshotSha256: string;
  };
  files: LoopSkillManifestFile[];
  skills: LoopSkillMetadata[];
};

export type LoopLoadedSkill = LoopSkillMetadata & {
  guidance: string;
};

export type LoopSkillPack = {
  root: string;
  manifest: LoopSkillManifest;
  skills: LoopLoadedSkill[];
};

export type LoopSkillDiagnosticCode =
  | "invalid_extension_root"
  | "pack_unavailable"
  | "unsupported_schema"
  | "invalid_manifest"
  | "snapshot_hash_mismatch"
  | "resource_missing"
  | "resource_symlink"
  | "resource_outside_root"
  | "resource_not_file"
  | "resource_too_large"
  | "resource_bytes_mismatch"
  | "resource_hash_mismatch"
  | "resource_invalid_utf8"
  | "resource_nul"
  | "invalid_frontmatter"
  | "guidance_delimiter_conflict"
  | "catalog_item_limit_exceeded"
  | "catalog_budget_exceeded"
  | "invalid_skill_ids"
  | "invalid_skill_id"
  | "unknown_skill_id"
  | "skill_not_allowed"
  | "skill_phase_mismatch"
  | "skill_task_kind_mismatch"
  | "skill_role_mismatch"
  | "skill_capability_missing"
  | "skill_negative_trigger"
  | "skill_selection_limit_exceeded"
  | "skill_guidance_too_large"
  | "guidance_budget_exceeded";

export type LoopSkillDiagnostic = {
  code: LoopSkillDiagnosticCode;
  message: string;
  resourcePath?: string;
  skillId?: string;
};

export type LoopSkillPackLoadResult = {
  pack: LoopSkillPack | null;
  diagnostics: LoopSkillDiagnostic[];
};

export type LoopSkillCatalogResult = {
  section?: string;
  candidateIds: string[];
  diagnostics: LoopSkillDiagnostic[];
};

export type LoopSkillGuidanceInput = {
  rootTaskKind: LoopTaskClassification;
  requestedSkillIds?: unknown;
  allowedSkillIds?: unknown;
  subtask: LoopSubtaskSkillInput;
  role?: LoopSkillRole;
  availableCapabilities?: unknown;
};

export type LoopSkillGuidanceResult = {
  skillIds: string[];
  skillGuidance?: string;
  diagnostics: LoopSkillDiagnostic[];
};

class LoopSkillPackError extends Error {
  constructor(
    readonly code: LoopSkillDiagnosticCode,
    message: string,
    readonly resourcePath?: string,
  ) {
    super(message);
    this.name = "LoopSkillPackError";
  }
}

const UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const SKILL_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MANIFEST_TOP_LEVEL_KEYS = ["schemaVersion", "source", "files", "skills"];
const MANIFEST_SOURCE_KEYS = ["name", "url", "version", "license", "snapshotSha256"];
const MANIFEST_FILE_KEYS = ["path", "bytes", "sha256"];
const MANIFEST_SKILL_KEYS = [
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

const ROOT_DEVELOPMENT_PATTERNS = [
  /(?:实现|编码|开发|重构|修复|调试|排查|报错|堆栈|测试|单测|集成测试|构建|编译|架构|接口|迁移|漏洞|安全审计|不可信输入|信任边界|性能优化|代码审查|发布)/iu,
  /\b(?:implement|coding|develop|refactor|fix|debug|stack trace|test|build|compile|lint|architecture|api|migration|security|untrusted input|trust boundary|performance|code review|release|deploy)\b/iu,
];
const NON_DEVELOPMENT_PATTERNS = [
  /(?:翻译|摘要|概括|总结|(?:整理|归纳|汇总)(?:一下)?(?:这些?|相关)?(?:资料|信息|笔记|内容|材料|文档)|(?:资料|信息|笔记|内容|材料)(?:整理|归纳|汇总)|普通问答|回答问题|解释|讲解|产品文案|广告文案|写作|写一篇|撰写(?:文章|邮件|博客|文案|周报)|润色|改写|旅行|旅游|购物|比价|天气|闲聊|写故事|写诗)/iu,
  /\b(?:translate|summari[sz]e|organize|organise|explain|what is|what does|q\s*(?:&|and)\s*a|answer (?:this|the) question|copywriting|draft (?:an? |the )?(?:customer )?(?:email|article|blog post|memo|copy)|write (?:an? |the )?(?:article|email|blog post|summary|story|poem)|rewrite|polish|travel|trip|shopping|compare prices|weather|small talk)\b/iu,
];
const META_PHASE_PATTERN = /(?:skill|agent|prompt|orchestrat|编排|智能体|提示词|能力目录)/iu;
const TECHNICAL_PATH_PATTERN = /(?:^|[\s:'"`])(?:src|test|tests|scripts|media|\.ch|docs)[/\\][^\s:'"`]+|(?:^|[\s:'"`])(?:package\.json|tsconfig\.json|AGENTS\.md|ARCHITECTURE\.md|README\.md)|\.(?:ts|tsx|js|jsx|mjs|cjs|py|java|kt|go|rs|cs|cpp|c|h|sql|css|scss|html|vue|svelte|json|ya?ml)(?:$|[\s:'"`)])/iu;

const SUBTASK_KIND_RULES: Array<{
  kind: LoopSkillTaskKind;
  pattern: RegExp;
}> = [
  { kind: "architecture", pattern: /(?:架构|模块边界|依赖方向|architecture|\badr\b)/iu },
  { kind: "planning", pattern: /(?:计划|规划|任务拆分|实施方案|roadmap|task breakdown|\bplan(?:ning)?\b)/iu },
  { kind: "api", pattern: /(?:接口|endpoint|graphql|\bapi\b|\brest\b)/iu },
  { kind: "ui", pattern: /(?:前端|界面|webview|\bui\b|\bcss\b|\bhtml\b|react|vue|svelte)/iu },
  { kind: "implementation", pattern: /(?:实现|编码|开发|新增|功能|implement|coding|develop|feature)/iu },
  { kind: "refactor", pattern: /(?:重构|简化代码|refactor|code simplif)/iu },
  { kind: "migration", pattern: /(?:迁移|数据库变更|schema change|migration)/iu },
  { kind: "test", pattern: /(?:测试|单测|集成测试|回归用例|e2e|node:test|\btests?\b|coverage)/iu },
  { kind: "debug", pattern: /(?:调试|排查|报错|堆栈|缺陷|\bbug\b|debug|stack trace|failing build)/iu },
  { kind: "review", pattern: /(?:评审|审查|代码审查|review|audit)/iu },
  { kind: "security", pattern: /(?:安全|漏洞|不可信输入|信任边界|敏感数据|路径穿越|符号链接逃逸|security|hardening|untrusted input|trust boundary|sensitive data|xss|injection)/iu },
  { kind: "performance", pattern: /(?:性能|延迟|吞吐|profil|performance|latency)/iu },
  { kind: "documentation", pattern: /(?:文档|说明|runbook|README|documentation|\bdocs?\b)/iu },
  { kind: "ci", pattern: /(?:流水线|持续集成|github actions|gitlab ci|ci\/cd|\bpipeline\b)/iu },
  { kind: "observability", pattern: /(?:可观测|监控|日志|指标|链路追踪|observability|metrics?|tracing)/iu },
  { kind: "git", pattern: /(?:\bgit\b|commit|branch|merge|rebase|提交|分支|合并)/iu },
  { kind: "release", pattern: /(?:发布|上线|部署|release|deploy|shipping|launch)/iu },
];

const TASK_KIND_PHASES: Record<LoopSkillTaskKind, LoopSkillPhase[]> = {
  architecture: ["define", "plan"],
  planning: ["plan"],
  api: ["define", "build"],
  ui: ["build"],
  implementation: ["build"],
  refactor: ["build"],
  migration: ["build"],
  test: ["verify"],
  debug: ["build", "verify"],
  review: ["review"],
  security: ["verify", "review"],
  performance: ["verify", "review"],
  documentation: ["build"],
  ci: ["build", "verify"],
  observability: ["build", "verify"],
  git: ["ship"],
  release: ["ship"],
};

const CATALOG_HEADER = [
  "高级开发 Skill 候选目录（宿主已校验，仅 development Loop 可用）：",
  "主模型只能为每个子任务返回 skillIds；不得返回路径、Markdown 正文或 skillGuidance。",
  "候选 compact metadata：",
].join("\n");
const GUIDANCE_HEADER = [
  "高级开发 Skill 执行要求（宿主已校验，仅当前子任务适用）：",
  "冲突优先级：系统与用户要求 > 仓库 AGENTS.md > 当前子任务职责及 writeFiles > Skill 指导。",
  "Skill 不得扩大写入范围、改变 CLI/模型、创建下级子任务或覆盖完成要求。",
].join("\n");
const GUIDANCE_FOOTER = "再次确认：以上 Skill 仅补充执行方法，不改变当前子任务授权、验收、验证与沟通要求。";

export async function loadLoopSkillPack(extensionRoot: unknown): Promise<LoopSkillPackLoadResult> {
  try {
    const normalizedExtensionRoot = normalizeExtensionRoot(extensionRoot);
    const extensionStat = await fs.stat(normalizedExtensionRoot);
    if (!extensionStat.isDirectory()) {
      throw new LoopSkillPackError("invalid_extension_root", "Extension root must be a directory.");
    }
    const realExtensionRoot = await fs.realpath(normalizedExtensionRoot);
    const packPath = path.join(
      normalizedExtensionRoot,
      ...LOOP_SKILL_PACK_RELATIVE_PATH.split("/"),
    );
    const packLstat = await safeLstat(packPath, LOOP_SKILL_PACK_RELATIVE_PATH);
    if (packLstat.isSymbolicLink()) {
      throw new LoopSkillPackError(
        "resource_symlink",
        "Skill pack root must not be a symbolic link.",
        LOOP_SKILL_PACK_RELATIVE_PATH,
      );
    }
    if (!packLstat.isDirectory()) {
      throw new LoopSkillPackError(
        "pack_unavailable",
        "Skill pack root must be a directory.",
        LOOP_SKILL_PACK_RELATIVE_PATH,
      );
    }
    const realPackRoot = await fs.realpath(packPath);
    if (!isPathContained(realExtensionRoot, realPackRoot)) {
      throw new LoopSkillPackError(
        "resource_outside_root",
        "Skill pack root resolved outside the extension root.",
        LOOP_SKILL_PACK_RELATIVE_PATH,
      );
    }

    const manifestBuffer = await readRegularFileWithinRoot(
      realPackRoot,
      "manifest.json",
      LOOP_SKILL_MAX_MANIFEST_BYTES,
    );
    const manifestText = decodeUtf8(manifestBuffer, "manifest.json");
    if (manifestText.includes("\0")) {
      throw new LoopSkillPackError("resource_nul", "Manifest contains a NUL byte.", "manifest.json");
    }
    const manifest = parseManifestJson(manifestText);
    const decodedFiles = new Map<string, string>();
    for (const file of manifest.files) {
      const content = await readRegularFileWithinRoot(realPackRoot, file.path, LOOP_SKILL_MAX_FILE_BYTES);
      if (content.byteLength !== file.bytes) {
        throw new LoopSkillPackError(
          "resource_bytes_mismatch",
          "Skill resource byte length does not match the manifest.",
          file.path,
        );
      }
      if (sha256(content) !== file.sha256) {
        throw new LoopSkillPackError(
          "resource_hash_mismatch",
          "Skill resource hash does not match the manifest.",
          file.path,
        );
      }
      const decoded = decodeUtf8(content, file.path);
      if (decoded.includes("\0")) {
        throw new LoopSkillPackError("resource_nul", "Skill resource contains a NUL byte.", file.path);
      }
      decodedFiles.set(file.path, decoded);
    }

    const skills = manifest.skills
      .map((metadata): LoopLoadedSkill => {
        const markdown = decodedFiles.get(metadata.path);
        if (markdown === undefined) {
          throw new LoopSkillPackError(
            "resource_missing",
            "Skill entry Markdown is missing.",
            metadata.path,
          );
        }
        return {
          ...metadata,
          guidance: cleanSkillMarkdown(markdown, metadata.path),
        };
      })
      .sort(compareSkills);

    return {
      pack: {
        root: realPackRoot,
        manifest,
        skills,
      },
      diagnostics: [],
    };
  } catch (error) {
    const diagnostic = toDiagnostic(error);
    return { pack: null, diagnostics: [diagnostic] };
  }
}

export function classifyLoopRootTask(input: LoopRootTaskInput): LoopTaskClassification {
  const prompt = normalizeUnknownText(input?.displayPrompt);
  const trustedContext = [
    ...normalizeUnknownStringArray(input?.contextTags),
    ...normalizeUnknownStringArray(input?.workspacePaths),
  ].join("\n");
  const hasDevelopmentIntent = matchesAny(prompt, ROOT_DEVELOPMENT_PATTERNS);
  const hasNonDevelopmentIntent = matchesAny(prompt, NON_DEVELOPMENT_PATTERNS);
  if (hasDevelopmentIntent && hasNonDevelopmentIntent) {
    return "unknown";
  }
  if (hasNonDevelopmentIntent) {
    return "non_development";
  }
  if (hasDevelopmentIntent || TECHNICAL_PATH_PATTERN.test(trustedContext)) {
    return "development";
  }
  return "unknown";
}

export function classifyLoopSubtask(input: LoopSubtaskSkillInput): LoopSubtaskClassification {
  const primaryText = [normalizeUnknownText(input?.title), normalizeUnknownText(input?.prompt)]
    .filter(Boolean)
    .join("\n");
  const writeFiles = normalizeUnknownStringArray(input?.writeFiles);
  const allText = [
    primaryText,
    normalizeUnknownText(input?.conflictGroup),
    ...writeFiles,
  ].filter(Boolean).join("\n");
  const hasDevelopmentIntent = matchesAny(primaryText, ROOT_DEVELOPMENT_PATTERNS);
  const hasNonDevelopmentIntent = matchesAny(primaryText, NON_DEVELOPMENT_PATTERNS);
  if (hasDevelopmentIntent && hasNonDevelopmentIntent) {
    return { classification: "unknown", phases: [], taskKinds: [] };
  }
  if (hasNonDevelopmentIntent) {
    return { classification: "non_development", phases: [], taskKinds: [] };
  }

  const taskKinds = new Set<LoopSkillTaskKind>();
  for (const rule of SUBTASK_KIND_RULES) {
    if (rule.pattern.test(allText)) {
      taskKinds.add(rule.kind);
    }
  }
  addTaskKindsFromWriteFiles(taskKinds, writeFiles);
  if (taskKinds.size === 0 && (hasDevelopmentIntent || TECHNICAL_PATH_PATTERN.test(allText))) {
    taskKinds.add("implementation");
  }
  if (taskKinds.size === 0) {
    return { classification: "unknown", phases: [], taskKinds: [] };
  }

  const phases = new Set<LoopSkillPhase>();
  for (const taskKind of taskKinds) {
    for (const phase of TASK_KIND_PHASES[taskKind]) {
      phases.add(phase);
    }
  }
  if (META_PHASE_PATTERN.test(allText)) {
    phases.add("meta");
  }
  return {
    classification: "development",
    phases: LOOP_SKILL_PHASES.filter((phase) => phases.has(phase)),
    taskKinds: LOOP_SKILL_TASK_KINDS.filter((taskKind) => taskKinds.has(taskKind)),
  };
}

export function buildLoopSkillCatalog(
  pack: LoopSkillPack | null,
  rootTaskKind: LoopTaskClassification,
): LoopSkillCatalogResult {
  if (!pack || rootTaskKind !== "development") {
    return { section: undefined, candidateIds: [], diagnostics: [] };
  }
  const diagnostics: LoopSkillDiagnostic[] = [];
  const lines: string[] = [];
  const candidateIds: string[] = [];
  const sortedSkills = [...pack.skills].sort(compareSkills);
  for (const skill of sortedSkills) {
    if (candidateIds.length >= LOOP_SKILL_MAX_CATALOG_ITEMS) {
      diagnostics.push({
        code: "catalog_item_limit_exceeded",
        message: "Additional Skill catalog entries were skipped by the item limit.",
      });
      break;
    }
    const line = `- ${JSON.stringify(toCompactMetadata(skill))}`;
    const nextSection = [CATALOG_HEADER, ...lines, line].join("\n");
    if (nextSection.length > LOOP_SKILL_MAX_CATALOG_CHARS) {
      diagnostics.push({
        code: "catalog_budget_exceeded",
        message: "This Skill and all later catalog entries were skipped by the catalog budget.",
        skillId: skill.id,
      });
      break;
    }
    lines.push(line);
    candidateIds.push(skill.id);
  }
  return {
    section: lines.length > 0 ? [CATALOG_HEADER, ...lines].join("\n") : undefined,
    candidateIds,
    diagnostics,
  };
}

export function buildLoopSkillGuidance(
  pack: LoopSkillPack | null,
  input: LoopSkillGuidanceInput,
): LoopSkillGuidanceResult {
  if (!pack || input.rootTaskKind !== "development") {
    return { skillIds: [], skillGuidance: undefined, diagnostics: [] };
  }
  const subtaskClassification = classifyLoopSubtask(input.subtask);
  if (subtaskClassification.classification !== "development") {
    return { skillIds: [], skillGuidance: undefined, diagnostics: [] };
  }

  const diagnostics: LoopSkillDiagnostic[] = [];
  const requestedIds = normalizeSelectedSkillIds(input.requestedSkillIds, diagnostics);
  if (requestedIds.length === 0) {
    return { skillIds: [], skillGuidance: undefined, diagnostics };
  }
  const allowedIds = new Set(normalizeAllowlistedSkillIds(input.allowedSkillIds));
  const availableCapabilities = new Set(normalizeUnknownStringArray(input.availableCapabilities));
  const role = input.role === "main" ? "main" : "subtask";
  const skillById = new Map(pack.skills.map((skill) => [skill.id, skill]));
  const triggerText = buildSubtaskEvidenceText(input.subtask).toLowerCase();
  const eligibleSkills: LoopLoadedSkill[] = [];

  for (const id of requestedIds) {
    const skill = skillById.get(id);
    if (!skill) {
      diagnostics.push({
        code: "unknown_skill_id",
        message: "The requested Skill ID is not present in the loaded pack.",
        skillId: id,
      });
      continue;
    }
    if (!allowedIds.has(id)) {
      diagnostics.push({
        code: "skill_not_allowed",
        message: "The requested Skill ID was not in the catalog allowlist.",
        skillId: id,
      });
      continue;
    }
    if (!skill.phases.some((phase) => subtaskClassification.phases.includes(phase))) {
      diagnostics.push({
        code: "skill_phase_mismatch",
        message: "The requested Skill does not support the inferred subtask phase.",
        skillId: id,
      });
      continue;
    }
    if (!skill.taskKinds.some((taskKind) => subtaskClassification.taskKinds.includes(taskKind))) {
      diagnostics.push({
        code: "skill_task_kind_mismatch",
        message: "The requested Skill does not support the inferred subtask kind.",
        skillId: id,
      });
      continue;
    }
    if (!skill.roles.includes(role)) {
      diagnostics.push({
        code: "skill_role_mismatch",
        message: "The requested Skill does not support the current agent role.",
        skillId: id,
      });
      continue;
    }
    const missingCapability = skill.requiredCapabilities.find(
      (capability) => !availableCapabilities.has(capability),
    );
    if (missingCapability) {
      diagnostics.push({
        code: "skill_capability_missing",
        message: "The requested Skill requires a capability the host did not declare.",
        skillId: id,
      });
      continue;
    }
    if (skill.negativeTriggers.some((trigger) => triggerText.includes(trigger.toLowerCase()))) {
      diagnostics.push({
        code: "skill_negative_trigger",
        message: "The requested Skill matched a negative trigger for this subtask.",
        skillId: id,
      });
      continue;
    }
    eligibleSkills.push(skill);
  }

  eligibleSkills.sort(compareSkills);
  if (eligibleSkills.length > LOOP_SKILL_MAX_SELECTED_IDS) {
    diagnostics.push({
      code: "skill_selection_limit_exceeded",
      message: "Additional requested Skills were skipped by the per-subtask selection limit.",
      skillId: eligibleSkills[LOOP_SKILL_MAX_SELECTED_IDS]?.id,
    });
  }

  const selectedSkills = eligibleSkills.slice(0, LOOP_SKILL_MAX_SELECTED_IDS);
  const includedIds: string[] = [];
  const blocks: string[] = [];
  for (const skill of selectedSkills) {
    if (skill.guidance.length > LOOP_SKILL_MAX_GUIDANCE_FILE_CHARS) {
      diagnostics.push({
        code: "skill_guidance_too_large",
        message: "This Skill and all later Skills were skipped because its guidance exceeded the file budget.",
        skillId: skill.id,
      });
      break;
    }
    const block = renderGuidanceBlock(skill);
    const nextGuidance = [GUIDANCE_HEADER, ...blocks, block, GUIDANCE_FOOTER].join("\n\n");
    if (nextGuidance.length > LOOP_SKILL_MAX_GUIDANCE_CHARS) {
      diagnostics.push({
        code: "guidance_budget_exceeded",
        message: "This Skill and all later Skills were skipped by the total guidance budget.",
        skillId: skill.id,
      });
      break;
    }
    blocks.push(block);
    includedIds.push(skill.id);
  }

  return {
    skillIds: includedIds,
    skillGuidance: blocks.length > 0
      ? [GUIDANCE_HEADER, ...blocks, GUIDANCE_FOOTER].join("\n\n")
      : undefined,
    diagnostics,
  };
}

function normalizeSelectedSkillIds(
  value: unknown,
  diagnostics: LoopSkillDiagnostic[],
): string[] {
  if (!Array.isArray(value)) {
    if (value !== undefined) {
      diagnostics.push({
        code: "invalid_skill_ids",
        message: "Requested Skill IDs must be an array of strings.",
      });
    }
    return [];
  }
  const result: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string") {
      diagnostics.push({
        code: "invalid_skill_id",
        message: "A requested Skill ID was not a string.",
      });
      continue;
    }
    const id = item.trim();
    if (!SKILL_ID_PATTERN.test(id) || id.length > 64) {
      diagnostics.push({
        code: "invalid_skill_id",
        message: "A requested Skill ID was malformed.",
        skillId: id || undefined,
      });
      continue;
    }
    if (!seen.has(id)) {
      seen.add(id);
      result.push(id);
    }
  }
  return result;
}

function normalizeAllowlistedSkillIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const result = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string") {
      continue;
    }
    const id = item.trim();
    if (SKILL_ID_PATTERN.test(id) && id.length <= 64) {
      result.add(id);
    }
  }
  return [...result];
}

function buildSubtaskEvidenceText(input: LoopSubtaskSkillInput): string {
  return [
    normalizeUnknownText(input.title),
    normalizeUnknownText(input.prompt),
    normalizeUnknownText(input.conflictGroup),
    ...normalizeUnknownStringArray(input.writeFiles),
  ].filter(Boolean).join("\n");
}

function renderGuidanceBlock(skill: LoopLoadedSkill): string {
  return [
    `${LOOP_SKILL_GUIDANCE_DELIMITER_PREFIX} id="${skill.id}" BEGIN>>>`,
    skill.guidance,
    `${LOOP_SKILL_GUIDANCE_DELIMITER_PREFIX} id="${skill.id}" END>>>`,
  ].join("\n");
}

function toCompactMetadata(skill: LoopSkillMetadata): Pick<
  LoopSkillMetadata,
  | "id"
  | "name"
  | "description"
  | "phases"
  | "taskKinds"
  | "roles"
  | "requiredCapabilities"
  | "priority"
  | "positiveTriggers"
  | "negativeTriggers"
> {
  return {
    id: skill.id,
    name: skill.name,
    description: skill.description,
    phases: skill.phases,
    taskKinds: skill.taskKinds,
    roles: skill.roles,
    requiredCapabilities: skill.requiredCapabilities,
    priority: skill.priority,
    positiveTriggers: skill.positiveTriggers,
    negativeTriggers: skill.negativeTriggers,
  };
}

function addTaskKindsFromWriteFiles(
  taskKinds: Set<LoopSkillTaskKind>,
  writeFiles: string[],
): void {
  let hasTechnicalFile = false;
  for (const rawFile of writeFiles) {
    const file = rawFile.trim().replace(/\\/gu, "/").toLowerCase();
    if (!file) {
      continue;
    }
    if (/(?:^|\/)(?:test|tests|__tests__)(?:\/|$)|\.test\.[^/]+$|\.spec\.[^/]+$/u.test(file)) {
      taskKinds.add("test");
    }
    if (/^(?:\.ch\/docs|docs)\/|(?:^|\/)readme\.md$|(?:^|\/)agents\.md$|\.md$/u.test(file)) {
      taskKinds.add("documentation");
    }
    if (/(?:^|\/)(?:migrations?|schema)(?:\/|$)|\.sql$/u.test(file)) {
      taskKinds.add("migration");
    }
    if (/(?:^|\/)(?:webview|ui|frontend)(?:\/|$)|\.(?:css|scss|html|vue|svelte)$/u.test(file)) {
      taskKinds.add("ui");
    }
    if (/(?:^|\/)(?:api|routes?|controllers?)(?:\/|$)/u.test(file)) {
      taskKinds.add("api");
    }
    if (/^(?:\.github\/workflows|\.gitlab-ci\.yml$)|(?:^|\/)ci(?:\/|$)/u.test(file)) {
      taskKinds.add("ci");
    }
    if (TECHNICAL_PATH_PATTERN.test(file)) {
      hasTechnicalFile = true;
    }
  }
  if (hasTechnicalFile && taskKinds.size === 0) {
    taskKinds.add("implementation");
  }
}

function normalizeUnknownText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeUnknownStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

function matchesAny(value: string, patterns: RegExp[]): boolean {
  return Boolean(value) && patterns.some((pattern) => pattern.test(value));
}

function normalizeExtensionRoot(value: unknown): string {
  if (typeof value !== "string") {
    throw new LoopSkillPackError("invalid_extension_root", "Extension root must be an absolute path.");
  }
  const normalized = value.trim();
  if (!normalized || normalized.includes("\0") || !path.isAbsolute(normalized)) {
    throw new LoopSkillPackError("invalid_extension_root", "Extension root must be an absolute path.");
  }
  return normalized;
}

function parseManifestJson(content: string): LoopSkillManifest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripBom(content));
  } catch {
    throw new LoopSkillPackError("invalid_manifest", "Skill manifest is not valid JSON.", "manifest.json");
  }
  const record = requireRecord(parsed, "manifest");
  requireExactKeys(record, MANIFEST_TOP_LEVEL_KEYS, "manifest");
  const schemaVersion = requireSafeInteger(record.schemaVersion, "schemaVersion");
  if (schemaVersion !== LOOP_SKILL_MANIFEST_SCHEMA_VERSION) {
    throw new LoopSkillPackError(
      "unsupported_schema",
      "Skill manifest schema version is unsupported.",
      "manifest.json",
    );
  }

  const sourceRecord = requireRecord(record.source, "source");
  requireExactKeys(sourceRecord, MANIFEST_SOURCE_KEYS, "source");
  const source = {
    name: requireBoundedText(sourceRecord.name, "source.name", 120),
    url: requireBoundedText(sourceRecord.url, "source.url", 2048),
    version: requireBoundedText(sourceRecord.version, "source.version", 120),
    license: requireBoundedText(sourceRecord.license, "source.license", 120),
    snapshotSha256: requireSha256(sourceRecord.snapshotSha256, "source.snapshotSha256"),
  };

  if (!Array.isArray(record.files) || record.files.length === 0) {
    throw invalidManifest("files must be a non-empty array.");
  }
  const files = record.files.map((value, index): LoopSkillManifestFile => {
    const fileRecord = requireRecord(value, `files[${index}]`);
    requireExactKeys(fileRecord, MANIFEST_FILE_KEYS, `files[${index}]`);
    return {
      path: requireResourcePath(fileRecord.path, `files[${index}].path`),
      bytes: requireFileBytes(fileRecord.bytes, `files[${index}].bytes`),
      sha256: requireSha256(fileRecord.sha256, `files[${index}].sha256`),
    };
  });
  const filePaths = new Set<string>();
  let totalBytes = 0;
  for (const file of files) {
    if (filePaths.has(file.path)) {
      throw invalidManifest(`Duplicate file path: ${file.path}`);
    }
    if (file.path === "manifest.json") {
      throw invalidManifest("manifest.json must not recursively index itself.");
    }
    filePaths.add(file.path);
    totalBytes += file.bytes;
  }
  if (totalBytes > LOOP_SKILL_MAX_PACK_BYTES) {
    throw invalidManifest("Skill pack exceeds the maximum payload size.");
  }
  if (computeSnapshotSha256(files) !== source.snapshotSha256) {
    throw new LoopSkillPackError(
      "snapshot_hash_mismatch",
      "Skill manifest snapshot hash does not match its file inventory.",
      "manifest.json",
    );
  }

  if (!Array.isArray(record.skills) || record.skills.length === 0) {
    throw invalidManifest("skills must be a non-empty array.");
  }
  const fileByPath = new Map(files.map((file) => [file.path, file]));
  const skillIds = new Set<string>();
  const skillPaths = new Set<string>();
  const skills = record.skills.map((value, index): LoopSkillMetadata => {
    const skill = parseManifestSkill(value, index);
    if (skillIds.has(skill.id)) {
      throw invalidManifest(`Duplicate skill id: ${skill.id}`);
    }
    if (skillPaths.has(skill.path)) {
      throw invalidManifest(`Duplicate skill path: ${skill.path}`);
    }
    skillIds.add(skill.id);
    skillPaths.add(skill.path);

    const expectedPath = `skills/${skill.id}/SKILL.md`;
    if (skill.path !== expectedPath) {
      throw invalidManifest(`Skill ${skill.id} must use ${expectedPath}.`);
    }
    const entry = fileByPath.get(skill.path);
    if (!entry || entry.bytes !== skill.bytes || entry.sha256 !== skill.sha256) {
      throw invalidManifest(`Skill ${skill.id} entry metadata does not match files[].`);
    }
    const supportPaths = new Set<string>();
    for (const supportPath of skill.supportFiles) {
      if (supportPaths.has(supportPath)) {
        throw invalidManifest(`Skill ${skill.id} has a duplicate support file.`);
      }
      supportPaths.add(supportPath);
      if (supportPath === skill.path) {
        throw invalidManifest(`Skill ${skill.id} must not list its own entry as a support file.`);
      }
      if (!fileByPath.has(supportPath)) {
        throw invalidManifest(`Skill ${skill.id} support file is not indexed in files[].`);
      }
    }
    validateSpecialSkillPolicy(skill);
    return skill;
  });

  return {
    schemaVersion,
    source,
    files: [...files].sort((left, right) => compareText(left.path, right.path)),
    skills: [...skills].sort(compareSkills),
  };
}

function parseManifestSkill(value: unknown, index: number): LoopSkillMetadata {
  const label = `skills[${index}]`;
  const record = requireRecord(value, label);
  requireExactKeys(record, MANIFEST_SKILL_KEYS, label);
  const id = requireBoundedText(record.id, `${label}.id`, 64);
  if (!SKILL_ID_PATTERN.test(id)) {
    throw invalidManifest(`${label}.id is invalid.`);
  }
  if (record.developmentOnly !== true) {
    throw invalidManifest(`${label}.developmentOnly must be true.`);
  }
  return {
    id,
    name: requireBoundedText(record.name, `${label}.name`, 120),
    description: requireBoundedText(
      record.description,
      `${label}.description`,
      LOOP_SKILL_MAX_DESCRIPTION_CHARS,
    ),
    path: requireResourcePath(record.path, `${label}.path`),
    bytes: requireFileBytes(record.bytes, `${label}.bytes`),
    sha256: requireSha256(record.sha256, `${label}.sha256`),
    supportFiles: requireResourcePathArray(record.supportFiles, `${label}.supportFiles`),
    developmentOnly: true,
    phases: requireEnumArray(record.phases, `${label}.phases`, LOOP_SKILL_PHASES),
    taskKinds: requireEnumArray(record.taskKinds, `${label}.taskKinds`, LOOP_SKILL_TASK_KINDS),
    roles: requireEnumArray(record.roles, `${label}.roles`, ["main", "subtask"] as const),
    requiredCapabilities: requireTextArray(record.requiredCapabilities, `${label}.requiredCapabilities`, 120),
    priority: requireSafeInteger(record.priority, `${label}.priority`),
    positiveTriggers: requireTextArray(record.positiveTriggers, `${label}.positiveTriggers`, 120),
    negativeTriggers: requireTextArray(record.negativeTriggers, `${label}.negativeTriggers`, 120),
  };
}

function validateSpecialSkillPolicy(skill: LoopSkillMetadata): void {
  if (skill.id === "doubt-driven-development" && skill.roles.includes("subtask")) {
    throw invalidManifest("doubt-driven-development must remain main-only.");
  }
  if (skill.id === "interview-me" || skill.id === "idea-refine") {
    if (skill.roles.includes("subtask") || !skill.requiredCapabilities.includes("interactive-user")) {
      throw invalidManifest(`${skill.id} must remain interactive main-only guidance.`);
    }
  }
  if (
    skill.id === "browser-testing-with-devtools"
    && !skill.requiredCapabilities.includes("chrome-devtools-mcp")
  ) {
    throw invalidManifest("browser-testing-with-devtools requires chrome-devtools-mcp.");
  }
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw invalidManifest(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function requireExactKeys(record: Record<string, unknown>, expectedKeys: string[], label: string): void {
  const actualKeys = Object.keys(record).sort(compareText);
  const sortedExpected = [...expectedKeys].sort(compareText);
  if (
    actualKeys.length !== sortedExpected.length
    || actualKeys.some((key, index) => key !== sortedExpected[index])
  ) {
    throw invalidManifest(`${label} contains missing or unknown fields.`);
  }
}

function requireBoundedText(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== "string") {
    throw invalidManifest(`${label} must be a string.`);
  }
  if (
    !value
    || value !== value.trim()
    || value.length > maxLength
    || /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw invalidManifest(`${label} is invalid or exceeds its limit.`);
  }
  return value;
}

function requireSafeInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw invalidManifest(`${label} must be a safe integer.`);
  }
  return value;
}

function requireFileBytes(value: unknown, label: string): number {
  const bytes = requireSafeInteger(value, label);
  if (bytes < 0 || bytes > LOOP_SKILL_MAX_FILE_BYTES) {
    throw invalidManifest(`${label} exceeds the file size limit.`);
  }
  return bytes;
}

function requireSha256(value: unknown, label: string): string {
  if (typeof value !== "string" || !SHA256_PATTERN.test(value)) {
    throw invalidManifest(`${label} must be a lowercase SHA-256 digest.`);
  }
  return value;
}

function requireResourcePath(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 512) {
    throw invalidManifest(`${label} must be a bounded relative path.`);
  }
  if (
    value.includes("\0")
    || value.includes("\\")
    || value.startsWith("/")
    || /^[a-zA-Z]:/u.test(value)
    || path.posix.isAbsolute(value)
  ) {
    throw invalidManifest(`${label} must be a relative POSIX path.`);
  }
  const segments = value.split("/");
  if (
    segments.some((segment) => !segment || segment === "." || segment === ".." || segment.startsWith("."))
    || path.posix.normalize(value) !== value
    || !value.endsWith(".md")
  ) {
    throw invalidManifest(`${label} contains an unsafe path segment.`);
  }
  return value;
}

function requireResourcePathArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) {
    throw invalidManifest(`${label} must be an array.`);
  }
  return value.map((item, index) => requireResourcePath(item, `${label}[${index}]`));
}

function requireTextArray(value: unknown, label: string, maxItemLength: number): string[] {
  if (!Array.isArray(value)) {
    throw invalidManifest(`${label} must be an array.`);
  }
  const result = value.map((item, index) => requireBoundedText(item, `${label}[${index}]`, maxItemLength));
  if (new Set(result).size !== result.length) {
    throw invalidManifest(`${label} must not contain duplicates.`);
  }
  return result.sort(compareText);
}

function requireEnumArray<T extends string>(
  value: unknown,
  label: string,
  allowedValues: readonly T[],
): T[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw invalidManifest(`${label} must be a non-empty array.`);
  }
  const allowed = new Set<string>(allowedValues);
  const result = value.map((item, index): T => {
    if (typeof item !== "string" || !allowed.has(item)) {
      throw invalidManifest(`${label}[${index}] is unsupported.`);
    }
    return item as T;
  });
  if (new Set(result).size !== result.length) {
    throw invalidManifest(`${label} must not contain duplicates.`);
  }
  return allowedValues.filter((item) => result.includes(item));
}

async function readRegularFileWithinRoot(
  realRoot: string,
  relativePath: string,
  maxBytes: number,
): Promise<Buffer> {
  const segments = relativePath.split("/");
  let currentPath = realRoot;
  for (let index = 0; index < segments.length; index += 1) {
    currentPath = path.join(currentPath, segments[index]!);
    const stat = await safeLstat(currentPath, relativePath);
    if (stat.isSymbolicLink()) {
      throw new LoopSkillPackError(
        "resource_symlink",
        "Skill resources must not contain symbolic links.",
        relativePath,
      );
    }
    const isFinalSegment = index === segments.length - 1;
    if (isFinalSegment ? !stat.isFile() : !stat.isDirectory()) {
      throw new LoopSkillPackError(
        "resource_not_file",
        "Skill resource path has an unexpected file type.",
        relativePath,
      );
    }
  }
  const realTarget = await fs.realpath(currentPath);
  if (!isPathContained(realRoot, realTarget)) {
    throw new LoopSkillPackError(
      "resource_outside_root",
      "Skill resource resolved outside the pack root.",
      relativePath,
    );
  }
  const stat = await fs.stat(realTarget);
  if (stat.size > maxBytes) {
    throw new LoopSkillPackError(
      "resource_too_large",
      "Skill resource exceeds its size limit.",
      relativePath,
    );
  }
  return fs.readFile(realTarget);
}

async function safeLstat(targetPath: string, resourcePath: string): Promise<Awaited<ReturnType<typeof fs.lstat>>> {
  try {
    return await fs.lstat(targetPath);
  } catch {
    throw new LoopSkillPackError("resource_missing", "Skill resource is missing.", resourcePath);
  }
}

function decodeUtf8(content: Buffer, resourcePath: string): string {
  try {
    return UTF8_DECODER.decode(content);
  } catch {
    throw new LoopSkillPackError(
      "resource_invalid_utf8",
      "Skill resource is not valid UTF-8.",
      resourcePath,
    );
  }
}

function cleanSkillMarkdown(content: string, resourcePath: string): string {
  const normalized = stripBom(content).replace(/\r\n?/gu, "\n");
  const lines = normalized.split("\n");
  if (lines[0] !== "---") {
    throw new LoopSkillPackError(
      "invalid_frontmatter",
      "Skill Markdown must start with YAML frontmatter.",
      resourcePath,
    );
  }
  const closingIndex = lines.indexOf("---", 1);
  if (closingIndex < 2) {
    throw new LoopSkillPackError(
      "invalid_frontmatter",
      "Skill Markdown frontmatter is incomplete.",
      resourcePath,
    );
  }
  const frontmatterKeys = new Set<string>();
  for (const line of lines.slice(1, closingIndex)) {
    if (!line.trim() || line.trimStart().startsWith("#")) {
      continue;
    }
    const match = /^([A-Za-z][A-Za-z0-9_-]*):(?:\s+(.*))?$/u.exec(line);
    if (!match || !match[2]?.trim() || frontmatterKeys.has(match[1]!)) {
      throw new LoopSkillPackError(
        "invalid_frontmatter",
        "Skill Markdown frontmatter is invalid.",
        resourcePath,
      );
    }
    frontmatterKeys.add(match[1]!);
  }
  if (!frontmatterKeys.has("name") || !frontmatterKeys.has("description")) {
    throw new LoopSkillPackError(
      "invalid_frontmatter",
      "Skill Markdown frontmatter requires name and description.",
      resourcePath,
    );
  }
  const body = lines
    .slice(closingIndex + 1)
    .join("\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/gu, "")
    .split("\n")
    .map((line) => line.replace(/[\t ]+$/u, ""))
    .join("\n")
    .trim();
  if (!body) {
    throw new LoopSkillPackError(
      "invalid_frontmatter",
      "Skill Markdown body must not be empty.",
      resourcePath,
    );
  }
  if (body.includes(LOOP_SKILL_GUIDANCE_DELIMITER_PREFIX)) {
    throw new LoopSkillPackError(
      "guidance_delimiter_conflict",
      "Skill Markdown contains the reserved guidance delimiter.",
      resourcePath,
    );
  }
  return body;
}

function computeSnapshotSha256(files: LoopSkillManifestFile[]): string {
  const canonical = [...files]
    .sort((left, right) => compareText(left.path, right.path))
    .map((file) => `${file.path}\t${file.bytes}\t${file.sha256}\n`)
    .join("");
  return sha256(canonical);
}

function sha256(content: Buffer | string): string {
  return createHash("sha256").update(content).digest("hex");
}

function stripBom(value: string): string {
  return value.charCodeAt(0) === 0xfeff ? value.slice(1) : value;
}

function isPathContained(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function compareSkills(left: Pick<LoopSkillMetadata, "priority" | "id">, right: Pick<LoopSkillMetadata, "priority" | "id">): number {
  return left.priority - right.priority || compareText(left.id, right.id);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function invalidManifest(message: string): LoopSkillPackError {
  return new LoopSkillPackError("invalid_manifest", message, "manifest.json");
}

function toDiagnostic(error: unknown): LoopSkillDiagnostic {
  if (error instanceof LoopSkillPackError) {
    return {
      code: error.code,
      message: error.message,
      resourcePath: error.resourcePath,
    };
  }
  return {
    code: "pack_unavailable",
    message: "Skill pack could not be loaded.",
  };
}
