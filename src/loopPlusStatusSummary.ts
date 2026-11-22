import type { LoopGroupChatPanelParticipant } from "./webview/loopGroupChatPanelTypes";

type StatusMember = Pick<LoopGroupChatPanelParticipant, "id" | "role" | "status">;
export type LoopPlusStatusSummary = Record<"running" | "repairing" | "reviewing" | "queue" | "pending" | "acceptance_failed" | "blocked" | "completed", number>;

function summaryField(status: string): keyof LoopPlusStatusSummary | undefined {
  switch (status) {
    case "decomposing": return "running";
    case "queued_review":
    case "held_review":
    case "review_pending": return "queue";
    case "acceptance_passed":
    case "no_acceptance": return "completed";
    case "running":
    case "repairing":
    case "reviewing":
    case "pending":
    case "acceptance_failed":
    case "blocked":
    case "completed": return status;
    default: return undefined;
  }
}

export function summarizeLoopPlusMembers(members: Iterable<StatusMember>): LoopPlusStatusSummary {
  const latest = new Map<string, StatusMember>();
  for (const member of members) {
    if (member.role === "main") latest.set("main", member);
    if (member.role === "subtask") latest.set(`subtask:${member.id}`, member);
  }
  const counts: LoopPlusStatusSummary = { running: 0, repairing: 0, reviewing: 0, queue: 0, pending: 0, acceptance_failed: 0, blocked: 0, completed: 0 };
  for (const { role, status } of latest.values()) {
    if (role === "main" && status === "reviewing") continue;
    const field = summaryField(status);
    if (field) counts[field]++;
  }
  return counts;
}
