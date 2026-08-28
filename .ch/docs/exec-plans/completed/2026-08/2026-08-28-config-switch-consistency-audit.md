# 配置切换一致性排查

- 日期：2026-08-28
- 状态：completed
- 负责人：Codex
- owner：codex
- claimed_at：2026-08-28
- claim_ttl：本次会话
- handoff_to：

## 背景

用户反馈 AI 对话中切换配置后，下拉选项已经显示为新配置，但偶发实际请求仍可能使用旧配置。本次需要核对 Webview 显示、扩展侧激活状态、配置持久化、会话 Runner 和实际 CLI 启动参数是否一致。

## 目标

确认是否存在可导致“界面已切换、实际未切换”的代码路径，区分已确认缺陷、理论竞态和当前实现已覆盖的场景；如能稳定定位并修复，则补充最小回归测试。

## 范围

- 配置档案下拉选择的 Webview 事件和扩展消息处理。
- `activeConfigIdByCli` 的内存状态、工作区持久化和配置读取。
- 新建提示、排队提示、会话续接和各 CLI Runner 的配置解析。
- 异步竞态、失败回滚、旧请求覆盖新状态和运行中切换语义。

## 非目标

- 不替换现有配置存储格式或 CLI 运行架构。
- 不重构与本问题无关的配置中心、模型选择或 Loop 流程。
- 不把运行中已有请求强行迁移到新配置，除非当前契约明确要求。

## 验收标准

- [x] 给出配置切换从 UI 到 CLI 调用的可核对链路。
- [x] 明确列出至少一个成功路径、失败路径和快速连续切换路径的行为。
- [x] 若发现缺陷，修复后有针对性回归测试并通过最小相关验证。
- [x] 若改变用户可见行为，同步功能事实源；若仅为排查且无行为变化，记录无需同步的理由。

## 影响面

- 代码目录：`src/webview/`、`src/sessionMessageHandlers.ts`、`src/extension.ts`、`src/extensionHost/`、`src/interactive/`、`src/config/`
- 文档目录：`.ch/docs/exec-plans/`，必要时同步 `.ch/docs/product-specs/`、`.ch/docs/design-docs/` 或 `.ch/docs/runbooks/`
- 配置与脚本：无预期结构变化

## 风险与缓解

- 风险：配置切换和提示发送在不同异步消息中交错，导致旧请求或旧快照继续执行。
- 缓解：按请求代次、配置 ID 和实际启动参数核对，并用延迟 Promise 回归测试模拟交错。
- 风险：已有会话续接可能天然保留旧 CLI thread/session 上下文。
- 缓解：区分配置档案切换与 CLI 切换，核对 `modelProvider`、session 映射和 Runner 复用契约。

## 验证计划

- 最小相关验证：配置消息处理、PanelState 构建、Session/Runner 配置选择相关测试。
- 单元自测命令：`npm run build`；必要时运行精确的 `node --test dist/test/...`。
- 扩展验证：若自动化证据不足，再使用本地真实测试检查日志和 Webview 状态，不修改用户配置。

## 测试与清单同步

- 单元测试新增/更新：新增 `src/test/configApplyQueue.test.ts`；更新 `src/test/sessionMessageActions.test.ts`、`src/test/sessionMessageHandlersCoreCoverage.test.ts`、`src/test/clipagescriptruntimecoverage.test.ts`。
- 单元自测结果：`npm run build` 通过；`node --test dist/test/configApplyQueue.test.js dist/test/sessionMessageActions.test.js dist/test/sessionMessageHandlersCoreCoverage.test.js dist/test/clipagescriptruntimecoverage.test.js` 64/64 通过；`git diff --check` 通过；`python3 .agents/skills/ontology/scripts/search_ontology.py --validate` 通过；`python3 -m unittest discover -s .agents/skills/ontology/tests -p 'test_*.py'` 9/9 通过。
- 失败处理记录：未发现需要处理的失败。
- 功能清单：已同步 `.ch/docs/product-specs/FEATURE_INVENTORY.md`，新增“配置切换提交后生效与发送门禁”。
- 相关文档同步：已同步 `.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md`、`.ch/docs/runbooks/PITFALLS.md` 和 `.ch/docs/ontology/domains/cli-plugin-runtime.json`。

## 任务列表

- [x] 阅读仓库导航文档并确认当前工作区状态
- [x] 梳理配置切换与实际调用的完整链路
- [x] 检查异步竞态、失败回滚和状态持久化风险
- [x] 补充或执行针对性测试并给出结论

## 决策记录

- 2026-08-28：先按配置档案 ID 和 CLI 运行入口追踪，不把下拉显示变化直接视为切换成功。
- 2026-08-28：确认存在竞态窗口：Webview 下拉乐观切换后，宿主 `applyConfig` 尚未完成，发送路径仍可能读取旧 `activeConfigIdByCli` 或 heartbeat 快照。
- 2026-08-28：引入 per-CLI `configApplyQueue`，采用 latest-selection-wins；被覆盖的旧请求返回 `superseded`，只有最新请求可提交 active config。
- 2026-08-28：`sendPrompt` 和队列出队在 `pendingConfigApply` 期间阻止发送并保留输入；宿主发送路径也等待配置应用完成后再解析模型与启动 run。
- 2026-08-28：配置应用失败时，Webview 回滚到当前真实 active config 并展示错误详情。

## 当前结论

已确认并修复“下拉已切换但实际运行仍可能使用旧配置”的偶发竞态。

成功路径：用户选择配置 B 后，Webview 先记录 `pendingConfigApply` 并发出 `applyConfig`；宿主成功写入对应 CLI 配置并提交 `activeConfigIdByCli=B` 后刷新 PanelState，前端清除 pending，后续 prompt 按 B 解析模型与运行参数。

失败路径：宿主应用配置失败时发送 `configApplyError`，前端清除 pending 并回滚到当前 active config；用户输入不会被清空，新的发送不会伪装成 B 已生效。

快速连续切换路径：同一 CLI 的配置切换由 `configApplyQueue` 串行处理，后来的选择覆盖更早待执行请求；旧请求即使写文件已开始，也不能提交 active config，最终只以最新选择为准。
