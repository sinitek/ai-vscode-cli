import * as assert from "node:assert/strict";
import { test } from "node:test";

import { buildSessionMessagePruningPlan } from "../../sessionMessagePruningPolicy";
import type { ChatMessage } from "../../webview/types";

function message(id: string, role: ChatMessage["role"], content: string, extra: Partial<ChatMessage> = {}): ChatMessage {
  return { id, role, content, createdAt: 1, ...extra };
}

function plan(
  source: readonly ChatMessage[],
  candidates: readonly unknown[] | undefined = source.map(({ id, content }) => ({ id, content })),
  sharedMessages: readonly (readonly ChatMessage[])[] = [source],
  protectedIds: ReadonlySet<string> = new Set()
) {
  return buildSessionMessagePruningPlan({
    authoritativeSource: source,
    sharedMessages,
    candidateSnapshot: candidates,
    protectedIds,
  });
}

test("deletes matching process messages and preserves source order and surviving object identity without mutating inputs", () => {
  const user = message("user", "user", "request");
  const old = message("old", "trace", "exec old");
  const final = message("final", "assistant", "answer", { codexFinalAnswer: true });
  const source = [user, old, final];
  const sourceSnapshot = source.map((item) => ({ ...item }));
  const candidates = source.map(({ id, content }) => ({ id, content }));
  const candidateCopy = candidates.map((candidate) => ({ ...candidate }));
  const shared = [source];
  const sharedSnapshot = shared.map((messages) => [...messages]);
  const protectedIds = new Set<string>();

  const result = buildSessionMessagePruningPlan({ authoritativeSource: source, sharedMessages: shared, candidateSnapshot: candidates, protectedIds });

  assert.deepEqual([...result.deletedIds], ["old"]);
  assert.deepEqual(result.remainingMessages, [user, final]);
  assert.equal(result.remainingMessages[0], user);
  assert.equal(result.remainingMessages[1], final);
  assert.deepEqual(source, sourceSnapshot);
  assert.deepEqual(candidates, candidateCopy);
  assert.deepEqual(shared, sharedSnapshot);
  assert.equal(protectedIds.size, 0);
});

test("empty, malformed and nonmatching candidates produce an empty plan", () => {
  const source = [message("old", "trace", "content")];
  const emptyCandidatePlan = buildSessionMessagePruningPlan({
    authoritativeSource: source,
    sharedMessages: [source],
    candidateSnapshot: undefined,
    protectedIds: new Set(),
  });
  assert.equal(emptyCandidatePlan.deletedIds.size, 0);
  for (const candidateSnapshot of [[], [null, {}, { id: 2, content: "content" }, { id: "old", content: 2 }]]) {
    const result = plan(source, candidateSnapshot);
    assert.equal(result.deletedIds.size, 0);
    assert.deepEqual(result.remainingMessages, source);
  }
  assert.equal(plan(source, [{ id: "old", content: "stale" }]).deletedIds.size, 0);
});

test("any shared-array content change or final-answer upgrade vetoes deletion by ID", () => {
  const source = [message("changed", "trace", "snapshot")];
  const changed = [message("changed", "trace", "new content")];
  assert.equal(plan(source, [{ id: "changed", content: "snapshot" }], [source, changed]).deletedIds.size, 0);

  const upgraded = [message("changed", "assistant", "snapshot", { loopFinalSummary: true })];
  assert.equal(plan(source, [{ id: "changed", content: "snapshot" }], [source, upgraded]).deletedIds.size, 0);
});

test("protects users, text final answers, mixed and invalid final JSON while allowing complete JSON answer bubbles", () => {
  const source = [
    message("user", "user", "request"),
    message("text", "assistant", "[final_answer] done", { codexFinalAnswer: true }),
    message("mixed", "assistant", "[final_answer] note {}", { loopFinalSummary: true }),
    message("invalid", "assistant", "[final_answer] {", { loopFinalSummary: true }),
    message("object", "assistant", "[final_answer]\n{\"ok\":true}", { codexFinalAnswer: true }),
    message("array", "assistant", "~~~json\r\n[]\r\n~~~", { loopAnswerConclusion: true }),
  ];
  const result = plan(source);
  assert.deepEqual([...result.deletedIds], ["object", "array"]);
  assert.deepEqual(result.remainingMessages.map(({ id }) => id), ["user", "text", "mixed", "invalid"]);
});

test("protects active IDs and preserves duplicate candidate last-write-wins behavior", () => {
  const source = [message("active", "trace", "old"), message("other", "trace", "old")];
  const candidates = [
    { id: "active", content: "old" },
    { id: "other", content: "old" },
    { id: "other", content: "last candidate" },
  ];
  const result = plan(source, candidates, [source], new Set(["active"]));
  assert.deepEqual([...result.deletedIds], []);
  assert.deepEqual(result.remainingMessages, source);

  const duplicate = plan(source.slice(1), [
    { id: "other", content: "last candidate" },
    { id: "other", content: "old" },
  ]);
  assert.deepEqual([...duplicate.deletedIds], ["other"]);
});
