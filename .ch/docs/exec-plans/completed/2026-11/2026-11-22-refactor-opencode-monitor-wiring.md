# 收敛 OpenCode 任务子代理监控接线

- 日期：2026-11-22
- 类型：refactor
- 关联计划：无
- 状态：completed
- 负责人：Loop+ 独立执行 attempt（第 3 轮）

## 背景与目标

OpenCode one-shot 和 parallel 已共用 attempt 模板，仍分别接线监控工厂、进度过滤、空提示和诊断。每次运行共用一份接线逻辑，保留各自存储和界面端口。

## 范围与非目标

- 仅改 Extension Host 两个运行路径、共享 helper 和相关回归。
- 不改 attempt 模板、父 session 更新、轮询与收尾顺序、重试策略或 Owner/EH 传输归属。不增定时器或订阅。

## 验收标准

- [x] 无连接调用已注入的禁用工厂；有连接保持原诊断事件、实时 sessionId 和 attempt 字段。
- [x] 空提示先清助手流分段，再写原目标。同一运行的多次 attempt 至多提示一次，不同运行隔离。
- [x] one-shot 用活动 runId 过滤，合格进度先解除启动 watchdog；parallel 进度只看该 Tab 的 runId，空提示另检查 stopped。
- [x] 新增行为测试及运行时、attempt 模板、监控回归在隔离编译产物上通过。

## 影响面与风险

仅涉及 `src/extensionHost/`、对应测试及本计划。用注入工厂驱动迟到回调和重试，避免把 parallel 的两个判定误合并，保留既有本地 HTTP watchdog 回归。未改配置或脚本。

## 验证计划与结果

- 隔离构建：`npm run build -- --outDir /tmp/opencode-monitor-round3.u8eg7C`，通过；未写共享 `dist/`。
- 相关单测：`NODE_PATH=/Users/fangjiawei/sinitek/sinitek-ai-vscode-cli/node_modules node --test /tmp/opencode-monitor-round3.u8eg7C/test/extensionHost/openCodePromptSubagentMonitor.test.js /tmp/opencode-monitor-round3.u8eg7C/test/extensionHost/promptOneShotRuntime.test.js /tmp/opencode-monitor-round3.u8eg7C/test/extensionHost/promptParallelRuntime.test.js /tmp/opencode-monitor-round3.u8eg7C/test/extensionHost/openCodePromptRunTemplate.test.js /tmp/opencode-monitor-round3.u8eg7C/test/cli/openCodeSubagentMonitor.test.js /tmp/opencode-monitor-round3.u8eg7C/test/cli/opencodeCommandRunner.test.js`，129 通过、0 失败、0 跳过。
- 首次隔离测试命令未设置 `NODE_PATH`，三个依赖测试进程因临时输出路径无法解析 `cross-spawn` 失败；补充工作区 `node_modules` 为 `NODE_PATH` 后同范围通过。
- 本机真实 Extension Development Host / OpenCode CLI 未运行；测试不能证明用户配置下的 Extension Host 点击、真实 OpenCode 服务或 UI 行为。

## 测试与清单同步

- 新增 helper 行为测试覆盖无连接、共享同一运行去重、不同运行隔离、陈旧进度回调、parallel 两个资格谓词及诊断 attempt/session 字段。
- 现有 one-shot 真实本地 HTTP watchdog、parallel 分流及模板生命周期回归均包含在上列测试中并通过。
- 功能清单不变：仅内部接线收敛，用户能力、文案、权限、流程和验收行为不变。
- 架构、CLI 运行手册及 ontology 的既有事实与路径不变。

## 任务列表

- [x] 核对原有接线与宿主差异。
- [x] 实现共享接线，补回归。
- [x] 隔离构建、自测并记录覆盖边界。

## 决策记录

- 2026-11-22：helper 每次 attempt 创建，空提示一次状态仍由宿主运行闭包拥有，以跨重试去重且隔离不同运行。parallel 的进度与空提示资格分别保持 runId 检查和包含 stopped 的活动检查。
- 2026-11-22：不更新功能清单，改动未改变用户可见能力或流程。

## 当前结论

本次实现与隔离回归完成。临时编译目录已清理；真实 Extension Development Host 与 CLI 集成未覆盖，保留为主任务验收边界。
