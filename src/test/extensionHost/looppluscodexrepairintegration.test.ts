import test = require("node:test");
import assert = require("node:assert/strict");
import fs = require("fs");
import path = require("path");
import { buildLoopPlusFinishEventId, type LoopPlusReviewItem, type LoopPlusSchedulerSnapshot } from "../../loopPlusScheduler";
import { installVscodeMock } from "../vscodeMock";
import { loopPlusAcceptanceChecksFixture, withLoopPlusAcceptReviews } from "../loopPlusAcceptFixture";

installVscodeMock();

const { createLoopPlusCodexRepairFixture, waitForRepair } = require("./fixtures/looppluscodexrepairfixture") as typeof import("./fixtures/looppluscodexrepairfixture");

function eventId(prompt: string): string {
  const match = prompt.match(/Current review eventId: (\S+)/);
  assert.ok(match && match[1] !== "(none)");
  return match[1];
}

function subtask(id: string) {
  return {
    id, title: id, role: "backend",
    prompt: `Implement ${id} in src/a.ts, preserve the task record and scheduler snapshot, and write the result to this attempt report.`,
    writeFiles: ["src/a.ts"],
  };
}

function nextSubtaskId(kind: "repair" | "follow-up"): string {
  return kind === "repair" ? "A" : "B";
}

const cases = [
  { name: "failed review reuses the loaded connection after delayed compaction", kind: "repair", reject: false, newConnection: false, exit: false },
  { name: "failed review proceeds after compaction rejects without undoing the report", kind: "repair", reject: true, newConnection: false, exit: false },
  { name: "failed review with a new cwd waits beyond unsubscribe ACK for thread/closed", kind: "repair", reject: false, newConnection: true, exit: false },
  { name: "failed review after compaction rejection waits beyond logical shutdown and kill for exit", kind: "repair", reject: true, newConnection: true, exit: true },
  { name: "explicit follow-up uses the same source and compaction gate", kind: "follow-up", reject: false, newConnection: false, exit: false },
] as const;

for (const scenario of cases) {
  test(`Loop+ Codex controlled integration: ${scenario.name}`, { timeout: 15_000 }, async (context) => {
    const h = createLoopPlusCodexRepairFixture(context, scenario.newConnection);
    const f = h.fixture;
    let running: Promise<boolean> | undefined;
    let taskId = "";
    let originalReport = "";
    let reviewCount = 0;
    const decision = (value: unknown) => JSON.stringify(withLoopPlusAcceptReviews(value));
    const closeEvidence: Array<{ report: string | null; review: LoopPlusReviewItem | undefined; compactStarted: boolean }> = [];
    const recordClosedTabs = f.closedSubtaskTabs.push.bind(f.closedSubtaskTabs);
    f.closedSubtaskTabs.push = (...tabIds: string[]) => {
      if (tabIds.includes(f.createdSubtaskTargets[0]?.tabId)) {
        const compactStarted = h.events.includes("background-compact");
        const task = f.readTask(taskId);
        const snapshot = task?.loopPlus as LoopPlusSchedulerSnapshot | undefined;
        const reportPath = task && path.join(task.communicationDir, "round-1-A.md");
        const finishEventId = buildLoopPlusFinishEventId("A", f.attemptCalls[0].loopAttemptId!);
        const review = [snapshot?.currentReview, ...(snapshot?.reviewQueue ?? [])]
          .find((item) => item?.eventId === finishEventId);
        closeEvidence.push({
          report: reportPath && fs.existsSync(reportPath) ? fs.readFileSync(reportPath, "utf8") : null,
          review: review ?? undefined,
          compactStarted,
        });
      }
      return recordClosedTabs(...tabIds);
    };
    try {
      await h.other.runForText("independent thread before dispatch");
      const otherThread = h.other.getThreadId();
      f.queueMain((input, tabId) => {
        taskId = input.loopTaskId!;
        f.publish(input, tabId, { status: "end", content: decision({ status: "dispatch", subtasks: [subtask("A")] }) });
      });
      f.queueMain(async (input, tabId) => {
        reviewCount += 1;
        const snapshot = f.readTask(taskId)!.loopPlus as LoopPlusSchedulerSnapshot;
        assert.equal(snapshot.currentReview?.subtaskId, "A");
        assert.equal(f.readTask(taskId)!.subTasks.find((item) => item.id === "A")!.executionSession?.sessionId, h.originalThread());
        originalReport = fs.readFileSync(path.join(f.readTask(taskId)!.communicationDir, "round-1-A.md"), "utf8");
        assert.match(originalReport, /outcome: completed/);
        assert.ok(originalReport.includes(`result:${h.originalThread()}:`));
        await waitForRepair(h.compactStarted, "background compact while A is in review");
        assert.equal(h.pendingCompact(), true);
        h.events.push("review-dispatch");
        f.publish(input, tabId, { status: "end", content: decision({
          status: "accept", progressPercent: 25, reviewEventId: eventId(input.displayPrompt),
          reviews: [{ reviewEventId: eventId(input.displayPrompt), acceptance: scenario.kind === "repair" ? "failed" : "passed", subtaskIds: [nextSubtaskId(scenario.kind)] }],
          subtasks: [{ ...subtask(nextSubtaskId(scenario.kind)), ...(scenario.kind === "follow-up" ? { continueFromSubtaskId: "A" } : {}) }],
        }) });
      });
      f.queueMain((input, tabId) => {
        reviewCount += 1;
        assert.equal((f.readTask(taskId)!.loopPlus as LoopPlusSchedulerSnapshot).currentReview?.subtaskId, nextSubtaskId(scenario.kind));
        assert.equal(f.attemptCalls.length, 2);
        assert.equal(h.pendingCompact(), false);
        f.publish(input, tabId, { status: "end", content: decision({
          status: "completed", reviewEventId: eventId(input.displayPrompt),
          answerConclusion: "修补已完成", finalSummary: "受控协议修补通过",
          acceptance: { passed: true, checks: loopPlusAcceptanceChecksFixture() },
          requirementCoverage: [{ name: "repair", passed: true }],
        }) });
      });
      running = f.adapter.runEventDriven({
        displayPrompt: "repair through failed review", modelPrompt: "repair through failed review", contextTags: [],
        model: "main-model", loopMainModel: "main-model", loopSubtaskModel: "sub-model",
        loopSubtaskMode: "fullstack", loopSubtaskFullstackCli: "codex", loopSubtaskFullstackConfigId: "sub-profile",
        loopSubtaskFullstackModel: "sub-model", loopMainThinkingMode: "low", loopSubtaskThinkingMode: "low",
      }, { schedulingMode: "event_driven" }, f.target);
      await waitForRepair(() => f.createdSubtaskTargets.length === 2, "review dispatched the successor while compact is pending");
      assert.ok(f.closedSubtaskTabs.includes(f.createdSubtaskTargets[0].tabId),
        "the original tab is closed while its background compaction is still pending");
      assert.equal(closeEvidence[0]?.report, originalReport, "the successful report is already persisted at close");
      assert.equal(closeEvidence[0]?.review?.outcome, "completed", "the attempt's completion event is already persisted at close");
      assert.equal(closeEvidence[0]?.compactStarted, false, "the original tab closes before background compaction starts");
      const thread = h.originalThread()!;
      assert.ok(thread.startsWith("protocol-thread-"));
      assert.equal(f.createdSubtaskTargets[1].sessionId, thread);
      assert.notEqual(f.createdSubtaskTargets[0].tabId, f.createdSubtaskTargets[1].tabId);
      assert.equal(f.readTask(taskId)!.subTasks.find((item) => item.id === nextSubtaskId(scenario.kind))!.continueFromSubtaskId,
        "A");
      // The second attempt is linked to A but waits for A's background compaction.
      assert.equal(f.attemptCalls.length, 1);
      assert.equal(h.children.length, 1);
      assert.equal(h.pendingCompact(), true);
      const otherResult = await h.other.runForText("different thread advances during compact");
      assert.equal(otherResult.threadId, otherThread);
      assert.ok(otherResult.text.includes(`result:${otherThread}:`));
      assert.equal(f.attemptCalls.length, 1);
      assert.equal(h.events.filter((event) => event === `turn:${thread}`).length, 1);

      h.finishCompact(scenario.reject);
      if (scenario.newConnection) {
        await waitForRepair(() => h.events.filter((event) => event === `unsubscribe-ack:${thread}`).length >= 2,
          "pool rechecked release after ACK while writer is still loaded");
        assert.equal(h.children.length, 2);
        assert.equal(h.events.includes(`thread/resume:${thread}`), false);
        assert.equal(h.children[0].exitCode, null);
        assert.equal(h.children[0].terminationRequests, 0);
        // The shared old process remains available for a different thread during handoff.
        assert.equal((await h.other.runForText("different thread advances during handoff")).threadId, otherThread);
        if (scenario.exit) {
          h.original().dispose();
          h.other.dispose();
          await waitForRepair(() => h.children[0].terminationRequests > 0, "old process termination requested");
          const checkpoint = h.pollingSteps();
          await waitForRepair(() => h.pollingSteps() > checkpoint + 1, "handoff checked logically closed but live process again");
          assert.equal(h.children[0].exitCode, null);
          assert.equal(h.events.includes(`thread/resume:${thread}`), false, "logical close and successful kill request cannot release the writer");
          h.children[0].exit();
        } else h.closeOriginalThread();
      }
      await running;
      assert.equal(reviewCount, 2);
      assert.equal(f.readTask(taskId)!.status, "completed");
      assert.equal(f.completionMessages.length, 1);
      assert.equal(f.attemptCalls.length, 2);
      assert.deepEqual(f.attemptCalls.map((input) => input.loopSubtaskId), ["A", nextSubtaskId(scenario.kind)]);
      assert.notEqual(f.attemptCalls[0].loopAttemptId, f.attemptCalls[1].loopAttemptId);
      assert.equal(f.readTask(taskId)!.subTasks.find((item) => item.id === nextSubtaskId(scenario.kind))!.executionSession?.sessionId, thread);
      assert.equal(f.readTask(taskId)!.subTasks.find((item) => item.id === nextSubtaskId(scenario.kind))!.executionSession?.configId, "sub-profile");
      assert.equal(fs.readFileSync(path.join(f.readTask(taskId)!.communicationDir, "round-1-A.md"), "utf8"), originalReport);
      assert.equal(h.pendingCompact(), false);
      assert.equal(f.refusals.length, 0);
      assert.equal(h.events.filter((event) => event === `turn:${thread}`).length, 2);
      assert.ok(h.events.indexOf("compact-settled") < h.events.lastIndexOf(`turn:${thread}`));
      assert.ok(h.events.indexOf("review-dispatch") < h.events.indexOf(scenario.reject ? "compact-rejected" : "compact-completed"));
      const resumes = h.wire.filter(({ request }) => request.method === "thread/resume");
      if (scenario.newConnection) {
        assert.equal(resumes.length, 1);
        assert.equal(resumes[0].request.params.threadId, thread);
        const release = scenario.exit ? `exit:${h.children[0].pid}` : `closed:${thread}`;
        assert.ok(h.events.indexOf(release) < h.events.indexOf(`thread/resume:${thread}`));
        assert.equal(resumes[0].request.params.sandbox, "workspace-write");
      } else {
        assert.equal(resumes.length, 0);
        assert.equal(h.children.length, 1);
        assert.equal(h.wire.filter(({ request }) => request.method === "thread/unsubscribe").length, 0);
      }
      assert.equal(h.wire.filter(({ request }) => request.method === "thread/start").length, 2, "only A and the independent thread are created");
      const compactErrors = h.errors.filter((item) => item.message === "loop-subtask-auto-compact-failed");
      assert.equal(compactErrors.length, scenario.reject ? 1 : 0);
      if (scenario.reject) assert.equal((compactErrors[0].data as { subtaskId: string }).subtaskId, "A");
      assert.equal(f.mainCalls.length, 3, "compaction failure cannot create a main review invocation");
    } finally {
      await h.cleanup(running);
    }
  });
}
