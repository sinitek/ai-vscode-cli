import { CLI_LIST } from "../cli/types";
import { logError } from "../logger";
import { AppLocale, resolveLocale } from "../i18n";
import { readFileSync } from "fs";
import * as path from "path";

const LOBSTER_MAX_ROUNDS_SETTING_DEFAULT = 20;
const LOBSTER_MAX_ROUNDS_SETTING_MIN = 1;
const LOBSTER_MAX_ROUNDS_SETTING_MAX = 100;
const LOBSTER_EXECUTION_MODE_MAIN_SUB_MULTI_AGENT = "main_sub_multi_agent";
const LOBSTER_EXECUTION_MODE_DEBATE_MULTI_AGENT = "debate_multi_agent";

const WEBVIEW_I18N = {
  en: {
    appTitle: "Sinitek CLI Assistant",
    panelTitle: "AI Chat",
    headerHelp: "Help",
    headerToolSettings: "Tool Settings",
    headerRules: "Rules",
    headerNewSession: "New Session",
    headerResetSession: "Reset Current Tab",
    conversationTabsAria: "Parallel conversations",
    conversationTabsPrevPage: "Previous tab page",
    conversationTabsNextPage: "Next tab page",
    conversationTabLabel: "Session {index}",
    conversationTabCloseAria: "Close {label}",
    emptyState: "Type your request to start chatting.",
    scrollToBottomAria: "Jump to latest message",
    resultOnlyLabel: "Results only",
    resultOnlyAria: "Show only user messages and the final success reply",
    queueIndicatorAria: "View queue",
    queueIndicatorLabel: "Queue",
    taskListTitle: "Task List",
    cliSelectAria: "CLI selection",
    configSelectAria: "Config selection",
    commonUnknownError: "Unknown error",
    interactiveModeSelectAria: "Interactive response mode",
    interactiveModeCoding: "Coding",
    interactiveModeLobster: "Lobster",
    taskRoleMain: "🦞",
    taskRoleSubtask: "Subtask",
    taskRoleSubtaskWithRound: "Subtask · Round {round}",
    openLobsterDebateChatAction: "Open Lobster group chat",
    openLobsterDebateChatActionTitle: "Open the Lobster group chat for this task",
    openConfigButton: "Config",
    promptPlaceholder: "Shift + Enter for newline, type @ to pick files/folders, hold Shift while dragging files to reference them, supports pasting attachments...",
    commonCommandButton: "Common Commands",
    pathPickerButton: "Insert Path",
    attachmentButton: "Upload Attachment",
    contextTagCurrentFile: "Current File",
    contextTagSelection: "Selection",
    contextTagSelectionWithRange: "Current File: {file} [{range}]",
    contextTagRemoveAria: "Remove context: {label}",
    thinkingModeAria: "Thinking mode",
    thinkingOptionOff: "Off",
    thinkingOptionLow: "Low",
    thinkingOptionMedium: "Medium",
    thinkingOptionHigh: "High",
    thinkingOptionXHigh: "X-High",
    thinkingOptionMax: "Max",
    historyButton: "History",
    sendButton: "Send",
    stopButton: "Stop",
    historyTitle: "History",
    historyClearSessions: "Reset Current Tab",
    historyClearPrompts: "Clear Prompts",
    historyClose: "Close",
    historyTabsLabel: "History",
    historyTabPrompts: "Prompt History",
    historyTabSessions: "Sessions",
    historyTabLobsterGroupChats: "Lobster Group Chats",
    historySessionViewLabel: "Messages",
    historySessionExportLabel: "Export TXT",
    historySessionExporting: "Exporting...",
    historySessionMessagesTitle: "History Messages",
    historySessionMessagesClose: "Close",
    historySessionMessagesLoading: "Loading messages...",
    historySessionMessagesEmpty: "No saved messages.",
    historySessionMessagesUnknown: "Unknown Session",
    historySessionMessagesMeta: "{cli} · {time}",
    historySessionMessageUser: "User",
    historySessionMessageAssistant: "Assistant",
    historySessionMessageSystem: "System",
    historySessionMessageTrace: "Trace",
    historySessionMessageThinking: "Thinking",
    historySessionMessageToolUse: "Tool Use",
    rulesTitle: "Rules",
    rulesClose: "Close",
    rulesScopeLabel: "Scope",
    rulesScopeGlobal: "Global Rules",
    rulesScopeProject: "Project Rules",
    rulesLoadCliAria: "Load CLI",
    rulesLoadButton: "Load",
    rulesInputPlaceholder: "Enter rules...",
    rulesSaveLabel: "Save to:",
    rulesSaveGroupLabel: "Save to",
    rulesSaveButton: "Save",
    toolSettingsTitle: "Tool Settings",
    toolSettingsClose: "Close",
    toolSettingsGlobalTab: "Global",
    toolSettingsWorkspaceTab: "Workspace",
    toolSettingsDebugLabel: "Debug",
    toolSettingsDebugTitle: "Debug Logs",
    toolSettingsDebugToggle: "On",
    toolSettingsAutoContextLabel: "Auto File Tags",
    toolSettingsAutoContextTitle: "Automatically add the current file/selection as input context tags",
    toolSettingsAutoContextToggle: "On",
    toolSettingsLongTermMemoryLabel: "Plugin Long-Term Memory",
    toolSettingsLongTermMemoryTitle: "Workspace setting. When off, this extension will not recall or save plugin long-term memory for later tasks in this workspace. This does not control native memory in external CLI tools.",
    toolSettingsLongTermMemoryToggle: "On",
    toolSettingsLongTermMemoryHint: "Workspace setting. Disabling only blocks plugin-side memory recall and saves for future tasks in this workspace; existing memories can still be viewed, exported, or deleted.",
    toolSettingsLongTermMemoryManagedByChHint: "This workspace already has a .ch directory, so plugin-side long-term memory is automatically disabled to avoid overlapping project memory systems.",
    toolSettingsLanguageLabel: "Language",
    toolSettingsLanguageAria: "Language setting",
    toolSettingsLanguageAuto: "Auto (VS Code)",
    toolSettingsLanguageZh: "Chinese (Simplified)",
    toolSettingsLanguageEn: "English",
    toolSettingsMacShellLabel: "Task Shell",
    toolSettingsMacShellAria: "Task shell for macOS",
    toolSettingsMacShellZsh: "zsh",
    toolSettingsMacShellBash: "bash",
    commonCommandsTitle: "Common Commands",
    commonCommandsClose: "Close",
    commonCommandCompactTitle: "Compact Context",
    commonCommandCompactDesc: "After compaction, the next task uses fewer tokens.",
    runConflictTitle: "Task Running",
    runConflictClose: "Close",
    runConflictBody: "A task is still running. How should this message be handled?",
    runConflictDesc: "Choose “Add to Queue” to wait for the current task to finish successfully. If the current task fails or is stopped, queued prompts stay in the queue.",
    runConflictQueueButton: "Add to Queue",
    runConflictPauseButton: "Pause and Send",
    queueTitle: "Queued Prompts",
    queueContinueLabel: "Continue Queue",
    queueCloseLabel: "Close",
    queueEmpty: "No queued prompts.",
    queueEditLabel: "Edit",
    queueSaveLabel: "Save",
    queueCancelEditLabel: "Cancel",
    queueEditPlaceholder: "Update prompt before sending...",
    queueMoveUpLabel: "Move up",
    queueMoveDownLabel: "Move down",
    queueRemoveLabel: "Remove",
    runPromptViewAria: "View current running prompt",
    runPromptViewLabel: "Prompt",
    runStreamViewAria: "View live stream messages",
    runStreamViewLabel: "Stream",
    runPromptTitle: "Current Task Prompt",
    runPromptClose: "Close",
    runPromptEmpty: "No running prompt available.",
    runStreamTitle: "Live Raw Stream Messages",
    runStreamClose: "Close",
    configApplyErrorTitle: "Config Switch Failed",
    configApplyErrorClose: "Close",
    configApplyErrorCopy: "Copy Details",
    runStreamExportLabel: "Export TXT",
    runStreamExportAria: "Export all stream messages as a TXT file",
    runStreamExporting: "Exporting...",
    runStreamEmpty: "Waiting for stream output...",
    runStreamRecordIndex: "Line {index}",
    runStreamRecordEmpty: "(empty message)",
    runStreamSourceStdout: "stdout",
    runStreamSourceStderr: "stderr",
    runStreamSourceEvent: "event",
    runStreamSlowLabel: "Slow",
    runStreamVerySlowLabel: "Very Slow",
    runStatusCompacting: "Compacting context",
    helpTitle: "Help",
    helpClose: "Close",
    helpTabsLabel: "Help",
    helpTabInstall: "Install",
    helpTabThinking: "Thinking Mode",
    helpInstallWindows: "Windows Install",
    helpInstallMac: "macOS Install",
    helpInstallAccel: "Install Acceleration (Maybe)",
    helpInstallAccelOnce: "One-time acceleration:",
    helpInstallAccelSet: "Set global mirror:",
    helpInstallAccelReset: "Restore official registry:",
    helpRemoveEnvTitle: "Remove System Environment Overrides",
    helpRemoveEnvItem1: "Before using this tool, remove system-level env overrides for the CLI to avoid conflicts with config files.",
    helpRemoveEnvItemMac: "macOS: Check and remove related settings in ~/.zprofile, ~/.zshrc, or ~/.bash_profile.",
    helpRemoveEnvItemWin: "Windows: Remove CLI-related entries in System Properties > Advanced > Environment Variables.",
    helpThinkingGeneralTitle: "General",
    helpThinkingGeneralItem: "Thinking mode controls reasoning intensity. Higher means more reliable but slower and more costly.",
    helpThinkingCodexTitle: "Codex",
    helpThinkingCodexItem1: "Control intensity via model_reasoning_effort.",
    helpThinkingCodexItem2: "Options: low / medium / high (no explicit off; low is minimal).",
    helpThinkingGeminiTitle: "Gemini",
    helpThinkingGeminiItem1: "Controlled via thinkingConfig in the config file.",
    helpThinkingGeminiItem2: "Gemini 2.5: not supported yet; Gemini 3: thinkingLevel.",
    helpThinkingGeminiItem3: "Common values: minimal / low / medium / high (varies by model).",
    helpThinkingClaudeTitle: "Claude",
    helpThinkingClaudeItem1: "Use --max-thinking-tokens to control thinking tokens.",
    helpThinkingClaudeItem2: "0 means off; higher values increase reasoning depth.",
    noConfigOption: "No configs",
    historyEmptySessions: "No session history",
    historyEmptyPrompts: "No prompt history",
    historyEmptyLobsterGroupChats: "No lobster group chat history",
    lobsterHistoryModeMainSub: "Main/Sub",
    lobsterHistoryModeDebate: "Red/Blue Debate",
    lobsterHistoryMeta: "{mode} · Round {round} · Updated {time}",
    sessionDefaultLabel: "Untitled Session",
    sessionOpenInTabsLabel: "Open",
    sessionLoadLabel: "Load",
    sessionDeleteLabel: "Delete",
    promptViewLabel: "View",
    promptCollapseLabel: "Collapse",
    promptReuseLabel: "Reuse",
    promptEmptyLabel: "(Empty prompt)",
    traceToolFallback: "tool",
    traceGitUpdate: "Git Update",
    traceExec: "Run Command",
    traceExecTagTest: "Test",
    traceExecTagBuild: "Build",
    traceExecTagTypeCheck: "Type Check",
    traceExecTagLint: "Lint",
    traceExecTagInstall: "Install",
    traceExecTagGitRead: "Git Read",
    traceExecTagGitWrite: "Git Write",
    traceExecTagSearch: "Search",
    traceExecTagFileRead: "File Read",
    traceExecTagFileWrite: "File Write",
    traceExecTagPython: "Python",
    traceExecTagRun: "Run",
    traceExecTagOther: "General",
    traceFileUpdate: "File Changes",
    traceApplyPatch: "Apply Patch",
    traceToolResult: "Tool Result",
    traceWarning: "Warning",
    traceError: "Error",
    traceThinking: "Thinking",
    traceWebSearch: "Web Search",
    traceInputLabel: "Input",
    traceOutputLabel: "Output",
    traceFileChangesLabel: "File Changes",
    traceExpandCommand: "Show full command",
    traceExpandChanges: "Show file changes",
    traceExpandThinking: "Show thinking details",
    traceExpandTool: "Show tool details",
    traceExpandToolResult: "Show {tool} output",
    toastCopied: "Copied",
    toastCopyFailed: "Copy failed",
    toastQueueAdded: "Added to queue",
    toastQueueUpdated: "Queued prompt updated",
    toastQueueEmptyPrompt: "Prompt cannot be empty",
    toastQueueSendFailed: "Failed to send queued prompt. Activate a config first.",
    toastQueuePaused: "Queue paused because the previous task did not finish successfully. {count} prompt(s) remain queued.",
    toastNoActiveConfig: "No active config for the current CLI. Activate one in the config page first.",
    toastFileReadFailed: "Failed to read file content.",
    toastReadFileFailed: "Failed to read file. Please try again.",
    toastRunStreamExportEmpty: "No stream messages to export.",
    toastRunStreamExportSuccess: "Exported to: {path}",
    toastRunStreamExportFailed: "Failed to export stream messages: {error}",
    toastHistorySessionLoadFailed: "Failed to load history messages: {error}",
    toastHistorySessionExportEmpty: "No history messages to export.",
    toastHistorySessionExportSuccess: "Exported to: {path}",
    toastHistorySessionExportFailed: "Failed to export history messages: {error}",
    toastConfigApplyErrorCopied: "Config error details copied",
    rulesPathNoWorkspace: "Path: No workspace detected",
    rulesPathPrefix: "Path: ",
    rulesHintLoading: "Loading...",
    rulesHintSaving: "Saving...",
    rulesHintSelectCli: "Select at least one CLI to overwrite.",
    rulesHintLoaded: "Loaded {scope}: {cli}.",
    rulesHintSaved: "{scope} saved to: {targets}",
    thinkingOptionLabelLow: "Low",
    thinkingOptionLabelOff: "Off",
    thinkingOptionLabelMedium: "Medium",
    thinkingOptionLabelHigh: "High",
    thinkingOptionLabelXHigh: "X-High",
    thinkingOptionLabelMax: "Max",
    modelSelectAria: "Model selection",
    modelOptionDefault: "Model: Follow Config",
    modelMainSelectAria: "Lobster main-task model selection",
    modelSubtaskSelectAria: "Lobster subtask model selection",
    lobsterExecutionModeSelectAria: "Lobster execution mode",
    lobsterExecutionModeOptionMainSubMultiAgent: "Main/Sub Multi-Agent",
    lobsterExecutionModeOptionDebateMultiAgent: "Red/Blue Debate Multi-Agent",
    modelOptionMainDefault: "Main model: Follow Config",
    modelOptionSubtaskDefault: "Subtask model: Follow Config",
    modelOptionManage: "Manage",
    modelAddPrompt: "Enter model name:",
    modelAddTitle: "Manage Models",
    modelAddLabel: "Model name",
    modelAddPlaceholder: "Enter model name, e.g. claude-sonnet-4-20250514",
    modelAddButton: "Add",
    modelSaveButton: "Save",
    modelAddEmptyError: "Model name cannot be empty",
    modelAddExistsError: "Model already exists",
    modelManageEmpty: "No models yet. Add one below.",
    modelManageCancelEdit: "Cancel Edit",
    modelManageEditing: "Editing: {model}",
    modelManageRoleMain: "Main",
    modelManageRoleSubtask: "Subtask",
    modelEditLabel: "Edit",
    modelMoveUpLabel: "Move Up",
    modelMoveDownLabel: "Move Down",
    modelRemoveLabel: "Delete",
    modelDeleteConfirm: "Delete model \"{model}\"?",
  },
  "zh-CN": {
    appTitle: "携宁 CLI 助手",
    panelTitle: "AI 对话",
    headerHelp: "使用说明",
    headerToolSettings: "工具设置",
    headerRules: "规则配置",
    headerNewSession: "新建会话",
    headerResetSession: "重置当前会话",
    conversationTabsAria: "并行会话",
    conversationTabsPrevPage: "上一页会话",
    conversationTabsNextPage: "下一页会话",
    conversationTabLabel: "会话{index}",
    conversationTabCloseAria: "关闭{label}",
    emptyState: "输入需求，开始对话。",
    scrollToBottomAria: "跳转到最新消息",
    resultOnlyLabel: "仅看结果",
    resultOnlyAria: "仅显示用户消息和 AI 最终成功回复",
    queueIndicatorAria: "查看队列",
    queueIndicatorLabel: "队列",
    taskListTitle: "任务列表",
    cliSelectAria: "CLI 选择",
    configSelectAria: "配置选择",
    commonUnknownError: "未知错误",
    interactiveModeSelectAria: "交互回复模式",
    interactiveModeCoding: "编码",
    interactiveModeLobster: "龙虾",
    taskRoleMain: "🦞",
    taskRoleSubtask: "子任务",
    taskRoleSubtaskWithRound: "子任务·第{round}轮",
    openLobsterDebateChatAction: "打开龙虾群聊",
    openLobsterDebateChatActionTitle: "打开当前龙虾任务的群聊页面",
    openConfigButton: "配置",
    promptPlaceholder: "Shift + Enter 换行，输入 @ 选择文件/目录，按住 Shift 拖拽文件可引用，支持附件黏贴...",
    commonCommandButton: "常用指令",
    pathPickerButton: "插入路径",
    attachmentButton: "上传附件",
    contextTagCurrentFile: "当前文件",
    contextTagSelection: "选中内容",
    contextTagSelectionWithRange: "当前文件: {file} [{range}]",
    contextTagRemoveAria: "移除上下文：{label}",
    thinkingModeAria: "思考模式",
    thinkingOptionOff: "关闭",
    thinkingOptionLow: "低",
    thinkingOptionMedium: "中",
    thinkingOptionHigh: "高",
    thinkingOptionXHigh: "超高",
    thinkingOptionMax: "最大",
    historyButton: "历史会话",
    sendButton: "发送",
    stopButton: "停止",
    historyTitle: "历史记录",
    historyClearSessions: "重置当前会话",
    historyClearPrompts: "清空提示词",
    historyClose: "关闭",
    historyTabsLabel: "历史记录",
    historyTabPrompts: "历史提示词",
    historyTabSessions: "历史会话",
    historyTabLobsterGroupChats: "龙虾群聊",
    historySessionViewLabel: "查看消息",
    historySessionExportLabel: "导出 TXT",
    historySessionExporting: "导出中...",
    historySessionMessagesTitle: "历史消息",
    historySessionMessagesClose: "关闭",
    historySessionMessagesLoading: "正在加载消息...",
    historySessionMessagesEmpty: "暂无保存的消息。",
    historySessionMessagesUnknown: "未知会话",
    historySessionMessagesMeta: "{cli} · {time}",
    historySessionMessageUser: "用户",
    historySessionMessageAssistant: "助手",
    historySessionMessageSystem: "系统",
    historySessionMessageTrace: "追踪",
    historySessionMessageThinking: "思考",
    historySessionMessageToolUse: "工具使用",
    rulesTitle: "规则",
    rulesClose: "关闭",
    rulesScopeLabel: "规则范围",
    rulesScopeGlobal: "全局规则",
    rulesScopeProject: "项目规则",
    rulesLoadCliAria: "加载 CLI",
    rulesLoadButton: "加载",
    rulesInputPlaceholder: "输入规则内容...",
    rulesSaveLabel: "保存覆盖到：",
    rulesSaveGroupLabel: "保存覆盖到",
    rulesSaveButton: "保存",
    toolSettingsTitle: "工具设置",
    toolSettingsClose: "关闭",
    toolSettingsGlobalTab: "全局",
    toolSettingsWorkspaceTab: "工作区",
    toolSettingsDebugLabel: "调试",
    toolSettingsDebugTitle: "调试日志",
    toolSettingsDebugToggle: "开启",
    toolSettingsAutoContextLabel: "自动文件标签",
    toolSettingsAutoContextTitle: "自动将当前文件/选区加入输入框上下文标签",
    toolSettingsAutoContextToggle: "开启",
    toolSettingsLongTermMemoryLabel: "插件侧长期记忆",
    toolSettingsLongTermMemoryTitle: "工作区设置。关闭后，扩展不会在当前工作区的后续任务中召回或保存插件侧长期记忆；不控制外部 CLI 自带记忆。",
    toolSettingsLongTermMemoryToggle: "开启",
    toolSettingsLongTermMemoryHint: "工作区设置。关闭仅阻止当前工作区后续任务的插件侧记忆召回和保存；仍可查看、导出或删除已有记忆。",
    toolSettingsLongTermMemoryManagedByChHint: "当前工作区已存在 .ch 目录，说明项目已有自己的记忆体系；为避免重叠，插件侧长期记忆已自动关闭。",
    toolSettingsLanguageLabel: "语言",
    toolSettingsLanguageAria: "语言设置",
    toolSettingsLanguageAuto: "自动（跟随 VS Code）",
    toolSettingsLanguageZh: "中文（简体）",
    toolSettingsLanguageEn: "英文",
    toolSettingsMacShellLabel: "任务 Shell",
    toolSettingsMacShellAria: "macOS 任务 Shell",
    toolSettingsMacShellZsh: "zsh",
    toolSettingsMacShellBash: "bash",
    commonCommandsTitle: "常用指令",
    commonCommandsClose: "关闭",
    commonCommandCompactTitle: "压缩上下文",
    commonCommandCompactDesc: "压缩后下一个任务节省 token 数消耗",
    runConflictTitle: "任务执行中",
    runConflictClose: "关闭",
    runConflictBody: "检测到当前任务仍在执行，要如何处理这条消息？",
    runConflictDesc: "选择“加入队列”后，只有当前任务成功结束才会继续发送；如果当前任务失败或被停止，后续提示词会继续留在队列中。",
    runConflictQueueButton: "加入队列",
    runConflictPauseButton: "暂停并发送",
    queueTitle: "队列提示词",
    queueContinueLabel: "继续执行队列",
    queueCloseLabel: "关闭",
    queueEmpty: "当前没有待发送的提示词。",
    queueEditLabel: "编辑",
    queueSaveLabel: "保存",
    queueCancelEditLabel: "取消",
    queueEditPlaceholder: "发送前可在这里修改提示词...",
    queueMoveUpLabel: "上移",
    queueMoveDownLabel: "下移",
    queueRemoveLabel: "取消",
    runPromptViewAria: "查看当前执行提示词",
    runPromptViewLabel: "提示词",
    runStreamViewAria: "查看流式消息",
    runStreamViewLabel: "流式消息",
    runPromptTitle: "当前任务提示词",
    runPromptClose: "关闭",
    runPromptEmpty: "暂无可查看的提示词。",
    runStreamTitle: "实时原始流式消息",
    runStreamClose: "关闭",
    configApplyErrorTitle: "切换配置失败",
    configApplyErrorClose: "关闭",
    configApplyErrorCopy: "复制详情",
    runStreamExportLabel: "导出 TXT",
    runStreamExportAria: "导出全部流式消息为 TXT 文件",
    runStreamExporting: "导出中...",
    runStreamEmpty: "等待流式输出...",
    runStreamRecordIndex: "第 {index} 条",
    runStreamRecordEmpty: "（空消息）",
    runStreamSourceStdout: "标准输出",
    runStreamSourceStderr: "其它输出",
    runStreamSourceEvent: "事件",
    runStreamSlowLabel: "慢",
    runStreamVerySlowLabel: "极慢",
    runStatusCompacting: "压缩上下文中",
    helpTitle: "使用说明",
    helpClose: "关闭",
    helpTabsLabel: "使用说明",
    helpTabInstall: "安装",
    helpTabThinking: "思考模式",
    helpInstallWindows: "Windows 安装",
    helpInstallMac: "macOS 安装",
    helpInstallAccel: "安装加速（也许有效）",
    helpInstallAccelOnce: "一次性加速：",
    helpInstallAccelSet: "设置全局镜像：",
    helpInstallAccelReset: "恢复官方源：",
    helpRemoveEnvTitle: "移除系统环境变量配置",
    helpRemoveEnvItem1: "使用该工具前需清理对 CLI 的系统级环境变量修改，避免与配置文件冲突。",
    helpRemoveEnvItemMac: "macOS：检查并移除 ~/.zprofile、~/.zshrc 或 ~/.bash_profile 中相关设置。",
    helpRemoveEnvItemWin: "Windows：通过“系统属性 > 高级 > 环境变量”删除为 CLI 手动添加的相关设置。",
    helpThinkingGeneralTitle: "通用说明",
    helpThinkingGeneralItem: "思考模式用于调节推理强度，越高通常更稳但更慢、成本更高。",
    helpThinkingCodexTitle: "Codex",
    helpThinkingCodexItem1: "通过配置 model_reasoning_effort 控制强度。",
    helpThinkingCodexItem2: "可选值：low / medium / high（无显式关闭，low 近似最低）。",
    helpThinkingGeminiTitle: "Gemini",
    helpThinkingGeminiItem1: "通过配置文件的 thinkingConfig 控制。",
    helpThinkingGeminiItem2: "Gemini 2.5：暂不支持；Gemini 3：thinkingLevel。",
    helpThinkingGeminiItem3: "常见值：minimal / low / medium / high（随模型而异）。",
    helpThinkingClaudeTitle: "Claude",
    helpThinkingClaudeItem1: "使用 --max-thinking-tokens 控制思考 token 数。",
    helpThinkingClaudeItem2: "0 视为关闭，数值越高推理越深入。",
    noConfigOption: "暂无配置",
    historyEmptySessions: "暂无会话历史",
    historyEmptyPrompts: "暂无历史提示词",
    historyEmptyLobsterGroupChats: "暂无龙虾群聊历史",
    lobsterHistoryModeMainSub: "主从",
    lobsterHistoryModeDebate: "红蓝辩论",
    lobsterHistoryMeta: "{mode} · 第 {round} 轮 · 更新 {time}",
    sessionDefaultLabel: "未命名会话",
    sessionOpenInTabsLabel: "已激活",
    sessionLoadLabel: "加载",
    sessionDeleteLabel: "删除",
    promptViewLabel: "查看",
    promptCollapseLabel: "收起",
    promptReuseLabel: "复用",
    promptEmptyLabel: "（空提示词）",
    traceToolFallback: "工具",
    traceGitUpdate: "Git 更新",
    traceExec: "执行命令",
    traceExecTagTest: "测试",
    traceExecTagBuild: "构建",
    traceExecTagTypeCheck: "类型检查",
    traceExecTagLint: "代码检查",
    traceExecTagInstall: "安装",
    traceExecTagGitRead: "Git 查询",
    traceExecTagGitWrite: "Git 变更",
    traceExecTagSearch: "检索",
    traceExecTagFileRead: "读取",
    traceExecTagFileWrite: "写入",
    traceExecTagPython: "Python",
    traceExecTagRun: "运行",
    traceExecTagOther: "通用",
    traceFileUpdate: "文件变更",
    traceApplyPatch: "应用补丁",
    traceToolResult: "工具结果",
    traceWarning: "警告",
    traceError: "错误",
    traceThinking: "思考",
    traceWebSearch: "网络查询",
    traceInputLabel: "输入",
    traceOutputLabel: "输出",
    traceFileChangesLabel: "文件变更",
    traceExpandCommand: "展开查看完整命令",
    traceExpandChanges: "展开查看文件变更",
    traceExpandThinking: "展开查看思考详情",
    traceExpandTool: "展开查看工具详情",
    traceExpandToolResult: "展开查看 {tool} 输出",
    toastCopied: "已复制",
    toastCopyFailed: "复制失败",
    toastQueueAdded: "已加入队列",
    toastQueueUpdated: "队列提示词已更新",
    toastQueueEmptyPrompt: "提示词不能为空",
    toastQueueSendFailed: "队列发送失败，请先激活配置",
    toastQueuePaused: "由于上一个任务未成功结束，队列已暂停。还有 {count} 条提示词留在队列中。",
    toastNoActiveConfig: "当前 CLI 未激活配置，请先在配置页激活后再发送。",
    toastFileReadFailed: "无法读取文件内容",
    toastReadFileFailed: "文件读取失败，请重试。",
    toastRunStreamExportEmpty: "暂无可导出的流式消息。",
    toastRunStreamExportSuccess: "已导出到：{path}",
    toastRunStreamExportFailed: "导出流式消息失败：{error}",
    toastHistorySessionLoadFailed: "加载历史消息失败：{error}",
    toastHistorySessionExportEmpty: "暂无可导出的历史消息。",
    toastHistorySessionExportSuccess: "已导出到：{path}",
    toastHistorySessionExportFailed: "导出历史消息失败：{error}",
    toastConfigApplyErrorCopied: "已复制配置错误详情",
    rulesPathNoWorkspace: "路径：未检测到工作区",
    rulesPathPrefix: "路径：",
    rulesHintLoading: "正在加载...",
    rulesHintSaving: "正在保存...",
    rulesHintSelectCli: "请选择至少一个 CLI 进行覆盖保存。",
    rulesHintLoaded: "已加载 {scope}：{cli}。",
    rulesHintSaved: "{scope}已保存到：{targets}",
    thinkingOptionLabelLow: "低",
    thinkingOptionLabelOff: "关闭",
    thinkingOptionLabelMedium: "中",
    thinkingOptionLabelHigh: "高",
    thinkingOptionLabelXHigh: "超高",
    thinkingOptionLabelMax: "最大",
    modelSelectAria: "模型选择",
    modelOptionDefault: "默认",
    modelMainSelectAria: "龙虾主任务模型选择",
    modelSubtaskSelectAria: "龙虾子任务模型选择",
    lobsterExecutionModeSelectAria: "龙虾执行模式",
    lobsterExecutionModeOptionMainSubMultiAgent: "主从多智能体",
    lobsterExecutionModeOptionDebateMultiAgent: "红蓝辩论多智能体",
    modelOptionMainDefault: "主任务模型：默认",
    modelOptionSubtaskDefault: "子任务模型：默认",
    modelOptionManage: "管理",
    modelAddPrompt: "输入模型名称：",
    modelAddTitle: "管理模型",
    modelAddLabel: "模型名称",
    modelAddPlaceholder: "输入模型名称，如 claude-sonnet-4-20250514",
    modelAddButton: "添加",
    modelSaveButton: "保存",
    modelAddEmptyError: "模型名称不能为空",
    modelAddExistsError: "模型已存在",
    modelManageEmpty: "暂无模型，请在下方添加。",
    modelManageCancelEdit: "取消编辑",
    modelManageEditing: "正在编辑：{model}",
    modelManageRoleMain: "主任务",
    modelManageRoleSubtask: "子任务",
    modelEditLabel: "编辑",
    modelMoveUpLabel: "上移",
    modelMoveDownLabel: "下移",
    modelRemoveLabel: "删除",
    modelDeleteConfirm: "确认删除模型“{model}”？",
  },
} as const;

type WebviewI18nKey = keyof typeof WEBVIEW_I18N.en;

function getWebviewStrings(locale: AppLocale): Record<WebviewI18nKey, string> {
  return locale === "zh-CN" ? WEBVIEW_I18N["zh-CN"] : WEBVIEW_I18N.en;
}

let cachedMarkedScript: string | undefined;

export function getWebviewHtml(webview: { cspSource: string }): string {
  const nonce = getNonce();
  const locale = resolveLocale();
  const i18n = getWebviewStrings(locale);
  const cliOptions = CLI_LIST.map((cli) => `<option value="${cli}">${cli}</option>`).join("");
  const markedScript = getMarkedScript();

  return `<!DOCTYPE html>
<html lang="${locale}">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} https:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${i18n.appTitle}</title>
    <style>
      :root {
        --radius-sm: 4px;
        --radius-md: 8px;
        --radius-lg: 12px;
        --gap-sm: 8px;
        --gap-md: 16px;
        --panel-content-padding: 16px;
      }
      body {
        font-family: var(--vscode-font-family);
        font-size: 14px;
        line-height: 1.5;
        color: var(--vscode-editor-foreground);
        background-color: var(--vscode-editor-background);
        margin: 0;
        padding: 0;
        overflow: hidden;
      }
      .app {
        display: flex;
        flex-direction: column;
        height: calc(var(--app-height, 100vh));
        box-sizing: border-box;
      }
      
      /* Header - Minimalist */
      .header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 8px 16px;
        border-bottom: 1px solid var(--vscode-widget-border);
        background: var(--vscode-editor-background);
        min-height: 36px;
      }
      .title {
        font-weight: 600;
        font-size: 13px;
        opacity: 0.9;
      }
      .header-actions {
        display: flex;
        gap: 6px;
      }
      .icon-button {
        background: transparent;
        border: none;
        color: var(--vscode-icon-foreground);
        cursor: pointer;
        padding: 4px;
        border-radius: var(--radius-sm);
        display: flex;
        align-items: center;
        justify-content: center;
        opacity: 0.8;
        transition: all 0.2s;
      }
      .icon-button:hover {
        background: var(--vscode-toolbar-hoverBackground);
        opacity: 1;
      }
      .send-icon-button {
        background: var(--vscode-button-background);
        color: var(--vscode-button-foreground);
        opacity: 1;
      }
      .send-icon-button:hover {
        background: var(--vscode-button-hoverBackground);
      }
      .send-icon-button:disabled {
        background: var(--vscode-button-background);
        color: var(--vscode-button-foreground);
      }
      .conversation-tabs {
        display: none;
        align-items: flex-end;
        gap: 0;
        padding: 8px 16px 0;
        overflow: hidden;
        border-bottom: 1px solid var(--vscode-widget-border, var(--vscode-input-border));
      }
      .conversation-tabs.visible {
        display: flex;
      }
      .conversation-tabs-track {
        display: flex;
        align-items: flex-end;
        gap: 0;
        flex: 1;
        min-width: 0;
      }
      .conversation-tabs-nav {
        width: 22px;
        height: 22px;
        margin-bottom: 4px;
        padding: 0;
        border-radius: 999px;
        border: 1px solid var(--vscode-widget-border, var(--vscode-input-border));
        background: var(--vscode-editor-background);
        color: var(--vscode-editor-foreground);
        line-height: 1;
        font-size: 12px;
      }
      .conversation-tabs-nav:disabled {
        opacity: 0.45;
        cursor: default;
      }
      .conversation-tab {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        min-height: 22px;
        margin-bottom: -1px;
        margin-left: -1px;
        padding: 2.5px 10px;
        border-radius: 0;
        border: 1px solid var(--vscode-widget-border, var(--vscode-input-border));
        background: var(--vscode-editorGroupHeader-tabsBackground, var(--vscode-editorWidget-background));
        color: var(--vscode-editor-foreground);
        cursor: pointer;
        position: relative;
        white-space: nowrap;
        min-width: 0;
        z-index: 0;
      }
      .conversation-tab:first-child {
        margin-left: 0;
        border-top-left-radius: 6px;
      }
      .conversation-tab:last-child {
        border-top-right-radius: 6px;
      }
      .conversation-tab:hover {
        background: var(--vscode-tab-hoverBackground, var(--vscode-toolbar-hoverBackground));
      }
      .conversation-tab.active {
        background: var(--vscode-tab-activeBackground, var(--vscode-editor-background));
        color: var(
          --vscode-textLink-foreground,
          var(--vscode-charts-blue, var(--vscode-tab-activeForeground, var(--vscode-editor-foreground)))
        );
        font-weight: 700;
        border-radius: 6px 6px 0 0;
        border-bottom-color: var(--vscode-tab-activeBackground, var(--vscode-editor-background));
        z-index: 2;
      }
      .conversation-tab.disabled {
        cursor: default;
        opacity: 0.6;
      }
      .conversation-tab.running {
        border-color: transparent;
        z-index: 3;
      }
      .conversation-tab.running::after {
        content: "";
        position: absolute;
        inset: -1px;
        border-radius: inherit;
        pointer-events: none;
        background:
          repeating-linear-gradient(90deg, var(--vscode-focusBorder, var(--vscode-textLink-foreground)) 0 8px, transparent 8px 14px) top left / 200% 2px repeat-x,
          repeating-linear-gradient(90deg, var(--vscode-focusBorder, var(--vscode-textLink-foreground)) 0 8px, transparent 8px 14px) bottom left / 200% 2px repeat-x,
          repeating-linear-gradient(0deg, var(--vscode-focusBorder, var(--vscode-textLink-foreground)) 0 8px, transparent 8px 14px) left top / 2px 200% repeat-y,
          repeating-linear-gradient(0deg, var(--vscode-focusBorder, var(--vscode-textLink-foreground)) 0 8px, transparent 8px 14px) right top / 2px 200% repeat-y;
        animation: conversationTabRunningFlow 900ms linear infinite;
      }
      .conversation-tab.errored {
        border-color: var(--vscode-inputValidation-errorBorder, var(--vscode-errorForeground));
        box-shadow: 0 0 0 1px var(--vscode-inputValidation-errorBorder, var(--vscode-errorForeground));
        z-index: 3;
      }
      .conversation-tab-label {
        font-size: 12px;
      }
      .conversation-tab-close {
        border: none;
        background: transparent;
        color: inherit;
        cursor: pointer;
        font-size: 14px;
        line-height: 1;
        padding: 0;
        width: 14px;
        height: 14px;
      }
      .conversation-tab-close:disabled {
        cursor: default;
      }
      @keyframes conversationTabRunningFlow {
        /* Layer order: top, bottom, left, right. Clockwise flow: top →, bottom ←, left ↑, right ↓. */
        from {
          background-position: 0 0, 0 100%, 0 0, 100% 0;
        }
        to {
          background-position: 28px 0, -28px 100%, 0 -28px, 100% 28px;
        }
      }
      .icon {
        width: 16px;
        height: 16px;
      }
      #commonCommandButton span {
        width: 16px;
        height: 16px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-family: var(--vscode-editor-font-family);
        font-size: 13px;
        font-weight: 600;
        line-height: 16px;
      }
      #pathPickerButton span {
        width: 16px;
        height: 16px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 14px;
        font-weight: 600;
        line-height: 16px;
      }
      
      /* Chat Area */
      .chat-area {
        flex: 1;
        overflow-y: auto;
        padding: 20px 16px;
        margin: 0 var(--panel-content-padding);
        background: var(--vscode-editor-background);
        min-height: 0;
        box-sizing: border-box;
        border: 1px solid var(--vscode-widget-border, var(--vscode-input-border, rgba(128, 128, 128, 0.45)));
        border-radius: 10px;
        position: relative;
      }
      .chat-filter-toggle {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        color: var(--vscode-descriptionForeground);
        font-size: 12px;
        line-height: 1.4;
        user-select: none;
        cursor: pointer;
        padding: 0 2px;
      }
      .chat-filter-toggle input {
        margin: 0;
        cursor: pointer;
      }
      .scroll-to-bottom-wrap {
        position: sticky;
        bottom: 16px;
        height: 0;
        display: flex;
        justify-content: flex-end;
        pointer-events: none;
        z-index: 3;
      }
      .scroll-to-bottom-button {
        width: 34px;
        height: 34px;
        border-radius: 999px;
        border: 1px solid var(--vscode-button-border, var(--vscode-button-background));
        background: var(--vscode-button-background, var(--vscode-focusBorder));
        color: var(--vscode-button-foreground, var(--vscode-editor-background));
        display: inline-flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        opacity: 0;
        transform: translateY(6px);
        pointer-events: none;
        transition: opacity 0.15s ease, transform 0.15s ease;
        box-shadow: 0 1px 3px color-mix(in srgb, var(--vscode-editor-foreground) 18%, transparent);
      }
      .scroll-to-bottom-button.visible {
        opacity: 1;
        transform: translateY(0);
        pointer-events: auto;
      }
      .scroll-to-bottom-button:hover {
        background: var(--vscode-button-hoverBackground, var(--vscode-button-background));
      }
      .scroll-to-bottom-button .icon {
        width: 14px;
        height: 14px;
      }
      .messages {
        display: flex;
        flex-direction: column;
        gap: 20px;
        max-width: 100%;
        padding-bottom: 10px;
      }
      
      /* Message Blocks */
      .message {
        display: flex;
        flex-direction: column;
        gap: 6px;
        max-width: 100%;
        min-width: 0;
      }
      .message .bubble {
        min-width: 0;
        overflow-wrap: anywhere;
        word-break: break-word;
      }
      .message-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-top: 8px;
      }
      .message-action-link {
        appearance: none;
        border: 0;
        background: transparent;
        color: var(--vscode-textLink-foreground);
        cursor: pointer;
        font: inherit;
        line-height: 1.4;
        padding: 0;
        text-decoration: underline;
        text-underline-offset: 2px;
      }
      .message-action-link:hover {
        color: var(--vscode-textLink-activeForeground, var(--vscode-textLink-foreground));
      }
      .message-action-link:focus-visible {
        outline: 1px solid var(--vscode-focusBorder);
        outline-offset: 2px;
      }
      .message-task-role {
        align-self: flex-start;
        display: inline-flex;
        align-items: center;
        border: 1px solid var(--vscode-badge-background, var(--vscode-widget-border));
        background: var(--vscode-badge-background, var(--vscode-editorWidget-background));
        color: var(--vscode-badge-foreground, var(--vscode-foreground));
        border-radius: 999px;
        padding: 1px 8px;
        font-size: 11px;
        line-height: 18px;
      }
      .message.user .message-task-role {
        align-self: flex-end;
      }
      /* User Message - Distinct Bubble */
      .message.user {
        align-items: flex-end;
      }
      .message.user .message-time {
        font-size: 11px;
        color: var(--vscode-descriptionForeground);
        opacity: 0.7;
        margin-bottom: 4px;
      }
      .message.user .bubble {
        background: var(--vscode-button-secondaryHoverBackground, var(--vscode-button-secondaryBackground));
        color: var(--vscode-button-secondaryForeground);
        padding: 10px 14px;
        border-radius: 16px 16px 4px 16px;
        max-width: 85%;
        box-sizing: border-box;
        border: 1px solid var(--vscode-widget-border, var(--vscode-input-border, rgba(128, 128, 128, 0.45)));
        box-shadow: 0 1px 2px rgba(0,0,0,0.05);
        white-space: pre-wrap;
      }
      .message.user .user-context-tags {
        margin-top: 8px;
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
      }
      .message.user .user-context-tag {
        display: inline-flex;
        align-items: center;
        max-width: 100%;
        border: 1px solid var(--vscode-inputOption-activeBorder, var(--vscode-input-border));
        background: var(--vscode-inputOption-activeBackground, var(--vscode-editorWidget-background));
        color: var(--vscode-inputOption-activeForeground, var(--vscode-input-foreground));
        border-radius: 999px;
        padding: 2px 8px;
        font-size: 11px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      /* Assistant Message - Clean, width-filling */
      .message.assistant {
        align-items: flex-start;
        --assistant-final-accent: var(
          --vscode-focusBorder,
          var(--vscode-textLink-foreground, var(--vscode-charts-blue))
        );
      }
      .message.assistant .bubble {
        background: transparent;
        border: 1px solid var(--vscode-widget-border, var(--vscode-input-border, rgba(128, 128, 128, 0.45)));
        border-radius: var(--radius-md);
        padding: 12px;
        max-width: 100%;
        width: 100%;
        box-sizing: border-box;
      }
      .message.assistant.message-final-summary .bubble {
        background: var(--vscode-editorWidget-background, transparent);
      }
      .message.assistant .assistant-message-content-final {
        border: 1px solid var(--assistant-final-accent);
        border-left-width: 4px;
        border-radius: var(--radius-md);
        padding: 12px 14px;
        background: var(
          --vscode-editorHoverWidget-background,
          var(--vscode-editorWidget-background, transparent)
        );
        box-sizing: border-box;
      }
      .message.assistant .assistant-message-content-final > :first-child {
        margin-top: 0;
      }
      .message.assistant .assistant-message-content-final > :last-child {
        margin-bottom: 0;
      }
      
      /* Markdown Styles */
      .message.assistant .bubble p {
        margin: 0 0 8px 0;
        line-height: 1.6;
      }
      .message.assistant .bubble p:last-child {
        margin-bottom: 0;
      }
      .message.assistant .bubble pre {
        background: var(--vscode-textCodeBlock-background);
        border: 1px solid var(--vscode-widget-border);
        border-radius: var(--radius-md);
        padding: 12px;
        overflow-x: auto;
        margin: 12px 0;
        font-family: var(--vscode-editor-font-family);
        font-size: 12px;
        box-sizing: border-box;
        max-width: 100%;
        overflow-wrap: normal;
        word-break: normal;
      }
      .message.assistant .bubble code {
        font-family: var(--vscode-editor-font-family);
        font-size: 12px;
        background: var(--vscode-textCodeBlock-background);
        padding: 2px 5px;
        border-radius: 4px;
        color: var(--vscode-textPreformat-foreground);
      }
      .message.assistant .bubble pre code {
        background: transparent;
        padding: 0;
        color: inherit;
      }
      .message.assistant .bubble ul, .message.assistant .bubble ol {
        margin: 8px 0;
        padding-left: 24px;
      }
      .message.assistant .bubble li {
        margin-bottom: 4px;
      }
      .message.assistant .bubble blockquote {
        border-left: 3px solid var(--vscode-textBlockQuote-border);
        background: var(--vscode-textBlockQuote-background);
        margin: 8px 0;
        padding: 8px 12px;
      }

      /* System & Trace Messages */
      .message.system {
        align-self: center;
        font-size: 12px;
        color: var(--vscode-descriptionForeground);
        margin: 8px 0;
        width: 100%;
      }
      .message.system .bubble {
        background: transparent;
        color: var(--vscode-descriptionForeground);
        padding: 4px 0;
        border-radius: 0;
        font-size: 12px;
        width: 100%;
        box-sizing: border-box;
      }
      .message.system .system-line {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
      }
      .message.system .system-time {
        font-size: 11px;
        opacity: 0.6;
        white-space: nowrap;
      }
      
      .message.trace {
        font-size: 12px;
      }
      .message.trace .bubble {
        font-family: var(--vscode-editor-font-family);
        background: var(--vscode-editor-inactiveSelectionBackground);
        color: var(--vscode-editor-foreground);
        padding: 8px 12px;
        border-radius: var(--radius-md);
        white-space: pre-wrap;
        border-left: 3px solid var(--trace-accent, var(--vscode-minimap-findMatchHighlight));
        --trace-title-fg: var(--vscode-badge-foreground);
        --trace-title-bg: var(--vscode-badge-background);
        --trace-title-border: transparent;
        box-sizing: border-box;
      }
      .message.trace.trace-type-exec .bubble {
        --trace-accent: var(
          --vscode-notificationsWarningIcon-foreground,
          var(
            --vscode-editorWarning-foreground,
            var(
              --vscode-charts-orange,
              var(--vscode-editorWarning-border, var(--vscode-minimap-findMatchHighlight)))
          )
        );
        --trace-title-fg: var(--trace-accent);
        --trace-title-bg: var(
          --vscode-diffEditor-insertedTextBackground,
          var(--vscode-editor-selectionHighlightBackground, var(--vscode-editor-inactiveSelectionBackground))
        );
        --trace-title-border: var(--trace-accent);
      }
      .message.trace.trace-type-git-update .bubble {
        --trace-accent: var(
          --vscode-gitDecoration-modifiedResourceForeground,
          var(--vscode-charts-blue, var(--vscode-minimap-findMatchHighlight))
        );
        --trace-title-fg: var(--trace-accent);
        --trace-title-bg: var(
          --vscode-diffEditor-modifiedTextBackground,
          var(--vscode-editor-selectionHighlightBackground, var(--vscode-editor-inactiveSelectionBackground))
        );
        --trace-title-border: var(--trace-accent);
      }
      .message.trace.trace-type-file-update .bubble {
        --trace-accent: var(
          --vscode-gitDecoration-addedResourceForeground,
          var(--vscode-charts-green, var(--vscode-minimap-findMatchHighlight))
        );
        --trace-title-fg: var(--trace-accent);
        --trace-title-bg: var(
          --vscode-diffEditor-insertedTextBackground,
          var(--vscode-editor-selectionHighlightBackground, var(--vscode-editor-inactiveSelectionBackground))
        );
        --trace-title-border: var(--trace-accent);
      }
      .message.trace.trace-type-apply-patch .bubble {
        --trace-accent: var(
          --vscode-gitDecoration-stageModifiedResourceForeground,
          var(--vscode-charts-purple, var(--vscode-minimap-findMatchHighlight))
        );
        --trace-title-fg: var(--trace-accent);
        --trace-title-bg: var(
          --vscode-editor-selectionHighlightBackground,
          var(--vscode-editor-inactiveSelectionBackground)
        );
        --trace-title-border: var(--trace-accent);
      }
      .message.trace.trace-type-tool-use-0 .bubble {
        --trace-accent: var(
          --vscode-notificationsWarningIcon-foreground,
          var(
            --vscode-editorWarning-foreground,
            var(
              --vscode-charts-orange,
              var(--vscode-editorWarning-border, var(--vscode-minimap-findMatchHighlight)))
          )
        );
        --trace-title-fg: var(--trace-accent);
        --trace-title-bg: var(
          --vscode-diffEditor-insertedTextBackground,
          var(--vscode-editor-selectionHighlightBackground, var(--vscode-editor-inactiveSelectionBackground))
        );
        --trace-title-border: var(--trace-accent);
      }
      .message.trace.trace-type-tool-use-1 .bubble {
        --trace-accent: var(
          --vscode-gitDecoration-modifiedResourceForeground,
          var(--vscode-charts-blue, var(--vscode-minimap-findMatchHighlight))
        );
        --trace-title-fg: var(--trace-accent);
        --trace-title-bg: var(
          --vscode-diffEditor-modifiedTextBackground,
          var(--vscode-editor-selectionHighlightBackground, var(--vscode-editor-inactiveSelectionBackground))
        );
        --trace-title-border: var(--trace-accent);
      }
      .message.trace.trace-type-tool-use-2 .bubble {
        --trace-accent: var(
          --vscode-gitDecoration-addedResourceForeground,
          var(--vscode-charts-green, var(--vscode-minimap-findMatchHighlight))
        );
        --trace-title-fg: var(--trace-accent);
        --trace-title-bg: var(
          --vscode-diffEditor-insertedTextBackground,
          var(--vscode-editor-selectionHighlightBackground, var(--vscode-editor-inactiveSelectionBackground))
        );
        --trace-title-border: var(--trace-accent);
      }
      .message.trace.trace-type-tool-use-3 .bubble {
        --trace-accent: var(
          --vscode-gitDecoration-stageModifiedResourceForeground,
          var(--vscode-charts-purple, var(--vscode-minimap-findMatchHighlight))
        );
        --trace-title-fg: var(--trace-accent);
        --trace-title-bg: var(
          --vscode-editor-selectionHighlightBackground,
          var(--vscode-editor-inactiveSelectionBackground)
        );
        --trace-title-border: var(--trace-accent);
      }
      .message.trace.trace-type-tool-use-0 .trace-title,
      .message.trace.trace-type-tool-use-1 .trace-title,
      .message.trace.trace-type-tool-use-2 .trace-title,
      .message.trace.trace-type-tool-use-3 .trace-title {
        text-transform: none;
      }
      .message.trace.trace-type-tool-result .bubble {
        --trace-accent: var(
          --vscode-charts-green,
          var(--vscode-terminal-ansiGreen, var(--vscode-minimap-findMatchHighlight))
        );
        --trace-title-fg: var(--trace-accent);
        --trace-title-bg: var(
          --vscode-diffEditor-insertedTextBackground,
          var(--vscode-editor-selectionHighlightBackground, var(--vscode-editor-inactiveSelectionBackground))
        );
        --trace-title-border: var(--trace-accent);
      }
      .message.trace.trace-type-warning .bubble {
        --trace-accent: var(
          --vscode-editorWarning-foreground,
          var(--vscode-notificationsWarningIcon-foreground, var(--vscode-minimap-findMatchHighlight))
        );
        --trace-title-fg: var(--trace-accent);
        --trace-title-bg: var(
          --vscode-inputValidation-warningBackground,
          var(--vscode-editor-inactiveSelectionBackground)
        );
        --trace-title-border: var(--trace-accent);
      }
      .message.trace.trace-type-error .bubble {
        --trace-accent: var(
          --vscode-editorError-foreground,
          var(--vscode-notificationsErrorIcon-foreground, var(--vscode-minimap-findMatchHighlight))
        );
        --trace-title-fg: var(--trace-accent);
        --trace-title-bg: var(
          --vscode-inputValidation-errorBackground,
          var(--vscode-editor-inactiveSelectionBackground)
        );
        --trace-title-border: var(--trace-accent);
      }
      .message.trace.trace-type-thinking .bubble {
        --trace-accent: var(
          --vscode-editorInfo-foreground,
          var(--vscode-notificationsInfoIcon-foreground, var(--vscode-minimap-findMatchHighlight))
        );
        --trace-title-fg: var(--trace-accent);
        --trace-title-bg: var(
          --vscode-inputValidation-infoBackground,
          var(--vscode-editor-inactiveSelectionBackground)
        );
        --trace-title-border: var(--trace-accent);
      }
      .message.trace.trace-type-web-search .bubble {
        --trace-accent: var(
          --vscode-terminal-ansiMagenta,
          var(--vscode-charts-purple, #b48ead)
        );
        --trace-title-fg: var(--trace-accent);
        --trace-title-bg: rgba(180, 142, 173, 0.15);
        --trace-title-border: var(--trace-accent);
      }
      .trace-header {
        display: flex;
        align-items: flex-start;
        justify-content: flex-start;
        flex-direction: column;
        gap: 8px;
        margin-bottom: 6px;
      }
      .trace-tag-row {
        display: flex;
        align-items: center;
        gap: 6px;
        flex-wrap: wrap;
      }
      .trace-title {
        font-size: 11px;
        font-weight: 600;
        letter-spacing: 0.3px;
        padding: 2px 8px;
        border-radius: 999px;
        background: var(--trace-title-bg, var(--vscode-badge-background));
        color: var(--trace-title-fg, var(--vscode-badge-foreground));
        border: 1px solid var(--trace-title-border, transparent);
        text-transform: uppercase;
      }
      .trace-command-tag {
        font-size: 11px;
        font-weight: 600;
        letter-spacing: 0.2px;
        padding: 2px 8px;
        border-radius: 999px;
        border: 1px solid var(--vscode-widget-border);
        background: var(--vscode-editorWidget-background);
        color: var(--vscode-descriptionForeground);
      }
      .trace-command-tag.cmd-purpose-test,
      .trace-command-tag.cmd-purpose-typecheck,
      .trace-command-tag.cmd-purpose-lint {
        color: var(--vscode-testing-iconPassed, var(--vscode-terminal-ansiGreen));
      }
      .trace-command-tag.cmd-purpose-build,
      .trace-command-tag.cmd-purpose-install {
        color: var(--vscode-terminal-ansiYellow, var(--vscode-charts-yellow));
      }
      .trace-command-tag.cmd-purpose-git-read,
      .trace-command-tag.cmd-purpose-search,
      .trace-command-tag.cmd-purpose-file-read {
        color: var(--vscode-charts-blue, var(--vscode-terminal-ansiBlue));
      }
      .trace-command-tag.cmd-purpose-git-write,
      .trace-command-tag.cmd-purpose-file-write {
        color: var(--vscode-gitDecoration-modifiedResourceForeground, var(--vscode-terminal-ansiMagenta));
      }
      .trace-command-tag.cmd-purpose-python {
        color: var(--vscode-terminal-ansiBlue, var(--vscode-charts-blue));
      }
      .trace-command-tag.cmd-purpose-run {
        color: var(--vscode-terminal-ansiCyan, var(--vscode-charts-foreground));
      }
      .trace-detail {
        font-size: 11px;
        color: var(--vscode-descriptionForeground);
        font-family: var(--vscode-editor-font-family);
        width: 100%;
        white-space: pre-wrap;
        overflow-wrap: anywhere;
        text-align: left;
      }
      .trace-time {
        margin-top: 6px;
        font-size: 11px;
        opacity: 0.7;
        text-align: left;
        font-variant-numeric: tabular-nums;
      }
      .message.trace.trace-thinking .bubble {
        background: transparent;
        border-left: none;
        padding: 4px 0;
      }
      .message.trace.trace-nonthinking .bubble {
        opacity: 1;
      }
      .trace-content {
        display: flex;
        flex-direction: column;
        gap: 0;
      }
      .trace-collapsible {
        border: 1px solid var(--vscode-widget-border);
        border-radius: 6px;
        background: var(--vscode-editorWidget-background);
      }
      .trace-collapsible summary {
        cursor: pointer;
        list-style: none;
        padding: 6px 10px;
        font-size: 11px;
        color: var(--vscode-descriptionForeground);
        user-select: none;
      }
      .trace-collapsible summary::-webkit-details-marker {
        display: none;
      }
      .trace-collapsible summary::before {
        content: "▸";
        margin-right: 6px;
      }
      .trace-collapsible[open] summary::before {
        content: "▾";
      }
      .trace-collapsible .trace-content {
        border-top: 1px solid var(--vscode-widget-border);
        padding: 6px 10px 8px;
      }
      .trace-collapsible:not([open]) .trace-content {
        display: none;
      }
      .trace-collapsible.trace-collapsible-tool-result:not([open]) .trace-content {
        display: none !important;
        max-height: 0;
        overflow: hidden;
      }
      .trace-line {
        white-space: pre-wrap;
      }
      .trace-line.line-numbered {
        background: var(--vscode-textCodeBlock-background);
        border: 1px solid var(--vscode-widget-border);
        border-radius: 4px;
        color: var(--vscode-textPreformat-foreground);
        padding: 2px 6px;
        font-family: var(--vscode-editor-font-family);
      }
      .trace-line.diff-added {
        color: var(
          --vscode-diffEditor-insertedTextForeground,
          var(--vscode-gitDecoration-addedResourceForeground, var(--vscode-terminal-ansiGreen, var(--vscode-charts-green)))
        );
      }
      .trace-line.diff-removed {
        color: var(
          --vscode-diffEditor-removedTextForeground,
          var(--vscode-gitDecoration-deletedResourceForeground, var(--vscode-terminal-ansiRed, var(--vscode-charts-red)))
        );
      }

      /* Typing Indicator */
      .run-wait {
        padding-left: 4px;
        align-items: center;
        gap: 8px;
      }
      .typing {
        display: inline-flex;
        gap: 4px;
        padding: 8px 12px;
        background: var(--vscode-editor-inactiveSelectionBackground);
        border-radius: 12px;
        align-items: center;
      }
      .typing-dot {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: var(--vscode-descriptionForeground);
        animation: typingPulse 1.4s infinite ease-in-out both;
      }
      .run-wait-time {
        font-size: 12px;
        color: var(--vscode-descriptionForeground);
        font-variant-numeric: tabular-nums;
      }
      .run-status-text {
        font-size: 12px;
        color: var(--vscode-descriptionForeground);
        white-space: nowrap;
      }
      .run-status-text.compacting {
        display: inline-flex;
        align-items: center;
        min-width: 0;
        padding: 2px 9px;
        border: 1px solid var(--vscode-focusBorder);
        border-radius: 999px;
        background: var(--vscode-editorWidget-background);
        color: var(--vscode-foreground);
        animation: compactStatusPulse 1.6s ease-in-out infinite;
      }
      .run-status-text.compacting::after {
        content: "...";
        display: inline-block;
        width: 0;
        overflow: hidden;
        animation: compactStatusDots 1.2s steps(4, end) infinite;
      }
      .run-prompt-button {
        display: inline-flex;
        align-items: center;
        border: 1px solid var(--vscode-widget-border);
        border-radius: 999px;
        padding: 2px 8px;
        background: var(--vscode-editorWidget-background);
        color: var(--vscode-foreground);
        font-size: 12px;
        height: 24px;
      }
      .run-prompt-button:hover {
        background: var(--vscode-toolbar-hoverBackground);
      }
      .run-stream-button {
        display: inline-flex;
        align-items: center;
        border: 1px solid var(--vscode-widget-border);
        border-radius: 999px;
        padding: 2px 8px;
        background: var(--vscode-editorWidget-background);
        color: var(--vscode-foreground);
        font-size: 12px;
        height: 24px;
      }
      .run-stream-button:hover {
        background: var(--vscode-toolbar-hoverBackground);
      }
      .run-stream-stale-badge {
        display: inline-flex;
        align-items: center;
        border: 1px solid transparent;
        border-radius: 999px;
        padding: 0 8px;
        font-size: 11px;
        line-height: 1;
        height: 18px;
        white-space: nowrap;
      }
      .run-stream-stale-badge.run-stream-stale-badge-warning {
        border-color: var(--vscode-inputValidation-warningBorder, var(--vscode-editorWarning-foreground));
        background: var(--vscode-inputValidation-warningBackground, var(--vscode-editor-inactiveSelectionBackground));
        color: var(--vscode-editorWarning-foreground);
      }
      .run-stream-stale-badge.run-stream-stale-badge-critical {
        border-color: var(--vscode-inputValidation-errorBorder, var(--vscode-errorForeground));
        background: var(--vscode-inputValidation-errorBackground, var(--vscode-editor-inactiveSelectionBackground));
        color: var(--vscode-errorForeground);
      }
      .typing-dot:nth-child(1) { animation-delay: -0.32s; }
      .typing-dot:nth-child(2) { animation-delay: -0.16s; }
      @keyframes typingPulse {
        0%, 80%, 100% { transform: scale(0); }
        40% { transform: scale(1); }
      }
      @keyframes compactStatusPulse {
        0%, 100% {
          border-color: var(--vscode-widget-border);
          box-shadow: 0 0 0 0 transparent;
        }
        50% {
          border-color: var(--vscode-focusBorder);
          box-shadow: 0 0 0 2px var(--vscode-editor-inactiveSelectionBackground);
        }
      }
      @keyframes compactStatusDots {
        0% { width: 0; }
        100% { width: 1.5em; }
      }
      @media (prefers-reduced-motion: reduce) {
        .run-status-text.compacting {
          animation: none;
        }
        .run-status-text.compacting::after {
          width: 1.5em;
          animation: none;
        }
      }

      /* Empty State */
      .empty-state {
        display: flex;
        align-items: center;
        justify-content: center;
        height: 100%;
        color: var(--vscode-descriptionForeground);
        font-size: 13px;
        opacity: 0.7;
        padding-bottom: 40px;
      }

      /* Input Area */
      .input-area {
        padding: 8px var(--panel-content-padding);
        background: var(--vscode-editor-background);
      }

      /* Controls Row (CLI, Config) */
      .config-select-row {
        display: flex;
        gap: 4px;
        margin-bottom: 5px;
        align-items: center;
        flex-wrap: nowrap;
        overflow: hidden;
      }
      
      select {
        background: var(--vscode-dropdown-background);
        color: var(--vscode-dropdown-foreground);
        border: 1px solid var(--vscode-dropdown-border);
        border-radius: 4px;
        padding: 4px 8px;
        height: 28px;
        outline: none;
        font-size: 12px;
        cursor: pointer;
      }
      select:hover {
        border-color: var(--vscode-focusBorder);
      }
      
      .cli-select {
        flex: 0 1 88px;
        min-width: 88px;
      }
      .config-select {
        flex: 1 1 165px;
        min-width: 120px;
      }
      .interactive-mode-select {
        flex: 0 1 69px;
        min-width: 69px;
      }
      .model-select {
        flex: 0 1 118px;
        min-width: 92px;
      }
      .lobster-execution-mode-select {
        flex: 0 1 142px;
        min-width: 122px;
        max-width: 190px;
      }
      .thinking-select {
        flex: 0 0 70px;
        width: 70px;
        min-width: 70px;
      }

      /* Input Box Container */
      .input-box {
        border: 1px solid var(--vscode-input-border, var(--vscode-widget-border, rgba(128, 128, 128, 0.55)));
        background: var(--vscode-input-background);
        border-radius: 10px;
        padding: 12px;
        display: flex;
        flex-direction: column;
        gap: 10px;
        transition: border-color 0.2s, box-shadow 0.2s;
        position: relative;
        box-shadow: 0 0 0 1px var(--vscode-widget-border, rgba(128, 128, 128, 0.35));
      }
      .input-box:focus-within {
        border-color: var(--vscode-focusBorder);
        box-shadow: 0 0 0 1px var(--vscode-focusBorder);
      }
      .prompt-context-tags {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
      }
      .prompt-context-tag {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        max-width: 100%;
        border: 1px solid var(--vscode-inputOption-activeBorder, var(--vscode-input-border));
        background: var(--vscode-inputOption-activeBackground, var(--vscode-editorWidget-background));
        color: var(--vscode-inputOption-activeForeground, var(--vscode-input-foreground));
        border-radius: 999px;
        padding: 2px 8px;
        font-size: 11px;
      }
      .prompt-context-tag-label {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .prompt-context-tag-remove {
        border: none;
        background: transparent;
        color: inherit;
        cursor: pointer;
        padding: 0;
        width: 14px;
        height: 14px;
        font-size: 12px;
        line-height: 1;
        border-radius: 50%;
      }
      .prompt-context-tag-remove:hover {
        background: var(--vscode-toolbar-hoverBackground);
      }
      
      .input-box textarea {
        background: transparent;
        border: none;
        color: var(--vscode-input-foreground);
        font-family: inherit;
        font-size: 13px;
        line-height: 1.5;
        resize: none;
        outline: none;
        width: 100%;
        height: calc(1.5em * 3);
        max-height: calc(1.5em * 3);
        overflow-y: auto;
        padding: 0;
      }
      
      .input-footer {
        display: flex;
        flex-direction: column;
        align-items: stretch;
        gap: 6px;
        margin-top: 6px;
      }

      .model-modal {
        width: 420px;
      }
      .model-modal-body {
        padding: 0 16px 16px;
        display: flex;
        flex-direction: column;
        gap: 10px;
      }
      .model-name-input {
        width: 100%;
        box-sizing: border-box;
        border: 1px solid var(--vscode-input-border, var(--vscode-widget-border));
        border-radius: 8px;
        background: var(--vscode-input-background, var(--vscode-editor-background));
        color: var(--vscode-input-foreground, var(--vscode-foreground));
        font-family: inherit;
        font-size: 12px;
        line-height: 1.5;
        padding: 8px 10px;
        outline: none;
      }
      .model-name-input:focus {
        border-color: var(--vscode-focusBorder);
      }
      .model-dialog-hint {
        min-height: 18px;
        font-size: 12px;
        color: var(--vscode-descriptionForeground);
      }
      .model-dialog-hint.error {
        color: var(--vscode-inputValidation-errorForeground, var(--vscode-errorForeground));
      }
      .model-modal-actions {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
      }
      
      .input-actions {
        display: flex;
        align-items: center;
        gap: 4px;
        width: 100%;
        justify-content: flex-end;
      }
      .input-model-row {
        display: flex;
        align-items: center;
        gap: 6px;
        width: 100%;
        justify-content: flex-end;
        flex-wrap: wrap;
      }
      .input-model-row .model-select {
        flex: 0 1 118px;
        min-width: 92px;
        max-width: 180px;
      }
      .input-model-row .thinking-select {
        flex: 0 0 70px;
        width: 70px;
        min-width: 70px;
      }
      .input-model-row .lobster-model-group {
        flex: 0 1 auto;
        min-width: 0;
      }
      .input-model-row .lobster-model-group .model-select {
        min-width: 92px;
      }
      .input-model-row .lobster-model-group .lobster-execution-mode-select {
        min-width: 122px;
      }
      .debug-toggle {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        font-size: 12px;
        color: var(--vscode-foreground);
        cursor: pointer;
        user-select: none;
        height: 26px;
      }
      .debug-toggle input {
        margin: 0;
      }

      .fixed-width-button {
        width: 60px;
        flex: 0 0 auto;
      }

      .icon-action-button {
        width: 32px;
        padding: 0;
        flex: 0 0 auto;
        height: 32px;
      }
      .icon-action-button .icon {
        width: 22px;
        height: 22px;
      }

      /* Buttons */
      button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        font-family: inherit;
        font-size: 12px;
        border-radius: 4px;
        border: 1px solid transparent;
        transition: all 0.2s;
        height: 26px;
      }
      button:disabled {
        cursor: not-allowed;
        opacity: 0.6;
      }
      button:disabled:hover {
        background: inherit;
      }
      
      .action-button {
        background: var(--vscode-button-background);
        color: var(--vscode-button-foreground);
        padding: 0 12px;
        font-weight: 500;
      }
      .action-button,
      button.secondary:not(.icon-button),
      button.ghost {
        min-height: 26px;
        height: auto;
        line-height: 1.3;
        white-space: normal;
        text-align: center;
        padding-top: 4px;
        padding-bottom: 4px;
      }
      .action-button:hover {
        background: var(--vscode-button-hoverBackground);
      }
      .action-button:disabled {
        color: var(--vscode-disabledForeground);
      }
      
      .secondary {
        background: var(--vscode-button-secondaryBackground);
        color: var(--vscode-button-secondaryForeground);
        border-color: transparent;
        padding: 0 10px;
      }
      .secondary:hover {
        background: var(--vscode-button-secondaryHoverBackground);
      }
      .secondary:disabled {
        color: var(--vscode-disabledForeground);
      }
      
      .stop-button {
        background: var(--vscode-errorForeground);
        color: var(--vscode-button-foreground);
        opacity: 1;
      }
      .stop-button:hover {
        background: var(--vscode-inputValidation-errorBackground, var(--vscode-errorForeground));
      }
      .stop-button:disabled {
        background: var(--vscode-errorForeground);
        color: var(--vscode-button-foreground);
      }
      
      .ghost {
        background: transparent;
        color: var(--vscode-descriptionForeground);
      }
      .ghost:hover {
        color: var(--vscode-foreground);
        background: var(--vscode-toolbar-hoverBackground);
      }

      /* Helper Classes */
      .hidden-input { display: none; }
      
      /* Overlays / Modals */
      .overlay {
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.5);
        backdrop-filter: blur(2px);
        display: none;
        align-items: center;
        justify-content: center;
        z-index: 100;
      }
      .overlay.visible { display: flex; animation: fadeIn 0.2s; }
      
      .modal {
        background: var(--vscode-editorWidget-background);
        border: 1px solid var(--vscode-widget-border);
        box-shadow: 0 8px 32px rgba(0,0,0,0.4);
        border-radius: 12px;
        width: 500px;
        max-width: 90vw;
        max-height: 85vh;
        display: flex;
        flex-direction: column;
        overflow: hidden;
      }

      .run-conflict-modal {
        width: 420px;
      }
      .run-conflict-body {
        padding: 0 16px 12px;
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .run-conflict-desc {
        font-size: 12px;
        color: var(--vscode-descriptionForeground);
      }
      .run-conflict-preview {
        background: var(--vscode-editor-background);
        border: 1px solid var(--vscode-widget-border);
        border-radius: 8px;
        padding: 8px;
        font-size: 12px;
        color: var(--vscode-foreground);
        max-height: 120px;
        overflow: auto;
        white-space: pre-wrap;
        word-break: break-word;
      }
      .run-conflict-actions {
        padding: 0 16px 16px;
        display: flex;
        justify-content: flex-end;
        gap: 8px;
        flex-wrap: wrap;
      }

      .add-model-modal {
        width: 400px;
      }
      .add-model-body {
        padding: 0 16px 12px;
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      .add-model-row {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      .add-model-row label {
        font-size: 13px;
        color: var(--vscode-foreground);
      }
      .model-input {
        width: 100%;
        padding: 6px 8px;
        border: 1px solid var(--vscode-input-border);
        border-radius: 4px;
        background: var(--vscode-input-background);
        color: var(--vscode-input-foreground);
        font-size: 13px;
        font-family: inherit;
      }
      .model-input:focus {
        outline: none;
        border-color: var(--vscode-focusBorder);
      }
      .add-model-error {
        color: var(--vscode-errorForeground);
        font-size: 12px;
        padding: 4px 0;
      }
      .add-model-actions {
        padding: 0 16px 16px;
        display: flex;
        justify-content: flex-end;
        gap: 8px;
        flex-wrap: wrap;
      }
      .model-manager-list {
        display: flex;
        flex-direction: column;
        gap: 8px;
        max-height: 220px;
        overflow: auto;
      }
      .model-manager-empty {
        padding: 10px 12px;
        border: 1px dashed var(--vscode-widget-border);
        border-radius: 8px;
        color: var(--vscode-descriptionForeground);
        font-size: 12px;
      }
      .model-manager-item {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 8px;
        padding: 8px 10px;
        border: 1px solid var(--vscode-widget-border);
        border-radius: 8px;
        background: var(--vscode-editor-background);
      }
      .model-manager-meta {
        min-width: 0;
        flex: 1 1 auto;
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      .model-manager-name {
        min-width: 0;
        color: var(--vscode-foreground);
        font-size: 12px;
        word-break: break-all;
      }
      .model-manager-role-row {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
      }
      .model-manager-role-toggle {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        font-size: 11px;
        color: var(--vscode-descriptionForeground);
        user-select: none;
      }
      .model-manager-role-toggle input {
        margin: 0;
      }
      .model-manager-actions {
        display: inline-flex;
        align-items: center;
        justify-content: flex-end;
        gap: 6px;
        flex: 0 0 auto;
        flex-wrap: wrap;
        max-width: 180px;
      }
      .model-manager-button {
        height: 24px;
        padding: 0 8px;
        font-size: 12px;
      }
      .model-edit-hint {
        color: var(--vscode-descriptionForeground);
        font-size: 12px;
      }
      .lobster-model-group {
        display: inline-flex;
        align-items: center;
        gap: 4px;
      }

      .run-queue-indicator {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        border: 1px solid var(--vscode-widget-border);
        border-radius: 999px;
        padding: 2px 8px;
        background: var(--vscode-editorWidget-background);
        color: var(--vscode-foreground);
        font-size: 12px;
        cursor: pointer;
      }
      .run-queue-indicator:hover {
        background: var(--vscode-toolbar-hoverBackground);
      }
      .run-queue-count {
        color: var(--vscode-descriptionForeground);
      }
      .queue-modal {
        width: 520px;
      }
      .queue-body {
        padding: 12px 16px 16px;
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .queue-footer {
        padding: 0 16px 16px;
        display: flex;
        justify-content: flex-end;
        gap: 8px;
      }
      .queue-empty {
        font-size: 12px;
        color: var(--vscode-descriptionForeground);
      }
      .queue-item {
        border: 1px solid var(--vscode-widget-border);
        border-radius: 8px;
        padding: 10px;
        background: var(--vscode-editor-background);
        display: flex;
        flex-direction: column;
        gap: 10px;
      }
      .queue-text {
        font-size: 12px;
        white-space: pre-wrap;
        word-break: break-word;
        min-width: 0;
      }
      .queue-edit-input {
        width: 100%;
        min-height: 88px;
        max-height: 220px;
        resize: vertical;
        box-sizing: border-box;
        border: 1px solid var(--vscode-input-border, var(--vscode-widget-border));
        border-radius: 8px;
        background: var(--vscode-input-background, var(--vscode-editor-background));
        color: var(--vscode-input-foreground, var(--vscode-foreground));
        font-family: inherit;
        font-size: 12px;
        line-height: 1.5;
        padding: 8px;
      }
      .queue-edit-input:focus {
        outline: none;
        border-color: var(--vscode-focusBorder);
        box-shadow: 0 0 0 1px var(--vscode-focusBorder);
      }
      .queue-actions {
        display: flex;
        align-items: center;
        justify-content: flex-end;
        gap: 8px;
        flex-wrap: wrap;
      }
      .queue-edit-button {
        padding: 0 10px;
      }
      .queue-order-button {
        width: 26px;
        height: 26px;
        padding: 0;
        border-radius: 6px;
      }
      .queue-remove-button {
        width: 26px;
        height: 26px;
        padding: 0;
        border-radius: 6px;
      }
      .queue-remove-button .icon {
        width: 14px;
        height: 14px;
      }
      .run-prompt-modal {
        width: 560px;
      }
      .run-prompt-body {
        padding: 12px 16px 16px;
      }
      .run-prompt-preview {
        background: var(--vscode-editor-background);
        border: 1px solid var(--vscode-widget-border);
        border-radius: 8px;
        padding: 10px;
        font-size: 12px;
        color: var(--vscode-foreground);
        max-height: 260px;
        overflow: auto;
        white-space: pre-wrap;
        word-break: break-word;
      }
      .run-stream-modal {
        width: 760px;
      }
      .run-stream-body {
        padding: 12px 16px 16px;
        display: flex;
        flex-direction: column;
        gap: 10px;
      }
      .run-stream-toolbar {
        display: flex;
        justify-content: flex-end;
      }
      .run-stream-preview {
        background: var(--vscode-editor-background);
        border: 1px solid var(--vscode-widget-border);
        border-radius: 8px;
        padding: 8px;
        font-size: 12px;
        color: var(--vscode-foreground);
        height: min(56vh, 520px);
        overflow: auto;
        font-family: var(--vscode-editor-font-family, var(--vscode-font-family));
      }
      .run-stream-preview.run-stream-empty {
        color: var(--vscode-descriptionForeground);
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .run-stream-list {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      .run-stream-item {
        border: 1px solid var(--vscode-widget-border);
        border-radius: 6px;
        background: var(--vscode-editorWidget-background);
      }
      .run-stream-item summary {
        list-style: none;
      }
      .run-stream-item summary::-webkit-details-marker {
        display: none;
      }
      .run-stream-item-summary {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 6px 8px;
        cursor: pointer;
      }
      .run-stream-item-summary:hover {
        background: var(--vscode-list-hoverBackground);
      }
      .run-stream-item-index {
        color: var(--vscode-descriptionForeground);
        white-space: nowrap;
      }
      .run-stream-item-source {
        border: 1px solid var(--vscode-widget-border);
        border-radius: 999px;
        padding: 0 6px;
        color: var(--vscode-descriptionForeground);
        white-space: nowrap;
      }
      .run-stream-item-time {
        color: var(--vscode-descriptionForeground);
        white-space: nowrap;
      }
      .run-stream-item-preview {
        flex: 1;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .run-stream-item-content {
        margin: 0;
        padding: 0 8px 8px;
        white-space: pre-wrap;
        word-break: break-word;
        color: var(--vscode-foreground);
        border-top: 1px solid var(--vscode-widget-border);
      }
      .run-stream-bottom-gap {
        height: 72px;
      }
      .config-error-modal {
        width: 720px;
      }
      .config-error-body {
        padding: 12px 16px 16px;
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      .config-error-detail {
        margin: 0;
        padding: 12px;
        background: var(--vscode-editor-background);
        border: 1px solid var(--vscode-widget-border);
        border-radius: 8px;
        color: var(--vscode-foreground);
        font-size: 12px;
        line-height: 1.5;
        white-space: pre-wrap;
        word-break: break-word;
        max-height: 360px;
        overflow: auto;
      }
      .config-error-actions {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
        flex-wrap: wrap;
      }
      
      .modal-header {
        padding: 16px;
        border-bottom: 1px solid var(--vscode-widget-border);
        display: flex;
        justify-content: space-between;
        align-items: center;
      }

      .rules-modal .modal-header {
        padding: 10px 16px;
      }

      .help-modal {
        height: 600px;
      }
      
      .session-list, .help-panel, .rules-modal {
        padding: 16px;
        overflow-y: auto;
      }

      .history-tabs {
        display: flex;
        gap: 12px;
        padding: 0 16px;
        border-bottom: 1px solid var(--vscode-widget-border);
      }
      .history-panel {
        display: none;
        flex: 1;
        min-height: 0;
      }
      .history-panel.active {
        display: flex;
        flex-direction: column;
      }
      .history-panel.prompts {
        padding: 16px;
        overflow-y: auto;
      }
      .history-panel.sessions {
        overflow: hidden;
      }
      .history-panel.lobster {
        overflow: hidden;
      }
      .history-modal {
        width: 620px;
      }
      .history-messages-modal {
        width: 760px;
        height: min(85vh, 720px);
      }
      .history-messages-title {
        min-width: 0;
      }
      .history-messages-subtitle {
        margin-top: 4px;
        color: var(--vscode-descriptionForeground);
        font-size: 12px;
        font-weight: 400;
        overflow-wrap: anywhere;
      }
      .history-messages-body {
        padding: 12px 16px 16px;
        display: flex;
        flex-direction: column;
        gap: 10px;
        flex: 1 1 auto;
        min-height: 0;
        overflow: hidden;
      }
      .history-messages-toolbar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        flex-wrap: wrap;
      }
      .history-messages-status {
        color: var(--vscode-descriptionForeground);
        font-size: 12px;
        overflow-wrap: anywhere;
      }
      .history-messages-content {
        background: var(--vscode-editor-background);
        border: 1px solid var(--vscode-widget-border);
        border-radius: 8px;
        color: var(--vscode-foreground);
        flex: 1 1 auto;
        min-height: 0;
        overflow: auto;
        padding: 8px;
      }
      .history-messages-content.history-messages-empty {
        color: var(--vscode-descriptionForeground);
        display: flex;
        align-items: center;
        justify-content: center;
        text-align: center;
      }
      .history-message-list {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .history-message-item {
        border: 1px solid var(--vscode-widget-border);
        border-radius: 8px;
        background: var(--vscode-editorWidget-background);
        overflow: hidden;
        min-width: 0;
      }
      .history-message-header {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 6px 8px;
        border-bottom: 1px solid var(--vscode-widget-border);
        flex-wrap: wrap;
      }
      .history-message-role {
        font-weight: 600;
      }
      .history-message-kind,
      .history-message-time {
        color: var(--vscode-descriptionForeground);
        font-size: 12px;
      }
      .history-message-content {
        margin: 0;
        padding: 8px;
        max-width: 100%;
        max-height: 50vh;
        overflow: auto;
        white-space: pre-wrap;
        word-break: break-word;
        font-family: var(--vscode-editor-font-family, var(--vscode-font-family));
        font-size: 12px;
        line-height: 1.5;
      }

      .rules-modal {
        padding: 0 0 16px;
        gap: 12px;
      }
      .rules-modal > :not(.modal-header) {
        margin: 0 16px;
      }
      .rules-scope {
        display: flex;
        gap: 12px;
      }
      .rules-row {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .rules-row .cli-select {
        flex: 1;
      }
      .rules-path {
        font-size: 12px;
        opacity: 0.7;
      }

      .help-panel {
        display: none;
        flex: 1;
        min-height: 0;
      }
      .help-panel.active {
        display: block;
      }
      
      .session-item {
        padding: 10px;
        border: 1px solid var(--vscode-widget-border);
        border-radius: 8px;
        margin-bottom: 8px;
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 8px;
        background: var(--vscode-editor-background);
      }
      .session-info {
        display: flex;
        flex-direction: column;
        gap: 4px;
        flex: 1;
        min-width: 0;
      }
      .session-label {
        font-weight: 600;
        flex: 1;
        min-width: 0;
        display: -webkit-box;
        -webkit-line-clamp: 3;
        -webkit-box-orient: vertical;
        overflow: hidden;
        white-space: normal;
        overflow-wrap: anywhere;
        line-height: 1.35;
      }
      .session-title-row {
        display: flex;
        align-items: flex-start;
        gap: 8px;
        min-width: 0;
      }
      .session-status-badge {
        flex: 0 0 auto;
        padding: 2px 8px;
        border-radius: 999px;
        border: 1px solid var(--vscode-widget-border);
        background: var(--vscode-badge-background, var(--vscode-editorWidget-background));
        color: var(--vscode-badge-foreground, var(--vscode-foreground));
        font-size: 11px;
        line-height: 1.2;
      }
      .session-subtitle {
        font-size: 12px;
        color: var(--vscode-descriptionForeground);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .session-item:hover {
        border-color: var(--vscode-focusBorder);
      }
      .session-actions {
        display: flex;
        gap: 6px;
        flex-shrink: 0;
        flex-wrap: wrap;
        justify-content: flex-end;
        max-width: 180px;
      }

      .prompt-list {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .prompt-item {
        padding: 10px;
        border: 1px solid var(--vscode-widget-border);
        border-radius: 8px;
        background: var(--vscode-editor-background);
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .prompt-item:hover {
        border-color: var(--vscode-focusBorder);
      }
      .prompt-header {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 8px;
      }
      .prompt-info {
        display: flex;
        flex-direction: column;
        gap: 4px;
        flex: 1;
        min-width: 0;
      }
      .prompt-preview {
        font-weight: 600;
        display: -webkit-box;
        -webkit-line-clamp: 3;
        -webkit-box-orient: vertical;
        overflow: hidden;
        white-space: normal;
        overflow-wrap: anywhere;
        line-height: 1.35;
        cursor: pointer;
      }
      .prompt-meta {
        font-size: 12px;
        color: var(--vscode-descriptionForeground);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .prompt-actions {
        display: flex;
        gap: 6px;
        flex-shrink: 0;
        flex-wrap: wrap;
        justify-content: flex-end;
        max-width: 180px;
      }
      .prompt-full {
        display: none;
        white-space: pre-wrap;
        border-top: 1px dashed var(--vscode-widget-border);
        padding-top: 8px;
        color: var(--vscode-editor-foreground);
      }
      .prompt-item.expanded .prompt-full {
        display: block;
      }
      
      /* Toast */
      .toast {
        position: fixed;
        bottom: 24px;
        right: 24px;
        background: var(--vscode-notifications-background);
        color: var(--vscode-notifications-foreground);
        padding: 10px 16px;
        border-radius: 6px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.2);
        z-index: 200;
        opacity: 0;
        transform: translateY(10px);
        transition: all 0.3s;
        pointer-events: none;
      }
      .toast.visible {
        opacity: 1;
        transform: translateY(0);
      }
      
      /* Misc for Rules/Help */
      .rules-textarea {
        background: var(--vscode-input-background);
        color: var(--vscode-input-foreground);
        border: 1px solid var(--vscode-input-border);
        padding: 10px;
        border-radius: 6px;
        box-sizing: border-box;
        line-height: 1.5;
        height: calc(1.5em * 10);
        max-height: calc(1.5em * 10);
        overflow-y: auto;
        resize: none;
      }
      .rules-save-row {
        align-items: flex-start;
        gap: 12px;
      }
      .rules-checkboxes {
        display: flex;
        gap: 12px;
        flex-wrap: wrap;
      }
      .rules-actions {
        display: flex;
        justify-content: flex-end;
      }
      .help-tab {
        background: transparent;
        border: none;
        border-bottom: 2px solid transparent;
        color: var(--vscode-foreground);
      }
      .help-tab.active {
        border-bottom: 2px solid var(--vscode-focusBorder);
        border-radius: 0;
        background: transparent;
        color: var(--vscode-foreground);
      }
      .help-tabs {
        padding: 0 16px;
      }

      .tool-settings-modal {
        width: 420px;
      }
      .tool-settings-body {
        padding: 16px;
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      .tool-settings-tabs {
        display: flex;
        gap: 4px;
        padding: 0 16px;
        border-bottom: 1px solid var(--vscode-panel-border);
      }
      .tool-settings-tab {
        background: transparent;
        border: none;
        border-bottom: 2px solid transparent;
        border-radius: 0;
        color: var(--vscode-foreground);
        padding: 8px 10px;
      }
      .tool-settings-tab.active {
        border-bottom-color: var(--vscode-focusBorder);
        color: var(--vscode-foreground);
      }
      .tool-settings-panel {
        display: none;
        flex-direction: column;
        gap: 12px;
      }
      .tool-settings-panel.active {
        display: flex;
      }
      .tool-settings-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
      }
      .tool-settings-label {
        font-size: 12px;
        color: var(--vscode-foreground);
      }
      .tool-settings-note {
        margin-top: -6px;
        font-size: 11px;
        line-height: 1.4;
        color: var(--vscode-descriptionForeground);
      }
      .tool-settings-number {
        width: 92px;
        padding: 4px 6px;
        border: 1px solid var(--vscode-input-border);
        border-radius: 4px;
        background: var(--vscode-input-background);
        color: var(--vscode-input-foreground);
        font: inherit;
        font-size: 12px;
      }
      .tool-settings-number:focus {
        outline: none;
        border-color: var(--vscode-focusBorder);
      }

      .common-commands-modal {
        width: 360px;
      }
      .common-commands-body {
        padding: 16px;
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      .common-command-list {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .common-command-button {
        width: 100%;
        justify-content: space-between;
      }
      .common-command-desc {
        font-size: 11px;
        opacity: 0.7;
      }

      /* Tasklist Panel */
      .tasklist-panel {
        padding: 8px 16px 12px;
        border-top: 1px solid var(--vscode-widget-border);
        background: var(--vscode-editor-background);
      }
      .tasklist-panel details {
        border: 1px solid var(--vscode-widget-border);
        border-radius: var(--radius-md);
        padding: 8px 12px;
        background: var(--vscode-editorWidget-background);
      }
      .tasklist-panel summary {
        cursor: pointer;
        font-weight: 600;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        list-style: none;
      }
      .tasklist-panel summary::-webkit-details-marker {
        display: none;
      }
      .tasklist-count {
        font-size: 12px;
        opacity: 0.7;
      }
      .tasklist-items {
        list-style: none;
        padding: 8px 0 0;
        margin: 0;
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      .tasklist-item {
        display: flex;
        align-items: flex-start;
        gap: 8px;
        font-size: 13px;
      }
      .tasklist-checkbox {
        margin-top: 6px;
        appearance: none;
        -webkit-appearance: none;
        width: 14px;
        height: 14px;
        border: 1px solid var(--vscode-checkbox-border);
        border-radius: 3px;
        background: var(--vscode-checkbox-background);
        position: relative;
        flex-shrink: 0;
      }
      .tasklist-checkbox:checked {
        background: var(--vscode-gitDecoration-addedResourceForeground);
        border-color: var(--vscode-gitDecoration-addedResourceForeground);
      }
      .tasklist-checkbox:checked::after {
        content: "";
        position: absolute;
        left: 4px;
        top: 1px;
        width: 4px;
        height: 8px;
        border: solid var(--vscode-checkbox-foreground);
        border-width: 0 2px 2px 0;
        transform: rotate(45deg);
      }
    </style>
  </head>
  <body>
    <div class="app">
      <div class="header">
        <div class="title">${i18n.panelTitle}</div>
        <div class="header-actions">
          <label class="chat-filter-toggle" for="resultOnlyToggle" title="${i18n.resultOnlyAria}">
            <input id="resultOnlyToggle" type="checkbox" aria-label="${i18n.resultOnlyAria}" />
            <span>${i18n.resultOnlyLabel}</span>
          </label>
          <button id="helpButton" class="secondary icon-button" title="${i18n.headerHelp}" aria-label="${i18n.headerHelp}">
            <svg class="icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="9" />
              <path d="M9.5 9a2.5 2.5 0 0 1 5 0c0 1.7-2.5 2-2.5 3.8" />
              <path d="M12 16.5h.01" />
            </svg>
          </button>
          <button id="toolSettingsButton" class="secondary icon-button" title="${i18n.headerToolSettings}" aria-label="${i18n.headerToolSettings}">
            <svg class="icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <line x1="4" y1="6" x2="20" y2="6" />
              <line x1="4" y1="12" x2="20" y2="12" />
              <line x1="4" y1="18" x2="20" y2="18" />
              <circle cx="9" cy="6" r="2" />
              <circle cx="15" cy="12" r="2" />
              <circle cx="11" cy="18" r="2" />
            </svg>
          </button>
          <button id="rulesButton" class="secondary icon-button" title="${i18n.headerRules}" aria-label="${i18n.headerRules}">
            <svg class="icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7z" />
              <path d="M14 3v4h4" />
              <path d="M8 11h8" />
              <path d="M8 15h8" />
            </svg>
          </button>
          <button id="newSession" class="secondary icon-button" title="${i18n.headerNewSession}" aria-label="${i18n.headerNewSession}">＋</button>
          <button id="resetSession" class="secondary icon-button" title="${i18n.headerResetSession}" aria-label="${i18n.headerResetSession}">
            <svg class="icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <path d="M20 12a8 8 0 1 1-2.34-5.66" />
              <polyline points="20 4 20 10 14 10" />
            </svg>
          </button>
        </div>
      </div>

      <div id="conversationTabs" class="conversation-tabs" role="tablist" aria-label="${i18n.conversationTabsAria}"></div>


      <div id="chatArea" class="chat-area">
        <div id="emptyState" class="empty-state">${i18n.emptyState}</div>
        <div id="messages" class="messages"></div>
      <div id="runWait" class="run-wait" style="display: none;">
        <span class="typing">
          <span class="typing-dot"></span>
          <span class="typing-dot"></span>
          <span class="typing-dot"></span>
        </span>
        <span id="runStatusText" class="run-status-text" style="display: none;"></span>
        <button id="runStreamButton" class="run-stream-button" style="display: none;" aria-label="${i18n.runStreamViewAria}" title="${i18n.runStreamViewAria}">
          ${i18n.runStreamViewLabel}
        </button>
        <span id="runStreamStaleBadge" class="run-stream-stale-badge" style="display: none;"></span>
        <span id="runWaitTime" class="run-wait-time">00:00</span>
        <button id="runPromptButton" class="run-prompt-button" style="display: none;" aria-label="${i18n.runPromptViewAria}" title="${i18n.runPromptViewAria}">
          ${i18n.runPromptViewLabel}
        </button>
        <button id="queueIndicator" class="run-queue-indicator" style="display: none;" aria-label="${i18n.queueIndicatorAria}">
          ${i18n.queueIndicatorLabel}
          <span id="queueCount" class="run-queue-count">0</span>
        </button>
      </div>
        <div id="scrollToBottomWrap" class="scroll-to-bottom-wrap" aria-hidden="true">
          <button id="scrollToBottomButton" class="scroll-to-bottom-button" aria-label="${i18n.scrollToBottomAria}" title="${i18n.scrollToBottomAria}" aria-hidden="true">
            <svg class="icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <line x1="12" y1="6" x2="12" y2="18" />
              <polyline points="7 13 12 18 17 13" />
            </svg>
          </button>
        </div>
      </div>

      <div id="taskListPanel" class="tasklist-panel" style="display: none;">
        <details id="taskListDetails">
          <summary>
            <span>${i18n.taskListTitle}</span>
            <span id="taskListCount" class="tasklist-count"></span>
          </summary>
          <div id="taskListBody"></div>
        </details>
      </div>

      <div class="input-area">
        <div class="config-select-row">
          <button id="openConfig" class="secondary icon-button" title="${i18n.openConfigButton}" aria-label="${i18n.openConfigButton}">
            <svg class="icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="3.5" />
              <path d="M19.4 15a1.8 1.8 0 0 0 .36 2l.03.03a2 2 0 0 1-2.83 2.83l-.03-.03a1.8 1.8 0 0 0-2-.36 1.8 1.8 0 0 0-1 1.63V21a2 2 0 0 1-4 0v-.05a1.8 1.8 0 0 0-1-1.63 1.8 1.8 0 0 0-2 .36l-.03.03a2 2 0 1 1-2.83-2.83l.03-.03a1.8 1.8 0 0 0 .36-2 1.8 1.8 0 0 0-1.63-1H3a2 2 0 0 1 0-4h.05a1.8 1.8 0 0 0 1.63-1 1.8 1.8 0 0 0-.36-2l-.03-.03A2 2 0 1 1 7.12 3.9l.03.03a1.8 1.8 0 0 0 2 .36 1.8 1.8 0 0 0 1-1.63V2a2 2 0 0 1 4 0v.05a1.8 1.8 0 0 0 1 1.63 1.8 1.8 0 0 0 2-.36l.03-.03a2 2 0 1 1 2.83 2.83l-.03.03a1.8 1.8 0 0 0-.36 2 1.8 1.8 0 0 0 1.63 1H22a2 2 0 0 1 0 4h-.05a1.8 1.8 0 0 0-1.63 1Z" />
            </svg>
          </button>
          <select id="currentCli" class="cli-select" aria-label="${i18n.cliSelectAria}">${cliOptions}</select>
          <select id="configSelect" class="config-select" aria-label="${i18n.configSelectAria}"></select>
          <select id="interactiveModeSelect" class="interactive-mode-select" aria-label="${i18n.interactiveModeSelectAria}">
            <option value="coding">${i18n.interactiveModeCoding}</option>
            <option value="lobster">${i18n.interactiveModeLobster}</option>
          </select>
        </div>
        <div class="input-box">
          <div id="promptContextTags" class="prompt-context-tags" style="display: none;"></div>
          <textarea id="promptInput" rows="3" placeholder="${i18n.promptPlaceholder}"></textarea>
        </div>
        <input id="attachmentInput" class="hidden-input" type="file" multiple />
        <div class="input-footer">
          <div class="input-model-row">
            <div id="lobsterModelGroup" class="lobster-model-group" style="display: none;">
              <select
                id="lobsterExecutionModeSelect"
                class="lobster-execution-mode-select"
                aria-label="${i18n.lobsterExecutionModeSelectAria}"
                title="${i18n.lobsterExecutionModeSelectAria}"
              >
                <option value="${LOBSTER_EXECUTION_MODE_MAIN_SUB_MULTI_AGENT}" selected>${i18n.lobsterExecutionModeOptionMainSubMultiAgent}</option>
                <option value="${LOBSTER_EXECUTION_MODE_DEBATE_MULTI_AGENT}">${i18n.lobsterExecutionModeOptionDebateMultiAgent}</option>
              </select>
              <select id="lobsterMainModelSelect" class="model-select" aria-label="${i18n.modelMainSelectAria}">
                <option value="">${i18n.modelOptionMainDefault}</option>
                <option value="__manage__">${i18n.modelOptionManage}</option>
              </select>
              <select id="lobsterSubtaskModelSelect" class="model-select" aria-label="${i18n.modelSubtaskSelectAria}">
                <option value="">${i18n.modelOptionSubtaskDefault}</option>
                <option value="__manage__">${i18n.modelOptionManage}</option>
              </select>
            </div>
            <select id="modelSelect" class="model-select" aria-label="${i18n.modelSelectAria}">
              <option value="">${i18n.modelOptionDefault}</option>
              <option value="__manage__">${i18n.modelOptionManage}</option>
            </select>
            <select id="thinkingMode" class="thinking-select" aria-label="${i18n.thinkingModeAria}">
              <option value="off">${i18n.thinkingOptionOff}</option>
              <option value="low">${i18n.thinkingOptionLow}</option>
              <option value="medium">${i18n.thinkingOptionMedium}</option>
              <option value="high">${i18n.thinkingOptionHigh}</option>
            </select>
          </div>
          <div class="input-actions">
            <button id="commonCommandButton" class="secondary icon-button" title="${i18n.commonCommandButton}" aria-label="${i18n.commonCommandButton}">
              <span>&gt;_</span>
            </button>
            <button id="pathPickerButton" class="secondary icon-button" title="${i18n.pathPickerButton}" aria-label="${i18n.pathPickerButton}">
              <span>@</span>
            </button>
            <button id="attachmentButton" class="secondary icon-button" title="${i18n.attachmentButton}" aria-label="${i18n.attachmentButton}">
              <svg class="icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 12.5l-7.4 7.4a5 5 0 01-7.1-7.1l9.2-9.2a3 3 0 014.2 4.2l-9.2 9.2a1 1 0 01-1.4-1.4l8.5-8.5" />
              </svg>
            </button>
            <button id="historyButton" class="secondary icon-button" title="${i18n.historyButton}" aria-label="${i18n.historyButton}">
              <svg class="icon" viewBox="2 2 20 20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <path d="M5 6v4h4" />
                <path d="M5.6 14.5a7.4 7.4 0 1 0 .2-5.7" />
                <path d="M12 8.2v4.2l2.8 1.9" />
              </svg>
            </button>
            <button id="sendPrompt" class="icon-button send-icon-button" title="${i18n.sendButton}" aria-label="${i18n.sendButton}">
              <svg class="icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M22 2L11 13" />
                <path d="M22 2L15 22L11 13L2 9L22 2Z" />
              </svg>
            </button>
            <button id="stopRun" class="icon-button stop-button" title="${i18n.stopButton}" aria-label="${i18n.stopButton}" disabled style="display: none;">
              <svg class="icon" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
                <rect x="5" y="5" width="14" height="14" rx="2" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      <div id="historyOverlay" class="overlay">
        <div class="modal history-modal">
          <div class="modal-header">
            <div class="title">${i18n.historyTitle}</div>
            <div class="session-actions">
              <button id="closeHistory" class="secondary icon-button" title="${i18n.historyClose}" aria-label="${i18n.historyClose}">
                <svg class="icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                  <line x1="6" y1="6" x2="18" y2="18" />
                  <line x1="18" y1="6" x2="6" y2="18" />
                </svg>
              </button>
            </div>
          </div>
          <div class="history-tabs help-tabs" role="tablist" aria-label="${i18n.historyTabsLabel}">
            <button id="historyTabPrompts" class="help-tab" role="tab" aria-selected="false">${i18n.historyTabPrompts}</button>
            <button id="historyTabSessions" class="help-tab active" role="tab" aria-selected="true">${i18n.historyTabSessions}</button>
            <button id="historyTabLobsterGroupChats" class="help-tab" role="tab" aria-selected="false">${i18n.historyTabLobsterGroupChats}</button>
          </div>
          <div id="historyPanelPrompts" class="history-panel prompts" role="tabpanel">
            <div id="promptHistoryList" class="prompt-list"></div>
          </div>
          <div id="historyPanelSessions" class="history-panel sessions active" role="tabpanel">
            <div id="sessionList" class="session-list"></div>
          </div>
          <div id="historyPanelLobsterGroupChats" class="history-panel lobster" role="tabpanel">
            <div id="lobsterGroupChatHistoryList" class="session-list"></div>
          </div>
        </div>
      </div>
      <div id="historyMessagesOverlay" class="overlay">
        <div class="modal history-messages-modal">
          <div class="modal-header">
            <div class="history-messages-title">
              <div class="title" id="historyMessagesTitle">${i18n.historySessionMessagesTitle}</div>
              <div id="historyMessagesSubtitle" class="history-messages-subtitle"></div>
            </div>
            <button id="closeHistoryMessages" class="secondary icon-button" title="${i18n.historySessionMessagesClose}" aria-label="${i18n.historySessionMessagesClose}">
              <svg class="icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <line x1="6" y1="6" x2="18" y2="18" />
                <line x1="18" y1="6" x2="6" y2="18" />
              </svg>
            </button>
          </div>
          <div class="history-messages-body">
            <div class="history-messages-toolbar">
              <div id="historyMessagesStatus" class="history-messages-status"></div>
              <button id="exportHistoryMessages" class="secondary action-button">${i18n.historySessionExportLabel}</button>
            </div>
            <div id="historyMessagesContent" class="history-messages-content history-messages-empty">${i18n.historySessionMessagesEmpty}</div>
          </div>
        </div>
      </div>
      <div id="toast" class="toast" role="status" aria-live="polite"></div>

      <div id="rulesOverlay" class="overlay">
        <div class="modal rules-modal">
          <div class="modal-header">
            <div class="title">${i18n.rulesTitle}</div>
            <div class="session-actions">
              <button id="closeRules" class="secondary icon-button" title="${i18n.rulesClose}" aria-label="${i18n.rulesClose}">
                <svg class="icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                  <line x1="6" y1="6" x2="18" y2="18" />
                  <line x1="18" y1="6" x2="6" y2="18" />
                </svg>
              </button>
            </div>
          </div>
          <div class="rules-scope help-tabs" role="tablist" aria-label="${i18n.rulesScopeLabel}">
            <button id="scopeGlobal" class="help-tab active" role="tab" aria-selected="true">${i18n.rulesScopeGlobal}</button>
            <button id="scopeProject" class="help-tab" role="tab" aria-selected="false">${i18n.rulesScopeProject}</button>
          </div>
          <div class="rules-row">
            <select id="rulesLoadCli" class="cli-select" aria-label="${i18n.rulesLoadCliAria}">
              <option value="codex">codex</option>
              <option value="claude">claude</option>
              <option value="gemini">gemini</option>
            </select>
            <button id="loadRules" class="secondary action-button">${i18n.rulesLoadButton}</button>
          </div>
          <div id="rulesPath" class="rules-path"></div>
          <textarea id="rulesInput" class="rules-textarea" rows="10" placeholder="${i18n.rulesInputPlaceholder}"></textarea>
          <div class="rules-row rules-save-row">
            <span>${i18n.rulesSaveLabel}</span>
            <div class="rules-checkboxes" role="group" aria-label="${i18n.rulesSaveGroupLabel}">
              <label><input type="checkbox" id="rulesSaveCodex" /> codex</label>
              <label><input type="checkbox" id="rulesSaveClaude" /> claude</label>
              <label><input type="checkbox" id="rulesSaveGemini" /> gemini</label>
            </div>
          </div>
          <div class="rules-hint" id="rulesHint"></div>
          <div class="rules-actions">
            <button id="saveRules" class="action-button">${i18n.rulesSaveButton}</button>
          </div>
        </div>
      </div>

      <div id="toolSettingsOverlay" class="overlay">
        <div class="modal tool-settings-modal">
          <div class="modal-header">
            <div class="title">${i18n.toolSettingsTitle}</div>
            <button id="closeToolSettings" class="secondary icon-button" title="${i18n.toolSettingsClose}" aria-label="${i18n.toolSettingsClose}">
              <svg class="icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <line x1="6" y1="6" x2="18" y2="18" />
                <line x1="18" y1="6" x2="6" y2="18" />
              </svg>
            </button>
          </div>
          <div class="tool-settings-tabs" role="tablist" aria-label="${i18n.toolSettingsTitle}">
            <button id="toolSettingsGlobalTab" class="tool-settings-tab active" type="button" role="tab" aria-selected="true" aria-controls="toolSettingsGlobalPanel">${i18n.toolSettingsGlobalTab}</button>
            <button id="toolSettingsWorkspaceTab" class="tool-settings-tab" type="button" role="tab" aria-selected="false" aria-controls="toolSettingsWorkspacePanel">${i18n.toolSettingsWorkspaceTab}</button>
          </div>
          <div class="tool-settings-body">
            <div id="toolSettingsGlobalPanel" class="tool-settings-panel active" role="tabpanel" aria-labelledby="toolSettingsGlobalTab">
              <div class="tool-settings-row">
                <div class="tool-settings-label">${i18n.toolSettingsDebugLabel}</div>
                <label class="debug-toggle" title="${i18n.toolSettingsDebugTitle}">
                  <input type="checkbox" id="debugMode" />
                  <span>${i18n.toolSettingsDebugToggle}</span>
                </label>
              </div>
              <div class="tool-settings-row">
                <div class="tool-settings-label">${i18n.toolSettingsAutoContextLabel}</div>
                <label class="debug-toggle" title="${i18n.toolSettingsAutoContextTitle}">
                  <input type="checkbox" id="autoAddEditorContextTags" />
                  <span>${i18n.toolSettingsAutoContextToggle}</span>
                </label>
              </div>
              <div class="tool-settings-row">
                <div class="tool-settings-label">${i18n.toolSettingsLanguageLabel}</div>
                <select id="languageSelect" class="thinking-select" aria-label="${i18n.toolSettingsLanguageAria}">
                  <option value="auto">${i18n.toolSettingsLanguageAuto}</option>
                  <option value="zh-CN">${i18n.toolSettingsLanguageZh}</option>
                  <option value="en">${i18n.toolSettingsLanguageEn}</option>
                </select>
              </div>
              <div id="macTaskShellRow" class="tool-settings-row" style="display: none;">
                <div class="tool-settings-label">${i18n.toolSettingsMacShellLabel}</div>
                <select id="macTaskShell" class="thinking-select" aria-label="${i18n.toolSettingsMacShellAria}">
                  <option value="zsh">${i18n.toolSettingsMacShellZsh}</option>
                  <option value="bash">${i18n.toolSettingsMacShellBash}</option>
                </select>
              </div>
            </div>
            <div id="toolSettingsWorkspacePanel" class="tool-settings-panel" role="tabpanel" aria-labelledby="toolSettingsWorkspaceTab">
              <div class="tool-settings-row">
                <div class="tool-settings-label">${i18n.toolSettingsLongTermMemoryLabel}</div>
                <label class="debug-toggle" title="${i18n.toolSettingsLongTermMemoryTitle}">
                  <input type="checkbox" id="longTermMemoryEnabled" />
                  <span>${i18n.toolSettingsLongTermMemoryToggle}</span>
                </label>
              </div>
              <div id="longTermMemoryNote" class="tool-settings-note">${i18n.toolSettingsLongTermMemoryHint}</div>
            </div>
          </div>
        </div>
      </div>

      <div id="commonCommandsOverlay" class="overlay">
        <div class="modal common-commands-modal">
          <div class="modal-header">
            <div class="title">${i18n.commonCommandsTitle}</div>
            <button id="closeCommonCommands" class="secondary icon-button" title="${i18n.commonCommandsClose}" aria-label="${i18n.commonCommandsClose}">
              <svg class="icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <line x1="6" y1="6" x2="18" y2="18" />
                <line x1="18" y1="6" x2="6" y2="18" />
              </svg>
            </button>
          </div>
          <div class="common-commands-body">
            <div class="common-command-list">
              <button id="commandCompact" class="action-button common-command-button">
                <span>${i18n.commonCommandCompactTitle}</span>
                <span class="common-command-desc">${i18n.commonCommandCompactDesc}</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      <div id="addModelOverlay" class="overlay">
        <div class="modal add-model-modal">
          <div class="modal-header">
            <div class="title">${i18n.modelAddTitle}</div>
            <button id="closeAddModel" class="secondary icon-button" title="${i18n.rulesClose}" aria-label="${i18n.rulesClose}">
              <svg class="icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <line x1="6" y1="6" x2="18" y2="18" />
                <line x1="18" y1="6" x2="6" y2="18" />
              </svg>
            </button>
          </div>
          <div class="add-model-body">
            <div id="modelManagerList" class="model-manager-list"></div>
            <div class="add-model-row">
              <label for="modelInput">${i18n.modelAddLabel}</label>
              <input id="modelInput" type="text" class="model-input" placeholder="${i18n.modelAddPlaceholder}" />
              <div id="modelEditHint" class="model-edit-hint" style="display: none;"></div>
            </div>
            <div id="modelAddError" class="add-model-error" style="display: none;"></div>
          </div>
          <div class="add-model-actions">
            <button id="cancelAddModel" class="secondary action-button">${i18n.historyClose}</button>
            <button id="clearModelEdit" class="secondary action-button" style="display: none;">${i18n.modelManageCancelEdit}</button>
            <button id="confirmAddModel" class="action-button">${i18n.modelAddButton}</button>
          </div>
        </div>
      </div>

      <div id="runConflictOverlay" class="overlay">
        <div class="modal run-conflict-modal">
          <div class="modal-header">
            <div class="title">${i18n.runConflictTitle}</div>
            <button id="closeRunConflict" class="secondary icon-button" title="${i18n.runConflictClose}" aria-label="${i18n.runConflictClose}">
              <svg class="icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <line x1="6" y1="6" x2="18" y2="18" />
                <line x1="18" y1="6" x2="6" y2="18" />
              </svg>
            </button>
          </div>
          <div class="run-conflict-body">
            <div>${i18n.runConflictBody}</div>
            <div class="run-conflict-desc">${i18n.runConflictDesc}</div>
            <div id="runConflictPrompt" class="run-conflict-preview"></div>
          </div>
          <div class="run-conflict-actions">
            <button id="queuePrompt" class="secondary action-button">${i18n.runConflictQueueButton}</button>
            <button id="pauseAndSend" class="action-button">${i18n.runConflictPauseButton}</button>
          </div>
        </div>
      </div>

      <div id="queueOverlay" class="overlay">
        <div class="modal queue-modal">
          <div class="modal-header">
            <div class="title">${i18n.queueTitle}</div>
            <button id="closeQueue" class="secondary icon-button" title="${i18n.queueCloseLabel}" aria-label="${i18n.queueCloseLabel}">
              <svg class="icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <line x1="6" y1="6" x2="18" y2="18" />
                <line x1="18" y1="6" x2="6" y2="18" />
              </svg>
            </button>
          </div>
          <div id="queueBody" class="queue-body"></div>
          <div class="queue-footer">
            <button id="continueQueue" class="action-button">${i18n.queueContinueLabel}</button>
          </div>
        </div>
      </div>

      <div id="runPromptOverlay" class="overlay">
        <div class="modal run-prompt-modal">
          <div class="modal-header">
            <div class="title">${i18n.runPromptTitle}</div>
            <button id="closeRunPrompt" class="secondary icon-button" title="${i18n.runPromptClose}" aria-label="${i18n.runPromptClose}">
              <svg class="icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <line x1="6" y1="6" x2="18" y2="18" />
                <line x1="18" y1="6" x2="6" y2="18" />
              </svg>
            </button>
          </div>
          <div class="run-prompt-body">
            <div id="runPromptContent" class="run-prompt-preview"></div>
          </div>
        </div>
      </div>

      <div id="runStreamOverlay" class="overlay">
        <div class="modal run-stream-modal">
          <div class="modal-header">
            <div class="title">${i18n.runStreamTitle}</div>
            <button id="closeRunStream" class="secondary icon-button" title="${i18n.runStreamClose}" aria-label="${i18n.runStreamClose}">
              <svg class="icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <line x1="6" y1="6" x2="18" y2="18" />
                <line x1="18" y1="6" x2="6" y2="18" />
              </svg>
            </button>
          </div>
          <div class="run-stream-body">
            <div class="run-stream-toolbar">
              <button id="exportRunStream" class="secondary action-button" title="${i18n.runStreamExportAria}" aria-label="${i18n.runStreamExportAria}">${i18n.runStreamExportLabel}</button>
            </div>
            <div id="runStreamContent" class="run-stream-preview run-stream-empty">${i18n.runStreamEmpty}</div>
          </div>
        </div>
      </div>

      <div id="configApplyErrorOverlay" class="overlay">
        <div class="modal config-error-modal">
          <div class="modal-header">
            <div class="title">${i18n.configApplyErrorTitle}</div>
            <button id="closeConfigApplyError" class="secondary icon-button" title="${i18n.configApplyErrorClose}" aria-label="${i18n.configApplyErrorClose}">
              <svg class="icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <line x1="6" y1="6" x2="18" y2="18" />
                <line x1="18" y1="6" x2="6" y2="18" />
              </svg>
            </button>
          </div>
          <div class="config-error-body">
            <pre id="configApplyErrorContent" class="config-error-detail"></pre>
            <div class="config-error-actions">
              <button id="copyConfigApplyError" class="secondary action-button">${i18n.configApplyErrorCopy}</button>
            </div>
          </div>
        </div>
      </div>

      <div id="helpOverlay" class="overlay">
        <div class="modal help-modal">
          <div class="modal-header">
            <div class="title">${i18n.helpTitle}</div>
            <div class="session-actions">
              <button id="closeHelp" class="secondary icon-button" title="${i18n.helpClose}" aria-label="${i18n.helpClose}">
                <svg class="icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                  <line x1="6" y1="6" x2="18" y2="18" />
                  <line x1="18" y1="6" x2="6" y2="18" />
                </svg>
              </button>
            </div>
          </div>
          <div class="help-tabs" role="tablist" aria-label="${i18n.helpTabsLabel}">
            <button id="helpTabInstall" class="help-tab active" role="tab" aria-selected="true">${i18n.helpTabInstall}</button>
            <button id="helpTabThinking" class="help-tab" role="tab" aria-selected="false">${i18n.helpTabThinking}</button>
          </div>
          <div id="helpPanelInstall" class="help-panel active" role="tabpanel">
            <div class="help-section">
              <h4>${i18n.helpInstallWindows}</h4>
              <ul>
                <li>Codex：<code>npm i -g @openai/codex</code></li>
                <li>Claude：<code>npm install -g @anthropic-ai/claude-code</code></li>
                <li>Gemini：<code>npm install -g @google/gemini-cli</code></li>
              </ul>
            </div>
            <div class="help-section">
              <h4>${i18n.helpInstallMac}</h4>
              <ul>
                <li>Codex：<code>npm i -g @openai/codex</code></li>
                <li>Claude：<code>npm install -g @anthropic-ai/claude-code</code></li>
                <li>Gemini：<code>npm install -g @google/gemini-cli</code></li>
              </ul>
            </div>
            <div class="help-section">
              <h4>${i18n.helpInstallAccel}</h4>
              <ul>
                <li>${i18n.helpInstallAccelOnce}<code>npm --registry https://registry.npmmirror.com -i -g @openai/codex</code></li>
                <li>${i18n.helpInstallAccelSet}<code>npm config set registry https://registry.npmmirror.com</code></li>
                <li>${i18n.helpInstallAccelReset}<code>npm config set registry https://registry.npmjs.org</code></li>
              </ul>
            </div>
            <div class="help-section">
              <h4>${i18n.helpRemoveEnvTitle}</h4>
              <ul>
                <li>${i18n.helpRemoveEnvItem1}</li>
                <li>${i18n.helpRemoveEnvItemMac}</li>
                <li>${i18n.helpRemoveEnvItemWin}</li>
              </ul>
            </div>
          </div>
          <div id="helpPanelThinking" class="help-panel" role="tabpanel">
            <div class="help-section">
              <h4>${i18n.helpThinkingGeneralTitle}</h4>
              <ul>
                <li>${i18n.helpThinkingGeneralItem}</li>
              </ul>
            </div>
            <div class="help-section">
              <h4>${i18n.helpThinkingCodexTitle}</h4>
              <ul>
                <li>${i18n.helpThinkingCodexItem1}</li>
                <li>${i18n.helpThinkingCodexItem2}</li>
              </ul>
            </div>
            <div class="help-section">
              <h4>${i18n.helpThinkingGeminiTitle}</h4>
              <ul>
                <li>${i18n.helpThinkingGeminiItem1}</li>
                <li>${i18n.helpThinkingGeminiItem2}</li>
                <li>${i18n.helpThinkingGeminiItem3}</li>
              </ul>
            </div>
            <div class="help-section">
              <h4>${i18n.helpThinkingClaudeTitle}</h4>
              <ul>
                <li>${i18n.helpThinkingClaudeItem1}</li>
                <li>${i18n.helpThinkingClaudeItem2}</li>
              </ul>
            </div>
          </div>
        </div>
      </div>

    </div>

    <script nonce="${nonce}">
      ${markedScript}
    </script>
    <script nonce="${nonce}">
      const vscode = acquireVsCodeApi();
      const persistedWebviewState = (() => {
        try {
          return vscode.getState() || {};
        } catch {
          return {};
        }
      })();
      const i18n = ${JSON.stringify(i18n)};
      const CLI_NAMES = ${JSON.stringify(CLI_LIST)};
      const traceMarkers = {
        input: ["Input", "输入"],
        output: ["Output", "输出"],
        toolResult: ["Tool result", "工具结果"],
        fileChanges: ["File changes", "文件变更"],
      };
      function formatTemplate(template, params) {
        if (!params) {
          return template;
        }
        return template.replace(/\\{(\\w+)\\}/g, (match, key) => {
          if (Object.prototype.hasOwnProperty.call(params, key)) {
            return String(params[key]);
          }
          return match;
        });
      }
      function t(key, params) {
        const template = i18n[key] || key;
        return formatTemplate(template, params);
      }
      function reportWebviewFailure(message, error, extra) {
        const reason = error && error.message ? String(error.message) : String(error || "");
        const stack = error && error.stack ? String(error.stack) : undefined;
        console.error("[sinitek-webview]", message, {
          reason,
          stack,
          extra: extra || null,
        });
        try {
          vscode.postMessage(Object.assign({
            type: "webviewError",
            message,
            reason,
            stack,
          }, extra || {}));
        } catch {
          // ignore
        }
      }
      function postWebviewError(payload) {
        console.error("[sinitek-webview]", payload && payload.message ? payload.message : "webview-error", payload || null);
        try {
          vscode.postMessage(Object.assign({ type: "webviewError" }, payload));
        } catch {
          // ignore
        }
      }
      function postWebviewDebug(event, payload) {
        try {
          vscode.postMessage({ type: "webviewDebug", event, payload });
        } catch {
          // ignore
        }
      }
      function normalizeReason(reason) {
        if (!reason) {
          return "";
        }
        if (reason instanceof Error) {
          return reason.message || String(reason);
        }
        if (typeof reason === "string") {
          return reason;
        }
        try {
          return JSON.stringify(reason);
        } catch {
          return String(reason);
        }
      }
      window.addEventListener("error", (event) => {
        postWebviewError({
          message: event && event.message ? event.message : "webview-error",
          source: event && event.filename ? event.filename : undefined,
          lineno: event && typeof event.lineno === "number" ? event.lineno : undefined,
          colno: event && typeof event.colno === "number" ? event.colno : undefined,
          stack: event && event.error && event.error.stack ? String(event.error.stack) : undefined,
        });
      });
      window.addEventListener("unhandledrejection", (event) => {
        const reason = event ? normalizeReason(event.reason) : "";
        const stack = event && event.reason && event.reason.stack ? String(event.reason.stack) : undefined;
        postWebviewError({
          message: "webview-unhandledrejection",
          reason,
          stack,
        });
      });

      const state = {
        currentCli: "codex",
        messages: [],
        isRunning: false,
        configState: {
          configs: [],
          activeConfigId: null,
        },
        selectedConfigId: "",
        selectedModel: "",
        selectedModelsByCli: {
          codex: "",
          claude: "",
          gemini: "",
        },
        selectedLobsterMainModelsByCli: {
          codex: "",
          claude: "",
          gemini: "",
        },
        selectedLobsterSubtaskModelsByCli: {
          codex: "",
          claude: "",
          gemini: "",
        },
        modelsByCli: {
          codex: [],
          claude: [],
          gemini: [],
        },
        lobsterMainModelsByCli: {
          codex: [],
          claude: [],
          gemini: [],
        },
        lobsterSubtaskModelsByCli: {
          codex: [],
          claude: [],
          gemini: [],
        },
        managedModelsByCli: {
          codex: [],
          claude: [],
          gemini: [],
        },
        managedModelRolesByCli: {
          codex: {},
          claude: {},
          gemini: {},
        },
        autoAppliedConfig: false,
        sessionState: {
          currentSessionId: null,
          sessions: [],
        },
        conversationTabs: {
          activeTabId: null,
          tabs: [],
        },
        promptHistory: [],
        lobsterGroupChatHistory: [],
        debug: false,
        autoAddEditorContextTags: false,
        longTermMemoryEnabled: true,
        workspaceMemoryEnabled: true,
        longTermMemoryManagedByProjectCh: false,
        autoCompactContextAfterRun: true,
        codexMultiAgentEnabled: false,
        lobsterMaxRounds: ${LOBSTER_MAX_ROUNDS_SETTING_DEFAULT},
        lobsterAutoCloseSubtaskTabs: true,
        lobsterExecutionModeByCli: {
          codex: "${LOBSTER_EXECUTION_MODE_MAIN_SUB_MULTI_AGENT}",
          claude: "${LOBSTER_EXECUTION_MODE_MAIN_SUB_MULTI_AGENT}",
          gemini: "${LOBSTER_EXECUTION_MODE_MAIN_SUB_MULTI_AGENT}",
        },
        locale: "auto",
        isMac: false,
        macTaskShell: "zsh",
        thinkingMode: "medium",
        interactiveMode: "coding",
        interactive: { supported: false, enabled: true },
        rulePaths: { global: {}, project: {} },
        ruleScope: "global",
        historyTab: "sessions",
        promptHistoryExpandedId: null,
        historySessionMessages: {
          cli: "",
          sessionId: "",
          resolvedSessionId: "",
          label: "",
          createdAt: 0,
          messages: [],
          loading: false,
          error: "",
        },
        onlyShowFinalResults: Boolean(persistedWebviewState.onlyShowFinalResults),
        editorContext: {
          filePath: null,
          fileLabel: null,
          hasSelection: false,
          selectionLabel: null,
        },
        promptContext: {
          includeCurrentFile: false,
          includeSelection: false,
          dismissedFileKey: "",
          dismissedSelectionKey: "",
          autoIncludeArmed: true,
        },
      };
      const traceCollapsibleOpenKeys = new Set();
      const DUPLICATE_STATUS_TRACE_WINDOW_MS = 3000;

      const elements = {
        currentCli: document.getElementById("currentCli"),
        openConfig: document.getElementById("openConfig"),
        newSession: document.getElementById("newSession"),
        resetSession: document.getElementById("resetSession"),
        conversationTabs: document.getElementById("conversationTabs"),
        resultOnlyToggle: document.getElementById("resultOnlyToggle"),
        stopRun: document.getElementById("stopRun"),
        chatArea: document.getElementById("chatArea"),
        messages: document.getElementById("messages"),
        emptyState: document.getElementById("emptyState"),
        runWait: document.getElementById("runWait"),
        runStatusText: document.getElementById("runStatusText"),
        runStreamButton: document.getElementById("runStreamButton"),
        runStreamStaleBadge: document.getElementById("runStreamStaleBadge"),
        runWaitTime: document.getElementById("runWaitTime"),
        runPromptButton: document.getElementById("runPromptButton"),
        queueIndicator: document.getElementById("queueIndicator"),
        queueCount: document.getElementById("queueCount"),
        scrollToBottomWrap: document.getElementById("scrollToBottomWrap"),
        scrollToBottomButton: document.getElementById("scrollToBottomButton"),
        configSelect: document.getElementById("configSelect"),
        interactiveModeSelect: document.getElementById("interactiveModeSelect"),
        promptInput: document.getElementById("promptInput"),
        promptContextTags: document.getElementById("promptContextTags"),
        thinkingMode: document.getElementById("thinkingMode"),
        lobsterModelGroup: document.getElementById("lobsterModelGroup"),
        lobsterExecutionModeSelect: document.getElementById("lobsterExecutionModeSelect"),
        modelSelect: document.getElementById("modelSelect"),
        lobsterMainModelSelect: document.getElementById("lobsterMainModelSelect"),
        lobsterSubtaskModelSelect: document.getElementById("lobsterSubtaskModelSelect"),
        debugMode: document.getElementById("debugMode"),
        autoAddEditorContextTags: document.getElementById("autoAddEditorContextTags"),
        longTermMemoryEnabled: document.getElementById("longTermMemoryEnabled"),
        longTermMemoryNote: document.getElementById("longTermMemoryNote"),
        toolSettingsGlobalTab: document.getElementById("toolSettingsGlobalTab"),
        toolSettingsWorkspaceTab: document.getElementById("toolSettingsWorkspaceTab"),
        toolSettingsGlobalPanel: document.getElementById("toolSettingsGlobalPanel"),
        toolSettingsWorkspacePanel: document.getElementById("toolSettingsWorkspacePanel"),
        autoCompactContextAfterRun: document.getElementById("autoCompactContextAfterRun"),
        codexMultiAgentEnabled: document.getElementById("codexMultiAgentEnabled"),
        lobsterMaxRounds: document.getElementById("lobsterMaxRounds"),
        lobsterAutoCloseSubtaskTabs: document.getElementById("lobsterAutoCloseSubtaskTabs"),
        languageSelect: document.getElementById("languageSelect"),
        macTaskShellRow: document.getElementById("macTaskShellRow"),
        macTaskShell: document.getElementById("macTaskShell"),
        commonCommandButton: document.getElementById("commonCommandButton"),
        pathPickerButton: document.getElementById("pathPickerButton"),
        attachmentButton: document.getElementById("attachmentButton"),
        attachmentInput: document.getElementById("attachmentInput"),
        sendPrompt: document.getElementById("sendPrompt"),
        historyButton: document.getElementById("historyButton"),
        historyOverlay: document.getElementById("historyOverlay"),
        closeHistory: document.getElementById("closeHistory"),
        clearAllHistory: document.getElementById("clearAllHistory"),
        historyTabPrompts: document.getElementById("historyTabPrompts"),
        historyTabSessions: document.getElementById("historyTabSessions"),
        historyTabLobsterGroupChats: document.getElementById("historyTabLobsterGroupChats"),
        historyPanelPrompts: document.getElementById("historyPanelPrompts"),
        historyPanelSessions: document.getElementById("historyPanelSessions"),
        historyPanelLobsterGroupChats: document.getElementById("historyPanelLobsterGroupChats"),
        promptHistoryList: document.getElementById("promptHistoryList"),
        sessionList: document.getElementById("sessionList"),
        lobsterGroupChatHistoryList: document.getElementById("lobsterGroupChatHistoryList"),
        historyMessagesOverlay: document.getElementById("historyMessagesOverlay"),
        closeHistoryMessages: document.getElementById("closeHistoryMessages"),
        historyMessagesTitle: document.getElementById("historyMessagesTitle"),
        historyMessagesSubtitle: document.getElementById("historyMessagesSubtitle"),
        historyMessagesStatus: document.getElementById("historyMessagesStatus"),
        exportHistoryMessages: document.getElementById("exportHistoryMessages"),
        historyMessagesContent: document.getElementById("historyMessagesContent"),
        rulesButton: document.getElementById("rulesButton"),
        rulesOverlay: document.getElementById("rulesOverlay"),
        closeRules: document.getElementById("closeRules"),
        rulesLoadCli: document.getElementById("rulesLoadCli"),
        loadRules: document.getElementById("loadRules"),
        rulesInput: document.getElementById("rulesInput"),
        rulesSaveCodex: document.getElementById("rulesSaveCodex"),
        rulesSaveClaude: document.getElementById("rulesSaveClaude"),
        rulesSaveGemini: document.getElementById("rulesSaveGemini"),
        saveRules: document.getElementById("saveRules"),
        rulesHint: document.getElementById("rulesHint"),
        rulesPath: document.getElementById("rulesPath"),
        scopeGlobal: document.getElementById("scopeGlobal"),
        scopeProject: document.getElementById("scopeProject"),
        helpButton: document.getElementById("helpButton"),
        helpOverlay: document.getElementById("helpOverlay"),
        closeHelp: document.getElementById("closeHelp"),
        toolSettingsButton: document.getElementById("toolSettingsButton"),
        toolSettingsOverlay: document.getElementById("toolSettingsOverlay"),
        closeToolSettings: document.getElementById("closeToolSettings"),
        commonCommandsOverlay: document.getElementById("commonCommandsOverlay"),
        closeCommonCommands: document.getElementById("closeCommonCommands"),
        commandCompact: document.getElementById("commandCompact"),
        runConflictOverlay: document.getElementById("runConflictOverlay"),
        closeRunConflict: document.getElementById("closeRunConflict"),
        queuePrompt: document.getElementById("queuePrompt"),
        pauseAndSend: document.getElementById("pauseAndSend"),
        runConflictPrompt: document.getElementById("runConflictPrompt"),
        queueOverlay: document.getElementById("queueOverlay"),
        closeQueue: document.getElementById("closeQueue"),
        queueBody: document.getElementById("queueBody"),
        continueQueue: document.getElementById("continueQueue"),
        runPromptOverlay: document.getElementById("runPromptOverlay"),
        closeRunPrompt: document.getElementById("closeRunPrompt"),
        runPromptContent: document.getElementById("runPromptContent"),
        runStreamOverlay: document.getElementById("runStreamOverlay"),
        closeRunStream: document.getElementById("closeRunStream"),
        exportRunStream: document.getElementById("exportRunStream"),
        runStreamContent: document.getElementById("runStreamContent"),
        configApplyErrorOverlay: document.getElementById("configApplyErrorOverlay"),
        closeConfigApplyError: document.getElementById("closeConfigApplyError"),
        copyConfigApplyError: document.getElementById("copyConfigApplyError"),
        configApplyErrorContent: document.getElementById("configApplyErrorContent"),
        helpTabInstall: document.getElementById("helpTabInstall"),
        helpTabThinking: document.getElementById("helpTabThinking"),
        helpPanelInstall: document.getElementById("helpPanelInstall"),
        helpPanelThinking: document.getElementById("helpPanelThinking"),
        toast: document.getElementById("toast"),
        taskListPanel: document.getElementById("taskListPanel"),
        taskListDetails: document.getElementById("taskListDetails"),
        taskListCount: document.getElementById("taskListCount"),
        taskListBody: document.getElementById("taskListBody"),
        addModelOverlay: document.getElementById("addModelOverlay"),
        closeAddModel: document.getElementById("closeAddModel"),
        cancelAddModel: document.getElementById("cancelAddModel"),
        clearModelEdit: document.getElementById("clearModelEdit"),
        confirmAddModel: document.getElementById("confirmAddModel"),
        modelManagerList: document.getElementById("modelManagerList"),
        modelInput: document.getElementById("modelInput"),
        modelEditHint: document.getElementById("modelEditHint"),
        modelAddError: document.getElementById("modelAddError"),
      };
      let isComposing = false;
      let lastCompositionEndAt = 0;
      const compositionEnterGuardMs = 150;
      const autoApplyConfigRetryMs = 30000;
      let lastAutoApplyConfigKey = "";
      let lastAutoApplyConfigAt = 0;
      const assistantRedirects = {};
      let toastTimer = null;
      let runStreamExportPending = false;
      let historySessionExportPendingKey = "";
      let resizeFrame = 0;
      const TAB_RUNTIME_DEFAULT_KEY = "__default__";
      const conversationRuntimeByTabId = Object.create(null);
      let runWaitTimer = null;
      let runWaitStartAt = 0;
      let runStreamStaleTimer = null;
      let lastScrollToBottomVisible = false;
      let followLatestMessages = true;
      let suppressScrollButtonUntil = 0;
      const queuePromptPreviewLimit = 200;
      const queuePromptPreviewSuffix = "...";
      const CHAT_BOTTOM_THRESHOLD_PX = 50;
      const AUTO_SCROLL_BUTTON_SUPPRESS_MS = 240;
      const RUN_STREAM_PREVIEW_MAX_LENGTH = 220;
      const RUN_STREAM_AUTO_SCROLL_THRESHOLD_PX = 50;
      const RUN_STREAM_STALE_THRESHOLD_MULTIPLIER = 1.5;
      const RUN_STREAM_STALE_WARNING_BASE_MS = 30 * 1000;
      const RUN_STREAM_STALE_CRITICAL_BASE_MS = 2 * 60 * 1000;
      const RUN_STREAM_STALE_WARNING_MS = RUN_STREAM_STALE_WARNING_BASE_MS * RUN_STREAM_STALE_THRESHOLD_MULTIPLIER;
      const RUN_STREAM_STALE_CRITICAL_MS = RUN_STREAM_STALE_CRITICAL_BASE_MS * RUN_STREAM_STALE_THRESHOLD_MULTIPLIER;
      const RUN_STREAM_STALE_REFRESH_INTERVAL_MS = 1000;
      const CONVERSATION_TAB_PAGE_SIZE = 5;
      const LOBSTER_EXECUTION_MODE_MAIN_SUB_MULTI_AGENT = "${LOBSTER_EXECUTION_MODE_MAIN_SUB_MULTI_AGENT}";
      const LOBSTER_EXECUTION_MODE_DEBATE_MULTI_AGENT = "${LOBSTER_EXECUTION_MODE_DEBATE_MULTI_AGENT}";
      const runningTabStartedAtById = Object.create(null);
      const erroredTabIds = new Set();
      const lobsterMetaByTabId = Object.create(null);
      let conversationTabPageIndex = 0;
      let conversationTabPageAnchorTabId = null;

      function normalizeLobsterExecutionMode(value) {
        return value === LOBSTER_EXECUTION_MODE_DEBATE_MULTI_AGENT
          ? LOBSTER_EXECUTION_MODE_DEBATE_MULTI_AGENT
          : LOBSTER_EXECUTION_MODE_MAIN_SUB_MULTI_AGENT;
      }

      function normalizeLobsterExecutionModeByCli(value, fallbackByCli) {
        const nextByCli = {};
        const hasIncomingByCli = Boolean(value && typeof value === "object");
        CLI_NAMES.forEach((cli) => {
          const hasIncomingCli = hasIncomingByCli && Object.prototype.hasOwnProperty.call(value, cli);
          const candidate = hasIncomingCli ? value[cli] : undefined;
          const fallback = !hasIncomingByCli && fallbackByCli && typeof fallbackByCli === "object"
            ? fallbackByCli[cli]
            : undefined;
          nextByCli[cli] = normalizeLobsterExecutionMode(hasIncomingCli ? candidate : fallback);
        });
        return nextByCli;
      }

      function getLobsterExecutionModeForCli(cli = state.currentCli) {
        return normalizeLobsterExecutionMode(
          state.lobsterExecutionModeByCli && state.lobsterExecutionModeByCli[cli]
        );
      }

      function setLobsterExecutionModeForCli(cli, value) {
        const normalized = normalizeLobsterExecutionMode(value);
        state.lobsterExecutionModeByCli = normalizeLobsterExecutionModeByCli(
          state.lobsterExecutionModeByCli,
          state.lobsterExecutionModeByCli
        );
        state.lobsterExecutionModeByCli[cli] = normalized;
        return normalized;
      }

      function normalizeLobsterMaxRounds(value) {
        const numeric = typeof value === "number"
          ? value
          : (typeof value === "string" && value.trim() ? Number(value) : NaN);
        if (!Number.isFinite(numeric)) {
          return ${LOBSTER_MAX_ROUNDS_SETTING_DEFAULT};
        }
        return Math.min(
          Math.max(Math.floor(numeric), ${LOBSTER_MAX_ROUNDS_SETTING_MIN}),
          ${LOBSTER_MAX_ROUNDS_SETTING_MAX}
        );
      }

      function createTaskListState() {
        return {
          items: [],
          open: false,
          source: "auto",
          startIndex: 0,
        };
      }

      function createConversationRuntimeState() {
        return {
          messages: [],
          pendingPromptQueue: [],
          queueEditingIndex: -1,
          queueEditingDraft: "",
          pendingRunPrompt: null,
          suppressQueueFlushOnce: false,
          currentRunPrompt: "",
          lastRunStatusMessage: "",
          activeRunActivity: "",
          runStreamRecordCounter: 0,
          runStreamRecords: [],
          runStreamOpenRecordIds: new Set(),
          taskList: createTaskListState(),
          overlays: {
            runConflict: false,
            queue: false,
            runPrompt: false,
            runStream: false,
          },
        };
      }

      function resolveConversationRuntimeKey(tabId) {
        return typeof tabId === "string" && tabId ? tabId : TAB_RUNTIME_DEFAULT_KEY;
      }

      function getConversationRuntimeState(tabId, options = {}) {
        const key = resolveConversationRuntimeKey(tabId);
        const shouldCreate = options.create !== false;
        if (!conversationRuntimeByTabId[key] && shouldCreate) {
          conversationRuntimeByTabId[key] = createConversationRuntimeState();
        }
        return conversationRuntimeByTabId[key] || null;
      }

      function getActiveConversationRuntimeState(options = {}) {
        const activeTabId = state.conversationTabs ? state.conversationTabs.activeTabId : null;
        return getConversationRuntimeState(activeTabId, options);
      }

      function pruneConversationRuntimeStates(tabIds) {
        const validKeys = new Set([TAB_RUNTIME_DEFAULT_KEY]);
        if (Array.isArray(tabIds)) {
          tabIds.forEach((tabId) => {
            if (typeof tabId === "string" && tabId) {
              validKeys.add(tabId);
            }
          });
        }
        Object.keys(conversationRuntimeByTabId).forEach((key) => {
          if (!validKeys.has(key)) {
            delete conversationRuntimeByTabId[key];
          }
        });
        Object.keys(runningTabStartedAtById).forEach((key) => {
          if (!validKeys.has(key)) {
            delete runningTabStartedAtById[key];
          }
        });
        Array.from(erroredTabIds).forEach((tabId) => {
          if (!validKeys.has(tabId)) {
            erroredTabIds.delete(tabId);
          }
        });
        Object.keys(lobsterMetaByTabId).forEach((key) => {
          if (!validKeys.has(key)) {
            delete lobsterMetaByTabId[key];
          }
        });
      }

      function isRuntimeStateForActiveTab(tabId) {
        const activeTabId = getActiveConversationTabId();
        return resolveConversationRuntimeKey(tabId) === resolveConversationRuntimeKey(activeTabId);
      }

      function ensureRuntimeStateMessages(runtimeState) {
        if (!runtimeState || !Array.isArray(runtimeState.messages)) {
          if (runtimeState) {
            runtimeState.messages = [];
          }
          return [];
        }
        return runtimeState.messages;
      }

      function ensureRuntimeTaskList(runtimeState) {
        if (!runtimeState || !runtimeState.taskList || typeof runtimeState.taskList !== "object") {
          if (runtimeState) {
            runtimeState.taskList = createTaskListState();
          }
          return null;
        }
        if (!Array.isArray(runtimeState.taskList.items)) {
          runtimeState.taskList.items = [];
        }
        runtimeState.taskList.open = Boolean(runtimeState.taskList.open);
        runtimeState.taskList.source = runtimeState.taskList.source === "external" ? "external" : "auto";
        runtimeState.taskList.startIndex = Number.isInteger(runtimeState.taskList.startIndex)
          ? Math.max(0, runtimeState.taskList.startIndex)
          : 0;
        return runtimeState.taskList;
      }

      function getTaskListState(tabId, options = {}) {
        const runtimeState = getConversationRuntimeState(tabId, options);
        return ensureRuntimeTaskList(runtimeState);
      }

      function getActiveTaskListState(options = {}) {
        const runtimeState = getActiveConversationRuntimeState(options);
        return ensureRuntimeTaskList(runtimeState);
      }

      function resetTaskListState(taskListState, startIndex = 0) {
        if (!taskListState) {
          return;
        }
        taskListState.startIndex = Number.isInteger(startIndex) ? Math.max(0, startIndex) : 0;
        taskListState.items = [];
        taskListState.open = false;
        taskListState.source = "auto";
      }

      function syncActiveMessagesFromRuntime(options = {}) {
        const runtimeState = getActiveConversationRuntimeState({ create: true });
        const nextMessages = ensureRuntimeStateMessages(runtimeState);
        state.messages = nextMessages;
        if (options.render !== false) {
          renderMessages();
        }
      }

      function setMessagesForTab(tabId, messages, options = {}) {
        try {
          const runtimeState = getConversationRuntimeState(tabId, { create: true });
          runtimeState.messages = Array.isArray(messages) ? messages : [];
          const lobsterMetaChanged = updateLobsterMetaForTabFromMessages(tabId, runtimeState.messages);
          resetTaskListState(ensureRuntimeTaskList(runtimeState), 0);
          hydrateRunArtifactsFromMessages(tabId, runtimeState.messages);
          if (isRuntimeStateForActiveTab(tabId)) {
            state.messages = runtimeState.messages;
            if (options.render !== false) {
              renderMessages();
            }
          }
          if (lobsterMetaChanged) {
            renderConversationTabs();
          }
        } catch (error) {
          reportWebviewFailure("setMessagesForTab-failed", error, {
            tabId,
            messageCount: Array.isArray(messages) ? messages.length : -1,
          });
          throw error;
        }
      }

      function isRunStatusSummaryText(content) {
        const normalized = String(content || "").trim();
        if (!normalized) {
          return false;
        }
        return /^(?:任务已完成|运行已终止|用户已终止|CLI\s*退出码[:：]\s*\S+|Task completed|Run stopped|Stopped by user|CLI exit code:\s*\S+)/i.test(normalized);
      }

      function normalizeRunActivity(activity) {
        return activity === "contextCompaction" ? "contextCompaction" : "";
      }

      function buildQueuePausedStatusText(summary, remainingCount) {
        const count = Number.isFinite(remainingCount) ? Math.max(0, Number(remainingCount)) : 0;
        const baseSummary = String(summary || "").trim();
        const pauseNotice = t("toastQueuePaused", { count: String(count) });
        if (!baseSummary) {
          return pauseNotice;
        }
        return baseSummary + " " + pauseNotice;
      }

      function shouldHideSystemRunStatusMessage(message) {
        if (!message || message.role !== "system") {
          return false;
        }
        return isRunStatusSummaryText(message.content);
      }

      function isFinalAssistantSummaryMessage(messageIndex) {
        if (!Array.isArray(state.messages) || messageIndex < 0 || messageIndex >= state.messages.length) {
          return false;
        }
        const current = state.messages[messageIndex];
        if (!current || current.role !== "assistant") {
          return false;
        }
        if (current.lobsterAnswerConclusion === true) {
          return true;
        }
        if (current.lobsterFinalSummary === true) {
          return true;
        }
        if (current.codexFinalAnswer === true) {
          return true;
        }
        for (let i = messageIndex + 1; i < state.messages.length; i += 1) {
          const next = state.messages[i];
          if (!next) {
            continue;
          }
          if (next.role === "system" && isRunStatusSummaryText(next.content)) {
            return true;
          }
          if (next.role === "system" && !String(next.content || "").trim()) {
            continue;
          }
          return false;
        }
        return false;
      }

      function deriveLatestRunPromptFromMessages(messages) {
        if (!Array.isArray(messages)) {
          return "";
        }
        for (let i = messages.length - 1; i >= 0; i -= 1) {
          const item = messages[i];
          if (!item || item.role !== "user") {
            continue;
          }
          const prompt = String(item.content || "").trim();
          if (prompt) {
            return prompt;
          }
        }
        return "";
      }

      function deriveLatestRunStatusMessageFromMessages(messages) {
        if (!Array.isArray(messages)) {
          return "";
        }
        for (let i = messages.length - 1; i >= 0; i -= 1) {
          const item = messages[i];
          if (!item || item.role !== "system") {
            continue;
          }
          const content = String(item.content || "").trim();
          if (isRunStatusSummaryText(content)) {
            return content;
          }
        }
        return "";
      }

      function hydrateRunArtifactsFromMessages(tabId, messages) {
        const runtimeState = getConversationRuntimeState(tabId, { create: false });
        if (!runtimeState || isTabRunning(tabId)) {
          return;
        }

        const promptFromMessages = deriveLatestRunPromptFromMessages(messages);
        if (promptFromMessages) {
          runtimeState.currentRunPrompt = promptFromMessages;
        }

        const statusFromMessages = deriveLatestRunStatusMessageFromMessages(messages);
        runtimeState.lastRunStatusMessage = statusFromMessages || "";

      }

      function resetConversationRuntimeState(tabId) {
        const runtimeState = getConversationRuntimeState(tabId, { create: false });
        if (!runtimeState) {
          return;
        }
        resetTaskListState(ensureRuntimeTaskList(runtimeState), 0);
        ensureRuntimeStateMessages(runtimeState).length = 0;
        runtimeState.pendingPromptQueue.length = 0;
        runtimeState.queueEditingIndex = -1;
        runtimeState.queueEditingDraft = "";
        runtimeState.pendingRunPrompt = null;
        runtimeState.suppressQueueFlushOnce = false;
        runtimeState.currentRunPrompt = "";
        runtimeState.lastRunStatusMessage = "";
        runtimeState.activeRunActivity = "";
        runtimeState.runStreamRecordCounter = 0;
        runtimeState.runStreamRecords.length = 0;
        runtimeState.runStreamOpenRecordIds.clear();
        runtimeState.overlays.runConflict = false;
        runtimeState.overlays.queue = false;
        runtimeState.overlays.runPrompt = false;
        runtimeState.overlays.runStream = false;
        if (isRuntimeStateForActiveTab(tabId)) {
          syncActiveMessagesFromRuntime();
          syncConversationControlsForActiveTab();
        }
      }

      function normalizeEditorContext(payload) {
        const filePath = payload && typeof payload.filePath === "string" && payload.filePath
          ? payload.filePath
          : null;
        const fileLabel = payload && typeof payload.fileLabel === "string" && payload.fileLabel
          ? payload.fileLabel
          : filePath;
        const hasSelection = Boolean(payload && payload.hasSelection);
        const selectionLabel = payload && typeof payload.selectionLabel === "string" && payload.selectionLabel
          ? payload.selectionLabel
          : null;
        return {
          filePath,
          fileLabel,
          hasSelection,
          selectionLabel,
        };
      }

      function getFileTagKeyFor(editorContext) {
        if (!editorContext) {
          return "";
        }
        return editorContext.filePath || editorContext.fileLabel || "";
      }

      function getSelectionTagKeyFor(editorContext) {
        if (!editorContext || !editorContext.hasSelection) {
          return "";
        }
        const base = getFileTagKeyFor(editorContext);
        return base + "::" + (editorContext.selectionLabel || "selection");
      }

      function getCurrentFileTagKey() {
        return getFileTagKeyFor(state.editorContext);
      }

      function getSelectionTagKey() {
        return getSelectionTagKeyFor(state.editorContext);
      }

      function syncPromptContextWithEditorContext(options = {}) {
        const resetDismissed = Boolean(options.resetDismissed);
        if (resetDismissed) {
          state.promptContext.dismissedFileKey = "";
          state.promptContext.dismissedSelectionKey = "";
        }

        if (!state.autoAddEditorContextTags) {
          state.promptContext.includeCurrentFile = false;
          state.promptContext.includeSelection = false;
          state.promptContext.dismissedFileKey = "";
          state.promptContext.dismissedSelectionKey = "";
          return;
        }

        if (!state.promptContext.autoIncludeArmed) {
          return;
        }

        const fileKey = getCurrentFileTagKey();
        if (!fileKey) {
          state.promptContext.includeCurrentFile = false;
          state.promptContext.dismissedFileKey = "";
        } else {
          state.promptContext.includeCurrentFile = state.promptContext.dismissedFileKey !== fileKey;
        }

        const selectionKey = getSelectionTagKey();
        if (!selectionKey) {
          state.promptContext.includeSelection = false;
          state.promptContext.dismissedSelectionKey = "";
        } else {
          state.promptContext.includeSelection = state.promptContext.dismissedSelectionKey !== selectionKey;
        }
      }

      function formatPromptContextTagLabel() {
        if (!state.editorContext.fileLabel) {
          return state.editorContext.selectionLabel
            ? "[" + state.editorContext.selectionLabel + "]"
            : t("contextTagSelection");
        }
        if (state.editorContext.hasSelection && state.promptContext.includeSelection && state.editorContext.selectionLabel) {
          return t("contextTagSelectionWithRange", {
            file: state.editorContext.fileLabel,
            range: state.editorContext.selectionLabel,
          });
        }
        return t("contextTagCurrentFile") + ": " + state.editorContext.fileLabel;
      }

      function removePromptContextTag(kind) {
        if (kind === "editorContext") {
          state.promptContext.includeCurrentFile = false;
          state.promptContext.includeSelection = false;
          state.promptContext.dismissedFileKey = getCurrentFileTagKey();
          state.promptContext.dismissedSelectionKey = getSelectionTagKey();
        }
        renderPromptContextTags();
      }

      function renderPromptContextTags() {
        if (!elements.promptContextTags) {
          return;
        }
        if (!state.autoAddEditorContextTags) {
          elements.promptContextTags.innerHTML = "";
          elements.promptContextTags.style.display = "none";
          return;
        }
        elements.promptContextTags.innerHTML = "";
        const hasFileTag = Boolean(state.editorContext.fileLabel && state.promptContext.includeCurrentFile);
        const hasSelectionTag = Boolean(state.editorContext.hasSelection && state.promptContext.includeSelection);

        if (!hasFileTag && !hasSelectionTag) {
          elements.promptContextTags.style.display = "none";
          return;
        }

        const chip = document.createElement("div");
        chip.className = "prompt-context-tag";

        const label = document.createElement("span");
        label.className = "prompt-context-tag-label";
        label.textContent = formatPromptContextTagLabel();
        label.title = label.textContent;

        const removeButton = document.createElement("button");
        removeButton.type = "button";
        removeButton.className = "prompt-context-tag-remove";
        removeButton.textContent = "x";
        removeButton.setAttribute("aria-label", t("contextTagRemoveAria", { label: t("contextTagCurrentFile") }));
        removeButton.setAttribute("title", t("contextTagRemoveAria", { label: t("contextTagCurrentFile") }));
        removeButton.addEventListener("click", () => {
          removePromptContextTag("editorContext");
        });

        chip.appendChild(label);
        chip.appendChild(removeButton);
        elements.promptContextTags.appendChild(chip);
        elements.promptContextTags.style.display = "flex";
      }

      function rearmPromptContextOnEditorChange(previousContext, nextContext) {
        const previousFileKey = getFileTagKeyFor(previousContext);
        const previousSelectionKey = getSelectionTagKeyFor(previousContext);
        const nextFileKey = getFileTagKeyFor(nextContext);
        const nextSelectionKey = getSelectionTagKeyFor(nextContext);

        if (previousFileKey !== nextFileKey) {
          if (!nextFileKey) {
            state.promptContext.includeCurrentFile = false;
            state.promptContext.dismissedFileKey = "";
          } else if (state.promptContext.dismissedFileKey === nextFileKey) {
            state.promptContext.includeCurrentFile = false;
          } else {
            state.promptContext.includeCurrentFile = true;
            if (state.promptContext.dismissedFileKey) {
              state.promptContext.dismissedFileKey = "";
            }
          }
        }

        if (previousSelectionKey !== nextSelectionKey) {
          if (!nextSelectionKey) {
            state.promptContext.includeSelection = false;
            state.promptContext.dismissedSelectionKey = "";
          } else if (state.promptContext.dismissedSelectionKey === nextSelectionKey) {
            state.promptContext.includeSelection = false;
          } else {
            state.promptContext.includeSelection = true;
            if (state.promptContext.dismissedSelectionKey) {
              state.promptContext.dismissedSelectionKey = "";
            }
          }
        }
      }

      function applyEditorContext(payload, options = {}) {
        const nextEditorContext = normalizeEditorContext(payload);
        const previousEditorContext = state.editorContext;
        const shouldAutoRearm = options.autoRearm !== false;

        if (shouldAutoRearm && !state.promptContext.autoIncludeArmed) {
          rearmPromptContextOnEditorChange(previousEditorContext, nextEditorContext);
        }

        state.editorContext = nextEditorContext;
        syncPromptContextWithEditorContext(options);
        renderPromptContextTags();
      }

      function buildPromptPayload(prompt) {
        const autoAddEditorContextTags = Boolean(state.autoAddEditorContextTags);
        const includeCurrentFile = Boolean(autoAddEditorContextTags && state.promptContext.includeCurrentFile && getCurrentFileTagKey());
        const includeSelection = Boolean(autoAddEditorContextTags && state.promptContext.includeSelection && state.editorContext.hasSelection);
        return {
          prompt,
          contextOptions: {
            includeCurrentFile,
            includeSelection,
          },
        };
      }

      function normalizePromptPayload(payload) {
        if (!payload) {
          return null;
        }
        if (typeof payload === "string") {
          return {
            prompt: payload,
            contextOptions: {
              includeCurrentFile: true,
              includeSelection: true,
            },
          };
        }
        const prompt = typeof payload.prompt === "string" ? payload.prompt : "";
        if (!prompt) {
          return null;
        }
        const contextOptions = payload.contextOptions || {};
        return {
          prompt,
          contextOptions: {
            includeCurrentFile: contextOptions.includeCurrentFile !== false,
            includeSelection: contextOptions.includeSelection !== false,
          },
        };
      }

      function armPromptContextForConversationStart() {
        state.promptContext.autoIncludeArmed = true;
        syncPromptContextWithEditorContext({ resetDismissed: true });
        renderPromptContextTags();
      }

      function resetPromptContextForNextPrompt() {
        state.promptContext.autoIncludeArmed = false;
        state.promptContext.includeCurrentFile = false;
        state.promptContext.includeSelection = false;
        renderPromptContextTags();
      }

      function updateAppHeight() {
        document.documentElement.style.setProperty("--app-height", window.innerHeight + "px");
      }

      function scheduleAppHeightUpdate() {
        if (resizeFrame) {
          cancelAnimationFrame(resizeFrame);
        }
        resizeFrame = requestAnimationFrame(() => {
          resizeFrame = 0;
          updateAppHeight();
        });
      }

      function normalizeModelNameList(value) {
        if (!Array.isArray(value)) {
          return [];
        }
        const seen = new Set();
        const result = [];
        value.forEach((item) => {
          const modelName = typeof item === "string" ? item.trim() : "";
          const key = modelName.toLowerCase();
          if (!modelName || seen.has(key)) {
            return;
          }
          seen.add(key);
          result.push(modelName);
        });
        return result;
      }

      function normalizeModelSelection(value) {
        return typeof value === "string" ? value.trim() : "";
      }

      function shouldPreserveCurrentCliModelsOnEmptySnapshot(cli, nextModels, nextManagedModels, previousModels, previousManagedModels) {
        if (cli !== state.currentCli) {
          return false;
        }
        if (nextModels.length > 0 || nextManagedModels.length > 0) {
          return false;
        }
        if (previousModels.length === 0 && previousManagedModels.length === 0) {
          return false;
        }
        const activeConfigId = state.configState && typeof state.configState.activeConfigId === "string"
          ? state.configState.activeConfigId
          : "";
        const selectedConfigId = typeof state.selectedConfigId === "string" ? state.selectedConfigId : "";
        if (!selectedConfigId) {
          return false;
        }
        return !activeConfigId || activeConfigId !== selectedConfigId;
      }

      function applyModelState(modelState, panelCurrentCli) {
        if (!modelState) {
          return;
        }
        const nextModelsByCli = {};
        const nextManagedModelsByCli = {};
        const nextSelectedModelsByCli = {};
        const nextLobsterMainModelsByCli = {};
        const nextLobsterSubtaskModelsByCli = {};
        const nextSelectedLobsterMainModelsByCli = {};
        const nextSelectedLobsterSubtaskModelsByCli = {};
        const nextManagedModelRolesByCli = {};

        CLI_NAMES.forEach((cli) => {
          const incomingModels = normalizeModelNameList(modelState.optionsByCli && modelState.optionsByCli[cli]);
          const incomingManagedModels = normalizeModelNameList(modelState.managedByCli && modelState.managedByCli[cli]);
          const previousModels = normalizeModelNameList(state.modelsByCli && state.modelsByCli[cli]);
          const previousManagedModels = normalizeModelNameList(state.managedModelsByCli && state.managedModelsByCli[cli]);
          const preservePrevious = shouldPreserveCurrentCliModelsOnEmptySnapshot(
            cli,
            incomingModels,
            incomingManagedModels,
            previousModels,
            previousManagedModels
          );

          nextModelsByCli[cli] = preservePrevious ? previousModels : incomingModels;
          nextManagedModelsByCli[cli] = preservePrevious ? previousManagedModels : incomingManagedModels;
          nextSelectedModelsByCli[cli] = preservePrevious
            ? normalizeModelSelection(state.selectedModelsByCli && state.selectedModelsByCli[cli])
            : normalizeModelSelection(modelState.selectedByCli && modelState.selectedByCli[cli]);
          nextLobsterMainModelsByCli[cli] = preservePrevious
            ? normalizeModelNameList(state.lobsterMainModelsByCli && state.lobsterMainModelsByCli[cli])
            : normalizeModelNameList(modelState.lobsterOptionsByCli && modelState.lobsterOptionsByCli[cli] && modelState.lobsterOptionsByCli[cli].main);
          nextLobsterSubtaskModelsByCli[cli] = preservePrevious
            ? normalizeModelNameList(state.lobsterSubtaskModelsByCli && state.lobsterSubtaskModelsByCli[cli])
            : normalizeModelNameList(modelState.lobsterOptionsByCli && modelState.lobsterOptionsByCli[cli] && modelState.lobsterOptionsByCli[cli].subtask);
          nextSelectedLobsterMainModelsByCli[cli] = preservePrevious
            ? normalizeModelSelection(state.selectedLobsterMainModelsByCli && state.selectedLobsterMainModelsByCli[cli])
            : normalizeModelSelection(modelState.selectedLobsterByCli && modelState.selectedLobsterByCli[cli] && modelState.selectedLobsterByCli[cli].main);
          nextSelectedLobsterSubtaskModelsByCli[cli] = preservePrevious
            ? normalizeModelSelection(state.selectedLobsterSubtaskModelsByCli && state.selectedLobsterSubtaskModelsByCli[cli])
            : normalizeModelSelection(modelState.selectedLobsterByCli && modelState.selectedLobsterByCli[cli] && modelState.selectedLobsterByCli[cli].subtask);
          nextManagedModelRolesByCli[cli] = preservePrevious
            ? ((state.managedModelRolesByCli && state.managedModelRolesByCli[cli]) || {})
            : ((modelState.managedLobsterRolesByCli && modelState.managedLobsterRolesByCli[cli]) || {});
        });

        state.modelsByCli = nextModelsByCli;
        state.managedModelsByCli = nextManagedModelsByCli;
        state.selectedModelsByCli = nextSelectedModelsByCli;
        state.lobsterMainModelsByCli = nextLobsterMainModelsByCli;
        state.lobsterSubtaskModelsByCli = nextLobsterSubtaskModelsByCli;
        state.selectedLobsterMainModelsByCli = nextSelectedLobsterMainModelsByCli;
        state.selectedLobsterSubtaskModelsByCli = nextSelectedLobsterSubtaskModelsByCli;
        state.managedModelRolesByCli = nextManagedModelRolesByCli;
        state.selectedModel = state.selectedModelsByCli[panelCurrentCli] || "";
      }

      function applyState(panelState) {
        const previousCli = state.currentCli;
        const previousActiveTabId = state.conversationTabs && typeof state.conversationTabs.activeTabId === "string"
          ? state.conversationTabs.activeTabId
          : null;
        state.currentCli = panelState.currentCli;
        state.sessionState = panelState.sessionState;
        state.conversationTabs = panelState.conversationTabs || { activeTabId: null, tabs: [] };
        const nextActiveTabId = state.conversationTabs && typeof state.conversationTabs.activeTabId === "string"
          ? state.conversationTabs.activeTabId
          : null;
        if (previousCli !== state.currentCli || previousActiveTabId !== nextActiveTabId) {
          state.autoAppliedConfig = false;
        }
        const tabIds = Array.isArray(state.conversationTabs.tabs)
          ? state.conversationTabs.tabs.map((tab) => tab.id)
          : [];
        pruneConversationRuntimeStates(tabIds);
        if (Array.isArray(state.conversationTabs.tabs)) {
          state.conversationTabs.tabs.forEach((tab) => {
            updateLobsterMetaForTabFromSummary(tab);
          });
        }
        syncActiveMessagesFromRuntime();
        state.promptHistory = Array.isArray(panelState.promptHistory) ? panelState.promptHistory : [];
        state.lobsterGroupChatHistory = Array.isArray(panelState.lobsterGroupChatHistory)
          ? panelState.lobsterGroupChatHistory
          : [];
        state.configState = panelState.configState || { configs: [], activeConfigId: null };
        const configs = Array.isArray(state.configState.configs)
          ? state.configState.configs
          : [];
        let nextSelected = state.configState.activeConfigId || "";
        let shouldAutoApplyConfig = false;

        // 如果后端返回的 activeConfigId 为 null，但前端已有有效选择，且该选择仍然在配置列表中，则保持前端选择
        if (!nextSelected && state.selectedConfigId) {
          const configExists = configs.some(c => c.id === state.selectedConfigId);
          if (configExists) {
            nextSelected = state.selectedConfigId;
            shouldAutoApplyConfig = true;
          }
        }

        if (!nextSelected && configs.length > 0) {
          nextSelected = configs[0].id;
          shouldAutoApplyConfig = true;
        }
        const autoApplyConfigKey = state.currentCli + ":" + nextSelected;
        const canAutoApplyConfig = shouldAutoApplyConfig && (
          !state.autoAppliedConfig
          || lastAutoApplyConfigKey !== autoApplyConfigKey
          || Date.now() - lastAutoApplyConfigAt > autoApplyConfigRetryMs
        );
        if (canAutoApplyConfig) {
          state.autoAppliedConfig = true;
          lastAutoApplyConfigKey = autoApplyConfigKey;
          lastAutoApplyConfigAt = Date.now();
          vscode.postMessage({
            type: "applyConfig",
            cli: state.currentCli,
            configId: nextSelected,
          });
        }
        state.selectedConfigId = nextSelected;
        state.thinkingMode = panelState.thinkingMode || "medium";
        state.interactiveMode = normalizeInteractiveMode(panelState.interactiveMode);
        const previousAutoAddEditorContextTags = Boolean(state.autoAddEditorContextTags);
        state.debug = Boolean(panelState.debug);
        state.autoAddEditorContextTags = Boolean(panelState.autoAddEditorContextTags);
        state.longTermMemoryEnabled = panelState.longTermMemoryEnabled !== false;
        state.workspaceMemoryEnabled = panelState.workspaceMemoryEnabled !== false;
        state.longTermMemoryManagedByProjectCh = Boolean(panelState.longTermMemoryManagedByProjectCh);
        state.autoCompactContextAfterRun = Boolean(panelState.autoCompactContextAfterRun);
        state.codexMultiAgentEnabled = Boolean(panelState.codexMultiAgentEnabled);
        state.lobsterMaxRounds = normalizeLobsterMaxRounds(panelState.lobsterMaxRounds);
        state.lobsterAutoCloseSubtaskTabs = Boolean(panelState.lobsterAutoCloseSubtaskTabs);
        state.lobsterExecutionModeByCli = normalizeLobsterExecutionModeByCli(
          panelState.lobsterExecutionModeByCli,
          state.lobsterExecutionModeByCli
        );
        if (!state.autoAddEditorContextTags) {
          state.promptContext.autoIncludeArmed = true;
          state.promptContext.includeCurrentFile = false;
          state.promptContext.includeSelection = false;
          state.promptContext.dismissedFileKey = "";
          state.promptContext.dismissedSelectionKey = "";
        } else if (!previousAutoAddEditorContextTags) {
          state.promptContext.autoIncludeArmed = true;
          state.promptContext.dismissedFileKey = "";
          state.promptContext.dismissedSelectionKey = "";
        }
        state.locale = typeof panelState.locale === "string" ? panelState.locale : "auto";
        state.isMac = Boolean(panelState.isMac);
        state.macTaskShell = panelState.macTaskShell === "bash" ? "bash" : "zsh";
        state.interactive = panelState.interactive || { supported: false, enabled: false };
        state.rulePaths = panelState.rulePaths || { global: {}, project: {} };
        // Handle modelState
        if (panelState.modelState) {
          applyModelState(panelState.modelState, panelState.currentCli);
        }
        elements.currentCli.value = panelState.currentCli;
        if (elements.rulesLoadCli) {
          elements.rulesLoadCli.value = panelState.currentCli;
        }
        updateRulesScope(state.ruleScope);
        syncThinkingOptions();
        elements.thinkingMode.value = state.thinkingMode;
        if (elements.modelSelect) {
          updateModelSelectOptions();
        }
        updateLobsterModelSelectOptions();
        syncModelSelectorByInteractiveMode();
        if (elements.addModelOverlay && elements.addModelOverlay.classList.contains("visible")) {
          renderModelManagerList();
          syncModelManageForm();
        }
        if (elements.debugMode) {
          elements.debugMode.checked = state.debug;
        }
        if (elements.autoAddEditorContextTags) {
          elements.autoAddEditorContextTags.checked = state.autoAddEditorContextTags;
        }
        syncLongTermMemoryWorkspaceControl();
        if (elements.autoCompactContextAfterRun) {
          elements.autoCompactContextAfterRun.checked = state.autoCompactContextAfterRun;
        }
        if (elements.codexMultiAgentEnabled) {
          elements.codexMultiAgentEnabled.checked = state.codexMultiAgentEnabled;
        }
        if (elements.lobsterMaxRounds) {
          elements.lobsterMaxRounds.value = String(state.lobsterMaxRounds);
        }
        if (elements.lobsterAutoCloseSubtaskTabs) {
          elements.lobsterAutoCloseSubtaskTabs.checked = state.lobsterAutoCloseSubtaskTabs;
        }
        if (elements.languageSelect) {
          elements.languageSelect.value = state.locale || "auto";
        }
        if (elements.macTaskShellRow) {
          elements.macTaskShellRow.style.display = state.isMac ? "flex" : "none";
        }
        if (elements.macTaskShell) {
          elements.macTaskShell.value = state.macTaskShell;
        }
        if (elements.resultOnlyToggle) {
          elements.resultOnlyToggle.checked = state.onlyShowFinalResults;
        }
        syncInteractiveOptions();
        if (elements.interactiveModeSelect) {
          elements.interactiveModeSelect.value = state.interactiveMode;
        }
        renderConfigOptions();
        syncRunningStateForActiveTab();
        renderConversationTabs();
        renderSessionList();
        renderPromptHistoryList();
        renderLobsterGroupChatHistoryList();
        applyEditorContext(panelState.editorContext);
      }

      function renderConfigOptions() {
        elements.configSelect.innerHTML = "";
        const configs = Array.isArray(state.configState.configs)
          ? state.configState.configs
          : [];
        if (configs.length === 0) {
          const option = document.createElement("option");
          option.value = "";
          option.textContent = t("noConfigOption");
          elements.configSelect.appendChild(option);
          elements.configSelect.value = "";
          return;
        }
        configs.forEach((config) => {
          const option = document.createElement("option");
          option.value = config.id;
          option.textContent = config.name || config.id;
          elements.configSelect.appendChild(option);
        });
        elements.configSelect.value = state.selectedConfigId || "";
      }

      function syncThinkingOptions() {
        const isGemini = state.currentCli === "gemini";
        const isCodex = state.currentCli === "codex";
        const isClaude = state.currentCli === "claude";
        const mediumOption = elements.thinkingMode.querySelector('option[value="medium"]');
        const xhighOption = elements.thinkingMode.querySelector('option[value="xhigh"]');
        const maxOption = elements.thinkingMode.querySelector('option[value="max"]');
        if (isGemini && mediumOption) {
          mediumOption.remove();
        }
        if (!isGemini && !mediumOption) {
          const option = document.createElement("option");
          option.value = "medium";
          option.textContent = t("thinkingOptionLabelMedium");
          const highOption = elements.thinkingMode.querySelector('option[value="high"]');
          if (highOption && highOption.parentElement) {
            highOption.parentElement.insertBefore(option, highOption);
          } else {
            elements.thinkingMode.appendChild(option);
          }
        }
        const offOption = elements.thinkingMode.querySelector('option[value="off"]');
        if (isCodex && offOption) {
          offOption.remove();
        }
        if (!isCodex && !offOption) {
          const option = document.createElement("option");
          option.value = "off";
          option.textContent = t("thinkingOptionLabelOff");
          const lowOption = elements.thinkingMode.querySelector('option[value="low"]');
          if (lowOption && lowOption.parentElement) {
            lowOption.parentElement.insertBefore(option, lowOption);
          } else {
            elements.thinkingMode.appendChild(option);
          }
        }
        if (!isCodex && !isClaude && xhighOption) {
          xhighOption.remove();
        }
        if ((isCodex || isClaude) && !xhighOption) {
          const option = document.createElement("option");
          option.value = "xhigh";
          option.textContent = t("thinkingOptionLabelXHigh");
          elements.thinkingMode.appendChild(option);
        }
        if (!isClaude && maxOption) {
          maxOption.remove();
        }
        if (isClaude && !maxOption) {
          const option = document.createElement("option");
          option.value = "max";
          option.textContent = t("thinkingOptionLabelMax");
          elements.thinkingMode.appendChild(option);
        }
        if (isGemini && state.thinkingMode === "medium") {
          updateThinkingMode("low");
        }
        if (isCodex && state.thinkingMode === "off") {
          updateThinkingMode("low");
        }
        if (!isCodex && !isClaude && state.thinkingMode === "xhigh") {
          updateThinkingMode("high");
        }
        if (!isClaude && state.thinkingMode === "max") {
          updateThinkingMode(isCodex ? "xhigh" : "high");
        }
      }

      function syncInteractiveOptions() {
        syncInteractiveModeSelector();
        syncCommonCommandOptions();
      }

      function syncInteractiveModeSelector() {
        if (!elements.interactiveModeSelect) {
          return;
        }
        const supported = Boolean(state.interactive && state.interactive.supported);
        const visible = supported;
        elements.interactiveModeSelect.style.display = visible ? "" : "none";
        elements.interactiveModeSelect.disabled = !visible;
        elements.interactiveModeSelect.value = normalizeInteractiveMode(state.interactiveMode);
        syncModelSelectorByInteractiveMode();
      }

      function syncCommonCommandOptions() {
        if (!elements.commonCommandButton) {
          return;
        }
        const supported = Boolean(state.interactive && state.interactive.supported);
        const visible = supported && (state.currentCli === "claude" || state.currentCli === "codex");
        elements.commonCommandButton.style.display = visible ? "inline-flex" : "none";
        elements.commonCommandButton.disabled = !visible || state.isRunning;
        if (elements.commandCompact) {
          elements.commandCompact.disabled = !visible || state.isRunning;
        }
      }

      function updateThinkingMode(nextMode) {
        state.thinkingMode = nextMode;
        elements.thinkingMode.value = nextMode;
        vscode.postMessage({
          type: "updateSetting",
          key: "thinkingMode",
          value: nextMode,
        });
      }

      function getChatDistanceToBottom() {
        return elements.chatArea.scrollHeight - (elements.chatArea.scrollTop + elements.chatArea.clientHeight);
      }

      function isChatNearBottom(threshold = CHAT_BOTTOM_THRESHOLD_PX) {
        return getChatDistanceToBottom() <= threshold;
      }

      function isScrollButtonSuppressed() {
        return Date.now() < suppressScrollButtonUntil;
      }

      function scrollChatToBottom(behavior = "auto") {
        elements.chatArea.scrollTo({ top: elements.chatArea.scrollHeight, behavior });
      }

      function stickChatToBottom(behavior = "auto") {
        followLatestMessages = true;
        suppressScrollButtonUntil = Date.now() + AUTO_SCROLL_BUTTON_SUPPRESS_MS;
        updateScrollToBottomButton(true);
        scrollChatToBottom(behavior);
        requestAnimationFrame(() => {
          scrollChatToBottom("auto");
          updateScrollToBottomButton(true);
        });
        setTimeout(() => {
          updateScrollToBottomButton();
        }, AUTO_SCROLL_BUTTON_SUPPRESS_MS + 20);
      }

      function updateScrollToBottomButton(forceHide = false) {
        if (!elements.scrollToBottomButton) {
          return;
        }
        const forceFollowLatest = shouldForceFollowLatestMessagesForActiveTab();
        const hasMessages = state.messages.length > 0;
        const hasOverflow = elements.chatArea.scrollHeight > (elements.chatArea.clientHeight + 1);
        const distanceToBottom = getChatDistanceToBottom();
        const buttonSuppressed = isScrollButtonSuppressed();
        const shouldShow = !forceHide && !buttonSuppressed && hasMessages && hasOverflow && distanceToBottom > CHAT_BOTTOM_THRESHOLD_PX;
        elements.scrollToBottomButton.classList.toggle("visible", shouldShow);
        elements.scrollToBottomButton.setAttribute("aria-hidden", String(!shouldShow));
        if (elements.scrollToBottomWrap) {
          elements.scrollToBottomWrap.setAttribute("aria-hidden", String(!shouldShow));
        }
        if (state.debug && shouldShow !== lastScrollToBottomVisible) {
          const debugPayload = {
            visible: shouldShow,
            forceHide,
            forceFollowLatest,
            buttonSuppressed,
            followLatestMessages,
            distanceToBottom,
            scrollTop: elements.chatArea.scrollTop,
            scrollHeight: elements.chatArea.scrollHeight,
            clientHeight: elements.chatArea.clientHeight,
            threshold: CHAT_BOTTOM_THRESHOLD_PX,
          };
          console.debug("[scroll-to-bottom]", debugPayload);
          postWebviewDebug("scroll-to-bottom-visibility", debugPayload);
        }
        lastScrollToBottomVisible = shouldShow;
      }

      function captureOpenTraceCollapsibleKeys() {
        traceCollapsibleOpenKeys.clear();
        const nodes = elements.messages.querySelectorAll("details.trace-collapsible[data-trace-key]");
        nodes.forEach((node) => {
          if (!node.open) {
            return;
          }
          const key = node.getAttribute("data-trace-key");
          if (key) {
            traceCollapsibleOpenKeys.add(key);
          }
        });
      }

      function forceCollapseToolResultBubbles() {
        const nodes = elements.messages.querySelectorAll("details.trace-collapsible.trace-collapsible-tool-result[open]");
        nodes.forEach((node) => {
          try {
            node.open = false;
            node.removeAttribute("open");
          } catch {
            // ignore
          }
        });
      }

      function isWarningOrErrorMessage(message) {
        if (!message || (message.role !== "trace" && message.role !== "system")) {
          return false;
        }
        const presentation = getTracePresentation(message.content || "");
        return Boolean(
          presentation
          && (presentation.type === "warning" || presentation.type === "error")
        );
      }

      function normalizeDuplicateMessageContent(content) {
        return typeof content === "string"
          ? content.replace(/\\r\\n/g, "\\n").trim()
          : "";
      }

      function hasExistingMessageId(message) {
        const id = message && typeof message.id === "string" ? message.id : "";
        return Boolean(
          id
          && Array.isArray(state.messages)
          && state.messages.some((existing) => existing && existing.id === id)
        );
      }

      function findExistingMessageIndexById(messageId) {
        if (!messageId || !Array.isArray(state.messages)) {
          return -1;
        }
        return state.messages.findIndex((existing) => existing && existing.id === messageId);
      }

      function isNearDuplicateWarningOrErrorMessage(message, last) {
        if (!message || !last) {
          return false;
        }
        if (message.role !== last.role || (message.role !== "trace" && message.role !== "system")) {
          return false;
        }
        if (message.role === "trace" && (message.kind || "normal") !== (last.kind || "normal")) {
          return false;
        }
        if (!isWarningOrErrorMessage(message) || !isWarningOrErrorMessage(last)) {
          return false;
        }
        const content = normalizeDuplicateMessageContent(message.content);
        const lastContent = normalizeDuplicateMessageContent(last.content);
        if (!content || content !== lastContent) {
          return false;
        }
        const createdAt = typeof message.createdAt === "number" ? message.createdAt : Date.now();
        const lastCreatedAt = typeof last.createdAt === "number" ? last.createdAt : 0;
        return lastCreatedAt > 0 && Math.abs(createdAt - lastCreatedAt) <= DUPLICATE_STATUS_TRACE_WINDOW_MS;
      }

      function shouldShowMessageInResultOnlyMode(message, messageIndex) {
        if (!message) {
          return false;
        }
        if (message.role === "user") {
          return true;
        }
        if (isWarningOrErrorMessage(message)) {
          return true;
        }
        return message.role === "assistant" && isFinalAssistantSummaryMessage(messageIndex);
      }

      function getVisibleMessages() {
        if (!Array.isArray(state.messages) || state.messages.length === 0) {
          return [];
        }
        return state.messages
          .map((message, index) => ({ message, index }))
          .filter(({ message, index }) => {
            if (shouldHideSystemRunStatusMessage(message)) {
              return false;
            }
            if (!state.onlyShowFinalResults) {
              return true;
            }
            return shouldShowMessageInResultOnlyMode(message, index);
          });
      }

      function persistWebviewUiState() {
        try {
          vscode.setState({
            onlyShowFinalResults: state.onlyShowFinalResults,
          });
        } catch {
          // ignore
        }
      }

      function normalizeInteractiveMode(value) {
        if (value === "lobster") {
          return value;
        }
        return "coding";
      }

      function getMessageTaskRoleLabel(message) {
        if (!message || message.taskRole !== "main" && message.taskRole !== "subtask") {
          return "";
        }
        if (message.taskRole === "main") {
          return t("taskRoleMain");
        }
        const round = typeof message.lobsterRound === "number" && Number.isFinite(message.lobsterRound)
          ? Math.floor(message.lobsterRound)
          : 0;
        if (round > 0) {
          return t("taskRoleSubtaskWithRound", { round });
        }
        return t("taskRoleSubtask");
      }

      function createMessageTaskRoleElement(message) {
        const label = getMessageTaskRoleLabel(message);
        if (!label) {
          return null;
        }
        const badge = document.createElement("div");
        badge.className = "message-task-role message-task-role-" + message.taskRole;
        badge.textContent = label;
        return badge;
      }

      function applyMessageElementClasses(wrapper, message, index) {
        wrapper.className = "message " + message.role;
        const tracePresentation = getTracePresentation(message.content || "");
        const shouldUseTraceWrapper = message.role === "trace" || tracePresentation.type === "tool-result";
        if (shouldUseTraceWrapper) {
          wrapper.classList.add("trace");
          const isThinkingTrace = message.kind === "thinking" || tracePresentation.type === "thinking";
          wrapper.classList.add(isThinkingTrace ? "trace-thinking" : "trace-nonthinking");
          if (tracePresentation.type) {
            wrapper.classList.add("trace-type-" + tracePresentation.type);
          }
          if (tracePresentation.commandTag && tracePresentation.commandTag.type) {
            wrapper.classList.add("trace-command-purpose-" + tracePresentation.commandTag.type);
          }
        }
        if (message.role === "assistant" && isFinalAssistantSummaryMessage(index)) {
          wrapper.classList.add("message-final-summary");
        }
      }

      function normalizeMessageAction(action) {
        if (!action || typeof action !== "object") {
          return null;
        }
        if (action.type === "openLobsterDebateChat") {
          const taskId = normalizeLobsterTaskId(action.taskId);
          if (!taskId) {
            return null;
          }
          const roundKey = typeof action.roundKey === "string" && action.roundKey.trim()
            ? action.roundKey.trim()
            : "";
          const label = typeof action.label === "string" && action.label.trim()
            ? action.label.trim()
            : t("openLobsterDebateChatAction");
          return {
            type: "openLobsterDebateChat",
            taskId,
            roundKey,
            label,
          };
        }
        return null;
      }

      function normalizeMessageActions(message) {
        const actions = Array.isArray(message && message.actions) ? message.actions : [];
        return actions
          .map((action) => normalizeMessageAction(action))
          .filter(Boolean);
      }

      function handleMessageAction(action) {
        if (!action || action.type !== "openLobsterDebateChat" || !action.taskId) {
          return;
        }
        vscode.postMessage({
          type: "openLobsterDebateChat",
          taskId: action.taskId,
          roundKey: action.roundKey || undefined,
        });
      }

      function createMessageActionsElement(message) {
        const actions = normalizeMessageActions(message);
        if (!actions.length) {
          return null;
        }
        const wrapper = document.createElement("div");
        wrapper.className = "message-actions";
        actions.forEach((action) => {
          const button = document.createElement("button");
          button.type = "button";
          button.className = "message-action-link";
          button.textContent = action.label;
          button.title = action.type === "openLobsterDebateChat"
            ? t("openLobsterDebateChatActionTitle")
            : action.label;
          button.addEventListener("click", () => {
            handleMessageAction(action);
          });
          wrapper.appendChild(button);
        });
        return wrapper;
      }

      function createMessageElement(message, index) {
        const wrapper = document.createElement("div");
        applyMessageElementClasses(wrapper, message, index);
        if (message && message.id) {
          wrapper.dataset.messageId = message.id;
        }

        const bubble = document.createElement("div");
        bubble.className = "bubble";
        bubble.innerHTML = safelyRenderMessageContent(message, index);
        const actions = createMessageActionsElement(message);
        if (actions) {
          bubble.appendChild(actions);
        }

        if (message.role === "user" && message.createdAt) {
          const time = document.createElement("div");
          time.className = "message-time";
          time.textContent = formatDateTime(message.createdAt);
          wrapper.appendChild(time);
        }
        const taskRoleBadge = createMessageTaskRoleElement(message);
        if (taskRoleBadge) {
          wrapper.appendChild(taskRoleBadge);
        }
        wrapper.appendChild(bubble);
        return wrapper;
      }

      function findRenderedMessageElement(messageId) {
        if (!messageId || !elements.messages) {
          return null;
        }
        const children = Array.from(elements.messages.children);
        for (let index = 0; index < children.length; index += 1) {
          const child = children[index];
          if (child && child.dataset && child.dataset.messageId === messageId) {
            return child;
          }
        }
        return null;
      }

      function updateRenderedAssistantMessage(message, index) {
        if (!message || message.role !== "assistant" || !message.id) {
          return false;
        }
        const wrapper = findRenderedMessageElement(message.id);
        if (!wrapper) {
          return false;
        }
        applyMessageElementClasses(wrapper, message, index);
        const oldBadge = wrapper.querySelector(".message-task-role");
        if (oldBadge) {
          oldBadge.remove();
        }
        const bubble = wrapper.querySelector(".bubble");
        if (!bubble) {
          return false;
        }
        const nextBadge = createMessageTaskRoleElement(message);
        if (nextBadge) {
          wrapper.insertBefore(nextBadge, bubble);
        }
        bubble.innerHTML = safelyRenderMessageContent(message, index);
        return true;
      }

      function renderMessages() {
        try {
          const shouldAutoScroll = !elements.messages.childElementCount || shouldFollowLatestMessagesForActiveTab() || isChatNearBottom();
          captureOpenTraceCollapsibleKeys();
          elements.messages.innerHTML = "";
          const visibleMessages = getVisibleMessages();
          visibleMessages.forEach(({ message, index }) => {
            elements.messages.appendChild(createMessageElement(message, index));
          });

          forceCollapseToolResultBubbles();
          elements.emptyState.style.display = visibleMessages.length === 0 ? "block" : "none";
          updateRunWait();
          if (shouldAutoScroll) {
            stickChatToBottom("auto");
          } else {
            updateScrollToBottomButton();
          }
          updateTaskList();
        } catch (error) {
          reportWebviewFailure("renderMessages-failed", error, {
            activeTabId: getActiveConversationTabId(),
            messageCount: Array.isArray(state.messages) ? state.messages.length : -1,
          });
          elements.messages.innerHTML = '<div class="message system"><div class="bubble"><div class="system-line"><span class="system-text">' + escapeHtml(t("session.loadFailedMessage")) + '</span></div></div></div>';
          elements.emptyState.style.display = "none";
        }
      }

      function normalizeMessageOrder(messages) {
        if (!Array.isArray(messages) || messages.length <= 1) {
          return Array.isArray(messages) ? messages : [];
        }
        const entries = messages.map((message, index) => ({ message, index }));
        const allHaveSequence = entries.every((entry) => typeof entry.message.sequence === "number");
        if (!allHaveSequence) {
          return messages;
        }
        return entries
          .slice()
          .sort((a, b) => (a.message.sequence - b.message.sequence) || (a.index - b.index))
          .map((entry) => entry.message);
      }

      function getActiveConversationTabId() {
        return state.conversationTabs ? state.conversationTabs.activeTabId : null;
      }

      function getConversationTabSummary(tabId) {
        if (!tabId || !state.conversationTabs || !Array.isArray(state.conversationTabs.tabs)) {
          return null;
        }
        return state.conversationTabs.tabs.find((tab) => tab && tab.id === tabId) || null;
      }

      function isActiveConversationTabResetLocked() {
        const activeTabId = getActiveConversationTabId();
        if (isTabRunning(activeTabId)) {
          return true;
        }
        return isLobsterMainTabCloseLocked(getConversationTabSummary(activeTabId));
      }

      function normalizeLobsterTaskRole(value) {
        return value === "main" || value === "subtask" ? value : "";
      }

      function normalizeLobsterTaskId(value) {
        if (typeof value !== "string") {
          return "";
        }
        return value.trim();
      }

      function setLobsterMetaForTab(tabId, role, taskId) {
        if (!tabId || typeof tabId !== "string") {
          return false;
        }
        const normalizedRole = normalizeLobsterTaskRole(role);
        const normalizedTaskId = normalizeLobsterTaskId(taskId);
        const hadMeta = Object.prototype.hasOwnProperty.call(lobsterMetaByTabId, tabId);
        const previous = hadMeta ? lobsterMetaByTabId[tabId] : undefined;
        if (!normalizedRole || !normalizedTaskId) {
          if (!hadMeta) {
            return false;
          }
          delete lobsterMetaByTabId[tabId];
          return true;
        }
        if (
          previous
          && previous !== null
          && previous.taskRole === normalizedRole
          && previous.lobsterTaskId === normalizedTaskId
        ) {
          return false;
        }
        lobsterMetaByTabId[tabId] = {
          taskRole: normalizedRole,
          lobsterTaskId: normalizedTaskId,
        };
        return true;
      }

      function overrideLobsterMetaAsCleared(tabId) {
        if (!tabId || typeof tabId !== "string") {
          return false;
        }
        if (Object.prototype.hasOwnProperty.call(lobsterMetaByTabId, tabId) && lobsterMetaByTabId[tabId] === null) {
          return false;
        }
        lobsterMetaByTabId[tabId] = null;
        return true;
      }

      function updateLobsterMetaForTabFromSummary(tab) {
        if (!tab || !tab.id) {
          return false;
        }
        if (
          Object.prototype.hasOwnProperty.call(lobsterMetaByTabId, tab.id)
          && lobsterMetaByTabId[tab.id] === null
        ) {
          // Keep local explicit clear marker to avoid stale backend state re-adding prefix.
          return false;
        }
        const taskRole = normalizeLobsterTaskRole(tab.lobsterTaskRole);
        const lobsterTaskId = normalizeLobsterTaskId(tab.lobsterTaskId);
        if (!taskRole || !lobsterTaskId) {
          return false;
        }
        return setLobsterMetaForTab(tab.id, taskRole, lobsterTaskId);
      }

      function updateLobsterMetaForTabFromMessage(tabId, message) {
        if (!tabId || !message || typeof message !== "object") {
          return false;
        }
        const taskRole = normalizeLobsterTaskRole(message.taskRole);
        const lobsterTaskId = normalizeLobsterTaskId(message.lobsterTaskId);
        if (!taskRole || !lobsterTaskId) {
          if (message.role === "user" && String(message.content || "").trim()) {
            return overrideLobsterMetaAsCleared(tabId);
          }
          return false;
        }
        return setLobsterMetaForTab(tabId, taskRole, lobsterTaskId);
      }

      function updateLobsterMetaForTabFromMessages(tabId, messages) {
        if (!tabId || !Array.isArray(messages)) {
          return false;
        }
        for (let index = messages.length - 1; index >= 0; index -= 1) {
          const message = messages[index];
          const role = normalizeLobsterTaskRole(message && message.taskRole);
          const taskId = normalizeLobsterTaskId(message && message.lobsterTaskId);
          if (!role || !taskId) {
            if (message && message.role === "user" && String(message.content || "").trim()) {
              return overrideLobsterMetaAsCleared(tabId);
            }
            continue;
          }
          return setLobsterMetaForTab(tabId, role, taskId);
        }
        if (!Object.prototype.hasOwnProperty.call(lobsterMetaByTabId, tabId)) {
          return false;
        }
        delete lobsterMetaByTabId[tabId];
        return true;
      }

      function getLobsterMetaForTabSummary(tab) {
        const tabId = tab && typeof tab.id === "string" ? tab.id : "";
        if (tabId && Object.prototype.hasOwnProperty.call(lobsterMetaByTabId, tabId)) {
          const fromRuntime = lobsterMetaByTabId[tabId];
          if (fromRuntime === null) {
            return null;
          }
          if (fromRuntime && fromRuntime.taskRole && fromRuntime.lobsterTaskId) {
            return fromRuntime;
          }
        }
        const taskRole = normalizeLobsterTaskRole(tab && tab.lobsterTaskRole);
        const lobsterTaskId = normalizeLobsterTaskId(tab && tab.lobsterTaskId);
        if (!taskRole || !lobsterTaskId) {
          return null;
        }
        return {
          taskRole,
          lobsterTaskId,
        };
      }

      function isLobsterMainTabCloseLocked(tab) {
        const meta = getLobsterMetaForTabSummary(tab);
        if (!meta || meta.taskRole !== "main" || !meta.lobsterTaskId) {
          return false;
        }
        const tabs = state.conversationTabs && Array.isArray(state.conversationTabs.tabs)
          ? state.conversationTabs.tabs
          : [];
        for (let index = 0; index < tabs.length; index += 1) {
          const candidate = tabs[index];
          if (!candidate || !isTabRunning(candidate.id)) {
            continue;
          }
          const candidateMeta = getLobsterMetaForTabSummary(candidate);
          if (candidateMeta && candidateMeta.lobsterTaskId === meta.lobsterTaskId) {
            return true;
          }
        }
        return Boolean(tab && tab.lobsterMainTabCloseLocked);
      }

      function isLobsterMainTab(tab) {
        const meta = getLobsterMetaForTabSummary(tab);
        return Boolean(meta && meta.taskRole === "main");
      }

      function shouldForceFollowLatestMessagesForActiveTab() {
        const activeTab = getConversationTabSummary(getActiveConversationTabId());
        return isLobsterMainTab(activeTab) && isLobsterMainTabCloseLocked(activeTab);
      }

      function shouldFollowLatestMessagesForActiveTab() {
        return followLatestMessages || shouldForceFollowLatestMessagesForActiveTab();
      }

      function resolveAutoInteractiveModeForTab(tab) {
        const meta = getLobsterMetaForTabSummary(tab);
        if (meta && (meta.taskRole === "main" || meta.taskRole === "subtask")) {
          return "lobster";
        }
        return "coding";
      }

      function applyAutoInteractiveModeForTab(tab) {
        const nextMode = resolveAutoInteractiveModeForTab(tab);
        if (state.interactiveMode === nextMode) {
          return false;
        }
        state.interactiveMode = nextMode;
        if (elements.interactiveModeSelect) {
          elements.interactiveModeSelect.value = nextMode;
        }
        syncModelSelectorByInteractiveMode();
        return true;
      }

      function isTabRunning(tabId) {
        if (!tabId || typeof tabId !== "string") {
          return false;
        }
        return typeof runningTabStartedAtById[tabId] === "number";
      }

      function isTabErrored(tabId) {
        return Boolean(tabId && typeof tabId === "string" && erroredTabIds.has(tabId));
      }

      function setTabErrored(tabId, errored) {
        if (!tabId || typeof tabId !== "string") {
          return;
        }
        const wasErrored = erroredTabIds.has(tabId);
        if (wasErrored === Boolean(errored)) {
          return;
        }
        if (errored) {
          erroredTabIds.add(tabId);
        } else {
          erroredTabIds.delete(tabId);
        }
        renderConversationTabs();
      }

      function isHiddenRetryQueuedMessage(content) {
        const normalized = String(content || "").trim();
        if (!normalized) {
          return false;
        }
        return /^任务已中断，将在\\s*.+\\s*后开始第\\s*\\d+\\s*\\/\\s*\\d+\\s*次自动重试。?$/.test(normalized)
          || /^task interrupted\\. automatic retry\\s+\\d+\\s*\\/\\s*\\d+\\s+will start in\\s+.+\\.$/i.test(normalized);
      }

      function isHiddenRetryStartedMessage(content) {
        const normalized = String(content || "").trim();
        if (!normalized) {
          return false;
        }
        return /^第\\s*\\d+\\s*\\/\\s*\\d+\\s*次自动重试已开始。?$/.test(normalized)
          || /^automatic retry\\s+\\d+\\s*\\/\\s*\\d+\\s+started\\.$/i.test(normalized);
      }

      function getTabRunStartedAt(tabId) {
        if (!tabId || typeof tabId !== "string") {
          return 0;
        }
        const value = runningTabStartedAtById[tabId];
        return typeof value === "number" ? value : 0;
      }

      function shouldHandleTabScopedEvent(data) {
        const eventTabId = data && typeof data.tabId === "string" ? data.tabId : null;
        if (!eventTabId) {
          return true;
        }
        const activeTabId = getActiveConversationTabId();
        return !activeTabId || eventTabId === activeTabId;
      }

      function syncConversationControlsForActiveTab() {
        updateQueueIndicator();
        updateRunPromptButton();
        updateRunStreamButton();
        syncRunConflictOverlay();
        syncQueueOverlay();
        syncRunPromptOverlay();
        syncRunStreamOverlay();
        syncResetSessionAvailability();
      }

      function syncRunningStateForActiveTab() {
        const activeTabId = getActiveConversationTabId();
        const isRunningOnActiveTab = isTabRunning(activeTabId);
        updateRunningState(isRunningOnActiveTab, {
          preserveRunArtifacts: true,
          startedAt: isRunningOnActiveTab ? getTabRunStartedAt(activeTabId) : 0,
        });
        syncConversationControlsForActiveTab();
      }

      function getConversationTabPageCount(totalCount) {
        const normalizedCount = Number.isFinite(totalCount) ? Math.max(0, Math.floor(totalCount)) : 0;
        return Math.max(1, Math.ceil(normalizedCount / CONVERSATION_TAB_PAGE_SIZE));
      }

      function clampConversationTabPageIndex(nextPageIndex, totalCount) {
        const pageCount = getConversationTabPageCount(totalCount);
        const normalized = Number.isFinite(nextPageIndex) ? Math.floor(nextPageIndex) : 0;
        if (normalized < 0) {
          return 0;
        }
        if (normalized >= pageCount) {
          return pageCount - 1;
        }
        return normalized;
      }

      function getConversationTabPageForTabIndex(tabIndex) {
        if (!Number.isFinite(tabIndex) || tabIndex < 0) {
          return 0;
        }
        return Math.floor(tabIndex / CONVERSATION_TAB_PAGE_SIZE);
      }

      function setConversationTabPageIndex(nextPageIndex, totalCount) {
        conversationTabPageIndex = clampConversationTabPageIndex(nextPageIndex, totalCount);
        return conversationTabPageIndex;
      }

      function createConversationTabPagerButton(direction, disabled, onClick) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "icon-button conversation-tabs-nav conversation-tabs-nav-" + direction;
        button.textContent = direction === "prev" ? "<" : ">";
        button.disabled = Boolean(disabled);
        const ariaKey = direction === "prev" ? "conversationTabsPrevPage" : "conversationTabsNextPage";
        const ariaLabel = t(ariaKey);
        button.title = ariaLabel;
        button.setAttribute("aria-label", ariaLabel);
        button.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          if (button.disabled) {
            return;
          }
          onClick();
        });
        return button;
      }

      function renderConversationTabs() {
        if (!elements.conversationTabs) {
          return;
        }
        const tabs = state.conversationTabs && Array.isArray(state.conversationTabs.tabs)
          ? state.conversationTabs.tabs
          : [];
        const activeTabId = state.conversationTabs ? state.conversationTabs.activeTabId : null;
        elements.conversationTabs.innerHTML = "";
        const showTabs = tabs.length > 0;
        elements.conversationTabs.classList.toggle("visible", showTabs);
        if (!showTabs) {
          conversationTabPageIndex = 0;
          conversationTabPageAnchorTabId = activeTabId;
          return;
        }
        const activeTabIndex = tabs.findIndex((tab) => tab && tab.id === activeTabId);
        const activeTabChanged = activeTabId !== conversationTabPageAnchorTabId;
        if (activeTabChanged) {
          const activePageIndex = getConversationTabPageForTabIndex(activeTabIndex);
          setConversationTabPageIndex(activePageIndex, tabs.length);
        } else {
          setConversationTabPageIndex(conversationTabPageIndex, tabs.length);
        }
        conversationTabPageAnchorTabId = activeTabId;
        const showPager = tabs.length > CONVERSATION_TAB_PAGE_SIZE;
        const pageCount = getConversationTabPageCount(tabs.length);
        const pageStartIndex = conversationTabPageIndex * CONVERSATION_TAB_PAGE_SIZE;
        const pageEndIndex = pageStartIndex + CONVERSATION_TAB_PAGE_SIZE;

        if (showPager) {
          const prevButton = createConversationTabPagerButton(
            "prev",
            conversationTabPageIndex <= 0,
            () => {
              setConversationTabPageIndex(conversationTabPageIndex - 1, tabs.length);
              renderConversationTabs();
            },
          );
          elements.conversationTabs.appendChild(prevButton);
        }

        const tabTrack = document.createElement("div");
        tabTrack.className = "conversation-tabs-track";
        const groupIndexes = Object.create(null);

        tabs.forEach((tab, index) => {
          const cliLabel = typeof tab.cli === "string" && tab.cli ? tab.cli : "session";
          const groupIndex = (groupIndexes[cliLabel] || 0) + 1;
          groupIndexes[cliLabel] = groupIndex;
          if (index < pageStartIndex || index >= pageEndIndex) {
            return;
          }
          const tabItem = document.createElement("div");
          tabItem.className = "conversation-tab";
          const isActive = tab.id === activeTabId;
          if (isActive) {
            tabItem.classList.add("active");
          }
          if (isTabErrored(tab.id)) {
            tabItem.classList.add("errored");
          } else if (isTabRunning(tab.id)) {
            tabItem.classList.add("running");
          }
          tabItem.setAttribute("role", "tab");
          tabItem.setAttribute("aria-selected", String(isActive));
          tabItem.setAttribute("tabindex", isActive ? "0" : "-1");
          tabItem.setAttribute("aria-disabled", "false");

          const tabBaseLabel = groupIndex > 1 ? (cliLabel + String(groupIndex)) : cliLabel;
          const labelText = isLobsterMainTab(tab) ? ("🦞 " + tabBaseLabel) : tabBaseLabel;
          const label = document.createElement("span");
          label.className = "conversation-tab-label";
          label.textContent = labelText;
          tabItem.appendChild(label);

          if (tabs.length > 1) {
            const closeButton = document.createElement("button");
            closeButton.type = "button";
            closeButton.className = "conversation-tab-close";
            closeButton.textContent = "×";
            closeButton.title = t("conversationTabCloseAria", { label: labelText });
            closeButton.setAttribute("aria-label", t("conversationTabCloseAria", { label: labelText }));
            closeButton.disabled = isTabRunning(tab.id) || isLobsterMainTabCloseLocked(tab);
            closeButton.addEventListener("click", (event) => {
              event.preventDefault();
              event.stopPropagation();
              vscode.postMessage({ type: "closeConversationTab", tabId: tab.id, cli: tab.cli });
            });
            tabItem.appendChild(closeButton);
          }

          const selectTab = () => {
            if (tab.id === activeTabId) {
              return;
            }
            applyAutoInteractiveModeForTab(tab);
            if (state.conversationTabs) {
              state.conversationTabs.activeTabId = tab.id;
            }
            syncActiveMessagesFromRuntime();
            syncRunningStateForActiveTab();
            armPromptContextForConversationStart();
            vscode.postMessage({ type: "selectConversationTab", tabId: tab.id, cli: tab.cli });
          };

          tabItem.addEventListener("click", () => {
            selectTab();
          });
          tabItem.addEventListener("keydown", (event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              selectTab();
            }
          });

          tabTrack.appendChild(tabItem);
        });
        elements.conversationTabs.appendChild(tabTrack);
        if (showPager) {
          const nextButton = createConversationTabPagerButton(
            "next",
            conversationTabPageIndex >= pageCount - 1,
            () => {
              setConversationTabPageIndex(conversationTabPageIndex + 1, tabs.length);
              renderConversationTabs();
            },
          );
          elements.conversationTabs.appendChild(nextButton);
        }
      }

      function buildHistorySessionKey(cli, sessionId) {
        return String(cli || "") + ":" + String(sessionId || "");
      }

      function isHistorySessionExportPending(session) {
        return Boolean(
          session
          && historySessionExportPendingKey
          && historySessionExportPendingKey === buildHistorySessionKey(session.cli, session.id)
        );
      }

      function resetHistorySessionMessagesState() {
        state.historySessionMessages = {
          cli: "",
          sessionId: "",
          resolvedSessionId: "",
          label: "",
          createdAt: 0,
          messages: [],
          loading: false,
          error: "",
        };
      }

      function normalizeHistorySessionMessages(messages) {
        const ordered = normalizeMessageOrder(Array.isArray(messages) ? messages : []);
        return ordered.filter((message) => {
          return message
            && typeof message === "object"
            && typeof message.content === "string"
            && message.content.trim();
        });
      }

      function resolveHistoryMessageRoleLabel(role) {
        if (role === "user") {
          return t("historySessionMessageUser");
        }
        if (role === "assistant") {
          return t("historySessionMessageAssistant");
        }
        if (role === "trace") {
          return t("historySessionMessageTrace");
        }
        return t("historySessionMessageSystem");
      }

      function resolveHistoryMessageKindLabel(kind) {
        if (kind === "thinking") {
          return t("historySessionMessageThinking");
        }
        if (kind === "tool-use") {
          return t("historySessionMessageToolUse");
        }
        return "";
      }

      function renderHistoryMessage(message, index) {
        const item = document.createElement("div");
        item.className = "history-message-item";

        const header = document.createElement("div");
        header.className = "history-message-header";

        const role = document.createElement("span");
        role.className = "history-message-role";
        role.textContent = (index + 1) + ". " + resolveHistoryMessageRoleLabel(message.role);
        header.appendChild(role);

        const kindLabel = resolveHistoryMessageKindLabel(message.kind);
        if (kindLabel) {
          const kind = document.createElement("span");
          kind.className = "history-message-kind";
          kind.textContent = kindLabel;
          header.appendChild(kind);
        }

        if (typeof message.createdAt === "number") {
          const time = document.createElement("span");
          time.className = "history-message-time";
          time.textContent = formatDateTimeWithMs(message.createdAt);
          header.appendChild(time);
        }

        const content = document.createElement("pre");
        content.className = "history-message-content";
        content.textContent = message.content || "";

        item.appendChild(header);
        item.appendChild(content);
        return item;
      }

      function updateHistoryMessagesExportButton() {
        if (!elements.exportHistoryMessages) {
          return;
        }
        const active = state.historySessionMessages || {};
        const key = buildHistorySessionKey(active.cli, active.sessionId);
        const isPending = Boolean(historySessionExportPendingKey && historySessionExportPendingKey === key);
        const hasPendingExport = Boolean(historySessionExportPendingKey);
        const hasMessages = Array.isArray(active.messages) && active.messages.length > 0;
        elements.exportHistoryMessages.disabled = Boolean(active.loading || hasPendingExport || !active.sessionId || !hasMessages);
        elements.exportHistoryMessages.textContent = isPending
          ? t("historySessionExporting")
          : t("historySessionExportLabel");
      }

      function renderHistorySessionMessages() {
        if (!elements.historyMessagesContent) {
          return;
        }
        const active = state.historySessionMessages || {};
        const label = active.label || t("historySessionMessagesUnknown");
        if (elements.historyMessagesTitle) {
          elements.historyMessagesTitle.textContent = t("historySessionMessagesTitle");
        }
        if (elements.historyMessagesSubtitle) {
          const timeLabel = active.createdAt ? formatDateTime(active.createdAt) : "";
          elements.historyMessagesSubtitle.textContent = active.cli
            ? t("historySessionMessagesMeta", { cli: active.cli, time: timeLabel || "-" }) + " · " + label
            : label;
        }
        if (elements.historyMessagesStatus) {
          elements.historyMessagesStatus.textContent = active.error
            ? active.error
            : active.loading
              ? t("historySessionMessagesLoading")
              : "";
        }

        elements.historyMessagesContent.innerHTML = "";
        const messages = Array.isArray(active.messages) ? active.messages : [];
        if (active.loading || !messages.length) {
          elements.historyMessagesContent.classList.add("history-messages-empty");
          elements.historyMessagesContent.textContent = active.loading
            ? t("historySessionMessagesLoading")
            : t("historySessionMessagesEmpty");
          updateHistoryMessagesExportButton();
          return;
        }

        elements.historyMessagesContent.classList.remove("history-messages-empty");
        const list = document.createElement("div");
        list.className = "history-message-list";
        messages.forEach((message, index) => {
          list.appendChild(renderHistoryMessage(message, index));
        });
        elements.historyMessagesContent.appendChild(list);
        updateHistoryMessagesExportButton();
      }

      function openHistorySessionMessages(session) {
        if (!session || !session.id || !session.cli) {
          return;
        }
        const label = session.firstPrompt || session.label || t("sessionDefaultLabel");
        state.historySessionMessages = {
          cli: session.cli,
          sessionId: session.id,
          resolvedSessionId: "",
          label,
          createdAt: session.createdAt || 0,
          messages: [],
          loading: true,
          error: "",
        };
        if (elements.historyMessagesOverlay) {
          elements.historyMessagesOverlay.classList.add("visible");
        }
        renderHistorySessionMessages();
        vscode.postMessage({
          type: "loadHistorySessionMessages",
          cli: session.cli,
          sessionId: session.id,
        });
      }

      function closeHistorySessionMessages() {
        if (elements.historyMessagesOverlay) {
          elements.historyMessagesOverlay.classList.remove("visible");
        }
        resetHistorySessionMessagesState();
        updateHistoryMessagesExportButton();
      }

      function requestHistorySessionExport(session) {
        const target = session || state.historySessionMessages;
        if (!target || !target.cli || !target.sessionId && !target.id) {
          return;
        }
        const sessionId = target.sessionId || target.id;
        const cli = target.cli;
        const key = buildHistorySessionKey(cli, sessionId);
        if (historySessionExportPendingKey) {
          return;
        }
        historySessionExportPendingKey = key;
        renderSessionList();
        updateHistoryMessagesExportButton();
        vscode.postMessage({
          type: "exportHistorySessionMessages",
          cli,
          sessionId,
        });
      }

      function handleHistorySessionMessages(data) {
        const active = state.historySessionMessages || {};
        const incomingKey = buildHistorySessionKey(data.cli, data.sessionId);
        const activeKey = buildHistorySessionKey(active.cli, active.sessionId);
        if (incomingKey !== activeKey) {
          return;
        }
        const error = typeof data.error === "string" ? data.error.trim() : "";
        state.historySessionMessages = Object.assign({}, active, {
          resolvedSessionId: typeof data.resolvedSessionId === "string" ? data.resolvedSessionId : "",
          messages: normalizeHistorySessionMessages(data.messages),
          loading: false,
          error,
        });
        if (error) {
          showToast(t("toastHistorySessionLoadFailed", { error }));
        }
        renderHistorySessionMessages();
      }

      function handleHistorySessionExportResult(data) {
        const resultKey = buildHistorySessionKey(data.cli, data.sessionId);
        if (historySessionExportPendingKey && historySessionExportPendingKey !== resultKey) {
          return;
        }
        historySessionExportPendingKey = "";
        renderSessionList();
        updateHistoryMessagesExportButton();
        const error = typeof data.error === "string" ? data.error.trim() : "";
        if (error) {
          const isEmpty = error === t("toastHistorySessionExportEmpty");
          showToast(isEmpty
            ? t("toastHistorySessionExportEmpty")
            : t("toastHistorySessionExportFailed", { error }));
          return;
        }
        const exportPath = typeof data.path === "string" && data.path
          ? data.path
          : typeof data.fileName === "string"
            ? data.fileName
            : "";
        showToast(t("toastHistorySessionExportSuccess", { path: exportPath }));
      }

      function renderSessionList() {
        elements.sessionList.innerHTML = "";
        if (!state.sessionState.sessions.length) {
          const empty = document.createElement("div");
          empty.className = "empty-state";
          empty.textContent = t("historyEmptySessions");
          elements.sessionList.appendChild(empty);
          return;
        }
        state.sessionState.sessions.forEach((session) => {
          const item = document.createElement("div");
          item.className = "session-item";

          const info = document.createElement("div");
          info.className = "session-info";

          const titleRow = document.createElement("div");
          titleRow.className = "session-title-row";

          const label = document.createElement("div");
          label.className = "session-label";
          const cliLabel = session.cli ? "[" + session.cli + "] " : "";
          const sessionPromptPreview = buildPromptPreview(session.firstPrompt || session.label || t("sessionDefaultLabel"));
          label.textContent = cliLabel + sessionPromptPreview;
          if (session.firstPrompt) {
            label.title = session.firstPrompt;
          } else {
            label.title = session.label || t("sessionDefaultLabel");
          }

          titleRow.appendChild(label);
          if (session.isOpenInConversationTabs) {
            const badge = document.createElement("span");
            badge.className = "session-status-badge";
            badge.textContent = t("sessionOpenInTabsLabel");
            titleRow.appendChild(badge);
          }

          const subtitle = document.createElement("div");
          subtitle.className = "session-subtitle";
          subtitle.textContent = session.createdAt ? formatDateTime(session.createdAt) : "";

          info.appendChild(titleRow);
          info.appendChild(subtitle);

          const actions = document.createElement("div");
          actions.className = "session-actions";

          const messagesButton = document.createElement("button");
          messagesButton.className = "secondary";
          messagesButton.textContent = t("historySessionViewLabel");
          messagesButton.addEventListener("click", () => {
            openHistorySessionMessages(session);
          });

          const loadButton = document.createElement("button");
          loadButton.className = "secondary";
          loadButton.textContent = t("sessionLoadLabel");
          loadButton.addEventListener("click", () => {
            closeHistory();
            armPromptContextForConversationStart();
            if (session.openConversationTabId) {
              vscode.postMessage({
                type: "selectConversationTab",
                tabId: session.openConversationTabId,
                cli: session.cli,
              });
              return;
            }
            vscode.postMessage({ type: "selectSession", sessionId: session.id, cli: session.cli });
          });

          const exportButton = document.createElement("button");
          exportButton.className = "secondary";
          exportButton.textContent = isHistorySessionExportPending(session)
            ? t("historySessionExporting")
            : t("historySessionExportLabel");
          exportButton.disabled = Boolean(historySessionExportPendingKey);
          exportButton.addEventListener("click", () => {
            requestHistorySessionExport(session);
          });

          const deleteButton = document.createElement("button");
          deleteButton.className = "ghost";
          deleteButton.textContent = t("sessionDeleteLabel");
          deleteButton.addEventListener("click", () => {
            vscode.postMessage({ type: "deleteSession", sessionId: session.id, cli: session.cli });
          });

          actions.appendChild(messagesButton);
          actions.appendChild(loadButton);
          actions.appendChild(exportButton);
          actions.appendChild(deleteButton);
          item.appendChild(info);
          item.appendChild(actions);
          elements.sessionList.appendChild(item);
        });
      }

      function renderLobsterGroupChatHistoryList() {
        if (!elements.lobsterGroupChatHistoryList) {
          return;
        }
        elements.lobsterGroupChatHistoryList.innerHTML = "";
        const items = Array.isArray(state.lobsterGroupChatHistory) ? state.lobsterGroupChatHistory : [];
        if (!items.length) {
          const empty = document.createElement("div");
          empty.className = "empty-state";
          empty.textContent = t("historyEmptyLobsterGroupChats");
          elements.lobsterGroupChatHistoryList.appendChild(empty);
          return;
        }
        items.forEach((item) => {
          const wrapper = document.createElement("div");
          wrapper.className = "session-item";

          const info = document.createElement("div");
          info.className = "session-info";

          const titleRow = document.createElement("div");
          titleRow.className = "session-title-row";

          const label = document.createElement("div");
          label.className = "session-label";
          const cliLabel = item.cli ? "[" + item.cli + "] " : "";
          const promptPreview = buildPromptPreview(item.rootPrompt || item.id || "");
          label.textContent = cliLabel + promptPreview;
          label.title = item.rootPrompt || item.id || "";
          titleRow.appendChild(label);

          const statusBadge = document.createElement("span");
          statusBadge.className = "session-status-badge";
          statusBadge.textContent = item.status || "";
          titleRow.appendChild(statusBadge);

          const subtitle = document.createElement("div");
          subtitle.className = "session-subtitle";
          subtitle.textContent = t("lobsterHistoryMeta", {
            mode: formatLobsterHistoryMode(item),
            round: item.currentRound || 0,
            time: item.updatedAt ? formatDateTime(item.updatedAt) : "",
          });

          info.appendChild(titleRow);
          info.appendChild(subtitle);

          const actions = document.createElement("div");
          actions.className = "session-actions";

          const loadButton = document.createElement("button");
          loadButton.className = "secondary";
          loadButton.textContent = t("sessionLoadLabel");
          loadButton.addEventListener("click", () => {
            closeHistory();
            vscode.postMessage({
              type: "openLobsterDebateChat",
              taskId: item.id,
            });
          });

          actions.appendChild(loadButton);
          wrapper.appendChild(info);
          wrapper.appendChild(actions);
          elements.lobsterGroupChatHistoryList.appendChild(wrapper);
        });
      }

      function formatLobsterHistoryMode(item) {
        return item && item.executionMode === "debate_multi_agent"
          ? t("lobsterHistoryModeDebate")
          : t("lobsterHistoryModeMainSub");
      }

      function renderPromptHistoryList() {
        if (!elements.promptHistoryList) {
          return;
        }
        elements.promptHistoryList.innerHTML = "";
        const items = Array.isArray(state.promptHistory) ? state.promptHistory : [];
        if (!items.length) {
          const empty = document.createElement("div");
          empty.className = "empty-state";
          empty.textContent = t("historyEmptyPrompts");
          elements.promptHistoryList.appendChild(empty);
          return;
        }
        const expandedId = state.promptHistoryExpandedId;
        if (expandedId && !items.some((item) => item.id === expandedId)) {
          state.promptHistoryExpandedId = null;
        }
        items.forEach((item) => {
          const wrapper = document.createElement("div");
          wrapper.className = "prompt-item";
          if (state.promptHistoryExpandedId === item.id) {
            wrapper.classList.add("expanded");
          }

          const header = document.createElement("div");
          header.className = "prompt-header";

          const info = document.createElement("div");
          info.className = "prompt-info";

          const preview = document.createElement("div");
          preview.className = "prompt-preview";
          preview.textContent = buildPromptPreview(item.prompt);
          preview.title = item.prompt || "";

          const meta = document.createElement("div");
          meta.className = "prompt-meta";
          const cliLabel = item.cli ? "[" + item.cli + "] " : "";
          const timeLabel = item.createdAt ? formatDateTime(item.createdAt) : "";
          meta.textContent = cliLabel + timeLabel;

          info.appendChild(preview);
          info.appendChild(meta);

          const actions = document.createElement("div");
          actions.className = "prompt-actions";

          const viewButton = document.createElement("button");
          viewButton.className = "ghost";
          viewButton.textContent = state.promptHistoryExpandedId === item.id
            ? t("promptCollapseLabel")
            : t("promptViewLabel");
          viewButton.addEventListener("click", (event) => {
            event.stopPropagation();
            togglePromptHistoryExpanded(item.id);
          });

          const useButton = document.createElement("button");
          useButton.className = "secondary";
          useButton.textContent = t("promptReuseLabel");
          useButton.addEventListener("click", (event) => {
            event.stopPropagation();
            applyPromptHistory(item.prompt || "");
          });

          actions.appendChild(viewButton);
          actions.appendChild(useButton);

          header.appendChild(info);
          header.appendChild(actions);

          const full = document.createElement("div");
          full.className = "prompt-full";
          full.textContent = item.prompt || "";

          wrapper.appendChild(header);
          wrapper.appendChild(full);

          wrapper.addEventListener("click", () => {
            togglePromptHistoryExpanded(item.id);
          });

          elements.promptHistoryList.appendChild(wrapper);
        });
      }

      function buildPromptPreview(prompt) {
        const normalized = String(prompt || "").replace(/\\s+/g, " ").trim();
        if (!normalized) {
          return t("promptEmptyLabel");
        }
        return normalized;
      }

      function togglePromptHistoryExpanded(id) {
        state.promptHistoryExpandedId = state.promptHistoryExpandedId === id ? null : id;
        renderPromptHistoryList();
      }

      function applyPromptHistory(prompt) {
        const content = String(prompt || "");
        elements.promptInput.value = content;
        const end = content.length;
        elements.promptInput.selectionStart = end;
        elements.promptInput.selectionEnd = end;
        elements.promptInput.focus();
        closeHistory();
      }

      function getFirstNonEmptyLine(text) {
        if (!text || typeof text !== "string") {
          return "";
        }
        const lines = text.split("\\n");
        for (let i = 0; i < lines.length; i += 1) {
          const trimmed = lines[i].trim();
          if (trimmed) {
            return trimmed;
          }
        }
        return "";
      }

      function getMessageCollapseThreshold() {
        return 50;
      }

      function normalizeCollapsePreviewText(content) {
        const normalized = String(content || "")
          .replace(/\\s+/g, " ")
          .trim();
        return normalized;
      }

      function shouldCollapseByContentLength(content) {
        return normalizeCollapsePreviewText(content).length >= getMessageCollapseThreshold();
      }

      function buildBubbleCollapseSummaryText(content) {
        const normalized = normalizeCollapsePreviewText(content);
        if (!normalized) {
          return "";
        }
        const limit = getMessageCollapseThreshold();
        if (normalized.length <= limit) {
          return normalized;
        }
        return normalized.slice(0, limit) + "…";
      }

      function renderCollapsibleBubbleContent(summaryText, bodyHtml, traceKey, options = {}) {
        const keyAttr = traceKey ? ' data-trace-key="' + escapeHtml(traceKey) + '"' : "";
        const extraClass = options.extraClass ? ' ' + options.extraClass : "";
        const allowRestoreOpen = options.allowRestoreOpen !== false;
        const openAttr = allowRestoreOpen && traceKey && traceCollapsibleOpenKeys.has(traceKey) ? " open" : "";
        return '<details class="trace-collapsible' + extraClass + '"' + keyAttr + openAttr + '><summary>' + escapeHtml(summaryText) + '</summary>' + bodyHtml + '</details>';
      }

      function isThinkingLikeMessage(message, presentation) {
        if (!message) {
          return false;
        }
        return message.kind === "thinking" || (presentation && presentation.type === "thinking");
      }

      function isCodexReasoningStyleMessage(message) {
        const content = String(message && message.content ? message.content : "");
        if (!content) {
          return false;
        }
        const trimmed = content.trimStart();
        if (!trimmed.startsWith("**")) {
          return false;
        }
        const titleEndIndex = trimmed.indexOf("**", 2);
        if (titleEndIndex <= 2) {
          return false;
        }
        const title = trimmed.slice(2, titleEndIndex).trim();
        if (!title || !/[A-Za-z]/.test(title)) {
          return false;
        }
        const firstWord = title.split(/\s+/)[0] || "";
        if (!/ing$/i.test(firstWord)) {
          return false;
        }
        const rest = trimmed.slice(titleEndIndex + 2);
        return /\S/.test(rest);
      }

      function isTransparentBubbleMessage(message, presentation, messageIndex) {
        if (!message) {
          return false;
        }
        if (message.role === "assistant") {
          // Assistant bubbles use the transparent style in current UI.
          return true;
        }
        if (message.role === "trace") {
          return isThinkingLikeMessage(message, presentation);
        }
        if (message.role === "system") {
          return true;
        }
        return false;
      }

      function isFileUpdateMessage(message) {
        if (!message) {
          return false;
        }
        const firstLine = getFirstNonEmptyLine(message.content || "");
        return firstLine.startsWith("file update");
      }

      function normalizeAssistantKind(kind) {
        return kind === "thinking" ? "thinking" : "normal";
      }

      function isSameAssistantKind(left, right) {
        const leftKind = left && typeof left === "object" ? left.kind : left;
        const rightKind = right && typeof right === "object" ? right.kind : right;
        return normalizeAssistantKind(leftKind) === normalizeAssistantKind(rightKind);
      }

      function appendMessage(message) {
        if (!message) {
          return;
        }
        if ((message.role === "user" || message.role === "system" || message.role === "trace") && !message.createdAt) {
          message.createdAt = Date.now();
        }
        if (hasExistingMessageId(message)) {
          return;
        }
        const last = state.messages[state.messages.length - 1];
        if (isNearDuplicateWarningOrErrorMessage(message, last)) {
          return;
        }
        const isFileUpdate = isFileUpdateMessage(message);
        const lastIsFileUpdate = last && isFileUpdateMessage(last);
        if (message.role === "assistant") {
          const canMergeAssistant = last
            && last.role === "assistant"
            && message.merge !== false
            && last.merge !== false
            && message.lobsterAnswerConclusion !== true
            && last.lobsterAnswerConclusion !== true
            && message.lobsterFinalSummary !== true
            && last.lobsterFinalSummary !== true
            && message.codexFinalAnswer !== true
            && last.codexFinalAnswer !== true
            && isSameAssistantKind(last, message)
            && last.taskRole === message.taskRole
            && !isFileUpdate
            && !lastIsFileUpdate;
          if (canMergeAssistant) {
            assistantRedirects[message.id] = last.id;
            if (message.kind === "thinking") {
              last.kind = "thinking";
            }
            if (message.content) {
              const prefix = last.content ? "\\n" : "";
              last.content = last.content + prefix + message.content;
            }
            renderMessages();
            return;
          }
          state.messages.push(message);
          assistantRedirects[message.id] = message.id;
          renderMessages();
          return;
        }
        const sameRole = last && last.role === message.role;
        const sameTraceKind = message.role !== "trace" || last.kind === message.kind;
        const isToolUseTrace = message.role === "trace" && message.kind === "tool-use";
        const allowMerge = message.merge !== false && (!last || last.merge !== false) && !isToolUseTrace;
        if (sameRole && sameTraceKind && allowMerge) {
          const prefix = last.content ? "\\n" : "";
          last.content = last.content + prefix + (message.content || "");
          renderMessages();
          return;
        }
        state.messages.push(message);
        renderMessages();
      }

      function isDuplicateSystemStatusMessage(content) {
        const normalized = typeof content === "string" ? content.trim() : "";
        if (!normalized) {
          return false;
        }
        const last = state.messages[state.messages.length - 1];
        return Boolean(
          last
          && last.role === "system"
          && typeof last.content === "string"
          && last.content.trim() === normalized
        );
      }

      function appendAssistantDelta(id, content, kind, options) {
        const shouldAutoScroll = !elements.messages.childElementCount || shouldFollowLatestMessagesForActiveTab() || isChatNearBottom();
        const resolvedId = assistantRedirects[id] || id;
        let targetIndex = state.messages.findIndex((item) => item.id === resolvedId);
        const last = state.messages[state.messages.length - 1];
        const marksCodexFinalAnswer = Boolean(options && options.codexFinalAnswer === true);
        const hasContent = Boolean(content);
        const isLastAssistant = last
          && last.role === "assistant"
          && last.id === resolvedId
          && isSameAssistantKind(last, kind);
        let requiresFullRender = false;
        if (targetIndex !== -1 && !hasContent && marksCodexFinalAnswer) {
          const target = state.messages[targetIndex];
          target.codexFinalAnswer = true;
          if (!updateRenderedAssistantMessage(target, targetIndex)) {
            renderMessages();
          }
          return;
        }
        if (targetIndex === -1 && !hasContent && marksCodexFinalAnswer) {
          return;
        }
        if (targetIndex === -1 || !isLastAssistant) {
          const newId = createMessageId();
          assistantRedirects[id] = newId;
          state.messages.push({
            id: newId,
            role: "assistant",
            content: "",
            ...(kind === "thinking" ? { kind: "thinking" } : {}),
            ...(marksCodexFinalAnswer ? { codexFinalAnswer: true } : {}),
          });
          targetIndex = state.messages.length - 1;
          requiresFullRender = true;
        }
        const target = state.messages[targetIndex];
        if (marksCodexFinalAnswer) {
          target.codexFinalAnswer = true;
        }
        if (kind === "thinking") {
          target.kind = "thinking";
        }
        target.content += content || "";
        if (requiresFullRender || !updateRenderedAssistantMessage(target, targetIndex)) {
          renderMessages();
          return;
        }
        elements.emptyState.style.display = state.messages.length === 0 ? "block" : "none";
        updateRunWait();
        if (shouldAutoScroll) {
          stickChatToBottom("auto");
        } else {
          updateScrollToBottomButton();
        }
      }

      function applyTraceSegment(data) {
        const messageId = typeof data.id === "string" && data.id ? data.id : "";
        const existingIndex = findExistingMessageIndexById(messageId);
        if (existingIndex !== -1) {
          const existing = state.messages[existingIndex];
          if (!existing || existing.role !== "trace") {
            return;
          }
          let changed = false;
          if (typeof data.content === "string" && existing.content !== data.content) {
            existing.content = data.content;
            changed = true;
          }
          if (typeof data.createdAt === "number" && existing.createdAt !== data.createdAt) {
            existing.createdAt = data.createdAt;
            changed = true;
          }
          if (typeof data.sequence === "number" && existing.sequence !== data.sequence) {
            existing.sequence = data.sequence;
            changed = true;
          }
          if (existing.kind !== data.kind) {
            existing.kind = data.kind;
            changed = true;
          }
          if (existing.merge !== data.merge) {
            existing.merge = data.merge;
            changed = true;
          }
          if (changed) {
            renderMessages();
          }
          return;
        }
        appendMessage({
          id: messageId || createMessageId(),
          role: "trace",
          content: data.content,
          ...(typeof data.createdAt === "number" ? { createdAt: data.createdAt } : {}),
          ...(typeof data.sequence === "number" ? { sequence: data.sequence } : {}),
          kind: data.kind,
          merge: data.merge,
        });
      }

      function renderUserMessageContent(message) {
        const content = escapeHtml(message.content || "");
        const tags = Array.isArray(message.contextTags)
          ? message.contextTags.filter((tag) => typeof tag === "string" && tag.trim())
          : [];
        if (!tags.length) {
          return content;
        }
        const tagsHtml = tags
          .map((tag) => '<span class="user-context-tag" title="' + escapeHtml(tag) + '">' + escapeHtml(tag) + '</span>')
          .join("");
        return '<div class="user-message-content">' + content + '</div>' +
          '<div class="user-context-tags">' + tagsHtml + '</div>';
      }

      function isToolResultLikeMessage(message) {
        if (!message || message.role === "user") {
          return false;
        }
        const presentation = getTracePresentation(message.content || "");
        return presentation.type === "tool-result";
      }

      function renderToolResultLikeMessage(message) {
        const content = renderTraceContent(message);
        const time = message.createdAt ? formatDateTimeWithMs(message.createdAt) : "";
        if (time) {
          return content + '<div class="trace-time">' + escapeHtml(time) + "</div>";
        }
        return content;
      }

      function renderAssistantMessageContent(message, messageIndex) {
        const content = String(message && message.content ? message.content : "");
        const presentation = getTracePresentation(content);
        if (isFinalAssistantSummaryMessage(messageIndex)) {
          return '<div class="assistant-message-content assistant-message-content-final">' + renderMarkdown(content) + '</div>';
        }
        if (
          isTransparentBubbleMessage(message, presentation, messageIndex)
          || isThinkingLikeMessage(message, presentation)
          || isCodexReasoningStyleMessage(message)
        ) {
          return renderMarkdown(content);
        }
        const bodyHtml = '<div class="assistant-message-content">' + renderMarkdown(content) + '</div>';
        if (!shouldCollapseByContentLength(content)) {
          return bodyHtml;
        }
        return renderCollapsibleBubbleContent(
          buildBubbleCollapseSummaryText(content),
          bodyHtml,
          message && message.id ? message.id : "",
          { extraClass: "message-collapsible-generic" }
        );
      }

      function renderTraceMessageContent(message) {
        const content = renderTraceContent(message);
        const time = message.createdAt ? formatDateTimeWithMs(message.createdAt) : "";
        if (time) {
          return content + '<div class="trace-time">' + escapeHtml(time) + "</div>";
        }
        return content;
      }

      function renderMessageContent(message, messageIndex) {
        if (isToolResultLikeMessage(message)) {
          return renderToolResultLikeMessage(message);
        }
        if (message.role === "system") {
          const content = escapeHtml(message.content || "");
          const time = message.createdAt ? formatDateTime(message.createdAt) : "";
          if (time) {
            return (
              '<div class="system-line">' +
              '<span class="system-text">' +
              content +
              '</span>' +
              '<span class="system-time">' +
              time +
              "</span>" +
              "</div>"
            );
          }
          return content;
        }
        if (message.role === "user") {
          return renderUserMessageContent(message);
        }
        if (message.role === "trace") {
          return renderTraceMessageContent(message);
        }
        return renderAssistantMessageContent(message, messageIndex);
      }

      function safelyRenderMessageContent(message, messageIndex) {
        try {
          return renderMessageContent(message, messageIndex);
        } catch (error) {
          const reason = error && error.message ? String(error.message) : String(error);
          reportWebviewFailure("render-message-failed", error, {
            role: message && message.role ? message.role : null,
            id: message && message.id ? message.id : null,
            kind: message && message.kind ? message.kind : null,
            preview: message && typeof message.content === "string" ? message.content.slice(0, 300) : null,
          });
          return '<pre class="trace-content">render-message-failed: ' + escapeHtml(reason) + '</pre>';
        }
      }

      function getTraceExpandedLines(content, presentation) {
        const lines = Array.isArray(presentation && presentation.lines)
          ? presentation.lines.filter((line) => String(line || "").trim().length > 0)
          : [];
        if (lines.length > 0) {
          return lines;
        }
        if (presentation && typeof presentation.detail === "string" && presentation.detail.trim()) {
          return [presentation.detail];
        }
        return String(content || "")
          .split(/\\r?\\n/)
          .filter((line) => String(line || "").trim().length > 0);
      }

      function renderTraceContent(message) {
        const content = message && typeof message.content === "string" ? message.content : "";
        if (!content) {
          return "";
        }
        const traceKey = message && typeof message.id === "string" ? message.id : "";
        const presentation = getTracePresentation(content);
        const expandedLines = getTraceExpandedLines(content, presentation);
        const bodyHtml = renderTraceBodyLines(expandedLines);
        const shouldCollapse = shouldCollapseTraceContent(message, presentation);
        const showDetailSummary = shouldCollapse;
        const header = presentation.title
          ? '<div class="trace-header">' +
            '<div class="trace-tag-row">' +
            '<span class="trace-title">' +
            escapeHtml(presentation.title) +
            "</span>" +
            (presentation.commandTag
              ? '<span class="trace-command-tag cmd-purpose-' +
                escapeHtml(presentation.commandTag.type) +
                '">' +
                escapeHtml(presentation.commandTag.label) +
                "</span>"
              : "") +
            "</div>" +
            (showDetailSummary && presentation.detail
              ? '<span class="trace-detail">' + escapeHtml(presentation.detail) + "</span>"
              : "") +
            "</div>"
          : "";
        if (shouldCollapse) {
          const isToolResult = presentation.type === "tool-result";
          return header + renderCollapsibleBubbleContent(
            getTraceCollapseSummaryText(message, presentation),
            bodyHtml,
            traceKey,
            {
              extraClass: isToolResult ? "trace-collapsible-tool-result" : "message-collapsible-generic",
              allowRestoreOpen: !isToolResult,
            }
          );
        }
        return header + bodyHtml;
      }
      function renderTraceBodyLines(lines) {
        const htmlLines = lines.map((line) => {
          const cleanLine = stripAnsi(line);
          const trimmed = cleanLine.trimStart();
          const kind = getDiffLineKind(trimmed);
          const prefixed = kind ? ensureDiffPrefix(cleanLine, trimmed, kind) : cleanLine;
          const safeText = escapeHtml(prefixed || "");
          const isLineNumbered = isLineNumberedLine(trimmed);
          const className = (kind ? "trace-line diff-" + kind : "trace-line") + (isLineNumbered ? " line-numbered" : "");
          return '<div class="' + className + '">' + (safeText || "&nbsp;") + "</div>";
        });
        return '<div class="trace-content">' + htmlLines.join("") + "</div>";
      }

      function shouldCollapseTraceContent(message, presentation) {
        if (!presentation) {
          return false;
        }
        if (isTransparentBubbleMessage(message, presentation, -1)) {
          return false;
        }
        if (isThinkingLikeMessage(message, presentation)) {
          return false;
        }
        const sourceContent = message && typeof message.content === "string"
          ? message.content
          : (Array.isArray(presentation.lines) ? presentation.lines.join("\\n") : "");
        if (!shouldCollapseByContentLength(sourceContent)) {
          return false;
        }
        const expandedLines = getTraceExpandedLines(sourceContent, presentation);
        const expandedText = normalizeCollapsePreviewText(expandedLines.join("\\n"));
        const detailText = normalizeCollapsePreviewText(presentation && presentation.detail ? presentation.detail : "");
        if (detailText && expandedText === detailText) {
          return false;
        }
        return true;
      }

      function getTraceCollapseSummaryText(message, presentation) {
        if (presentation && presentation.type === "file-update") {
          return t("traceExpandChanges");
        }
        if (presentation && presentation.type === "thinking") {
          return t("traceExpandThinking");
        }
        if (presentation && presentation.type === "tool-result") {
          return getToolResultCollapseSummaryText(presentation);
        }
        const isToolTrace = presentation
          && String(presentation.type || "").startsWith("tool-use-");
        if (isToolTrace) {
          return buildBubbleCollapseSummaryText(message && message.content ? message.content : presentation.lines.join("\\n"));
        }
        return buildBubbleCollapseSummaryText(message && message.content ? message.content : presentation.lines.join("\\n"));
      }

      function getToolResultCollapseSummaryText(presentation) {
        const tool = String(presentation && presentation.detail ? presentation.detail : "").trim()
          || t("traceToolResult");
        return t("traceExpandToolResult", { tool });
      }

      function hasDiffLikeLines(lines) {
        return lines.some((line) => {
          const value = String(line || "").trim();
          return value.startsWith("diff --git")
            || value.startsWith("@@")
            || (value.startsWith("+") && !value.startsWith("+++"))
            || (value.startsWith("-") && !value.startsWith("---"));
        });
      }

      function getTracePresentation(content) {
        const expanded = expandFileChangeTraceContent(String(content || ""));
        const lines = expanded.split(/\\r?\\n/);
        const normalizedLines = lines.slice();
        const firstIndex = normalizedLines.findIndex((line) => line.trim());
        if (firstIndex === -1) {
          return { type: "", title: "", detail: "", lines: normalizedLines, commandTag: null };
        }
        const firstLine = normalizedLines[firstIndex].trim();
        const definition = getTraceTypeDefinition(firstLine);
        if (!definition) {
          return { type: "", title: "", detail: "", lines: normalizedLines, commandTag: null };
        }
        const detail = definition.detail ? definition.detail(firstLine) : "";
        const bodyLines = normalizedLines.slice(0, firstIndex).concat(normalizedLines.slice(firstIndex + 1));
        return {
          type: definition.type,
          title: definition.title,
          detail,
          lines: stripLeadingEmptyLines(bodyLines),
          commandTag: definition.type === "exec" ? classifyCommandPurposeTag(detail) : null,
        };
      }

      function stripLeadingEmptyLines(lines) {
        const next = lines.slice();
        while (next.length && !next[0].trim()) {
          next.shift();
        }
        return next;
      }

      function classifyCommandPurposeTag(rawCommand) {
        const command = unwrapShellCommand(rawCommand);
        const normalized = normalizeCommandForMatching(command);
        if (!normalized) {
          return null;
        }

        const has = (pattern) => pattern.test(normalized);

        if (has(/(?:^|[;&|()\\s])(npm|pnpm|yarn|bun)\\s+(run\\s+)?test\\b/) || has(/(?:^|[;&|()\\s])node\\s+--test\\b/) || has(/(?:^|[;&|()\\s])(vitest|jest|ava|mocha|pytest|go\\s+test|cargo\\s+test)\\b/) || has(/(?:^|[;&|()\\s])mvn\\b[^\\n]*\\btest\\b/) || has(/(?:^|[;&|()\\s])gradle\\b[^\\n]*\\btest\\b/)) {
          return { type: "test", label: t("traceExecTagTest") };
        }

        if (has(/(?:^|[;&|()\\s])(npm|pnpm|yarn|bun)\\s+(run\\s+)?build\\b/) || has(/(?:^|[;&|()\\s])tsc\\b/) || has(/(?:^|[;&|()\\s])mvn\\b[^\\n]*\\bcompile\\b/) || has(/(?:^|[;&|()\\s])gradle\\b[^\\n]*\\bbuild\\b/) || has(/(?:^|[;&|()\\s])(go\\s+build|cargo\\s+build)\\b/)) {
          return { type: "build", label: t("traceExecTagBuild") };
        }

        if (has(/(?:^|[;&|()\\s])(npm|pnpm|yarn|bun)\\s+run\\s+typecheck\\b/) || has(/(?:^|[;&|()\\s])(typecheck|tsc\\s+--noemit|mypy|pyright)\\b/)) {
          return { type: "typecheck", label: t("traceExecTagTypeCheck") };
        }

        if (has(/(?:^|[;&|()\\s])(npm|pnpm|yarn|bun)\\s+run\\s+lint\\b/) || has(/(?:^|[;&|()\\s])(eslint|stylelint|biome\\s+check|ruff|golangci-lint)\\b/)) {
          return { type: "lint", label: t("traceExecTagLint") };
        }

        if (has(/(?:^|[;&|()\\s])(npm|pnpm|yarn|bun|pip|pip3|poetry|brew|apt|apt-get|yum|dnf|pacman)\\s+(install|add)\\b/) || has(/(?:^|[;&|()\\s])mvn\\s+dependency:/)) {
          return { type: "install", label: t("traceExecTagInstall") };
        }

        if (has(/(?:^|[;&|()\\s])git\\b/)) {
          if (has(/(?:^|[;&|()\\s])git\\s+(add|commit|push|pull|merge|rebase|cherry-pick|reset|checkout|switch|restore|stash|revert|tag)\\b/)) {
            return { type: "git-write", label: t("traceExecTagGitWrite") };
          }
          return { type: "git-read", label: t("traceExecTagGitRead") };
        }

        if (has(/(?:^|[;&|()\\s])(rg|grep|find|ack|ag)\\b/)) {
          return { type: "search", label: t("traceExecTagSearch") };
        }

        if (has(/(?:^|[;&|()\\s])(cat|sed|head|tail|less|more|ls|tree|wc|nl|stat)\\b/)) {
          return { type: "file-read", label: t("traceExecTagFileRead") };
        }
        if (has(/(?:^|[;&|()\\s])(cp|mv|rm|mkdir|touch|chmod|chown|tee|truncate)\\b/) || has(/>\\s*[^&]/)) {
          return { type: "file-write", label: t("traceExecTagFileWrite") };
        }

        if (has(/(?:^|[;&|()\\s'"])python(?:3|2)?\\b/) || has(/(?:^|[;&|()\\s'"])(uv\\s+run\\s+python|poetry\\s+run\\s+python)\\b/)) {
          return { type: "python", label: t("traceExecTagPython") };
        }

        if (has(/(?:^|[;&|()\\s])(npm|pnpm|yarn|bun)\\s+(run\\s+)?(dev|start|serve)\\b/) || has(/(?:^|[;&|()\\s])(node|java|go\\s+run|cargo\\s+run|docker)\\b/)) {
          return { type: "run", label: t("traceExecTagRun") };
        }

        return { type: "other", label: t("traceExecTagOther") };
      }

      function unwrapShellCommand(rawCommand) {
        if (!rawCommand) {
          return "";
        }
        let command = String(rawCommand || "").trim();
        const shellMatch = command.match(/^(bash|zsh|sh)\\s+-lc\\s+([\\s\\S]+)$/i);
        if (!shellMatch) {
          return command;
        }
        const script = shellMatch[2] ? shellMatch[2].trim() : "";
        return stripWrappedQuotes(script);
      }

      function stripWrappedQuotes(value) {
        if (!value || value.length < 2) {
          return value;
        }
        const first = value[0];
        const last = value[value.length - 1];
        if ((first === "'" && last === "'") || (first === '"' && last === '"')) {
          return value.slice(1, -1);
        }
        return value;
      }

      function normalizeCommandForMatching(command) {
        return String(command || "")
          .replace(/\\r?\\n/g, " ")
          .replace(/\\s+/g, " ")
          .trim()
          .toLowerCase();
      }

      function getToolStyleBucket(name) {
        if (!name) {
          return 0;
        }
        let hash = 0;
        for (let i = 0; i < name.length; i += 1) {
          hash = (hash + name.charCodeAt(i) * (i + 1)) % 1024;
        }
        return hash % 4;
      }

      function getTraceTypeDefinition(line) {
        const trimmed = line.trim();
        const toolMatch = trimmed.match(/^(?:tool|调用工具)[:：]?\\s*(.+)?$/i);
        if (toolMatch) {
          const toolName = toolMatch[1] ? toolMatch[1].trim() : "";
          const bucket = getToolStyleBucket(toolName);
          return {
            type: "tool-use-" + bucket,
            title: toolName || t("traceToolFallback"),
            match: /^(?:tool|调用工具)[:：]?\\s*(.+)?$/i,
            detail: () => "",
          };
        }
        const definitions = [
          {
            type: "git-update",
            title: t("traceGitUpdate"),
            match: /^git\\s+update\\b/i,
            detail: (value) => value.replace(/^git\\s+update\\b[:：]?\\s*/i, "").trim(),
          },
          {
            type: "exec",
            title: t("traceExec"),
            match: /^(?:exec\\b|【执行命令】)/i,
            detail: (value) => value.replace(/^(?:exec\\b|【执行命令】)[:：]?\\s*/i, "").trim(),
          },
          {
            type: "file-update",
            title: t("traceFileUpdate"),
            match: /^file\\s+update\\b/i,
            detail: (value) => value.replace(/^file\\s+update\\b[:：]?\\s*/i, "").trim(),
          },
          {
            type: "apply-patch",
            title: t("traceApplyPatch"),
            match: /^apply_patch\\b/i,
            detail: (value) => value.replace(/^apply_patch\\b[:：]?\\s*/i, "").trim(),
          },
          {
            type: "tool-result",
            title: t("traceToolResult"),
            match: /^(?:tool\\s*result|工具结果)\\b/i,
            detail: (value) => value.replace(/^(?:tool\\s*result|工具结果)[:：]?\\s*/i, "").trim(),
          },
          {
            type: "warning",
            title: t("traceWarning"),
            match: /^(?:warning|警告)\\b/i,
            detail: (value) => value.replace(/^(?:warning|警告)\\b[:：]?\\s*/i, "").trim(),
          },
          {
            type: "error",
            title: t("traceError"),
            match: /^(?:error|错误)\\b/i,
            detail: (value) => value.replace(/^(?:error|错误)\\b[:：]?\\s*/i, "").trim(),
          },
          {
            type: "thinking",
            title: t("traceThinking"),
            match: /^(?:thinking|思考)\\b/i,
            detail: (value) => value.replace(/^(?:thinking|思考)\\b[:：]?\\s*/i, "").trim(),
          },
          {
            type: "web-search",
            title: t("traceWebSearch"),
            match: /^(?:web\\s*search\\b|【网络查询】)/i,
            detail: (value) => value.replace(/^(?:web\\s*search\\b|【网络查询】)[:：]?\\s*/i, "").trim(),
          },
        ];
        return definitions.find((definition) => definition.match.test(trimmed)) || null;
      }

      function expandFileChangeTraceContent(content) {
        const toolMatch = content.match(/^(?:tool|调用工具)[:：]\\s*(\\S+)/i);
        if (!toolMatch) {
          return content;
        }
        const toolName = toolMatch[1];
        const inputMarker = traceMarkers.input.find((label) =>
          content.includes("\\n" + label + ":\\n")
        );
        if (!inputMarker) {
          return content;
        }
        const inputIndex = content.indexOf("\\n" + inputMarker + ":\\n");
        const rawJson = content.slice(inputIndex + ("\\n" + inputMarker + ":\\n").length).trim();
        if (!rawJson) {
          return content;
        }
        let input;
        try {
          input = JSON.parse(rawJson);
        } catch {
          return content;
        }
        const diffLines = buildToolInputDiffLines(toolName, input);
        if (!diffLines.length) {
          return content;
        }
        return content + "\\n\\n" + t("traceFileChangesLabel") + ":\\n" + diffLines.join("\\n");
      }

      function buildToolInputDiffLines(toolName, input) {
        const maxLines = 200;
        if (!input || typeof input !== "object") {
          return [];
        }
        const tool = String(toolName || "").toLowerCase();
        if (tool === "write" && typeof input.content === "string") {
          return formatDiffLines(input.content, "added", maxLines);
        }
        if (tool === "edit") {
          const oldText = typeof input.old_string === "string" ? input.old_string : "";
          const newText = typeof input.new_string === "string" ? input.new_string : "";
          return [
            ...formatDiffLines(oldText, "removed", maxLines),
            ...formatDiffLines(newText, "added", maxLines),
          ].filter((line) => line);
        }
        if (tool === "multiedit" && Array.isArray(input.edits)) {
          const lines = [];
          input.edits.forEach((edit) => {
            if (!edit || typeof edit !== "object") {
              return;
            }
            const oldText = typeof edit.old_string === "string" ? edit.old_string : "";
            const newText = typeof edit.new_string === "string" ? edit.new_string : "";
            lines.push(...formatDiffLines(oldText, "removed", maxLines));
            lines.push(...formatDiffLines(newText, "added", maxLines));
          });
          return lines.filter((line) => line);
        }
        return [];
      }

      function formatDiffLines(text, kind, maxLines) {
        if (!text) {
          return [];
        }
        const prefix = kind === "removed" ? "-" : "+";
        const lines = String(text).split(/\\r?\\n/);
        const limited = lines.slice(0, maxLines);
        const formatted = limited.map((line) => {
          const trimmed = line.trimStart();
          if (trimmed.startsWith("+") || trimmed.startsWith("-")) {
            return line;
          }
          return prefix + " " + line;
        });
        if (lines.length > maxLines) {
          formatted.push(prefix + " ...");
        }
        return formatted;
      }

      function stripAnsi(value) {
        if (!value) {
          return "";
        }
        return String(value).replace(/\\u001b\\[[0-9;]*m/g, "");
      }

      function getDiffLineKind(trimmed) {
        if (!trimmed) {
          return "";
        }
        if (trimmed.startsWith("+++") || trimmed.startsWith("---")) {
          return "";
        }
        if (trimmed.startsWith("+")) {
          return "added";
        }
        if (trimmed.startsWith("-")) {
          return "removed";
        }
        if (new RegExp("^(?:added|add|新增|添加)\\\\b[:：]?\\\\s+", "i").test(trimmed)) {
          return "added";
        }
        if (new RegExp("^(?:removed|remove|deleted|delete|删除|移除)\\\\b[:：]?\\\\s+", "i").test(trimmed)) {
          return "removed";
        }
        return "";
      }

      function ensureDiffPrefix(line, trimmed, kind) {
        if (!trimmed) {
          return line;
        }
        const prefix = kind === "added" ? "+" : "-";
        if (trimmed.startsWith(prefix)) {
          return line;
        }
        return prefix + " " + line;
      }

      function renderMarkdown(content) {
        if (!content) {
          return "";
        }
        const normalized = wrapLineNumberedBlocks(content);
        if (typeof marked === "undefined" || !marked.parse) {
          return escapeHtml(normalized);
        }
        const renderer = new marked.Renderer();
        renderer.html = (html) => escapeHtml(html);
        return marked.parse(normalized, { breaks: true, renderer });
      }

      function isLineNumberedLine(value) {
        return /^\\s*\\d+\\s*(?:→|->)\\s*/.test(value);
      }

      function wrapLineNumberedBlocks(content) {
        const lines = String(content).split(/\\r?\\n/);
        const output = [];
        let inFence = false;
        let inNumberBlock = false;
        let numberBlock = [];
        const flushNumberBlock = () => {
          if (!inNumberBlock) {
            return;
          }
          output.push("\`\`\`text", ...numberBlock, "\`\`\`");
          numberBlock = [];
          inNumberBlock = false;
        };
        lines.forEach((line) => {
          const trimmed = line.trim();
          if (trimmed.startsWith("\`\`\`")) {
            flushNumberBlock();
            inFence = !inFence;
            output.push(line);
            return;
          }
          if (!inFence && isLineNumberedLine(line)) {
            inNumberBlock = true;
            numberBlock.push(line);
            return;
          }
          flushNumberBlock();
          output.push(line);
        });
        flushNumberBlock();
        return output.join("\\n");
      }

      function updateTaskList() {
        const taskListState = getActiveTaskListState({ create: true });
        if (!taskListState) {
          renderTaskList();
          return;
        }
        if (taskListState.source === "external") {
          renderTaskList(taskListState);
          return;
        }
        const items = extractTaskListFromMessages(state.messages, taskListState.startIndex);
        setTaskListItems(taskListState, items);
        renderTaskList(taskListState);
      }

      function setTaskListItems(taskListState, items) {
        if (!taskListState) {
          return;
        }
        const nextItems = Array.isArray(items) ? items : [];
        const hadItems = Array.isArray(taskListState.items) && taskListState.items.length > 0;
        taskListState.items = nextItems;
        if (!nextItems.length) {
          taskListState.open = false;
          return;
        }
        if (!hadItems) {
          taskListState.open = true;
        }
      }

      function renderTaskList(taskListState) {
        if (!elements.taskListPanel || !elements.taskListDetails || !elements.taskListBody) {
          return;
        }
        const activeTaskListState = taskListState || getActiveTaskListState({ create: false });
        const items = activeTaskListState && Array.isArray(activeTaskListState.items)
          ? activeTaskListState.items
          : [];
        if (!items.length) {
          elements.taskListPanel.style.display = "none";
          elements.taskListDetails.open = false;
          if (elements.taskListCount) {
            elements.taskListCount.textContent = "";
          }
          elements.taskListBody.innerHTML = "";
          return;
        }
        elements.taskListPanel.style.display = "block";
        elements.taskListDetails.open = activeTaskListState ? activeTaskListState.open : true;
        if (elements.taskListCount) {
          elements.taskListCount.textContent = "(" + items.length + ")";
        }
        const list = document.createElement("ul");
        list.className = "tasklist-items";
        items.forEach((item) => {
          const li = document.createElement("li");
          li.className = "tasklist-item";
          const checkbox = document.createElement("input");
          checkbox.type = "checkbox";
          checkbox.className = "tasklist-checkbox";
          checkbox.checked = item.done;
          checkbox.disabled = true;
          const text = document.createElement("span");
          text.textContent = item.text;
          li.appendChild(checkbox);
          li.appendChild(text);
          list.appendChild(li);
        });
        elements.taskListBody.innerHTML = "";
        elements.taskListBody.appendChild(list);
      }

      function extractTaskListFromMessages(messages, startIndex = 0) {
        let lastItems = [];
        if (!Array.isArray(messages)) {
          return lastItems;
        }
        const start = Number.isInteger(startIndex) ? Math.max(0, startIndex) : 0;
        for (let i = start; i < messages.length; i += 1) {
          const message = messages[i];
          if (!message || message.role !== "assistant") {
            continue;
          }
          const items = parseTaskListFromText(message.content || "");
          if (items.length) {
            lastItems = items;
          }
        }
        return lastItems;
      }

      function parseTaskListFromText(text) {
        if (!text) {
          return [];
        }
        const lines = String(text).split(/\\r?\\n/);
        const headerRegex = /^\\s*(tasklist|todolist)\\s*:\\s*(.*)$/i;
        const itemRegex = /^\\s*(?:[-*]|\\d+\\.)?\\s*\\[(x|\\s)\\]\\s+(.*)$/i;
        let items = [];
        for (let i = 0; i < lines.length; i += 1) {
          const line = lines[i];
          const headerMatch = line.match(headerRegex);
          if (!headerMatch) {
            continue;
          }
          const sectionItems = [];
          const inlinePart = (headerMatch[2] || "").trim();
          if (inlinePart) {
            const inlineMatch = inlinePart.match(itemRegex);
            if (inlineMatch) {
              sectionItems.push({
                done: inlineMatch[1].toLowerCase() === "x",
                text: inlineMatch[2].trim(),
              });
            }
          }
          for (let j = i + 1; j < lines.length; j += 1) {
            const nextLine = lines[j];
            if (!nextLine.trim()) {
              break;
            }
            const itemMatch = nextLine.match(itemRegex);
            if (!itemMatch) {
              if (sectionItems.length) {
                break;
              }
              continue;
            }
            sectionItems.push({
              done: itemMatch[1].toLowerCase() === "x",
              text: itemMatch[2].trim(),
            });
          }
          if (sectionItems.length) {
            items = sectionItems;
          }
        }
        return items;
      }

      function normalizeTaskListItems(items) {
        if (!Array.isArray(items)) {
          return [];
        }
        return items
          .map((item) => {
            if (!item || typeof item !== "object") {
              return null;
            }
            const record = item;
            const text =
              typeof record.text === "string"
                ? record.text
                : typeof record.content === "string"
                  ? record.content
                  : "";
            if (!text.trim()) {
              return null;
            }
            const done =
              typeof record.done === "boolean"
                ? record.done
                : typeof record.completed === "boolean"
                  ? record.completed
                  : record.status === "completed";
            return { text: text.trim(), done: Boolean(done) };
          })
          .filter(Boolean);
      }

      function escapeHtml(value) {
        let text = "";
        if (typeof value === "string") {
          text = value;
        } else if (value && typeof value === "object" && "text" in value) {
          const tokenText = value.text;
          text = typeof tokenText === "string" ? tokenText : tokenText == null ? "" : String(tokenText);
        } else {
          text = value == null ? "" : String(value);
        }
        return text
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;");
      }

      function showToast(message) {
        if (!elements.toast) {
          return;
        }
        elements.toast.textContent = message;
        elements.toast.classList.add("visible");
        if (toastTimer) {
          clearTimeout(toastTimer);
        }
        toastTimer = setTimeout(() => {
          elements.toast.classList.remove("visible");
        }, 1600);
      }

      function copyTextToClipboard(value, successMessage = t("toastCopied")) {
        if (!value) {
          return;
        }
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(value).then(
            () => showToast(successMessage),
            () => fallbackCopyText(value, successMessage)
          );
          return;
        }
        fallbackCopyText(value, successMessage);
      }

      function fallbackCopyText(value, successMessage = t("toastCopied")) {
        const textarea = document.createElement("textarea");
        textarea.value = value;
        textarea.setAttribute("readonly", "true");
        textarea.style.position = "absolute";
        textarea.style.left = "-9999px";
        document.body.appendChild(textarea);
        textarea.select();
        try {
          document.execCommand("copy");
          showToast(successMessage);
        } catch (error) {
          showToast(t("toastCopyFailed"));
        } finally {
          document.body.removeChild(textarea);
        }
      }

      function syncLongTermMemoryWorkspaceControl() {
        const isManagedByProjectCh = Boolean(state.longTermMemoryManagedByProjectCh);
        if (elements.longTermMemoryEnabled) {
          elements.longTermMemoryEnabled.checked = isManagedByProjectCh
            ? false
            : Boolean(state.workspaceMemoryEnabled);
          elements.longTermMemoryEnabled.disabled = Boolean(state.isRunning || isManagedByProjectCh);
        }
        if (elements.longTermMemoryNote) {
          elements.longTermMemoryNote.textContent = isManagedByProjectCh
            ? i18n.toolSettingsLongTermMemoryManagedByChHint
            : i18n.toolSettingsLongTermMemoryHint;
        }
      }

      function updateRunningState(isRunning, options = {}) {
        const wasRunning = state.isRunning;
        const preserveRunArtifacts = Boolean(options.preserveRunArtifacts);
        const startedAt = typeof options.startedAt === "number" ? options.startedAt : 0;
        const shouldResyncRunningClock = isRunning && startedAt > 0 && runWaitStartAt > 0 && runWaitStartAt !== startedAt;
        state.isRunning = isRunning;
        elements.sendPrompt.disabled = false;
        elements.promptInput.disabled = false;
        elements.newSession.disabled = false;
        syncResetSessionAvailability();
        renderConversationTabs();
        elements.stopRun.disabled = !isRunning;
        elements.thinkingMode.disabled = false;
        if (elements.debugMode) {
          elements.debugMode.disabled = isRunning;
        }
        syncLongTermMemoryWorkspaceControl();
        syncInteractiveOptions();
        elements.sendPrompt.style.display = "inline-flex";
        elements.stopRun.style.display = isRunning ? "inline-flex" : "none";
        elements.historyButton.disabled = false;
        if (isRunning && !wasRunning) {
          if (!preserveRunArtifacts) {
            resetRunRawStream();
          }
          startRunWaitTimer(startedAt || Date.now());
        } else if (!isRunning && wasRunning) {
          stopRunWaitTimer();
          closeRunPromptOverlay();
          closeRunStreamOverlay();
        } else if (shouldResyncRunningClock) {
          // When switching between two running tabs, keep the timer bound to the active tab run.
          runWaitStartAt = startedAt;
          updateRunWaitTime(Date.now() - runWaitStartAt);
        }
        updateRunWait();
        updateRunPromptButton();
        updateRunStreamButton();
      }

      function updateRunWait() {
        if (!elements.runWait) {
          return;
        }
        const runtimeState = getActiveConversationRuntimeState({ create: false });
        const hasPrompt = Boolean(runtimeState && String(runtimeState.currentRunPrompt || "").trim().length > 0);
        const hasStreamRecords = Boolean(runtimeState && runtimeState.runStreamRecords.length > 0);
        const hasQueuedPrompts = Boolean(runtimeState && runtimeState.pendingPromptQueue.length > 0);
        const hasRunStatusSummary = Boolean(runtimeState && String(runtimeState.lastRunStatusMessage || "").trim().length > 0);
        const shouldShowRunRow = state.isRunning || hasPrompt || hasStreamRecords || hasQueuedPrompts || hasRunStatusSummary;

        elements.runWait.style.display = shouldShowRunRow ? "flex" : "none";

        const typingNode = elements.runWait.querySelector(".typing");
        if (typingNode) {
          typingNode.style.display = state.isRunning ? "inline-flex" : "none";
        }
        if (elements.runWaitTime) {
          elements.runWaitTime.style.display = state.isRunning ? "inline" : "none";
        }
        if (elements.runStatusText) {
          const isCompacting = Boolean(
            state.isRunning
            && runtimeState
            && runtimeState.activeRunActivity === "contextCompaction"
          );
          const summary = isCompacting
            ? t("runStatusCompacting")
            : !state.isRunning && runtimeState
            ? String(runtimeState.lastRunStatusMessage || "").trim()
            : "";
          elements.runStatusText.textContent = summary;
          elements.runStatusText.classList.toggle("compacting", isCompacting);
          if (summary) {
            elements.runStatusText.setAttribute("aria-label", summary);
          } else {
            elements.runStatusText.removeAttribute("aria-label");
          }
          elements.runStatusText.style.display = summary ? (isCompacting ? "inline-flex" : "inline") : "none";
        }
      }

      function startRunWaitTimer(startAt = Date.now()) {
        if (!elements.runWaitTime) {
          return;
        }
        stopRunWaitTimer();
        runWaitStartAt = startAt;
        updateRunWaitTime(Date.now() - runWaitStartAt);
        runWaitTimer = window.setInterval(() => {
          updateRunWaitTime(Date.now() - runWaitStartAt);
        }, 1000);
      }

      function stopRunWaitTimer() {
        if (runWaitTimer) {
          clearInterval(runWaitTimer);
          runWaitTimer = null;
        }
        runWaitStartAt = 0;
        updateRunWaitTime(0);
      }

      function updateRunWaitTime(elapsedMs) {
        if (!elements.runWaitTime) {
          return;
        }
        elements.runWaitTime.textContent = formatElapsedTime(elapsedMs);
      }

      function formatElapsedTime(elapsedMs) {
        const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;
        return String(minutes).padStart(2, "0") + ":" + String(seconds).padStart(2, "0");
      }

      function resetTaskListForRunStart(tabId) {
        const targetTabId = typeof tabId === "string" && tabId ? tabId : getActiveConversationTabId();
        const runtimeState = getConversationRuntimeState(targetTabId, { create: false });
        const startIndex = runtimeState
          ? ensureRuntimeStateMessages(runtimeState).length
          : isRuntimeStateForActiveTab(targetTabId)
            ? state.messages.length
            : 0;
        const taskListState = getTaskListState(targetTabId);
        resetTaskListState(taskListState, startIndex);
        if (isRuntimeStateForActiveTab(targetTabId)) {
          renderTaskList(taskListState);
        }
      }

      function closeTaskListForRunCompletion(tabId) {
        const targetTabId = typeof tabId === "string" && tabId ? tabId : getActiveConversationTabId();
        const runtimeState = getConversationRuntimeState(targetTabId, { create: false });
        const startIndex = runtimeState
          ? ensureRuntimeStateMessages(runtimeState).length
          : isRuntimeStateForActiveTab(targetTabId)
            ? state.messages.length
            : 0;
        const taskListState = getTaskListState(targetTabId);
        resetTaskListState(taskListState, startIndex);
        if (isRuntimeStateForActiveTab(targetTabId)) {
          renderTaskList(taskListState);
        }
      }

      function dispatchPrompt(payload, options = {}) {
        const normalizedPayload = normalizePromptPayload(payload);
        if (!normalizedPayload) {
          return false;
        }
        const prompt = normalizedPayload.prompt;
        const targetTabId = typeof options.tabId === "string" && options.tabId
          ? options.tabId
          : getActiveConversationTabId();
        const activeTabId = getActiveConversationTabId();
        const targetTab = getConversationTabSummary(targetTabId);
        const targetCli = targetTab && targetTab.cli ? targetTab.cli : state.currentCli;
        const isBackgroundDispatch = Boolean(targetTabId && activeTabId && targetTabId !== activeTabId);
        const targetRuntimeState = getConversationRuntimeState(targetTabId, { create: false });
        const shouldSuppressFlush = isTabRunning(targetTabId);
        const hasConfig = isBackgroundDispatch ? true : state.selectedConfigId || state.configState.activeConfigId;
        if (!hasConfig) {
          appendMessage({
            id: createMessageId(),
            role: "system",
            content: t("toastNoActiveConfig"),
            createdAt: Date.now(),
          });
          return false;
        }
        if (shouldSuppressFlush && targetRuntimeState) {
          targetRuntimeState.suppressQueueFlushOnce = true;
        }
        resetTaskListForRunStart(targetTabId);
        const targetModel = targetCli && cliSupportsManagedModelSelection(targetCli) && state.selectedModelsByCli
          ? state.selectedModelsByCli[targetCli] || ""
          : "";
        const targetLobsterMainModel = targetCli && cliSupportsManagedModelSelection(targetCli) && state.selectedLobsterMainModelsByCli
          ? state.selectedLobsterMainModelsByCli[targetCli] || ""
          : "";
        const targetLobsterSubtaskModel = targetCli && cliSupportsManagedModelSelection(targetCli) && state.selectedLobsterSubtaskModelsByCli
          ? state.selectedLobsterSubtaskModelsByCli[targetCli] || ""
          : "";
        const targetInteractiveMode = isBackgroundDispatch ? undefined : state.interactiveMode;
        const targetLobsterExecutionMode = targetInteractiveMode === "lobster"
          ? getLobsterExecutionModeForCli(targetCli)
          : undefined;
        const sendPromptMessage = {
          type: "sendPrompt",
          prompt,
          interactiveMode: targetInteractiveMode,
          contextOptions: normalizedPayload.contextOptions,
          tabId: targetTabId || undefined,
          cli: targetCli,
          model: targetModel || undefined,
          lobsterMainModel: targetLobsterMainModel || undefined,
          lobsterSubtaskModel: targetLobsterSubtaskModel || undefined,
          preserveActiveTab: Boolean(options.preserveActiveTab && isBackgroundDispatch),
        };
        if (targetLobsterExecutionMode) {
          sendPromptMessage.lobsterExecutionMode = targetLobsterExecutionMode;
        }
        vscode.postMessage(sendPromptMessage);
        return true;
      }

      function syncRunConflictOverlay() {
        if (!elements.runConflictOverlay) {
          return;
        }
        const runtimeState = getActiveConversationRuntimeState({ create: false });
        const payload = runtimeState ? normalizePromptPayload(runtimeState.pendingRunPrompt) : null;
        const visible = Boolean(runtimeState && runtimeState.overlays.runConflict && payload);
        if (elements.runConflictPrompt) {
          elements.runConflictPrompt.textContent = visible && payload ? payload.prompt : "";
        }
        elements.runConflictOverlay.classList.toggle("visible", visible);
      }

      function openRunConflictOverlay(payload) {
        const normalizedPayload = normalizePromptPayload(payload);
        if (!normalizedPayload) {
          return;
        }
        if (!elements.runConflictOverlay) {
          const sent = dispatchPrompt(normalizedPayload);
          if (sent) {
            resetPromptContextForNextPrompt();
          }
          return;
        }
        const runtimeState = getActiveConversationRuntimeState();
        if (!runtimeState) {
          return;
        }
        runtimeState.pendingRunPrompt = normalizedPayload;
        runtimeState.overlays.runConflict = true;
        syncRunConflictOverlay();
      }

      function closeRunConflictOverlay(options = {}) {
        const runtimeState = getActiveConversationRuntimeState({ create: false });
        if (runtimeState) {
          runtimeState.overlays.runConflict = false;
          if (options.clearPending !== false) {
            runtimeState.pendingRunPrompt = null;
          }
        }
        syncRunConflictOverlay();
      }

      function isRunArtifactsVisibleForActiveTab() {
        return true;
      }

      function getRunPromptText(tabId) {
        const runtimeState = getConversationRuntimeState(tabId, { create: false });
        const prompt = String(runtimeState && runtimeState.currentRunPrompt ? runtimeState.currentRunPrompt : "");
        return prompt.trim() ? prompt : t("runPromptEmpty");
      }

      function updateRunPromptButton() {
        if (!elements.runPromptButton) {
          return;
        }
        const runtimeState = getActiveConversationRuntimeState({ create: false });
        const hasPrompt = Boolean(runtimeState && String(runtimeState.currentRunPrompt || "").trim().length > 0);
        elements.runPromptButton.style.display = hasPrompt && isRunArtifactsVisibleForActiveTab() ? "inline-flex" : "none";
        updateRunWait();
      }

      function syncRunPromptOverlay() {
        if (!elements.runPromptOverlay || !elements.runPromptContent) {
          return;
        }
        const runtimeState = getActiveConversationRuntimeState({ create: false });
        const hasPrompt = Boolean(runtimeState && String(runtimeState.currentRunPrompt || "").trim().length > 0);
        const visible = Boolean(runtimeState && runtimeState.overlays.runPrompt && hasPrompt && isRunArtifactsVisibleForActiveTab());
        if (visible) {
          elements.runPromptContent.textContent = getRunPromptText(getActiveConversationTabId());
        } else {
          elements.runPromptContent.textContent = "";
          if (runtimeState) {
            runtimeState.overlays.runPrompt = false;
          }
        }
        elements.runPromptOverlay.classList.toggle("visible", visible);
      }

      function openRunPromptOverlay() {
        const runtimeState = getActiveConversationRuntimeState({ create: false });
        if (!runtimeState) {
          return;
        }
        const hasPrompt = String(runtimeState.currentRunPrompt || "").trim().length > 0;
        if (!hasPrompt || !isRunArtifactsVisibleForActiveTab()) {
          return;
        }
        runtimeState.overlays.runPrompt = true;
        syncRunPromptOverlay();
      }

      function closeRunPromptOverlay() {
        const runtimeState = getActiveConversationRuntimeState({ create: false });
        if (runtimeState) {
          runtimeState.overlays.runPrompt = false;
        }
        syncRunPromptOverlay();
      }

      function updateCurrentRunPrompt(prompt, tabId) {
        const runtimeState = getConversationRuntimeState(tabId);
        if (!runtimeState) {
          return;
        }
        runtimeState.currentRunPrompt = typeof prompt === "string" ? prompt : "";
        if (!isRuntimeStateForActiveTab(tabId)) {
          return;
        }
        updateRunPromptButton();
        syncRunPromptOverlay();
      }

      function resolveRunStreamSourceLabel(source) {
        if (source === "stderr") {
          return t("runStreamSourceStderr");
        }
        if (source === "event") {
          return t("runStreamSourceEvent");
        }
        return t("runStreamSourceStdout");
      }

      function normalizeRunStreamSource(source) {
        if (source === "stderr" || source === "event") {
          return source;
        }
        return "stdout";
      }

      function normalizeRunStreamRecordContent(content) {
        if (typeof content === "string") {
          return content;
        }
        if (content === null || content === undefined) {
          return "";
        }
        return String(content);
      }

      function buildRunStreamPreview(content) {
        const normalized = String(content || "")
          .replace(/\\r\\n/g, "\\n")
          .replace(/\\n/g, " ↵ ")
          .replace(/\\s+/g, " ")
          .trim();
        if (!normalized) {
          return t("runStreamRecordEmpty");
        }
        if (normalized.length <= RUN_STREAM_PREVIEW_MAX_LENGTH) {
          return normalized;
        }
        return normalized.slice(0, RUN_STREAM_PREVIEW_MAX_LENGTH - 3) + "...";
      }

      function tryFormatRunStreamJsonContent(content) {
        const normalized = normalizeRunStreamRecordContent(content);
        const trimmed = normalized.trim();
        if (!trimmed) {
          return null;
        }
        const firstChar = trimmed.charAt(0);
        if (firstChar !== "{" && firstChar !== "[") {
          return null;
        }
        try {
          const parsed = JSON.parse(trimmed);
          if (!parsed || typeof parsed !== "object") {
            return null;
          }
          if (!Array.isArray(parsed) && Object.prototype.toString.call(parsed) !== "[object Object]") {
            return null;
          }
          return JSON.stringify(parsed, null, 2);
        } catch {
          return null;
        }
      }

      function formatRunStreamExpandedContent(content) {
        const normalized = normalizeRunStreamRecordContent(content);
        if (!normalized) {
          return t("runStreamRecordEmpty");
        }
        return tryFormatRunStreamJsonContent(normalized) || normalized;
      }

      function captureOpenRunStreamRecordIds(runtimeState) {
        if (!runtimeState) {
          return;
        }
        runtimeState.runStreamOpenRecordIds.clear();
        if (!elements.runStreamContent) {
          return;
        }
        const openNodes = elements.runStreamContent.querySelectorAll("details.run-stream-item[data-stream-record-id]");
        openNodes.forEach((node) => {
          if (!node.open) {
            return;
          }
          const recordId = node.getAttribute("data-stream-record-id");
          if (recordId) {
            runtimeState.runStreamOpenRecordIds.add(recordId);
          }
        });
      }

      function getRunStreamBottomDistance() {
        if (!elements.runStreamContent) {
          return 0;
        }
        return elements.runStreamContent.scrollHeight - (
          elements.runStreamContent.scrollTop + elements.runStreamContent.clientHeight
        );
      }

      function isRunStreamNearBottom(threshold = 50) {
        return getRunStreamBottomDistance() <= threshold;
      }

      function stickRunStreamToBottom() {
        if (!elements.runStreamContent) {
          return;
        }
        elements.runStreamContent.scrollTop = elements.runStreamContent.scrollHeight;
      }

      function getLatestRunStreamRecordTimestamp(runtimeState) {
        if (!runtimeState || !Array.isArray(runtimeState.runStreamRecords) || !runtimeState.runStreamRecords.length) {
          return 0;
        }
        const latestRecord = runtimeState.runStreamRecords[runtimeState.runStreamRecords.length - 1];
        return latestRecord && typeof latestRecord.createdAt === "number" ? latestRecord.createdAt : 0;
      }

      function resolveRunStreamButtonStaleLevel(runtimeState, now = Date.now()) {
        const latestTimestamp = getLatestRunStreamRecordTimestamp(runtimeState);
        if (!latestTimestamp || now <= latestTimestamp) {
          return "normal";
        }
        const idleMs = now - latestTimestamp;
        if (idleMs >= RUN_STREAM_STALE_CRITICAL_MS) {
          return "critical";
        }
        if (idleMs >= RUN_STREAM_STALE_WARNING_MS) {
          return "warning";
        }
        return "normal";
      }

      function getRunStreamStaleBadgeLabel(staleLevel) {
        if (staleLevel === "critical") {
          return t("runStreamVerySlowLabel");
        }
        if (staleLevel === "warning") {
          return t("runStreamSlowLabel");
        }
        return "";
      }

      function applyRunStreamButtonStaleLevel(runtimeState) {
        if (!elements.runStreamStaleBadge) {
          return;
        }
        const staleLevel = resolveRunStreamButtonStaleLevel(runtimeState);
        const isVisible = staleLevel !== "normal";
        elements.runStreamStaleBadge.textContent = getRunStreamStaleBadgeLabel(staleLevel);
        elements.runStreamStaleBadge.style.display = isVisible ? "inline-flex" : "none";
        elements.runStreamStaleBadge.classList.toggle("run-stream-stale-badge-warning", staleLevel === "warning");
        elements.runStreamStaleBadge.classList.toggle("run-stream-stale-badge-critical", staleLevel === "critical");
      }

      function stopRunStreamStaleTimer() {
        if (runStreamStaleTimer) {
          window.clearInterval(runStreamStaleTimer);
          runStreamStaleTimer = null;
        }
      }

      function ensureRunStreamStaleTimer(shouldRun) {
        if (!shouldRun) {
          stopRunStreamStaleTimer();
          return;
        }
        if (runStreamStaleTimer) {
          return;
        }
        runStreamStaleTimer = window.setInterval(() => {
          const runtimeState = getActiveConversationRuntimeState({ create: false });
          applyRunStreamButtonStaleLevel(runtimeState);
        }, RUN_STREAM_STALE_REFRESH_INTERVAL_MS);
      }

      function getRunStreamButtonLabel(recordCount) {
        const baseLabel = t("runStreamViewLabel");
        if (!recordCount) {
          return baseLabel;
        }
        return baseLabel + "(" + recordCount + ")";
      }

      function renderRunStreamRecord(record, index, runtimeState) {
        const details = document.createElement("details");
        details.className = "run-stream-item";
        details.setAttribute("data-stream-record-id", record.id);
        if (runtimeState && runtimeState.runStreamOpenRecordIds.has(record.id)) {
          details.open = true;
        }

        const summary = document.createElement("summary");
        summary.className = "run-stream-item-summary";

        const indexNode = document.createElement("span");
        indexNode.className = "run-stream-item-index";
        indexNode.textContent = t("runStreamRecordIndex", { index: index + 1 });

        const sourceNode = document.createElement("span");
        sourceNode.className = "run-stream-item-source";
        sourceNode.textContent = resolveRunStreamSourceLabel(record.source);

        const timeNode = document.createElement("span");
        timeNode.className = "run-stream-item-time";
        timeNode.textContent = formatDateTimeWithMs(record.createdAt);

        const previewNode = document.createElement("span");
        previewNode.className = "run-stream-item-preview";
        previewNode.textContent = buildRunStreamPreview(record.content);

        summary.appendChild(indexNode);
        summary.appendChild(sourceNode);
        summary.appendChild(timeNode);
        summary.appendChild(previewNode);

        const contentNode = document.createElement("pre");
        contentNode.className = "run-stream-item-content";
        contentNode.textContent = formatRunStreamExpandedContent(record.content);

        details.appendChild(summary);
        details.appendChild(contentNode);
        return details;
      }

      function updateRunStreamContent() {
        if (!elements.runStreamContent) {
          return;
        }
        const runtimeState = getActiveConversationRuntimeState({ create: false });
        if (!runtimeState || !runtimeState.runStreamRecords.length) {
          elements.runStreamContent.classList.add("run-stream-empty");
          elements.runStreamContent.textContent = t("runStreamEmpty");
          updateRunStreamExportButton();
          return;
        }

        const shouldAutoStick = isRunStreamNearBottom(RUN_STREAM_AUTO_SCROLL_THRESHOLD_PX);
        captureOpenRunStreamRecordIds(runtimeState);
        elements.runStreamContent.classList.remove("run-stream-empty");
        elements.runStreamContent.innerHTML = "";

        const list = document.createElement("div");
        list.className = "run-stream-list";
        runtimeState.runStreamRecords.forEach((record, index) => {
          list.appendChild(renderRunStreamRecord(record, index, runtimeState));
        });

        const bottomGap = document.createElement("div");
        bottomGap.className = "run-stream-bottom-gap";

        elements.runStreamContent.appendChild(list);
        elements.runStreamContent.appendChild(bottomGap);
        if (shouldAutoStick) {
          stickRunStreamToBottom();
        }
        updateRunStreamExportButton();
      }

      function resetRunRawStream(tabId, options = {}) {
        const runtimeState = getConversationRuntimeState(tabId);
        if (!runtimeState) {
          return;
        }
        runtimeState.runStreamRecordCounter = 0;
        runtimeState.runStreamRecords.length = 0;
        runtimeState.runStreamOpenRecordIds.clear();
        runtimeState.overlays.runStream = false;
        runStreamExportPending = false;
        if (isRuntimeStateForActiveTab(tabId)) {
          updateRunStreamContent();
          updateRunStreamButton();
          if (options.syncOverlay !== false) {
            syncRunStreamOverlay();
          }
        }
      }

      function appendRunRawStream(content, source, tabId) {
        const normalizedContent = normalizeRunStreamRecordContent(content);
        if (!normalizedContent) {
          return;
        }
        const runtimeState = getConversationRuntimeState(tabId);
        if (!runtimeState) {
          return;
        }
        runtimeState.runStreamRecordCounter += 1;
        runtimeState.runStreamRecords.push({
          id: "stream-record-" + runtimeState.runStreamRecordCounter,
          content: normalizedContent,
          source: normalizeRunStreamSource(source),
          createdAt: Date.now(),
        });
        if (isRuntimeStateForActiveTab(tabId)) {
          updateRunStreamContent();
          updateRunStreamButton();
          syncRunStreamOverlay();
        }
      }

      function updateRunStreamButton() {
        if (!elements.runStreamButton) {
          return;
        }
        const runtimeState = getActiveConversationRuntimeState({ create: false });
        const recordCount = runtimeState && Array.isArray(runtimeState.runStreamRecords)
          ? runtimeState.runStreamRecords.length
          : 0;
        const hasRecords = recordCount > 0;
        const canShowForActiveTab = isRunArtifactsVisibleForActiveTab();
        const isButtonVisible = canShowForActiveTab && (state.isRunning || hasRecords);
        const shouldHighlightStale = state.isRunning && hasRecords;
        elements.runStreamButton.textContent = getRunStreamButtonLabel(recordCount);
        elements.runStreamButton.style.display = isButtonVisible ? "inline-flex" : "none";
        applyRunStreamButtonStaleLevel(shouldHighlightStale ? runtimeState : null);
        ensureRunStreamStaleTimer(isButtonVisible && shouldHighlightStale);
        updateRunStreamExportButton();
        updateRunWait();
      }

      function syncRunStreamOverlay() {
        if (!elements.runStreamOverlay) {
          return;
        }
        const runtimeState = getActiveConversationRuntimeState({ create: false });
        const hasRecords = Boolean(runtimeState && runtimeState.runStreamRecords.length > 0);
        const visible = Boolean(runtimeState && runtimeState.overlays.runStream && hasRecords && isRunArtifactsVisibleForActiveTab());
        if (visible) {
          updateRunStreamContent();
          elements.runStreamOverlay.classList.add("visible");
          return;
        }
        if (runtimeState) {
          runtimeState.overlays.runStream = false;
        }
        elements.runStreamOverlay.classList.remove("visible");
      }

      function openRunStreamOverlay() {
        const runtimeState = getActiveConversationRuntimeState({ create: false });
        if (!runtimeState || !runtimeState.runStreamRecords.length || !isRunArtifactsVisibleForActiveTab()) {
          return;
        }
        runtimeState.overlays.runStream = true;
        syncRunStreamOverlay();
        window.requestAnimationFrame(() => {
          stickRunStreamToBottom();
        });
        updateRunStreamExportButton();
      }

      function closeRunStreamOverlay() {
        const runtimeState = getActiveConversationRuntimeState({ create: false });
        if (runtimeState) {
          runtimeState.overlays.runStream = false;
        }
        syncRunStreamOverlay();
        updateRunStreamExportButton();
      }

      function openConfigApplyErrorOverlay(detail) {
        if (!elements.configApplyErrorOverlay || !elements.configApplyErrorContent) {
          return;
        }
        const content = typeof detail === "string" && detail.trim()
          ? detail.trim()
          : t("commonUnknownError");
        elements.configApplyErrorContent.textContent = content;
        elements.configApplyErrorOverlay.classList.add("visible");
      }

      function closeConfigApplyErrorOverlay() {
        if (!elements.configApplyErrorOverlay || !elements.configApplyErrorContent) {
          return;
        }
        elements.configApplyErrorOverlay.classList.remove("visible");
        elements.configApplyErrorContent.textContent = "";
      }

      function updateRunStreamExportButton() {
        if (!elements.exportRunStream) {
          return;
        }
        const runtimeState = getActiveConversationRuntimeState({ create: false });
        const hasRecords = Boolean(runtimeState && runtimeState.runStreamRecords.length);
        elements.exportRunStream.disabled = runStreamExportPending || !hasRecords;
        elements.exportRunStream.textContent = runStreamExportPending
          ? t("runStreamExporting")
          : t("runStreamExportLabel");
      }

      function buildRunStreamExportPayload(runtimeState) {
        if (!runtimeState || !Array.isArray(runtimeState.runStreamRecords)) {
          return [];
        }
        return runtimeState.runStreamRecords.map((record) => ({
          id: record.id,
          content: record.content,
          source: record.source,
          createdAt: record.createdAt,
        }));
      }

      function requestRunStreamExport() {
        if (runStreamExportPending) {
          return;
        }
        const runtimeState = getActiveConversationRuntimeState({ create: false });
        if (!runtimeState || !runtimeState.runStreamRecords.length) {
          showToast(t("toastRunStreamExportEmpty"));
          updateRunStreamExportButton();
          return;
        }
        runStreamExportPending = true;
        updateRunStreamExportButton();
        vscode.postMessage({
          type: "exportRunStream",
          records: buildRunStreamExportPayload(runtimeState),
          tabId: getActiveConversationTabId(),
          cli: state.currentCli,
        });
      }

      function handleRunStreamExportResult(data) {
        runStreamExportPending = false;
        updateRunStreamExportButton();
        if (!shouldHandleTabScopedEvent(data)) {
          return;
        }
        const errorMessage = typeof data.error === "string" ? data.error.trim() : "";
        if (errorMessage) {
          showToast(t("toastRunStreamExportFailed", { error: errorMessage }));
          return;
        }
        const exportPath = typeof data.path === "string" && data.path
          ? data.path
          : typeof data.fileName === "string"
            ? data.fileName
            : "";
        showToast(t("toastRunStreamExportSuccess", { path: exportPath }));
      }

      function updateQueueIndicator() {
        if (!elements.queueIndicator || !elements.queueCount) {
          return;
        }
        const runtimeState = getActiveConversationRuntimeState({ create: false });
        const count = runtimeState ? runtimeState.pendingPromptQueue.length : 0;
        elements.queueCount.textContent = String(count);
        elements.queueIndicator.style.display = count > 0 ? "inline-flex" : "none";
        updateRunWait();
        if (runtimeState && runtimeState.overlays.queue) {
          renderQueueOverlay();
        }
      }

      function normalizeQueueEditingState(runtimeState) {
        if (!runtimeState || runtimeState.queueEditingIndex < 0) {
          return;
        }
        if (runtimeState.queueEditingIndex >= runtimeState.pendingPromptQueue.length) {
          runtimeState.queueEditingIndex = -1;
          runtimeState.queueEditingDraft = "";
        }
      }

      function startQueuedPromptEdit(index) {
        const runtimeState = getActiveConversationRuntimeState();
        if (!runtimeState) {
          return;
        }
        if (index < 0 || index >= runtimeState.pendingPromptQueue.length) {
          return;
        }
        const payload = normalizePromptPayload(runtimeState.pendingPromptQueue[index]);
        if (!payload) {
          return;
        }
        runtimeState.queueEditingIndex = index;
        runtimeState.queueEditingDraft = payload.prompt;
        renderQueueOverlay();
      }

      function cancelQueuedPromptEdit() {
        const runtimeState = getActiveConversationRuntimeState({ create: false });
        if (!runtimeState || runtimeState.queueEditingIndex < 0) {
          return;
        }
        runtimeState.queueEditingIndex = -1;
        runtimeState.queueEditingDraft = "";
        renderQueueOverlay();
      }

      function saveQueuedPromptEdit() {
        const runtimeState = getActiveConversationRuntimeState({ create: false });
        if (!runtimeState) {
          return;
        }
        if (runtimeState.queueEditingIndex < 0 || runtimeState.queueEditingIndex >= runtimeState.pendingPromptQueue.length) {
          runtimeState.queueEditingIndex = -1;
          runtimeState.queueEditingDraft = "";
          renderQueueOverlay();
          return;
        }
        const nextPrompt = String(runtimeState.queueEditingDraft || "").trim();
        if (!nextPrompt) {
          showToast(t("toastQueueEmptyPrompt"));
          return;
        }
        const currentPayload = normalizePromptPayload(runtimeState.pendingPromptQueue[runtimeState.queueEditingIndex]);
        if (!currentPayload) {
          runtimeState.queueEditingIndex = -1;
          runtimeState.queueEditingDraft = "";
          renderQueueOverlay();
          return;
        }
        if (nextPrompt === currentPayload.prompt) {
          runtimeState.queueEditingIndex = -1;
          runtimeState.queueEditingDraft = "";
          renderQueueOverlay();
          return;
        }
        runtimeState.pendingPromptQueue[runtimeState.queueEditingIndex] = {
          prompt: nextPrompt,
          contextOptions: currentPayload.contextOptions,
        };
        runtimeState.queueEditingIndex = -1;
        runtimeState.queueEditingDraft = "";
        updateQueueIndicator();
        showToast(t("toastQueueUpdated"));
      }

      function renderQueueOverlay() {
        if (!elements.queueBody) {
          return;
        }
        const runtimeState = getActiveConversationRuntimeState({ create: false });
        const activeTabId = getActiveConversationTabId();
        if (elements.continueQueue) {
          const hasQueue = Boolean(runtimeState && runtimeState.pendingPromptQueue.length > 0);
          elements.continueQueue.disabled = !hasQueue || isTabRunning(activeTabId);
        }
        if (!runtimeState) {
          elements.queueBody.innerHTML = "";
          const empty = document.createElement("div");
          empty.className = "queue-empty";
          empty.textContent = t("queueEmpty");
          elements.queueBody.appendChild(empty);
          return;
        }
        normalizeQueueEditingState(runtimeState);
        elements.queueBody.innerHTML = "";
        if (!runtimeState.pendingPromptQueue.length) {
          const empty = document.createElement("div");
          empty.className = "queue-empty";
          empty.textContent = t("queueEmpty");
          elements.queueBody.appendChild(empty);
          return;
        }
        let editInputToFocus = null;
        runtimeState.pendingPromptQueue.forEach((item, index) => {
          const payload = normalizePromptPayload(item);
          const promptText = payload ? payload.prompt : "";
          const isEditing = runtimeState.queueEditingIndex === index;
          const row = document.createElement("div");
          row.className = "queue-item";

          if (isEditing) {
            const editor = document.createElement("textarea");
            editor.className = "queue-edit-input";
            editor.placeholder = t("queueEditPlaceholder");
            editor.value = runtimeState.queueEditingDraft;
            editor.addEventListener("input", () => {
              runtimeState.queueEditingDraft = editor.value;
            });
            editor.addEventListener("keydown", (event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                event.preventDefault();
                saveQueuedPromptEdit();
                return;
              }
              if (event.key === "Escape") {
                event.preventDefault();
                cancelQueuedPromptEdit();
              }
            });
            editInputToFocus = editor;
            row.appendChild(editor);
          } else {
            const textNode = document.createElement("div");
            textNode.className = "queue-text";
            const previewText =
              promptText.length > queuePromptPreviewLimit
                ? promptText.slice(0, Math.max(0, queuePromptPreviewLimit - queuePromptPreviewSuffix.length)) +
                  queuePromptPreviewSuffix
                : promptText;
            textNode.textContent = previewText;
            if (previewText !== promptText) {
              textNode.title = promptText;
            }
            row.appendChild(textNode);
          }

          const actions = document.createElement("div");
          actions.className = "queue-actions";

          if (isEditing) {
            const cancelButton = document.createElement("button");
            cancelButton.className = "ghost queue-edit-button";
            cancelButton.textContent = t("queueCancelEditLabel");
            cancelButton.addEventListener("click", () => {
              cancelQueuedPromptEdit();
            });

            const saveButton = document.createElement("button");
            saveButton.className = "secondary queue-edit-button";
            saveButton.textContent = t("queueSaveLabel");
            saveButton.addEventListener("click", () => {
              saveQueuedPromptEdit();
            });

            actions.appendChild(cancelButton);
            actions.appendChild(saveButton);
          } else {
            const editButton = document.createElement("button");
            editButton.className = "secondary queue-edit-button";
            editButton.textContent = t("queueEditLabel");
            editButton.addEventListener("click", () => {
              startQueuedPromptEdit(index);
            });
            actions.appendChild(editButton);
          }

          const moveUpButton = document.createElement("button");
          moveUpButton.className = "icon-button queue-order-button";
          moveUpButton.setAttribute("aria-label", t("queueMoveUpLabel"));
          moveUpButton.setAttribute("title", t("queueMoveUpLabel"));
          moveUpButton.innerHTML =
            '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" ' +
            'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
            '<line x1="12" y1="18" x2="12" y2="6" />' +
            '<polyline points="6 12 12 6 18 12" />' +
            "</svg>";
          moveUpButton.disabled = index === 0;
          moveUpButton.addEventListener("click", () => {
            moveQueuedPrompt(index, index - 1);
          });

          const moveDownButton = document.createElement("button");
          moveDownButton.className = "icon-button queue-order-button";
          moveDownButton.setAttribute("aria-label", t("queueMoveDownLabel"));
          moveDownButton.setAttribute("title", t("queueMoveDownLabel"));
          moveDownButton.innerHTML =
            '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" ' +
            'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
            '<line x1="12" y1="6" x2="12" y2="18" />' +
            '<polyline points="6 12 12 18 18 12" />' +
            "</svg>";
          moveDownButton.disabled = index === runtimeState.pendingPromptQueue.length - 1;
          moveDownButton.addEventListener("click", () => {
            moveQueuedPrompt(index, index + 1);
          });

          const removeButton = document.createElement("button");
          removeButton.className = "icon-button queue-remove-button";
          removeButton.setAttribute("aria-label", t("queueRemoveLabel"));
          removeButton.setAttribute("title", t("queueRemoveLabel"));
          removeButton.innerHTML =
            '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" ' +
            'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
            '<line x1="6" y1="6" x2="18" y2="18" />' +
            '<line x1="18" y1="6" x2="6" y2="18" />' +
            "</svg>";
          removeButton.addEventListener("click", () => {
            clearQueuedPromptIndex(index);
          });

          actions.appendChild(moveUpButton);
          actions.appendChild(moveDownButton);
          actions.appendChild(removeButton);
          row.appendChild(actions);
          elements.queueBody.appendChild(row);
        });
        if (editInputToFocus) {
          setTimeout(() => {
            editInputToFocus.focus();
            const length = editInputToFocus.value.length;
            editInputToFocus.setSelectionRange(length, length);
          }, 0);
        }
      }

      function syncQueueOverlay() {
        if (!elements.queueOverlay) {
          return;
        }
        const runtimeState = getActiveConversationRuntimeState({ create: false });
        const visible = Boolean(runtimeState && runtimeState.overlays.queue);
        if (visible) {
          renderQueueOverlay();
        }
        elements.queueOverlay.classList.toggle("visible", visible);
      }

      function openQueueOverlay() {
        const runtimeState = getActiveConversationRuntimeState();
        if (!runtimeState) {
          return;
        }
        runtimeState.overlays.queue = true;
        syncQueueOverlay();
      }

      function closeQueueOverlay() {
        const runtimeState = getActiveConversationRuntimeState({ create: false });
        if (runtimeState) {
          runtimeState.overlays.queue = false;
        }
        syncQueueOverlay();
      }

      function queuePromptForLater(payload) {
        const normalizedPayload = normalizePromptPayload(payload);
        if (!normalizedPayload) {
          return;
        }
        const runtimeState = getActiveConversationRuntimeState();
        if (!runtimeState) {
          return;
        }
        runtimeState.pendingPromptQueue.push(normalizedPayload);
        updateQueueIndicator();
        showToast(t("toastQueueAdded"));
      }

      function moveQueuedPrompt(fromIndex, toIndex) {
        const runtimeState = getActiveConversationRuntimeState({ create: false });
        if (!runtimeState) {
          return;
        }
        if (fromIndex < 0 || fromIndex >= runtimeState.pendingPromptQueue.length) {
          return;
        }
        if (toIndex < 0 || toIndex >= runtimeState.pendingPromptQueue.length) {
          return;
        }
        if (fromIndex === toIndex) {
          return;
        }
        const moved = runtimeState.pendingPromptQueue.splice(fromIndex, 1);
        if (!moved.length) {
          return;
        }
        runtimeState.pendingPromptQueue.splice(toIndex, 0, moved[0]);

        if (runtimeState.queueEditingIndex === fromIndex) {
          runtimeState.queueEditingIndex = toIndex;
        } else if (fromIndex < runtimeState.queueEditingIndex && runtimeState.queueEditingIndex <= toIndex) {
          runtimeState.queueEditingIndex -= 1;
        } else if (toIndex <= runtimeState.queueEditingIndex && runtimeState.queueEditingIndex < fromIndex) {
          runtimeState.queueEditingIndex += 1;
        }

        updateQueueIndicator();
      }

      function clearQueuedPromptIndex(index) {
        const runtimeState = getActiveConversationRuntimeState({ create: false });
        if (!runtimeState) {
          return;
        }
        if (index < 0 || index >= runtimeState.pendingPromptQueue.length) {
          return;
        }
        runtimeState.pendingPromptQueue.splice(index, 1);
        if (runtimeState.queueEditingIndex === index) {
          runtimeState.queueEditingIndex = -1;
          runtimeState.queueEditingDraft = "";
        } else if (runtimeState.queueEditingIndex > index) {
          runtimeState.queueEditingIndex -= 1;
        }
        updateQueueIndicator();
      }

      function flushPendingPromptQueue(tabId) {
        const targetTabId = typeof tabId === "string" && tabId ? tabId : getActiveConversationTabId();
        if (isTabRunning(targetTabId)) {
          return false;
        }
        const runtimeState = getConversationRuntimeState(targetTabId, { create: false });
        if (!runtimeState || !runtimeState.pendingPromptQueue.length) {
          return false;
        }
        const nextPromptPayload = runtimeState.pendingPromptQueue.shift();
        if (runtimeState.queueEditingIndex === 0) {
          runtimeState.queueEditingIndex = -1;
          runtimeState.queueEditingDraft = "";
        } else if (runtimeState.queueEditingIndex > 0) {
          runtimeState.queueEditingIndex -= 1;
        }
        if (isRuntimeStateForActiveTab(targetTabId)) {
          updateQueueIndicator();
        }
        const sent = dispatchPrompt(nextPromptPayload, {
          tabId: targetTabId,
          preserveActiveTab: !isRuntimeStateForActiveTab(targetTabId),
        });
        if (!sent && isRuntimeStateForActiveTab(targetTabId)) {
          showToast(t("toastQueueSendFailed"));
        }
        return sent;
      }

      function continueQueuedPrompts(tabId) {
        const targetTabId = typeof tabId === "string" && tabId ? tabId : getActiveConversationTabId();
        const sent = flushPendingPromptQueue(targetTabId);
        if (sent) {
          closeQueueOverlay();
        } else {
          syncQueueOverlay();
        }
      }

      function sendPrompt() {
        const prompt = elements.promptInput.value.trim();
        if (!prompt) {
          return;
        }
        const promptPayload = buildPromptPayload(prompt);
        if (state.isRunning) {
          openRunConflictOverlay(promptPayload);
          return;
        }
        elements.promptInput.value = "";
        const sent = dispatchPrompt(promptPayload);
        if (sent) {
          resetPromptContextForNextPrompt();
        }
      }

      function insertPromptText(text) {
        const input = elements.promptInput;
        const value = input.value || "";
        const selectionStart = typeof input.selectionStart === "number" ? input.selectionStart : value.length;
        const selectionEnd = typeof input.selectionEnd === "number" ? input.selectionEnd : value.length;
        input.value = value.slice(0, selectionStart) + text + value.slice(selectionEnd);
        const nextPos = selectionStart + text.length;
        input.selectionStart = nextPos;
        input.selectionEnd = nextPos;
        input.focus();
      }

      function buildInsertText(paths, prefix = "@") {
        if (!Array.isArray(paths) || paths.length === 0) {
          return "";
        }
        return paths.map((item) => prefix + item).join(" ") + " ";
      }

      function requestWorkspacePathPick() {
        vscode.postMessage({ type: "pickWorkspacePath" });
      }

      function readFileAsDataUrl(file) {
        return new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
            if (typeof reader.result === "string") {
              resolve(reader.result);
              return;
            }
            reject(new Error(t("toastFileReadFailed")));
          };
          reader.onerror = () => {
            reject(new Error(t("toastFileReadFailed")));
          };
          reader.readAsDataURL(file);
        });
      }

      async function handleFileSelection(fileList) {
        if (!fileList || fileList.length === 0) {
          return;
        }
        const files = Array.from(fileList);
        try {
          const payloadFiles = [];
          for (const file of files) {
            const dataUrl = await readFileAsDataUrl(file);
            payloadFiles.push({ name: file.name, type: file.type || "", dataUrl });
          }
          vscode.postMessage({ type: "uploadFiles", files: payloadFiles });
        } catch (error) {
          appendMessage({
            id: createMessageId(),
            role: "system",
            content: t("toastReadFileFailed"),
          });
        }
      }

      function getClipboardFiles(event) {
        const items = event.clipboardData && event.clipboardData.items
          ? Array.from(event.clipboardData.items)
          : [];
        const files = items
          .filter((item) => item.kind === "file")
          .map((item) => item.getAsFile())
          .filter((file) => file);
        return files;
      }

      function getDropUris(event) {
        const dataTransfer = event.dataTransfer;
        if (!dataTransfer) {
          return [];
        }
        const uriLines = (dataTransfer.getData("text/uri-list") || "")
          .split(/\\r?\\n/)
          .map((line) => line.trim())
          .filter((line) => line && !line.startsWith("#"));
        const uris = new Set(uriLines);
        const textData = (dataTransfer.getData("text/plain") || "").trim();
        if (textData.startsWith("file://")) {
          uris.add(textData);
        }
        return Array.from(uris);
      }

      function createMessageId() {
        return "web_" + Date.now() + "_" + Math.random().toString(16).slice(2);
      }

      function formatDateTime(timestamp) {
        const date = new Date(timestamp);
        const pad = (value) => String(value).padStart(2, "0");
        const year = date.getFullYear();
        const month = pad(date.getMonth() + 1);
        const day = pad(date.getDate());
        const hours = pad(date.getHours());
        const minutes = pad(date.getMinutes());
        const seconds = pad(date.getSeconds());
        return year + "-" + month + "-" + day + " " + hours + ":" + minutes + ":" + seconds;
      }

      function formatDateTimeWithMs(timestamp) {
        const date = new Date(timestamp);
        const pad = (value) => String(value).padStart(2, "0");
        const padMs = (value) => String(value).padStart(3, "0");
        const year = date.getFullYear();
        const month = pad(date.getMonth() + 1);
        const day = pad(date.getDate());
        const hours = pad(date.getHours());
        const minutes = pad(date.getMinutes());
        const seconds = pad(date.getSeconds());
        const ms = padMs(date.getMilliseconds());
        return year + "-" + month + "-" + day + " " + hours + ":" + minutes + ":" + seconds + "." + ms;
      }

      elements.currentCli.addEventListener("change", (event) => {
        armPromptContextForConversationStart();
        vscode.postMessage({ type: "selectCli", cli: event.target.value });
      });

      elements.configSelect.addEventListener("change", (event) => {
        state.selectedConfigId = event.target.value || "";
        state.selectedModel = "";
        if (state.selectedModelsByCli) {
          state.selectedModelsByCli[state.currentCli] = "";
        }
        if (state.selectedLobsterMainModelsByCli) {
          state.selectedLobsterMainModelsByCli[state.currentCli] = "";
        }
        if (state.selectedLobsterSubtaskModelsByCli) {
          state.selectedLobsterSubtaskModelsByCli[state.currentCli] = "";
        }
        if (state.modelsByCli) {
          state.modelsByCli[state.currentCli] = [];
        }
        if (state.lobsterMainModelsByCli) {
          state.lobsterMainModelsByCli[state.currentCli] = [];
        }
        if (state.lobsterSubtaskModelsByCli) {
          state.lobsterSubtaskModelsByCli[state.currentCli] = [];
        }
        if (state.managedModelsByCli) {
          state.managedModelsByCli[state.currentCli] = [];
        }
        if (state.managedModelRolesByCli) {
          state.managedModelRolesByCli[state.currentCli] = {};
        }
        if (elements.modelSelect) {
          updateModelSelectOptions();
        }
        updateLobsterModelSelectOptions();
        if (elements.addModelOverlay && elements.addModelOverlay.classList.contains("visible")) {
          renderModelManagerList();
        }
        if (!state.selectedConfigId) {
          return;
        }
        vscode.postMessage({
          type: "applyConfig",
          cli: state.currentCli,
          configId: state.selectedConfigId,
        });
      });

      function resetActiveViewForNewConversation() {
        setMessagesForTab(getActiveConversationTabId(), []);
        renderMessages();
        renderTaskList();
      }

      function syncResetSessionAvailability() {
        const resetLocked = isActiveConversationTabResetLocked();
        if (elements.resetSession) {
          elements.resetSession.disabled = resetLocked;
        }
        if (elements.clearAllHistory) {
          elements.clearAllHistory.disabled = state.historyTab === "lobster" || (state.historyTab === "sessions" && resetLocked);
        }
      }

      function requestResetConversationTabSession() {
        if (isActiveConversationTabResetLocked()) {
          return;
        }
        applyAutoInteractiveModeForTab(null);
        const activeTabId = getActiveConversationTabId();
        if (activeTabId) {
          resetConversationRuntimeState(activeTabId);
        }
        resetActiveViewForNewConversation();
        armPromptContextForConversationStart();
        vscode.postMessage({ type: "resetConversationTabSession" });
      }

      elements.newSession.addEventListener("click", () => {
        applyAutoInteractiveModeForTab(null);
        resetActiveViewForNewConversation();
        armPromptContextForConversationStart();
        vscode.postMessage({ type: "newSession" });
      });

      if (elements.resetSession) {
        elements.resetSession.addEventListener("click", () => {
          requestResetConversationTabSession();
        });
      }

      if (elements.taskListDetails) {
        elements.taskListDetails.addEventListener("toggle", () => {
          const taskListState = getActiveTaskListState({ create: false });
          const hasItems = Boolean(taskListState && Array.isArray(taskListState.items) && taskListState.items.length);
          if (taskListState) {
            taskListState.open = hasItems ? elements.taskListDetails.open : false;
          }
        });
      }

      if (elements.resultOnlyToggle) {
        elements.resultOnlyToggle.addEventListener("change", (event) => {
          state.onlyShowFinalResults = Boolean(event.target.checked);
          persistWebviewUiState();
          renderMessages();
        });
      }

      elements.thinkingMode.addEventListener("change", (event) => {
        const nextMode = event.target.value || "off";
        state.thinkingMode = nextMode;
        vscode.postMessage({
          type: "updateSetting",
          key: "thinkingMode",
          value: nextMode,
        });
      });

      // Model selection management
      const MODEL_MANAGE_OPTION_VALUE = "__manage__";
      let editingModelName = "";

      function cliSupportsManagedModelSelection(cli = state.currentCli) {
        return cli === "codex" || cli === "gemini";
      }

      function getModelsForCurrentCli() {
        const cli = state.currentCli;
        const models = state.modelsByCli && Array.isArray(state.modelsByCli[cli])
          ? state.modelsByCli[cli]
          : [];
        return models;
      }

      function getManagedModelsForCurrentCli() {
        const cli = state.currentCli;
        const models = state.managedModelsByCli && Array.isArray(state.managedModelsByCli[cli])
          ? state.managedModelsByCli[cli]
          : [];
        return models;
      }

      function getLobsterMainModelsForCurrentCli() {
        const cli = state.currentCli;
        const models = state.lobsterMainModelsByCli && Array.isArray(state.lobsterMainModelsByCli[cli])
          ? state.lobsterMainModelsByCli[cli]
          : [];
        return models;
      }

      function getLobsterSubtaskModelsForCurrentCli() {
        const cli = state.currentCli;
        const models = state.lobsterSubtaskModelsByCli && Array.isArray(state.lobsterSubtaskModelsByCli[cli])
          ? state.lobsterSubtaskModelsByCli[cli]
          : [];
        return models;
      }

      function getManagedModelLobsterRolesForCurrentCli(modelName) {
        const cli = state.currentCli;
        const roleMap = state.managedModelRolesByCli && state.managedModelRolesByCli[cli]
          ? state.managedModelRolesByCli[cli]
          : {};
        const roleEntry = roleMap && typeof roleMap === "object"
          ? roleMap[modelName]
          : null;
        if (!roleEntry || typeof roleEntry !== "object") {
          return { main: true, subtask: true };
        }
        const main = roleEntry.main !== false;
        const subtask = roleEntry.subtask !== false;
        if (!main && !subtask) {
          return { main: true, subtask: true };
        }
        return { main, subtask };
      }

      function getCurrentModelConfigId() {
        return state.selectedConfigId || state.configState.activeConfigId || null;
      }

      function reportModelManagerInspection() {
        if (!cliSupportsManagedModelSelection()) {
          return;
        }
        vscode.postMessage({
          type: "inspectModelManager",
          cli: state.currentCli,
          configId: getCurrentModelConfigId(),
          visibleModelCount: getModelsForCurrentCli().length,
          visibleManagedModelCount: getManagedModelsForCurrentCli().length,
          selectedModel: state.selectedModel || null,
        });
      }

      function showModelManageError(message) {
        elements.modelAddError.textContent = message;
        elements.modelAddError.style.display = "block";
      }

      function clearModelManageError() {
        elements.modelAddError.textContent = "";
        elements.modelAddError.style.display = "none";
      }

      function syncModelManageForm() {
        const isEditing = Boolean(editingModelName);
        if (elements.modelEditHint) {
          elements.modelEditHint.textContent = isEditing ? t("modelManageEditing", { model: editingModelName }) : "";
          elements.modelEditHint.style.display = isEditing ? "block" : "none";
        }
        if (elements.clearModelEdit) {
          elements.clearModelEdit.style.display = isEditing ? "inline-flex" : "none";
        }
        if (elements.confirmAddModel) {
          elements.confirmAddModel.textContent = isEditing ? t("modelSaveButton") : t("modelAddButton");
        }
      }

      function resetModelManageForm() {
        editingModelName = "";
        elements.modelInput.value = "";
        clearModelManageError();
        syncModelManageForm();
      }

      function startEditModel(modelName) {
        editingModelName = modelName;
        elements.modelInput.value = modelName;
        clearModelManageError();
        syncModelManageForm();
        elements.modelInput.focus();
        elements.modelInput.select();
      }

      function renderModelManagerList() {
        if (!elements.modelManagerList) {
          return;
        }
        const availableModels = getManagedModelsForCurrentCli();
        elements.modelManagerList.innerHTML = "";
        if (!availableModels.length) {
          const empty = document.createElement("div");
          empty.className = "model-manager-empty";
          empty.textContent = t("modelManageEmpty");
          elements.modelManagerList.appendChild(empty);
          return;
        }
        availableModels.forEach((modelName, index) => {
          const item = document.createElement("div");
          item.className = "model-manager-item";

          const meta = document.createElement("div");
          meta.className = "model-manager-meta";

          const name = document.createElement("div");
          name.className = "model-manager-name";
          name.textContent = modelName;
          meta.appendChild(name);

          const roleFlags = getManagedModelLobsterRolesForCurrentCli(modelName);
          const roleRow = document.createElement("div");
          roleRow.className = "model-manager-role-row";
          const mainRoleLabel = document.createElement("label");
          mainRoleLabel.className = "model-manager-role-toggle";
          const mainRoleInput = document.createElement("input");
          mainRoleInput.type = "checkbox";
          mainRoleInput.checked = roleFlags.main;
          mainRoleLabel.appendChild(mainRoleInput);
          mainRoleLabel.appendChild(document.createTextNode(t("modelManageRoleMain")));
          roleRow.appendChild(mainRoleLabel);

          const subtaskRoleLabel = document.createElement("label");
          subtaskRoleLabel.className = "model-manager-role-toggle";
          const subtaskRoleInput = document.createElement("input");
          subtaskRoleInput.type = "checkbox";
          subtaskRoleInput.checked = roleFlags.subtask;
          subtaskRoleLabel.appendChild(subtaskRoleInput);
          subtaskRoleLabel.appendChild(document.createTextNode(t("modelManageRoleSubtask")));
          roleRow.appendChild(subtaskRoleLabel);

          const handleRoleChange = (role, input, otherInput) => {
            if (!input.checked && !otherInput.checked) {
              input.checked = true;
              return;
            }
            vscode.postMessage({
              type: "setCliModelLobsterRole",
              cli: state.currentCli,
              model: modelName,
              role,
              enabled: Boolean(input.checked),
              configId: getCurrentModelConfigId(),
            });
          };
          mainRoleInput.addEventListener("change", () => {
            handleRoleChange("main", mainRoleInput, subtaskRoleInput);
          });
          subtaskRoleInput.addEventListener("change", () => {
            handleRoleChange("subtask", subtaskRoleInput, mainRoleInput);
          });
          meta.appendChild(roleRow);
          item.appendChild(meta);

          const actions = document.createElement("div");
          actions.className = "model-manager-actions";

          const editButton = document.createElement("button");
          editButton.type = "button";
          editButton.className = "secondary action-button model-manager-button";
          editButton.textContent = t("modelEditLabel");
          editButton.addEventListener("click", () => {
            startEditModel(modelName);
          });
          actions.appendChild(editButton);

          const moveUpButton = document.createElement("button");
          moveUpButton.type = "button";
          moveUpButton.className = "secondary action-button model-manager-button";
          moveUpButton.textContent = t("modelMoveUpLabel");
          moveUpButton.disabled = index === 0;
          moveUpButton.addEventListener("click", () => {
            vscode.postMessage({
              type: "moveCliModel",
              cli: state.currentCli,
              model: modelName,
              direction: "up",
              configId: getCurrentModelConfigId(),
            });
          });
          actions.appendChild(moveUpButton);

          const moveDownButton = document.createElement("button");
          moveDownButton.type = "button";
          moveDownButton.className = "secondary action-button model-manager-button";
          moveDownButton.textContent = t("modelMoveDownLabel");
          moveDownButton.disabled = index === availableModels.length - 1;
          moveDownButton.addEventListener("click", () => {
            vscode.postMessage({
              type: "moveCliModel",
              cli: state.currentCli,
              model: modelName,
              direction: "down",
              configId: getCurrentModelConfigId(),
            });
          });
          actions.appendChild(moveDownButton);

          const deleteButton = document.createElement("button");
          deleteButton.type = "button";
          deleteButton.className = "secondary action-button model-manager-button";
          deleteButton.textContent = t("modelRemoveLabel");
          deleteButton.addEventListener("click", () => {
            if (editingModelName && editingModelName.toLowerCase() === String(modelName).toLowerCase()) {
              resetModelManageForm();
            }
            vscode.postMessage({
              type: "deleteCliModel",
              cli: state.currentCli,
              model: modelName,
              configId: getCurrentModelConfigId(),
            });
          });
          actions.appendChild(deleteButton);

          item.appendChild(actions);
          elements.modelManagerList.appendChild(item);
        });
      }

      function updateModelSelectOptions() {
        if (!elements.modelSelect) {
          return;
        }
        const availableModels = getModelsForCurrentCli();
        elements.modelSelect.innerHTML = "";

        const defaultOption = document.createElement("option");
        defaultOption.value = "";
        defaultOption.textContent = t("modelOptionDefault");
        elements.modelSelect.appendChild(defaultOption);

        availableModels.forEach((modelName) => {
          const option = document.createElement("option");
          option.value = modelName;
          option.textContent = modelName;
          elements.modelSelect.appendChild(option);
        });

        const manageOption = document.createElement("option");
        manageOption.value = MODEL_MANAGE_OPTION_VALUE;
        manageOption.textContent = t("modelOptionManage");
        elements.modelSelect.appendChild(manageOption);

        const nextValue = typeof state.selectedModel === "string" ? state.selectedModel : "";
        if (nextValue && availableModels.includes(nextValue)) {
          elements.modelSelect.value = nextValue;
          return;
        }
        elements.modelSelect.value = "";
      }

      function fillModelSelectWithOptions(selectElement, options, defaultLabel, selectedValue) {
        if (!selectElement) {
          return;
        }
        const normalizedOptions = Array.isArray(options) ? options : [];
        selectElement.innerHTML = "";
        const defaultOption = document.createElement("option");
        defaultOption.value = "";
        defaultOption.textContent = defaultLabel;
        selectElement.appendChild(defaultOption);
        normalizedOptions.forEach((modelName) => {
          const option = document.createElement("option");
          option.value = modelName;
          option.textContent = modelName;
          selectElement.appendChild(option);
        });
        const manageOption = document.createElement("option");
        manageOption.value = MODEL_MANAGE_OPTION_VALUE;
        manageOption.textContent = t("modelOptionManage");
        selectElement.appendChild(manageOption);
        if (selectedValue && normalizedOptions.includes(selectedValue)) {
          selectElement.value = selectedValue;
          return;
        }
        selectElement.value = "";
      }

      function updateLobsterModelSelectOptions() {
        fillModelSelectWithOptions(
          elements.lobsterMainModelSelect,
          getLobsterMainModelsForCurrentCli(),
          t("modelOptionMainDefault"),
          state.selectedLobsterMainModelsByCli ? state.selectedLobsterMainModelsByCli[state.currentCli] : ""
        );
        fillModelSelectWithOptions(
          elements.lobsterSubtaskModelSelect,
          getLobsterSubtaskModelsForCurrentCli(),
          t("modelOptionSubtaskDefault"),
          state.selectedLobsterSubtaskModelsByCli ? state.selectedLobsterSubtaskModelsByCli[state.currentCli] : ""
        );
      }

      function syncModelSelectorByInteractiveMode() {
        const supportsModelSelection = cliSupportsManagedModelSelection();
        const isLobster = normalizeInteractiveMode(state.interactiveMode) === "lobster";
        const showSingleModelSelect = supportsModelSelection && !isLobster;
        const showLobsterExecutionModeSelect = isLobster;
        const showLobsterModelSelect = supportsModelSelection && isLobster;
        if (elements.modelSelect) {
          elements.modelSelect.style.display = showSingleModelSelect ? "" : "none";
          elements.modelSelect.disabled = !showSingleModelSelect;
        }
        if (elements.lobsterModelGroup) {
          elements.lobsterModelGroup.style.display = showLobsterExecutionModeSelect ? "inline-flex" : "none";
        }
        if (elements.lobsterExecutionModeSelect) {
          elements.lobsterExecutionModeSelect.disabled = !showLobsterExecutionModeSelect;
          elements.lobsterExecutionModeSelect.value = getLobsterExecutionModeForCli();
        }
        if (elements.lobsterMainModelSelect) {
          elements.lobsterMainModelSelect.style.display = showLobsterModelSelect ? "" : "none";
          elements.lobsterMainModelSelect.disabled = !showLobsterModelSelect;
        }
        if (elements.lobsterSubtaskModelSelect) {
          elements.lobsterSubtaskModelSelect.style.display = showLobsterModelSelect ? "" : "none";
          elements.lobsterSubtaskModelSelect.disabled = !showLobsterModelSelect;
        }
        if (!supportsModelSelection) {
          hideAddModelDialog();
        }
      }

      function showAddModelDialog() {
        if (!elements.addModelOverlay || !cliSupportsManagedModelSelection()) {
          return;
        }
        if (elements.modelSelect) {
          elements.modelSelect.value = state.selectedModel || "";
        }
        if (elements.lobsterMainModelSelect) {
          const selectedMain = state.selectedLobsterMainModelsByCli
            ? state.selectedLobsterMainModelsByCli[state.currentCli]
            : "";
          elements.lobsterMainModelSelect.value = selectedMain || "";
        }
        if (elements.lobsterSubtaskModelSelect) {
          const selectedSubtask = state.selectedLobsterSubtaskModelsByCli
            ? state.selectedLobsterSubtaskModelsByCli[state.currentCli]
            : "";
          elements.lobsterSubtaskModelSelect.value = selectedSubtask || "";
        }
        resetModelManageForm();
        renderModelManagerList();
        reportModelManagerInspection();
        elements.addModelOverlay.classList.add("visible");
        elements.modelInput.focus();
      }

      function hideAddModelDialog() {
        if (!elements.addModelOverlay) {
          return;
        }
        elements.addModelOverlay.classList.remove("visible");
        resetModelManageForm();
        if (elements.modelSelect) {
          elements.modelSelect.value = state.selectedModel || "";
        }
        if (elements.lobsterMainModelSelect) {
          const selectedMain = state.selectedLobsterMainModelsByCli
            ? state.selectedLobsterMainModelsByCli[state.currentCli]
            : "";
          elements.lobsterMainModelSelect.value = selectedMain || "";
        }
        if (elements.lobsterSubtaskModelSelect) {
          const selectedSubtask = state.selectedLobsterSubtaskModelsByCli
            ? state.selectedLobsterSubtaskModelsByCli[state.currentCli]
            : "";
          elements.lobsterSubtaskModelSelect.value = selectedSubtask || "";
        }
      }

      function confirmAddModel() {
        if (!cliSupportsManagedModelSelection()) {
          return;
        }
        const modelName = elements.modelInput.value.trim();
        if (!modelName) {
          showModelManageError(t("modelAddEmptyError"));
          return;
        }
        const existingModels = getModelsForCurrentCli();
        const editingKey = editingModelName ? editingModelName.toLowerCase() : "";
        const duplicate = existingModels.some((model) => {
          const currentKey = String(model).toLowerCase();
          return currentKey === modelName.toLowerCase() && currentKey !== editingKey;
        });
        if (duplicate) {
          showModelManageError(t("modelAddExistsError"));
          return;
        }
        if (editingModelName) {
          vscode.postMessage({
            type: "renameCliModel",
            cli: state.currentCli,
            previousModel: editingModelName,
            nextModel: modelName,
            configId: getCurrentModelConfigId(),
          });
        } else {
          vscode.postMessage({
            type: "addCliModel",
            cli: state.currentCli,
            model: modelName,
            configId: getCurrentModelConfigId(),
          });
        }
        resetModelManageForm();
      }

      if (elements.addModelOverlay) {
        elements.closeAddModel.addEventListener("click", hideAddModelDialog);
        elements.cancelAddModel.addEventListener("click", hideAddModelDialog);
        if (elements.clearModelEdit) {
          elements.clearModelEdit.addEventListener("click", resetModelManageForm);
        }
        elements.confirmAddModel.addEventListener("click", confirmAddModel);
        elements.addModelOverlay.addEventListener("click", (event) => {
          if (event.target === elements.addModelOverlay) {
            hideAddModelDialog();
          }
        });
        elements.modelInput.addEventListener("keydown", (event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            confirmAddModel();
          } else if (event.key === "Escape") {
            hideAddModelDialog();
          }
        });
      }

      if (elements.modelSelect) {
        updateModelSelectOptions();
        elements.modelSelect.addEventListener("change", (event) => {
          const value = event.target.value || "";
          if (value === MODEL_MANAGE_OPTION_VALUE) {
            showAddModelDialog();
            return;
          }
          state.selectedModel = value;
          if (state.selectedModelsByCli) {
            state.selectedModelsByCli[state.currentCli] = value;
          }
          vscode.postMessage({
            type: "selectCliModel",
            cli: state.currentCli,
            model: value || null,
            configId: getCurrentModelConfigId(),
          });
        });
      }
      updateLobsterModelSelectOptions();
      syncModelSelectorByInteractiveMode();

      if (elements.lobsterMainModelSelect) {
        elements.lobsterMainModelSelect.addEventListener("change", (event) => {
          const value = event.target.value || "";
          if (value === MODEL_MANAGE_OPTION_VALUE) {
            showAddModelDialog();
            return;
          }
          if (state.selectedLobsterMainModelsByCli) {
            state.selectedLobsterMainModelsByCli[state.currentCli] = value;
          }
          vscode.postMessage({
            type: "selectCliLobsterModel",
            cli: state.currentCli,
            role: "main",
            model: value || null,
            configId: getCurrentModelConfigId(),
          });
        });
      }

      if (elements.lobsterSubtaskModelSelect) {
        elements.lobsterSubtaskModelSelect.addEventListener("change", (event) => {
          const value = event.target.value || "";
          if (value === MODEL_MANAGE_OPTION_VALUE) {
            showAddModelDialog();
            return;
          }
          if (state.selectedLobsterSubtaskModelsByCli) {
            state.selectedLobsterSubtaskModelsByCli[state.currentCli] = value;
          }
          vscode.postMessage({
            type: "selectCliLobsterModel",
            cli: state.currentCli,
            role: "subtask",
            model: value || null,
            configId: getCurrentModelConfigId(),
          });
        });
      }

      if (elements.lobsterExecutionModeSelect) {
        elements.lobsterExecutionModeSelect.addEventListener("change", (event) => {
          const nextMode = setLobsterExecutionModeForCli(state.currentCli, event.target.value);
          elements.lobsterExecutionModeSelect.value = nextMode;
          vscode.postMessage({
            type: "updateSetting",
            key: "lobsterExecutionMode." + state.currentCli,
            value: nextMode,
          });
        });
      }

      if (elements.interactiveModeSelect) {
        elements.interactiveModeSelect.addEventListener("change", (event) => {
          const nextMode = normalizeInteractiveMode(event.target.value);
          state.interactiveMode = nextMode;
          syncModelSelectorByInteractiveMode();
          vscode.postMessage({
            type: "updateSetting",
            key: "interactiveMode." + state.currentCli,
            value: nextMode,
          });
        });
      }
      if (elements.debugMode) {
        elements.debugMode.addEventListener("change", (event) => {
          const enabled = Boolean(event.target.checked);
          state.debug = enabled;
          vscode.postMessage({
            type: "updateSetting",
            key: "debug",
            value: enabled,
          });
        });
      }
      if (elements.autoAddEditorContextTags) {
        elements.autoAddEditorContextTags.addEventListener("change", (event) => {
          const enabled = Boolean(event.target.checked);
          state.autoAddEditorContextTags = enabled;
          state.promptContext.autoIncludeArmed = true;
          state.promptContext.dismissedFileKey = "";
          state.promptContext.dismissedSelectionKey = "";
          syncPromptContextWithEditorContext({ resetDismissed: true });
          renderPromptContextTags();
          vscode.postMessage({
            type: "updateSetting",
            key: "autoAddEditorContextTags",
            value: enabled,
          });
        });
      }
      if (elements.longTermMemoryEnabled) {
        elements.longTermMemoryEnabled.addEventListener("change", (event) => {
          if (state.longTermMemoryManagedByProjectCh) {
            syncLongTermMemoryWorkspaceControl();
            return;
          }
          const enabled = Boolean(event.target.checked);
          state.longTermMemoryEnabled = enabled;
          state.workspaceMemoryEnabled = enabled;
          syncLongTermMemoryWorkspaceControl();
          vscode.postMessage({
            type: "updateSetting",
            key: "workspaceMemoryEnabled",
            value: enabled,
          });
        });
      }
      function setToolSettingsTab(scope) {
        const workspace = scope === "workspace";
        if (elements.toolSettingsGlobalTab) {
          elements.toolSettingsGlobalTab.classList.toggle("active", !workspace);
          elements.toolSettingsGlobalTab.setAttribute("aria-selected", workspace ? "false" : "true");
        }
        if (elements.toolSettingsWorkspaceTab) {
          elements.toolSettingsWorkspaceTab.classList.toggle("active", workspace);
          elements.toolSettingsWorkspaceTab.setAttribute("aria-selected", workspace ? "true" : "false");
        }
        if (elements.toolSettingsGlobalPanel) {
          elements.toolSettingsGlobalPanel.classList.toggle("active", !workspace);
        }
        if (elements.toolSettingsWorkspacePanel) {
          elements.toolSettingsWorkspacePanel.classList.toggle("active", workspace);
        }
      }
      if (elements.toolSettingsGlobalTab) {
        elements.toolSettingsGlobalTab.addEventListener("click", () => setToolSettingsTab("global"));
      }
      if (elements.toolSettingsWorkspaceTab) {
        elements.toolSettingsWorkspaceTab.addEventListener("click", () => setToolSettingsTab("workspace"));
      }
      if (elements.autoCompactContextAfterRun) {
        elements.autoCompactContextAfterRun.addEventListener("change", (event) => {
          const enabled = Boolean(event.target.checked);
          state.autoCompactContextAfterRun = enabled;
          vscode.postMessage({
            type: "updateSetting",
            key: "autoCompactContextAfterRun",
            value: enabled,
          });
        });
      }
      if (elements.codexMultiAgentEnabled) {
        elements.codexMultiAgentEnabled.addEventListener("change", (event) => {
          const enabled = Boolean(event.target.checked);
          state.codexMultiAgentEnabled = enabled;
          vscode.postMessage({
            type: "updateSetting",
            key: "codexMultiAgentEnabled",
            value: enabled,
          });
        });
      }
      if (elements.lobsterMaxRounds) {
        const commitLobsterMaxRounds = () => {
          const nextValue = normalizeLobsterMaxRounds(elements.lobsterMaxRounds.value);
          state.lobsterMaxRounds = nextValue;
          elements.lobsterMaxRounds.value = String(nextValue);
          vscode.postMessage({
            type: "updateSetting",
            key: "lobsterMaxRounds",
            value: nextValue,
          });
        };
        elements.lobsterMaxRounds.addEventListener("change", commitLobsterMaxRounds);
        elements.lobsterMaxRounds.addEventListener("blur", commitLobsterMaxRounds);
      }
      if (elements.lobsterAutoCloseSubtaskTabs) {
        elements.lobsterAutoCloseSubtaskTabs.addEventListener("change", (event) => {
          const enabled = Boolean(event.target.checked);
          state.lobsterAutoCloseSubtaskTabs = enabled;
          vscode.postMessage({
            type: "updateSetting",
            key: "lobsterAutoCloseSubtaskTabs",
            value: enabled,
          });
        });
      }
      if (elements.languageSelect) {
        elements.languageSelect.addEventListener("change", (event) => {
          const nextValue = event.target.value || "auto";
          state.locale = nextValue;
          vscode.postMessage({
            type: "updateSetting",
            key: "locale",
            value: nextValue,
          });
        });
      }
      if (elements.macTaskShell) {
        elements.macTaskShell.addEventListener("change", (event) => {
          const nextValue = event.target.value === "bash" ? "bash" : "zsh";
          state.macTaskShell = nextValue;
          vscode.postMessage({
            type: "updateSetting",
            key: "macTaskShell",
            value: nextValue,
          });
        });
      }

      elements.openConfig.addEventListener("click", () => {
        vscode.postMessage({ type: "openConfig" });
      });

      elements.attachmentButton.addEventListener("click", () => {
        elements.attachmentInput.click();
      });

      elements.attachmentInput.addEventListener("change", (event) => {
        const input = event.target;
        if (!input || !input.files) {
          return;
        }
        handleFileSelection(input.files);
        input.value = "";
      });

      function openHistory() {
        renderSessionList();
        renderPromptHistoryList();
        renderLobsterGroupChatHistoryList();
        setHistoryTab(state.historyTab);
        elements.historyOverlay.classList.add("visible");
      }

      function closeHistory() {
        elements.historyOverlay.classList.remove("visible");
      }

      function openRules() {
        elements.rulesOverlay.classList.add("visible");
      }

      function closeRules() {
        elements.rulesOverlay.classList.remove("visible");
      }

      function openHelp() {
        elements.helpOverlay.classList.add("visible");
      }

      function closeHelp() {
        elements.helpOverlay.classList.remove("visible");
      }

      function openToolSettings() {
        elements.toolSettingsOverlay.classList.add("visible");
      }

      function closeToolSettings() {
        elements.toolSettingsOverlay.classList.remove("visible");
      }

      function openCommonCommands() {
        elements.commonCommandsOverlay.classList.add("visible");
      }

      function closeCommonCommands() {
        elements.commonCommandsOverlay.classList.remove("visible");
      }

      function setHistoryTab(tab) {
        const isPrompts = tab === "prompts";
        const isLobster = tab === "lobster";
        const isSessions = !isPrompts && !isLobster;
        state.historyTab = isPrompts ? "prompts" : isLobster ? "lobster" : "sessions";
        elements.historyTabPrompts.classList.toggle("active", isPrompts);
        elements.historyTabSessions.classList.toggle("active", isSessions);
        elements.historyTabLobsterGroupChats.classList.toggle("active", isLobster);
        elements.historyTabPrompts.setAttribute("aria-selected", String(isPrompts));
        elements.historyTabSessions.setAttribute("aria-selected", String(isSessions));
        elements.historyTabLobsterGroupChats.setAttribute("aria-selected", String(isLobster));
        elements.historyPanelPrompts.classList.toggle("active", isPrompts);
        elements.historyPanelSessions.classList.toggle("active", isSessions);
        elements.historyPanelLobsterGroupChats.classList.toggle("active", isLobster);
        if (elements.clearAllHistory) {
          elements.clearAllHistory.textContent = isPrompts
            ? t("historyClearPrompts")
            : t("historyClearSessions");
        }
        syncResetSessionAvailability();
      }

      function setHelpTab(tab) {
        const isInstall = tab === "install";
        elements.helpTabInstall.classList.toggle("active", isInstall);
        elements.helpTabThinking.classList.toggle("active", !isInstall);
        elements.helpTabInstall.setAttribute("aria-selected", String(isInstall));
        elements.helpTabThinking.setAttribute("aria-selected", String(!isInstall));
        elements.helpPanelInstall.classList.toggle("active", isInstall);
        elements.helpPanelThinking.classList.toggle("active", !isInstall);
      }

      function setRulesHint(message) {
        elements.rulesHint.textContent = message || "";
      }

      function collectRuleTargets() {
        const targets = [];
        if (elements.rulesSaveCodex.checked) {
          targets.push("codex");
        }
        if (elements.rulesSaveClaude.checked) {
          targets.push("claude");
        }
        if (elements.rulesSaveGemini.checked) {
          targets.push("gemini");
        }
        return targets;
      }

      function updateRulesPath(cli) {
        if (!elements.rulesPath) {
          return;
        }
        const scopePaths = state.rulePaths ? state.rulePaths[state.ruleScope] : null;
        const pathText = scopePaths && scopePaths[cli] ? scopePaths[cli] : "";
        if (!pathText && state.ruleScope === "project") {
          elements.rulesPath.textContent = t("rulesPathNoWorkspace");
          return;
        }
        elements.rulesPath.textContent = pathText ? t("rulesPathPrefix") + pathText : "";
      }

      function updateRulesScope(scope) {
        state.ruleScope = scope;
        const isGlobal = scope === "global";
        elements.scopeGlobal.className = isGlobal ? "help-tab active" : "help-tab";
        elements.scopeProject.className = isGlobal ? "help-tab" : "help-tab active";
        elements.scopeGlobal.setAttribute("aria-selected", String(isGlobal));
        elements.scopeProject.setAttribute("aria-selected", String(!isGlobal));
        updateRulesPath(elements.rulesLoadCli.value);
      }

      elements.historyButton.addEventListener("click", () => {
        openHistory();
      });

      elements.closeHistory.addEventListener("click", () => {
        closeHistory();
      });

      elements.closeHistoryMessages.addEventListener("click", () => {
        closeHistorySessionMessages();
      });

      elements.exportHistoryMessages.addEventListener("click", () => {
        requestHistorySessionExport(null);
      });

      if (elements.clearAllHistory) {
        elements.clearAllHistory.addEventListener("click", () => {
          if (state.historyTab === "prompts") {
            vscode.postMessage({ type: "clearPromptHistory" });
            return;
          }
          if (state.historyTab === "lobster") {
            return;
          }
          requestResetConversationTabSession();
        });
      }

      elements.historyTabPrompts.addEventListener("click", () => {
        setHistoryTab("prompts");
      });

      elements.historyTabSessions.addEventListener("click", () => {
        setHistoryTab("sessions");
      });

      elements.historyTabLobsterGroupChats.addEventListener("click", () => {
        setHistoryTab("lobster");
      });

      elements.historyOverlay.addEventListener("click", (event) => {
        if (event.target === elements.historyOverlay) {
          closeHistory();
        }
      });

      elements.historyMessagesOverlay.addEventListener("click", (event) => {
        if (event.target === elements.historyMessagesOverlay) {
          closeHistorySessionMessages();
        }
      });

      elements.rulesButton.addEventListener("click", () => {
        setRulesHint("");
        updateRulesScope(state.ruleScope);
        openRules();
      });

      elements.closeRules.addEventListener("click", () => {
        closeRules();
      });

      elements.rulesOverlay.addEventListener("click", (event) => {
        if (event.target === elements.rulesOverlay) {
          closeRules();
        }
      });

      elements.helpButton.addEventListener("click", () => {
        setHelpTab("install");
        openHelp();
      });

      elements.closeHelp.addEventListener("click", () => {
        closeHelp();
      });

      elements.helpOverlay.addEventListener("click", (event) => {
        if (event.target === elements.helpOverlay) {
          closeHelp();
        }
      });

      elements.toolSettingsButton.addEventListener("click", () => {
        openToolSettings();
      });

      elements.closeToolSettings.addEventListener("click", () => {
        closeToolSettings();
      });

      elements.toolSettingsOverlay.addEventListener("click", (event) => {
        if (event.target === elements.toolSettingsOverlay) {
          closeToolSettings();
        }
      });

      elements.commonCommandButton.addEventListener("click", () => {
        openCommonCommands();
      });

      elements.closeCommonCommands.addEventListener("click", () => {
        closeCommonCommands();
      });

      elements.commonCommandsOverlay.addEventListener("click", (event) => {
        if (event.target === elements.commonCommandsOverlay) {
          closeCommonCommands();
        }
      });

      elements.commandCompact.addEventListener("click", () => {
        closeCommonCommands();
        vscode.postMessage({ type: "runCommonCommand", command: "compactContext" });
      });

      elements.runConflictOverlay.addEventListener("click", (event) => {
        if (event.target === elements.runConflictOverlay) {
          closeRunConflictOverlay();
        }
      });

      elements.closeRunConflict.addEventListener("click", () => {
        closeRunConflictOverlay();
      });

      elements.queuePrompt.addEventListener("click", () => {
        const runtimeState = getActiveConversationRuntimeState({ create: false });
        const promptPayload = normalizePromptPayload(runtimeState ? runtimeState.pendingRunPrompt : null);
        if (!promptPayload) {
          closeRunConflictOverlay();
          return;
        }
        queuePromptForLater(promptPayload);
        elements.promptInput.value = "";
        closeRunConflictOverlay();
        resetPromptContextForNextPrompt();
      });

      elements.pauseAndSend.addEventListener("click", () => {
        const runtimeState = getActiveConversationRuntimeState({ create: false });
        const promptPayload = normalizePromptPayload(runtimeState ? runtimeState.pendingRunPrompt : null);
        if (!promptPayload) {
          closeRunConflictOverlay();
          return;
        }
        elements.promptInput.value = "";
        closeRunConflictOverlay();
        const sent = dispatchPrompt(promptPayload);
        if (sent) {
          resetPromptContextForNextPrompt();
        }
      });

      elements.queueIndicator.addEventListener("click", () => {
        openQueueOverlay();
      });

      elements.continueQueue.addEventListener("click", () => {
        continueQueuedPrompts();
      });

      elements.runPromptButton.addEventListener("click", () => {
        openRunPromptOverlay();
      });

      elements.runStreamButton.addEventListener("click", () => {
        openRunStreamOverlay();
      });

      elements.exportRunStream.addEventListener("click", () => {
        requestRunStreamExport();
      });

      elements.runPromptOverlay.addEventListener("click", (event) => {
        if (event.target === elements.runPromptOverlay) {
          closeRunPromptOverlay();
        }
      });

      elements.closeRunPrompt.addEventListener("click", () => {
        closeRunPromptOverlay();
      });

      elements.runStreamOverlay.addEventListener("click", (event) => {
        if (event.target === elements.runStreamOverlay) {
          closeRunStreamOverlay();
        }
      });

      elements.closeRunStream.addEventListener("click", () => {
        closeRunStreamOverlay();
      });

      elements.configApplyErrorOverlay.addEventListener("click", (event) => {
        if (event.target === elements.configApplyErrorOverlay) {
          closeConfigApplyErrorOverlay();
        }
      });

      elements.closeConfigApplyError.addEventListener("click", () => {
        closeConfigApplyErrorOverlay();
      });

      elements.copyConfigApplyError.addEventListener("click", () => {
        const detail = elements.configApplyErrorContent
          ? String(elements.configApplyErrorContent.textContent || "")
          : "";
        if (!detail.trim()) {
          return;
        }
        copyTextToClipboard(detail, t("toastConfigApplyErrorCopied"));
      });

      elements.queueOverlay.addEventListener("click", (event) => {
        if (event.target === elements.queueOverlay) {
          closeQueueOverlay();
        }
      });

      elements.closeQueue.addEventListener("click", () => {
        closeQueueOverlay();
      });

      elements.helpTabInstall.addEventListener("click", () => {
        setHelpTab("install");
      });

      elements.helpTabThinking.addEventListener("click", () => {
        setHelpTab("thinking");
      });

      elements.loadRules.addEventListener("click", () => {
        const cli = elements.rulesLoadCli.value;
        setRulesHint(t("rulesHintLoading"));
        vscode.postMessage({ type: "loadRules", cli, scope: state.ruleScope });
      });

      elements.rulesLoadCli.addEventListener("change", (event) => {
        updateRulesPath(event.target.value);
      });

      elements.scopeGlobal.addEventListener("click", () => {
        updateRulesScope("global");
        setRulesHint("");
      });

      elements.scopeProject.addEventListener("click", () => {
        updateRulesScope("project");
        setRulesHint("");
      });

      elements.saveRules.addEventListener("click", () => {
        const targets = collectRuleTargets();
        if (!targets.length) {
          setRulesHint(t("rulesHintSelectCli"));
          return;
        }
        const content = elements.rulesInput.value || "";
        setRulesHint(t("rulesHintSaving"));
        vscode.postMessage({ type: "saveRules", content, targets, scope: state.ruleScope });
      });

      elements.sendPrompt.addEventListener("click", () => {
        sendPrompt();
      });

      elements.pathPickerButton.addEventListener("click", () => {
        requestWorkspacePathPick();
      });

      elements.scrollToBottomButton.addEventListener("click", () => {
        stickChatToBottom("smooth");
      });

      elements.chatArea.addEventListener("scroll", () => {
        if (shouldForceFollowLatestMessagesForActiveTab()) {
          followLatestMessages = true;
        } else if (!isScrollButtonSuppressed()) {
          followLatestMessages = isChatNearBottom();
        }
        updateScrollToBottomButton();
      });

      elements.stopRun.addEventListener("click", () => {
        vscode.postMessage({ type: "stopRun" });
      });

      elements.promptInput.addEventListener("compositionstart", () => {
        isComposing = true;
      });

      elements.promptInput.addEventListener("compositionend", () => {
        isComposing = false;
        lastCompositionEndAt = Date.now();
      });

      elements.promptInput.addEventListener("keydown", (event) => {
        if (event.key === "@" && !event.ctrlKey && !event.metaKey && !event.altKey) {
          event.preventDefault();
          requestWorkspacePathPick();
          return;
        }
        if (
          event.key === "Enter"
          && !event.shiftKey
          && !event.isComposing
          && !isComposing
          && event.keyCode !== 229
          && Date.now() - lastCompositionEndAt > compositionEnterGuardMs
        ) {
          event.preventDefault();
          sendPrompt();
        }
      });

      elements.promptInput.addEventListener("paste", (event) => {
        const files = getClipboardFiles(event);
        if (!files.length) {
          return;
        }
        event.preventDefault();
        handleFileSelection(files);
      });

      elements.promptInput.addEventListener("dragover", (event) => {
        event.preventDefault();
      });

      elements.promptInput.addEventListener("drop", (event) => {
        const uris = getDropUris(event);
        if (uris.length) {
          event.preventDefault();
          vscode.postMessage({ type: "resolveDropPaths", uris });
          return;
        }
        const files = event.dataTransfer && event.dataTransfer.files
          ? Array.from(event.dataTransfer.files)
          : [];
        if (files.length) {
          event.preventDefault();
          handleFileSelection(files);
        }
      });

      window.addEventListener("message", (event) => {
        try {
          const data = event.data;
          if (data.type === "state") {
            applyState(data.payload);
          }
          if (data.type === "editorContext") {
            applyEditorContext(data.payload);
          }
          if (data.type === "setMessages") {
            const eventTabId = typeof data.tabId === "string" ? data.tabId : getActiveConversationTabId();
            const incoming = Array.isArray(data.messages) ? data.messages : [];
            setMessagesForTab(eventTabId, normalizeMessageOrder(incoming), { render: false });
            if (!shouldHandleTabScopedEvent(data)) {
              return;
            }
            traceCollapsibleOpenKeys.clear();
            syncConversationControlsForActiveTab();
            renderMessages();
          }
          if (data.type === "sessionLoadError") {
            console.error("[sinitek-webview] sessionLoadError", {
              title: data.title,
              detail: data.detail,
              tabId: data.tabId || null,
              sessionId: data.sessionId || null,
              cli: data.cli || null,
            });
          }
          if (data.type === "appendMessage") {
            const eventTabId = typeof data.tabId === "string" ? data.tabId : getActiveConversationTabId();
            const lobsterMetaChanged = updateLobsterMetaForTabFromMessage(eventTabId, data.message);
            if (lobsterMetaChanged) {
              renderConversationTabs();
            }
            const runtimeState = getConversationRuntimeState(eventTabId, { create: false });
            let statusSummaryUpdated = false;
            if (runtimeState && data.message && data.message.role === "system") {
              const content = String(data.message.content || "").trim();
              if (isHiddenRetryQueuedMessage(content)) {
                setTabErrored(eventTabId, true);
              }
              if (isHiddenRetryStartedMessage(content)) {
                setTabErrored(eventTabId, false);
              }
              if (isRunStatusSummaryText(content)) {
                runtimeState.lastRunStatusMessage = content;
                statusSummaryUpdated = true;
              }
            }
            if (data.message && data.message.role === "assistant" && String(data.message.content || "").trim()) {
              setTabErrored(eventTabId, false);
            }
            if (!shouldHandleTabScopedEvent(data)) {
              return;
            }
            appendMessage(data.message);
            if (statusSummaryUpdated) {
              syncConversationControlsForActiveTab();
            }
          }
          if (data.type === "replaceMessage") {
            if (!shouldHandleTabScopedEvent(data)) {
              return;
            }
            const replacement = data.message;
            if (replacement && typeof replacement.id === "string") {
              let replaced = false;
              const nextMessages = state.messages.map((message) => {
                if (message.id !== replacement.id) {
                  return message;
                }
                replaced = true;
                return replacement;
              });
              if (replaced) {
                setMessagesForTab(getActiveConversationTabId(), nextMessages);
              }
            }
          }
          if (data.type === "assistantDelta") {
            const eventTabId = typeof data.tabId === "string" ? data.tabId : getActiveConversationTabId();
            if (String(data.content || "").trim()) {
              setTabErrored(eventTabId, false);
            }
            if (!shouldHandleTabScopedEvent(data)) {
              return;
            }
            appendAssistantDelta(data.id, data.content, data.kind, {
              codexFinalAnswer: data.codexFinalAnswer === true,
            });
          }
          if (data.type === "rawStreamDelta") {
            const eventTabId = typeof data.tabId === "string" ? data.tabId : null;
            if (eventTabId && String(data.content || "").trim()) {
              // Hidden-retry may set a tab to errored; once fresh stream output arrives, recover to running/normal state.
              setTabErrored(eventTabId, false);
            }
            appendRunRawStream(data.content, data.stream, eventTabId || getActiveConversationTabId());
            if (!shouldHandleTabScopedEvent(data)) {
              return;
            }
          }
          if (data.type === "traceSegment") {
            if (!shouldHandleTabScopedEvent(data)) {
              return;
            }
            applyTraceSegment(data);
          }
          if (data.type === "runStatus") {
            const eventTabId = typeof data.tabId === "string" ? data.tabId : null;
            const targetTabId = eventTabId || getActiveConversationTabId();
            const runtimeState = getConversationRuntimeState(targetTabId);
            const shouldHandleActiveTabEvent = shouldHandleTabScopedEvent(data);
            let queuePausedNotice = "";
            if (data.status === "start") {
              runningTabStartedAtById[targetTabId] = typeof data.startedAt === "number" ? data.startedAt : Date.now();
              setTabErrored(targetTabId, false);
              resetRunRawStream(targetTabId, { syncOverlay: false });
              updateCurrentRunPrompt(data.prompt, targetTabId);
              if (runtimeState) {
                runtimeState.lastRunStatusMessage = "";
                runtimeState.activeRunActivity = normalizeRunActivity(data.activity);
              }
              resetTaskListForRunStart(targetTabId);
            } else {
              if (data.status === "error") {
                setTabErrored(targetTabId, true);
              } else {
                setTabErrored(targetTabId, false);
              }
              if (runtimeState && typeof data.message === "string" && isRunStatusSummaryText(data.message)) {
                runtimeState.lastRunStatusMessage = data.message.trim();
              }
              if (runtimeState) {
                runtimeState.activeRunActivity = "";
              }
              if (eventTabId) {
                delete runningTabStartedAtById[eventTabId];
              } else {
                const fallbackTabId = getActiveConversationTabId();
                if (fallbackTabId) {
                  delete runningTabStartedAtById[fallbackTabId];
                }
              }
              const hasPendingQueue = Boolean(runtimeState && runtimeState.pendingPromptQueue.length > 0);
              const shouldPauseQueueNotice = data.status !== "end"
                && hasPendingQueue
                && !(runtimeState && runtimeState.suppressQueueFlushOnce);
              if (shouldPauseQueueNotice && runtimeState) {
                queuePausedNotice = t("toastQueuePaused", { count: String(runtimeState.pendingPromptQueue.length) });
                runtimeState.lastRunStatusMessage = buildQueuePausedStatusText(
                  runtimeState.lastRunStatusMessage || data.message || "",
                  runtimeState.pendingPromptQueue.length,
                );
              }
              closeTaskListForRunCompletion(targetTabId);
            }

            if (!shouldHandleActiveTabEvent) {
              renderConversationTabs();
              if (data.status !== "start") {
                if (runtimeState && runtimeState.suppressQueueFlushOnce) {
                  runtimeState.suppressQueueFlushOnce = false;
                } else if (data.status === "end") {
                  flushPendingPromptQueue(targetTabId);
                }
              }
              return;
            }

            const activeTabId = getActiveConversationTabId();
            const isRunningOnActiveTab = isTabRunning(activeTabId);
            updateRunningState(isRunningOnActiveTab, {
              preserveRunArtifacts: true,
              startedAt: isRunningOnActiveTab ? getTabRunStartedAt(activeTabId) : 0,
            });
            if (data.status === "start") {
              Object.keys(assistantRedirects).forEach((key) => {
                delete assistantRedirects[key];
              });
            }
            if (data.message) {
              if (!isDuplicateSystemStatusMessage(data.message)) {
                appendMessage({ id: createMessageId(), role: "system", content: data.message });
              }
            }
            if (queuePausedNotice) {
              showToast(queuePausedNotice);
            }
            if (data.status !== "start") {
              if (runtimeState && runtimeState.suppressQueueFlushOnce) {
                runtimeState.suppressQueueFlushOnce = false;
              } else if (data.status === "end") {
                flushPendingPromptQueue(targetTabId);
              }
            }
            syncConversationControlsForActiveTab();
          }
          if (data.type === "removeMessage") {
            if (!shouldHandleTabScopedEvent(data)) {
              return;
            }
            if (data.id) {
              const nextMessages = state.messages.filter((message) => message.id !== data.id);
              setMessagesForTab(getActiveConversationTabId(), nextMessages);
            }
          }
          if (data.type === "uploadResult") {
            const insertText = buildInsertText(data.paths);
            if (insertText) {
              insertPromptText(insertText);
            }
            if (data.error) {
              appendMessage({ id: createMessageId(), role: "system", content: data.error });
            }
          }
          if (data.type === "dropPathsResult") {
            const insertText = buildInsertText(data.paths);
            if (insertText) {
              insertPromptText(insertText);
            }
            if (data.error) {
              appendMessage({ id: createMessageId(), role: "system", content: data.error });
            }
          }
          if (data.type === "pickWorkspacePathResult") {
            const insertText = buildInsertText(data.paths);
            if (insertText) {
              insertPromptText(insertText);
            } else if (data.canceled || data.error) {
              insertPromptText("@");
            }
            if (data.error) {
              appendMessage({ id: createMessageId(), role: "system", content: data.error });
            }
          }
          if (data.type === "runStreamExportResult") {
            handleRunStreamExportResult(data);
          }
          if (data.type === "historySessionMessages") {
            handleHistorySessionMessages(data);
          }
          if (data.type === "historySessionExportResult") {
            handleHistorySessionExportResult(data);
          }
          if (data.type === "configApplyError") {
            openConfigApplyErrorOverlay(data.error);
          }
          if (data.type === "taskListUpdate") {
            const eventTabId = typeof data.tabId === "string" ? data.tabId : getActiveConversationTabId();
            const taskListState = getTaskListState(eventTabId);
            if (!taskListState) {
              return;
            }
            const normalized = normalizeTaskListItems(data.items);
            if (normalized.length) {
              setTaskListItems(taskListState, normalized);
              taskListState.source = "external";
            } else {
              const runtimeState = getConversationRuntimeState(eventTabId, { create: false });
              const startIndex = runtimeState ? ensureRuntimeStateMessages(runtimeState).length : 0;
              resetTaskListState(taskListState, startIndex);
            }
            if (isRuntimeStateForActiveTab(eventTabId)) {
              renderTaskList(taskListState);
            }
          }
          if (data.type === "rulesContent") {
            if (data.error) {
              setRulesHint(data.error);
              return;
            }
            elements.rulesInput.value = typeof data.content === "string" ? data.content : "";
            const scopeLabel = data.scope === "project"
              ? t("rulesScopeProject")
              : t("rulesScopeGlobal");
            setRulesHint(t("rulesHintLoaded", { scope: scopeLabel, cli: data.cli }));
          }
          if (data.type === "rulesSaved") {
            if (data.error) {
              setRulesHint(data.error);
              return;
            }
            const scopeLabel = data.scope === "project"
              ? t("rulesScopeProject")
              : t("rulesScopeGlobal");
            setRulesHint(
              t("rulesHintSaved", {
                scope: scopeLabel,
                targets: Array.isArray(data.targets) ? data.targets.join(", ") : "",
              })
            );
          }
        } catch (error) {
          reportWebviewFailure("window-message-handler-failed", error, {
            eventType: event && event.data && event.data.type ? event.data.type : null,
          });
        }
      });

      updateAppHeight();
      window.addEventListener("resize", scheduleAppHeightUpdate);
      vscode.postMessage({ type: "requestState" });
    </script>
  </body>
</html>`;
}

function getNonce(): string {
  let text = "";
  const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

  for (let i = 0; i < 32; i += 1) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }

  return text;
}

function getMarkedScript(): string {
  if (cachedMarkedScript !== undefined) {
    return cachedMarkedScript;
  }
  const candidates = [
    path.join(__dirname, "..", "..", "media", "marked.min.js"),
    path.join(__dirname, "..", "..", "node_modules", "marked", "marked.min.js"),
  ];
  for (const scriptPath of candidates) {
    try {
      cachedMarkedScript = readFileSync(scriptPath, "utf8");
      return cachedMarkedScript;
    } catch {
      // Keep checking next candidate.
    }
  }
  void logError("webview-marked-script-missing", { candidates });
  cachedMarkedScript = "";
  return cachedMarkedScript;
}
