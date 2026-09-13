# 工具设置自动清理保留天数

- 日期：2026-09-13
- 状态：completed
- 负责人：Codex
- owner：
- claimed_at：
- claim_ttl：

## 背景

插件会对 `~/.sinitek_cli` 下的日志、会话、提示词历史、任务记录和 Loop 记录统一按固定 30 天保留，但该期限目前写死在代码中，工具设置无法调整。

## 目标

在工具设置增加全局“自动清理”页签，允许用户配置统一的历史数据保留天数，并让现有清理逻辑动态使用该配置。

## 范围

- 全局工具设置持久化、读取、校验和默认值。
- 工具设置 Webview 页签、输入控件和中英文文案。
- 日志、会话、提示词历史、任务和 Loop 清理逻辑接入动态保留天数。
- 相关单元测试、Webview 覆盖和功能清单/运行事实文档同步。

## 非目标

- 不改变临时目录当前 1 小时清理策略。
- 不增加按数据类型分别配置的多个期限；本次统一控制现有历史保留策略。
- 不提供立即清理按钮或删除用户外部 CLI 配置。

## 验收标准

- [x] 设置页存在全局“自动清理”页签，可编辑并保存保留天数。
- [x] 重启/重新加载后配置仍从 `~/.sinitek_cli/settings.json` 生效，默认行为保持 30 天。
- [x] 现有历史清理路径全部使用配置值，输入范围和非法值有稳定归一化行为。
- [x] 中英文文案、功能清单和相关事实文档同步。
- [x] `npm run build` 及相关单测通过。

## 影响面

- 代码目录：`src/toolSettings.ts`、`src/historyRetention.ts`、`src/logger.ts`、`src/extension.ts`、`src/sessionMessageActions.ts`、`src/panelStateBuilder.ts`、`src/webview/`。
- 文档目录：`.ch/docs/product-specs/FEATURE_INVENTORY.md`、`.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md`、`.ch/docs/references/cli-runtime-reference.md`。
- 配置与脚本：`~/.sinitek_cli/settings.json`（运行时，不写入仓库）。

## 风险与缓解

- 风险：过小保留天数会导致用户历史较快被删除。
  - 缓解：设置最小值 1 天，界面明确说明作用范围并保留默认 30 天。
- 风险：历史清理调用点遗漏导致行为不一致。
  - 缓解：统一从 `historyRetention` 动态函数取值，并检索所有清理入口补测试。

## 验证计划

- 最小相关验证：工具设置归一化、消息处理持久化、Webview 静态/运行时设置交互、动态 cutoff。
- 单元自测命令：`node --test dist/test/core/toolSettings.test.js dist/test/session/sessionMessageActionsCoreCoverage.test.js dist/test/webview/cliPageStaticRenderCoverage.test.js dist/test/webview/clipagescriptruntimecoverage.test.js`。
- 扩展验证：`npm run build`；检查生成的 Webview 含自动清理页签和控件。

## 测试与清单同步

- 单元测试新增/更新：`src/test/core/toolSettings.test.ts`、`src/test/session/sessionMessageActionsCoreCoverage.test.ts`、`src/test/webview/cliPageStaticRenderCoverage.test.ts`、`src/test/webview/clipagescriptruntimecoverage.test.ts`。
- 单元自测结果：`npm test` 通过（947/947）；ontology 校验与 9 项测试通过；impeccable detector 无发现。
- 失败处理记录：暂无。
- 功能清单：已新增 `.sinitek_cli` 历史自动清理保留天数能力。
- 相关文档同步：已更新产品规格、CLI 运行时参考、扩展运行时设计、Loop 辩论设计与 ontology。

## 任务列表

- [x] 完成配置模型与动态保留逻辑
- [x] 完成工具设置页签、交互和国际化
- [x] 补测试并同步产品/运行文档
- [x] 执行构建与相关验证并归档计划

## 决策记录

- 2026-09-13：采用单一全局 `historyRetentionDays` 控制现有 30 天历史保留策略；临时目录 1 小时清理不纳入本次设置。

## 当前结论

已完成实现与验证：全局 `historyRetentionDays` 已接入 `.sinitek_cli` 历史清理链路，自动清理页签支持中英文和 1–3650 天校验；默认 30 天与临时目录 1 小时策略保持兼容。计划待归档至 `.ch/docs/exec-plans/completed/2026-09/`。
