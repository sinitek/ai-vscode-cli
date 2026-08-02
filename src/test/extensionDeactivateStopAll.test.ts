import test = require("node:test");
import assert = require("node:assert/strict");
import fs = require("node:fs");
import path = require("node:path");

function readExtensionSource(): string {
  return fs.readFileSync(path.join(process.cwd(), "src", "extension.ts"), "utf8");
}

function extractFunctionSource(source: string, signature: string, nextSignature: string): string {
  const start = source.indexOf(signature);
  assert.notEqual(start, -1, `${signature} should exist`);
  const end = source.indexOf(nextSignature, start);
  assert.notEqual(end, -1, `${nextSignature} should follow ${signature}`);
  return source.slice(start, end);
}

test("deactivate routes through stopAllRuns after blocking new runs", () => {
  const extensionSource = readExtensionSource();
  const deactivateSource = extractFunctionSource(
    extensionSource,
    "export function deactivate(): void",
    "function stopAllRuns(): void",
  );

  assert.match(deactivateSource, /isExtensionDeactivating = true;/u);
  assert.match(deactivateSource, /loopAutoWakeScheduler\?\.dispose\(\);/u);
  assert.match(deactivateSource, /graphControlsHost\.disposeGraphAutoWakeScheduler\(\);/u);
  assert.match(deactivateSource, /stopAllRuns\(\);/u);
});

test("stopAllRuns covers active, parallel, interactive, and managed runners", () => {
  const extensionSource = readExtensionSource();
  const stopAllRunsSource = extractFunctionSource(
    extensionSource,
    "function stopAllRuns(): void",
    "async function maybeDisableMarketplaceUpdateCheckInDev",
  );

  assert.match(stopAllRunsSource, /isExtensionDeactivating = true;/u);
  assert.match(stopAllRunsSource, /Array\.from\(interactiveRunsByTabId\.entries\(\)\)/u);
  assert.match(stopAllRunsSource, /run\.stop\(\);/u);
  assert.match(stopAllRunsSource, /interactiveRunsByTabId\.delete\(tabId\);/u);
  assert.match(stopAllRunsSource, /Array\.from\(parallelRunsByTabId\.entries\(\)\)/u);
  assert.match(stopAllRunsSource, /stopParallelRunForTab\(tabId, t\("run\.stoppedByUser"\)\);/u);
  assert.match(stopAllRunsSource, /run\.process\.kill\(\);/u);
  assert.match(stopAllRunsSource, /const activeStop = activeInteractiveStop;/u);
  assert.match(stopAllRunsSource, /activeStop\(\);/u);
  assert.match(stopAllRunsSource, /if \(activeProcess\) \{[\s\S]*stopActiveRun\(\);/u);
  assert.match(stopAllRunsSource, /activeProcess\.kill\(\);/u);
  assert.match(stopAllRunsSource, /clearActiveRun\(\);/u);
  assert.match(stopAllRunsSource, /interactiveRunnerManager\?\.disposeAll\(\);/u);
});

test("runPrompt refuses new work once extension deactivation starts", () => {
  const extensionSource = readExtensionSource();
  const runPromptSource = extractFunctionSource(
    extensionSource,
    "async function runPrompt(",
    "async function runPromptOneShot",
  );

  assert.match(runPromptSource, /if \(isExtensionDeactivating\) \{\s*return;\s*\}/u);
});
