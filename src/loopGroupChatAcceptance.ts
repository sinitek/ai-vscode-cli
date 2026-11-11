import type { LoopGroupChatSegment } from "./loopGroupChat";
import { buildLoopPlusFinishEventId, type LoopPlusSeenAttempt } from "./loopPlusScheduler";

const ACCEPTANCE_METADATA_PATTERN = /<!-- loop-plus-acceptance:([^\n]*?) -->/gu;

export function buildLoopGroupChatAcceptanceMetadata(eventIds: readonly string[]): string {
  return `<!-- loop-plus-acceptance:${encodeURIComponent(JSON.stringify(eventIds))} -->`;
}

export function stripLoopGroupChatAcceptanceMetadata(body: string): string {
  return body.replace(ACCEPTANCE_METADATA_PATTERN, "").trim();
}

function readAcceptanceEventIds(body: string): string[] | null {
  const metadata = Array.from(body.matchAll(ACCEPTANCE_METADATA_PATTERN));
  if (metadata.length === 0) return null;
  try {
    const eventIds: unknown = JSON.parse(decodeURIComponent(metadata[0][1]));
    return Array.isArray(eventIds) && eventIds.every((eventId) => typeof eventId === "string" && eventId.length > 0)
      ? eventIds : [];
  } catch {
    return [];
  }
}

export type LoopGroupChatAcceptanceAnchors = {
  byParticipantId: Map<string, string>;
  bySegmentIndex: Map<number, string>;
};

export function buildLoopGroupChatAcceptanceAnchors(
  segments: readonly LoopGroupChatSegment[],
  participants: readonly { id: string; title: string }[],
  attempts?: readonly LoopPlusSeenAttempt[],
): LoopGroupChatAcceptanceAnchors {
  const byParticipantId = new Map<string, string>();
  const bySegmentIndex = new Map<number, string>();
  const reviewedEvents = new Map<string, string>();
  for (const attempt of attempts ?? []) {
    if (attempt.disposition === "reviewed") {
      reviewedEvents.set(attempt.subtaskId, buildLoopPlusFinishEventId(attempt.subtaskId, attempt.attemptId));
    }
  }
  const titles = participants.map((participant) => ({
    ...participant,
    title: participant.title.replace(/^子任务\s+\d+[：:]\s*/u, "").replace(/\s+/gu, " ").trim(),
  }));
  const matchedSegments = new Map<string, number>();
  segments.forEach((segment, index) => {
    if (segment.kind !== "main-turn" || segment.heading !== "验收结果") return;
    const eventIds = readAcceptanceEventIds(segment.body);
    if (!eventIds) return;
    for (const participant of participants) {
      const eventId = reviewedEvents.get(participant.id);
      if (eventId && eventIds.includes(eventId)) matchedSegments.set(participant.id, index);
    }
  });
  titles.forEach((participant) => {
    if (matchedSegments.has(participant.id) || !reviewedEvents.has(participant.id) || !participant.title) return;
    if (titles.some((other) => other.id !== participant.id && other.title === participant.title)) return;
    for (let index = segments.length - 1; index >= 0; index -= 1) {
      const segment = segments[index];
      if (segment.kind !== "main-turn" || segment.heading !== "验收结果" || readAcceptanceEventIds(segment.body) !== null) continue;
      const titleLine = segment.body.match(/^\*\*子任务：(.+)\*\*\s*$/mu)?.[1];
      const legacyTitles = titleLine?.replace(/\\([\\`*_[\]<>|#])/gu, "$1").split("、");
      if (legacyTitles?.includes(participant.title)) {
        matchedSegments.set(participant.id, index);
        break;
      }
    }
  });
  matchedSegments.forEach((index, participantId) => {
    const anchor = `loop-plus-acceptance-${index}`;
    byParticipantId.set(participantId, anchor);
    bySegmentIndex.set(index, anchor);
  });
  return { byParticipantId, bySegmentIndex };
}
