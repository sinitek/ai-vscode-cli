import * as vscode from "vscode";

export type AppLocale = "zh-CN" | "en";
export type LocaleSetting = "auto" | AppLocale;

const ZH_LOCALE_PATTERN = /^zh(?:-|$)/i;
const CONFIG_NAMESPACE = "sinitek-cli-tools";
const LOCALE_SETTING_KEY = "locale";

function getRawLocaleSetting(): string {
  const config = vscode.workspace.getConfiguration(CONFIG_NAMESPACE);
  return config.get<string>(LOCALE_SETTING_KEY, "auto") ?? "auto";
}

export function getLocaleSetting(): LocaleSetting {
  const raw = getRawLocaleSetting();
  if (raw === "zh-CN" || raw === "en" || raw === "auto") {
    return raw;
  }
  return "auto";
}

export function resolveLocale(language?: string): AppLocale {
  const configured = getLocaleSetting();
  if (configured !== "auto") {
    return configured;
  }
  const resolved = language ?? vscode.env.language ?? "";
  return ZH_LOCALE_PATTERN.test(resolved) ? "zh-CN" : "en";
}

function formatMessage(
  template: string,
  params?: Record<string, string | number | boolean>
): string {
  if (!params) {
    return template;
  }
  return template.replace(/\{(\w+)\}/g, (match, key) => {
    if (Object.prototype.hasOwnProperty.call(params, key)) {
      return String(params[key]);
    }
    return match;
  });
}

const MESSAGES = {
  en: {
    "common.compactContext": "Compact context",
    "common.currentFile": "Current File",
    "common.currentFileWithRange": "Current File: {file} [{range}]",
    "common.commonCommandPrefix": "Common command: {label}",
    "common.delete": "Delete",
    "common.clear": "Clear",
    "common.cancel": "Cancel",
    "common.confirm": "Confirm",
    "common.close": "Close",
    "common.save": "Save",
    "common.load": "Load",
    "common.enable": "Enable",
    "common.disable": "Disable",
    "common.on": "On",
    "common.off": "Off",
    "common.copy": "Copy",
    "common.rename": "Rename",
    "common.export": "Export",
    "common.import": "Import",
    "common.add": "Add",
    "common.remove": "Remove",
    "common.update": "Update",
    "common.activate": "Activate",
    "common.deactivate": "Deactivate",
    "common.viewDetails": "View Details",
    "common.copyDetails": "Copy Details",
    "common.unknownError": "Unknown error",
    "common.openSettings": "Open Settings",
    "command.selectCliPlaceholder": "Select a CLI to use",
    "command.currentCliInfo": "Current CLI: {cli}",
    "pathPicker.file": "File",
    "pathPicker.folder": "Folder",
    "pathPicker.noWorkspace": "No workspace open. Unable to select files or folders.",
    "pathPicker.placeholder": "Select files or folders, type to filter",
    "pathPicker.readError": "Failed to read workspace paths. Please try again.",
    "pathPicker.dropParseError": "Failed to parse dropped files. Please try again.",
    "session.confirmDelete": "Delete this session history?",
    "session.confirmClearAll": "Clear all CLI session history?",
    "session.confirmClearPromptHistory": "Clear prompt history for current workspace?",
    "session.unnamed": "Untitled Session",
    "rules.loadNoWorkspace": "No workspace found. Unable to load project rules.",
    "rules.loadFailed": "Failed to load rules. Please try again.",
    "rules.saveNoWorkspace": "No workspace found. Unable to save project rules.",
    "rules.saveFailed": "Failed to save rules. Please try again.",
    "rules.invalidCli": "No valid CLI selected.",
    "upload.parseError": "Failed to parse file contents. Please try again.",
    "upload.saveError": "Failed to save file. Please try again.",
    "runStream.exportEmpty": "No stream messages to export.",
    "runStream.exportFailed": "Failed to export stream messages.",
    "config.notFound": "Config not found or removed.",
    "config.applyFailed": "Failed to apply config: {error}",
    "config.applyFailedTitle": "Failed to switch config.",
    "config.exportContentEmpty": "Export content must not be empty.",
    "config.unknownRequest": "Unknown request.",
    "config.panelTitle": "Sinitek CLI Assistant - Config",
    "config.appTitle": "Sinitek CLI Assistant",
    "config.updateLabel": "Update Config",
    "statusBar.text": "Sinitek CLI Config: {cli}",
    "statusBar.tooltip": "Open Sinitek CLI Config panel",
    "panel.appTitle": "Sinitek CLI Assistant",
    "panel.renderFailed": "Panel failed to render: {error}",
    "panel.runtimeError": "Panel runtime error.",
    "session.loadFailedTitle": "Failed to load session history.",
    "session.loadFailedMessage": "Session history loading failed. Detailed error has been reported.",
    "panel.logPath": "Log path: {path}",
    "run.exitCode": "CLI exit code: {code}",
    "run.stoppedByUser": "Stopped by user",
    "run.stopped": "Run stopped",
    "run.completed": "Task completed",
    "run.completedWithDuration": "Task completed in {duration}",
    "cli.notFound.win.title": "CLI executable not found: {command}",
    "cli.notFound.win.hint1": "Ensure it is installed and VS Code can access PATH; or set {configKey} to the absolute path (often %APPDATA%\\\\npm\\\\{command}.cmd).",
    "cli.notFound.win.hint2": "Run in PowerShell: where {command}",
    "cli.notFound.win.hint3": "Tip: Restart VS Code after installing or modifying PATH.",
    "cli.install.prompt": "{cli} CLI is not available ({command}). Install it now?",
    "cli.install.actionInstall": "One-click Install",
    "cli.install.started": "Started install command in terminal: {command}",
    "cli.notFound.unix.title": "CLI executable not found: {command}",
    "cli.notFound.unix.hint1": "Ensure it is installed and PATH is visible; or set {configKey} to the absolute path.",
    "cli.notFound.unix.hint2": "Run in terminal: which {command}",
    "cli.codexImage.unsupported": "Current Codex CLI ({command}) version {version} does not meet the official image attachment requirement (minimum supported version: {minVersion}, and `codex exec --image` must be available).",
    "cli.codexImage.upgradeHint": "To use official Codex image attachments in this extension, please upgrade Codex to the latest version. Until then, the extension will keep the legacy `@path` fallback behavior.",
    "cli.codexImage.upgradeAction": "Upgrade Codex",
    "cli.codexImage.versionUnknown": "unknown",
    "rules.noInteractiveForCompact": "Interactive mode is not enabled; cannot compact context.",
    "rules.compactUnsupported": "Current CLI does not support context compaction.",
    "rules.compactRunning": "A task is running. Please try again later.",
    "rules.compactNoSession": "Session not established yet; cannot compact.",
    "compact.systemPrompt": "Please compress the current session into a structured summary. The output must be plain text (no Markdown).",
    "compact.systemPrompt.reqTitle": "Requirements:",
    "compact.systemPrompt.req1": "1) Keep key information and avoid redundancy.",
    "compact.systemPrompt.req2": "2) Keep each item short; include key file paths/commands/conclusions when necessary.",
    "compact.systemPrompt.req3": "3) Strictly follow this template and keep the headings unchanged:",
    "compact.systemPrompt.summaryTitle": "【Session Summary】",
    "compact.systemPrompt.recentTitle": "【Recent Dialogue】",
    "compact.systemPrompt.requestTitle": "【Current Request】",
    "compact.failEmpty": "Context compaction failed (empty summary). No session switch performed.",
    "compact.failException": "Context compaction failed (execution error). No session switch performed.",
    "compact.failContinue": "Context compaction failed (summary task error). Continued with original request.",
    "compact.resumeNotice": "You are continuing a session with compacted context.",
    "compact.summaryCompressed": "【Session Summary】compressed: {from} -> {to}",
    "tool.inputLabel": "Input",
    "tool.outputLabel": "Output",
    "tool.resultLabel": "Tool result",
    "config.defaultName": "Default",
    "config.codexIncomplete": "Codex config is incomplete.",
    "config.mcpMustBeObject": "MCP config must be an object.",
    "config.requestFailed": "Request failed.",
    "skill.descriptionMissing": "Description unavailable",
    "skill.catalogMissing": "Bundled official packages catalog is unavailable.",
    "skill.installUnsupportedPlatform": "This platform does not support bundled official packages.",
    "skill.installAssetMissing": "Bundled official package archive is missing: {path}",
    "skill.installAlreadyExists": "Package already exists: {path}",
    "skill.installArchiveInvalid": "Bundled official package archive is invalid.",
    "skill.installZipToolMissing": "No ZIP extraction tool is available on this system.",
    "skill.uninstallMissing": "Installed skill directory does not exist: {path}",
    "skill.updateNotInstalled": "Package is not installed yet: {path}",
    "claude.sessionResetRetry": "Claude session expired. Automatically starting a new session and retrying.",
  },
  "zh-CN": {
    "common.compactContext": "压缩上下文",
    "common.currentFile": "当前文件",
    "common.currentFileWithRange": "当前文件: {file} [{range}]",
    "common.commonCommandPrefix": "常用指令：{label}",
    "common.delete": "删除",
    "common.clear": "清空",
    "common.cancel": "取消",
    "common.confirm": "确认",
    "common.close": "关闭",
    "common.save": "保存",
    "common.load": "加载",
    "common.enable": "开启",
    "common.disable": "关闭",
    "common.on": "开启",
    "common.off": "关闭",
    "common.copy": "复制",
    "common.rename": "重命名",
    "common.export": "导出",
    "common.import": "导入",
    "common.add": "添加",
    "common.remove": "移除",
    "common.update": "更新",
    "common.activate": "激活",
    "common.deactivate": "取消激活",
    "common.viewDetails": "查看详情",
    "common.copyDetails": "复制详情",
    "common.unknownError": "未知错误",
    "common.openSettings": "打开设置",
    "command.selectCliPlaceholder": "选择要使用的 CLI",
    "command.currentCliInfo": "当前 CLI：{cli}",
    "pathPicker.file": "文件",
    "pathPicker.folder": "目录",
    "pathPicker.noWorkspace": "当前没有打开的工作区，无法选择文件或目录。",
    "pathPicker.placeholder": "选择文件或目录，输入关键字过滤",
    "pathPicker.readError": "读取工作区路径失败，请重试。",
    "pathPicker.dropParseError": "解析拖拽文件失败，请重试。",
    "session.confirmDelete": "确认删除该会话历史？",
    "session.confirmClearAll": "确认清空所有 CLI 的历史会话？",
    "session.confirmClearPromptHistory": "确认清空当前工作区的历史提示词？",
    "session.unnamed": "未命名会话",
    "rules.loadNoWorkspace": "未找到工作区，无法加载项目规则。",
    "rules.loadFailed": "加载规则失败，请重试。",
    "rules.saveNoWorkspace": "未找到工作区，无法保存项目规则。",
    "rules.saveFailed": "保存规则失败，请重试。",
    "rules.invalidCli": "未选择有效的 CLI。",
    "upload.parseError": "文件内容解析失败，请重试。",
    "upload.saveError": "文件保存失败，请重试。",
    "runStream.exportEmpty": "暂无可导出的流式消息。",
    "runStream.exportFailed": "导出流式消息失败。",
    "config.notFound": "配置不存在或已删除",
    "config.applyFailed": "配置应用失败：{error}",
    "config.applyFailedTitle": "切换配置失败。",
    "config.exportContentEmpty": "导出内容不能为空",
    "config.unknownRequest": "未知请求",
    "config.panelTitle": "携宁 CLI 助手 - 配置",
    "config.appTitle": "携宁 CLI 助手",
    "config.updateLabel": "更新配置",
    "statusBar.text": "携宁 CLI 配置: {cli}",
    "statusBar.tooltip": "打开携宁 CLI 配置面板",
    "panel.appTitle": "携宁 CLI 助手",
    "panel.renderFailed": "面板渲染失败：{error}",
    "panel.runtimeError": "面板运行时错误。",
    "session.loadFailedTitle": "加载会话历史失败。",
    "session.loadFailedMessage": "会话历史加载失败，已上报详细错误信息。",
    "panel.logPath": "日志路径：{path}",
    "run.exitCode": "CLI 退出码: {code}",
    "run.stoppedByUser": "用户已终止",
    "run.stopped": "运行已终止",
    "run.completed": "任务已完成",
    "run.completedWithDuration": "任务已完成,执行 {duration}",
    "cli.notFound.win.title": "找不到 CLI 可执行文件：{command}",
    "cli.notFound.win.hint1": "请确认已安装且 VS Code 可访问 PATH；或在设置中把 {configKey} 配置为绝对路径（常见为 %APPDATA%\\\\npm\\\\{command}.cmd）。",
    "cli.notFound.win.hint2": "在 PowerShell 运行：where {command}",
    "cli.notFound.win.hint3": "提示：安装/修改 PATH 后需重启 VS Code。",
    "cli.install.prompt": "{cli} CLI 当前不可用（{command}），是否现在安装？",
    "cli.install.actionInstall": "一键安装",
    "cli.install.started": "已在终端执行安装命令：{command}",
    "cli.notFound.unix.title": "找不到 CLI 可执行文件：{command}",
    "cli.notFound.unix.hint1": "请确认已安装且 PATH 可见；或在设置中把 {configKey} 配置为绝对路径。",
    "cli.notFound.unix.hint2": "在终端运行：which {command}",
    "cli.codexImage.unsupported": "当前 Codex CLI（{command}）版本 {version} 不满足官方图片附件能力要求（最低支持版本：{minVersion}，且需要支持 `codex exec --image`）。",
    "cli.codexImage.upgradeHint": "如需在本插件中使用 Codex 官方图片通道，请将 Codex 升级到最新版本。升级前，插件会继续保留当前的 `@path` 兼容回退行为。",
    "cli.codexImage.upgradeAction": "升级 Codex",
    "cli.codexImage.versionUnknown": "未知版本",
    "rules.noInteractiveForCompact": "当前未开启交互模式，无法执行压缩。",
    "rules.compactUnsupported": "当前 CLI 不支持上下文压缩。",
    "rules.compactRunning": "当前任务运行中，请稍后再试。",
    "rules.compactNoSession": "当前会话尚未建立，无法压缩。",
    "compact.systemPrompt": "请把当前会话压缩为结构化摘要，输出必须是纯文本（不要 Markdown）。",
    "compact.systemPrompt.reqTitle": "要求：",
    "compact.systemPrompt.req1": "1) 保留关键信息，避免冗余。",
    "compact.systemPrompt.req2": "2) 每条尽量短，必要时引用关键文件路径/命令/结论。",
    "compact.systemPrompt.req3": "3) 严格按照以下模板输出，并保持标题不变：",
    "compact.systemPrompt.summaryTitle": "【会话摘要】",
    "compact.systemPrompt.recentTitle": "【最近对话】",
    "compact.systemPrompt.requestTitle": "【当前请求】",
    "compact.failEmpty": "上下文压缩失败（摘要为空），未进行会话切换。",
    "compact.failException": "上下文压缩失败（执行异常），未进行会话切换。",
    "compact.failContinue": "上下文压缩失败（摘要任务执行异常），已继续原始请求。",
    "compact.resumeNotice": "你正在继续一个已压缩上下文的会话。",
    "compact.summaryCompressed": "【会话摘要】已压缩：{from} -> {to}",
    "tool.inputLabel": "输入",
    "tool.outputLabel": "输出",
    "tool.resultLabel": "工具结果",
    "config.defaultName": "默认",
    "config.codexIncomplete": "Codex 配置不完整",
    "config.mcpMustBeObject": "MCP 配置必须是对象",
    "config.requestFailed": "请求失败",
    "skill.descriptionMissing": "技能说明暂缺",
    "skill.catalogMissing": "未找到内置官方包目录配置。",
    "skill.installUnsupportedPlatform": "当前平台不支持内置官方包安装。",
    "skill.installAssetMissing": "缺少内置官方包压缩包：{path}",
    "skill.installAlreadyExists": "包已存在：{path}",
    "skill.installArchiveInvalid": "内置官方包压缩包结构无效。",
    "skill.installZipToolMissing": "当前系统缺少可用的 ZIP 解压工具。",
    "skill.uninstallMissing": "未找到已安装的 Skill 目录：{path}",
    "skill.updateNotInstalled": "包尚未安装：{path}",
    "claude.sessionResetRetry": "检测到 Claude 会话已失效，已自动创建新会话并重试。",
  },
} as const;

export type I18nKey = keyof typeof MESSAGES.en;

export function t(
  key: I18nKey,
  params?: Record<string, string | number | boolean>,
  locale?: AppLocale
): string {
  const targetLocale = locale ?? resolveLocale();
  const table = MESSAGES[targetLocale] ?? MESSAGES.en;
  const template = table[key] ?? MESSAGES.en[key] ?? key;
  return formatMessage(template, params);
}

export function getLocaleLabel(language?: string): AppLocale {
  return resolveLocale(language);
}
