# DSH 范例采用无前缀模型名

- 日期：2026-10-26
- 状态：completed
- 负责人：Codex
- owner：Codex
- claimed_at：2026-10-26
- claim_ttl：本次会话
- handoff_to：

## 背景

DSH 配置范例当前把 `subcoco/deepseek-v4.1-flash` 固定为模型 id，并将 `deepseek-v4.1-flash` 作为不可执行响应别名。此前的真实 ACP 验证只证明 profile 与激活 patch 中的模型 id 必须一致；该结果不能证明所有自定义 OpenAI-compatible 网关都要求模型 id 带 `subcoco/` 前缀。用户明确要求范例使用无前缀模型名。

## 目标

- 将 DSH 代码范例、配置页范例与产品文档默认模型改为 `deepseek-v4.1-flash`。
- 让用户显式配置的模型 id 原样进入 ACP provider wire，不因它与响应短名相同而被拒绝或改写。
- 保留现有自定义模型 id（包括带 `subcoco/` 的 id）兼容性，并真实验证无前缀 id 的 ACP 广告与最小请求。

## 范围

- `src/cli/dshConfigModels.ts` 的默认模型和别名/旧值规范化。
- `media/config/assets/config-app-ui.js` 的配置页默认值和校验。
- DSH 配置、ACP 与 Extension Host 回归测试。
- DSH provider 契约、产品能力清单、Ontology 与执行计划。

## 非目标

- 不自动给用户自定义模型 id 添加或删除前缀。
- 不更改 ACP wire 格式、provider route、认证方式或 baseURL 约定。
- 不声称任意远程端点都支持 `deepseek-v4.1-flash`；端点必须实际接受范例模型名。

## 验收标准

- [x] 配置页范例中的 `models[].id`、`models[].name` 和 `acpModel` 均为 `deepseek-v4.1-flash`。
- [x] 配置、可视化、保存和运行 wire 保持无前缀模型 id；不再自动改写成 `subcoco/...`。
- [x] 仍可显式配置并运行 `subcoco/deepseek-v4.1-flash` 等自定义完整 id。
- [x] 使用本机 DSH 与隔离 loopback OpenAI-compatible 接口验证无前缀 ACP 广告和请求，单轮返回 `end_turn`。
- [x] 相关测试、构建、Ontology 校验和空白检查通过。

## 影响面

- 代码目录：`src/cli/`、配置页静态资源。
- 文档目录：`.ch/docs/references/`、`.ch/docs/product-specs/`、`.ch/docs/ontology/`。
- 配置与脚本：无生产配置修改；实跑使用隔离临时 DSH_HOME 和测试密钥。

## 风险与缓解

- 风险：把无前缀模型名作为所有服务的保证。
- 缓解：文档明确 API 端点必须支持范例中的精确模型 id；其他 id 由用户在 `models[].id` 与 `acpModel` 中保持一致。
- 风险：移除别名限制导致未配置模型可执行。
- 缓解：运行选择仍严格限定在 profile `models[]` 中，并由 ACP 当前广告选项确认。

## 验证计划

- 最小相关验证：DSH 配置模型、配置页和 ACP wire 测试。
- 单元自测命令：`npm run build` 后运行相关 `dist/test/**/*.test.js`。
- 扩展验证：本机 `dsh 0.2.1-rc.2` + loopback 兼容接口，确认 wire、HTTP 请求模型和 `end_turn`。

## 测试与清单同步

- 单元测试新增/更新：无前缀默认模型与 wire、自定义带前缀模型保留、未配置模型拒绝。
- 单元自测结果：`npm run build` 通过；`node --test dist/test/cli/dshConfigModels.test.js dist/test/config/dshconfigpage.test.js dist/test/interactive/dshRunner.test.js dist/test/extensionHost/dshInteractiveHostWire.test.js dist/test/extensionHost/dshModelSelection.test.js dist/test/extensionHost/dshPluginLiveBoundary.test.js` 通过（54 项，53 passed、1 skipped、0 failed；跳过项需要外部 `SINITEK_DSH_LIVE` loopback endpoint）；`npm run validate:whitespace`、`git diff --check` 和 `python3 .agents/skills/ontology/scripts/search_ontology.py --validate` 均通过。
- 真实运行：`node <<'NODE'` 内联 smoke harness 使用 `createDshExampleDocument` 生成范例、临时 `DSH_HOME`、`prepareDshIsolatedLaunch`、本机 `dsh 0.2.1-rc.2`、`DshInteractiveRunner` 和 loopback SSE 网关；确认广告 wire 为 `["sinitek-custom","deepseek-v4.1-flash"]`，请求 `/v1/chat/completions` 的 `model` 为 `deepseek-v4.1-flash`，Bearer 测试密钥收到，回复 `pong` 且 `stopReason=end_turn`。未调用真实远程 provider，不能据此保证任意 URL 支持该模型。
- 失败处理记录：早期多轮 mock smoke 在后续会话步骤失败，原因是 mock 未覆盖完整会话语义；本次按验收范围改用独立单轮真实 DSH runner 流程，完整通过。远程服务兼容仍由用户提供的 endpoint/API key 决定。
- 功能清单：同步默认范例模型名及端点兼容前提。
- 相关文档同步：更新 DSH 契约、能力清单和 Ontology；历史计划保留当时验证证据。

## 任务列表

- [x] 确认前缀来自旧范例约束
- [x] 更新默认范例与校验逻辑
- [x] 同步文档和 Ontology
- [x] 完成实跑记录及最终回归验证

## 决策记录

- 2026-10-26：provider route 与 endpoint 的模型 id 是独立字段；只要 profile 与激活 patch 使用同一 `models[].id`，ACP wire 应保留该 id 原值。用户要求默认范例不带 `subcoco/`。

## 当前结论

范例和模型 id 校验已更新。本机 DSH 的隔离 loopback 单轮实跑、54 项 DSH 定向测试（53 通过、1 项受控跳过）、构建、Ontology 校验、空白及 diff 检查均完成。模型 id 会按范例值无前缀发出；此实跑不是用户真实远程 endpoint 验收。计划已完成，可归档。
