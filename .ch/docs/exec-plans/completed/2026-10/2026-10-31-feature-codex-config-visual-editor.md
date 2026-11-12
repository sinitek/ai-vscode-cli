# Codex 配置可视化参数 — 新功能开发

- 日期：2026-10-31
- 状态：completed
- 负责人：Codex
- owner：
- claimed_at：2026-10-31
- claim_ttl：
- handoff_to：
- 类型：feature

- 迁移来源：`.ch/docs/exec-plans/completed/2026-10/2026-10-31-codex-config-visual-editor.md`（历史标识，原文件已替换）
- 关联计划：[文档](2026-10-31-docs-codex-config-visual-editor.md)
- 测试计划删除审计：[十月历史证据](../../migrations/test-plan-removals/2026-11-11-oct.json)（按本页迁移来源查项；仅保留历史事实，不承担独立测试开发）。

## 本子计划目标

按官方层级、类型和枚举扩展 Codex 可视化参数。仅承担新功能开发；独立文档与其他类型仍按关联计划分工；test 计划已删除，其历史证据见删除审计，不并回本计划。

## 本子计划实施范围

下列归属条目中的新功能开发；关联计划的交付不是本计划实施范围。

## 本子计划验收

遵守下列原文的行为/范围约束及验收标准；完成状态不等于所有历史风险、失败和待审事项已经消除。

## 依赖与背景

文档仍以关联实现、历史验证与追加决策的真实结果为依据。原 test companion 已于 2026-11-11 删除；测试开发不是本存活计划的现行职责。这里保留同一历史任务的依赖与边界，不声称重新执行。

共享背景和跨类型验收关系见[来源任务的归属记录](2026-10-31-feature-codex-config-visual-editor.md)；原始作者、日期和状态语义沿用头部记录。

## 历史验证与未决事项

本文件保留原任务共用的实际验证、失败/阻塞和未决事项。下面的历史命令与结果仅为当时证据，本次迁移未重新执行历史业务命令；其它子计划引用这里，不重复混合全文。

## 原文归属记录

## 背景

- Codex 配置可视化页面需要按官方 config.toml / app-server 配置契约暴露上下文窗口、自动压缩、features、sandbox_mode、approval_policy 和 web_search。

## 目标

- 在不兼容旧配置版本的前提下，使用官方定义的配置层级、类型和枚举完成 Codex 可视化编辑、读取和保存，并补齐相关验证。

## 范围

- Codex 可视化配置页面及其配置序列化/解析逻辑。

- 上述参数的控件、默认空值处理和选择项。

- 相关单测。

## 非目标

- 不做旧配置版本迁移兼容。

- 不修改其他 CLI 配置页面。

- 不猜测官方未定义的枚举或参数。

## 验收标准

- [x] `model_context_window` 和 `model_auto_compact_token_limit` 按官方层级出现在正确的配置表。

- [x] `features` 以布尔复选框编辑，不写入字符串值。

- [x] `sandbox_mode`、`approval_policy`、`web_search` 使用官方允许值的下拉选择。

- [x] `npm run build` 与相关测试通过。

## 影响面

- 代码目录：`src/webview`、`src/test/config`、相关配置工具。

- 配置与脚本：Codex config.toml 可视化映射。

## 验证计划

- 最小相关验证：Codex 配置可视化单测。

- 单元自测命令：`npm run build`；对应 `node --test` 测试文件。

- 扩展验证：如页面行为变化明显，运行 Chromium smoke test。

## 测试与清单同步

- 单元自测结果：`npm run build` 通过；`node --test dist/test/config/*.test.js` 通过（303/303）。

- 失败处理记录：

## 任务列表

- [x] 核对官方配置层级和值域

- [x] 修改可视化配置及保存逻辑

## 决策记录

- 2026-10-31：暂不兼容旧配置版本；只实现当前官方配置形态。

- 2026-10-31：`model_context_window` 与 `model_auto_compact_token_limit` 是根级整数；`features` 只把官方布尔开关映射为复选框；`approval_policy` 下拉不提供已废弃的 `untrusted`。

## 当前结论

已完成 Codex 可视化配置修改。真实 `codex-cli 0.164.0` 的 `app-server --strict-config --print-startup-config` 接受新配置示例，并拒绝 `untrusted`、布尔 `web_search` 和浮点 token 限额；Chromium smoke 未执行，因为配置页是 VS Code Webview，没有独立前端服务入口，已由静态渲染/组件 harness 覆盖。

## 追加验收

- 公共配置区将默认 Provider 放在默认模型之后。

- `[features]` 移到 Provider 工作区下方，使用四列单元格表格。

- 每个 feature 单元格按复选框、标签、SVG 问号排列，悬停和键盘聚焦立即显示中文说明。
