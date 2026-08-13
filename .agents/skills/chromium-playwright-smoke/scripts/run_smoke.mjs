#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import {
  existsSync,
  readdirSync,
  statSync
} from 'node:fs';
import {
  mkdir,
  readFile,
  writeFile
} from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const SCENARIO_SCHEMA_VERSION = 1;
const DEFAULT_PLAYWRIGHT_VERSION = '1.61.1';
const DEFAULT_PLAYWRIGHT_INSTALL_ROOT = path.join(os.tmpdir(), 'zq-playwright-smoke');
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_SETTLE_MS = 500;

function parseArguments(argv) {
  const options = {
    scenarioPath: '',
    installIfMissing: false,
    playwrightVersion: process.env.PLAYWRIGHT_VERSION || DEFAULT_PLAYWRIGHT_VERSION,
    playwrightInstallRoot: process.env.PLAYWRIGHT_INSTALL_ROOT || DEFAULT_PLAYWRIGHT_INSTALL_ROOT,
    help: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--scenario') {
      options.scenarioPath = argv[index + 1] || '';
      index += 1;
    } else if (argument === '--install-if-missing') {
      options.installIfMissing = true;
    } else if (argument === '--playwright-version') {
      options.playwrightVersion = argv[index + 1] || '';
      index += 1;
    } else if (argument === '--playwright-install-root') {
      options.playwrightInstallRoot = argv[index + 1] || '';
      index += 1;
    } else if (argument === '--help' || argument === '-h') {
      options.help = true;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }

  return options;
}

function printHelp() {
  console.log(`Usage:
  node run_smoke.mjs --scenario <scenario.json> [--install-if-missing]

Options:
  --scenario <path>                 Structured smoke scenario.
  --install-if-missing              Install Playwright/Chromium in an isolated temp root.
  --playwright-version <version>    Playwright version used for isolated installation.
  --playwright-install-root <path>  Isolated installation root.
  --help                            Show this help.`);
}

function assertCondition(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function sanitizeName(value) {
  return String(value || 'smoke')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'smoke';
}

function normalizeVisibleText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function resolveUrl(baseUrl, targetUrl) {
  return new URL(String(targetUrl || ''), String(baseUrl || '')).toString();
}

function validateScenario(scenario) {
  assertCondition(isPlainObject(scenario), 'Scenario root must be a JSON object.');
  assertCondition(scenario.schemaVersion === SCENARIO_SCHEMA_VERSION, `schemaVersion must be ${SCENARIO_SCHEMA_VERSION}.`);
  assertCondition(typeof scenario.name === 'string' && scenario.name.trim(), 'Scenario name is required.');
  assertCondition(typeof scenario.baseUrl === 'string' && scenario.baseUrl.trim(), 'baseUrl is required.');
  assertCondition(typeof scenario.moduleUrl === 'string' && scenario.moduleUrl.trim(), 'moduleUrl is required.');
  assertCondition(!scenario.actions || Array.isArray(scenario.actions), 'actions must be an array.');
  assertCondition(!scenario.checks || Array.isArray(scenario.checks), 'checks must be an array.');
  assertCondition(!scenario.allowedHttpErrors || Array.isArray(scenario.allowedHttpErrors), 'allowedHttpErrors must be an array.');
  assertCondition(!scenario.allowedRequestFailures || Array.isArray(scenario.allowedRequestFailures), 'allowedRequestFailures must be an array.');
}

function resolveModuleEntry(candidatePath) {
  if (!candidatePath) {
    return '';
  }
  const resolvedCandidate = path.resolve(candidatePath);
  if (existsSync(resolvedCandidate) && statSync(resolvedCandidate).isFile()) {
    return resolvedCandidate;
  }
  for (const fileName of ['index.mjs', 'index.js']) {
    const entryPath = path.join(resolvedCandidate, fileName);
    if (existsSync(entryPath)) {
      return entryPath;
    }
  }
  return '';
}

function resolveProjectPlaywrightEntry() {
  try {
    return createRequire(import.meta.url).resolve('playwright');
  } catch {
    return '';
  }
}

function installPlaywright(options) {
  const packageSpecifier = `playwright@${options.playwrightVersion}`;
  const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const result = spawnSync(
    npmCommand,
    [
      'install',
      '--prefix',
      options.playwrightInstallRoot,
      '--no-save',
      '--package-lock=false',
      packageSpecifier
    ],
    { stdio: 'inherit' }
  );
  assertCondition(result.status === 0, `Failed to install ${packageSpecifier} in ${options.playwrightInstallRoot}.`);
}

async function loadPlaywright(options) {
  const isolatedEntry = path.join(options.playwrightInstallRoot, 'node_modules', 'playwright', 'index.mjs');
  const candidateEntries = [
    resolveModuleEntry(process.env.PLAYWRIGHT_MODULE_PATH || ''),
    resolveProjectPlaywrightEntry(),
    resolveModuleEntry(isolatedEntry)
  ].filter(Boolean);

  let moduleEntry = candidateEntries.find((entryPath) => existsSync(entryPath)) || '';
  if (!moduleEntry && options.installIfMissing) {
    installPlaywright(options);
    moduleEntry = resolveModuleEntry(isolatedEntry);
  }

  assertCondition(
    moduleEntry,
    `Playwright is not installed. Re-run with --install-if-missing or set PLAYWRIGHT_MODULE_PATH.`
  );

  const playwrightModule = await import(pathToFileURL(moduleEntry).href);
  assertCondition(playwrightModule.chromium, `Playwright module does not expose chromium: ${moduleEntry}`);
  return {
    chromium: playwrightModule.chromium,
    moduleRoot: path.dirname(moduleEntry)
  };
}

function readDirectoryNames(directoryPath) {
  try {
    return readdirSync(directoryPath, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

function findCachedChromiumExecutable() {
  const cacheRoots = [
    path.join(os.homedir(), 'Library', 'Caches', 'ms-playwright'),
    path.join(os.homedir(), '.cache', 'ms-playwright'),
    process.env.LOCALAPPDATA
      ? path.join(process.env.LOCALAPPDATA, 'ms-playwright')
      : ''
  ].filter(Boolean);
  const candidates = [];

  for (const cacheRoot of cacheRoots) {
    const chromiumDirectories = readDirectoryNames(cacheRoot)
      .filter((name) => /^chromium-\d+$/.test(name))
      .sort((left, right) => Number(right.split('-').at(-1)) - Number(left.split('-').at(-1)));
    for (const directoryName of chromiumDirectories) {
      const chromiumRoot = path.join(cacheRoot, directoryName);
      candidates.push(
        path.join(chromiumRoot, 'chrome-mac-arm64', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing'),
        path.join(chromiumRoot, 'chrome-mac-x64', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing'),
        path.join(chromiumRoot, 'chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'),
        path.join(chromiumRoot, 'chrome-linux64', 'chrome'),
        path.join(chromiumRoot, 'chrome-linux', 'chrome'),
        path.join(chromiumRoot, 'chrome-win64', 'chrome.exe'),
        path.join(chromiumRoot, 'chrome-win', 'chrome.exe')
      );
    }
  }

  candidates.push(
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser'
  );
  return candidates.find((candidate) => existsSync(candidate)) || '';
}

function installChromium(moduleRoot) {
  const playwrightCliPath = path.join(moduleRoot, 'cli.js');
  assertCondition(existsSync(playwrightCliPath), `Playwright CLI not found: ${playwrightCliPath}`);
  const result = spawnSync(process.execPath, [playwrightCliPath, 'install', 'chromium'], { stdio: 'inherit' });
  assertCondition(result.status === 0, 'Failed to install Chromium for Playwright.');
}

async function launchChromium({ chromium, moduleRoot, scenario, options }) {
  const configuredExecutable = String(
    scenario.chromiumExecutable
      || process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
      || findCachedChromiumExecutable()
      || ''
  ).trim();
  const launchOptions = {
    ...(isPlainObject(scenario.launchOptions) ? scenario.launchOptions : {}),
    headless: true,
    ...(configuredExecutable ? { executablePath: configuredExecutable } : {})
  };

  try {
    return await chromium.launch(launchOptions);
  } catch (launchError) {
    if (!options.installIfMissing) {
      throw launchError;
    }
    installChromium(moduleRoot);
    return chromium.launch({
      ...(isPlainObject(scenario.launchOptions) ? scenario.launchOptions : {}),
      headless: true
    });
  }
}

function resolveLocator(page, target) {
  if (typeof target.selector === 'string' && target.selector.trim()) {
    return page.locator(target.selector);
  }
  if (typeof target.role === 'string' && target.role.trim()) {
    return page.getByRole(target.role, {
      ...(typeof target.name === 'string' ? { name: target.name } : {}),
      ...(typeof target.exact === 'boolean' ? { exact: target.exact } : {})
    });
  }
  if (typeof target.text === 'string') {
    return page.getByText(target.text, { exact: target.exact !== false });
  }
  throw new Error(`Locator requires selector, role, or text: ${JSON.stringify(target)}`);
}

async function performAction(page, locatorRoot, action) {
  assertCondition(isPlainObject(action), 'Each action must be an object.');
  if (action.type === 'wait') {
    const waitMs = Number(action.ms || 0);
    assertCondition(Number.isFinite(waitMs) && waitMs >= 0, 'wait action requires non-negative ms.');
    await page.waitForTimeout(waitMs);
    return;
  }

  const locator = resolveLocator(locatorRoot, action);
  if (action.type === 'click') {
    await locator.click();
  } else if (action.type === 'fill') {
    const value = typeof action.valueEnv === 'string'
      ? process.env[action.valueEnv]
      : action.value;
    assertCondition(typeof value === 'string', 'fill action requires value or a populated valueEnv.');
    await locator.fill(value);
  } else if (action.type === 'press') {
    assertCondition(typeof action.key === 'string' && action.key, 'press action requires key.');
    await locator.press(action.key);
  } else if (action.type === 'selectOption') {
    const optionValue = Array.isArray(action.values) ? action.values : action.value;
    assertCondition(optionValue !== undefined, 'selectOption action requires value or values.');
    await locator.selectOption(optionValue);
  } else if (action.type === 'hover') {
    await locator.hover();
  } else if (action.type === 'waitFor') {
    await locator.waitFor({ state: action.state || 'visible' });
  } else {
    throw new Error(`Unsupported action type: ${action.type}`);
  }
}

async function assertNoOverlap(page, locatorRoot, check) {
  assertCondition(Array.isArray(check.targets) && check.targets.length >= 2, 'noOverlap requires at least two targets.');
  const boxes = [];
  for (const target of check.targets) {
    const locator = resolveLocator(locatorRoot, target).first();
    await locator.waitFor({ state: 'visible' });
    const box = await locator.boundingBox();
    assertCondition(box, `Unable to read bounding box for ${JSON.stringify(target)}.`);
    boxes.push({ target, box });
  }

  for (let leftIndex = 0; leftIndex < boxes.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < boxes.length; rightIndex += 1) {
      const left = boxes[leftIndex];
      const right = boxes[rightIndex];
      const overlapWidth = Math.min(left.box.x + left.box.width, right.box.x + right.box.width) - Math.max(left.box.x, right.box.x);
      const overlapHeight = Math.min(left.box.y + left.box.height, right.box.y + right.box.height) - Math.max(left.box.y, right.box.y);
      assertCondition(
        overlapWidth <= 0 || overlapHeight <= 0,
        `Elements overlap: ${JSON.stringify(left.target)} and ${JSON.stringify(right.target)}.`
      );
    }
  }
}

async function performCheck(page, locatorRoot, check) {
  assertCondition(isPlainObject(check), 'Each check must be an object.');
  if (check.type === 'absentText') {
    assertCondition(typeof check.text === 'string', 'absentText requires text.');
    const count = await resolveLocator(locatorRoot, {
      text: check.text,
      exact: check.exact !== false
    }).count();
    assertCondition(count === 0, `Expected text to be absent: ${check.text}`);
    return;
  }
  if (check.type === 'noOverlap') {
    await assertNoOverlap(page, locatorRoot, check);
    return;
  }

  const locator = resolveLocator(locatorRoot, check);
  const first = locator.first();
  if (check.type === 'visible') {
    assertCondition(await first.isVisible(), `Expected locator to be visible: ${JSON.stringify(check)}`);
  } else if (check.type === 'hidden') {
    const count = await locator.count();
    assertCondition(count === 0 || !(await first.isVisible()), `Expected locator to be hidden: ${JSON.stringify(check)}`);
  } else if (check.type === 'enabled') {
    assertCondition(await first.isEnabled(), `Expected locator to be enabled: ${JSON.stringify(check)}`);
  } else if (check.type === 'disabled') {
    assertCondition(await first.isDisabled(), `Expected locator to be disabled: ${JSON.stringify(check)}`);
  } else if (check.type === 'count') {
    const actualCount = await locator.count();
    assertCondition(actualCount === Number(check.equals), `Expected count ${check.equals}, got ${actualCount}: ${JSON.stringify(check)}`);
  } else if (check.type === 'text') {
    const actualText = normalizeVisibleText(await first.innerText());
    assertCondition(actualText === normalizeVisibleText(check.equals), `Expected text "${check.equals}", got "${actualText}".`);
  } else if (check.type === 'containsText') {
    const actualText = normalizeVisibleText(await first.innerText());
    assertCondition(actualText.includes(normalizeVisibleText(check.includes)), `Expected text to include "${check.includes}", got "${actualText}".`);
  } else if (check.type === 'attribute') {
    assertCondition(typeof check.name === 'string' && check.name, 'attribute check requires name.');
    const actualValue = await first.getAttribute(check.name);
    assertCondition(actualValue === String(check.equals), `Expected ${check.name}="${check.equals}", got "${actualValue}".`);
  } else if (check.type === 'withinViewport') {
    await first.waitFor({ state: 'visible' });
    const box = await first.boundingBox();
    const viewport = page.viewportSize();
    assertCondition(box && viewport, `Unable to inspect viewport bounds: ${JSON.stringify(check)}`);
    assertCondition(
      box.x >= 0
        && box.y >= 0
        && box.x + box.width <= viewport.width
        && box.y + box.height <= viewport.height,
      `Element is outside the viewport: ${JSON.stringify(check)}`
    );
  } else {
    throw new Error(`Unsupported check type: ${check.type}`);
  }
}

function globToRegExp(pattern) {
  const escaped = String(pattern || '')
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`);
}

function isAllowedHttpError(url, status, allowedHttpErrors) {
  return allowedHttpErrors.some((rule) => {
    if (!isPlainObject(rule) || typeof rule.urlPattern !== 'string') {
      return false;
    }
    const statuses = Array.isArray(rule.statuses) ? rule.statuses.map(Number) : [];
    return globToRegExp(rule.urlPattern).test(url) && (statuses.length === 0 || statuses.includes(status));
  });
}

function isAllowedRequestFailure(method, url, errorText, allowedRequestFailures) {
  return allowedRequestFailures.some((rule) => {
    if (!isPlainObject(rule) || typeof rule.urlPattern !== 'string') {
      return false;
    }
    const methods = Array.isArray(rule.methods) ? rule.methods.map((value) => String(value).toUpperCase()) : [];
    const failureTexts = Array.isArray(rule.failureTexts) ? rule.failureTexts.map(String) : [];
    return globToRegExp(rule.urlPattern).test(url)
      && (methods.length === 0 || methods.includes(method.toUpperCase()))
      && failureTexts.length > 0
      && failureTexts.includes(errorText);
  });
}

async function authenticate(context, scenario) {
  if (!scenario.login) {
    return;
  }
  const login = scenario.login;
  assertCondition(isPlainObject(login), 'login must be an object.');
  const usernameEnv = login.usernameEnv || 'PLAYWRIGHT_USERNAME';
  const passwordEnv = login.passwordEnv || 'PLAYWRIGHT_PASSWORD';
  const username = process.env[usernameEnv];
  const password = process.env[passwordEnv];
  assertCondition(username, `Missing login username environment variable: ${usernameEnv}`);
  assertCondition(password, `Missing login password environment variable: ${passwordEnv}`);

  const payload = {
    ...(isPlainObject(login.payload) ? login.payload : {}),
    [login.usernameField || 'username']: username,
    [login.passwordField || 'password']: password
  };
  const response = await context.request.post(resolveUrl(scenario.baseUrl, login.path || '/api/auth/login'), { data: payload });
  if (!response.ok()) {
    const responseText = await response.text().catch(() => '');
    throw new Error(`Login failed with HTTP ${response.status()}: ${responseText.slice(0, 500)}`);
  }
}

async function captureScreenshot(page, outputPath, screenshotOptions) {
  if (!page || screenshotOptions === false) {
    return '';
  }
  await page.screenshot({
    path: outputPath,
    fullPage: screenshotOptions?.fullPage !== false
  });
  return outputPath;
}

async function writeResult(outputDir, result) {
  const resultPath = path.join(outputDir, 'result.json');
  await writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  return resultPath;
}

async function runScenario(options) {
  const scenarioPath = path.resolve(options.scenarioPath);
  const scenario = JSON.parse(await readFile(scenarioPath, 'utf8'));
  validateScenario(scenario);

  const outputDir = path.resolve(
    scenario.outputDir || path.join('.tmp', 'playwright-smoke', sanitizeName(scenario.name))
  );
  await mkdir(outputDir, { recursive: true });
  const result = {
    schemaVersion: SCENARIO_SCHEMA_VERSION,
    name: scenario.name,
    status: 'running',
    targetUrl: resolveUrl(scenario.baseUrl, scenario.moduleUrl),
    browserErrors: [],
    httpErrors: [],
    requestFailures: [],
    allowedRequestFailures: [],
    screenshotPath: '',
    resultPath: path.join(outputDir, 'result.json')
  };

  let browser = null;
  let page = null;
  try {
    const playwright = await loadPlaywright(options);
    browser = await launchChromium({ ...playwright, scenario, options });
    const context = await browser.newContext({
      viewport: {
        width: Number(scenario.viewport?.width || 1440),
        height: Number(scenario.viewport?.height || 1000)
      }
    });
    page = await context.newPage();
    page.setDefaultTimeout(Number(scenario.timeoutMs || DEFAULT_TIMEOUT_MS));

    page.on('pageerror', (error) => {
      result.browserErrors.push(`pageerror: ${error.message}`);
    });
    page.on('console', (message) => {
      if (message.type() === 'error') {
        result.browserErrors.push(`console: ${message.text()} @ ${message.location().url || 'unknown'}`);
      }
    });
    page.on('requestfailed', (request) => {
      const errorText = request.failure()?.errorText || 'unknown failure';
      const failure = `${request.method()} ${request.url()}: ${errorText}`;
      if (isAllowedRequestFailure(request.method(), request.url(), errorText, scenario.allowedRequestFailures || [])) {
        result.allowedRequestFailures.push(failure);
      } else {
        result.requestFailures.push(failure);
      }
    });
    page.on('response', (response) => {
      if (
        response.status() >= 400
        && !isAllowedHttpError(response.url(), response.status(), scenario.allowedHttpErrors || [])
      ) {
        result.httpErrors.push(`${response.status()} ${response.request().method()} ${response.url()}`);
      }
    });

    if (scenario.suppressFavicon404 === true) {
      await page.route('**/favicon.ico', (route) => route.fulfill({ status: 204 }));
    }

    await authenticate(context, scenario);
    await page.goto(result.targetUrl, { waitUntil: scenario.waitUntil || 'domcontentloaded' });
    const locatorRoot = scenario.scope
      ? resolveLocator(page, scenario.scope).first()
      : page;
    if (scenario.scope) {
      await locatorRoot.waitFor({ state: 'visible' });
    }
    if (scenario.ready) {
      await resolveLocator(locatorRoot, scenario.ready).first().waitFor({ state: 'visible' });
    }
    for (const action of scenario.actions || []) {
      await performAction(page, locatorRoot, action);
    }
    await page.waitForTimeout(Number(scenario.settleMs ?? DEFAULT_SETTLE_MS));
    for (const check of scenario.checks || []) {
      await performCheck(page, locatorRoot, check);
    }

    const runtimeErrors = [
      ...result.browserErrors,
      ...result.httpErrors,
      ...result.requestFailures
    ];
    assertCondition(runtimeErrors.length === 0, `Browser smoke errors:\n${runtimeErrors.join('\n')}`);

    result.screenshotPath = await captureScreenshot(
      page,
      path.join(outputDir, 'success.png'),
      scenario.screenshot ?? { fullPage: true }
    );
    result.status = 'passed';
    await writeResult(outputDir, result);
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    result.status = 'failed';
    result.error = error instanceof Error ? error.message : String(error);
    result.screenshotPath = await captureScreenshot(
      page,
      path.join(outputDir, 'failure.png'),
      scenario.screenshot ?? { fullPage: true }
    ).catch(() => '');
    await writeResult(outputDir, result);
    console.error(JSON.stringify(result, null, 2));
    throw error;
  } finally {
    await browser?.close().catch(() => undefined);
  }
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }
  assertCondition(options.scenarioPath, '--scenario is required.');
  assertCondition(options.playwrightVersion, '--playwright-version cannot be empty.');
  assertCondition(options.playwrightInstallRoot, '--playwright-install-root cannot be empty.');
  await runScenario(options);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
