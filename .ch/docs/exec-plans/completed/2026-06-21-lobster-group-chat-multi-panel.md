# 龙虾群聊多面板修复

- 日期：2026-06-21
- 状态：completed
- 负责人：Codex

## 背景

当前龙虾群聊内容区页面由扩展侧单例 `lobsterDebateChatPanel` 管理。多个龙虾任务同时存在时，打开第二个任务会复用并替换第一个任务的群聊页面，导致用户只能同时查看一个龙虾群聊 UI。

## 目标

让每个龙虾任务都能打开并保留独立的群聊 UI 页面；同一任务重复打开时复用该任务自己的页面。

## 范围

- 扩展侧龙虾群聊 WebviewPanel 生命周期管理。
- 群聊面板按钮消息按对应 `taskId` 处理。
- 打开 transcript、任务记录、继续执行、中止、刷新等操作保持任务隔离。
- 同步功能清单事实来源。

## 非目标

- 不改龙虾任务执行协议、任务记录结构或 transcript 格式。
- 不新增 VS Code view container 或替换现有 webview 技术栈。
- 不调整普通 AI 对话面板的标签页模型。

## 验收标准

- [x] 打开任务 A 的龙虾群聊后，再打开任务 B，任务 A 页面仍保留，任务 B 打开为独立页面。
- [x] 同一任务重复打开时只 reveal/刷新该任务已有页面。
- [x] 任一群聊页面点击刷新、继续、中止、打开 transcript、打开任务记录，都只作用于该页面对应的 `taskId`。
- [x] 龙虾运行状态更新时，只主动刷新同一 `taskId` 的已打开页面。
- [x] `npm run build` 通过。

## 影响面

- 代码目录：`src/extension.ts`, `src/webview/lobsterDebatePanel.ts`
- 文档目录：`.ch/docs/product-specs/FEATURE_INVENTORY.md`, `.ch/docs/exec-plans/`
- 配置与脚本：无配置变更；使用现有 `npm run build`

## 风险与缓解

- 风险：面板消息回调仍引用全局状态，导致按钮误操作其他任务。
- 缓解：回调闭包绑定 `taskId`，处理函数全部显式接收 `taskId`。

- 风险：dispose 后 Map 未清理，产生过期面板引用。
- 缓解：panel 类暴露 dispose 回调，由扩展侧删除对应 `taskId`。

## 验证计划

- 最小相关验证：TypeScript build。
- 扩展验证：仍建议手工在 VS Code 中同时打开两个龙虾任务群聊页面，验证页面与按钮任务隔离。

## 测试与清单同步

- 单元测试：当前行为主要依赖 VS Code WebviewPanel 生命周期，暂不新增单测；用 build 覆盖类型回归。
- 功能清单：更新 `.ch/docs/product-specs/FEATURE_INVENTORY.md` 中龙虾群聊能力说明。
- 相关文档同步：如行为说明已有事实来源不准确则同步更新。

## 任务列表

- [x] 定位单例 panel 根因。
- [x] 改为按 `taskId` 管理多个群聊 panel。
- [x] 确保面板按钮操作绑定自身任务。
- [x] 同步功能清单和计划状态。
- [x] 运行构建验证。

## 决策记录

- 2026-06-21：保持 `LobsterDebateChatPanel` 为单面板封装，扩展侧用 `Map<taskId, panel>` 管理多实例，避免把 VS Code API 或任务读取逻辑下沉到 webview 层。

## 当前结论

根因是全局单例群聊 panel 与全局当前 `taskId`。下一步按 `taskId` 隔离生命周期和消息处理。
已完成：扩展侧改为 `Map<taskId, LobsterDebateChatPanel>` 管理多实例，panel dispose 时清理对应任务引用；面板消息回调闭包绑定任务 ID；主动刷新只刷新同一任务已打开页面；群聊页面标题显示任务短 ID 便于区分。`npm run build` 已通过。当前环境未做真实 VS Code 多窗口点击验收。
