# OpenCode 结构化最终答复识别修复

- 日期：2026-07-12
- 状态：completed
- 负责人：Codex
- owner：Codex
- claimed_at：2026-07-12
- claim_ttl：本次会话
- handoff_to：

## 背景

真实会话 `ses_0aaa0f435ffenK9Zu7ID3cpsL3` 中，OpenCode 正常返回了需要用户选择项目序号的助手答复，并以 `step-finish.reason="stop"` 结束该助手消息。插件虽然保存了非空助手正文，但严格最终答复判定只识别 Codex 结构化 final 或文本 `[final_answer]`，因此把这个成功结束的 OpenCode 回合错误收口为失败。

## 目标

- 识别 OpenCode JSONL 中与非空助手正文属于同一消息的 `step_finish.reason="stop"`，将其作为结构化最终答复信号。
- 严格策略继续拒绝工具调用阶段、中间文本、thinking 文本和没有终态证据的普通回复。
- 普通 one-shot 与并行 tab 两条 OpenCode 成功路径统一使用该结构化信号。

## 范围

- OpenCode JSONL 结果解析。
- OpenCode 成功退出后的最终结论判定。
- 相关单元测试、运行时事实文档和功能清单说明。

## 非目标

- 不放宽 Claude 或 Codex 的严格最终答复规则。
- 不通过问号、关键词等助手文案猜测是否需要用户输入。
- 不改变 hidden retry 次数、队列策略或 OpenCode 上游事件格式。
- 不处理该会话工作目录为 `/` 的独立工作区选择问题。

## 验收标准

- [x] 同一 OpenCode 消息包含非 thinking 助手文本并以 `reason="stop"` 结束时，严格策略可成功收口。
- [x] `reason="tool-calls"`、无正文终态和跨 message ID 的正文/终态组合不得误判为结构化最终答复。
- [x] one-shot 与并行 OpenCode 路径都把解析出的结构化信号传入共享最终结论判定。
- [x] 相关单元测试和 `npm run build` 通过。
- [x] CLI runtime reference、能力规格和功能清单与实现一致。

## 影响面

- 代码目录：`src/cli/commandRunner.ts`、`src/extension.ts`
- 测试目录：`src/test/opencodeCommandRunner.test.ts`
- 文档目录：`.ch/docs/references/`、`.ch/docs/product-specs/`
- 配置与脚本：无

## 风险与缓解

- 风险：任意历史 `stop` 事件与其他消息正文组合后误判。
- 缓解：必须按 OpenCode `messageID` 关联正文与终态；缺少 message ID 时不授予结构化最终答复资格，继续依赖文本标记或兼容策略。
- 风险：把工具调用阶段误当作最终答复。
- 缓解：只接受 `step_finish` 的 `reason="stop"`，明确拒绝 `tool-calls`。

## 验证计划

- 最小相关验证：`npm run build && node --test dist/test/opencodeCommandRunner.test.js dist/test/finalConclusion.test.js`
- 单元自测命令：同上。
- 扩展验证：`git diff --check`，并核对真实会话导出中的 `text` 与 `step-finish reason="stop"` 证据。

## 测试与清单同步

- 单元测试新增/更新：已补 OpenCode 同 message ID 结构化终态、缺少/跨 message ID、工具阶段误判回归，并校验 one-shot / 并行两条接线。
- 单元自测结果：`npm run build` 通过；最终答复相关测试 `70/70` 通过；完整 `node --test dist/test/*.test.js` 为 `483/483` 通过。
- 失败处理记录：无失败；`git diff --check` 通过。
- 功能清单：已更新 `.ch/docs/product-specs/FEATURE_INVENTORY.md`。
- 相关文档同步：已更新 `.ch/docs/references/cli-runtime-reference.md`、`.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md` 与 `.ch/docs/runbooks/PITFALLS.md`；`media/official_skills_catalog.json` 的 description 中文检查无异常。

## 任务列表

- [x] 定位真实失败会话与结构化终态证据。
- [x] 实现 OpenCode 结构化最终答复解析。
- [x] 接入两条成功收口路径并补测试。
- [x] 同步事实文档和功能清单。
- [x] 执行最小测试、构建和静态检查。

## 决策记录

- 2026-07-12：不根据“请回复序号”等自然语言猜测澄清回复；使用 OpenCode 原生 `step-finish.reason="stop"` 作为结构化终态，并要求它与非空助手正文属于同一 message ID。
- 2026-07-12：缺少 `messageID` 的正文或 `stop` 不做无作用域兜底，避免跨消息误配；仍可通过 `[final_answer]` 或兼容策略收口。

## 当前结论

修复已完成：严格策略现在接受 OpenCode 同一 `messageID` 的非 thinking assistant 正文与 `step_finish.reason="stop"` 结构化终态，同时继续拒绝工具阶段、跨消息、无正文和纯 thinking 事件。构建、相关测试、完整测试与静态检查均通过。
