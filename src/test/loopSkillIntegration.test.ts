import test = require("node:test");
import assert = require("node:assert/strict");
import fs = require("node:fs");
import os = require("node:os");
import path = require("node:path");
import ts = require("typescript");

import {
  buildLobsterDebatePaths,
  type LobsterDebateParticipantRecord,
} from "../lobsterDebate";
import {
  buildLobsterDebateBriefMarkdown,
} from "../lobsterPromptBuilders";
import {
  runLobsterDebateConsensusSummary,
  type LobsterDebateRunnerDeps,
} from "../lobsterDebateRunner";
import {
  buildLobsterSubtaskExecutionPlan,
} from "../lobsterParallel";
import {
  loadLobsterSkillPack,
  type LobsterSkillDiagnostic,
  type LobsterSkillPackLoadResult,
} from "../lobsterSkillGuidance";
import type {
  LobsterSubtaskDecision,
  LobsterSubtaskRecord,
  LobsterTaskKind,
  LobsterTaskRecord,
} from "../lobsterTaskStore";

type LobsterSkillRuntimeContext = {
  taskId: string;
  rootTaskKind: "development" | "non_development" | "unknown";
  pack: import("../lobsterSkillGuidance").LobsterSkillPack | null;
  compactCatalogSection?: string;
  candidateIds: string[];
};

type LobsterSubtaskSkillSnapshot = {
  skillIds: string[];
  skillGuidance: string;
};

type LobsterSkillIntegrationTestApi = {
  resolveNewLobsterTaskKind: (
    input: { displayPrompt?: unknown; contextTags?: unknown; modelPrompt?: unknown },
    workspacePaths?: unknown,
  ) => LobsterTaskKind | undefined;
  createLobsterTaskRecord: (
    cli: "codex",
    rootPrompt: string,
    options?: {
      sessionId?: string | null;
      executionMode?: "main_sub_multi_agent" | "debate_multi_agent";
      taskKind?: LobsterTaskKind;
    },
  ) => LobsterTaskRecord;
  buildLobsterSkillRuntimeContext: (
    task: LobsterTaskRecord,
    round: number,
    options: {
      extensionRoot: string;
      loadSkillPack?: (extensionRoot: unknown) => Promise<LobsterSkillPackLoadResult>;
      reportDiagnostics?: (scope: string, diagnostics: LobsterSkillDiagnostic[]) => void;
    },
  ) => Promise<LobsterSkillRuntimeContext>;
  buildLobsterSubtaskSkillSnapshots: (
    task: LobsterTaskRecord,
    subtasks: LobsterSubtaskDecision[],
    runtimeContext: LobsterSkillRuntimeContext,
    reportDiagnostics?: (scope: string, diagnostics: LobsterSkillDiagnostic[]) => void,
  ) => Map<string, LobsterSubtaskSkillSnapshot>;
  buildLobsterMainModelPrompt: (
    rootPrompt: string,
    task: LobsterTaskRecord,
    round: number,
    continuePrompt?: string,
    compactSkillCatalogSection?: string,
  ) => string;
  buildLobsterModeratorMainModelPrompt: (
    rootPrompt: string,
    task: LobsterTaskRecord,
    round: number,
    continuePrompt?: string,
    compactSkillCatalogSection?: string,
  ) => string;
  buildLobsterSubtaskDisplayPrompt: (
    round: number,
    subtask: LobsterSubtaskRecord,
    retryCount?: number,
  ) => string;
  buildLobsterSubtaskModelPrompt: (
    rootPrompt: string,
    task: LobsterTaskRecord,
    round: number,
    subtask: LobsterSubtaskRecord,
    retryCount?: number,
    communicationFile?: string,
  ) => string;
  normalizeSingleLobsterSubtaskDecision: (value: unknown) => LobsterSubtaskDecision | null;
  applyLobsterMainDecisionForRun: (
    taskId: string,
    decision: import("../lobsterTaskStore").LobsterMainDecision,
    runtimeContext?: LobsterSkillRuntimeContext,
  ) => {
    status: "completed" | "continue" | "needs-review" | "interrupted";
    task: LobsterTaskRecord;
    subtasks?: LobsterSubtaskRecord[];
  };
  upsertLobsterSubtasks: (
    task: LobsterTaskRecord,
    subtasks: LobsterSubtaskDecision[],
    skillSnapshots?: ReadonlyMap<string, LobsterSubtaskSkillSnapshot>,
  ) => { records: LobsterSubtaskRecord[]; nextSubtasks: LobsterSubtaskRecord[] };
};

const originalHome = process.env.HOME;
const testHome = fs.mkdtempSync(path.join(os.tmpdir(), "sinitek-lobster-skill-integration-home-"));
process.env.HOME = testHome;

const lobsterTaskStore = require("../lobsterTaskStore") as typeof import("../lobsterTaskStore");
const integrationApi = loadLobsterSkillIntegrationTestApi();

test.after(() => {
  if (originalHome === undefined) {
    delete process.env.HOME;
  } else {
    process.env.HOME = originalHome;
  }
  fs.rmSync(testHome, { recursive: true, force: true });
});

function loadLobsterSkillIntegrationTestApi(): LobsterSkillIntegrationTestApi | null {
  const Module = require("node:module") as {
    _load: (request: string, parent: unknown, isMain: boolean) => unknown;
  };
  const originalLoad = Module._load;
  let vscodeProxy: unknown;
  const callable = function (): unknown {
    return vscodeProxy;
  };
  vscodeProxy = new Proxy(callable, {
    get(_target, property) {
      if (property === "then") {
        return undefined;
      }
      if (property === Symbol.toPrimitive) {
        return () => 0;
      }
      return vscodeProxy;
    },
    apply() {
      return vscodeProxy;
    },
    construct() {
      return vscodeProxy as object;
    },
  });
  Module._load = (request: string, parent: unknown, isMain: boolean): unknown => {
    if (request === "vscode") {
      return vscodeProxy;
    }
    return originalLoad(request, parent, isMain);
  };
  try {
    const extension = require("../extension") as {
      __lobsterSkillIntegrationTestApi?: LobsterSkillIntegrationTestApi;
    };
    return extension.__lobsterSkillIntegrationTestApi ?? null;
  } finally {
    Module._load = originalLoad;
  }
}

function requireIntegrationApi(): LobsterSkillIntegrationTestApi {
  assert.ok(integrationApi, "extension should expose the narrow Lobster Skill integration test seam");
  return integrationApi;
}

function createTask(taskKind?: LobsterTaskKind, id = "skill-integration-task"): LobsterTaskRecord {
  const now = Date.UTC(2026, 6, 12, 9, 0, 0);
  return {
    id,
    cli: "codex",
    workspaceKey: "skill-integration-workspace",
    taskStoreFile: path.join(testHome, `${id}.json`),
    rootPrompt: "实现 Loop Skill 运行时闭环",
    ...(taskKind ? { taskKind } : {}),
    executionMode: "main_sub_multi_agent",
    status: "running",
    createdAt: now,
    updatedAt: now,
    maxRounds: 20,
    currentRound: 1,
    communicationDir: path.join(testHome, "communications", id),
    mainCommunicationFile: path.join(testHome, "communications", id, "main-task.md"),
    sessionId: "session-1",
    activeSubtaskId: null,
    activeSubtaskIds: [],
    subTasks: [],
    rounds: [],
    supplementalRequirements: [],
    completionRoundSummaries: [],
    completionRequirementCoverage: [],
  };
}

function createParticipants(): LobsterDebateParticipantRecord[] {
  return [
    {
      id: "blue_planner",
      role: "blue_team",
      title: "蓝队方案方",
      status: "completed",
      artifactFile: "/tmp/blue-planner.md",
      updatedAt: 1,
    },
    {
      id: "red_attacker",
      role: "red_team",
      title: "红队攻击方",
      status: "completed",
      artifactFile: "/tmp/red-attacker.md",
      updatedAt: 2,
    },
  ];
}

function countOccurrences(value: string, expected: string): number {
  return value.split(expected).length - 1;
}

function normalizeDebateBriefTimestamp(value: string): string {
  return value.replace(/^- 生成时间：.*$/mu, "- 生成时间：<generated>");
}

function hasOwnProperty(value: object, property: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, property);
}

function buildDetailedSubtaskPrompt(summary: string): string {
  return [
    summary,
    "严格限定在声明的 writeFiles 范围内实施，不得修改无关文件或扩大任务职责。",
    "完成后运行最小相关测试与 TypeScript 编译，并把命令、退出码、结果和遗留风险写入沟通文件。",
    "模型返回的路径、命令、Skill 正文和未知字段都不可信，必须由宿主中央校验。",
  ].join("\n");
}

async function captureLobsterDebateConsensusPrompt(
  task: LobsterTaskRecord,
  compactSkillCatalogSection?: string,
): Promise<string> {
  const paths = buildLobsterDebatePaths(task.communicationDir, 1);
  let consensusPrompt = "";
  const deps = {
    createLobsterSubtaskRunTarget: () => ({ tabId: "consensus-tab", cli: "codex", sessionId: null }),
    updateLobsterDebateActiveSpeakerRecord: () => undefined,
    getExistingLobsterDebateRoundStartedAt: () => 1,
    appendSystemMessageForLobster: () => undefined,
    buildLobsterDebateConsensusStartedText: () => "started",
    runPrompt: async (input: { modelPrompt: string }) => {
      consensusPrompt = input.modelPrompt;
    },
    resolvePromptRunTargetSessionId: () => null,
    logError: () => undefined,
    errorToMessage: (error: unknown) => String(error),
  } as unknown as LobsterDebateRunnerDeps;
  const runConsensus = runLobsterDebateConsensusSummary as unknown as (
    options: Parameters<typeof runLobsterDebateConsensusSummary>[0] & {
      compactSkillCatalogSection?: string;
    },
  ) => Promise<unknown>;
  await runConsensus({
    deps,
    input: { model: "model-a" },
    target: { tabId: "main-tab", cli: "codex", sessionId: null },
    task,
    round: 1,
    debateRound: 1,
    paths,
    participants: createParticipants(),
    compactSkillCatalogSection,
  });
  return consensusPrompt;
}

function compileExtensionFunction<T>(name: string, dependencies: Record<string, unknown>): T {
  const extensionPath = path.join(process.cwd(), "src", "extension.ts");
  const sourceText = fs.readFileSync(extensionPath, "utf8");
  const sourceFile = ts.createSourceFile(extensionPath, sourceText, ts.ScriptTarget.ES2020, true, ts.ScriptKind.TS);
  const declaration = sourceFile.statements.find((statement): statement is ts.FunctionDeclaration => (
    ts.isFunctionDeclaration(statement) && statement.name?.text === name
  ));
  assert.ok(declaration, `${name} should exist in extension.ts`);
  const functionText = declaration.getText(sourceFile);
  const output = ts.transpileModule(`${functionText}\nmodule.exports = ${name};`, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;
  const moduleRecord: { exports: unknown } = { exports: {} };
  const dependencyNames = Object.keys(dependencies);
  const evaluator = new Function(
    "module",
    "exports",
    ...dependencyNames,
    output,
  ) as (module: { exports: unknown }, exports: unknown, ...values: unknown[]) => void;
  evaluator(moduleRecord, moduleRecord.exports, ...dependencyNames.map((key) => dependencies[key]));
  return moduleRecord.exports as T;
}

test("RED boundary: new Lobster task creation persists the trusted root classification", () => {
  const writes: LobsterTaskRecord[][] = [];
  const createRecord = compileExtensionFunction<(
    cli: "codex",
    rootPrompt: string,
    options: { taskKind?: LobsterTaskKind },
  ) => LobsterTaskRecord>("createLobsterTaskRecord", {
    createMessageId: () => "classified-task",
    getLobsterCommunicationPaths: () => ({ dir: "/tmp/comm", mainFile: "/tmp/comm/main.md" }),
    normalizeLobsterExecutionMode: () => "main_sub_multi_agent",
    buildLobsterTaskStoreFile: () => "/tmp/classified-task.json",
    activeWorkspaceKey: "workspace",
    ensureLobsterCommunicationFiles: () => undefined,
    getGlobalLobsterMaxRounds: () => 20,
    buildResetLobsterMainAiFailureState: () => ({}),
    readLobsterTaskStore: () => ({ tasks: [] }),
    writeLobsterTaskStore: (_file: string, store: { tasks: LobsterTaskRecord[] }) => {
      writes.push(store.tasks);
    },
  });

  const record = createRecord("codex", "实现 TypeScript 功能", { taskKind: "development" });

  assert.equal(record.taskKind, "development");
  assert.equal(writes[0]?.[0]?.taskKind, "development");
});

test("RED boundary: ordinary main prompt accepts one compact catalog and an ID-only contract", () => {
  const buildMainPrompt = compileExtensionFunction<(
    rootPrompt: string,
    task: LobsterTaskRecord,
    round: number,
    continuePrompt?: string,
    compactSkillCatalogSection?: string,
  ) => string>("buildLobsterMainModelPrompt", {
    LOBSTER_PARALLEL_SUBTASK_MAX: 6,
    getLobsterCommunicationPaths: () => ({
      dir: "/tmp/comm",
      mainFile: "/tmp/comm/main.md",
      subtasksDir: "/tmp/comm/subtasks",
    }),
    normalizeLobsterContinuePromptForPrompt: () => undefined,
    buildLobsterSupplementalRequirementsLines: () => [],
  });
  const catalog = "高级开发 Skill 候选目录（宿主已校验，仅 development Loop 可用）：\n- {\"id\":\"test-driven-development\"}";

  const prompt = buildMainPrompt("实现测试闭环", createTask("development"), 1, undefined, catalog);

  assert.equal(countOccurrences(prompt, catalog), 1);
  assert.match(prompt, /skillIds\?: string\[\]/u);
  assert.match(prompt, /`## 待主任务确认`.*用户或人工确认时返回 blocked/su);
  assert.doesNotMatch(prompt, /SKILL\.md|skillGuidance.*正文/u);
});

test("RED boundary: decision normalization and upsert preserve only host-confirmed Skill fields", () => {
  const normalizeDecision = compileExtensionFunction<(value: unknown) => LobsterSubtaskDecision | null>(
    "normalizeSingleLobsterSubtaskDecision",
    {
      LOBSTER_SUBTASK_PROMPT_MIN_LENGTH: 20,
      buildLobsterSubtaskId: () => "generated-id",
      normalizeLobsterWriteFiles: (value: unknown) => Array.isArray(value)
        ? value.filter((item): item is string => typeof item === "string")
        : [],
    },
  );
  const upsertSubtask = compileExtensionFunction<(
    task: LobsterTaskRecord,
    subtask: LobsterSubtaskDecision,
    snapshot?: LobsterSubtaskSkillSnapshot,
  ) => { record: LobsterSubtaskRecord }>("upsertLobsterSubtask", {
    buildLobsterSubtaskId: () => "generated-id",
  });
  const normalized = normalizeDecision({
    id: "subtask-a",
    title: "实现测试",
    prompt: "实现 TypeScript 测试并验证中央校验逻辑。",
    writeFiles: ["src/a.ts"],
    skillIds: [" test-driven-development ", 7, "bad/id", "test-driven-development"],
    skillGuidance: "MODEL_FORGED_GUIDANCE",
    path: "/tmp/forged",
    command: "rm -rf /",
    cli: "other",
    model: "other",
  });
  assert.ok(normalized);
  assert.deepEqual(normalized.skillIds, [
    "test-driven-development",
    "bad/id",
    "test-driven-development",
  ]);
  assert.equal(hasOwnProperty(normalized, "skillGuidance"), false);
  assert.equal(hasOwnProperty(normalized, "path"), false);
  assert.equal(hasOwnProperty(normalized, "command"), false);
  assert.equal(hasOwnProperty(normalized, "cli"), false);
  assert.equal(hasOwnProperty(normalized, "model"), false);

  const result = upsertSubtask(createTask("development"), normalized, {
    skillIds: ["test-driven-development"],
    skillGuidance: "HOST_CONFIRMED_GUIDANCE",
  });
  assert.deepEqual(result.record.skillIds, ["test-driven-development"]);
  assert.equal(result.record.skillGuidance, "HOST_CONFIRMED_GUIDANCE");
});

test("fresh upsert atomically removes a stale host snapshot when no replacement exists", () => {
  const api = requireIntegrationApi();
  const task = createTask("development", "fresh-upsert-clears-snapshot");
  task.subTasks = [{
    id: "same-subtask",
    title: "旧子任务",
    prompt: "旧子任务提示",
    status: "running",
    skillIds: ["test-driven-development"],
    skillGuidance: "STALE_HOST_GUIDANCE",
  }];
  const decision = api.normalizeSingleLobsterSubtaskDecision({
    id: "same-subtask",
    title: "继续执行但本轮不选择 Skill",
    prompt: buildDetailedSubtaskPrompt("继续执行现有任务，但本轮主决策没有选择任何 Skill"),
  });
  assert.ok(decision);

  const batch = api.upsertLobsterSubtasks(task, [decision], new Map());
  const record = batch.records[0];
  const persistedRecord = batch.nextSubtasks.find((item) => item.id === decision.id);

  assert.ok(record);
  assert.ok(persistedRecord);
  for (const value of [record, persistedRecord]) {
    assert.equal(hasOwnProperty(value, "skillIds"), false);
    assert.equal(hasOwnProperty(value, "skillGuidance"), false);
  }
  assert.doesNotMatch(api.buildLobsterSubtaskModelPrompt(
    task.rootPrompt,
    task,
    2,
    persistedRecord,
  ), /STALE_HOST_GUIDANCE/u);
});

test("RED boundary: persisted guidance is injected between responsibilities and current task on every retry", () => {
  const buildSubtaskPrompt = compileExtensionFunction<(
    rootPrompt: string,
    task: LobsterTaskRecord,
    round: number,
    subtask: LobsterSubtaskRecord,
    retryCount?: number,
    communicationFile?: string,
  ) => string>("buildLobsterSubtaskModelPrompt", {
    getLobsterCommunicationPaths: () => ({ dir: "/tmp/comm" }),
    buildLobsterSubtaskCommunicationFile: () => "/tmp/comm/subtask.md",
  });
  const subtask: LobsterSubtaskRecord = {
    id: "subtask-a",
    title: "实现测试",
    prompt: "实现并验证测试闭环。",
    writeFiles: ["src/a.ts"],
    skillIds: ["test-driven-development"],
    skillGuidance: "PERSISTED_SKILL_GUIDANCE_MARKER",
    status: "running",
  };

  const firstPrompt = buildSubtaskPrompt("原始目标", createTask("development"), 1, subtask, 0);
  const retryPrompt = buildSubtaskPrompt("原始目标", createTask("development"), 1, subtask, 1);

  for (const prompt of [firstPrompt, retryPrompt]) {
    assert.equal(countOccurrences(prompt, "PERSISTED_SKILL_GUIDANCE_MARKER"), 1);
    assert.ok(prompt.indexOf("子任务职责：") < prompt.indexOf("PERSISTED_SKILL_GUIDANCE_MARKER"));
    assert.ok(prompt.indexOf("PERSISTED_SKILL_GUIDANCE_MARKER") < prompt.indexOf("当前子任务："));
    assert.match(prompt, /系统\/用户要求.*AGENTS.*writeFiles.*验收.*沟通/u);
    assert.match(prompt, /需求不明、授权不足、依赖或写入冲突/u);
    assert.match(prompt, /`## 待主任务确认`.*待确认问题.*已知事实.*影响\/阻塞步骤.*可选方案.*推荐方案/su);
    assert.match(prompt, /status=completed.*summary.*待主任务确认.*communicationFile/su);
    assert.match(prompt, /严禁在 assistant 回复中向用户或主任务提问/u);
    assert.match(prompt, /最终 assistant 回复必须且只能是：`子任务已结束，待主任务确认事项已写入沟通文件。`/u);
  }
});

test("passes the same development catalog gate into debate brief and runner consensus", async () => {
  const task = createTask("development", "debate-skill-task");
  task.executionMode = "debate_multi_agent";
  const paths = buildLobsterDebatePaths(task.communicationDir, 1);
  const catalog = [
    "高级开发 Skill 候选目录（宿主已校验，仅 development Loop 可用）：",
    '- {"id":"test-driven-development","roles":["subtask"],"requiredCapabilities":[]}',
  ].join("\n");
  const brief = buildLobsterDebateBriefMarkdown(task, { cli: "codex" }, 1, paths, undefined, catalog);
  let consensusPrompt = "";
  const deps = {
    createLobsterSubtaskRunTarget: () => ({ tabId: "consensus-tab", cli: "codex", sessionId: null }),
    updateLobsterDebateActiveSpeakerRecord: () => undefined,
    getExistingLobsterDebateRoundStartedAt: () => 1,
    appendSystemMessageForLobster: () => undefined,
    buildLobsterDebateConsensusStartedText: () => "started",
    runPrompt: async (input: { modelPrompt: string }) => {
      consensusPrompt = input.modelPrompt;
    },
    resolvePromptRunTargetSessionId: () => null,
    logError: () => undefined,
    errorToMessage: (error: unknown) => String(error),
  } as unknown as LobsterDebateRunnerDeps;
  const runConsensus = runLobsterDebateConsensusSummary as unknown as (
    options: Parameters<typeof runLobsterDebateConsensusSummary>[0] & {
      compactSkillCatalogSection?: string;
    },
  ) => Promise<unknown>;

  await runConsensus({
    deps,
    input: { model: "model-a" },
    target: { tabId: "main-tab", cli: "codex", sessionId: null },
    task,
    round: 1,
    debateRound: 1,
    paths,
    participants: createParticipants(),
    compactSkillCatalogSection: catalog,
  });

  assert.equal(countOccurrences(brief, catalog), 1);
  assert.match(consensusPrompt, /skillIds\?: string\[\]/u);
  assert.match(consensusPrompt, /compact Skill catalog 位于 brief\.md/u);
});

test("builds a development runtime catalog while non-development and legacy tasks never load resources", async () => {
  const api = requireIntegrationApi();
  let loadCount = 0;
  const load = async (extensionRoot: unknown): Promise<LobsterSkillPackLoadResult> => {
    loadCount += 1;
    return loadLobsterSkillPack(extensionRoot);
  };
  const development = await api.buildLobsterSkillRuntimeContext(createTask("development"), 1, {
    extensionRoot: process.cwd(),
    loadSkillPack: load,
  });
  assert.equal(loadCount, 1);
  assert.ok(development.pack);
  assert.ok(development.compactCatalogSection);
  assert.ok(development.candidateIds.includes("test-driven-development"));

  for (const task of [createTask("non_development", "non-development"), createTask(undefined, "legacy")]) {
    const context = await api.buildLobsterSkillRuntimeContext(task, 1, {
      extensionRoot: "/path/that/must/not/be-read",
      loadSkillPack: load,
    });
    assert.equal(context.pack, null);
    assert.equal(context.compactCatalogSection, undefined);
    assert.deepEqual(context.candidateIds, []);
  }
  assert.equal(loadCount, 1);
});

test("explicit non-development requests with technical context keep ordinary and debate prompts Skill-free", async () => {
  const api = requireIntegrationApi();
  const samples = [
    { name: "summary", prompt: "总结这段代码" },
    { name: "information organization", prompt: "请整理这些资料和信息" },
    { name: "ordinary question", prompt: "普通问答：什么是闭包？" },
    { name: "explanation", prompt: "Explain what this function means" },
    { name: "translation", prompt: "翻译这段说明" },
    { name: "writing", prompt: "Draft a customer email" },
    { name: "shopping", prompt: "比较两款耳机并给出购物建议" },
    { name: "travel", prompt: "Plan a family trip to Japan" },
  ] as const;
  const catalogMarker = [
    "高级开发 Skill 候选目录（不应出现）",
    '- {"id":"test-driven-development"}',
    "TEST_DRIVEN_DEVELOPMENT_BODY_MUST_NOT_APPEAR",
  ].join("\n");
  let loadCount = 0;

  for (const [index, scenario] of samples.entries()) {
    const taskKind = api.resolveNewLobsterTaskKind({
      displayPrompt: scenario.prompt,
      modelPrompt: "实现、修复并发布 TypeScript 代码",
      contextTags: ["file: src/extension.ts"],
    }, ["/workspace/src/lobsterSkillGuidance.ts"]);
    assert.equal(taskKind, "non_development", scenario.name);

    const task = createTask(taskKind, `non-development-${index}`);
    task.rootPrompt = scenario.prompt;
    task.executionMode = "debate_multi_agent";
    const runtime = await api.buildLobsterSkillRuntimeContext(task, 1, {
      extensionRoot: "/path/that/must/not/be-read",
      loadSkillPack: async () => {
        loadCount += 1;
        throw new Error("non-development task must not load the Skill pack");
      },
    });
    assert.equal(runtime.compactCatalogSection, undefined);
    assert.deepEqual(runtime.candidateIds, []);

    const ordinaryBaseline = api.buildLobsterMainModelPrompt(task.rootPrompt, task, 1);
    const ordinaryWithCatalog = api.buildLobsterMainModelPrompt(
      task.rootPrompt,
      task,
      1,
      undefined,
      catalogMarker,
    );
    assert.equal(ordinaryWithCatalog, ordinaryBaseline);

    const paths = buildLobsterDebatePaths(task.communicationDir, 1);
    const briefBaseline = buildLobsterDebateBriefMarkdown(task, { cli: "codex" }, 1, paths);
    const briefWithCatalog = buildLobsterDebateBriefMarkdown(
      task,
      { cli: "codex" },
      1,
      paths,
      undefined,
      catalogMarker,
    );
    assert.equal(
      normalizeDebateBriefTimestamp(briefWithCatalog),
      normalizeDebateBriefTimestamp(briefBaseline),
    );

    const consensusBaseline = await captureLobsterDebateConsensusPrompt(task);
    const consensusWithCatalog = await captureLobsterDebateConsensusPrompt(task, catalogMarker);
    assert.equal(consensusWithCatalog, consensusBaseline);

    for (const prompt of [ordinaryWithCatalog, briefWithCatalog, consensusWithCatalog]) {
      assert.doesNotMatch(
        prompt,
        /高级开发 Skill 候选目录|skillIds|SINITEK_LOOP_SKILL_GUIDANCE|TEST_DRIVEN_DEVELOPMENT_BODY_MUST_NOT_APPEAR/u,
        scenario.name,
      );
    }
  }

  assert.equal(loadCount, 0);
});

test("persists only trusted new-task classifications and ignores injected model text", () => {
  const api = requireIntegrationApi();
  const developmentKind = api.resolveNewLobsterTaskKind({
    displayPrompt: "实现 TypeScript API 并补充测试",
    modelPrompt: "翻译一篇文章",
    contextTags: [],
  }, []);
  const contextKind = api.resolveNewLobsterTaskKind({
    displayPrompt: "处理这个问题",
    modelPrompt: "旅行建议",
    contextTags: ["file: src/extension.ts"],
  }, []);
  const nonDevelopmentKind = api.resolveNewLobsterTaskKind({
    displayPrompt: "翻译这篇文章",
    modelPrompt: "实现一个 API",
    contextTags: ["file: src/extension.ts"],
  }, []);
  const unknownKind = api.resolveNewLobsterTaskKind({
    displayPrompt: "帮我处理一下",
    modelPrompt: "实现、测试并发布代码",
    contextTags: [],
  }, []);

  assert.equal(developmentKind, "development");
  assert.equal(contextKind, "development");
  assert.equal(nonDevelopmentKind, "non_development");
  assert.equal(unknownKind, undefined);

  const developmentRecord = api.createLobsterTaskRecord("codex", "实现 TypeScript API", {
    sessionId: "classification-session",
    taskKind: developmentKind,
  });
  const unknownRecord = api.createLobsterTaskRecord("codex", "帮我处理一下", {
    sessionId: "classification-session",
    taskKind: unknownKind,
  });
  const persistedDevelopment = lobsterTaskStore.readLobsterTaskStore(developmentRecord.taskStoreFile)
    .tasks.find((item) => item.id === developmentRecord.id);
  const persistedUnknown = lobsterTaskStore.readLobsterTaskStore(unknownRecord.taskStoreFile)
    .tasks.find((item) => item.id === unknownRecord.id);

  assert.equal(persistedDevelopment?.taskKind, "development");
  assert.ok(persistedUnknown);
  assert.equal(hasOwnProperty(persistedUnknown, "taskKind"), false);
});

test("keeps main and moderator prompts baseline-compatible unless a development catalog exists", async () => {
  const api = requireIntegrationApi();
  const developmentTask = createTask("development");
  const runtime = await api.buildLobsterSkillRuntimeContext(developmentTask, 1, {
    extensionRoot: process.cwd(),
  });
  assert.ok(runtime.compactCatalogSection);

  const mainPrompt = api.buildLobsterMainModelPrompt(
    developmentTask.rootPrompt,
    developmentTask,
    1,
    undefined,
    runtime.compactCatalogSection,
  );
  const moderatorPrompt = api.buildLobsterModeratorMainModelPrompt(
    developmentTask.rootPrompt,
    developmentTask,
    2,
    undefined,
    runtime.compactCatalogSection,
  );
  assert.equal(countOccurrences(mainPrompt, runtime.compactCatalogSection!), 1);
  assert.equal(countOccurrences(moderatorPrompt, runtime.compactCatalogSection!), 1);
  assert.match(mainPrompt, /skillIds\?: string\[\]/u);
  assert.match(moderatorPrompt, /skillIds\?: string\[\]/u);
  assert.doesNotMatch(mainPrompt, /The TDD Cycle|SKILL\.md|"path":/u);

  for (const task of [createTask("non_development"), createTask(undefined, "legacy-prompt")]) {
    const baseline = api.buildLobsterMainModelPrompt(task.rootPrompt, task, 1);
    const withCatalog = api.buildLobsterMainModelPrompt(
      task.rootPrompt,
      task,
      1,
      undefined,
      runtime.compactCatalogSection,
    );
    assert.equal(withCatalog, baseline);
    assert.doesNotMatch(withCatalog, /高级开发 Skill 候选目录|skillIds/u);
  }
});

test("centrally filters each parallel subtask and preserves scheduling fields", async () => {
  const api = requireIntegrationApi();
  const task = createTask("development", "central-gate-task");
  const runtime = await api.buildLobsterSkillRuntimeContext(task, 1, {
    extensionRoot: process.cwd(),
  });
  const implementation = api.normalizeSingleLobsterSubtaskDecision({
    id: "implementation",
    title: "实现并安全审查 API 与集成测试",
    prompt: buildDetailedSubtaskPrompt("实现 TypeScript API，添加集成测试，并审查不可信输入和信任边界，完成验证"),
    conflictGroup: "src/api",
    writeFiles: ["src/api.ts", "src/test/api.test.ts"],
    skillIds: [
      "security-and-hardening",
      "test-driven-development",
      "bad/id",
      "incremental-implementation",
      "test-driven-development",
      "unknown-skill",
    ],
    skillGuidance: "MODEL_FORGED_GUIDANCE",
    path: "/tmp/forged",
    hash: "forged",
    command: "forged",
    cli: "claude",
    model: "forged-model",
  });
  const security = api.normalizeSingleLobsterSubtaskDecision({
    id: "security",
    title: "审查不可信输入边界",
    prompt: buildDetailedSubtaskPrompt("执行安全审查，检查不可信输入、路径穿越和信任边界，并给出验证证据"),
    conflictGroup: "security-review",
    writeFiles: ["src/test/security.test.ts"],
    skillIds: ["security-and-hardening"],
  });
  assert.ok(implementation);
  assert.ok(security);
  const decisions = [implementation, security];
  const diagnosticCodes: string[] = [];
  const snapshots = api.buildLobsterSubtaskSkillSnapshots(
    task,
    decisions,
    runtime,
    (_scope, diagnostics) => diagnosticCodes.push(...diagnostics.map((item) => item.code)),
  );
  const batch = api.upsertLobsterSubtasks(task, decisions, snapshots);

  assert.deepEqual(batch.records[0]?.skillIds, [
    "incremental-implementation",
    "test-driven-development",
  ]);
  assert.ok(batch.records[0]?.skillGuidance?.includes('<<<SINITEK_LOOP_SKILL_GUIDANCE id="incremental-implementation" BEGIN>>>'));
  assert.ok(batch.records[0]?.skillGuidance?.includes('<<<SINITEK_LOOP_SKILL_GUIDANCE id="test-driven-development" BEGIN>>>'));
  assert.doesNotMatch(batch.records[0]?.skillGuidance ?? "", /security-and-hardening/u);
  assert.deepEqual(batch.records[1]?.skillIds, ["security-and-hardening"]);
  assert.match(batch.records[1]?.skillGuidance ?? "", /id="security-and-hardening" BEGIN/u);
  assert.ok(diagnosticCodes.includes("invalid_skill_id"));
  assert.ok(diagnosticCodes.includes("unknown_skill_id"));
  assert.ok(diagnosticCodes.includes("guidance_budget_exceeded"));
  assert.equal(hasOwnProperty(implementation, "skillGuidance"), false);
  assert.equal(hasOwnProperty(implementation, "path"), false);
  assert.equal(hasOwnProperty(batch.records[0]!, "cli"), false);
  assert.equal(hasOwnProperty(batch.records[0]!, "model"), false);
  assert.equal(hasOwnProperty(batch.records[0]!, "command"), false);
  assert.equal(batch.records[0]?.conflictGroup, implementation.conflictGroup);
  assert.deepEqual(batch.records[0]?.writeFiles, implementation.writeFiles);
  assert.equal(task.cli, "codex");

  const beforePlan = buildLobsterSubtaskExecutionPlan(decisions as LobsterSubtaskRecord[]);
  const afterPlan = buildLobsterSubtaskExecutionPlan(batch.records);
  assert.deepEqual(
    afterPlan.groups.map((group) => group.map((item) => item.id)),
    beforePlan.groups.map((group) => group.map((item) => item.id)),
  );
});

test("applies host Skill snapshots through the shared decision path and resets main AI failure state", async () => {
  const api = requireIntegrationApi();
  const task = api.createLobsterTaskRecord("codex", "实现中央 Skill 校验和 Store 快照", {
    sessionId: "central-apply-session",
    taskKind: "development",
  });
  lobsterTaskStore.updateLobsterTaskRecord(task.id, {
    mainAiFailureCount: 4,
    mainAiFailureLimitReached: false,
    mainAiLastFailureAt: 123,
    mainAiLastFailureMessage: "previous failure",
  });
  const runtime = await api.buildLobsterSkillRuntimeContext(task, 1, {
    extensionRoot: process.cwd(),
  });
  const subtask = api.normalizeSingleLobsterSubtaskDecision({
    id: "central-apply-subtask",
    title: "实现并测试中央 apply",
    prompt: buildDetailedSubtaskPrompt("实现中央 apply 的 Skill 校验、Store 快照和自动重试复用"),
    conflictGroup: "central-apply",
    writeFiles: ["src/central.ts", "src/test/central.test.ts"],
    skillIds: ["test-driven-development"],
    skillGuidance: "MODEL_FORGED_GUIDANCE",
  });
  assert.ok(subtask);

  const result = api.applyLobsterMainDecisionForRun(task.id, {
    status: "continue",
    estimatedRemainingRounds: 1,
    acceptance: {
      passed: false,
      summary: "继续执行",
      checks: [{ name: "中央快照", passed: false, detail: "等待子任务完成" }],
    },
    subtask,
    subtasks: [subtask],
  }, runtime);
  const persisted = lobsterTaskStore.readLobsterTaskStore(task.taskStoreFile)
    .tasks.find((item) => item.id === task.id);
  const persistedSubtask = persisted?.subTasks.find((item) => item.id === subtask.id);

  assert.equal(result.status, "continue");
  assert.deepEqual(persistedSubtask?.skillIds, ["test-driven-development"]);
  assert.match(persistedSubtask?.skillGuidance ?? "", /id="test-driven-development" BEGIN/u);
  assert.equal(persistedSubtask?.conflictGroup, subtask.conflictGroup);
  assert.deepEqual(persistedSubtask?.writeFiles, subtask.writeFiles);
  assert.equal(persisted?.mainAiFailureCount, 0);
  assert.equal(persisted?.mainAiFailureLimitReached, false);
  assert.equal(persisted?.mainAiLastFailureAt, undefined);
  assert.equal(persisted?.mainAiLastFailureMessage, undefined);
});

test("fresh central decisions clear stale snapshots for every no-snapshot outcome", async () => {
  const api = requireIntegrationApi();
  const loadedPack = await loadLobsterSkillPack(process.cwd());
  assert.ok(loadedPack.pack);
  const scenarios = [
    {
      name: "no selection",
      title: "继续执行现有任务",
      prompt: buildDetailedSubtaskPrompt("继续执行现有任务，本轮不选择任何 Skill"),
      skillIds: undefined,
      runtime: "valid",
    },
    {
      name: "unknown ID",
      title: "实现并测试未知 Skill 拒绝",
      prompt: buildDetailedSubtaskPrompt("实现并测试未知 Skill ID 的中央拒绝路径"),
      skillIds: ["unknown-skill"],
      runtime: "valid",
    },
    {
      name: "invalid ID",
      title: "实现并测试非法 Skill ID 拒绝",
      prompt: buildDetailedSubtaskPrompt("实现并测试非法 Skill ID 的中央拒绝路径"),
      skillIds: ["bad/id"],
      runtime: "valid",
    },
    {
      name: "phase mismatch",
      title: "补充单元测试",
      prompt: buildDetailedSubtaskPrompt("补充单元测试覆盖现有行为"),
      skillIds: ["test-driven-development"],
      runtime: "valid",
    },
    {
      name: "task kind mismatch",
      title: "实现前端 UI",
      prompt: buildDetailedSubtaskPrompt("实现前端 UI 组件并验证界面行为"),
      skillIds: ["api-and-interface-design"],
      runtime: "valid",
    },
    {
      name: "role mismatch",
      title: "实现 TypeScript 功能",
      prompt: buildDetailedSubtaskPrompt("实现 TypeScript 功能并完成验证"),
      skillIds: ["doubt-driven-development"],
      runtime: "valid",
    },
    {
      name: "missing capability",
      title: "调试前端 UI 浏览器测试",
      prompt: buildDetailedSubtaskPrompt("调试前端 UI，并执行浏览器测试和性能验证"),
      skillIds: ["browser-testing-with-devtools"],
      runtime: "valid",
    },
    {
      name: "negative trigger",
      title: "实现并测试功能",
      prompt: buildDetailedSubtaskPrompt("实现并测试功能；documentation-only change"),
      skillIds: ["test-driven-development"],
      runtime: "valid",
    },
    {
      name: "pack unavailable",
      title: "实现并测试 pack 降级",
      prompt: buildDetailedSubtaskPrompt("实现并测试 Skill pack 不可用时的安全降级"),
      skillIds: ["test-driven-development"],
      runtime: "pack-unavailable",
    },
    {
      name: "catalog unavailable",
      title: "实现并测试 catalog 降级",
      prompt: buildDetailedSubtaskPrompt("实现并测试 compact catalog 不可用时的安全降级"),
      skillIds: ["test-driven-development"],
      runtime: "catalog-unavailable",
    },
  ] as const;

  for (const [index, scenario] of scenarios.entries()) {
    const task = api.createLobsterTaskRecord("codex", `实现 fresh snapshot replacement：${scenario.name}`, {
      sessionId: `fresh-snapshot-${index}`,
      taskKind: "development",
    });
    const staleGuidance = `STALE_HOST_GUIDANCE_${index}`;
    lobsterTaskStore.updateLobsterTaskRecord(task.id, {
      activeSubtaskId: "same-subtask",
      activeSubtaskIds: ["same-subtask"],
      subTasks: [{
        id: "same-subtask",
        title: "上一轮子任务",
        prompt: "上一轮子任务提示",
        status: "running",
        skillIds: ["test-driven-development"],
        skillGuidance: staleGuidance,
      }],
      updatedAt: Date.now(),
    });
    const decision = api.normalizeSingleLobsterSubtaskDecision({
      id: "same-subtask",
      title: scenario.title,
      prompt: scenario.prompt,
      ...(scenario.skillIds ? { skillIds: scenario.skillIds } : {}),
    });
    assert.ok(decision, scenario.name);

    const runtime = await api.buildLobsterSkillRuntimeContext(task, 2, {
      extensionRoot: process.cwd(),
      loadSkillPack: scenario.runtime === "pack-unavailable"
        ? async () => ({
            pack: null,
            diagnostics: [{ code: "pack_unavailable", message: "fixture pack unavailable" }],
          })
        : async () => loadedPack,
    });
    const runtimeForDecision = scenario.runtime === "catalog-unavailable"
      ? { ...runtime, compactCatalogSection: undefined, candidateIds: [] }
      : runtime;
    const result = api.applyLobsterMainDecisionForRun(task.id, {
      status: "continue",
      estimatedRemainingRounds: 1,
      subtask: decision,
      subtasks: [decision],
    }, runtimeForDecision);
    const persisted = lobsterTaskStore.readLobsterTaskStore(task.taskStoreFile)
      .tasks.find((item) => item.id === task.id)
      ?.subTasks.find((item) => item.id === "same-subtask");

    assert.equal(result.status, "continue", scenario.name);
    assert.ok(persisted, scenario.name);
    assert.equal(hasOwnProperty(persisted, "skillIds"), false, scenario.name);
    assert.equal(hasOwnProperty(persisted, "skillGuidance"), false, scenario.name);
    assert.doesNotMatch(api.buildLobsterSubtaskModelPrompt(
      task.rootPrompt,
      task,
      2,
      persisted,
    ), new RegExp(staleGuidance, "u"), scenario.name);
  }
});

test("rejects non-allowlisted, main-only, interactive-only and missing-capability Skills without substitution", async () => {
  const api = requireIntegrationApi();
  const task = createTask("development", "restricted-skills-task");
  const runtime = await api.buildLobsterSkillRuntimeContext(task, 1, {
    extensionRoot: process.cwd(),
  });
  const restrictedRuntime = {
    ...runtime,
    candidateIds: [
      "test-driven-development",
      "doubt-driven-development",
      "interview-me",
      "browser-testing-with-devtools",
    ],
  };
  const decisions = [
    api.normalizeSingleLobsterSubtaskDecision({
      id: "allowlist",
      title: "实现并测试功能",
      prompt: buildDetailedSubtaskPrompt("实现 TypeScript 功能并添加测试，验证最终行为"),
      skillIds: ["incremental-implementation", "test-driven-development"],
    }),
    api.normalizeSingleLobsterSubtaskDecision({
      id: "main-only",
      title: "实现架构规划",
      prompt: buildDetailedSubtaskPrompt("规划并实现架构调整，然后进行代码审查"),
      skillIds: ["doubt-driven-development"],
    }),
    api.normalizeSingleLobsterSubtaskDecision({
      id: "interactive",
      title: "规划 API 架构",
      prompt: buildDetailedSubtaskPrompt("通过需求访谈规划 API 架构和任务拆分"),
      skillIds: ["interview-me"],
    }),
    api.normalizeSingleLobsterSubtaskDecision({
      id: "browser",
      title: "调试前端 UI 浏览器测试",
      prompt: buildDetailedSubtaskPrompt("调试前端 UI，并执行浏览器集成测试和性能验证"),
      skillIds: ["browser-testing-with-devtools"],
    }),
  ].filter((item): item is LobsterSubtaskDecision => Boolean(item));
  const diagnosticCodes: string[] = [];
  const snapshots = api.buildLobsterSubtaskSkillSnapshots(
    task,
    decisions,
    restrictedRuntime,
    (_scope, diagnostics) => diagnosticCodes.push(...diagnostics.map((item) => item.code)),
  );

  assert.deepEqual(snapshots.get("allowlist")?.skillIds, ["test-driven-development"]);
  assert.equal(snapshots.has("main-only"), false);
  assert.equal(snapshots.has("interactive"), false);
  assert.equal(snapshots.has("browser"), false);
  assert.ok(diagnosticCodes.includes("skill_not_allowed"));
  assert.ok(diagnosticCodes.includes("skill_role_mismatch"));
  assert.ok(diagnosticCodes.includes("skill_capability_missing"));
});

test("degrades missing resources to legacy behavior without catalog or snapshots", async () => {
  const api = requireIntegrationApi();
  const emptyExtensionRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sinitek-lobster-empty-extension-"));
  const task = createTask("development", "missing-pack-task");
  const diagnosticCodes: string[] = [];
  try {
    const runtime = await api.buildLobsterSkillRuntimeContext(task, 1, {
      extensionRoot: emptyExtensionRoot,
      reportDiagnostics: (_scope, diagnostics) => diagnosticCodes.push(...diagnostics.map((item) => item.code)),
    });
    assert.equal(runtime.pack, null);
    assert.equal(runtime.compactCatalogSection, undefined);
    assert.deepEqual(runtime.candidateIds, []);
    assert.ok(diagnosticCodes.includes("resource_missing") || diagnosticCodes.includes("pack_unavailable"));

    const decision = api.normalizeSingleLobsterSubtaskDecision({
      id: "safe-degrade",
      title: "实现测试",
      prompt: buildDetailedSubtaskPrompt("实现 TypeScript 功能并补充集成测试，确保行为正确"),
      skillIds: ["test-driven-development"],
    });
    assert.ok(decision);
    const snapshots = api.buildLobsterSubtaskSkillSnapshots(task, [decision], runtime);
    assert.equal(snapshots.size, 0);

    const baseline = api.buildLobsterMainModelPrompt(task.rootPrompt, task, 1);
    const degraded = api.buildLobsterMainModelPrompt(
      task.rootPrompt,
      task,
      1,
      undefined,
      runtime.compactCatalogSection,
    );
    assert.equal(degraded, baseline);
    assert.doesNotMatch(degraded, /高级开发 Skill 候选目录|skillIds/u);
  } finally {
    fs.rmSync(emptyExtensionRoot, { recursive: true, force: true });
  }
});

test("round-trips host guidance and reuses the exact snapshot after pack removal on retry", async () => {
  const api = requireIntegrationApi();
  const extensionRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sinitek-lobster-pack-copy-"));
  const copiedPack = path.join(extensionRoot, "media", "loop-workflow-skills");
  fs.mkdirSync(path.dirname(copiedPack), { recursive: true });
  fs.cpSync(path.join(process.cwd(), "media", "loop-workflow-skills"), copiedPack, { recursive: true });
  try {
    const task = createTask("development", "snapshot-retry-task");
    const runtime = await api.buildLobsterSkillRuntimeContext(task, 1, { extensionRoot });
    const decision = api.normalizeSingleLobsterSubtaskDecision({
      id: "retry-subtask",
      title: "实现并测试重试快照",
      prompt: buildDetailedSubtaskPrompt("实现 TypeScript 重试逻辑并添加集成测试，验证资源变化后仍保持同一快照"),
      writeFiles: ["src/retry.ts", "src/test/retry.test.ts"],
      conflictGroup: "retry-runtime",
      skillIds: ["test-driven-development"],
    });
    assert.ok(decision);
    const snapshots = api.buildLobsterSubtaskSkillSnapshots(task, [decision], runtime);
    const batch = api.upsertLobsterSubtasks(task, [decision], snapshots);
    const record = batch.records[0];
    assert.ok(record?.skillGuidance);

    lobsterTaskStore.writeLobsterTaskStore(task.taskStoreFile, {
      tasks: [{ ...task, subTasks: batch.nextSubtasks }],
    });
    const persisted = lobsterTaskStore.readLobsterTaskStore(task.taskStoreFile)
      .tasks[0]?.subTasks.find((item) => item.id === record.id);
    assert.deepEqual(persisted?.skillIds, record.skillIds);
    assert.equal(persisted?.skillGuidance, record.skillGuidance);

    fs.rmSync(copiedPack, { recursive: true, force: true });
    const firstPrompt = api.buildLobsterSubtaskModelPrompt(
      task.rootPrompt,
      task,
      1,
      persisted!,
      0,
      "/tmp/retry-0.md",
    );
    const retryPrompt = api.buildLobsterSubtaskModelPrompt(
      task.rootPrompt,
      task,
      1,
      persisted!,
      1,
      "/tmp/retry-1.md",
    );
    const displayPrompt = api.buildLobsterSubtaskDisplayPrompt(1, persisted!, 1);

    for (const prompt of [firstPrompt, retryPrompt]) {
      assert.equal(countOccurrences(prompt, persisted!.skillGuidance!), 1);
      assert.ok(prompt.indexOf("子任务职责：") < prompt.indexOf(persisted!.skillGuidance!));
      assert.ok(prompt.indexOf(persisted!.skillGuidance!) < prompt.indexOf("当前子任务："));
      assert.match(prompt, /系统\/用户要求.*AGENTS\.md.*writeFiles.*验收.*沟通要求/u);
    }
    assert.doesNotMatch(displayPrompt, /SINITEK_LOOP_SKILL_GUIDANCE|Test-Driven Development/u);
  } finally {
    fs.rmSync(extensionRoot, { recursive: true, force: true });
  }
});
