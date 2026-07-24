import type { AppLocale } from "../i18n";
import type {
  GraphAcceptanceCheck,
  GraphEdgeKind,
  GraphNodeKind,
  GraphNodeStatus,
  GraphOwnerRole,
  GraphRunStatus,
} from "../graph/types";
import type { GraphRunPanelState } from "./graphRunPanelTypes";

const STRINGS = {
  en: {
    title: "Graph Run",
    runSubtitle: "{status} · {cli}",
    refresh: "Refresh",
    continueRun: "Continue",
    supplementRun: "I want to speak",
    supplementRunTitle: "Send a supplemental message to this Graph run",
    supplementDialogTitle: "Speak in Graph run",
    supplementDialogDescription: "Send a supplemental message to this Graph run. Later nodes must read it before executing.",
    supplementPromptLabel: "Message",
	    supplementPromptDefault: "",
	    supplementPromptRequired: "Enter a message.",
	    supplementConfirm: "Confirm",
	    supplementCancel: "Cancel",
	    retryNode: "Retry Failed Node",
	    feedbackNode: "Rollback Upstream",
	    approveHumanGate: "Approve Human Gate",
    stopRun: "Stop Run",
    nodeActions: "Node Actions",
    graphView: "Graph",
    graphViewDescription: "Visual DAG of nodes and dependencies.",
    selectedNode: "Selected Node",
    keyboardHint: "Tab to focus nodes. Press Enter or Space to select.",
    noEdges: "No active edges are recorded.",
    graphNodeAria: "Node {title}, status {status}, kind {kind}, attempts {attempts}, depends on {dependsCount}, unlocks {unlocksCount}",
    graphEdgeAria: "{from} to {to}, {kind}",
    details: "Node Details",
    status: "Status",
    cli: "CLI",
    nodeId: "Node ID",
    kind: "Kind",
    ownerRole: "Owner",
    attempts: "Attempts",
    dependsOn: "Depends On",
    unlocks: "Unlocks",
    writeFiles: "Write Files",
    conflictGroup: "Conflict Group",
    promptRef: "Prompt Ref",
    artifactRef: "Artifact Ref",
    communicationFile: "Communication File",
    startedAt: "Started",
    completedAt: "Completed",
    wakeAt: "Wake At",
    lastError: "Last Error",
    acceptance: "Acceptance",
    supplementalRequirements: "Supplemental Messages",
    noNodes: "No Graph nodes are recorded.",
    noSelection: "Select a node to inspect details.",
    none: "None",
    unknownTime: "Unknown",
    statusDraft: "Draft",
    statusRunning: "Running",
    statusSleeping: "Sleeping",
    statusNeedsReview: "Needs Review",
    statusCompleted: "Completed",
    statusError: "Error",
    statusStopped: "Stopped",
    nodeStatusPending: "Pending",
    nodeStatusReady: "Ready",
    nodeStatusRunning: "Running",
    nodeStatusSleeping: "Sleeping",
    nodeStatusPassed: "Passed",
    nodeStatusFailed: "Failed",
    nodeStatusBlocked: "Blocked",
    nodeStatusSkipped: "Skipped",
    nodeStatusStopped: "Stopped",
    kindIntake: "Intake",
    kindPlan: "Plan",
    kindImplement: "Implement",
    kindTest: "Test",
    kindReview: "Review",
    kindDebate: "Debate",
    kindHumanGate: "Human Gate",
    kindMerge: "Merge",
    kindSleep: "Sleep",
    kindSummary: "Summary",
    roleMain: "Main",
    roleSubtask: "Subtask",
    roleReviewer: "Reviewer",
    roleModerator: "Moderator",
    roleHuman: "Human",
    roleSystem: "System",
    edgeKindDependsOn: "Depends On",
    edgeKindIfPass: "If Pass",
    edgeKindIfFail: "If Fail",
    edgeKindReviewFeedback: "Review Feedback",
    edgeKindConflictsWith: "Conflicts With",
    edgeKindEvidenceFor: "Evidence For",
    edgeKindHumanApproved: "Human Approved",
  },
  "zh-CN": {
    title: "Graph 运行图",
    runSubtitle: "{status} · {cli}",
    refresh: "刷新",
    continueRun: "继续",
    supplementRun: "我要说话",
    supplementRunTitle: "向当前 Graph 运行发送补充消息",
    supplementDialogTitle: "在 Graph 运行中说话",
    supplementDialogDescription: "向当前 Graph 运行发送补充消息。后续节点执行前必须读取这段内容。",
    supplementPromptLabel: "消息内容",
	    supplementPromptDefault: "",
	    supplementPromptRequired: "请输入消息内容。",
	    supplementConfirm: "确认",
	    supplementCancel: "取消",
	    retryNode: "重试失败节点",
	    feedbackNode: "回退上游返工",
	    approveHumanGate: "批准人工关卡",
    stopRun: "中止运行",
    nodeActions: "节点操作",
    graphView: "可视图",
    graphViewDescription: "节点与依赖的可视 DAG。",
    selectedNode: "已选节点",
    keyboardHint: "按 Tab 聚焦节点，按 Enter 或空格选择。",
    noEdges: "暂无活动边。",
    graphNodeAria: "节点 {title}，状态 {status}，类型 {kind}，尝试 {attempts}，依赖 {dependsCount}，解锁 {unlocksCount}",
    graphEdgeAria: "{from} 到 {to}，{kind}",
    details: "节点详情",
    status: "状态",
    cli: "CLI",
    nodeId: "节点 ID",
    kind: "类型",
    ownerRole: "负责人",
    attempts: "尝试次数",
    dependsOn: "依赖",
    unlocks: "解锁",
    writeFiles: "授权文件",
    conflictGroup: "冲突组",
    promptRef: "Prompt 引用",
    artifactRef: "产物引用",
    communicationFile: "沟通文件",
    startedAt: "开始时间",
    completedAt: "完成时间",
    wakeAt: "唤醒时间",
    lastError: "最近错误",
    acceptance: "验收项",
    supplementalRequirements: "补充消息",
    noNodes: "暂无 Graph 节点记录。",
    noSelection: "选择一个节点查看详情。",
    none: "无",
    unknownTime: "未知",
    statusDraft: "草稿",
    statusRunning: "执行中",
    statusSleeping: "睡眠中",
    statusNeedsReview: "待复核",
    statusCompleted: "已完成",
    statusError: "错误",
    statusStopped: "已停止",
    nodeStatusPending: "待执行",
    nodeStatusReady: "就绪",
    nodeStatusRunning: "执行中",
    nodeStatusSleeping: "睡眠中",
    nodeStatusPassed: "已通过",
    nodeStatusFailed: "失败",
    nodeStatusBlocked: "阻塞",
    nodeStatusSkipped: "已跳过",
    nodeStatusStopped: "已停止",
    kindIntake: "录入",
    kindPlan: "计划",
    kindImplement: "实现",
    kindTest: "测试",
    kindReview: "评审",
    kindDebate: "辩论",
    kindHumanGate: "人工关卡",
    kindMerge: "合并",
    kindSleep: "睡眠",
    kindSummary: "总结",
    roleMain: "主任务",
    roleSubtask: "子任务",
    roleReviewer: "评审者",
    roleModerator: "主持人",
    roleHuman: "人工",
    roleSystem: "系统",
    edgeKindDependsOn: "依赖",
    edgeKindIfPass: "通过时",
    edgeKindIfFail: "失败时",
    edgeKindReviewFeedback: "评审反馈",
    edgeKindConflictsWith: "冲突",
    edgeKindEvidenceFor: "证据",
    edgeKindHumanApproved: "人工批准",
  },
} as const;

export type GraphRunPanelStrings = Record<keyof typeof STRINGS.en, string>;

export function getGraphRunPanelStrings(locale: AppLocale): GraphRunPanelStrings {
  return locale === "zh-CN" ? STRINGS["zh-CN"] : STRINGS.en;
}

export function buildGraphRunPanelTitle(
  state: GraphRunPanelState,
  strings: GraphRunPanelStrings,
): string {
  const runId = state.run.id.trim();
  if (!runId) {
    return strings.title;
  }
  return `${strings.title}: ${runId.length > 12 ? runId.slice(0, 12) : runId}`;
}

export function formatGraphRunStatus(status: GraphRunStatus, strings: GraphRunPanelStrings): string {
  const keyByStatus: Record<GraphRunStatus, keyof GraphRunPanelStrings> = {
    draft: "statusDraft",
    running: "statusRunning",
    sleeping: "statusSleeping",
    "needs-review": "statusNeedsReview",
    completed: "statusCompleted",
    error: "statusError",
    stopped: "statusStopped",
  };
  return strings[keyByStatus[status]] ?? status;
}

export function formatGraphNodeStatus(status: GraphNodeStatus, strings: GraphRunPanelStrings): string {
  const keyByStatus: Record<GraphNodeStatus, keyof GraphRunPanelStrings> = {
    pending: "nodeStatusPending",
    ready: "nodeStatusReady",
    running: "nodeStatusRunning",
    sleeping: "nodeStatusSleeping",
    passed: "nodeStatusPassed",
    failed: "nodeStatusFailed",
    blocked: "nodeStatusBlocked",
    skipped: "nodeStatusSkipped",
    stopped: "nodeStatusStopped",
  };
  return strings[keyByStatus[status]] ?? status;
}

export function formatGraphNodeKind(kind: GraphNodeKind, strings: GraphRunPanelStrings): string {
  const keyByKind: Record<GraphNodeKind, keyof GraphRunPanelStrings> = {
    intake: "kindIntake",
    plan: "kindPlan",
    implement: "kindImplement",
    test: "kindTest",
    review: "kindReview",
    debate: "kindDebate",
    human_gate: "kindHumanGate",
    merge: "kindMerge",
    sleep: "kindSleep",
    summary: "kindSummary",
  };
  return strings[keyByKind[kind]] ?? kind;
}

export function formatGraphOwnerRole(role: GraphOwnerRole, strings: GraphRunPanelStrings): string {
  const keyByRole: Record<GraphOwnerRole, keyof GraphRunPanelStrings> = {
    main: "roleMain",
    subtask: "roleSubtask",
    reviewer: "roleReviewer",
    moderator: "roleModerator",
    human: "roleHuman",
    system: "roleSystem",
  };
  return strings[keyByRole[role]] ?? role;
}

export function formatGraphEdgeKind(kind: GraphEdgeKind, strings: GraphRunPanelStrings): string {
  const keyByKind: Record<GraphEdgeKind, keyof GraphRunPanelStrings> = {
    depends_on: "edgeKindDependsOn",
    if_pass: "edgeKindIfPass",
    if_fail: "edgeKindIfFail",
    review_feedback: "edgeKindReviewFeedback",
    conflicts_with: "edgeKindConflictsWith",
    evidence_for: "edgeKindEvidenceFor",
    human_approved: "edgeKindHumanApproved",
  };
  return strings[keyByKind[kind]] ?? kind;
}

export function formatGraphAcceptance(
  acceptance: readonly GraphAcceptanceCheck[],
  strings: GraphRunPanelStrings,
): string {
  if (!acceptance.length) {
    return strings.none;
  }
  return acceptance
    .map((item) => {
      const prefix = item.required === false ? "" : "* ";
      const passed = item.passed === true ? " [passed]" : item.passed === false ? " [failed]" : "";
      const detail = item.detail ? ` - ${item.detail}` : "";
      const evidence = item.evidenceRef ? ` (${item.evidenceRef})` : "";
      return `${prefix}${item.name}${passed}${detail}${evidence}`;
    })
    .join("\\n");
}

export function interpolateGraphRunPanelString(
  template: string,
  params: Record<string, string>,
): string {
  return template.replace(/\{(\w+)\}/g, (match, key) => params[key] ?? match);
}
