# 定时任务按选中的 Vibe/Loop/Graph 配置执行

- 日期：2026-09-19
- 状态：completed
- 负责人：Codex
- owner：Codex
- claimed_at：2026-09-19
- claim_ttl：本次会话

## 背景

定时任务弹窗目前没有独立的模式选择，保存时只快照当前面板模式；到期后又按目标 CLI 当时的 `interactiveMode` 路由。用户需要在创建时显式选择 Vibe、Loop 或 Graph，并按选中模式已有配置执行。

## 目标

定时任务创建时可选择 Vibe / Loop / Graph；到期后按任务保存的模式路由到对应 Prompt 执行链，并使用该模式在创建时快照的配置。旧任务缺少模式字段时回退到目标 CLI 当前模式。

## 范围

- 定时任务弹窗增加 Vibe/Loop/Graph 选择器，默认当前面板模式。
- 保存时按选中模式快照对应配置（Loop 子模式读取当前 CLI 的 Loop 配置）。
- 到期执行优先使用任务保存的模式与 Loop 子模式，而不是覆盖为当时工作区模式。
- 任务列表展示选中模式；同步 i18n、测试、功能清单和 ontology。

## 非目标

- 不新增 cron / 重复执行。
- 不在弹窗内重复配置模型、Loop 子模式或 Graph 细节，只复用选中模式已有配置。
- 不改变立即发送、Loop/Graph 自身调度语义。

## 验收标准

- [x] 定时任务弹窗可选择 Vibe、Loop、Graph，默认当前面板模式。
- [x] 选择 Loop 时保存当前 CLI 的 Loop 执行子模式和角色模型配置。
- [x] 到期后按任务选中模式进入 `runPrompt` / `runLoopPrompt` / `runGraphPrompt`。
- [x] 旧任务缺少 `interactiveMode` 时仍可回退到目标 CLI 当前模式。
- [x] 相关构建和单元测试通过，功能清单与 ontology 已同步。

## 影响面

- 代码目录：`src/scheduledTaskStore.ts`、`src/extension.ts`、`src/webview/viewContentHtml.ts`、`src/webview/viewContentI18n.ts`、`src/webview/viewContentScript/*`、`src/webview/types.ts`。
- 文档目录：`.ch/docs/product-specs/FEATURE_INVENTORY.md`、`.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md`、`.ch/docs/ontology/domains/cli-plugin-runtime.json`。
- 配置与脚本：无新增运行时文件。

## 风险与缓解

- 风险：旧任务没有保存模式，行为会变化。
- 缓解：缺失字段时回退到目标 CLI 当前 `interactiveMode` 与 Loop 子模式。
- 风险：用户之后切换面板模式，期望定时任务跟着变。
- 缓解：按本次明确需求锁定“选中后的配置”；任务列表展示保存的模式。

## 验证计划

- 最小相关验证：模式解析、摘要字段、静态 HTML 选择器和扩展执行入口契约。
- 单元自测命令：`npm run build`；`node --test dist/test/scheduledTaskStore.test.js dist/test/extensionHost/extensionHostExtractionContracts.test.js dist/test/webview/cliPageStaticRenderCoverage.test.js dist/test/graph/graphRunPanel.test.js`。
- 扩展验证：`git diff --check`；ontology validate。

## 测试与清单同步

- 单元测试新增/更新：`src/test/scheduledTaskStore.test.ts`、`src/test/extensionHost/extensionHostExtractionContracts.test.ts`、`src/test/webview/cliPageStaticRenderCoverage.test.ts`。
- 单元自测结果：`npm run build` 通过；上述相关测试 51/51 通过，其中 `scheduledTaskStore` + `extensionHostExtractionContracts` 24/24，`cliPageStaticRenderCoverage` 8/8；`python3 .agents/skills/ontology/scripts/search_ontology.py --validate` 通过；ontology unittest 9/9 通过；`git diff --check` 通过。
- 失败处理记录：Impeccable detector 脚本在本机不存在，未执行 UI 机械检查。
- 功能清单：已更新定时任务条目，明确按选中的 Vibe/Loop/Graph 及该模式已保存配置执行。
- 相关文档同步：已更新 capabilities、ontology，并在旧 runtime-mode 计划中标注后续决策。

## 任务列表

- [x] 梳理定时任务表单、存储和执行链
- [x] 弹窗增加 Vibe/Loop/Graph 选择并保存选中模式配置
- [x] 到期执行按选中模式及对应配置路由
- [x] 补回归测试、构建验证并同步功能清单/ontology

## 决策记录

- 2026-09-19：创建时显式选择 Vibe/Loop/Graph；执行优先使用任务保存的模式和配置，不再用执行时工作区模式覆盖。
- 2026-09-19：弹窗不重复暴露模型或 Loop 子模式控件，选中 Loop 时读取当前 CLI 已有 Loop 配置。

## 当前结论

已完成：定时任务弹窗可选择 Vibe/Loop/Graph；保存时快照选中模式及对应配置；到期后按保存模式路由到 Vibe/Loop/Graph 执行链，旧记录缺字段时回退到目标 CLI 当前模式。构建、相关单测和 ontology 校验通过。本计划可归档。
