# 龙虾辩论会话续接与临时标签清理

- 日期：2026-06-16
- 状态：completed
- 负责人：Codex

## 背景

辩论模式已经改为主持人控场的模拟群聊，但参与者、主持人和共识汇总仍通过临时对话 tab 承载。当前临时 tab 在每个回答完成后容易留在标签栏里，同时后续角色轮次没有显式复用上一次角色会话 ID。

## 目标

- 辩论角色回答完成后可以自动关闭临时 tab。
- 后续同一参与者/主持人优先通过已记录的 sessionId 续接会话。
- 任务记录保留辩论角色 sessionId，支持恢复、排查和后续群聊 UI 读取。
- 文档说明模拟群聊页面可以基于 `chat.md` 和 `debateRounds` 演进。

## 范围

- `src/lobsterDebate.ts`
- `src/extension.ts`
- `src/test/lobsterDebate.test.ts`
- `.ch/docs/design-docs/*`
- `.ch/docs/product-specs/*`
- `.ch/docs/references/*`

## 非目标

- 本轮不实现完整 VS Code 内容区模拟群聊 Webview。
- 不改变辩论产物协议中的 `chat.md` / `decision.json` 主路径。
- 不改变普通龙虾子任务的 tab 创建与重试语义。

## 验收标准

- [x] 参与者和主持人记录包含可选 `sessionId`。
- [x] 同一角色后续发言使用已记录 sessionId 创建临时 tab。
- [x] 回答完成后自动关闭临时 tab，并保留会话历史可恢复。
- [x] 相关单测、构建通过。

## 影响面

- 代码目录：`src/extension.ts`, `src/lobsterDebate.ts`, `src/test/lobsterDebate.test.ts`
- 文档目录：`.ch/docs/design-docs`, `.ch/docs/product-specs`, `.ch/docs/references`
- 配置与脚本：无

## 风险与缓解

- 风险：关闭 tab 后交互 runner 被释放，后续续接失败。
- 缓解：关闭前把 sessionId 写入 `debateRounds`，Codex/Claude 仍通过 metaStore 映射恢复，Gemini 仍通过 sessionId 参数恢复。

- 风险：自动关闭影响调试。
- 缓解：复用现有“龙虾子任务自动关标签”开关，关闭后仍可在历史会话中按 sessionId 打开。

## 验证计划

- 最小相关验证：`node --test dist/test/lobsterDebate.test.js`
- 扩展验证：`npm run build`
- 静态检查：`git diff --check -- <changed files>`

## 测试与清单同步

- 单元测试：更新辩论纯函数测试覆盖 sessionId 字段。
- 功能清单：更新辩论多智能体主决策编排描述。
- 相关文档同步：更新运行时与 CLI reference。

## 任务列表

- [x] 记录类型和临时 tab 创建支持 sessionId。
- [x] 辩论运行链路复用角色 sessionId 并自动清理 tab。
- [x] 测试与文档同步。
- [x] 验证并归档计划。

## 决策记录

- 2026-06-16：先把底层会话续接和 tab 生命周期做稳；内容区模拟群聊页面下一阶段基于 `chat.md` 和 `debateRounds` 实现。

## 当前结论

已完成。验证通过：`npm run build`、`node --test dist/test/lobsterDebate.test.js`、相关文件 `git diff --check`。
