import { execFile } from "child_process";
import { win32 } from "path";
import type { HumanInteractionAttentionTransport } from "./humanInteractionAttention";
import { createMacOSDesktopNotificationSender } from "./macosDesktopNotifications";
import type { DesktopNotificationAuthorization } from "./desktopNotificationAuthorization";

export const HUMAN_INTERACTION_NOTIFICATION_TITLE = "携宁 CLI 提醒";
export const HUMAN_INTERACTION_NOTIFICATION_BODY = "有一项人机交互等待处理，请返回编辑器中的 AI 对话面板。";
export const TASK_COMPLETION_NOTIFICATION_BODY = "任务已完成，请返回编辑器中的 AI 对话面板查看结果。";

export type DesktopAttentionCommand = {
  file: string;
  args: string[];
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
};

export type DesktopAttentionCommandRunner = (command: DesktopAttentionCommand) => Promise<string>;

export function runDesktopAttentionCommand(command: DesktopAttentionCommand): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(command.file, command.args, {
      env: command.env,
      encoding: "utf8",
      timeout: command.timeoutMs ?? 8000,
      maxBuffer: 64 * 1024,
      windowsHide: true,
    }, (error, stdout) => {
      if (error) {
        reject(error);
      } else {
        resolve(stdout);
      }
    });
  });
}

const WINDOWS_NOTIFICATION_SCRIPT = `
$ErrorActionPreference = 'Stop'
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null
[Windows.UI.Notifications.ToastNotification, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null
[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] > $null
$document = New-Object Windows.Data.Xml.Dom.XmlDocument
$body = [System.Security.SecurityElement]::Escape($env:SINITEK_ATTENTION_BODY)
$document.LoadXml('<toast><visual><binding template="ToastGeneric"><text>${HUMAN_INTERACTION_NOTIFICATION_TITLE}</text><text>' + $body + '</text></binding></visual><audio silent="true"/></toast>')
$notification = [Windows.UI.Notifications.ToastNotification]::new($document)
$notification.Tag = $env:SINITEK_ATTENTION_TAG
$notification.Group = 'sinitek-cli-tools'
$notifier = [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($env:SINITEK_ATTENTION_APP_ID)
if ($notifier.Setting.ToString() -ne 'Enabled') { throw ('Windows notifications unavailable: ' + $notifier.Setting.ToString()) }
$notifier.Show($notification)
`;

const WINDOWS_NOTIFICATION_AUTHORIZATION_SCRIPT = `
$ErrorActionPreference = 'Stop'
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($env:SINITEK_ATTENTION_APP_ID).Setting.ToString()
`;

const WINDOWS_ATTENTION_SCRIPT = `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class SinitekWindowAttention {
  [StructLayout(LayoutKind.Sequential)]
  public struct FlashInfo {
    public uint Size;
    public IntPtr Window;
    public uint Flags;
    public uint Count;
    public uint Timeout;
  }
  public delegate bool WindowCallback(IntPtr window, IntPtr parameter);
  [DllImport("user32.dll")] public static extern bool EnumWindows(WindowCallback callback, IntPtr parameter);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr window);
  [DllImport("user32.dll")] public static extern bool FlashWindowEx(ref FlashInfo info);
  public static void Set(uint targetProcessId, bool enabled) {
    EnumWindows(delegate(IntPtr window, IntPtr parameter) {
      uint processId;
      GetWindowThreadProcessId(window, out processId);
      if (processId == targetProcessId && IsWindowVisible(window)) {
        FlashInfo info = new FlashInfo();
        info.Size = (uint)Marshal.SizeOf(typeof(FlashInfo));
        info.Window = window;
        info.Flags = enabled ? 14u : 0u;
        info.Count = UInt32.MaxValue;
        FlashWindowEx(ref info);
      }
      return true;
    }, IntPtr.Zero);
  }
}
'@
[SinitekWindowAttention]::Set([uint32]$env:SINITEK_ATTENTION_PROCESS_ID, $env:SINITEK_ATTENTION_ENABLED -eq 'true')
`;

export function createDesktopAttentionTransport(options: {
  platform: NodeJS.Platform;
  appName: string;
  appUserModelId?: string;
  mainProcessId?: number;
  storagePath?: string;
  env: NodeJS.ProcessEnv;
}, run: DesktopAttentionCommandRunner = runDesktopAttentionCommand): HumanInteractionAttentionTransport & {
  notificationAuthorization: (request: boolean) => Promise<DesktopNotificationAuthorization>;
} {
  const linuxWindows = new Set<string>();
  const notifyMacOS = options.storagePath ? createMacOSDesktopNotificationSender({
    storagePath: options.storagePath,
    title: HUMAN_INTERACTION_NOTIFICATION_TITLE,
    body: HUMAN_INTERACTION_NOTIFICATION_BODY,
    run,
  }) : undefined;
  const validProcessId = Number.isSafeInteger(options.mainProcessId)
    && Number(options.mainProcessId) > 0 && Number(options.mainProcessId) <= 0xffffffff;

  const powershell = (script: string, extraEnv: NodeJS.ProcessEnv): Promise<string> => run({
    file: options.env.SystemRoot
      ? win32.join(options.env.SystemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe") : "powershell.exe",
    args: ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")],
    env: { ...options.env, ...extraEnv },
  });

  const setWindowsAttention = async (enabled: boolean): Promise<void> => {
    if (!validProcessId) {
      return;
    }
    await powershell(WINDOWS_ATTENTION_SCRIPT, {
      SINITEK_ATTENTION_PROCESS_ID: String(options.mainProcessId),
      SINITEK_ATTENTION_ENABLED: String(enabled),
    });
  };

  return {
    async notificationAuthorization(request): Promise<DesktopNotificationAuthorization> {
      if (options.platform === "win32") {
        if (!options.appUserModelId) {
          return { platform: options.platform, status: "unavailable", detail: "无法读取编辑器的 Windows 系统通知标识，请检查编辑器安装。" };
        }
        const setting = (await powershell(WINDOWS_NOTIFICATION_AUTHORIZATION_SCRIPT, {
          SINITEK_ATTENTION_APP_ID: options.appUserModelId,
        })).trim();
        const settings: Record<string, Pick<DesktopNotificationAuthorization, "status" | "detail">> = {
          Enabled: { status: "authorized", detail: `Windows 已允许“${options.appName}”发送通知。若没有横幅，请在系统通知设置中开启通知横幅，并检查勿扰或专注模式。` },
          DisabledForApplication: { status: "denied", detail: `Windows 已关闭“${options.appName}”的通知，请在系统通知设置中开启该编辑器的通知和通知横幅。` },
          DisabledForUser: { status: "disabled", detail: "Windows 已关闭当前用户的系统通知，请在系统通知设置中开启通知。若由管理员管理，请联系管理员。" },
          DisabledByGroupPolicy: { status: "denied", detail: "Windows 通知已被系统策略禁用，请联系管理员处理；应用无法自行开启。" },
          DisabledByManifest: { status: "unavailable", detail: "当前编辑器安装未提供有效的 Windows 通知支持，请检查编辑器安装。" },
        };
        return { platform: options.platform, ...(settings[setting]
          ?? { status: "unavailable", detail: "无法识别 Windows 通知状态，请刷新重试或打开系统通知设置检查。" }) };
      }
      if (options.platform !== "darwin") {
        return { platform: options.platform, status: "not-required" };
      }
      if (!notifyMacOS) {
        return { platform: options.platform, status: "unavailable", detail: "无法确定本机通知助手的存储位置。" };
      }
      return request ? notifyMacOS.requestAuthorization() : notifyMacOS.getAuthorization();
    },
    async notify(kind = "human-interaction"): Promise<void> {
      const body = kind === "task-completed" ? TASK_COMPLETION_NOTIFICATION_BODY : HUMAN_INTERACTION_NOTIFICATION_BODY;
      if (options.platform === "darwin") {
        if (!notifyMacOS) {
          throw new Error("无法确定本机通知助手的存储位置。");
        }
        await notifyMacOS(body);
      } else if (options.platform === "win32") {
        if (!options.appUserModelId) {
          throw new Error("无法读取编辑器的 Windows 系统通知标识。");
        }
        await powershell(WINDOWS_NOTIFICATION_SCRIPT, {
          SINITEK_ATTENTION_APP_ID: options.appUserModelId,
          SINITEK_ATTENTION_BODY: body,
          SINITEK_ATTENTION_TAG: kind === "task-completed" ? "task-completed" : "human-input",
        });
      } else if (options.platform === "linux") {
        await run({
          file: "notify-send",
          args: ["--app-name", options.appName, "--icon", kind === "task-completed" ? "dialog-information" : "dialog-question", "--expire-time", "15000", "--",
            HUMAN_INTERACTION_NOTIFICATION_TITLE, body],
          env: options.env,
        });
      }
    },
    async startAttention(): Promise<void> {
      if (options.platform === "win32") {
        await setWindowsAttention(true);
      } else if (options.platform === "linux" && validProcessId && options.env.DISPLAY
        && !options.env.WAYLAND_DISPLAY && options.env.XDG_SESSION_TYPE !== "wayland") {
        const output = await run({ file: "wmctrl", args: ["-lp"], env: options.env });
        for (const line of output.split(/\r?\n/)) {
          const match = /^(0x[\da-f]+)\s+\S+\s+(\d+)\s+/i.exec(line);
          if (match && Number(match[2]) === options.mainProcessId) {
            linuxWindows.add(match[1]);
            await run({ file: "wmctrl", args: ["-ir", match[1], "-b", "add,demands_attention"], env: options.env });
          }
        }
      }
    },
    async stopAttention(): Promise<void> {
      if (options.platform === "win32") {
        await setWindowsAttention(false);
      } else if (options.platform === "linux") {
        const windowIds = Array.from(linuxWindows);
        linuxWindows.clear();
        await Promise.all(windowIds.map((windowId) => run({
          file: "wmctrl", args: ["-ir", windowId, "-b", "remove,demands_attention"], env: options.env,
        })));
      }
    },
  };
}
