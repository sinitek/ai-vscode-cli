# Scenario Format

The runner accepts one JSON object with `schemaVersion: 1`.

## Minimal Example

```json
{
  "schemaVersion": 1,
  "name": "workshop-load",
  "baseUrl": "http://127.0.0.1:6173",
  "moduleUrl": "/#/workshop",
  "login": {
    "path": "/api/auth/login",
    "usernameEnv": "PLAYWRIGHT_USERNAME",
    "passwordEnv": "PLAYWRIGHT_PASSWORD"
  },
  "suppressFavicon404": true,
  "ready": {
    "role": "button",
    "name": "新建智能体",
    "exact": true
  },
  "checks": [
    {
      "type": "visible",
      "selector": ".agent-workshop-page"
    }
  ]
}
```

## Top-Level Fields

- `schemaVersion`: Must be `1`.
- `name`: Stable scenario name used for output paths.
- `baseUrl`: Running frontend origin.
- `moduleUrl`: Absolute URL or URL relative to `baseUrl`; prefer direct module routes.
- `login`: Optional API login configuration.
- `viewport`: Optional `{ "width": 1440, "height": 1000 }`.
- `timeoutMs`: Locator timeout, default `10000`.
- `settleMs`: Wait after actions before assertions, default `500`.
- `suppressFavicon404`: Fulfill only `**/favicon.ico` with HTTP 204.
- `allowedHttpErrors`: Explicit exceptions such as `{ "urlPattern": "**/optional", "statuses": [404] }`.
- `allowedRequestFailures`: Narrow request-cancellation exceptions such as `{ "methods": ["GET"], "urlPattern": "**/api/example", "failureTexts": ["net::ERR_ABORTED"] }`; method, URL and exact failure text must match when provided, and matched failures remain in `result.json`.
- `scope`: Optional locator that scopes every `ready`, action, and check locator to the active module or panel.
- `ready`: Locator that must become visible after direct navigation.
- `actions`: Ordered UI operations.
- `checks`: Ordered assertions.
- `outputDir`: Output directory, default `.tmp/playwright-smoke/<name>`.
- `screenshot`: `false` to disable, or `{ "fullPage": true }`.
- `chromiumExecutable`: Optional explicit Chromium executable.
- `launchOptions`: Optional Playwright Chromium launch overrides; the runner always forces `headless: true`.

## Login

```json
{
  "path": "/api/auth/login",
  "usernameEnv": "PLAYWRIGHT_USERNAME",
  "passwordEnv": "PLAYWRIGHT_PASSWORD",
  "usernameField": "username",
  "passwordField": "password",
  "payload": {}
}
```

Credentials must come from environment variables. `payload` may hold non-secret fixed fields.

## Locators

Actions, checks, and `ready` accept one locator form:

```json
{ "selector": ".workshop-knowledge-manager" }
{ "role": "button", "name": "知识库", "exact": true }
{ "text": "保存后可管理专属知识库", "exact": true }
```

Prefer a top-level `scope` such as `{ "selector": ".module-surface-workshop" }` when the application keeps inactive module surfaces mounted in the DOM.

## Actions

- `click`: Click a locator.
- `fill`: Fill with `value` or `valueEnv`.
- `press`: Press `key` on a locator.
- `selectOption`: Select `value` or `values`.
- `hover`: Hover a locator.
- `waitFor`: Wait for `state`, default `visible`.
- `wait`: Wait for `ms` without a locator.

Example:

```json
[
  { "type": "click", "role": "button", "name": "新建智能体", "exact": true },
  { "type": "click", "role": "button", "name": "知识库", "exact": true },
  { "type": "waitFor", "selector": ".workshop-knowledge-manager" }
]
```

## Checks

- `visible` / `hidden`
- `enabled` / `disabled`
- `count` with `equals`
- `text` with `equals`
- `containsText` with `includes`
- `attribute` with `name` and `equals`
- `absentText` with `text` and optional `exact`
- `withinViewport` for one locator
- `noOverlap` with `targets`, an array of locator objects

Example:

```json
[
  { "type": "count", "selector": ".workshop-knowledge-manager-toolbar button", "equals": 6 },
  { "type": "disabled", "selector": "button[aria-label='新建文件夹']" },
  { "type": "count", "selector": ".workshop-knowledge-tree-shell .tree-list > li", "equals": 1 },
  { "type": "text", "selector": ".tree-root-entry .tree-node-name", "equals": "智能体知识库 /" },
  { "type": "absentText", "text": "保存后可管理专属知识库", "exact": true }
]
```

Do not add broad HTTP, console-error, or request-failure exclusions to make a failing scenario pass. Narrow the exception to a confirmed non-business request and exact failure text, then document the reason in the relevant runbook.
