# 定时任务按执行时模式运行

- 日期：2026-09-15
- 状态：completed
- 负责人：Codex
- owner：Codex
- claimed_at：2026-09-15
- claim_ttl：本次会话

## 背景

定时任务目前在创建时保存 `interactiveMode` 和 Loop 执行配置，任务到期后直接使用持久化旧值。用户切换当前 CLI 的模式后，任务可能仍按创建时的 Loop/Graph 模式执行。

## 目标

定时任务到期执行时，以任务目标 CLI 在当时的当前模式为准；Loop 的执行子模式也读取执行时配置，避免沿用过期的模式选择。

## 范围

- 调整 `executeScheduledTask` 的模式解析与 Prompt 构建。
- 保留已有任务记录字段和创建流程，兼容历史持久化数据。
- 补充可稳定覆盖模式切换后的回归测试，并同步产品/ontology 事实来源（如有必要）。

## 非目标

- 不改变立即发送、Loop/Graph 本身的调度语义。
- 不迁移定时任务存储格式，不新增重复执行能力。

## 验收标准

- [x] 任务创建后切换目标 CLI 到 `loop`，到期执行进入 Loop。
- [x] 任务创建后切换目标 CLI 到 `graph`，到期执行进入 Graph。
- [x] 到期时 Loop 执行子模式使用当前配置，旧记录字段仅保留用于历史数据兼容。
- [x] 相关构建和单元测试通过。

## 影响面

- 代码目录：`src/extension.ts`、必要时 `src/scheduledTaskStore.ts`。
- 测试目录：`src/test/scheduledTaskStore.test.ts` 或扩展运行时覆盖。
- 文档目录：`.ch/docs/product-specs/FEATURE_INVENTORY.md`、`.ch/docs/ontology/domains/cli-plugin-runtime.json`（按语义变化判断）。

## 风险与缓解

- 风险：目标 CLI 的当前模式与任务保存时不同，可能改变用户原先预期。
- 缓解：按用户明确的“执行时模式”语义读取 workspace 当前配置；历史记录字段继续保留但不覆盖当前配置，缺少配置时使用既有 coding 默认值。

## 验证计划

- 最小相关验证：模式解析/执行路由回归测试。
- 单元自测命令：`npm run build`；`node --test dist/test/scheduledTaskStore.test.js`；必要时运行扩展运行时相关测试。
- 扩展验证：`git diff --check`，检查产品清单与 ontology 是否需要更新。

## 测试与清单同步

- 单元测试新增/更新：更新 `src/test/scheduledTaskStore.test.ts`，新增执行时模式解析覆盖；更新 `src/test/extensionHost/extensionHostExtractionContracts.test.ts`，锁定扩展执行入口按目标 CLI 当前模式路由。
- 单元自测结果：`npm run build` 通过；`node --test dist/test/scheduledTaskStore.test.js dist/test/extensionHost/extensionHostExtractionContracts.test.js` 23/23 通过；`python3 .agents/skills/ontology/scripts/search_ontology.py --validate` 通过；ontology unittest 9/9 通过；`git diff --check` 通过。
- 失败处理记录：`npm run test:unit` 共 958 项，957 通过、1 项失败；失败为既有 `src/test/webview/clipagescriptruntimecoverage.test.ts` 中 `Tasklist update` 旧断言，与本次定时任务模式路由改动无关，未修改该既有解析契约。
- 功能清单：已更新定时任务条目，明确到点按目标 CLI 当时的 `interactiveMode` 和 Loop 子模式配置执行。
- 相关文档同步：已更新 `.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md` 与 `.ch/docs/ontology/domains/cli-plugin-runtime.json`。

## 任务列表

- [x] 梳理定时任务创建、存储和执行调用链
- [x] 实现执行时模式解析和 Loop 子模式读取
- [x] 补回归测试并完成构建验证
- [x] 同步计划、功能清单和 ontology 收尾记录

## 决策记录

- 2026-09-15：执行时模式以目标 CLI 的 `workspaceSettings.interactiveModeByCli` 当前值为准；任务记录中的 `interactiveMode` 保留为历史兼容字段，不参与到期路由。

## 当前结论

已完成：`executeScheduledTask` 在任务进入 running 后按 `task.cli` 读取 workspace 当前 `interactiveMode` 与 Loop 执行子模式；任务记录旧字段继续保留以兼容历史数据。构建、相关回归测试和 ontology 校验通过；全量单测仅保留一个范围外的既有 Tasklist 断言失败。本计划可归档。
