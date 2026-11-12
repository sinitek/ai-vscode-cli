# Codex `.env` 移除并保留可视化编辑器

- 日期：2026-07-31
- 状态：completed
- 负责人：Codex
- owner：Codex
- claimed_at：2026-07-31
- claim_ttl：当前会话
- handoff_to：
- 类型：feature

## 关联计划

- [测试计划删除审计](../../migrations/test-plan-removals/2026-11-11-jul-sep.json)：按用户授权删除 test 类型记录，仅留存历史验证证据；本计划不承接独立测试开发。
- [docs：产品、运行时或审计文档写作](./2026-07-31-docs-codex-env-removal-keep-visual-editor.md)：同源历史任务；文档计划依据本实现的能力和兼容边界编写事实说明；写作不再属于本实现。

以上记录按原计划的实际交付拆分，日期、完成状态与各项验证限制沿用历史记录；下列历史命令及结果不是2026-11-11重新执行的证明。

## 背景

携宁 CLI 的 Codex 配置页此前管理 `~/.codex/config.toml`、`~/.codex/.env` 和 `auth.json`，同时为 `config.toml` 提供可视化编辑器。产品要求去掉 `.env` 文件及其配置入口，但保留 Codex 的可视化配置能力。

## 目标

配置中心不再读取、写入、备份、导入导出或展示 Codex `.env`；`config.toml` 可视化编辑器、TOML 源码模式和既有 `auth.json` 入口继续可用。

## 范围

- 移除 `src/config/configService.ts` 中 Codex `.env` 的运行时、档案、应用和备份链路。
- 移除 `media/config/assets/config-app-ui.js` 中 Codex `.env` 范例、源码编辑区、可视化字段和保存/应用载荷。
- 服务层及Webview移除实现为本范围；独立回归测试开发不归本记录（原test计划已删除），配置中心文档写作仍归关联docs。

## 非目标

- 不删除或改写用户机器上已有的 `~/.codex/.env`。
- 不移除 Codex `config.toml` 的可视化编辑器或 TOML 源码模式。
- 不调整 Claude 和 OpenCode 的配置能力。

## 验收标准

- [x] Codex 可视化编辑器与 TOML 源码模式继续展示并可保存 `config.toml`。
- [x] Codex 页面、范例和保存/应用流程不再展示或传递 `.env`。
- [x] 配置档案、运行时读取、备份、导入导出忽略历史 Codex `envContent`，且不修改用户已有 `.env`。
- [x] `npm run build` 与相关回归测试通过。

## 影响面

- 代码目录：`src/config/`、`src/webviewCommandCoordinator.ts`、`src/extension.ts`、`media/config/assets/`
- 文档影响与写作责任：见关联docs计划。
- 配置与脚本：无新增配置或脚本

## 风险与缓解

- 风险：移除 `.env` 时误删 Codex 的 TOML 可视化配置。
- 缓解：保留 `CODEX_VISUAL_EDITOR_UTILS`、`renderCodexVisualEditor` 和双模式切换，并用静态契约测试覆盖。

## 验证计划

- 最小相关验证：`node --check media/config/assets/config-app-ui.js`
- 单元自测命令：`npm run build`；`node --test dist/test/configService.test.js dist/test/codexConfigVisualEditor.test.js dist/test/cliPageConfigCoverage.test.js dist/test/claudeConfigVisualEditor.test.js dist/test/opencodeconfigvisualeditor.test.js`
- 扩展验证：`git diff --check`

## 测试与清单同步

- 测试开发与原始验证/失败明细见[测试计划删除审计](../../migrations/test-plan-removals/2026-11-11-jul-sep.json)，本实现记录仅消费验证证据。
- 产品/运行时/审计文档及功能清单写作见关联[docs计划](./2026-07-31-docs-codex-env-removal-keep-visual-editor.md#范围与非目标)，不属于本实现范围。

## 任务列表

- [x] 恢复误删的 Codex 可视化编辑器改动并定位 `.env` 链路。
- [x] 移除 Codex `.env` 服务层和 Webview 入口，同时保留 TOML 可视化编辑器。
- [x] 消费历史构建及73项回归验证，历史测试验证证据见删除审计，文档仍由关联计划验收。

## 决策记录

- 2026-07-31：保留 `config.toml` 可视化编辑器；仅移除 `.env` 相关状态、字段、编辑区和持久化链路。

## 当前结论

Codex 配置中心只管理 `~/.codex/config.toml` 与既有 `auth.json`。可视化编辑器、TOML 源码模式和 Provider 编辑仍在；`.env` 不再展示、读取、写入、备份或进入档案，插件不会删除或改写用户现有的 `~/.codex/.env`。

## 测试类型记录清理

2026-11-11 按用户明确授权删除本来源的 test 类型计划；历史验证命令、结果、失败、跳过与限制见 [测试计划删除审计](../../migrations/test-plan-removals/2026-11-11-jul-sep.json)（按原来源路径检索）。本记录的作者、日期、状态与历史结果不变，不接回独立测试开发，也不表示本轮重跑历史命令。
