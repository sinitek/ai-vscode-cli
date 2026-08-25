# 计划标题

- 日期：2026-08-25
- 状态：completed
- 负责人：Codex
- owner：Codex
- claimed_at：2026-08-25
- claim_ttl：本轮
- handoff_to：

## 背景

Codex app-server 的 thread 历史由 `threadId` 持久化。当前插件在模型或 Codex 配置切换时主动丢弃已映射 thread，导致新回合看不到旧上下文；同时 app-server 恢复请求没有显式传入当前配置的 `modelProvider`。

## 目标

跨模型或 provider 切换时优先通过 `thread/resume` 复用同一 `threadId`，并显式传递当前 `modelProvider`，让 Codex app-server 按官方恢复路径继续会话。

## 范围

- Codex app-server thread 参数构造与运行时 provider 读取。
- Codex interactive runner 的 thread 选择策略。
- 相关单元测试和 Codex runtime 事实文档。

## 非目标

- 不重放旧工具调用或重新发送完整历史事件。
- 不替换 Codex app-server 或 CLI 版本。
- 不处理 provider-specific 加密 reasoning 历史的服务端兼容性缺陷。

## 验收标准

- [x] 当前 `model_provider` 被传给 Codex app-server 的 thread 请求。
- [x] 模型或配置切换仍复用已有 threadId。
- [x] 相关 TypeScript 构建与单元测试通过。
- [x] 事实来源文档说明新的恢复语义和限制。

## 影响面

- 代码目录：`src/interactive/`、`src/extensionHost/`。
- 文档目录：`.ch/docs/references/cli-runtime-reference.md`、`.ch/docs/product-specs/FEATURE_INVENTORY.md`。
- 配置与脚本：无。

## 风险与缓解

- provider-specific 加密历史仍可能被 Codex 服务端拒绝；保留 app-server 原始错误并记录限制，不伪造历史重放。
- 旧配置没有 `model_provider`；请求省略该字段，继续使用 Codex 自动恢复。

## 验证计划

- 最小相关验证：Codex thread 参数、选择器和 runner 生命周期测试。
- 单元自测命令：`npm run build`；`node --test dist/test/codexThreadSelection.test.js dist/test/codexRunnerRuntime.test.js dist/test/codexRunnerLifecycle.test.js`。
- 扩展验证：检查生成的 JSON-RPC 请求包含 `modelProvider` 和原 threadId。

## 测试与清单同步

- 单元测试新增/更新：更新 Codex thread selection/runtime 测试，并新增 TOML provider 解析和 runner JSON-RPC 请求级测试。
- 单元自测结果：`npm run build` 通过；`node --test dist/test/codexThreadSelection.test.js dist/test/codexRunnerRuntime.test.js dist/test/codexRuntimeConfig.test.js dist/test/codexRunnerLifecycle.test.js` 20/20 通过。
- 失败处理记录：新增 runner mock 首次因字符串换行转义失败，已修正测试 fixture 后重跑通过；产品代码未发生失败。
- 功能清单：已更新 `.ch/docs/product-specs/FEATURE_INVENTORY.md` 与能力规格。
- 相关文档同步：已更新 runtime reference、运行时设计和 ontology；`search_ontology.py --validate` 通过。

## 任务列表

- [x] 扩展 Codex thread 运行时参数并读取 provider。
- [x] 调整模型切换的 thread 复用策略。
- [x] 更新测试、事实来源和验证结论。

## 决策记录

- 2026-08-25：采用官方 `thread/resume` 语义，不增加历史事件重放开关。

## 当前结论

已完成 provider-aware resume：模型或配置切换保留 threadId，`thread/start` / `thread/resume` 传入当前 TOML 的 `modelProvider`，移除无效 `persistExtendedHistory` 请求字段。服务端无法解密跨 provider/account 的加密 reasoning 历史时仍会保留原始错误，这是 app-server 限制而非可由客户端重放解决。
