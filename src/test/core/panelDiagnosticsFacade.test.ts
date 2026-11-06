import test = require("node:test");
import assert = require("node:assert/strict");
import { installVscodeMock } from "../vscodeMock";
import type * as Facade from "../../panelDiagnostics";
import type * as Retry from "../../promptRetry";
import type * as Policy from "../../loopTaskMessagePolicy";

installVscodeMock();

test("functional modules load independently of the compatibility facade and composition root", () => {
  const facadePath = require.resolve("../../panelDiagnostics");
  const extensionPath = require.resolve("../../extension");
  const coordinatorPath = require.resolve("../../extensionHost/loopGroupChatPanelCoordinator");
  assert.equal(require.cache[facadePath], undefined);
  require("../../promptRetry");
  require("../../loopTaskMessagePolicy");
  assert.equal(require.cache[coordinatorPath], undefined);
  require(coordinatorPath);
  assert.equal(require.cache[facadePath], undefined);
  assert.equal(require.cache[extensionPath], undefined);
});

test("facade preserves the exact public runtime surface and reexports the same objects", () => {
  const facade = require("../../panelDiagnostics") as typeof Facade;
  const modules = {
    ...require("../../promptRetry") as typeof Retry,
    ...require("../../loopTaskMessagePolicy") as typeof Policy,
    ...require("../../extensionHost/loopGroupChatPanelCoordinator") as typeof import("../../extensionHost/loopGroupChatPanelCoordinator"),
  };
  const expectedNames = [
    "HIDDEN_RETRY_MAX_RETRIES", "appendHiddenRetryErrorTraceMessage", "buildHiddenRetryLimitMessage",
    "buildHiddenRetryQueuedMessage", "buildHiddenRetryStartedMessage", "buildLoopGroupChatPanelState",
    "collectRecentLoopTaskIdsFromMessages", "createHiddenRetryErrorTraceMessage", "createLoopGroupChatPanelCoordinator",
    "createPanelDiagnosticsInspector", "detectLoopVerificationSignals", "formatLoopVerificationState",
    "getAttemptFailureMessage", "getErrorInfo", "getLoopCompletionMessagesState", "hasCompleteLoopCompletionMessages",
    "isAbortErrorInfo", "isCompleteLoopFinalSummaryContent", "isHiddenRetryEligibleAttempt", "isHiddenRetryEligibleErrorInfo",
    "isLoopAnswerConclusionMessageForTask", "isLoopFinalSummaryMessageForTask", "isLoopResumePrompt",
    "isLoopTaskPromptResumeCandidate", "isLoopTaskResumable", "isLoopTaskSessionCompatible",
    "isNonRetryableBillingErrorInfo", "normalizeLoopResumePrompt", "waitForHiddenRetryDelay",
  ];
  assert.deepEqual(Object.keys(facade).sort(), expectedNames.sort());
  assert.deepEqual(Object.keys(modules).sort(), expectedNames.filter((name) => name !== "createPanelDiagnosticsInspector").sort());
  for (const name of Object.keys(modules) as (keyof typeof modules)[]) {
    assert.strictEqual(facade[name], modules[name], name);
  }
  type OldTypes = [Facade.ErrorInfo, Facade.CliAttemptResult, Facade.RetryErrorTraceMessageOptions,
    Facade.LoopVerificationState, Facade.LoopVerificationSignals, Facade.LoopTaskCompletionMessagesState];
  type NewTypes = [Retry.ErrorInfo, Retry.CliAttemptResult, Retry.RetryErrorTraceMessageOptions,
    Policy.LoopVerificationState, Policy.LoopVerificationSignals, Policy.LoopTaskCompletionMessagesState];
  const typesMatch: OldTypes extends NewTypes ? NewTypes extends OldTypes ? true : false : false = true;
  assert.equal(typesMatch, true);
});
