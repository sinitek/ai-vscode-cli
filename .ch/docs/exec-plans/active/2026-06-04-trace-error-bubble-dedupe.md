# Trace Error Bubble Dedupe

- Date: 2026-06-04
- Status: in-progress
- Owner: Codex

## Background

The chat webview can show two identical trace error bubbles at the same time. A reproduced screenshot shows duplicate `Reconnecting... 1/5` error bubbles with timestamps only 8ms apart.

## Goal

Make trace warning/error message appends idempotent so live trace updates and state synchronization cannot create duplicate bubbles.

## Scope

- Preserve the backend-created `ChatMessage` identity on `traceSegment` events.
- Add webview dedupe for existing message ids.
- Add short-window warning/error duplicate suppression as a fallback for same-content bursts.

## Non-Goals

- No styling changes.
- No i18n copy changes.
- No changes to CLI retry behavior.

## Acceptance Criteria

- [ ] A persisted trace message and its matching `traceSegment` share the same `id` and timestamp metadata.
- [ ] The webview ignores append attempts for an already-present message id.
- [ ] Two identical warning/error trace bubbles emitted within a short burst render only once.
- [ ] `npm run build` passes.

## Impact

- Code directories: `src/extension.ts`, `src/webview/viewContent.ts`
- Docs: this execution plan
- Config and scripts: none

## Risks and Mitigation

- Risk: suppressing legitimate repeated errors.
- Mitigation: fallback same-content suppression only applies to adjacent trace/system warning/error messages inside a short time window; repeated errors later still render.

## Verification Plan

- Minimal: run TypeScript build.
- Extended: run existing hidden retry test because the previous fix touched retry error traces.

## Task List

- [x] Locate the `Reconnecting... 1/5` trace path.
- [x] Identify the double-entry race between persisted messages and `traceSegment`.
- [x] Implement backend identity propagation and frontend dedupe.
- [x] Run build and relevant tests.

## Decision Record

- 2026-06-04: Fix the trace message transport to carry the original `ChatMessage` identity, with frontend id and short-window duplicate guards as defense in depth.

## Current Conclusion

Frontend now resolves `traceSegment` by existing message id before appending, and backend `appendMessageToStore` suppresses adjacent warning/error duplicates within a short time window. `npm run build` and the hidden-retry / Codex error classifier tests pass.
