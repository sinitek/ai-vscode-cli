# Lobster Debate Single Timeline

- 日期：2026-06-17
- 状态：completed
- 负责人：Codex

## 背景

辩论模式当前在群聊 UI 中按轮次拆分 transcript，并暴露轮次选择。用户期望它更像真实群聊：按时间连续输出所有消息，轮次只作为系统消息或消息元信息出现。同时辩论不应预先制定固定轮次，只保留最大轮数作为防无限循环安全上限，由主持人每轮判断继续、收束或阻塞。

## 目标

- 辩论群聊 Webview 使用单条时间线展示所有辩论与后续执行消息，不再用轮次面板切换内容。
- 保留最大发言批次数安全上限，运行时继续由主持人 `continue / finalize / block` 控场。
- 同步测试和事实来源文档。

## 范围

- `src/extension.ts`：构建群聊面板状态时合并辩论 chat 与执行 `group-chat.md`。
- `src/webview/lobsterDebatePanel.ts`：移除轮次选择交互，改为单时间线与成员概览。
- `src/lobsterDebate.ts` / 测试：补充系统轮次消息解析能力。
- `.ch/docs/`：同步辩论群聊行为说明。

## 非目标

- 不重写龙虾主从任务 JSON 协议。
- 不改变真实任务记录中 `rounds` / `debateRounds` 的持久化结构。
- 不替换现有 CLI 会话恢复机制。

## 验收标准

- [x] 辩论模式群聊 UI 不再出现“轮次”切换面板，消息按时间连续显示。
- [x] 辩论轮次信息以系统消息或消息元信息显示，不作为 UI 分区。
- [x] 最大轮数只作为安全上限；主持人提示明确自行决定是否继续下一轮。
- [x] 相关单测通过，项目 build 通过。
- [x] 事实来源文档与功能清单已同步。

## 影响面

- 代码目录：`src/extension.ts`、`src/webview/`、`src/lobsterDebate.ts`、`src/test/`
- 文档目录：`.ch/docs/design-docs/`、`.ch/docs/product-specs/`、`.ch/docs/references/`
- 配置与脚本：无

## 风险与缓解

- 风险：历史任务仍只有分散的 `debates/round-*/chat.md`。
- 缓解：面板状态层合并多个 chat 文件，不迁移历史文件。

## 验证计划

- 最小相关验证：`node --test dist/test/lobsterDebate.test.js`
- 扩展验证：`npm run build`、`git diff --check`

## 测试与清单同步

- 单元测试：更新 `lobsterDebate.test.ts`。
- 功能清单：同步 `.ch/docs/product-specs/FEATURE_INVENTORY.md` 和 `sinitek-cli-plugin-capabilities.md`。
- 相关文档同步：同步运行时设计和 CLI runtime reference。

## 任务列表

- [x] 复核当前面板状态与辩论调度实现
- [x] 改为单时间线 chatMarkdown 聚合
- [x] 移除轮次选择 UI 和消息协议
- [x] 更新主持人/参与者提示文案
- [x] 补充测试与文档
- [x] 运行验证并归档计划

## 决策记录

- 2026-06-17：保留持久化 `debateRounds` 作为运行状态和恢复来源，但 UI 不再把它作为切换维度。

## 当前结论

已完成。验证通过：`npm run build`、`node --test dist/test/lobsterDebate.test.js`、`git diff --check`。
