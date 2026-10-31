# Codex 配置可视化参数

- 日期：2026-10-31
- 状态：completed
- 负责人：Codex
- owner：
- claimed_at：2026-10-31
- claim_ttl：
- handoff_to：

## 背景

Codex 配置可视化页面需要按官方 config.toml / app-server 配置契约暴露上下文窗口、自动压缩、features、sandbox_mode、approval_policy 和 web_search。

## 目标

在不兼容旧配置版本的前提下，使用官方定义的配置层级、类型和枚举完成 Codex 可视化编辑、读取和保存，并补齐相关验证。

## 范围

- Codex 可视化配置页面及其配置序列化/解析逻辑。
- 上述参数的控件、默认空值处理和选择项。
- 相关单测、功能清单或设计文档同步。

## 非目标

- 不做旧配置版本迁移兼容。
- 不修改其他 CLI 配置页面。
- 不猜测官方未定义的枚举或参数。

## 验收标准

- [x] `model_context_window` 和 `model_auto_compact_token_limit` 按官方层级出现在正确的配置表。
- [x] `features` 以布尔复选框编辑，不写入字符串值。
- [x] `sandbox_mode`、`approval_policy`、`web_search` 使用官方允许值的下拉选择。
- [x] 读取、保存和非法值行为有测试覆盖。
- [x] `npm run build` 与相关测试通过。

## 影响面

- 代码目录：`src/webview`、`src/test/config`、相关配置工具。
- 文档目录：`.ch/docs/product-specs`、`.ch/docs/exec-plans`。
- 配置与脚本：Codex config.toml 可视化映射。

## 风险与缓解

- 风险：官方文档中的公共配置与模型配置层级混淆。
- 缓解：以官方配置参考原文和当前解析/序列化实现为双重事实来源，补结构断言测试。

## 验证计划

- 最小相关验证：Codex 配置可视化单测。
- 单元自测命令：`npm run build`；对应 `node --test` 测试文件。
- 扩展验证：如页面行为变化明显，运行 Chromium smoke test。

## 测试与清单同步

- 单元测试新增/更新：`src/test/config/codexConfigVisualEditor.test.ts` 覆盖根级参数、features 复选框、枚举和非法类型。
- 单元自测结果：`npm run build` 通过；`node --test dist/test/config/*.test.js` 通过（303/303）。
- 失败处理记录：
- 功能清单：已更新 `.ch/docs/product-specs/FEATURE_INVENTORY.md`。
- 相关文档同步：已更新 `.ch/docs/ontology/domains/cli-plugin-runtime.json` 并通过 ontology validate。

## 任务列表

- [x] 核对官方配置层级和值域
- [x] 修改可视化配置及保存逻辑
- [x] 补测试并运行构建
- [x] 同步功能清单并归档计划

## 决策记录

- 2026-10-31：暂不兼容旧配置版本；只实现当前官方配置形态。
- 2026-10-31：`model_context_window` 与 `model_auto_compact_token_limit` 是根级整数；`features` 只把官方布尔开关映射为复选框；`approval_policy` 下拉不提供已废弃的 `untrusted`。

## 当前结论

已完成 Codex 可视化配置修改。真实 `codex-cli 0.164.0` 的 `app-server --strict-config --print-startup-config` 接受新配置示例，并拒绝 `untrusted`、布尔 `web_search` 和浮点 token 限额；Chromium smoke 未执行，因为配置页是 VS Code Webview，没有独立前端服务入口，已由静态渲染/组件 harness 覆盖。

## 追加验收

- 公共配置区将默认 Provider 放在默认模型之后。
- `[features]` 移到 Provider 工作区下方，使用四列单元格表格。
- 每个 feature 单元格按复选框、标签、SVG 问号排列，悬停和键盘聚焦立即显示中文说明。
