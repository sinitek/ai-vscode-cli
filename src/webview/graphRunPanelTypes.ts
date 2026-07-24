import type {
  GraphAcceptanceCheck,
  GraphEventRecord,
  GraphFinalAnswer,
  GraphEdgeKind,
  GraphNodeKind,
  GraphNodeStatus,
  GraphOwnerRole,
  GraphRunStatus,
} from "../graph/types";

export type GraphRunPanelStatusCount = {
  status: GraphNodeStatus;
  label: string;
  count: number;
};

export type GraphRunPanelNode = {
  id: string;
  title: string;
  kind: GraphNodeKind;
  kindLabel: string;
  status: GraphNodeStatus;
  statusLabel: string;
  ownerRole: GraphOwnerRole;
  ownerRoleLabel: string;
  attempts: number;
  maxAttempts: number;
  dependsOn: string[];
  unlocks: string[];
  writeFiles: string[];
  conflictGroup?: string;
  promptRef?: string;
  artifactRef?: string;
  communicationFile?: string;
  startedAt?: number;
  completedAt?: number;
  wakeAt?: number;
  lastError?: string;
  acceptance: GraphAcceptanceCheck[];
	  control: {
	    canRetry: boolean;
	    canFeedback: boolean;
	    canApprove: boolean;
	  };
	};

export type GraphRunPanelEdge = {
  id: string;
  from: string;
  to: string;
  kind: GraphEdgeKind;
  kindLabel: string;
  active: boolean;
  fromTitle: string;
  toTitle: string;
  condition?: string;
};

export type GraphRunPanelEvent = Pick<
  GraphEventRecord,
  "eventId" | "runId" | "type" | "timestamp" | "nodeId" | "attempt" | "summary" | "error"
>;

export type GraphRunPanelState = {
  run: {
    id: string;
    cli: string;
    status: GraphRunStatus;
    statusLabel: string;
    rootPrompt: string;
    supplementalRequirements: string[];
    createdAt: number;
    updatedAt: number;
    runStoreFile: string;
    graphFile: string;
    eventsFile: string;
    communicationDir: string;
    mainCommunicationFile: string;
      finalAnswer?: GraphFinalAnswer;
  };
  runControl: {
    canContinue: boolean;
    canSupplement: boolean;
    canStop: boolean;
  };
  stats: {
    total: number;
    statusCounts: GraphRunPanelStatusCount[];
  };
  nodes: GraphRunPanelNode[];
  edges: GraphRunPanelEdge[];
  selectedNodeId: string | null;
  selectedNode: GraphRunPanelNode | null;
  events: GraphRunPanelEvent[];
  error?: string | null;
};

export type GraphRunPanelMessage =
  | { type: "graphRun:refresh"; selectedNodeId?: string | null }
  | { type: "graphRun:continue"; selectedNodeId?: string | null }
	  | { type: "graphRun:supplementRun"; prompt: string; selectedNodeId?: string | null }
	  | { type: "graphRun:retryNode"; nodeId: string; selectedNodeId?: string | null }
	  | { type: "graphRun:feedbackNode"; nodeId: string; selectedNodeId?: string | null }
	  | { type: "graphRun:approveHumanGate"; nodeId: string; selectedNodeId?: string | null }
	  | { type: "graphRun:stopRun"; selectedNodeId?: string | null };
