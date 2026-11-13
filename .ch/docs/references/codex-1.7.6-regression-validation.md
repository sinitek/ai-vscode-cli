# Codex 1.7.6 Regression Evidence

This page preserves the LP83/LP84 regression and delivery evidence that is not a current Codex contract. Current behavior is documented in [CLI runtime reference](cli-runtime-reference.md); active acceptance state remains in the [unload policy plan](../exec-plans/active/2026-11-12-bugfix-codex-unload-policy.md), [runtime fingerprint plan](../exec-plans/active/2026-11-12-bugfix-codex-runtime-fingerprint.md), and [release state plan](../exec-plans/active/2026-11-12-bugfix-codex-release-state.md).

## Historical findings

- The 1.7.6 baseline already awaited user answers on the shared `readLoop -> dispatch -> handleServerRequest` path. Later changes introduced source-aware config identity (1.7.7), background compaction flight coordination (1.8.5), and thread/home handoff plus writer-conflict retry protection (1.9.0). This sequence is historical attribution, not a root-cause claim for every incident.
- LP83 controlled Windows protocol tests covered public turns, trust persistence, equivalent TOML/JSON edits, config-driven runner replacement, pending answers, late-answer rejection, and release only after `thread/closed` or actual process exit. Build passed; focused integration passed 2/2 and the listed regression suites passed 160/160. Synthetic peers and intercepted PIDs were used; no real user session or model was involved.
- LP84 packaging checks passed, and all 312 packaged runtime files matched that fresh Git build. A later authenticated Marketplace package for 1.9.2 had SHA-256 `171a0b29d3e54b7937bf0f3007de81db5c7d12e31ac7c0977e4b73bb8515947e` and differed from the final Git build in three later model-switch UI files. Therefore the final Git build cannot be described as newly published or identical to the existing Marketplace package.
- The authorized publish script exited 1 because 1.9.2 already existed. An earlier Python test fixture entered real export/publish code; an actual publish from that run cannot be excluded. The repaired entrypoint fixture passed, but a separate plan-contract symlink test failed with Windows `WinError 1314`.
- Windows ARM64 ZCode LP80 exited before `session/create` replied (`0xC0000409`, cause unknown). VS Code 1.145.0 exited during update checking before Extension Host entry. Neither is a passing validation.

## Limits

Native macOS/Linux, real VS Code multi-window/Loop+ scheduling, other CLI implementations, real model behavior, and external writers remain unverified. The active Codex plans are not complete; Windows controlled/live results do not satisfy those gaps. Detailed run-by-run artifacts remain in their original attempt reports and the [Windows handoff record](codex-thread-handoff-windows-validation.md).
