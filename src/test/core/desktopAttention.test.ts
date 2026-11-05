import test = require("node:test");
import assert = require("node:assert/strict");
import {
  createDesktopAttentionTransport,
  runDesktopAttentionCommand,
  HUMAN_INTERACTION_NOTIFICATION_TITLE,
  HUMAN_INTERACTION_NOTIFICATION_BODY,
  TASK_COMPLETION_NOTIFICATION_BODY,
  type DesktopAttentionCommand,
} from "../../desktopAttention";

function harness(platform: NodeJS.Platform, env: NodeJS.ProcessEnv = {}) {
  const commands: DesktopAttentionCommand[] = [];
  const options = { platform, appName: "Visual Studio Code", appUserModelId: "Microsoft.VisualStudioCode", mainProcessId: 321, env };
  const transport = createDesktopAttentionTransport(options, async (command) => {
    commands.push(command);
    return command.args[0] === "-lp"
      ? "0x00400001 0 321 host workspace - Visual Studio Code\n0x00400002 0 999 host another application\n0x00400003 0 321 host other workspace\n"
      : "Enabled";
  });
  return { options, commands, transport };
}

function decodedScript(command: DesktopAttentionCommand): string {
  return Buffer.from(command.args[command.args.length - 1], "base64").toString("utf16le");
}

test("Linux does not request authorization and missing macOS storage is explicit", async () => {
  const linux = harness("linux");
  assert.deepEqual(await linux.transport.notificationAuthorization(true), { platform: "linux", status: "not-required" });
  assert.equal(linux.commands.length, 0);
  const env = harness("darwin");
  assert.equal((await env.transport.notificationAuthorization(false)).status, "unavailable");
});

test("Windows queries native notification settings without sending a toast or opening settings", async () => {
  const settings = [
    ["Enabled", "authorized", /已允许/],
    ["DisabledForApplication", "denied", /编辑器|Visual Studio Code/],
    ["DisabledForUser", "disabled", /当前用户/],
    ["DisabledByGroupPolicy", "denied", /系统策略.*管理员/],
    ["DisabledByManifest", "unavailable", /安装/],
    ["unrecognized", "unavailable", /无法识别/],
  ] as const;
  for (const [setting, status, detail] of settings) {
    const commands: DesktopAttentionCommand[] = [];
    const transport = createDesktopAttentionTransport({
      platform: "win32", appName: "Visual Studio Code", appUserModelId: "Microsoft.VisualStudioCodeInsiders", env: {},
    }, async (command) => { commands.push(command); return `\r\n${setting}\r\n`; });
    for (const request of [false, true]) {
      const result = await transport.notificationAuthorization(request);
      assert.equal(result.platform, "win32");
      assert.equal(result.status, status);
      assert.match(result.detail!, detail);
    }
    assert.equal(commands.length, 2);
    assert.equal(commands[0].env?.SINITEK_ATTENTION_APP_ID, "Microsoft.VisualStudioCodeInsiders");
    assert.match(decodedScript(commands[0]), /CreateToastNotifier.*Setting.ToString/);
    assert.doesNotMatch(decodedScript(commands[0]), /\.Show\(|Start-Process|ms-settings:|Set-ItemProperty/);
  }
});

test("Windows authorization reports missing identity and propagates native query failures", async () => {
  const missing = createDesktopAttentionTransport({ platform: "win32", appName: "Code", env: {} }, async () => {
    assert.fail("缺失通知身份时不应调用系统工具");
  });
  assert.equal((await missing.notificationAuthorization(false)).status, "unavailable");
  const failed = createDesktopAttentionTransport({ platform: "win32", appName: "Code", appUserModelId: "test-editor", env: {} }, async () => {
    throw new Error("系统通知查询失败");
  });
  await assert.rejects(failed.notificationAuthorization(false), /系统通知查询失败/);
});

test("macOS requires local helper storage and does not pretend to bounce the Dock", async () => {
  const env = harness("darwin");
  await assert.rejects(env.transport.notify(), /存储位置/);
  await env.transport.startAttention();
  await env.transport.stopAttention();
  assert.equal(env.commands.length, 0);
});

test("Windows sends an encoded toast with the actual editor identity", async () => {
  const env = harness("win32");
  await env.transport.notify();
  const command = env.commands[0];
  assert.equal(command.file, "powershell.exe");
  assert.ok(command.args.includes("-NonInteractive"));
  assert.ok(command.args.includes("-EncodedCommand"));
  assert.equal(command.env?.SINITEK_ATTENTION_APP_ID, "Microsoft.VisualStudioCode");
  assert.match(decodedScript(command), /CreateToastNotifier/);
  assert.match(decodedScript(command), /Setting.ToString\(\) -ne 'Enabled'.*throw/);
  assert.equal(command.env?.SINITEK_ATTENTION_BODY, HUMAN_INTERACTION_NOTIFICATION_BODY);
  assert.equal(command.env?.SINITEK_ATTENTION_TAG, "human-input");
  assert.match(decodedScript(command), /SecurityElement\]::Escape/);
  assert.doesNotMatch(decodedScript(command), /ExecutionPolicy|SetForegroundWindow/);
});

test("completion notifications reuse the title and editor identity without replacing interaction toasts", async () => {
  const windows = harness("win32");
  await windows.transport.notify("task-completed");
  assert.equal(windows.commands[0].env?.SINITEK_ATTENTION_BODY, TASK_COMPLETION_NOTIFICATION_BODY);
  assert.equal(windows.commands[0].env?.SINITEK_ATTENTION_TAG, "task-completed");
  assert.equal(windows.commands[0].env?.SINITEK_ATTENTION_APP_ID, "Microsoft.VisualStudioCode");
  assert.match(decodedScript(windows.commands[0]), /audio silent="true"/);
  assert.ok(decodedScript(windows.commands[0]).includes(HUMAN_INTERACTION_NOTIFICATION_TITLE));
  const linux = harness("linux");
  await linux.transport.notify("task-completed");
  assert.deepEqual(linux.commands[0].args.slice(-3), ["--", HUMAN_INTERACTION_NOTIFICATION_TITLE, TASK_COMPLETION_NOTIFICATION_BODY]);
  assert.ok(linux.commands[0].args.includes("dialog-information"));
});

test("Windows flashes only windows of the known main process and supports explicit cleanup", async () => {
  const env = harness("win32");
  await env.transport.startAttention();
  await env.transport.stopAttention();
  assert.equal(env.commands.length, 2);
  assert.equal(env.commands[0].env?.SINITEK_ATTENTION_PROCESS_ID, "321");
  assert.equal(env.commands[0].env?.SINITEK_ATTENTION_ENABLED, "true");
  assert.equal(env.commands[1].env?.SINITEK_ATTENTION_ENABLED, "false");
  const script = decodedScript(env.commands[0]);
  assert.match(script, /processId == targetProcessId && IsWindowVisible/);
  assert.match(script, /info.Flags = enabled \? 14u : 0u/);
  assert.match(script, /FlashWindowEx/);
});

test("Windows resolves the system PowerShell path when the system root is available", async () => {
  const env = harness("win32", { SystemRoot: "C:\\Windows" });
  await env.transport.notify();
  assert.equal(env.commands[0].file, "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe");
});

test("invalid or unavailable main process identifiers never flash an unrelated window", async () => {
  for (const processId of [undefined, 0, -1, NaN, 1.5, 0x100000000]) {
    const commands: DesktopAttentionCommand[] = [];
    const transport = createDesktopAttentionTransport({
      platform: "win32", appName: "Visual Studio Code", mainProcessId: processId, env: {},
    }, async (command) => { commands.push(command); return ""; });
    await transport.startAttention();
    await transport.stopAttention();
    assert.equal(commands.length, 0);
    await assert.rejects(transport.notify(), /系统通知标识/);
  }
});

test("Linux uses native notification arguments and targets only matching X11 process windows", async () => {
  const env = harness("linux", { DISPLAY: ":0" });
  await env.transport.notify();
  assert.equal(env.commands[0].file, "notify-send");
  assert.deepEqual(env.commands[0].args.slice(-3), ["--", HUMAN_INTERACTION_NOTIFICATION_TITLE, HUMAN_INTERACTION_NOTIFICATION_BODY]);
  await env.transport.startAttention();
  assert.deepEqual(env.commands.slice(1).map((command) => command.args), [
    ["-lp"],
    ["-ir", "0x00400001", "-b", "add,demands_attention"],
    ["-ir", "0x00400003", "-b", "add,demands_attention"],
  ]);
  await env.transport.stopAttention();
  assert.deepEqual(env.commands.slice(-2).map((command) => command.args), [
    ["-ir", "0x00400001", "-b", "remove,demands_attention"],
    ["-ir", "0x00400003", "-b", "remove,demands_attention"],
  ]);
});

test("Wayland and headless environments skip X11 attention while retaining system notifications", async () => {
  for (const session of [{ DISPLAY: ":0", WAYLAND_DISPLAY: "wayland-0" }, { DISPLAY: ":0", XDG_SESSION_TYPE: "wayland" }, {}]) {
    const env = harness("linux", session);
    await env.transport.startAttention();
    await env.transport.stopAttention();
    assert.equal(env.commands.length, 0);
    await env.transport.notify();
    assert.equal(env.commands[0].file, "notify-send");
  }
});

test("a partially started Linux attention request retains cleanup targets", async () => {
  const commands: DesktopAttentionCommand[] = [];
  const transport = createDesktopAttentionTransport({
    platform: "linux", appName: "Visual Studio Code", mainProcessId: 321, env: { DISPLAY: ":0" },
  }, async (command) => {
    commands.push(command);
    if (command.args[0] === "-lp") {
      return "0x00400001 0 321 host workspace\n";
    }
    if (command.args.includes("add,demands_attention")) {
      throw new Error("窗口已关闭");
    }
    return "";
  });
  await assert.rejects(transport.startAttention(), /窗口已关闭/);
  await transport.stopAttention();
  assert.ok(commands[commands.length - 1].args.includes("remove,demands_attention"));
});

test("unsupported systems are no-ops and missing system tools report a controlled failure", async () => {
  const env = harness("freebsd");
  await env.transport.notify();
  await env.transport.startAttention();
  await env.transport.stopAttention();
  assert.equal(env.commands.length, 0);
  const missing = createDesktopAttentionTransport({ platform: "linux", appName: "Code", env: {} }, async () => {
    throw new Error("notify-send 不存在");
  });
  await assert.rejects(missing.notify(), /notify-send 不存在/);
});

test("the command runner captures output without a terminal and reports missing executables", async () => {
  const output = await runDesktopAttentionCommand({ file: process.execPath, args: ["-e", "process.stdout.write('ready')"] });
  assert.equal(output, "ready");
  await assert.rejects(runDesktopAttentionCommand({ file: "sinitek-attention-missing-command", args: [] }));
});
