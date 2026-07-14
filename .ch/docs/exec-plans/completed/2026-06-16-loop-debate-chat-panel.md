# 龙虾辩论内容区群聊面板

- 日期：2026-06-16
- 状态：completed
- 负责人：Codex

## 背景

龙虾辩论模式已经改为主持人控场的模拟群聊，并把共享 transcript 写入 `chat.md`，角色与主持人的临时会话 tab 完成后可自动关闭并通过 sessionId 续接。用户希望在 VS Code 内容区看到类似群聊的辩论过程，而不是只能打开 markdown 产物。

## 目标

提供一个 VS Code 内容区 Webview 面板，用主题色渲染龙虾辩论 `chat.md` 和任务记录中的角色/主持人状态，让用户能快速查看各成员像群聊一样发言、刷新进度，并打开原始 transcript 或任务记录排查。

## 范围

- 新增只读的龙虾辩论群聊 WebviewPanel。
- 新增命令入口，并支持从当前会话关联的龙虾任务打开面板；找不到当前任务时可选择最近的辩论任务。
- 解析 `chat.md` 标题结构，渲染参与者发言、主持人控场、最终立场、收束和系统段落。
- 支持刷新、打开 `chat.md`、打开任务记录文件。
- 同步 i18n、产品/设计文档和功能清单。

## 非目标

- 不在本轮实现群聊页面内直接发送追问或控制辩论继续。
- 不新增新的辩论协议字段，不改变现有子任务派发与共识链路。
- 不强制打开已自动关闭的角色 tab；继续能力仍由现有 sessionId 恢复链路承担。

## 验收标准

- [ ] 命令可在 VS Code 内容区打开辩论群聊面板。
- [ ] 面板能读取有效 `chat.md` 并按角色/主持人渲染时间线。
- [ ] 面板提供刷新、打开 transcript、打开任务记录操作。
- [ ] 没有当前辩论任务时给出可理解提示或选择入口。
- [ ] `npm run build` 通过。
- [ ] 相关事实来源文档已同步。

## 影响面

- 代码目录：`src/extension.ts`、`src/webview/*`、`src/i18n.ts`
- 文档目录：`.ch/docs/design-docs/*`、`.ch/docs/product-specs/*`
- 配置与脚本：`package.json`、`package.nls*.json`

## 风险与缓解

- 风险：Webview HTML 直接渲染 markdown 可能引入脚本或样式风险。
- 缓解：面板自行转义文本，只支持受控的段落/代码块展示，不注入原始 HTML。

- 风险：任务查找误选非当前任务。
- 缓解：优先当前会话的 `lobsterTaskId`，其次提供 QuickPick 显式选择最近辩论任务。

## 验证计划

- 最小相关验证：`npm run build`
- 扩展验证：`node --test dist/test/lobsterDebate.test.js`

## 测试与清单同步

- 单元测试：辩论纯函数测试保持通过；UI 面板首版依赖构建验证。
- 功能清单：更新 `.ch/docs/product-specs/FEATURE_INVENTORY.md` 和 `.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md`。
- 相关文档同步：更新 `.ch/docs/design-docs/lobster-debate-multi-agent-mode.md` 和 `.ch/docs/design-docs/vscode-cli-extension-runtime.md`。

## 任务列表

- [x] 复核现有辩论数据与 Webview/命令结构。
- [x] 新增内容区群聊 WebviewPanel。
- [x] 接入命令、任务查找和文件操作。
- [x] 同步 i18n 与 package 命令声明。
- [x] 同步文档并完成验证。

## 决策记录

- 2026-06-16：第一版采用只读 transcript 可视化；不从群聊面板直接写任务记录或追加辩论消息，避免绕开主持人和现有 sessionId 恢复链路。

## 当前结论

已实现独立 WebviewPanel、命令入口、当前任务/最近任务选择、刷新和打开文件操作；已同步设计文档、产品规格和功能清单；`npm run build`、`node --test dist/test/lobsterDebate.test.js` 与 `git diff --check` 已通过。真实 VS Code 内容区端到端展示仍建议做一次手工验收。
