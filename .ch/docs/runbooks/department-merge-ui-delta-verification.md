# Department Merge UI Delta Verification

This runbook records the focused display-layer browser checks for the locally accepted merge `51a5e7b15c54921611721fe14863e60361d64e72`. Product sources and compiled output came from the read-only worktree `/Users/fangjiawei/.cache/codex-worktrees/sinitek-ai-vscode-cli/department-local-integration-round416-20261116` at that exact commit. The smoke host uses department fixtures and a mocked VS Code API; it does not start a real department, scheduler, CLI, or model. The runner follows the repository [chromium-playwright-smoke skill](/Users/fangjiawei/sinitek/sinitek-ai-vscode-cli/.agents/skills/chromium-playwright-smoke/SKILL.md).

## Run

Use the existing smoke entrypoints with their delta-only switches. `DEPARTMENT_UI_DIST` and `DEPARTMENT_TABS_DIST` must point at the frozen merge's compiled `dist`; output directories should be unique per attempt. The scripts bind their fixture servers to `127.0.0.1` on port `0`, and save browser output under their respective evidence directories.

```sh
NODE_PATH=/path/to/existing/repo/node_modules \
DEPARTMENT_UI_DIST=/path/to/frozen-merge/dist \
DEPARTMENT_UI_EVIDENCE=/tmp/<attempt>/group \
DEPARTMENT_UI_DELTA_ONLY=1 \
PLAYWRIGHT_MODULE=/tmp/zq-playwright-smoke/node_modules/playwright \
CHROMIUM_PATH=/path/to/Google\ Chrome\ for\ Testing \
node scripts/department_group_chat_smoke.cjs

NODE_PATH=/path/to/existing/repo/node_modules \
DEPARTMENT_TABS_DIST=/path/to/frozen-merge/dist \
DEPARTMENT_TABS_EVIDENCE=/tmp/<attempt>/tabs \
DEPARTMENT_TABS_DELTA_ONLY=1 \
PLAYWRIGHT_MODULE=/tmp/zq-playwright-smoke/node_modules/playwright \
CHROMIUM_PATH=/path/to/Google\ Chrome\ for\ Testing \
node scripts/department_conversation_tabs_smoke.cjs
```

The group delta runs 1440px dark and 280px light. It combines the department modal with busy/idle continuation, queued ask, answer and finish states, 49 transcript entries, and an old leader response arriving after opening another leader. The tab delta injects 49 messages through the webview's `setMessages` protocol, switches director/leader/employee role tabs, and delivers a late message for an inactive tab while checking the loading state.

## Round 419 Evidence and Correction

The role-tab scenario passed at 1280x900. With `chatMessageLimit=48`, 49 messages queued the actual asynchronous `pruneChatMessages` request. The loading placeholder appeared while the active tab had no message batch and disappeared after the employee batch arrived. Late leader messages and the old director prune result did not alter the employee transcript. There were no browser, console, or webview errors. The fixture exercises the generated webview and host message protocol, not the extension-host session repository or CLI.

The group scenario ran both requested viewports and reached its final checks. It confirmed all 49 transcript entries render, busy-state continuation is unavailable without dispatch, idle continuation remains routed to the active leader's task and modal instance, the active waiting spinner appears after release, and the finished answer clears it. The late A-group update did not appear in B's modal; root and modal horizontal overflow checks passed. Its two reported failures require correction:

- The queue assertion's fixture did **not** match the host contract: it set `thread.queued: true` but omitted `queued: true` from the affected user bubble. `LoopAskBubble` already permits that per-bubble field. `syncAskThread` in `src/extensionHost/loopGroupChatPanelCoordinator.ts` marks only active-not-started or pending question IDs on their user bubbles and clears stale bubble flags before publish. The renderer's `message.queued` check was correct; the old report's schema and renderer-defect conclusion was incorrect. The old JSON and screenshots remain failure evidence for that malformed fixture, not a product defect.
- Chromium recorded three `focus-without-user-activation` console errors per viewport. The asynchronous paths were broader than the old report identified: iframe `load` sent an unsolicited child-focus message; the child bridge focused on that message; its `MutationObserver` focused dialogs when they appeared and restored focus after they disappeared; and ask/continue/supplement handlers deferred focus through `setTimeout`. The old screenshots/JSON remain unchanged as historical failure evidence.

The unchanged historical artifacts are `group-final-2/1440-dark-queued-ask.png`, `group-final-2/280-light-queued-ask.png`, and `tabs-final-2/tabs-delta-employee-active.png` under `/tmp/department-merge-ui-delta-round419/`. `group-final-2/result.json` is exit 1 for the malformed fixture and includes the three focus errors per viewport; `tabs-final-2/result.json` is exit 0. These artifacts were retained and not overwritten.

## Round 422 Correction and Repair

The group fixture now mirrors the coordinator's bubble-level contract: answered history and the active question have no queued marker, while only the later pending user question has `queued: true` while the thread remains running and dispatchable. Checks distinguish these three messages, check the active waiting indicator at the same time as the later queued notice, and check that finishing removes the marker. Queue spacing, 85% maximum width, long-label wrapping, and reduced-motion animation suppression are measured in Chromium.

The focus path no longer autofocuses the child on iframe load or through an asynchronous bridge command. Parent Tab uses native traversal into the iframe; the child retains its Tab boundary handling and Escape close message under the existing `source`, opaque-origin, task ID, and instance ID checks. Dialogs opened by a user action focus synchronously; restored dialogs do not take focus. The dialog observer now updates inert/layout state only; click/keyboard-driven close restores its opener synchronously. The iframe remains sandboxed with `allow-scripts` only.

An isolated worktree based on `c76b5132d6c0430dfb03f150fb8220010265e32f` built its own `dist` and ran the focused group delta at 1440px dark and 280px light. Both passed, with no page, console, or failed-request errors. The success JSON explicitly stores `browserErrors: []`; representative images are under `/private/tmp/department-ui-queued-focus-round422-evidence/group-final-confirmed/`. The initial run in this attempt exposed a smoke locator selecting the last nested typing-dot span instead of the queue label; that run and its screenshots remain under `/private/tmp/department-ui-queued-focus-round422-evidence/group-second-locator-failure/`. The locator was corrected to the direct final label span before the passing run. The earlier `/tmp/department-ui-queued-focus-round422/` path was the worktree-local staging location and is not the retained evidence directory.

The `tabs-final-2` result from Round 419 remains reusable: its script bytes and tested product input are unchanged, and it was not rerun. The prior 75 static/render/VM checks and historical theme/layout matrix were also reused. This is display-layer fixture browser verification, not real CLI, scheduler, extension-host, EH, or model execution and not final full-tree acceptance.

Historical theme/layout coverage and the accepted 75 static/render/VM checks were reused as directed. The historical full smoke matrix was not rerun. The browser scenario did emulate `prefers-reduced-motion: reduce` and confirmed the queue typing animation is disabled; OS-level preference propagation and hidden-page transitions were not tested. Real extension-host, scheduler, CLI, EH, and model execution also remain outside this fixture evidence.

## Round 424 Keyboard Focus Boundary

The follow-up review at `/var/folders/49/shyk0sxs3qg15d9w_npw48z80000gn/T/department-ui-review-boundaries-0sT9nf/result.json` found two keyboard-only failures while browser errors remained empty: Shift+Tab from `departmentChatClose` moved focus to `BODY`, and Ctrl+Enter closed the supplement dialog without returning focus to its opener. The first was a parent-modal boundary omission; the second occurred because focus restoration depended on a click bubbling through the document, while keyboard submission calls the submit handler directly.

The parent modal now wraps reverse Tab from its first control back into the loaded iframe. The child bridge exposes a synchronous dialog lifecycle used by continue/supplement dialogs: opening records the current action only for user-initiated opens and synchronizes inert/stack state; closing synchronizes the new top layer before returning focus to a connected, non-inert opener. Restored dialogs do not register an opener. The bridge retains `sandbox="allow-scripts"`, opaque origin, event source, task ID, and instance ID checks. It does not focus on iframe load, MutationObserver refresh, or async restoration.

The first bounded browser confirmation exposed one further boundary: after the parent focused the iframe element, the child's `document.hasFocus()` was still false and its last focused control was lost. The parent now focuses the iframe browsing context and sends a `focusLast` command only from the active Shift+Tab boundary event; the bound child bridge remembers its most recent visible control and restores it under the existing message checks. No iframe load, observer, or async state restoration triggers this path.

The final bounded browser confirmation ran the group delta at 1440px dark and 280px light, including forward and reverse iframe Tab traversal with child focus restoration, Shift+Tab from the child's first control, nested dialog Tab/Escape, empty Ctrl+Enter validation, valid Ctrl+Enter with one exact task/instance dispatch, click confirmation, cancellation, and focus restoration to each opener. Result JSON and screenshots are under `/private/tmp/department-ui-queued-focus-round422-evidence/group-round424-keyboard-focus-final3/`; both viewports passed with `browserErrors: []`. This still exercises generated webview HTML with fixture host APIs only.

## Round 425 Dialog Lifecycle Completion

The follow-up probe `/var/folders/49/shyk0sxs3qg15d9w_npw48z80000gn/T/department-ui-review-dialog-close-mm92s3mw/result.json` (SHA-256 `4d511973cbbe1207e6151721bcf77c8491e20d28fe73deeda92cd09cc0472d90`) found the ask dialog was not registered with the department bridge: clicking its close button or pressing Escape hid the dialog but left focus on the now-hidden ask input. The probe had no browser errors and did not report a dispatch or identity-check failure.

The shared synchronous dialog lifecycle now includes explicit ask-dialog and file-preview opens/closes. It records the opener only for an explicit open; stored-state restoration continues to update visibility without claiming an opener or taking focus. Continue/supplement, ask, preview, and model-switch dialogs retain a local opener fallback for ordinary Loop/Loop+ panels without a department bridge. Model-switch cancel, backdrop, and Escape close through the lifecycle after hiding and updating inert state. A successful asynchronous `switchModelsSettled` hides the dialog with focus restoration disabled, so the reply does not impersonate a user action; pending and error behavior is unchanged.

The bounded smoke command is `DEPARTMENT_UI_FOCUS_LIFECYCLE_ONLY=1 node scripts/department_group_chat_smoke.cjs` with the normal `DEPARTMENT_UI_DIST`, unique `DEPARTMENT_UI_EVIDENCE`, Playwright, and Chromium environment values from the Run section. It uses a dynamic fixture port and exercises ask click/Escape close, file-preview close, model-switch Escape close, and successful asynchronous model-switch settlement at 1440px dark. It asserts the opener remains connected, visible, non-inert, and receives focus for synchronous close; for async success it asserts no additional opener focus event. Final result JSON and the representative screenshot are under `/private/tmp/department-ui-queued-focus-round422-evidence/group-round425-focus-lifecycle-final2/`; `browserErrors` is empty. Focused tests passed 71/71 and `npm run build` passed in the isolated worktree. A first test rerun failed because its VM fixture lacked the newly tracked opener variable and a source regex still expected the earlier inline expression; the fixture and assertion were aligned to the final implementation, then build and tests passed.

This is generated Webview plus fixture-host validation only. The prior 1440px/280px queue, iframe keyboard, and tabs results remain reused and were not rerun. No real CLI, department scheduler, persistence, Extension Host, EH, or model execution is covered. The behavior restores established dialog focus-return rules, so the central feature inventory does not need a product capability change.
