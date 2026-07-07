import {
  LOBSTER_DEBATE_BLUE_TEAM_ROLE,
  LOBSTER_DEBATE_MAX_BATCH_SPEAKERS,
  LOBSTER_DEBATE_MAX_DIALOGUE_TURNS,
  LOBSTER_DEBATE_MODERATOR_ID,
  LOBSTER_DEBATE_MODERATOR_TITLE,
  LOBSTER_DEBATE_PARTICIPANT_ROLES,
  LOBSTER_DEBATE_RED_TEAM_ROLE,
  formatLobsterGroupChatMemberName,
  type LobsterDebateModeratorDecisionRecord,
  type LobsterDebateParticipantRecord,
  type LobsterDebateParticipantRole,
  type LobsterDebatePaths,
} from "./lobsterDebate";
import {
  getLobsterCommunicationPaths,
  type LobsterMainDecision,
  type LobsterSubtaskRecord,
  type LobsterTaskRecord,
} from "./lobsterTaskStore";

export type LobsterDebateParticipantDefinition = {
  id: string;
  role: LobsterDebateParticipantRole;
  title: string;
  focus: string;
};

export type LobsterDebatePromptTarget = {
  cli: string;
};

export const LOBSTER_DEBATE_MIN_PARTICIPANTS = 2;
export const LOBSTER_DEBATE_MAX_PARTICIPANTS = 6;

export const LOBSTER_DEBATE_SUGGESTED_PARTICIPANTS: ReadonlyArray<LobsterDebateParticipantDefinition> = [
  {
    id: "blue_planner",
    role: LOBSTER_DEBATE_BLUE_TEAM_ROLE,
    title: "蓝队方案方",
    focus: "提出可执行方案，明确目标、约束、成功标准，并主动回应红队质疑。",
  },
  {
    id: "red_attacker",
    role: LOBSTER_DEBATE_RED_TEAM_ROLE,
    title: "红队攻击方",
    focus: "攻击方案假设，寻找目标遗漏、证据不足、边界场景、可行性缺口和不可验证风险。",
  },
  {
    id: "blue_verifier",
    role: LOBSTER_DEBATE_BLUE_TEAM_ROLE,
    title: "蓝队验证方",
    focus: "把蓝队方案补成可验收计划，定义验证方法、证据口径、回退或替代方案。",
  },
  {
    id: "red_edge_cases",
    role: LOBSTER_DEBATE_RED_TEAM_ROLE,
    title: "红队边界方",
    focus: "从边界条件、反例、安全/合规/伦理、成本和长期影响角度继续挑战蓝队方案。",
  },
];

function normalizeLobsterContinuePromptForPrompt(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function formatLobsterEstimatedRemainingRounds(value?: number): string | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  return String(Math.max(0, Math.round(value)));
}

function getLobsterDecisionSubtasks(decision: LobsterMainDecision): import("./lobsterTaskStore").LobsterSubtaskDecision[] {
  if (decision.subtasks?.length) {
    return decision.subtasks;
  }
  return decision.subtask ? [decision.subtask] : [];
}

export function buildLobsterDebateBriefMarkdown(
  task: LobsterTaskRecord,
  target: LobsterDebatePromptTarget,
  round: number,
  paths: LobsterDebatePaths,
  continuePrompt?: string,
): string {
  const communication = getLobsterCommunicationPaths(task.id);
  const normalizedContinuePrompt = normalizeLobsterContinuePromptForPrompt(continuePrompt);
  const lines: string[] = [
    "# Loop 红蓝对抗简报",
    "",
    `- 任务 ID：${task.id}`,
    `- Loop 轮次：${round}`,
    `- 生成时间：${new Date().toISOString()}`,
    `- 任务记录文件：${task.taskStoreFile}`,
    `- 主沟通文件：${task.mainCommunicationFile}`,
    `- 子任务沟通目录：${communication.subtasksDir}`,
    `- 当前 CLI：${target.cli}`,
    `- 执行方式：debate_multi_agent（红蓝对抗）`,
    `- 上一轮 estimatedRemainingRounds：${formatLobsterEstimatedRemainingRounds(task.estimatedRemainingRounds) ?? "未记录"}`,
    `- brief 文件：${paths.briefFile}`,
    `- 群聊记录文件：${paths.chatFile}`,
    `- 最大安全发言批次数：${LOBSTER_DEBATE_MAX_DIALOGUE_TURNS}`,
    `- 裁判主持人角色：${LOBSTER_DEBATE_MODERATOR_TITLE}`,
    "",
    "## 原始目标",
    task.rootPrompt,
    "",
    ...(normalizedContinuePrompt ? [
      "## 本次继续指令",
      normalizedContinuePrompt,
      "",
    ] : []),
    ...(task.supplementalRequirements?.length ? [
      "## 补充需求",
      ...task.supplementalRequirements.map((item, index) => `${index + 1}. ${item}`),
      "",
    ] : []),
    "## 子任务概要",
    ...buildLobsterDebateSubtaskSummaryLines(task),
    "",
    "## 红蓝对抗约束",
    `- 新辩论参与者只能属于蓝队（role=${LOBSTER_DEBATE_BLUE_TEAM_ROLE}）或红队（role=${LOBSTER_DEBATE_RED_TEAM_ROLE}）。`,
    "- 蓝队负责提出可执行方案、补足验收口径、回应红队攻击并修正计划。",
    "- 红队负责攻击蓝队方案，寻找假设漏洞、目标遗漏、证据不足、边界场景、可行性缺口、成本/收益失衡和不可验证风险。",
    "- 如果任务涉及代码、文件、权限、部署或流程执行，红队还应检查写入范围、并发冲突、越权修改、回滚/恢复失败和不可验收的工程风险；不涉及时不要强行套用代码风险。",
    "- 裁判主持人每个批次后读取完整群聊，决定继续追问、收束进入最终立场或阻塞人工复核。",
    `- 裁判主持人每次最多点名 ${LOBSTER_DEBATE_MAX_BATCH_SPEAKERS} 位参与者进入下一批发言；未被点名的角色本批次不得发言。`,
    "- 参与者只能读取可用上下文、任务记录、主沟通文件和子任务沟通目录。",
    "- 参与者只能写入本轮提示词指定的单个 artifact 文件，不得修改工作区内容、任务记录或其他沟通文件。",
    "- 扩展会把每次红蓝发言追加到 chat.md，后续角色必须读取并回应该共享群聊记录。",
    "- 同一发言批次内的参与者可并行执行；扩展会等待本批次全部 artifact 完成后再按清单顺序追加到 chat.md，并启动裁判主持人控场。",
    "- 每个发言批次后由裁判主持人读取 chat.md 并决定 continue / finalize / block；如果继续，必须同时指定下一批发言者。",
    "- 参与者不得直接输出最终 LobsterMainDecision。",
    "- 共识汇总器只能读取 brief、chat.md 和 participant artifacts，负责生成 cross-review.md、consensus.md 和 decision.json。",
    "",
    "## 裁判主持人组队",
    `- 裁判主持人必须先写入红蓝参与者清单：${paths.participantRosterFile}`,
    `- 参与者数量范围：${LOBSTER_DEBATE_MIN_PARTICIPANTS}-${LOBSTER_DEBATE_MAX_PARTICIPANTS}`,
    "- 清单必须至少包含 1 个蓝队和 1 个红队；后续群聊只按裁判主持人选定的参与者推进。",
    "",
    "## 可参考的红蓝原型",
    ...LOBSTER_DEBATE_SUGGESTED_PARTICIPANTS.map((participant) => (
      `- ${participant.id}（${participant.title}）：${participant.focus}`
    )),
  ];
  return `${lines.join("\n")}\n`;
}

export function buildLobsterDebateInitialChatMarkdown(
  task: LobsterTaskRecord,
  target: LobsterDebatePromptTarget,
  round: number,
  paths: LobsterDebatePaths,
): string {
  const lines: string[] = [
    "# Loop 红蓝对抗群聊记录",
    "",
    `- 任务 ID：${task.id}`,
    `- Loop 轮次：${round}`,
    `- 当前 CLI：${target.cli}`,
    `- brief 文件：${paths.briefFile}`,
    `- 红蓝参与者清单文件：${paths.participantRosterFile}`,
    `- 最大安全发言批次数：${LOBSTER_DEBATE_MAX_DIALOGUE_TURNS}`,
    `- 裁判主持人：${formatLobsterGroupChatMemberName(LOBSTER_DEBATE_MODERATOR_TITLE)}`,
    `- 裁判主持人 ID：${LOBSTER_DEBATE_MODERATOR_ID}`,
    "",
    "## 群聊规则",
    "- 每位角色必须读取本文件中已有发言后再输出自己的下一条发言。",
    `- 群聊称呼必须和成员列表名称一致，发言、点名和互相回应时使用 ${formatLobsterGroupChatMemberName("成员名称")} 格式；成员 ID 只用于 JSON、artifact 文件名和调度字段，不作为群聊称呼。`,
    "- 裁判主持人先根据任务目标设计红队和蓝队参与者并写入参与者清单；扩展校验后把参与者动态加入本群聊。",
    "- 蓝队提出和修正方案；红队攻击假设、证据、边界和可验证性；双方必须点名回应对方观点。",
    "- 每个发言批次必须由裁判主持人明确点名 1-3 位发言者；只有被点名的角色才发言。",
    "- 每个发言批次内被点名的动态参与者可以并行运行；扩展等待全部 artifact 完成后按清单顺序追加发言，再由裁判主持人根据完整群聊决定 continue / finalize / block。",
    "- 裁判主持人可以要求继续追问，也可以提前收束，不需要等到最大安全发言批次数。",
    "- 一旦达到最大安全发言批次数，裁判主持人必须收束，运行时不得继续追加讨论。",
    "- 收束后由共识汇总器读取完整群聊和最终立场，生成 cross-review.md、consensus.md 和 decision.json。",
    "",
  ];
  return `${lines.join("\n")}\n`;
}

export function buildLobsterDebateParticipantRosterChatMarkdown(
  participants: readonly LobsterDebateParticipantDefinition[],
  summary: string,
  openingSpeakerIds: readonly string[],
): string {
  const participantById = new Map(participants.map((participant) => [participant.id, participant] as const));
  const openingSpeakerNames = openingSpeakerIds
    .map((speakerId) => participantById.get(speakerId)?.title ?? speakerId)
    .map(formatLobsterGroupChatMemberName);
  const openingLine = openingSpeakerIds.length > 0
    ? `首批点名发言者：${openingSpeakerNames.join("、")}`
    : "首批点名发言者：未指定，运行时将默认由首位蓝队开场。";
  const openingIdLine = openingSpeakerIds.length > 0
    ? `首批点名发言者 ID：${openingSpeakerIds.join("、")}`
    : "首批点名发言者 ID：无";
  const lines: string[] = [
    "",
    "## 任务事件",
    "",
    "裁判主持人已根据任务目标完成红蓝参与者设计。",
    summary ? `组队说明：${summary}` : "组队说明：未提供。",
    openingLine,
    openingIdLine,
    "",
    ...participants.flatMap((participant) => [
      `## 参与者加入：${formatLobsterGroupChatMemberName(participant.title)}`,
      "",
      `成员 ID：${participant.id}`,
      `阵营角色：${participant.role}`,
      `关注重点：${participant.focus}`,
      "",
    ]),
  ];
  return `${lines.join("\n")}\n`;
}

export function buildLobsterDebateChatTurnMarkdown(
  dialogueTurn: number,
  participantId: string,
  participantTitle: string,
  artifactText: string,
): string {
  return [
    "",
    `## 发言：${formatLobsterGroupChatMemberName(participantTitle)}`,
    "",
    `- 成员 ID：${participantId}`,
    `- 群聊发言批次：${dialogueTurn}/${LOBSTER_DEBATE_MAX_DIALOGUE_TURNS}`,
    "",
    artifactText.trim(),
    "",
  ].join("\n");
}

export function buildLobsterDebateModeratorTurnMarkdown(
  dialogueTurn: number,
  artifactText: string,
): string {
  return [
    "",
    `## 主持人控场：${formatLobsterGroupChatMemberName(LOBSTER_DEBATE_MODERATOR_TITLE)}`,
    "",
    `- 成员 ID：${LOBSTER_DEBATE_MODERATOR_ID}`,
    `- 群聊发言批次：${dialogueTurn}/${LOBSTER_DEBATE_MAX_DIALOGUE_TURNS}`,
    "",
    artifactText.trim(),
    "",
  ].join("\n");
}

export function buildLobsterDebateDialogueTurnChatEventMarkdown(
  round: number,
  dialogueTurn: number,
  maxDialogueTurns: number,
  previousDecision: LobsterDebateModeratorDecisionRecord | null,
  currentSpeakers: readonly LobsterDebateParticipantDefinition[],
): string {
  const speakerLine = currentSpeakers.length > 0
    ? `- 本批次点名发言者：${currentSpeakers.map((speaker) => formatLobsterGroupChatMemberName(speaker.title)).join("、")}`
    : "- 本批次点名发言者：未指定";
  const speakerIdLine = currentSpeakers.length > 0
    ? `- 本批次点名发言者 ID：${currentSpeakers.map((speaker) => speaker.id).join("、")}`
    : "- 本批次点名发言者 ID：无";
  const lines = [
    "",
    "## 任务事件",
    "",
    "红蓝对抗发言批次开始。",
    `- 主任务复核轮次：${round}`,
    `- 当前发言批次：${dialogueTurn}`,
    `- 最大安全发言批次数：${maxDialogueTurns}`,
    previousDecision?.nextFocus?.length
      ? `- 裁判主持人上一批次关注点：${previousDecision.nextFocus.join("；")}`
      : "- 裁判主持人上一批次关注点：无",
    speakerLine,
    speakerIdLine,
    "- 本批次被点名参与者可并行执行；同批次成员只应回应本系统消息之前已存在的群聊内容。",
    "- 本批次结束后由裁判主持人决定是否继续、收束或阻塞。",
    "",
  ];
  return lines.join("\n");
}

export function buildLobsterDebateRuntimeForcedFinalizeMarkdown(
  decision: LobsterDebateModeratorDecisionRecord,
): string {
  return [
    "",
    "## 运行时强制收束",
    "",
    `${formatLobsterGroupChatMemberName(LOBSTER_DEBATE_MODERATOR_TITLE)}最终动作：${decision.action}`,
    `${formatLobsterGroupChatMemberName(LOBSTER_DEBATE_MODERATOR_TITLE)}理由：${decision.reason}`,
    "",
  ].join("\n");
}

export function buildLobsterDebateFinalParticipantMarkdown(
  participantId: string,
  participantTitle: string,
  artifactText: string,
): string {
  return [
    "",
    `## 最终立场：${formatLobsterGroupChatMemberName(participantTitle)}`,
    "",
    `- 成员 ID：${participantId}`,
    "",
    artifactText.trim(),
    "",
  ].join("\n");
}

export function buildLobsterDebateDialogueClosedMarkdown(
  completedDialogueTurns: number,
  maxDialogueTurns: number,
  decision: LobsterDebateModeratorDecisionRecord,
): string {
  return [
    "",
    "## 群聊收束",
    "",
    `${formatLobsterGroupChatMemberName(LOBSTER_DEBATE_MODERATOR_TITLE)}最终动作：${decision.action}`,
    `${formatLobsterGroupChatMemberName(LOBSTER_DEBATE_MODERATOR_TITLE)}理由：${decision.reason}`,
    `实际完成发言批次数：${completedDialogueTurns}/${maxDialogueTurns}`,
    decision.nextFocus.length > 0
      ? `下一轮关注点：${decision.nextFocus.join("；")}`
      : "下一轮关注点：无",
    "",
    decision.action === "block"
      ? "裁判主持人已判定当前红蓝攻防无法继续推进到可执行共识，后续只保留人工复核。"
      : "运行时已停止追加新的发言批次，后续由共识汇总器生成 cross-review.md、consensus.md 和 decision.json。",
    "",
  ].join("\n");
}

function buildLobsterDebateSubtaskSummaryLines(task: LobsterTaskRecord): string[] {
  if (!task.subTasks.length) {
    return ["- 尚无子任务记录。"];
  }
  const completed = task.subTasks.filter((subtask) => subtask.status === "completed");
  const running = task.subTasks.filter((subtask) => subtask.status === "running");
  const failed = task.subTasks.filter((subtask) => subtask.status === "blocked" || subtask.status === "skipped");
  const pending = task.subTasks.filter((subtask) => subtask.status === "pending");
  return [
    `- 已完成：${formatLobsterDebateSubtaskList(completed)}`,
    `- 运行中：${formatLobsterDebateSubtaskList(running)}`,
    `- 失败/阻塞：${formatLobsterDebateSubtaskList(failed)}`,
    `- 待处理：${formatLobsterDebateSubtaskList(pending)}`,
  ];
}

function formatLobsterDebateSubtaskList(subtasks: LobsterSubtaskRecord[]): string {
  if (subtasks.length === 0) {
    return "无";
  }
  return subtasks.map((subtask) => {
    const summary = subtask.summary ? `（${subtask.summary.slice(0, 120)}）` : "";
    return `${subtask.id}:${subtask.title}${summary}`;
  }).join("；");
}

export function buildLobsterDebateParticipantDisplayPrompt(
  round: number,
  dialogueTurn: number,
  title: string,
  finalPass: boolean,
): string {
  return finalPass
    ? `Loop 辩论第 ${round} 轮最终立场：${title}`
    : `Loop 辩论第 ${round} 轮群聊 ${dialogueTurn}/${LOBSTER_DEBATE_MAX_DIALOGUE_TURNS}：${title}`;
}

export function buildLobsterDebateParticipantRosterModelPrompt(
  task: LobsterTaskRecord,
  round: number,
  paths: LobsterDebatePaths,
): string {
  const suggestedParticipants = LOBSTER_DEBATE_SUGGESTED_PARTICIPANTS
    .map((participant) => `- ${participant.id}（${participant.title}，${participant.role}）：${participant.focus}`)
    .join("\n");
  return [
    "你正在执行 VS Code 插件的 Loop 模式红蓝对抗裁判主持人组队阶段。",
    "注意：这是单独新会话，不具备主任务对话上下文；只能依赖本提示词、brief、任务记录和沟通文件。",
    "你的职责是先判断本轮红蓝对抗需要哪些蓝队和红队参与者，再写出动态参与者清单。后续群聊将只按你的清单推进。",
    `Loop 任务 ID：${task.id}`,
    `当前轮次：${round}`,
    `任务记录文件：${task.taskStoreFile}`,
    `brief 文件：${paths.briefFile}`,
    `群聊记录文件：${paths.chatFile}`,
    `红蓝参与者清单 artifact：${paths.participantRosterFile}`,
    `主沟通文件：${task.mainCommunicationFile}`,
    `子任务沟通目录：${getLobsterCommunicationPaths(task.id).subtasksDir}`,
    "",
    "职责和限制：",
    "1. 只能读取 brief、任务记录、主沟通文件、子任务沟通目录和必要上下文；不得修改工作区内容或任务记录。",
    "2. 只能写入参与者清单 artifact；不要直接修改 chat.md、participants/*.md、cross-review.md、consensus.md 或 decision.json。",
    `3. 必须设计 ${LOBSTER_DEBATE_MIN_PARTICIPANTS}-${LOBSTER_DEBATE_MAX_PARTICIPANTS} 个参与者。复杂任务可更多，简单任务可更少。`,
    "4. 必须至少包含 1 个蓝队和 1 个红队。蓝队负责提出、捍卫和修正方案；红队负责攻击假设、目标覆盖、证据链、边界和可验证性，暴露阻塞风险。",
    "5. 参与者 id 必须唯一，只能使用小写字母、数字、下划线、点、短横线，且不能使用 moderator 或 consensus。",
    `6. 新清单中的 role 只能取：${LOBSTER_DEBATE_BLUE_TEAM_ROLE} / ${LOBSTER_DEBATE_RED_TEAM_ROLE}。${LOBSTER_DEBATE_PARTICIPANT_ROLES.filter((role) => role !== LOBSTER_DEBATE_BLUE_TEAM_ROLE && role !== LOBSTER_DEBATE_RED_TEAM_ROLE).join(" / ")} 仅用于兼容旧任务记录，不要新写。`,
    "7. 不要机械固定使用通用架构/实现/测试/风险四人；专业维度应写入 title 和 focus，但 role 必须体现红队或蓝队阵营。",
    "",
    "可参考的红蓝参与者原型（只是参考，不是固定名单）：",
    suggestedParticipants,
    "",
    "artifact 必须包含以下固定小节，标题必须完全一致：",
    "## 组队说明",
    "说明为什么这样配置蓝队和红队，以及每个参与者在攻防中的职责。",
    "",
    "## JSON",
    "必须提供一个 JSON 代码块，结构如下。participants 数量必须在允许范围内；openingSpeakerIds 用于指定首批由主持人点名发言的 1-3 位参与者，通常应先由蓝队开场。",
    `{"artifactFile":${JSON.stringify(paths.participantRosterFile)},"summary":"红蓝组队摘要","openingSpeakerIds":["blue_planner"],"participants":[{"id":"blue_planner","role":"${LOBSTER_DEBATE_BLUE_TEAM_ROLE}","title":"蓝队方案方","focus":"提出可执行方案并回应红队攻击"},{"id":"red_attacker","role":"${LOBSTER_DEBATE_RED_TEAM_ROLE}","title":"红队攻击方","focus":"寻找假设漏洞、证据缺口、边界条件和阻塞风险"}]}`,
    "",
    "原始目标：",
    task.rootPrompt,
  ].join("\n");
}

export function buildLobsterDebateParticipantModelPrompt(
  task: LobsterTaskRecord,
  round: number,
  dialogueTurn: number,
  maxDialogueTurns: number,
  finalPass: boolean,
  paths: LobsterDebatePaths,
  participant: LobsterDebateParticipantDefinition,
  artifactFile: string,
  moderatorDecision: LobsterDebateModeratorDecisionRecord | null,
): string {
  const turnPurpose = finalPass
    ? "裁判主持人收束后的最终立场"
    : `第 ${dialogueTurn} 个发言批次的开场或交叉攻防`;
  const teamGuidance = participant.role === LOBSTER_DEBATE_BLUE_TEAM_ROLE
    ? [
        "你是蓝队：负责提出、捍卫和修正方案，主动回应红队攻击，并把可执行性、约束、验收口径和证据要求说清楚。",
      ]
    : [
        "你是红队：负责攻击蓝队方案，专门寻找假设漏洞、目标遗漏、证据不足、边界场景、可行性缺口、成本/收益失衡和不可验证风险。",
        "如果本任务涉及代码、文件、权限、部署或流程执行，再额外检查写入范围、并发冲突、越权修改、回滚/恢复失败和工程验收风险；不涉及时不要强行套用代码风险。",
      ];
  const finalTurnSections = [
    "## 立场",
    "只能写一个值：agree / agree_with_reservations / block。可以在下一行补充一句理由。",
    "",
    "## 建议规划",
    "给出你认可的阶段规划或修正建议。",
    "",
    "## 子任务建议",
    "列出建议派发的子任务，说明每个子任务的目标、范围、依赖和交付证据；只有涉及文件修改时才说明预期写入文件。",
    "",
    "## 依赖与冲突判断",
    "判断哪些子任务可以并行推进，哪些必须串行，以及原因；只有涉及代码、文件、权限或流程执行时才讨论写入冲突、越权修改或恢复风险。",
    "",
    "## 验收标准",
    "列出完成或继续派发前必须满足的验证与证据。",
    "",
    "## 阻塞性异议",
    "没有阻塞性异议时写“无”。有阻塞性异议时逐条列出，并保持立场为 block。",
  ];
  const moderatorGuidance = moderatorDecision
    ? [
      "",
      "## 裁判主持人控场摘要",
      `- 裁判主持人动作：${moderatorDecision.action}`,
      `- 裁判主持人理由：${moderatorDecision.reason}`,
      moderatorDecision.nextFocus.length > 0
        ? `- 下一批次关注点：${moderatorDecision.nextFocus.join("；")}`
        : "- 下一批次关注点：无",
    ]
    : [];
  return [
    "你正在执行 VS Code 插件的 Loop 模式红蓝对抗参与者。",
    "注意：这是单独新会话，不具备主任务对话上下文；只能依赖本提示词、brief、任务记录和沟通文件。",
    "注意：这是一个受控模拟群聊。你必须读取 chat.md 中已经出现的发言，然后以自己的蓝队或红队身份继续发言。",
    "注意：同一发言批次内的参与者可能并行执行；你只能回应 chat.md 中在本次启动前已经存在的内容，不要假设能读到同批次其他参与者尚未落盘的发言。",
    `Loop 任务 ID：${task.id}`,
    `当前轮次：${round}`,
    finalPass
      ? "本次阶段：裁判主持人收束后的最终立场收集"
      : `当前发言批次：${dialogueTurn}，最大安全上限：${maxDialogueTurns}`,
    `本轮目的：${turnPurpose}`,
    `参与者 ID：${participant.id}`,
    `参与者名称：${participant.title}`,
    `群聊称呼：${formatLobsterGroupChatMemberName(participant.title)}`,
    `关注重点：${participant.focus}`,
    `任务记录文件：${task.taskStoreFile}`,
    `brief 文件：${paths.briefFile}`,
    `群聊记录文件：${paths.chatFile}`,
    `主沟通文件：${task.mainCommunicationFile}`,
    `子任务沟通目录：${getLobsterCommunicationPaths(task.id).subtasksDir}`,
    `你的 artifact 文件：${artifactFile}`,
    ...moderatorGuidance,
    "",
    "职责和限制：",
    ...teamGuidance,
    "1. 你只做攻防/规划/审查/验收判断，不直接修改工作区内容，不更新任务记录。",
    "2. 你必须读取 brief、chat.md，并按需要读取任务记录、主沟通文件、子任务沟通目录和仓库现状。",
    "3. 你只能写入上面指定的 artifact 文件；不要直接修改 chat.md、cross-review.md、consensus.md 或 decision.json。",
    "4. 你不能直接输出最终 LobsterMainDecision JSON；最终决策由共识汇总器在读取完整群聊后生成。",
    `5. 你必须点名回应 chat.md 中至少一个已经发言的其他角色；点名时使用 ${formatLobsterGroupChatMemberName("成员名称")}，不要用英文成员 ID 作为称呼；蓝队优先回应红队攻击点，红队优先继续攻击蓝队尚未修正的方案。`,
    `6. 群聊运行时最大安全上限为 ${maxDialogueTurns} 个发言批次。只有被裁判主持人本批次明确点名的角色才应发言；达到安全上限时必须收束，不得继续追加辩论。`,
    "7. 如果发现会导致目标无法满足、证据不足、验收不可判定、风险无法接受的问题，红队应明确指出阻塞项；蓝队若能修正则改为 agree_with_reservations，否则最终立场必须使用 block。",
    "8. 只有在任务确实涉及代码、文件、权限、部署或流程执行时，才把越权写入、并发冲突、恢复失败等工程问题作为阻塞项。",
    "",
    "artifact 必须包含以下固定小节，标题必须完全一致：",
    "## 群聊发言",
    "用你的角色身份发言，必须结合 brief 和 chat.md 中已有内容。",
    "",
    "## 点名回应",
    `列出你回应了哪些角色的哪些观点；角色称呼必须使用 ${formatLobsterGroupChatMemberName("成员名称")}；若暂无其他角色发言，写“暂无，作为首位发言者开场”。`,
    "",
    "## 追问或修正",
    "给出你希望其他角色注意的问题、风险或修正建议；没有则写“无”。",
    "",
    ...(finalPass ? finalTurnSections : [
      "## 暂定立场",
      "只能写一个值：agree / agree_with_reservations / block，并补充一句原因。非最终轮的暂定立场不会直接用于派发子任务。",
    ]),
    "",
    "原始目标：",
    task.rootPrompt,
  ].join("\n");
}

export function buildLobsterDebateModeratorDisplayPrompt(
  round: number,
  dialogueTurn: number,
  maxDialogueTurns: number,
): string {
  return `Loop 红蓝对抗第 ${round} 轮裁判控场：发言批次 ${dialogueTurn}/${maxDialogueTurns}`;
}

export function buildLobsterDebateModeratorModelPrompt(
  task: LobsterTaskRecord,
  round: number,
  dialogueTurn: number,
  maxDialogueTurns: number,
  paths: LobsterDebatePaths,
  artifactFile: string,
): string {
  const atSafetyLimit = dialogueTurn >= maxDialogueTurns;
  return [
    "你正在执行 VS Code 插件的 Loop 模式红蓝对抗裁判主持人。",
    "注意：这是单独新会话，不具备主任务对话上下文；只能依赖本提示词、brief、任务记录和沟通文件。",
    "你的职责不是重新规划，而是主持红蓝攻防：总结蓝队方案、红队攻击点和双方回应，判断是否还需要追加一个发言批次追问，或是否可以收束进入最终立场。",
    `Loop 任务 ID：${task.id}`,
    `当前轮次：${round}`,
    `当前发言批次：${dialogueTurn}`,
    `最大安全发言批次数：${maxDialogueTurns}`,
    `是否达到最大安全发言批次数：${atSafetyLimit ? "是" : "否"}`,
    `任务记录文件：${task.taskStoreFile}`,
    `brief 文件：${paths.briefFile}`,
    `群聊记录文件：${paths.chatFile}`,
    `主沟通文件：${task.mainCommunicationFile}`,
    `子任务沟通目录：${getLobsterCommunicationPaths(task.id).subtasksDir}`,
    `你的 artifact 文件：${artifactFile}`,
    "",
    "职责和限制：",
    "1. 只能读取 brief、chat.md、任务记录、主沟通文件、子任务沟通目录和必要上下文；不得修改工作区内容或任务记录。",
    "2. 只能写入上面指定的裁判主持人 artifact 文件；不要直接修改 chat.md、participants/*.md、cross-review.md、consensus.md 或 decision.json。",
    "3. 必须基于 chat.md 中已有红蓝发言做控场，不要脱离已有讨论重写方案。",
    "4. action=continue 表示红队提出了具体攻击点且蓝队尚未充分回应，或蓝队提出新方案但红队尚未攻击，需要再追加一个由你点名的发言批次。",
    "5. action=finalize 表示蓝队方案已经被红队充分攻击且关键攻击点已被回应，下一步应收集最终立场并交给共识汇总器生成 decision.json。",
    "6. action=block 表示红队指出的阻塞问题无法通过蓝队修正、补充证据、前置步骤或验收标准化解，必须进入人工复核。",
    `7. 如果当前发言批次已经达到最大安全上限 ${maxDialogueTurns}/${maxDialogueTurns}，不得输出 action=continue，只能输出 finalize 或 block。`,
    "8. 有红队提出 block 时，不要立即阻塞；先判断蓝队是否有机会通过下一批次回应、补充证据、前置步骤或验收标准化解。无法化解时再 block。",
    `9. 群聊称呼必须和成员列表名称一致；写点名追问、群聊态势和理由时使用 ${formatLobsterGroupChatMemberName("成员名称")}，不要用英文成员 ID 作为称呼。`,
    "",
    "artifact 必须包含以下固定小节，标题必须完全一致：",
    "## 群聊态势",
    "用简短段落总结蓝队方案、红队攻击点、已化解问题和未回答问题。",
    "",
    "## 点名追问",
    `如果 action=continue，列出下一批次需要蓝队或红队回答什么问题；成员称呼使用 ${formatLobsterGroupChatMemberName("成员名称")}；如果不继续，写“无”。`,
    "",
    "## 下一批发言者",
    `如果 action=continue，列出 1-${LOBSTER_DEBATE_MAX_BATCH_SPEAKERS} 个下一批被点名发言的参与者 id，每行一个；如果不继续，写“无”。`,
    "",
    "## 主持人决策",
    "只能写一个值：continue / finalize / block。",
    "",
    "## 理由",
    "解释为什么继续、收束或阻塞。",
    "",
    "## 下一轮关注点",
    "action=continue 时列出 1~5 条下一轮要聚焦的问题；否则写“无”。",
    "",
    "## JSON",
    "必须提供一个 JSON 代码块，结构如下。action 只能是 continue / finalize / block；action=continue 时 nextSpeakerIds 必须给出 1-3 个下一批发言者 id。",
    '{"artifactFile":"<moderator artifact path>","dialogueTurn":1,"action":"continue","reason":"原因","nextSpeakerIds":["blue_planner"],"nextFocus":["下一轮关注点"]}',
    "",
    "原始目标：",
    task.rootPrompt,
  ].join("\n");
}

export function buildLobsterDebateConsensusModelPrompt(
  task: LobsterTaskRecord,
  round: number,
  paths: LobsterDebatePaths,
  participants: LobsterDebateParticipantRecord[],
): string {
  const participantFiles = participants.map((participant) => `- ${participant.id}：${participant.artifactFile}`).join("\n");
  return [
    "你正在执行 VS Code 插件的 Loop 模式红蓝对抗共识汇总。",
    "你是受约束的汇总器，不是单独规划者；不得绕过或覆盖红队 artifact 中的阻塞性异议，也不得忽略蓝队已给出的修正方案。",
    `Loop 任务 ID：${task.id}`,
    `当前轮次：${round}`,
    `任务记录文件：${task.taskStoreFile}`,
    `brief 文件：${paths.briefFile}`,
    `群聊记录文件：${paths.chatFile}`,
    `cross-review 输出文件：${paths.crossReviewFile}`,
    `consensus 输出文件：${paths.consensusFile}`,
    `decision 输出文件：${paths.decisionFile}`,
    "",
    "必须读取的参与者 artifact：",
    participantFiles,
    "",
    "职责和限制：",
    "1. 只能读取 brief.md、chat.md、所有最终 participants/*.md，以及 brief 中指向的任务记录/沟通文件；不要修改工作区内容或任务记录。",
    "2. 必须生成 cross-review.md、consensus.md 和 decision.json 三个文件。",
    "3. 如果任一动态参与者 artifact 缺失、存在未解决 blocking disagreement、或你无法生成合法 LobsterMainDecision，则 decision.json 必须走 blocked 路径，不得派发子任务。",
    "4. 红队 artifact 的原始立场为 block 时，必须先判断阻塞项是否已被蓝队回应并能被本轮计划解决：如果能通过补充证据、前置步骤、验收标准或风险说明解决，必须写入 resolvedDisagreements，并可在 consensus 的 participantStances 中把该红队最终立场标为 agree_with_reservations；如果不能解决，必须保留 stance=block 或 openDisagreements.severity=blocking。",
    "5. status=continue 时必须提供 1~6 个 subtasks；每个 subtask 的 prompt 必须自包含，且至少说明背景目标、只读/写范围、执行步骤、验收标准、任务记录和沟通文件要求。",
    "6. chat.md 已包含裁判主持人控场与收束标记，不允许要求继续追加辩论回合；如果红蓝攻防后仍无法形成可执行共识，必须输出 blocked。",
    "7. 不允许输出 continue 但不给 subtasks；不确定时输出 blocked。",
    "",
    "cross-review.md 内容要求：",
    "- 按群聊时间线总结蓝队方案、红队攻击和互相回应。",
    "- 对比所有红蓝参与者的最终观点。",
    "- 列出已解决分歧和未解决分歧。",
    "- 标明是否存在阻塞性异议。",
    "",
    "consensus.md 必须包含一个 JSON 代码块，结构如下：",
    `{"artifactFile":"<consensus.md path>","reached":true,"summary":"红蓝共识摘要","participantStances":[{"participantId":"blue_planner","stance":"agree","note":"蓝队方案已修正"},{"participantId":"red_attacker","stance":"agree_with_reservations","note":"红队攻击点已转为验收标准"}],"resolvedDisagreements":[{"id":"d1","title":"红队攻击点标题","participants":["blue_planner","red_attacker"],"severity":"non_blocking","resolution":"解决方式"}],"openDisagreements":[{"id":"d2","title":"未解决阻塞点","participants":["red_attacker"],"severity":"blocking","resolution":"未解决原因"}]}`,
    "",
    "decision.json 必须是纯 JSON 对象，符合现有 LobsterMainDecision 协议：",
    '{"status":"completed","estimatedRemainingRounds":0,"answerConclusion":"直接回答用户原始问题的简短结论","finalSummary":"整体完成说明","requirementCoverage":[{"name":"用户需求A","passed":true,"detail":"覆盖说明"}],"roundSummaries":[{"round":1,"subtaskId":"stable-id","title":"子任务标题","summary":"本轮完成内容摘要"}],"acceptance":{"passed":true,"summary":"验收通过说明","checks":[{"name":"目标覆盖","passed":true,"detail":"..."}]}}',
    '{"status":"continue","estimatedRemainingRounds":2,"acceptance":{"passed":false,"summary":"未通过原因","checks":[{"name":"缺口项","passed":false,"detail":"..."}]},"parallelReason":"这些子任务预计写入文件互不重叠、没有先后依赖，可以并发","subtasks":[{"id":"stable-id-a","title":"子任务A标题","conflictGroup":"src-a","writeFiles":["src/a.ts"],"prompt":"给子任务A执行的完整指令，必须限定只修改 writeFiles 声明的文件或明确授权范围"}]}',
    '{"status":"blocked","estimatedRemainingRounds":0,"finalSummary":"阻塞原因"}',
    "status=completed 时 answerConclusion 必须直接回答用户原始问题，finalSummary 用于整体任务完成说明。",
    "",
    "原始目标：",
    task.rootPrompt,
  ].join("\n");
}
