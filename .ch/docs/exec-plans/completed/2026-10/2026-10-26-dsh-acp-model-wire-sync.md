# DSH ACP 模型 wire 与激活配置同步修复

- 日期：2026-10-26
- 状态：completed
- 负责人：Codex
- owner：Codex
- claimed_at：2026-10-26
- claim_ttl：本次会话
- handoff_to：

## 背景

真实运行发现，配置档案中的 `deepseek-v4.1-flash` 与 DSH 已激活 patch 中的完整模型 id `subcoco/deepseek-v4.1-flash` 不一致。DSH ACP 只广告激活 patch 的 provider wire，因此插件下发 `['sinitek-custom', 'deepseek-v4.1-flash']` 时失败，并报 `model ... is not in the advertised ACP options`。

## 目标

- 恢复并统一已实跑确认的完整模型 id `subcoco/deepseek-v4.1-flash`，保留 `deepseek-v4.1-flash` 作为响应别名。
- 让所有 DSH 范例、可视化范例、文档和测试使用同一完整模型 id。
- 防止已激活 profile 文件与激活 patch 漂移，启动前自动以当前激活 profile 生成一致 patch。
- 用本机真实 `dsh 0.2.1-rc.2` 和 loopback 网关验证握手、模型广告、模型切换和 prompt。

## 范围

- `src/cli/dshConfigModels.ts`、`media/config/assets/config-app-ui.js` 的模型常量与范例。
- `src/extensionHost/dshInteractiveLaunch.ts` 的激活 profile 与 patch 同步。
- DSH ACP、配置页、Extension Host 回归测试。
- DSH 契约、功能清单、Ontology 和执行计划。

## 非目标

- 不修改 DSH ACP 协议、不改 provider wire 格式。
- 不把真实 API key、loopback 地址或本机运行数据写入仓库。
- 不改其他 CLI 的模型选择逻辑。

## 验收标准

- [x] DSH 默认模型和所有范例使用 `subcoco/deepseek-v4.1-flash`，响应别名仍为 `deepseek-v4.1-flash`。
- [x] 激活 profile 与 profile 文件发生漂移时，启动 patch 使用当前激活 profile 的完整模型配置。
- [x] 真实 DSH ACP 广告包含目标 wire，目标 wire 可以设置并完成 prompt。
- [x] 相关单测、构建、Ontology 和空白检查通过。

## 影响面

- 代码目录：`src/cli/dshConfigModels.ts`、`src/extensionHost/dshInteractiveLaunch.ts`、`media/config/assets/config-app-ui.js`。
- 测试目录：DSH ACP、配置页和 Extension Host 回归测试。
- 文档目录：`.ch/docs/references/`、`.ch/docs/product-specs/`、`.ch/docs/ontology/`。

## 风险与缓解

- 风险：把响应别名误当成可执行模型，继续产生错误 wire。
- 缓解：完整模型 id 与响应别名分离，校验、范例和测试都覆盖两者边界。
- 风险：自动修复激活 patch 越过用户显式应用意图。
- 缓解：只在 activation marker 指向的 profile 文件与快照不一致时同步；运行时仍只读取已激活 profile id。
- 风险：真实运行读到用户密钥或污染用户 DSH 文件。
- 缓解：只输出脱敏模型广告和 stopReason，使用插件已有隔离 `DSH_HOME`，不写仓库和用户默认运行文件。

## 验证计划

- 最小相关验证：DSH config models、ACP protocol、runner、Extension Host wire 测试。
- 单元自测命令：`npm run build`、`node --test ...`、`npm run validate:whitespace`、`git diff --check`。
- 真实验证：使用当前本机 `dsh 0.2.1-rc.2`，确认广告模型、错误 wire 拒绝、正确 wire 接受和最小 prompt 完成。

## 测试与清单同步

- 单元测试新增/更新：完整模型 id、响应别名、激活 profile 漂移修复和真实 wire 保护。
- 单元自测结果：`npm run build` 通过；8 个相关测试文件共 75 项通过；`npm run validate:whitespace`、`git diff --check`、Ontology validate 和 Ontology 单测（9 项）均通过。
- 失败处理记录：已确认错误来自配置 profile 与激活 patch 的模型 id 漂移，不是缺少 `apiKey` 或 provider 字段。
- 后续双字段实跑：从配置页一键导入原始范例出发只替换 `apiKey` 与 `baseURL`，在隔离 `DSH_HOME` 配置下运行本机 `dsh 0.2.1-rc.2` 和 loopback OpenAI-compatible 网关；确认 ACP 启动并选择完整模型、请求到达 `/v1/chat/completions`、测试 key 以 Bearer 头发送、请求模型为 `subcoco/deepseek-v4.1-flash`，最终 `stopReason=end_turn`。该验证证明配置与启动链路，不代表任意远程服务都已部署该模型。
- 功能清单：同步 DSH 完整模型 id 与激活配置同步行为。
- 相关文档同步：同步 DSH custom provider 契约和 Ontology 规则。
- 真实验证结果：用户授权后，在隔离 `DSH_HOME` 和 loopback 网关上实跑本机 `dsh 0.2.1-rc.2`；旧短模型 wire 被 ACP 拒绝，完整 wire 出现在广告选项并成功设置，最小 prompt 以 `end_turn` 完成且收到预期标记。没有输出密钥或原始回复。

## 任务列表

- [x] 恢复规范完整模型 id 并更新所有范例
- [x] 修复激活 profile 与 patch 漂移
- [x] 补充回归测试和文档
- [x] 完成本机真实 DSH 验证并归档计划

## 决策记录

- 2026-10-26：真实 `session/new` 广告确认当前 provider wire 必须使用 `subcoco/deepseek-v4.1-flash`；`deepseek-v4.1-flash` 只作为响应别名保留。
- 2026-10-26：配置文件与激活 patch 不一致时，以 activation marker 指向的 profile 文件为运行时事实源，并在隔离启动前重写 patch 快照。

## 当前结论

真实握手已复现用户报错并验证修复：正确 wire 可广告、设置并完成最小 prompt；旧短名迁移、profile/patch 快照同步、代码和 UI 范例及文档均已统一。构建、75 项相关回归、空白检查与 Ontology 校验通过。未执行真实 VS Code Extension Development Host 点击验收；本次 DSH ACP 隔离实跑已覆盖模型广告和 prompt 链路。
