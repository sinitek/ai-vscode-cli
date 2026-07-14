# Harness 初始化后 ARCHITECTURE.md AI 初始化

- 日期：2026-07-03
- 状态：completed
- 负责人：Codex
- owner：Codex
- claimed_at：2026-07-03
- claim_ttl：1d
- handoff_to：

## 背景

工具设置“工作区”中的 Harness 骨架初始化已经能补齐 `.ch/`、`.agents/`、`ARCHITECTURE.md`、`AGENTS.md`、`CLAUDE.md`、`.gitignore`，并启动 CodeGraph 设置。用户进一步要求初始化最后阶段再弹出确认，让当前 AI 对话按当前选择的分组和配置切到编码模式，自动分析项目并初始化 `ARCHITECTURE.md` 的真实格式和内容。

## 目标

- Harness scaffold 初始化成功后，追加一个 `ARCHITECTURE.md` 初始化确认弹窗。
- 用户确认后，复用当前 AI 对话的 CLI 分组、模型和配置，强制切换到 coding 模式发起初始化任务。
- 任务提示词要求 AI 阅读当前项目架构并更新 `ARCHITECTURE.md`，不模拟安装过程。
- 保持用户取消时无副作用，Harness 初始化本身仍然成功。

## 范围

- `src/extension.ts`
- `src/i18n.ts`
- 相关事实来源文档

## 非目标

- 不新增新的 CLI 执行器。
- 不绕过当前会话配置另起外部进程。
- 不直接在扩展代码里生成项目架构内容。

## 验收标准

- [x] Harness 初始化成功后会询问是否初始化 `ARCHITECTURE.md`。
- [x] 确认后当前 CLI 的交互模式被设置为 `coding`，并通过现有 prompt 运行链路发起任务。
- [x] prompt 明确要求分析当前项目并按 Harness 模板更新 `ARCHITECTURE.md`。
- [x] 取消第二个弹窗不会关闭 Harness 开关或阻断 CodeGraph 初始化。
- [x] `npm run build` 通过。

## 影响面

- 代码目录：`src/extension.ts`、`src/i18n.ts`
- 文档目录：`docs/`、`.ch/docs/`
- 配置与脚本：无

## 风险与缓解

- 风险：从设置面板发起任务时误用 loop 模式。
- 缓解：扩展侧显式调用 `setWorkspaceInteractiveModeForCli(cli, "coding")` 并直接走 `runPrompt`。
- 风险：用户取消二次弹窗导致前端开关状态错误。
- 缓解：二次弹窗只控制 `ARCHITECTURE.md` 初始化任务，不影响 scaffold 初始化返回值。

## 验证计划

- 最小相关验证：`npm run build`
- 单元自测命令：相关代码路径当前以类型检查为主；若可复用测试入口则补充相关断言。
- 扩展验证：人工触发工具设置工作区 Harness 开关，确认两次弹窗和任务发起链路。

## 测试与清单同步

- 单元测试新增/更新：待实现后评估。
- 单元自测结果：`npm run build` 通过；`node --test dist/test/longTermMemory.test.js dist/test/toolSettings.test.js dist/test/memoryRuntimeGate.test.js` 通过，16/16 passed。
- 失败处理记录：无。
- 功能清单：待同步。
- 相关文档同步：待同步。

## 任务列表

- [x] 定位 Harness 初始化与 prompt 发起链路
- [x] 增加二次确认和 coding 模式 prompt 发起逻辑
- [x] 同步国际化和文档
- [x] 运行验证并归档计划

## 决策记录

- 2026-07-03：采用扩展侧二次确认 + 现有 `runPrompt` 链路，不新增独立执行器。

## 当前结论

已完成扩展侧二次确认、coding 模式切换、当前 CLI/模型复用和文档同步。最终验证通过：`npm run build`；`node --test dist/test/longTermMemory.test.js dist/test/toolSettings.test.js dist/test/memoryRuntimeGate.test.js`，16/16 passed。本计划可归档。
