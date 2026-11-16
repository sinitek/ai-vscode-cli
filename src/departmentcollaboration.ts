export type DepartmentCollaborationMessage = { id: string; rootTaskId: string; sourceLeaderTaskId: string; targetLeaderTaskId: string; body: string; status: "pending" | "delivered" | "rejected" };
export type DepartmentCollaborationResult = { ok: true; message: DepartmentCollaborationMessage; duplicate: boolean } | { ok: false; reason: "invalid-message" | "duplicate-id" | "unknown-source" | "unknown-target" | "cross-department" | "empty-body" | "target-stopped" };
type DepartmentMember = { rootTaskId: string; stopped?: boolean };
const object = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));
const nonempty = (value: unknown): value is string => typeof value === "string" && Boolean(value.trim());

export function validateDepartmentCollaboration(input: unknown, members: ReadonlyMap<string, DepartmentMember>, seenIds: Set<string>): DepartmentCollaborationResult {
  if (!object(input)
    || !nonempty(input.id)
    || !nonempty(input.rootTaskId)
    || !nonempty(input.sourceLeaderTaskId)
    || !nonempty(input.targetLeaderTaskId)
    || !nonempty(input.body)
    || (input.status !== "pending" && input.status !== "delivered" && input.status !== "rejected")) {
    return { ok: false, reason: "invalid-message" };
  }
  const message = input as unknown as DepartmentCollaborationMessage;
  if (seenIds.has(message.id)) return { ok: false, reason: "duplicate-id" };
  if (!message.body.trim()) return { ok: false, reason: "empty-body" };
  const source = members.get(message.sourceLeaderTaskId), target = members.get(message.targetLeaderTaskId);
  if (!source) return { ok: false, reason: "unknown-source" };
  if (!target) return { ok: false, reason: "unknown-target" };
  if (!object(source) || !nonempty(source.rootTaskId) || !object(target) || !nonempty(target.rootTaskId)) return { ok: false, reason: "invalid-message" };
  if (source.rootTaskId !== message.rootTaskId || target.rootTaskId !== message.rootTaskId) return { ok: false, reason: "cross-department" };
  if (target.stopped) return { ok: false, reason: "target-stopped" };
  seenIds.add(message.id);
  return { ok: true, duplicate: false, message: { ...message, status: "pending" } };
}
