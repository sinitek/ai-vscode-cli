# Loop Group Chat UI Follow-ups

- Date: 2026-06-25
- Status: completed
- Owner: Codex

## Background

The loop group chat panel needs a small but cross-cutting adjustment. The UI should no longer expose transcript/task-record open buttons, the member roster in main/sub mode should use a generic "members" label instead of red/blue wording, and the panel needs a new "supplement requirement" action that persists extra user requirements so the next loop resume round can see them and adjust planning.

## Goal

Refine the loop group chat panel so follow-up requirements can be captured from the panel and fed into the next resume round, while removing confusing or redundant UI actions.

## Scope

- Add a loop task-level supplemental requirements field and persistence.
- Add a panel action to capture supplemental requirements and route them into the existing loop resume flow.
- Remove transcript/task-record buttons from the panel top bar.
- Use a generic member label for main/sub group chat roster instead of red/blue wording.
- Sync product spec and feature inventory entries.

## Non-Goals

- No new standalone chat-send path outside the existing loop resume flow.
- No redesign of the panel layout.
- No change to historical task selection or stop behavior.

## Acceptance Criteria

- [x] The loop group chat panel shows a "supplement requirement" action when the task can continue.
- [x] Submitting supplemental requirements persists them on the loop task record and appends them to the main communication log for auditability.
- [x] The next resumed main-task or debate brief prompt includes the persisted supplemental requirements.
- [x] Main/sub roster labeling no longer uses red/blue wording.
- [x] Transcript/task-record buttons are removed from the panel UI.
- [x] `npm run build` passes.

## Impact

- Code directories: `src/extension.ts`, `src/webview/loopDebatePanel.ts`
- Docs: `.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md`, `.ch/docs/product-specs/FEATURE_INVENTORY.md`, `.ch/docs/design-docs/vscode-cli-extension-runtime.md`, this execution plan
- Config and scripts: none

## Risks and Mitigation

- Risk: supplemental requirements could be captured in UI but missed by the next planning round.
- Mitigation: persist them on the task record and include them in both classic main-task prompt construction and debate brief generation.

## Verification Plan

- Minimal: `npm run build`
- Extended: manual VS Code panel check for button visibility, roster copy, and supplemental requirement dialog flow.

## Test and Inventory Sync

- Unit tests: none added; this is mostly UI wiring and prompt/context plumbing with existing build coverage.
- Feature inventory: update loop group chat entry.
- Related docs sync: update loop runtime/spec docs for the new panel behavior.

## Task List

- [x] Add task-record persistence and prompt plumbing for supplemental requirements.
- [x] Update loop group chat panel UI and message protocol.
- [x] Sync docs and run build validation.

## Decision Record

- 2026-06-25: Reuse the existing loop resume flow for supplemental requirements instead of creating a second execution channel, and persist the text on the task record so the next round can consume it deterministically.

## Current Conclusion

Implementation completed. The loop group chat panel now exposes a supplemental-requirement action for resumable tasks, persists those requirements into the loop task record and main communication log, feeds them into both classic and debate resume prompts, removes transcript/task-record top-bar buttons, and uses a generic member label for main/sub tasks. Validation: `npm run build`.
