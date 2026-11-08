import test = require("node:test");
import assert = require("node:assert/strict");
import fs = require("node:fs");
import os = require("node:os");
import path = require("node:path");
import vm = require("node:vm");
import {
  createMacOSDesktopNotificationSender,
  MACOS_NOTIFICATION_APP_ID,
  MACOS_NOTIFICATION_APP_NAME,
} from "../../macosDesktopNotifications";
import { createDesktopAttentionTransport, HUMAN_INTERACTION_NOTIFICATION_BODY, TASK_COMPLETION_NOTIFICATION_BODY,
  type DesktopAttentionCommand } from "../../desktopAttention";

function harness(storagePath: string) {
  const commands: DesktopAttentionCommand[] = [];
  let failCompilation = false;
  let result: { status: string; errorCode?: number; errorDomain?: string; authorizationStatus?: number; alertSetting?: number } = { status: "submitted" };
  const run = async (command: DesktopAttentionCommand): Promise<string> => {
    commands.push(command);
    if (command.file === "/usr/bin/osacompile") {
      if (failCompilation) {
        failCompilation = false;
        throw new Error("通知助手编译失败");
      }
      const appPath = command.args[1];
      await fs.promises.mkdir(path.join(appPath, "Contents", "Resources", "Scripts"), { recursive: true });
      await fs.promises.writeFile(path.join(appPath, "Contents", "Resources", "Scripts", "main.scpt"), "isolated test fixture");
      await fs.promises.writeFile(path.join(appPath, "Contents", "Info.plist"), "isolated test fixture");
    }
    if (command.file === "/usr/bin/open") {
      await fs.promises.writeFile(command.args[command.args.length - 1], JSON.stringify(result));
    }
    return "";
  };
  const create = () => createMacOSDesktopNotificationSender({ storagePath, title: "提醒测试", body: "这是隔离测试。", run });
  return { commands, create, run, failNextCompilation: () => { failCompilation = true; }, setResult: (value: typeof result) => { result = value; } };
}

test("macOS builds an identifiable background notification app in extension storage and reuses it", async (context) => {
  const storagePath = fs.mkdtempSync(path.join(os.tmpdir(), "sinitek notification helper "));
  context.after(() => fs.rmSync(storagePath, { recursive: true, force: true }));
  const env = harness(storagePath);
  const notify = env.create();
  await notify();
  assert.equal(env.commands[0].file, "/usr/bin/osacompile");
  assert.deepEqual(env.commands[0].args.slice(2, 5), ["-l", "JavaScript", "-e"]);
  assert.match(env.commands[0].args[5], /UNUserNotificationCenter/);
  assert.doesNotMatch(env.commands[0].args[5], /UNAuthorizationOptionSound|content\.sound|display notification/);
  assert.ok(env.commands.some((command) => command.args.includes(MACOS_NOTIFICATION_APP_ID)));
  assert.ok(env.commands.some((command) => command.args.includes(MACOS_NOTIFICATION_APP_NAME)));
  assert.ok(env.commands.some((command) => command.args.includes("LSUIElement")));
  assert.ok(env.commands.some((command) => command.file === "/usr/bin/codesign"));
  assert.ok(env.commands.some((command) => command.file.endsWith("/lsregister")));
  const launch = env.commands[env.commands.length - 1];
  assert.equal(launch.file, "/usr/bin/open");
  assert.deepEqual(launch.args.slice(0, 3), ["-g", "-W", "-n"]);
  assert.ok(launch.args[3].startsWith(storagePath));
  assert.deepEqual(launch.args.slice(4, 7), ["--args", "提醒测试", "这是隔离测试。"]);
  assert.equal(launch.timeoutMs, 65000);
  const originalCount = env.commands.length;
  await notify();
  await env.create()();
  assert.equal(env.commands.length, originalCount + 3);
  assert.equal(env.commands.filter((command) => command.file === "/usr/bin/osacompile").length, 1);
});

test("macOS 两类通知在相同助手身份下显示当前项目名称", async (context) => {
  const storagePath = fs.mkdtempSync(path.join(os.tmpdir(), "sinitek-notification-project-"));
  context.after(() => fs.rmSync(storagePath, { recursive: true, force: true }));
  const env = harness(storagePath);
  let projectName = "研发 & <工具>";
  const transport = createDesktopAttentionTransport({
    platform: "darwin", appName: "Visual Studio Code", storagePath, env: {}, getProjectName: () => projectName,
  }, env.run);
  await transport.notify();
  projectName = "另一个项目";
  await transport.notify("task-completed");
  const launches = env.commands.filter((command) => command.file === "/usr/bin/open");
  assert.equal(launches[0].args[6], `【研发 & <工具> 项目】 ${HUMAN_INTERACTION_NOTIFICATION_BODY}`);
  assert.equal(launches[1].args[6], `【另一个项目 项目】 ${TASK_COMPLETION_NOTIFICATION_BODY}`);
  assert.equal(launches[0].args[3], launches[1].args[3]);
  assert.equal(env.commands.filter((command) => command.file === "/usr/bin/osacompile").length, 1);
});

test("macOS helper compilation failures leave no incomplete app and can be retried", async (context) => {
  const storagePath = fs.mkdtempSync(path.join(os.tmpdir(), "sinitek-notification-retry-"));
  context.after(() => fs.rmSync(storagePath, { recursive: true, force: true }));
  const env = harness(storagePath);
  const notify = env.create();
  env.failNextCompilation();
  await assert.rejects(notify(), /编译失败/);
  const directory = path.join(storagePath, "desktop-attention", "macos-v5");
  assert.deepEqual(fs.readdirSync(directory), []);
  await notify();
  assert.deepEqual(fs.readdirSync(directory), ["携宁 CLI 提醒.app"]);
});

test("completion text reuses the same macOS helper identity and app cache", async (context) => {
  const storagePath = fs.mkdtempSync(path.join(os.tmpdir(), "sinitek-notification-completed-"));
  context.after(() => fs.rmSync(storagePath, { recursive: true, force: true }));
  const env = harness(storagePath);
  const notify = env.create();
  await notify();
  await notify("任务已完成，请返回编辑器中的 AI 对话面板查看结果。");
  const launches = env.commands.filter((command) => command.file === "/usr/bin/open");
  assert.equal(launches[0].args[3], launches[1].args[3]);
  assert.deepEqual(launches[1].args.slice(4, 7), ["--args", "提醒测试", "任务已完成，请返回编辑器中的 AI 对话面板查看结果。"]);
  assert.equal(env.commands.filter((command) => command.file === "/usr/bin/osacompile").length, 1);
});

test("concurrent extension windows can prepare the same notification app without deleting one another", async (context) => {
  const storagePath = fs.mkdtempSync(path.join(os.tmpdir(), "sinitek-notification-concurrent-"));
  context.after(() => fs.rmSync(storagePath, { recursive: true, force: true }));
  const env = harness(storagePath);
  await Promise.all([env.create()(), env.create()()]);
  assert.equal(env.commands.filter((command) => command.file === "/usr/bin/open").length, 2);
  assert.deepEqual(fs.readdirSync(path.join(storagePath, "desktop-attention", "macos-v5")), ["携宁 CLI 提醒.app"]);
});

test("macOS reports denied permission and delivery failure instead of treating app launch as success", async (context) => {
  const storagePath = fs.mkdtempSync(path.join(os.tmpdir(), "sinitek-notification-status-"));
  context.after(() => fs.rmSync(storagePath, { recursive: true, force: true }));
  const env = harness(storagePath);
  const notify = env.create();
  env.setResult({ status: "denied" });
  await assert.rejects(notify(), /系统设置/);
  env.setResult({ status: "authorization-error", errorDomain: "UNErrorDomain", errorCode: 1 });
  await assert.rejects(notify(), /系统设置/);
  env.setResult({ status: "delivery-error" });
  await assert.rejects(notify(), /未能提交/);
  env.setResult({ status: "timeout" });
  await assert.rejects(notify(), /超时/);
  env.setResult({ status: "submitted" });
  await notify();
  assert.deepEqual(fs.readdirSync(path.join(storagePath, "desktop-attention", "macos-v5")), ["携宁 CLI 提醒.app"]);
});

test("macOS notification script uses native nil and handles native callbacks on the run loop", async (context) => {
  const storagePath = fs.mkdtempSync(path.join(os.tmpdir(), "sinitek-notification-script-"));
  context.after(() => fs.rmSync(storagePath, { recursive: true, force: true }));
  const env = harness(storagePath);
  await env.create()();
  const script = env.commands[0].args[5];
  const execute = (options: { denied?: boolean; undetermined?: boolean; reject?: boolean; authorizeOnly?: boolean; authorizationError?: boolean; deliveryError?: boolean; diagnose?: boolean; timeout?: boolean }) => {
    const callbacks: Array<() => void> = [];
    const events: string[] = [];
    let result = "";
    let clock = 0;
    let insideCallback = false;
    const nil = { isNil: () => { assert.equal(insideCallback, false); return true; } };
    const error = { isNil: () => { assert.equal(insideCallback, false); return false; }, code: 1, domain: "UNErrorDomain" };
    const center = {
      getNotificationSettingsWithCompletionHandler: (callback: (settings: unknown) => void) => {
        if (!options.timeout) {
          callbacks.push(() => callback({ authorizationStatus: options.denied ? 1 : options.undetermined ? 0 : 2, alertSetting: 2 }));
        }
      },
      requestAuthorizationWithOptionsCompletionHandler: (flags: number, callback: (granted: boolean, error: unknown) => void) => {
        assert.equal(insideCallback, false);
        assert.equal(flags, 4);
        events.push("authorize");
        callbacks.push(() => callback(!options.authorizationError && !options.reject, options.authorizationError ? error : nil));
      },
      addNotificationRequestWithCompletionHandler: (request: unknown, callback: (error: unknown) => void) => {
        assert.equal(insideCallback, false);
        events.push("submit");
        callbacks.push(() => callback(options.deliveryError ? error : nil));
      },
    };
    const bridge = Object.assign(() => nil, {
      UNUserNotificationCenter: { currentNotificationCenter: center },
      UNAuthorizationStatusDenied: 1,
      UNAuthorizationStatusNotDetermined: 0,
      UNAuthorizationStatusAuthorized: 2,
      UNNotificationSettingEnabled: 2,
      UNAuthorizationOptionAlert: 4,
      UNMutableNotificationContent: { alloc: { init: {} } },
      UNNotificationRequest: {
        requestWithIdentifierContentTrigger: (identifier: string, content: { title: string; body: string }, trigger: unknown) => {
          assert.equal(insideCallback, false);
          assert.equal(trigger, nil);
          assert.equal(identifier, "human-input");
          assert.deepEqual(content, { title: "携宁 CLI 提醒", body: "固定通知测试文案" });
          return { identifier };
        },
      },
      NSProcessInfo: { processInfo: { arguments: ["helper", ...(options.diagnose ? ["--diagnose"] : options.authorizeOnly ? ["--authorize"] : []), "携宁 CLI 提醒", "固定通知测试文案", "isolated-status"] } },
      NSRunLoop: { currentRunLoop: { runUntilDate: () => {
        insideCallback = true;
        try { callbacks.shift()?.(); } finally { insideCallback = false; }
      } } },
      NSDate: { dateWithTimeIntervalSinceNow: () => 0 },
      NSString: { stringWithString: (value: string) => ({ writeToFileAtomicallyEncodingError: () => { result = value; } }) },
      NSUTF8StringEncoding: 4,
    });
    const sandbox = vm.createContext({
      $: bridge,
      ObjC: { import: () => undefined, unwrap: (value: unknown) => value, deepUnwrap: (value: unknown) => value },
      Date: { now: () => { clock += 1000; return clock; } },
    });
    vm.runInContext(script, sandbox);
    vm.runInContext("run()", sandbox);
    return { result: JSON.parse(result), events };
  };
  assert.deepEqual(execute({}), { result: { status: "submitted", authorizationStatus: 2, alertSetting: 2 }, events: ["submit"] });
  assert.deepEqual(execute({ undetermined: true }).events, ["authorize", "submit"]);
  assert.deepEqual(execute({ undetermined: true, authorizeOnly: true }), {
    result: { status: "authorized", authorizationStatus: 2, alertSetting: 2 }, events: ["authorize"],
  });
  assert.deepEqual(execute({ authorizeOnly: true }).events, []);
  assert.deepEqual(execute({ denied: true, authorizeOnly: true }).events, []);
  assert.equal(execute({ undetermined: true, authorizeOnly: true, reject: true }).result.status, "denied");
  assert.equal(execute({ denied: true }).result.status, "denied");
  assert.deepEqual(execute({ denied: true }).events, []);
  assert.equal(execute({ undetermined: true, authorizationError: true }).result.errorDomain, "UNErrorDomain");
  assert.equal(execute({ deliveryError: true }).result.status, "delivery-error");
  assert.deepEqual(execute({ diagnose: true }).events, []);
  assert.equal(execute({ diagnose: true }).result.status, "diagnostic");
  assert.equal(execute({ timeout: true }).result.status, "timeout");
});

test("macOS authorization modes query or request without sending notifications and refresh permission state", async (context) => {
  const storagePath = fs.mkdtempSync(path.join(os.tmpdir(), "sinitek-notification-authorization-"));
  context.after(() => fs.rmSync(storagePath, { recursive: true, force: true }));
  const env = harness(storagePath);
  const sender = env.create();
  for (const [authorizationStatus, alertSetting, expected] of [
    [0, 0, "not-determined"], [1, 1, "denied"], [2, 2, "authorized"], [2, 1, "disabled"], [3, 2, "authorized"],
  ] as const) {
    env.setResult({ status: "diagnostic", authorizationStatus, alertSetting });
    assert.deepEqual(await sender.getAuthorization(), { platform: "darwin", status: expected });
    assert.ok(env.commands[env.commands.length - 1].args.includes("--diagnose"));
  }
  env.setResult({ status: "authorized", authorizationStatus: 2, alertSetting: 2 });
  assert.deepEqual(await sender.requestAuthorization(), { platform: "darwin", status: "authorized" });
  assert.ok(env.commands[env.commands.length - 1].args.includes("--authorize"));
  env.setResult({ status: "denied", authorizationStatus: 1 });
  assert.equal((await sender.requestAuthorization()).status, "denied");
  env.setResult({ status: "submitted" });
  await sender();
  assert.ok(!env.commands[env.commands.length - 1].args.includes("--authorize"));
});

test("macOS concurrent authorization and notifications share preparation and recover after a failed operation", async (context) => {
  const storagePath = fs.mkdtempSync(path.join(os.tmpdir(), "sinitek-notification-queue-"));
  context.after(() => fs.rmSync(storagePath, { recursive: true, force: true }));
  const env = harness(storagePath);
  const sender = env.create();
  env.setResult({ status: "timeout" });
  const results = await Promise.allSettled([sender.requestAuthorization(), sender.getAuthorization(), sender()]);
  assert.ok(results.every((result) => result.status === "rejected"));
  assert.equal(env.commands.filter((command) => command.file === "/usr/bin/osacompile").length, 1);
  assert.equal(env.commands.filter((command) => command.file === "/usr/bin/open").length, 3);
  env.setResult({ status: "authorized", authorizationStatus: 2 });
  assert.equal((await sender.requestAuthorization()).status, "authorized");
});
