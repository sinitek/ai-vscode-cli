import assert = require("node:assert/strict");
import test = require("node:test");
import * as vm from "node:vm";
import { parseLoopGroupChatTranscript, type LoopGroupChatSegment } from "../../loopGroupChat";
import { buildLoopGroupChatAcceptanceAnchors, buildLoopGroupChatAcceptanceMetadata, stripLoopGroupChatAcceptanceMetadata } from "../../loopGroupChatAcceptance";
import { buildLoopPlusAcceptanceFeedbackSection } from "../../loopPlusAcceptancePlan";
import { buildLoopPlusFinishEventId, type LoopPlusSeenAttempt } from "../../loopPlusScheduler";
import type { LoopGroupChatPanelState } from "../../webview/loopGroupChatPanelTypes";
import { installVscodeMock } from "../vscodeMock";

installVscodeMock();

const { buildLoopGroupChatPanelContentPatch, buildLoopGroupChatPanelHtml } = require("../../webview/loopGroupChatPanel") as typeof import("../../webview/loopGroupChatPanel");

function reviewed(subtaskId: string, attemptId: string, acceptance: "passed" | "failed" = "passed"): LoopPlusSeenAttempt {
  return { subtaskId, attemptId, disposition: "reviewed", outcome: "completed", acceptance };
}

function feedback(attempts: readonly LoopPlusSeenAttempt[], titles: string[]): LoopGroupChatSegment {
  const section = buildLoopPlusAcceptanceFeedbackSection({
    subtaskTitles: titles,
    reviews: attempts.map((attempt) => ({
      eventId: buildLoopPlusFinishEventId(attempt.subtaskId, attempt.attemptId),
      acceptance: attempt.acceptance ?? "passed",
      reason: attempt.acceptance === "failed" ? "契约断言失败" : "回归与交付审查通过",
    })),
  });
  assert.ok(section);
  return parseLoopGroupChatTranscript(`## ${section.heading}\n\n${section.body}\n`).segments[0];
}

function stateWithFeedback(attempts: LoopPlusSeenAttempt[], segments: LoopGroupChatSegment[]): LoopGroupChatPanelState {
  return {
    task: { id: "anchor-task", cli: "codex", status: "completed", rootPrompt: "完成需求", taskStoreFile: "/tmp/task.json", mainCommunicationFile: "/tmp/main.md", currentRound: 1, updatedAt: 1, canSupplement: false, canContinue: false, canStop: false },
    loopPlus: { ok: true, schedulingMode: "event_driven", activity: "completed", phase: "completed", wakePending: false, currentReview: null, reviewQueue: [], currentReviewCount: 0, reviewQueueCount: 0, visibleReviewCount: 0, running: [], pending: [], runningCount: 0, pendingCount: 0, seenAttempts: attempts },
    rounds: [{ key: "main-sub", loopRound: 1, status: "completed", startedAt: 1, participants: [
      { id: "main", title: "主任务", role: "main", status: "completed" },
      ...attempts.map((attempt, index) => ({ id: attempt.subtaskId, title: `子任务 ${index + 1}：任务${attempt.subtaskId}`, role: "subtask", status: `acceptance_${attempt.acceptance}` })),
    ] }],
    chatMarkdown: segments.map((segment) => `## ${segment.heading}\n\n${segment.body}\n`).join("\n"),
  };
}

for (const acceptance of ["passed", "failed"] as const) {
  test(`links ${acceptance} feedback by exact event identity, not member title`, () => {
    const attempt = reviewed("成员-->", "attempt:%<>&", acceptance);
    const segment = feedback([attempt], ["原始任务标题"]);
    const anchors = buildLoopGroupChatAcceptanceAnchors([segment], [{ id: attempt.subtaskId, title: "子任务 1：不同的显示标题" }], [attempt]);
    assert.equal(anchors.byParticipantId.get(attempt.subtaskId), "loop-plus-acceptance-0");
    const patch = buildLoopGroupChatPanelContentPatch(stateWithFeedback([attempt], [segment]), 1);
    assert.match(patch.rosterPanelHtml, /<button class="member member-acceptance-link"[^>]+data-acceptance-target="loop-plus-acceptance-0"/u);
    assert.match(patch.timelineHtml, /class="message main-turn with-avatar acceptance-anchor" id="loop-plus-acceptance-0" tabindex="-1"/u);
    assert.doesNotMatch(patch.timelineHtml, /loop-plus-acceptance:|attempt:%|成员--/u);
    assert.match(patch.timelineHtml, acceptance === "passed" ? /回归与交付审查通过/u : /契约断言失败/u);
  });
}

test("batch reviews share one anchor even with duplicate titles and mixed results", () => {
  const attempts = [reviewed("A", "a-1"), reviewed("B", "b-1", "failed")];
  const anchors = buildLoopGroupChatAcceptanceAnchors([feedback(attempts, ["同名", "同名"])], [
    { id: "A", title: "子任务 1：同名" }, { id: "B", title: "子任务 2：同名" },
  ], attempts);
  assert.equal(anchors.byParticipantId.get("A"), anchors.byParticipantId.get("B"));
  assert.equal(anchors.byParticipantId.size, 2);
  assert.equal(anchors.bySegmentIndex.size, 1);
});

test("a retried member points only to the latest reviewed attempt", () => {
  const oldAttempt = reviewed("A", "a-1", "failed");
  const latestAttempt = reviewed("A", "a-2");
  const anchors = buildLoopGroupChatAcceptanceAnchors([
    feedback([oldAttempt], ["任务A"]), feedback([latestAttempt], ["任务A"]), feedback([oldAttempt], ["任务A"]),
  ], [{ id: "A", title: "子任务 1：任务A" }], [oldAttempt, latestAttempt]);
  assert.equal(anchors.byParticipantId.get("A"), "loop-plus-acceptance-1");
  assert.deepEqual([...anchors.bySegmentIndex.keys()], [1]);
  const missingLatest = buildLoopGroupChatAcceptanceAnchors([feedback([oldAttempt], ["任务A"])], [{ id: "A", title: "任务A" }], [oldAttempt, latestAttempt]);
  assert.equal(missingLatest.byParticipantId.size, 0);
});

test("legacy feedback uses the latest unique exact title and unescapes markdown", () => {
  const attempt = reviewed("A", "a-1");
  const segment = feedback([attempt], ["表单 *检查* | API <边界>"]);
  segment.body = stripLoopGroupChatAcceptanceMetadata(segment.body);
  const participants = [{ id: "A", title: "子任务 1：表单 *检查* | API <边界>" }];
  const anchors = buildLoopGroupChatAcceptanceAnchors([segment, segment], participants, [attempt]);
  assert.equal(anchors.byParticipantId.get("A"), "loop-plus-acceptance-1");
  assert.equal(buildLoopGroupChatAcceptanceAnchors([segment], [participants[0], { ...participants[0], id: "B" }], [attempt, reviewed("B", "b-1")]).byParticipantId.size, 0);
  assert.equal(buildLoopGroupChatAcceptanceAnchors([segment], [{ id: "A", title: "表单" }], [attempt]).byParticipantId.size, 0);
});

test("legacy batch feedback links each uniquely named reviewed member", () => {
  const attempts = [reviewed("A", "a-1"), reviewed("B", "b-1", "failed")];
  const segment = feedback(attempts, ["前端", "后端"]);
  segment.body = stripLoopGroupChatAcceptanceMetadata(segment.body);
  const anchors = buildLoopGroupChatAcceptanceAnchors([segment], [{ id: "A", title: "子任务 1：前端" }, { id: "B", title: "子任务 2：后端" }], attempts);
  assert.equal(anchors.byParticipantId.size, 2);
  assert.equal(anchors.bySegmentIndex.size, 1);
});

test("malformed metadata, unreviewed members and non-feedback text never produce anchors", () => {
  const attempt = reviewed("A", "a-1");
  const participants = [{ id: "A", title: "任务A" }];
  for (const metadata of ["%broken", encodeURIComponent(JSON.stringify([123])), encodeURIComponent(JSON.stringify({ event: "A" }))]) {
    const segment: LoopGroupChatSegment = { kind: "main-turn", heading: "验收结果", body: `**子任务：任务A**\n\n<!-- loop-plus-acceptance:${metadata} -->` };
    assert.equal(buildLoopGroupChatAcceptanceAnchors([segment], participants, [attempt]).byParticipantId.size, 0);
  }
  const segment = feedback([attempt], ["任务A"]);
  assert.equal(buildLoopGroupChatAcceptanceAnchors([segment], participants).byParticipantId.size, 0);
  assert.equal(buildLoopGroupChatAcceptanceAnchors([segment], participants, [{ ...attempt, disposition: "finished" }]).byParticipantId.size, 0);
  assert.equal(buildLoopGroupChatAcceptanceAnchors([{ ...segment, kind: "user-message" }], participants, [attempt]).byParticipantId.size, 0);
  const metadata = buildLoopGroupChatAcceptanceMetadata(['id-->\n<script>"%']);
  assert.equal(metadata.slice(0, -3).includes("-->"), false);
  assert.equal(stripLoopGroupChatAcceptanceMetadata(`正文\n\n${metadata}`), "正文");
});

test("message cleanup and incremental patches keep every clickable acceptance target mounted", () => {
  const attempt = reviewed("A", "a-1");
  const segments = [feedback([attempt], ["任务A"]), ...Array.from({ length: 20 }, (_, index): LoopGroupChatSegment => ({ kind: "main-turn", heading: `主任务发言：第 ${index + 1} 轮`, body: `普通消息${index}` }))];
  const state = stateWithFeedback([attempt], segments);
  state.messageLimit = 4;
  const window = { start: 0 };
  for (const generation of [1, 2]) {
    const patch = buildLoopGroupChatPanelContentPatch(state, generation, window);
    assert.match(patch.rosterPanelHtml, /data-acceptance-target="loop-plus-acceptance-0"/u);
    assert.match(patch.timelineHtml, /id="loop-plus-acceptance-0"/u);
    assert.doesNotMatch(patch.timelineHtml, /data-markdown-source="普通消息0"/u);
    assert.ok(window.start > 0);
    state.chatMarkdown += "\n## 主任务发言：第 30 轮\n\n新消息\n";
  }
});

test("classic Loop, load errors and missing feedback have no clickable members", () => {
  const attempt = reviewed("A", "a-1");
  const state = stateWithFeedback([attempt], [feedback([attempt], ["任务A"])]);
  for (const overrides of [{ loopPlus: undefined }, { error: "读取失败" }, { chatMarkdown: "" }]) {
    const patch = buildLoopGroupChatPanelContentPatch({ ...state, ...overrides }, 1);
    assert.doesNotMatch(patch.rosterPanelHtml, /data-action="jumpToAcceptance"/u);
  }
});

test("the member action focuses and scrolls its target, closes the drawer and honors reduced motion", () => {
  const page = buildLoopGroupChatPanelHtml({ cspSource: "self" } as never, stateWithFeedback([], []));
  const start = page.indexOf('if (action === "jumpToAcceptance")');
  const source = page.slice(start, page.indexOf('if (action === "continueTask")', start));
  assert.ok(start > 0);
  for (const reducedMotion of [true, false]) {
    const events: unknown[] = [];
    const anchor = { focus: (options: unknown) => events.push(["focus", options]), scrollIntoView: (options: unknown) => events.push(["scroll", options]) };
    const context = {
      action: "jumpToAcceptance", target: { getAttribute: () => "target" },
      document: { getElementById: () => anchor }, mainElement: { contains: () => true },
      setSidebarOpen: (open: boolean) => events.push(["sidebar", open]),
      window: { matchMedia: () => ({ matches: reducedMotion }) },
    };
    vm.runInNewContext(`(function () { ${source} })();`, context);
    assert.equal(JSON.stringify(events), JSON.stringify([["sidebar", false], ["focus", { preventScroll: true }], ["scroll", { behavior: reducedMotion ? "auto" : "smooth", block: "center" }]]));
    events.length = 0;
    context.mainElement.contains = () => false;
    vm.runInNewContext(`(function () { ${source} })();`, context);
    assert.equal(events.length, 0);
  }
});
