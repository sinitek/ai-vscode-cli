# Loop任务问题结论展示修复

- 日期：2026-06-22
- 状态：completed
- 负责人：Codex

## 背景

用户反馈：Loop任务如果本质是一个问题，任务结束后 AI 对话只看到“Loop任务最终总结”，而看不到对问题的直接回答结论。最终总结和问题回答结论都应出现。

## 目标

让Loop任务完成态同时保留：

- 面向用户问题的直接回答结论。
- Loop任务的最终总结、子任务摘要、验收结果和需求覆盖信息。

## 范围

- Loop主任务完成态 JSON 协议提示。
- 完成态决策解析、任务记录和最终总结气泡生成。
- AI 对话主消息流中的独立问题回答结论气泡生成、恢复判定和 Webview 展示。
- 主沟通文件与主从群聊完成段的结论展示。
- 回归测试与事实来源文档同步。

## 非目标

- 不改变子任务派发、并发规划、重试或自动关闭标签逻辑。
- 不重写 Webview 样式。
- 不改变普通 coding 任务最终结论判定。

## 验收标准

- [x] 主任务 completed 决策可携带问题回答结论。
- [x] AI 对话主消息流同时展示独立“问题回答结论”气泡和“Loop任务最终总结”气泡。
- [x] 旧任务或模型未返回新字段时不解析失败，并用最终总结兜底。
- [x] 相关测试与构建通过。

## 影响面

- 代码目录：`src/extension.ts`、`src/loopDebate.ts`、`src/test/`
- 文档目录：`.ch/docs/product-specs/`、`.ch/docs/references/`、`.ch/docs/exec-plans/`
- 配置与脚本：无

## 风险与缓解

- 风险：新增 completed 字段后老任务或未遵守提示的模型输出缺字段。
- 缓解：新字段按可选解析，展示层用 `finalSummary` 兜底。

- 风险：最终总结和问题结论重复。
- 缓解：字段语义区分为“直接回答用户问题”和“整体任务完成总结”，提示词明确要求两者分工。

## 验证计划

- 最小相关验证：`npm run build`、`node --test dist/test/loopDebate.test.js`
- 扩展验证：`git diff --check`

## 测试与清单同步

- 单元测试：补充最终总结 Markdown 同时展示问题结论与兜底行为。
- 功能清单：更新Loop模式完成态说明。
- 相关文档同步：更新 CLI runtime reference 与能力规格。

## 任务列表

- [x] 定位Loop最终总结与问题结论丢失的代码路径。
- [x] 补充完成态协议字段和最终气泡展示。
- [x] 补充回归测试。
- [x] 同步事实来源文档。
- [x] 运行验证并归档计划。

## 决策记录

- 2026-06-22：采用兼容扩展字段 `answerConclusion`，提示词要求 completed 时输出；解析层不强制，旧数据用 `finalSummary` 兜底。
- 2026-06-22：用户进一步明确“AI 对话里也要有 answerConclusion 展示”，因此主 AI 对话完成态新增 `loopAnswerConclusion=true` 的独立 assistant 气泡；完成判定改为同时要求该气泡和 `loopFinalSummary=true` 最终总结气泡。

## 当前结论

已完成。完成态协议新增 `answerConclusion`，AI 对话主消息流会先展示独立“问题回答结论” assistant 气泡，再展示“Loop任务最终总结” assistant 气泡；最终总结气泡、主沟通文件和主从群聊收束段也会同时展示问题回答结论与整体任务总结；旧格式最终总结或缺少独立结论气泡时会被识别为不完整并在后续恢复时补写。

验证结果：

- `npm run build` 通过。
- `node --test dist/test/*.test.js` 通过，82/82。
- `git diff --check` 通过。
- `media/official_skills_catalog.json` description 中文检查通过，非中文 description 数量为 0。
