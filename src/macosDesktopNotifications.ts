import * as fs from "fs";
import * as path from "path";
import type { DesktopAttentionCommandRunner } from "./desktopAttention";

export const MACOS_NOTIFICATION_APP_ID = "com.sinitek.cli-tools.notifications";
export const MACOS_NOTIFICATION_APP_NAME = "携宁 CLI 提醒";

export function createMacOSDesktopNotificationSender(options: {
  storagePath: string;
  title: string;
  body: string;
  run: DesktopAttentionCommandRunner;
}) {
  let preparedApp: Promise<string> | undefined;
  const directory = path.join(options.storagePath, "desktop-attention", "macos-v4");
  const appPath = path.join(directory, `${MACOS_NOTIFICATION_APP_NAME}.app`);
  const script = `
ObjC.import('Foundation');
ObjC.import('UserNotifications');
function run() {
  var finished = false;
  var result = { status: 'timeout' };
  var authorized = false;
  var settings;
  var authorizationError;
  var deliveryError;
  var deadline = Date.now() + 60000;
  var arguments = ObjC.deepUnwrap($.NSProcessInfo.processInfo.arguments);
  var center = $.UNUserNotificationCenter.currentNotificationCenter;
  function waitForCompletion() {
    while (!finished && Date.now() < deadline) {
      $.NSRunLoop.currentRunLoop.runUntilDate($.NSDate.dateWithTimeIntervalSinceNow(0.1));
    }
  }
  function hasError(error) {
    return error && !error.isNil();
  }
  center.getNotificationSettingsWithCompletionHandler(function(value) {
    settings = value;
    finished = true;
  });
  waitForCompletion();
  if (finished) {
    result.authorizationStatus = Number(settings.authorizationStatus);
    result.alertSetting = Number(settings.alertSetting);
    if (arguments.indexOf('--diagnose') >= 0) {
      result.status = 'diagnostic';
    } else if (result.authorizationStatus === Number($.UNAuthorizationStatusDenied)) {
      result.status = 'denied';
    } else {
      finished = false;
      center.requestAuthorizationWithOptionsCompletionHandler($.UNAuthorizationOptionAlert, function(granted, error) {
        authorized = granted;
        authorizationError = error;
        finished = true;
      });
      waitForCompletion();
      if (finished && hasError(authorizationError)) {
        result.status = 'authorization-error';
        result.errorCode = Number(authorizationError.code);
        result.errorDomain = ObjC.unwrap(authorizationError.domain);
      } else if (finished && !authorized) {
        result.status = 'denied';
      }
    }
  }
  if (finished && authorized && !hasError(authorizationError)) {
    finished = false;
    var content = $.UNMutableNotificationContent.alloc.init;
    content.title = arguments[arguments.length - 3];
    content.body = arguments[arguments.length - 2];
    var request = $.UNNotificationRequest.requestWithIdentifierContentTrigger('human-input', content, $());
    center.addNotificationRequestWithCompletionHandler(request, function(error) {
      deliveryError = error;
      finished = true;
    });
    waitForCompletion();
    if (finished) {
      result.status = hasError(deliveryError) ? 'delivery-error' : 'submitted';
      if (hasError(deliveryError)) {
        result.errorCode = Number(deliveryError.code);
        result.errorDomain = ObjC.unwrap(deliveryError.domain);
      }
    }
  }
  $.NSString.stringWithString(JSON.stringify(result)).writeToFileAtomicallyEncodingError(arguments[arguments.length - 1], true, $.NSUTF8StringEncoding, null);
}
`;

  const isPrepared = async (): Promise<boolean> => {
    try {
      await fs.promises.access(path.join(appPath, "Contents", "Resources", "Scripts", "main.scpt"));
      await fs.promises.access(path.join(appPath, "Contents", "Info.plist"));
      return true;
    } catch {
      return false;
    }
  };

  const prepare = async (): Promise<string> => {
    if (await isPrepared()) {
      return appPath;
    }
    await fs.promises.mkdir(directory, { recursive: true });
    const buildDirectory = await fs.promises.mkdtemp(path.join(directory, "build-"));
    const buildAppPath = path.join(buildDirectory, `${MACOS_NOTIFICATION_APP_NAME}.app`);
    try {
      await options.run({
        file: "/usr/bin/osacompile",
        args: ["-o", buildAppPath, "-l", "JavaScript", "-e", script],
      });
      const infoPath = path.join(buildAppPath, "Contents", "Info.plist");
      for (const [key, value] of [
        ["CFBundleIdentifier", MACOS_NOTIFICATION_APP_ID],
        ["CFBundleName", MACOS_NOTIFICATION_APP_NAME],
        ["CFBundleDisplayName", MACOS_NOTIFICATION_APP_NAME],
      ]) {
        await options.run({ file: "/usr/bin/plutil", args: ["-replace", key, "-string", value, infoPath] });
      }
      await options.run({ file: "/usr/bin/plutil", args: ["-replace", "LSUIElement", "-bool", "YES", infoPath] });
      await options.run({ file: "/usr/bin/codesign", args: ["--force", "--sign", "-", buildAppPath] });
      try {
        await fs.promises.rename(buildAppPath, appPath);
      } catch (error) {
        if (!(await isPrepared())) {
          throw error;
        }
      }
      return appPath;
    } finally {
      await fs.promises.rm(buildDirectory, { recursive: true, force: true });
    }
  };

  return async (body: string = options.body): Promise<void> => {
    if (!preparedApp) {
      preparedApp = prepare().then(async (preparedPath) => {
        await options.run({
          file: "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister",
          args: ["-f", preparedPath],
        });
        return preparedPath;
      }).catch((error: unknown) => {
        preparedApp = undefined;
        throw error;
      });
    }
    const preparedPath = await preparedApp;
    const resultDirectory = await fs.promises.mkdtemp(path.join(directory, "result-"));
    const resultPath = path.join(resultDirectory, "status");
    try {
      await options.run({
        file: "/usr/bin/open",
        args: ["-g", "-W", "-n", preparedPath, "--args", options.title, body, resultPath],
        timeoutMs: 65000,
      });
      const result = JSON.parse(await fs.promises.readFile(resultPath, "utf8")) as {
        status: string;
        errorCode?: number;
        errorDomain?: string;
      };
      if (result.status !== "submitted") {
        const permissionDenied = result.status === "denied"
          || (result.errorDomain === "UNErrorDomain" && result.errorCode === 1);
        throw new Error(permissionDenied
          ? "系统未允许发送通知，请在“系统设置 → 通知 → 携宁 CLI 提醒”中开启允许通知，并选择横幅或提醒"
          : "系统通知未能提交，可能等待授权超时或系统拒绝请求");
      }
    } finally {
      await fs.promises.rm(resultDirectory, { recursive: true, force: true });
    }
  };
}
