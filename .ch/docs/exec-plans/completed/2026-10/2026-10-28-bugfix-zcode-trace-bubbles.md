# ZCode 配置与 Codex 工具气泡对齐 — 已发布行为修复

- 日期：2026-10-28
- 状态：completed
- 负责人：Codex
- owner：
- claimed_at：
- claim_ttl：
- handoff_to：
- 类型：bugfix

- 迁移来源：`.ch/docs/exec-plans/completed/2026-10/2026-10-28-zcode-trace-bubbles.md`（历史标识，原文件已替换）
- 关联计划：[新功能开发](2026-10-28-feature-zcode-reasoning-defaults.md); [文档](2026-10-28-docs-zcode-trace-bubbles.md)
- 测试计划删除审计：[十月历史证据](../../migrations/test-plan-removals/2026-11-11-oct.json)（按本页迁移来源查项；仅保留历史事实，不承担独立测试开发）。

## 本子计划目标

修复 ZCode model.streaming 与 tool.updated 事件到既有 trace 的映射。仅承担已发布行为修复；独立文档与其他类型仍按关联计划分工；test 计划已删除，其历史证据见删除审计，不并回本计划。

## 本子计划实施范围

下列归属条目中的已发布行为修复；关联计划的交付不是本计划实施范围。

## 本子计划验收

遵守下列原文的行为/范围约束及验收标准；完成状态不等于所有历史风险、失败和待审事项已经消除。

## 依赖与背景

文档仍以关联实现、历史验证与追加决策的真实结果为依据。原 test companion 已于 2026-11-11 删除；测试开发不是本存活计划的现行职责。这里保留同一历史任务的依赖与边界，不声称重新执行。feature reasoning 默认与 bugfix trace 映射是同一 ZCode 接入的两个独立交付；真实 runner 验证同时提供证据，不将缺省配置修正冒充事件映射。

共享背景和跨类型验收关系见[来源任务的归属记录](2026-10-28-bugfix-zcode-trace-bubbles.md)；原始作者、日期和状态语义沿用头部记录。

## 历史验证与未决事项

本文件保留原任务共用的实际验证、失败/阻塞和未决事项。下面的历史命令与结果仅为当时证据，本次迁移未重新执行历史业务命令；其它子计划引用这里，不重复混合全文。

## 原文归属记录

## 目标

- 保持 ZCode 独立 app-server 协议与当前配置结构，并把真实工具事件映射至既有 Codex trace 展示链路；使用默认本机配置验证冒泡排序文件写入和天气查询。

## 范围

- ZCode `model.streaming` 和 `tool.updated` 解析、工具输入聚合、同一 `toolCallId` 气泡更新。

- ZCode trace 复用现有 `TraceMessageKind` 和 Codex-compatible 文本/元数据，不新增平行 UI 样式。

- 协议、runner、配置与渲染相关回归测试。

## 非目标

- 不改 Codex trace 渲染组件的公共样式或其它 CLI 的协议行为。

- 不改变 ZCode 协议为 ACP / JSON-RPC，不改变免审批启动参数 `--mode yolo`。

## 验收标准

- [x] 真实 ZCode 正文、推理、工具输入、生命周期、结果按既有 trace renderer 形成语义标题气泡；同一调用只更新一个气泡.

- [x] 保持旧 `part.delta` 兼容，不泄漏凭据，不重复应答 app-server server request.

- [x] 相关构建、配置/协议/runner/页面测试通过；全量/页面测试既有失败单独分类.

- [x] 默认本机配置完成临时目录冒泡排序文件写入与天气工具查询，验证结果后清理临时产物.

## 影响面

- 代码目录：`src/config/`、`src/interactive/`、`src/extensionHost/`、`media/config/assets/`、相关 `src/test/`。

## 风险与缓解

- 风险：工具输入可能以分片形式重复上报或生命周期事件缺少某些字段。

- 缓解：按 `toolCallId` 聚合、对事件做幂等处理、未知结构保守显示，不凭命令文本合并不同调用。

- 风险：运行中历史 Codex trace 可能被跨平台归一化影响。

- 缓解：ZCode 仅生成既有 trace 语法和稳定消息 ID，不改统一渲染组件语义。

## 验证计划

- 最小相关验证：ZCode 配置、协议、runner 与 trace renderer 定向测试。

- 扩展验证：Impeccable detector；使用本机 `zcode` 默认配置真实执行冒泡排序文件和天气查询。

## 测试与清单同步

- 单元自测结果：build 通过；ZCode 配置/协议/trace/标题定向 13 项通过；页面测试 292/297 通过。

- 失败处理记录：页面剩余 5 项中，historySessionLoop 两项为历史标签 fixture 的 `formatCliDisplayName` 基线；cliPageStaticRenderCoverage 两项仍断言旧 Grok 静态 option 与 `Sinitek CLI` 文案；clipagescriptruntimecoverage 一项是 Codex tab `errored` 为 `undefined` 的既有基线。均与 ZCode 无关，未扩大修复。

- 涵盖 `model.streaming` / `tool.updated` 和单气泡更新。

## 任务列表

- [x] 分析真实协议与 Codex trace 展示路径。

- [x] 解析并映射真实 ZCode trace 事件.

- [x] 运行构建、测试、页面检测与本机任务.

## 决策记录

- 2026-10-28：继续复用 Codex trace 分类与 Webview 展示器；ZCode 只负责将 Protocol 1 事件规范化并通过既有宿主 trace API 发送。

- 2026-10-28：真实工具结果以 `tool result: <tool>` 开头，需在通用 `tool:` 前识别，避免结果误作调用气泡。
