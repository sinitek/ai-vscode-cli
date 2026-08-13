# Workbench Tree Selection

Use `scripts/workbench_tree_helpers.mjs` when Chromium acceptance needs to select a nested workbench file.

## Rules

- Scope to the active workbench workspace panel first: `section.panel-workspace:not(.is-collapsed)`.
- Keep the file accordion open and clear the workspace file search before resolving a target path.
- Resolve the root tree as the first visible `.tree-list` inside `.workspace-file-accordion-body`; the root list may be wrapped by a scroll container, so do not require it to be a direct child of the accordion body.
- Expand directories one segment at a time from the requested workspace-relative path.
- Match each segment as a direct child of the current tree list; do not search a global basename such as `selected.md`.
- Prefer direct-row semantic path attributes when present (`data-path`, `data-workspace-path`, `aria-label`, `title`) and fall back to exact direct-child name matching only inside the current list.
- On a missing direct child, use bounded retries: click the panel's `刷新目录树` action, reacquire the active tree, and traverse the full path again. Do not encode round ids, usernames, or fixed file names.
- Scroll candidate tree containers while retrying so virtualized or off-screen direct children can mount, then call `scrollIntoViewIfNeeded()` before clicking the resolved row.
- Register the formal chat submission request listener before clicking send. Use `waitForWorkbenchChatSubmissionRequest` or `captureWorkbenchChatSubmissionRequest`; do not hardcode only `/api/workbench/chat/stream`, and do not count resume, polling, abort, active-task, history, or interaction requests as the user submission.
- Intercept the formal chat submission request and verify selected-file fields in both legacy payload fields and `turnEnvelope.fileContext`: `selectedFilePath`, reference paths, resolved reference files, editable files, edit target, write target, and runtime target semantics.
- Dismiss the chip with `dismissWorkbenchSelectedFileChip` before reset/no-selection cases; scope dismissal to the active chat panel and verify the chip becomes hidden.
- Do not swallow real request, protocol, console, page, HTTP, or network failures. The helper only retries bounded tree lookup misses.

## API Fixture Boundary

Chromium tests often create workbench files through same-context API calls before using the UI tree. The React tree can stay on an older snapshot until auto-refresh or a manual refresh runs. If API readback proves a path exists but the tree DOM is missing a direct child, classify the immediate failure as a harness/tree-refresh boundary until a targeted real UI retry proves otherwise.

Round 37 hit this exact case: `notes/selected.md` and `notes/archive/selected.md` were created and read back through API, but the captured workbench DOM still showed the round workspace without `notes`, and the old helper failed at `direct directory row not found: notes`. The product selected-file payload/writeback path was not exercised in that run.

## Minimal Usage

```js
import {
  assertWorkbenchSelectedFileRequestPayload,
  captureWorkbenchChatSubmissionRequest,
  dismissWorkbenchSelectedFileChip,
  selectWorkbenchFileByPath
} from './.agents/skills/chromium-playwright-smoke/scripts/workbench_tree_helpers.mjs';

const targetPath = process.env.WORKBENCH_TARGET_FILE;
await selectWorkbenchFileByPath(page, targetPath, {
  maxRefreshAttempts: 3,
  segmentTimeoutMs: 2500
});

const request = await captureWorkbenchChatSubmissionRequest(
  page,
  () => page.getByRole('button', { name: '发送', exact: true }).click(),
  {
    expectedSelectedFilePath: targetPath,
    expectedRuntimeTarget: 'lobster-assistant',
    messageNeedle: process.env.WORKBENCH_MESSAGE_NEEDLE || ''
  }
);
assertWorkbenchSelectedFileRequestPayload(request.postDataJSON(), targetPath, {
  exactReferencePaths: true,
  expectedReferencePaths: [],
  exactResolvedReferenceFiles: true,
  expectedResolvedReferenceFiles: [targetPath],
  exactEditableFiles: true,
  expectedEditableFiles: [],
  expectedEditTargetFile: '',
  expectedWriteTargetPath: targetPath,
  expectedWorkspaceAccessLevel: 'write',
  expectedWorkspaceWriteScope: 'workspace'
});
await dismissWorkbenchSelectedFileChip(page);
```

## Real UI Acceptance Boundary

Helper success is not product success. A selected-file acceptance item is product-passing only after a credential-backed real Chromium run captures:

- visible chip title/path for the intended file;
- intercepted request payload with `selectedFilePath`, empty legacy `referencePaths` when expected, `resolvedReferenceFiles=[target]`, empty editable/edit target, `writeTargetPath=[target]`, `workspaceAccessLevel=write`, `workspaceWriteScope=workspace`, and `selectedRuntimeTarget=lobster-assistant`;
- output/readback proving the intended file changed and same-basename decoys did not;
- reset/no-selection/out-of-scope cases proving no stale selected-file state is reused;
- strict browser console/page/request/HTTP results.
