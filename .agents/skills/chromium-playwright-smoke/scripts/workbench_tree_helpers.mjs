const DEFAULT_WORKSPACE_SCOPE_SELECTOR = 'section.panel-workspace:not(.is-collapsed)';
const DEFAULT_CHAT_SCOPE_SELECTOR = 'section.panel-chat:not(.is-collapsed)';
const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_SEGMENT_TIMEOUT_MS = 2500;
const DEFAULT_RETRY_INTERVAL_MS = 150;
const DEFAULT_REFRESH_ATTEMPTS = 3;

const ROW_SEMANTIC_PATH_ATTRIBUTES = [
  'data-path',
  'data-workspace-path',
  'data-node-path',
  'data-entry-path',
  'data-file-path',
  'data-directory-path',
  'aria-label',
  'title'
];

function sleep(page, ms) {
  if (page && typeof page.waitForTimeout === 'function') {
    return page.waitForTimeout(ms);
  }
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function normalizeWorkspacePath(value) {
  return String(value || '')
    .trim()
    .replace(/^@+/, '')
    .replace(/^\.\/+/, '')
    .replace(/^\/+/, '')
    .replace(/\/+/g, '/')
    .replace(/\/$/, '');
}

function splitWorkspacePath(value) {
  const normalizedPath = normalizeWorkspacePath(value);
  if (!normalizedPath) {
    throw new Error('workspace path is required');
  }
  const segments = normalizedPath.split('/').filter(Boolean);
  if (!segments.length) {
    throw new Error(`workspace path has no selectable segments: ${value}`);
  }
  return segments;
}

function buildDirectChildExpectedPath(parentPath, childName) {
  const normalizedParentPath = normalizeWorkspacePath(parentPath);
  const normalizedChildName = normalizeWorkspacePath(childName);
  return normalizedParentPath ? `${normalizedParentPath}/${normalizedChildName}` : normalizedChildName;
}

function normalizeSemanticPathCandidate(value) {
  const rawValue = String(value || '').trim();
  if (!rawValue) {
    return '';
  }
  return normalizeWorkspacePath(
    rawValue
      .replace(/^选择(?:文件|目录)\s+/, '')
      .replace(/（.*?）$/u, '')
  );
}

function uniqueNormalizedPaths(values) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    const normalizedPath = normalizeSemanticPathCandidate(value);
    if (!normalizedPath || seen.has(normalizedPath)) {
      continue;
    }
    seen.add(normalizedPath);
    result.push(normalizedPath);
  }
  return result;
}

function isComparableSemanticPath(value, expectedPath) {
  if (!value) {
    return false;
  }
  if (value === expectedPath) {
    return true;
  }
  return value.includes('/') || /\.[A-Za-z0-9]{1,12}$/.test(value);
}

function isDirectTreeRowSnapshotMatch(snapshot, expected) {
  if (!snapshot || snapshot.kind !== expected.kind) {
    return false;
  }
  if (snapshot.name !== expected.name) {
    return false;
  }

  const expectedPath = normalizeWorkspacePath(expected.expectedPath);
  if (!expectedPath) {
    return true;
  }

  const semanticPaths = Array.isArray(snapshot.semanticPaths)
    ? snapshot.semanticPaths.filter((item) => isComparableSemanticPath(item, expectedPath))
    : [];
  if (semanticPaths.length) {
    return semanticPaths.includes(expectedPath);
  }

  // Current TreeNode does not expose path attributes in single-select mode.
  // Direct-child scoping still prevents same-basename decoy matches.
  return true;
}

async function readDirectTreeRowsSnapshot(listLocator, kind) {
  return listLocator.evaluate(({ children }, args) => {
    const rows = [];
    Array.from(children || []).forEach((item, index) => {
      const row = item.querySelector(`:scope > .tree-row.tree-${args.kind}`);
      if (!row) {
        return;
      }
      const name = String(row.querySelector('.tree-node-name')?.textContent || '').trim();
      const semanticValues = [];
      for (const attributeName of args.attributes) {
        semanticValues.push(row.getAttribute(attributeName), item.getAttribute(attributeName));
      }
      row.querySelectorAll('[aria-label], [title], [data-path], [data-workspace-path], [data-node-path], [data-entry-path], [data-file-path], [data-directory-path]').forEach((element) => {
        for (const attributeName of args.attributes) {
          semanticValues.push(element.getAttribute(attributeName));
        }
      });
      rows.push({
        index,
        kind: args.kind,
        name,
        text: String(row.textContent || '').trim(),
        semanticPaths: Array.from(new Set(
          semanticValues
            .map((value) => String(value || '').trim())
            .filter(Boolean)
            .map((value) => value
              .replace(/^选择(?:文件|目录)\s+/, '')
              .replace(/（.*?）$/u, '')
              .replace(/^@+/, '')
              .replace(/^\.\/+/, '')
              .replace(/^\/+/, '')
              .replace(/\/+/g, '/')
              .replace(/\/$/, ''))
            .filter(Boolean)
        ))
      });
    });
    return rows;
  }, { kind, attributes: ROW_SEMANTIC_PATH_ATTRIBUTES });
}

async function scrollTreeContainerForVirtualRows(listLocator, phase) {
  return listLocator.evaluate((list, scrollPhase) => {
    const candidates = [
      list,
      list.closest('.workspace-file-accordion-body'),
      list.closest('.chat-reference-tree'),
      list.closest('.tree-list')
    ].filter(Boolean);
    const scrollContainer = candidates.find((element) => element.scrollHeight > element.clientHeight + 2);
    if (!scrollContainer) {
      return false;
    }
    const nextTop = scrollPhase % 2 === 0 ? 0 : scrollContainer.scrollHeight;
    scrollContainer.scrollTop = nextTop;
    return true;
  }, phase).catch(() => false);
}

function buildTreeLookupError(kind, name, snapshot, expectedPath) {
  const available = (snapshot || [])
    .map((item) => {
      const suffix = item.semanticPaths?.length ? ` [${item.semanticPaths.join(', ')}]` : '';
      return `${item.name}${suffix}`;
    })
    .join(', ');
  const pathHint = expectedPath ? ` at ${expectedPath}` : '';
  return new Error(`direct ${kind} row not found: ${name}${pathHint}; available direct ${kind} rows: ${available || '<none>'}`);
}

async function findDirectTreeRowByName(listLocator, kind, name, options = {}) {
  const timeoutMs = options.timeoutMs ?? DEFAULT_SEGMENT_TIMEOUT_MS;
  const retryIntervalMs = options.retryIntervalMs ?? DEFAULT_RETRY_INTERVAL_MS;
  const expectedPath = normalizeWorkspacePath(options.expectedPath);
  const deadline = Date.now() + timeoutMs;
  let lastSnapshot = [];
  let phase = 0;

  do {
    await listLocator.waitFor({ state: 'visible', timeout: Math.max(500, retryIntervalMs * 2) });
    const snapshot = await readDirectTreeRowsSnapshot(listLocator, kind).catch(() => []);
    lastSnapshot = snapshot;
    const match = snapshot.find((item) => isDirectTreeRowSnapshotMatch(item, { kind, name, expectedPath }));
    if (match) {
      const item = listLocator.locator(':scope > li').nth(match.index);
      const row = item.locator(`:scope > .tree-row.tree-${kind}`).first();
      return { item, row, index: match.index, snapshot: match };
    }
    await scrollTreeContainerForVirtualRows(listLocator, phase);
    phase += 1;
    await sleep(options.page, retryIntervalMs);
  } while (Date.now() < deadline);

  throw buildTreeLookupError(kind, name, lastSnapshot, expectedPath);
}

async function getActiveWorkbenchWorkspacePanel(page, options = {}) {
  const scopeSelector = options.scopeSelector || DEFAULT_WORKSPACE_SCOPE_SELECTOR;
  const panel = page
    .locator(scopeSelector)
    .filter({ has: page.locator('.workspace-file-accordion-body, .workspace-accordion-trigger') })
    .first();
  await panel.waitFor({ state: 'visible', timeout: options.timeoutMs || DEFAULT_TIMEOUT_MS });
  return panel;
}

async function ensureFilesAccordionExpanded(panel, options = {}) {
  const filesTrigger = panel.locator('.workspace-accordion-trigger', { hasText: '文件' }).first();
  if (await filesTrigger.count()) {
    const expanded = await filesTrigger.getAttribute('aria-expanded');
    if (expanded !== 'true') {
      await filesTrigger.click();
    }
  }

  const fileBody = panel.locator('.workspace-file-accordion-body').first();
  await fileBody.waitFor({ state: 'visible', timeout: options.timeoutMs || DEFAULT_TIMEOUT_MS });
  return fileBody;
}

async function clearWorkspaceFileSearch(panel) {
  const clearButton = panel.locator('.workspace-search-clear').first();
  if (await clearButton.isVisible({ timeout: 300 }).catch(() => false)) {
    await clearButton.click();
  }
  const searchInput = panel.locator('.workspace-search-row input').first();
  if (await searchInput.isVisible({ timeout: 300 }).catch(() => false)) {
    const currentValue = await searchInput.inputValue().catch(() => '');
    if (currentValue) {
      await searchInput.fill('');
    }
  }
}

async function waitForWorkspaceTreeReady(fileBody, options = {}) {
  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
  await fileBody.locator('.tree-list:visible, .empty-state:visible').first().waitFor({ state: 'visible', timeout: timeoutMs });
  const tree = fileBody.locator('.tree-list:visible').first();
  await tree.waitFor({ state: 'visible', timeout: timeoutMs });
  return tree;
}

export async function refreshWorkbenchFileTree(page, options = {}) {
  const panel = await getActiveWorkbenchWorkspacePanel(page, options);
  await ensureFilesAccordionExpanded(panel, options);
  await clearWorkspaceFileSearch(panel);
  const refreshButton = panel.locator('button[aria-label="刷新目录树"], button[title="刷新目录树"]').first();
  if (await refreshButton.isVisible({ timeout: 1000 }).catch(() => false)) {
    await refreshButton.click();
    const fileBody = panel.locator('.workspace-file-accordion-body').first();
    await waitForWorkspaceTreeReady(fileBody, options);
    await sleep(page, options.refreshSettleMs ?? 300);
    return true;
  }

  if (options.allowReloadFallback !== false && typeof page.reload === 'function') {
    await page.reload({ waitUntil: 'domcontentloaded', timeout: options.timeoutMs || DEFAULT_TIMEOUT_MS });
    await getActiveWorkbenchFileTree(page, options);
    return true;
  }
  return false;
}

export async function getActiveWorkbenchFileTree(page, options = {}) {
  const panel = await getActiveWorkbenchWorkspacePanel(page, options);
  const fileBody = await ensureFilesAccordionExpanded(panel, options);
  await clearWorkspaceFileSearch(panel);
  return waitForWorkspaceTreeReady(fileBody, options);
}

async function ensureDirectoryExpanded(directoryItem, directoryRow, options = {}) {
  let childList = directoryItem.locator(':scope > ul.tree-list').first();
  if (await childList.count() > 0 && await childList.isVisible().catch(() => false)) {
    return childList;
  }

  const toggle = directoryRow.locator('.tree-arrow').first();
  if (await toggle.count() > 0) {
    await toggle.click();
  } else {
    await directoryRow.click();
  }

  childList = directoryItem.locator(':scope > ul.tree-list').first();
  await childList.waitFor({ state: 'visible', timeout: options.timeoutMs || DEFAULT_TIMEOUT_MS });
  await sleep(options.page, options.expandSettleMs ?? 100);
  return childList;
}

async function selectWorkbenchFileByPathOnce(page, targetPath, options = {}) {
  const segments = splitWorkspacePath(targetPath);
  const normalizedTargetPath = normalizeWorkspacePath(targetPath);
  const fileName = segments.at(-1);
  const directorySegments = segments.slice(0, -1);
  const segmentTimeoutMs = options.segmentTimeoutMs ?? DEFAULT_SEGMENT_TIMEOUT_MS;
  let currentList = await getActiveWorkbenchFileTree(page, options);
  let parentPath = '';

  for (const directoryName of directorySegments) {
    const expectedPath = buildDirectChildExpectedPath(parentPath, directoryName);
    const { item, row } = await findDirectTreeRowByName(currentList, 'directory', directoryName, {
      ...options,
      page,
      expectedPath,
      timeoutMs: segmentTimeoutMs
    });
    await row.scrollIntoViewIfNeeded();
    currentList = await ensureDirectoryExpanded(item, row, { ...options, page });
    parentPath = expectedPath;
  }

  const { row } = await findDirectTreeRowByName(currentList, 'file', fileName, {
    ...options,
    page,
    expectedPath: normalizedTargetPath,
    timeoutMs: segmentTimeoutMs
  });
  await row.scrollIntoViewIfNeeded();
  await row.click();
  await row.waitFor({ state: 'visible', timeout: options.timeoutMs || DEFAULT_TIMEOUT_MS });
  return {
    path: normalizedTargetPath,
    fileName,
    row
  };
}

function shouldRefreshAfterTreeLookupError(error) {
  return /direct (directory|file) row not found/i.test(String(error?.message || ''));
}

export async function selectWorkbenchFileByPath(page, targetPath, options = {}) {
  const maxRefreshAttempts = options.maxRefreshAttempts ?? DEFAULT_REFRESH_ATTEMPTS;
  let lastError = null;

  for (let attempt = 0; attempt <= maxRefreshAttempts; attempt += 1) {
    try {
      return await selectWorkbenchFileByPathOnce(page, targetPath, options);
    } catch (error) {
      lastError = error;
      if (attempt >= maxRefreshAttempts || !shouldRefreshAfterTreeLookupError(error)) {
        throw error;
      }
      await refreshWorkbenchFileTree(page, options);
    }
  }

  throw lastError;
}

async function getActiveWorkbenchChatScope(page, options = {}) {
  const scopeSelector = options.chatScopeSelector || DEFAULT_CHAT_SCOPE_SELECTOR;
  const panel = page
    .locator(scopeSelector)
    .filter({ has: page.locator('.chat-input-box') })
    .first();
  if (await panel.isVisible({ timeout: options.optionalTimeoutMs || 1200 }).catch(() => false)) {
    return panel;
  }
  return page;
}

export async function dismissWorkbenchSelectedFileChip(page, options = {}) {
  const scope = await getActiveWorkbenchChatScope(page, options);
  const chip = scope.locator(options.chipSelector || '.chat-target-file-chip').first();
  if (!await chip.isVisible({ timeout: options.optionalTimeoutMs || 1200 }).catch(() => false)) {
    return false;
  }
  await chip.locator(options.dismissSelector || '.chat-target-file-chip-dismiss').click();
  await chip.waitFor({ state: 'hidden', timeout: options.timeoutMs || DEFAULT_TIMEOUT_MS });
  return true;
}

function assertNormalizedPathEqual(actualPath, expectedPath, label) {
  const normalizedExpectedPath = normalizeWorkspacePath(expectedPath);
  const normalizedActualPath = normalizeWorkspacePath(actualPath);
  if (normalizedActualPath !== normalizedExpectedPath) {
    throw new Error(`${label} mismatch: expected ${normalizedExpectedPath}, got ${normalizedActualPath || '<empty>'}`);
  }
}

function assertNormalizedPathArrayEqual(actualPaths, expectedPaths, label) {
  const normalizedExpectedPaths = expectedPaths.map((item) => normalizeWorkspacePath(item)).filter(Boolean);
  const normalizedActualPaths = Array.isArray(actualPaths)
    ? actualPaths.map((item) => normalizeWorkspacePath(typeof item === 'string' ? item : item?.path || item?.filePath)).filter(Boolean)
    : [];
  if (
    normalizedActualPaths.length !== normalizedExpectedPaths.length
    || normalizedActualPaths.some((item, index) => item !== normalizedExpectedPaths[index])
  ) {
    throw new Error(`${label} mismatch: expected ${JSON.stringify(normalizedExpectedPaths)}, got ${JSON.stringify(normalizedActualPaths)}`);
  }
}

function assertTextEqual(actualValue, expectedValue, label) {
  const normalizedActualValue = String(actualValue || '').trim();
  const normalizedExpectedValue = String(expectedValue || '').trim();
  if (normalizedActualValue !== normalizedExpectedValue) {
    throw new Error(`${label} mismatch: expected ${normalizedExpectedValue || '<empty>'}, got ${normalizedActualValue || '<empty>'}`);
  }
}

function normalizeWorkbenchRequestPath(url) {
  try {
    return new URL(String(url || ''), 'http://workbench.local').pathname.replace(/\/+$/, '') || '/';
  } catch {
    return String(url || '').split('?')[0].replace(/\/+$/, '') || '/';
  }
}

function isFormalWorkbenchChatSubmissionPath(path) {
  const normalizedPath = normalizeWorkbenchRequestPath(path);
  return normalizedPath === '/api/workbench/chat/stream'
    || normalizedPath === '/api/workbench/chat'
    || normalizedPath === '/api/workbench/chat/task'
    || normalizedPath === '/api/workbench/chat/tasks'
    || normalizedPath === '/api/workbench/chat/stream/task'
    || normalizedPath === '/api/workbench/chat/stream/tasks';
}

function isWorkbenchChatResumeOrControlPath(path) {
  const normalizedPath = normalizeWorkbenchRequestPath(path);
  return /\/(?:resume|abort|active|interaction)(?:\/|$)/.test(normalizedPath)
    || normalizedPath.includes('/api/workbench/chat/sessions/')
    || normalizedPath.includes('/api/workbench/chat-prompt-history/');
}

function readWorkbenchRequestJsonPayload(request) {
  if (!request) {
    return null;
  }
  if (typeof request.postDataJSON === 'function') {
    try {
      const payload = request.postDataJSON();
      if (payload && typeof payload === 'object') {
        return payload;
      }
    } catch {
      // Fall through to raw body parsing for non-JSON Playwright payloads.
    }
  }
  if (typeof request.postData === 'function') {
    try {
      const rawBody = request.postData();
      if (rawBody) {
        return JSON.parse(rawBody);
      }
    } catch {
      return null;
    }
  }
  return null;
}

function normalizeWorkbenchSubmitMessage(payload) {
  return String(
    payload?.message
    || payload?.turnEnvelope?.message
    || payload?.displayUserMessage
    || payload?.turnEnvelope?.displayUserMessage
    || ''
  ).trim();
}

function payloadIncludesSelectedFile(payload, expectedPath) {
  const normalizedExpectedPath = normalizeWorkspacePath(expectedPath);
  if (!normalizedExpectedPath) {
    return true;
  }
  const selectedPaths = [
    payload?.selectedFilePath,
    payload?.turnEnvelope?.selectedFilePath
  ]
    .map((item) => normalizeWorkspacePath(item))
    .filter(Boolean);
  return selectedPaths.length > 0
    && selectedPaths.every((item) => item === normalizedExpectedPath);
}

export function isWorkbenchChatSubmissionRequest(request, options = {}) {
  const method = typeof request?.method === 'function'
    ? String(request.method() || '').toUpperCase()
    : String(request?.method || '').toUpperCase();
  if (method !== 'POST') {
    return false;
  }

  const url = typeof request?.url === 'function' ? request.url() : request?.url;
  const path = normalizeWorkbenchRequestPath(url);
  if (!isFormalWorkbenchChatSubmissionPath(path) || isWorkbenchChatResumeOrControlPath(path)) {
    return false;
  }

  const payload = readWorkbenchRequestJsonPayload(request);
  if (!payload) {
    return false;
  }

  const messageNeedle = String(options.messageNeedle || '').trim();
  if (messageNeedle && !normalizeWorkbenchSubmitMessage(payload).includes(messageNeedle)) {
    return false;
  }
  if (!payloadIncludesSelectedFile(payload, options.expectedSelectedFilePath || '')) {
    return false;
  }
  const expectedRuntimeTarget = String(options.expectedRuntimeTarget || '').trim();
  if (expectedRuntimeTarget) {
    const actualRuntimeTarget = String(
      payload.selectedRuntimeTarget
      || payload.turnEnvelope?.selectedRuntimeTarget
      || payload.executionProfile?.selectedRuntimeTarget
      || ''
    ).trim();
    if (actualRuntimeTarget !== expectedRuntimeTarget) {
      return false;
    }
  }
  return true;
}

export async function waitForWorkbenchChatSubmissionRequest(page, options = {}) {
  return page.waitForRequest(
    (request) => isWorkbenchChatSubmissionRequest(request, options),
    { timeout: options.timeoutMs || 60000 }
  );
}

export async function captureWorkbenchChatSubmissionRequest(page, trigger, options = {}) {
  const requestPromise = waitForWorkbenchChatSubmissionRequest(page, options);
  await trigger();
  return requestPromise;
}

export async function assertWorkbenchSelectedFileRequestPayload(payload, expectedPath, options = {}) {
  const normalizedExpectedPath = normalizeWorkspacePath(expectedPath);
  assertNormalizedPathEqual(payload?.selectedFilePath, normalizedExpectedPath, 'selectedFilePath');
  assertNormalizedPathEqual(payload?.turnEnvelope?.selectedFilePath, normalizedExpectedPath, 'turnEnvelope.selectedFilePath');

  const referenceFiles = Array.isArray(payload?.turnEnvelope?.fileContext?.resolvedReferenceFiles)
    ? payload.turnEnvelope.fileContext.resolvedReferenceFiles.map((item) => normalizeWorkspacePath(item?.path))
    : [];
  if (!referenceFiles.includes(normalizedExpectedPath)) {
    throw new Error(`turnEnvelope.fileContext.resolvedReferenceFiles missing ${normalizedExpectedPath}`);
  }

  const legacyReferencePaths = Array.isArray(payload?.referencePaths)
    ? payload.referencePaths.map((item) => normalizeWorkspacePath(item))
    : [];
  if (options.requireLegacyReferencePath === true && !legacyReferencePaths.includes(normalizedExpectedPath)) {
    throw new Error(`referencePaths missing ${normalizedExpectedPath}`);
  }
  if (options.exactReferencePaths === true) {
    const expectedReferencePaths = Array.isArray(options.expectedReferencePaths)
      ? options.expectedReferencePaths
      : [];
    assertNormalizedPathArrayEqual(payload?.referencePaths, expectedReferencePaths, 'referencePaths');
  }
  if (options.exactResolvedReferenceFiles === true) {
    const expectedResolvedReferenceFiles = Array.isArray(options.expectedResolvedReferenceFiles)
      ? options.expectedResolvedReferenceFiles
      : [normalizedExpectedPath];
    assertNormalizedPathArrayEqual(
      payload?.turnEnvelope?.fileContext?.resolvedReferenceFiles,
      expectedResolvedReferenceFiles,
      'turnEnvelope.fileContext.resolvedReferenceFiles'
    );
  }
  if (options.exactEditableFiles === true) {
    const expectedEditableFiles = Array.isArray(options.expectedEditableFiles)
      ? options.expectedEditableFiles
      : [];
    assertNormalizedPathArrayEqual(payload?.turnEnvelope?.fileContext?.editableFiles, expectedEditableFiles, 'turnEnvelope.fileContext.editableFiles');
  }

  const writeTargetPath = normalizeWorkspacePath(payload?.turnEnvelope?.fileContext?.writeTargetPath);
  const editTargetFile = normalizeWorkspacePath(
    payload?.turnEnvelope?.fileContext?.editTargetFile
    || payload?.turnEnvelope?.fileContext?.editTargetPath
  );
  if (options.expectedEditTargetFile !== undefined) {
    assertNormalizedPathEqual(editTargetFile, options.expectedEditTargetFile, 'turnEnvelope.fileContext.editTargetFile');
  }
  if (options.expectedWriteTargetPath !== undefined) {
    assertNormalizedPathEqual(writeTargetPath, options.expectedWriteTargetPath, 'turnEnvelope.fileContext.writeTargetPath');
  }
  if (options.expectedWorkspaceAccessLevel !== undefined) {
    assertTextEqual(
      payload?.turnEnvelope?.fileContext?.workspaceAccessLevel,
      options.expectedWorkspaceAccessLevel,
      'turnEnvelope.fileContext.workspaceAccessLevel'
    );
  }
  if (options.expectedWorkspaceWriteScope !== undefined) {
    assertTextEqual(
      payload?.turnEnvelope?.fileContext?.workspaceWriteScope,
      options.expectedWorkspaceWriteScope,
      'turnEnvelope.fileContext.workspaceWriteScope'
    );
  }
  const selectedRuntimeTarget = String(payload?.turnEnvelope?.selectedRuntimeTarget || payload?.selectedRuntimeTarget || '').trim();
  if (selectedRuntimeTarget === 'lobster-assistant') {
    if (options.expectedWriteTargetPath === undefined) {
      assertNormalizedPathEqual(writeTargetPath, normalizedExpectedPath, 'turnEnvelope.fileContext.writeTargetPath');
    }
    if (options.expectedEditTargetFile === undefined && editTargetFile) {
      throw new Error(`lobster runtime request should keep edit target empty, got editTargetFile=${editTargetFile}`);
    }
  }

  return true;
}

export const workbenchTreeHelperInternals = Object.freeze({
  normalizeWorkspacePath,
  splitWorkspacePath,
  buildDirectChildExpectedPath,
  uniqueNormalizedPaths,
  isDirectTreeRowSnapshotMatch,
  normalizeWorkbenchRequestPath,
  isFormalWorkbenchChatSubmissionPath,
  isWorkbenchChatResumeOrControlPath,
  readWorkbenchRequestJsonPayload,
  isWorkbenchChatSubmissionRequest
});
