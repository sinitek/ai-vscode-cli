# Codex `.env` 移除并保留可视化编辑器

- 日期：2026-07-31
- 状态：completed
- 负责人：Codex
- owner：Codex
- claimed_at：2026-07-31
- claim_ttl：当前会话
- handoff_to：

## 背景

携宁 CLI 的 Codex 配置页此前管理 `~/.codex/config.toml`、`~/.codex/.env` 和 `auth.json`，同时为 `config.toml` 提供可视化编辑器。产品要求去掉 `.env` 文件及其配置入口，但保留 Codex 的可视化配置能力。

## 目标

配置中心不再读取、写入、备份、导入导出或展示 Codex `.env`；`config.toml` 可视化编辑器、TOML 源码模式和既有 `auth.json` 入口继续可用。

## 范围

- 移除 `src/config/configService.ts` 中 Codex `.env` 的运行时、档案、应用和备份链路。
- 移除 `media/config/assets/config-app-ui.js` 中 Codex `.env` 范例、源码编辑区、可视化字段和保存/应用载荷。
- 更新回归测试和配置中心事实来源文档。

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
- 文档目录：`.ch/docs/product-specs/`、`.ch/docs/references/`、`.ch/docs/design-docs/`、`docs/`
- 配置与脚本：无新增配置或脚本

## 风险与缓解

- 风险：移除 `.env` 时误删 Codex 的 TOML 可视化配置。
- 缓解：保留 `CODEX_VISUAL_EDITOR_UTILS`、`renderCodexVisualEditor` 和双模式切换，并用静态契约测试覆盖。

## 验证计划

- 最小相关验证：`node --check media/config/assets/config-app-ui.js`
- 单元自测命令：`npm run build`；`node --test dist/test/configService.test.js dist/test/codexConfigVisualEditor.test.js dist/test/cliPageConfigCoverage.test.js dist/test/claudeConfigVisualEditor.test.js dist/test/opencodeconfigvisualeditor.test.js`
- 扩展验证：`git diff --check`

## 测试与清单同步

- 单元测试新增/更新：更新 `src/test/configService.test.ts` 与 `src/test/codexConfigVisualEditor.test.ts`，覆盖 `.env` 不读写、不备份、不进入档案，以及可视化/TOML 双模式保留。
- 单元自测结果：`npm run build` 通过；`node --test dist/test/configService.test.js dist/test/codexConfigVisualEditor.test.js dist/test/cliPageConfigCoverage.test.js dist/test/claudeConfigVisualEditor.test.js dist/test/opencodeconfigvisualeditor.test.js dist/test/configappcompactcontrols.test.js dist/test/configappcompactlayoutstyles.test.js` 通过（73 项、0 失败）；`node --check media/config/assets/config-app-ui.js` 通过；`git diff --check` 通过。
- 失败处理记录：无。
- 功能清单：已同步 `FEATURE_INVENTORY.md`。
- 相关文档同步：已同步运行时参考、设计文档和兼容入口。

## 任务列表

- [x] 恢复误删的 Codex 可视化编辑器改动并定位 `.env` 链路。
- [x] 移除 Codex `.env` 服务层和 Webview 入口，同时保留 TOML 可视化编辑器。
- [x] 更新测试、文档并完成构建验证。

## 决策记录

- 2026-07-31：保留 `config.toml` 可视化编辑器；仅移除 `.env` 相关状态、字段、编辑区和持久化链路。

## 当前结论

Codex 配置中心只管理 `~/.codex/config.toml` 与既有 `auth.json`。可视化编辑器、TOML 源码模式和 Provider 编辑仍在；`.env` 不再展示、读取、写入、备份或进入档案，插件不会删除或改写用户现有的 `~/.codex/.env`。
