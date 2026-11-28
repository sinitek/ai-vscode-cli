---
name: vscode-extension-host-smoke
description: Verify a VS Code extension in a fresh, isolated Extension Development Host when activation or a user-visible extension entry must be confirmed; not a substitute for unit tests or native Windows/Linux validation.
---

# VS Code Extension Host Smoke

Use this only when the task needs evidence from VS Code's actual Extension Host or workbench. A successful launcher exit, a pre-existing VS Code window, a build, or a unit test does not prove that the current checkout activated or displayed its UI.

## Verified local route

On November 24, 2026, this repository was verified on macOS 15.6.1 (arm64) with installed VS Code 1.144.0, commit `2c33b50b16c472efe58357d1d2a8a5414bc23fbf`. A fresh installed VS Code process was launched with the repository as `--extensionDevelopmentPath`, a temporary workspace, isolated user-data/extensions/HOME, and a temporary `--extensionTestsPath` test entry. The test entry waited for `vscode.extensions.getExtension('sinitek.sinitek-cli-tools')` to become active before invoking `sinitek-cli-tools.openPanel`. The same-run workbench was then inspected over loopback Chrome DevTools Protocol; a visible, nonzero-size `textarea#promptInput` confirmed the panel rendered. The test host exited with status 0 and its process group drained. This run's long temporary socket path also produced an AgentHost `listen EINVAL` warning; VS Code continued via MessagePort and the extension/UI assertions passed, but the warning was not independently investigated.

To reproduce, first read `.ch/docs/TESTING.md` and `.ch/docs/runbooks/local-development.md`, check `node --version` (the verified host runner used Node 24.22.2 and built-in `WebSocket`), and ensure an installed VS Code executable and an interactive macOS GUI session are available. Build only if the source has changed since the last build. Prepare a fresh directory under the repository's ignored `.tmp/`, with separate temporary HOME, user-data, extensions, workspace, a short temporary directory for `TMPDIR`, an Extension Host test entry, and log file. Use a genuinely short path such as `/tmp/<unique-name>` for `TMPDIR` on macOS to avoid Unix-socket path limits; the repository-local temporary path used in the verified run was too long and triggered the warning above. Disable CLI integrations in temporary settings and point configured CLI commands at a harmless executable; never submit a prompt or launch a real CLI for an activation/UI smoke.

Launch the installed app binary (not the `code` shell shim) in a new process group, with an allowlisted environment and these arguments, substituting absolute paths:

```text
--new-window --skip-welcome --skip-release-notes --disable-updates --disable-telemetry
--disable-workspace-trust --use-inmemory-secretstorage --log=trace
--remote-debugging-port=0 --remote-debugging-address=127.0.0.1
--user-data-dir=<temporary-user-data> --extensions-dir=<temporary-extensions>
--extensionDevelopmentPath=<absolute-repository-root>
--extensionTestsPath=<temporary-test-entry> <temporary-workspace>
```

The test entry must use the real `vscode` API, assert the isolated HOME/workspace, wait for the extension ID and confirm `isActive` and `extensionPath` before checking `vscode.commands.getCommands(true)` and executing the intended entry command. For the chat panel, execute `sinitek-cli-tools.openPanel`; then inspect the workbench DevTools target from this same process and assert the expected visible panel element, not just command completion. Poll only this run's test marker, DevTools endpoint, and logs with a bounded timeout. Record the process ID and correlate it with the Extension Host PID in the isolated host logs. The repository's `scripts/verify_department_host_activation.js` is a useful reference for isolated launch, automatic activation, and cleanup, but it does not itself prove the chat panel rendered.

### Isolation evidence

For a deny-outbound macOS history smoke, keep the physically separate private HOME and fresh user-data, extensions, workspace, and synthetic sessions. Keep CLI integrations disabled and the Seatbelt restrictions on outbound network, Mach services, and real HOME access in force. Use only the run's owned loopback endpoints for local checks. Do not loosen isolation to get past a startup failure.

Report these four checks separately:

- **Synthetic Node runner tests:** Cover only the runner logic exercised by the fixtures, such as ownership, signal decisions, and cleanup reporting. A pass does not provide any of the three kinds of real-host evidence below.
- **Real Extension Host creation and activation:** Correlate the host creation event and PID to this launch, then capture the test-entry marker and verify the expected extension is active at the current build's path. Workbench CDP availability, host creation, and launcher exit alone do not prove activation.
- **In-host isolation denials:** Record the assertions from inside that same Extension Host for denied outbound access and denied real HOME access to a synthetic sentinel. A driver-side probe or the presence of a Seatbelt profile does not prove those assertions ran or passed.
- **Same-run history UI and store:** In the real workbench, open the panel and click the history entry. Verify the restored Chinese request title, hidden protocol prompt, preserved custom title, and persisted session-store state in that isolated run. A fixture-only check or a UI pass from a different launch cannot complete this gate.

Use `not_run` when no host was launched. If startup fails before later gates run, report the startup failure and mark those gates unexecuted. Report the observed renderer exit separately from its cause; a crash code or shared minidump offset does not diagnose the root cause.

On macOS 15.6.1 (arm64) with VS Code 1.144.0, lp47 reached the loopback CDP endpoint of an isolated empty workbench. In the separate deny-outbound run with the real extension, the VS Code main process (PID `58451`) exited with code 1 while the runner waited for the same-process Extension Host outbound denial probe. The probe produced no recorded result, and the historical UI/store assertions did not run. The only retained error was `Operation not permitted`. The Extension Host child PID and exit status were not captured. The specific resource and failure stage remain unknown.

lp45 separately verified the synthetic UI/store assertions. Zero-outbound behavior was outside the scope of that evidence.

On November 25, 2026, the deny-outbound history smoke on the same macOS and VS Code versions added `--enable-logging=stderr` and captured an explicit `CodeWindow: renderer process gone` with reason `crashed` and code `6`. The isolated `main.log` also recorded VS Code taking its test-window failure branch. The main process then exited `1` before any test-entry marker or observed Extension Host creation. The native stderr stream separately reported a GPU process exit. The cause of the renderer crash remains unknown.

For this startup failure, retain separate events for the initial window load, `window#load: window reported ready`, `CodeWindow: renderer process gone`, and the `UtilityProcess` creation event with `type: extensionHost` and its PID. Record the test entry's first marker separately from activation. The owned loopback CDP listener can respond before the window reports ready. Store only event names, allowlisted reasons, PIDs, and codes from native stderr and isolated logs, then remove the logs.

With VS Code 1.144.0 on macOS, `--crash-reporter-directory=<private-absolute-path>` selected local crash reporting inside the existing Seatbelt profile. The installed startup code sets an empty submit URL and disables upload for this option. Use a fresh directory inside the isolated run root. Before deleting the directory, correlate only bounded minidump metadata with sampled PIDs, keeping the module label and relative offset only for allowlisted modules. Check the process group and any crash handler tied to this directory during cleanup. The November 25 local-only run correlated dumps with the renderer, GPU and helper processes. All reported the same `libsystem_kernel` offset, so the dumps did not identify the renderer crash cause.

## Evidence and cleanup

Treat a run as successful only when the fresh host identifies the current extension path, the intended command is registered and completes, the same run renders the expected UI, the test host exits successfully, and all processes in its isolated group have exited. Preserve only non-sensitive facts needed for the report: exact command/arguments, OS and VS Code version, extension ID/path and active state, the observed entry, exit status, and any product error. Do not copy user configuration, credentials, workspace content, or raw logs into the repository.

On timeout or failure, capture concise relevant error excerpts and the test result before cleanup; do not reinterpret the launcher return code as activation evidence. Restrict termination to processes verified as owned by this isolated run, including any continuously tracked detached helper. Confirm the group and owned detached processes have drained before reporting successful cleanup. After recording the result, remove the temporary HOME, user data, extension cache, workspace, and logs. Keep artifacts only when debugging was requested and they contain no private data.

On macOS, `ucomm` is an accounting name, not a full executable identity: names can be truncated (the local accounting-name check recorded a 16-byte limit). `lstart` has only second-level precision. Neither field, even in combination with PID and UID, proves which process would receive a signal. Collect these short fields rather than argv or environment; anchor ownership to this run's spawn, baseline, and observed parent/group lineage, not to a name match. A fresh `ps` sample is not atomic with signal delivery.

Re-sample before signaling. If PPID or PGID changed between samples, or ownership otherwise cannot be verified, fail closed: do not signal that candidate, including indirectly via a group signal. Report ownership or cleanup as unverified and fail the cleanup gate. Do not claim the process set drained or cleanup succeeded, even if the launcher exited, the group scan is empty, or the synthetic tests passed.

The verified route is macOS-only evidence. It does not establish native Windows/Linux behavior, real CLI execution, CLI protocol or model calls, production user-profile compatibility, or marketplace behavior. Do not claim those are covered by this smoke.

## Verified no-acceptance tab close

On November 27, 2026, the verified local route above (macOS 15.6.1 arm64, installed VS Code 1.144.0, Node 24.22.2) also covered one `requiresAcceptance: false` completion. Reuse that isolated Extension Development Host, loopback DevTools inspection, bounded timeout, and process-group cleanup. Confirm `sinitek.sinitek-cli-tools` is active at the current checkout. Do not rebuild product source or shared `dist` unless the checkout changed after this evidence, and do not rerun the scenario only to restate it.

In the isolated workbench, before releasing completion:

1. Open the chat panel. Prepare the target subtask conversation, at least one other conversation, an unrelated editor tab, and the Loop+ group chat.
2. Point the selected CLI at a local stdio JSON-RPC fixture with no network access and no real model. Use Loop+ with the fullstack route.
3. Have the fixture dispatch one subtask with `requiresAcceptance: false`, then hold that subtask prompt.

Record each surface's identity and which one is focused. Then let the fixture finish successfully. Do not invoke a tab-close command.

After the target conversation shows the completion text `子任务执行结束` together with `无需验收`, sample that same workbench again. Pass only when the target conversation disappears once, the other conversation and the unrelated editor remain, the group chat stays open, and another conversation's prompt input can be focused and accepts text. Record where focus actually moved. The product log may show one `loop-plus-subtask-tab-auto-close-error` while the tab is still running, then one `loop-plus-subtask-tab-auto-closed` on the retry. That log only records the retry. The workbench sample is the close observation.

The host exited 0. Its process group was already empty, so no signal was sent. Remove the isolated root after recording the result. This evidence does not cover Windows or Linux, a real model or external CLI, Seatbelt deny-outbound, department admission refusal, or the full unit suite.

## Verified Loop+ group continue

On November 27, 2026, the same macOS 15.6.1 arm64 host, installed VS Code 1.144.0, and Node 24.22.2 covered one Loop+ group-chat continue from the real workbench. Reuse the no-acceptance tab-close evidence above and the deterministic protocol scenarios; do not rerun them only to restate them. `resume-idempotent` still calls resume directly and does not operate the Webview.

Reproduce with an interactive macOS GUI session:

```text
node scripts/loop_plus_protocol_regression_smoke.cjs --scenario=group-continue-panel
```

The scenario is not part of the default fixture run, `--fixture-only`, or `--extension-host-only`. It copies `package.json`, `media`, and `dist` to a private run root and launches Extension Development Host with that copy as `--extensionDevelopmentPath`. It symlinks the repository `node_modules` so package imports resolve, and it does not load the shared `dist` that another task may be rewriting. Record the copy's `dist/extension.js` size and SHA-256 from the ignored evidence file. The CLI is a local stdio JSON-RPC DSH stub with no network access and no real model. The panel uses DSH, Loop+, and the fullstack route.

In that same workbench the passing run did this:

1. Sent the synthetic prompt and confirmed the acceptance plan.
2. Opened the current Loop+ group chat from the panel. While the task was running, the page showed 中止 and did not show 继续执行.
3. Clicked 中止. The task became `stopped`, and the subtitle stayed the original task id.
4. Clicked 继续执行, set the dialog text, and confirmed. The button became disabled with aria-busy `true` and the label `继续执行，正在启动续跑`. The same turn confirmed again.
5. After the stub was holding that main call, clicked 继续执行 again. The button was disabled, aria-busy was `false`, and the dialog did not open.
6. Sampled the same group chat again.

Pass only when all of these are true: the task id and group-chat title are unchanged, the group-chat editor tab count stays 1, the webview target count stays 1, the editor tab count is unchanged, the repeat click sees the continue button disabled and does not reopen the dialog, the append-only stub ledger shows exactly one held continue across every stub process, the webview reports no page error, and the host exits 0 with a null signal and a drained group that was not signaled. A process-local counter must not overwrite another stub's held call. Reopening the dialog, two held calls, a signaled exit, or a failed process sample cannot pass.

Use `--remote-allow-origins=http://127.0.0.1:<port>` for that run's loopback port. Do not pass a wildcard origin. Keep only bounded DevTools events needed for the webview context and page errors. On a failed process sample or an identity change, keep the run root and do not signal. Before escalating from SIGTERM to SIGKILL, sample ownership again and stop if it changed.

The bounded waits are activation 70 seconds, task creation 30 seconds, group-chat render and the continue button 20 seconds each, stop 20 seconds, and the first continue call 30 seconds. On timeout or failure, write `.tmp/loop-plus-protocol-regression/group-continue-last.json` before deciding whether the run root can be removed. Keep the ledger count, task status, assertion problems, and short log excerpts. Do not treat the launcher exit code alone as the page result. After a natural exit 0, wait briefly for the launch group to empty. Remove the run root only when that second sample shows it drained without a signal. If ppid or pgid changed, do not signal; mark cleanup unverified and fail the scenario.

The November 27 page sample still stands: the running group chat showed 中止, the stop control made the same task continuable, the first confirm showed `正在启动续跑`, and the later click did not add a main call. A follow-up run of the same scenario, after the ledger and cleanup gates above, again exited 0 with no signal. This pass does not cover automatic protocol pause after invalid decisions, Windows or Linux, a real model or external CLI, Seatbelt deny-outbound, department continue, or the coordinator unit tests. An earlier stub attempt recorded one `format.ObjectNotFound`, then hidden retries at 5, 15, and 30 seconds while the task stayed `running`; that attempt is not the page pass. After continue starts, the button can stay disabled while aria-busy returns to false and the main call is still held.

Read the final held-continue ledger only after the stub processes that wrote it have exited. The cumulative held count for the whole hold interval decides the pass. A missing file or a damaged line is a failure even when the readable lines still show one call. A second held line appended after the last UI sample fails the gate. When DevTools error details are discarded to stay within the bounded event list, keep the error count for that group-chat session and still fail the page check. Before SIGKILL, compare each remaining member with the set confirmed before SIGTERM. Two later snapshots that agree with each other do not prove ownership if the member was replaced. Identity changes, a failed process sample, or unproven ownership keep the run root and stop further signals.
