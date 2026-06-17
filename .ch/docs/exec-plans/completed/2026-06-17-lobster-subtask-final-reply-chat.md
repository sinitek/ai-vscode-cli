# 龙虾主从群聊子任务最终回复修复

- 日期：2026-06-17
- 状态：completed
- 负责人：Codex

## 背景

主从智能体模式已经复用龙虾群聊 UI。用户反馈子任务结束后的“子任务发言”气泡仍显示运行状态、时间和沟通文件等结构化状态，实际应该像群聊成员回复一样展示该子任务的最终回答。

## 目标

子任务成功结束时，主从群聊里的子任务回复气泡展示该子任务最后一条 assistant 最终回复原文；状态信息仍写入子任务沟通文件和任务记录，供主任务复核使用。

## 范围

- 调整主从 `group-chat.md` 的子任务完成段正文生成逻辑。
- 保留异常/停止或没有最终回复时的可排障提示。
- 覆盖历史 transcript 重建路径，避免缺失 `group-chat.md` 时回退成状态气泡。
- 更新相关测试和事实来源文档。

## 非目标

- 不改变主从任务派发、并发执行、重试或自动关闭标签页逻辑。
- 不改变辩论群聊的参与者发言逻辑。
- 不把群聊 UI 改为可写交互页面。

## 验收标准

- [x] 子任务 `runStatus=end` 且有 assistant 内容时，`## 子任务发言` 正文只展示最终回复原文。
- [x] 子任务异常、停止或没有最终回复时，仍显示明确可排障提示。
- [x] `summary`、自动沟通文件记录和主任务复核依据不丢失。
- [x] `npm run build` 与相关 Node 测试通过。

## 影响面

- 代码目录：`src/extension.ts`、`src/lobsterDebate.ts`、`src/test/lobsterDebate.test.ts`
- 文档目录：`.ch/docs/product-specs/`、`.ch/docs/design-docs/`、`.ch/docs/references/`
- 配置与脚本：无

## 风险与缓解

- 风险：最终回复过长导致 transcript 变大。
- 缓解：本次遵循“显示最终回复”的产品语义，不再把群聊发言压缩为状态；任务记录中的 `summary` 仍保留压缩摘要。
- 风险：没有捕获到 assistant 最终回复时气泡为空。
- 缓解：仅在缺失内容或非成功状态时显示 fallback 状态提示和沟通文件。

## 验证计划

- 最小相关验证：`npm run build`，`node --test dist/test/lobsterDebate.test.js`
- 扩展验证：手动启动主从龙虾任务，确认子任务完成后群聊气泡为最终回复。

## 测试与清单同步

- 单元测试：增加主从子任务气泡正文格式化测试。
- 功能清单：更新主从群聊备注。
- 相关文档同步：更新运行时设计和 CLI runtime reference 中群聊 transcript 语义。

## 任务列表

- [x] 定位当前子任务完成气泡写入点
- [x] 调整完成气泡正文为最终回复
- [x] 补充测试
- [x] 同步文档
- [x] 运行验证并归档计划

## 决策记录

- 2026-06-17：成功完成的子任务在群聊里按“成员发言”展示最终 assistant 回复；状态和验证证据继续写入沟通文件，不混入发言气泡。

## 当前结论

已完成。`appendLobsterMainSubChatSubtaskFinished` 现在对成功完成的子任务写入最终 assistant 回复原文；异常、停止或缺失回复时才显示状态和沟通文件提示。验证通过：`npm run build`、`node --test dist/test/lobsterDebate.test.js`、`git diff --check`。
