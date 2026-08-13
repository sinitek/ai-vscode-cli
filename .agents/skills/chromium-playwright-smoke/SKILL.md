---
name: chromium-playwright-smoke
description: Run authenticated Chromium Playwright headless smoke tests from structured scenarios, including same-context API login, direct module URL navigation, UI actions and assertions, screenshots, overlap checks, and strict console/page/network error collection. Use after web UI changes require browser validation, especially for protected hash-routed modules. Do not use for unit-only or non-browser checks.
---

# Chromium Playwright Smoke

Use the bundled runner to make browser validation repeatable and reviewable.

## Prerequisites

- Use the repository's existing Node.js and npm versions.
- Start the frontend and backend before running a scenario.
- Treat Playwright as optional tooling. `--install-if-missing` needs network access only when the isolated package or Chromium cache is absent.

## Workflow

1. Start or reuse the repository's frontend and backend. Confirm the actual listening ports from logs or `lsof`.
2. Read [scenario-format.md](references/scenario-format.md), then create a task-specific JSON scenario under `.tmp/`.
   For nested workbench file selection, also read [workbench-tree-selection.md](references/workbench-tree-selection.md) and reuse `scripts/workbench_tree_helpers.mjs`.
3. Put login credentials in environment variables, never in the scenario or repository.
4. Run:

```bash
PLAYWRIGHT_USERNAME=admin \
PLAYWRIGHT_PASSWORD="$LOCAL_TEST_PASSWORD" \
node .agents/skills/chromium-playwright-smoke/scripts/run_smoke.mjs \
  --scenario .tmp/playwright-smoke.json \
  --install-if-missing
```

5. Read the emitted `result.json` and inspect success/failure screenshots with `view_image`.
6. Remove task-only scenario files. Keep committed fixtures only when they are real regression assets.
7. Record any newly confirmed, repeatable pitfall in `.ch/docs/runbooks/` and link back to this skill.

## Required Practices

- Authenticate through the login API in the same browser context, then navigate directly to the module URL. Click navigation only when navigation is itself under test.
- Use the route defined by the application's routing source of truth. For this repository, module routes are hash routes such as `/#/workshop`.
- Set `suppressFavicon404` only to isolate the known development favicon request. Do not ignore other console errors, page errors, failed requests, or HTTP errors without an explicit task-specific reason.
- Prefer non-persisting UI flows for smoke tests. Do not save drafts, publish artifacts, or mutate database records unless the requested behavior requires it.
- Add task-specific assertions for stable dimensions, visible controls, empty states, text, and overlap rather than treating page load alone as success.
- Scope locators to the active module, dialog, or panel. This application keeps background module surfaces mounted, so an unscoped selector can match a hidden or inactive control first.
- Inspect screenshots at the requested desktop/mobile viewports when layout or responsive behavior changed.

## Runner Behavior

- Loads a project-local Playwright package when available.
- With `--install-if-missing`, installs the pinned runner version into `/tmp/zq-playwright-smoke`; it does not edit project dependency manifests or lockfiles.
- Reuses an existing Chromium/Chrome-for-Testing cache when possible and installs Chromium only when no usable executable exists.
- Writes `result.json` plus a success or failure screenshot to the configured output directory.
- Exits nonzero when an action, assertion, browser error, failed request, or non-allowlisted HTTP error occurs.

## Boundaries

- Keep the runner generic; encode page-specific behavior in scenario JSON.
- Do not place passwords, tokens, customer data, or production URLs in skill resources.
- Do not turn favicon suppression into a general error allowlist.
- Do not use this skill as a replacement for unit tests, type checking, or production builds.
