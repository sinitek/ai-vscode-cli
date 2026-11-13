# ZCode 配置与 Codex 工具气泡对齐 — 新功能开发

- 日期：2026-10-28
- 状态：completed
- 负责人：Codex
- owner：
- claimed_at：
- claim_ttl：
- handoff_to：
- 类型：feature

- 迁移来源：`.ch/docs/exec-plans/completed/2026-10/2026-10-28-zcode-trace-bubbles.md`（历史标识，原文件已替换）
- 关联计划：[已发布行为修复](2026-10-28-bugfix-zcode-trace-bubbles.md); 原 docs companion `2026-10-28-docs-zcode-trace-bubbles.md` 已退役；仅留历史身份与分工，完整校验记录未恢复。[references 索引](../../../references/index.md)仅作导航。
- 测试计划删除审计：[十月历史证据](../../migrations/test-plan-removals/2026-11-11-oct.json)（按本页迁移来源查项；仅保留历史事实，不承担独立测试开发）。

## 本子计划目标

完善 ZCode 模型 reasoning、会话 thoughtLevel 默认和范例配置。

## 本子计划实施范围

仅承担下列归属条目的新功能开发；其它类型交付见关联计划。

## 本子计划验收

遵守下列原文相应契约和验收条件，保留追加决策的优先级；不扩大历史验证结论。

## 依赖与背景

文档仍以关联实现、历史验证与追加决策的真实结果为依据。原 test companion 已于 2026-11-11 删除；测试开发不是本存活计划的现行职责。这里保留同一历史任务的依赖与边界，不声称重新执行。feature reasoning 默认与 bugfix trace 映射是同一 ZCode 接入的两个独立交付；真实 runner 验证同时提供证据，不将缺省配置修正冒充事件映射。

共享背景和跨类型验收关系见[来源任务的归属记录](2026-10-28-bugfix-zcode-trace-bubbles.md)；原始作者、日期和状态语义沿用头部记录。

## 历史验证与未决事项

本类型交付的实际验证以[同源原任务验证与边界](2026-10-28-bugfix-zcode-trace-bubbles.md#历史验证与未决事项)及下列原文局部记录为准。此引用复用当时构建/定向测试/文档校验等证据，不表示单独重跑或新增通过结论；未覆盖和历史失败同样适用。

## 原文归属记录

## 背景

ZCode 0.17.0 已按独立 ZCode Protocol 接入。真实本机协议记录表明正文、推理和工具输入通过 `model.streaming` 发送，工具生命周期通过 `tool.updated` 发送；当前 runner 仍主要识别旧 `part.delta` 和简化状态文本，导致工具调用不能形成 Codex 风格的标题、分类、输入和结果气泡。配置页还需统一范例导入和编辑器模式入口；模型执行要求的推理档位必须稳定下发。

## 目标

- 完善 reasoning 默认与范例配置。

## 范围

- ZCode 配置可视化/JSON 页面，复用现有 CLI 共享布局、按钮和范例导入行为。

- 模型级 reasoning 配置和会话级 `thoughtLevel` 默认补齐；范例模型使用 `glm-5.3-flash`。

## 非目标

- 不把真实 API key 写入仓库、报告、测试夹具或 UI 默认范例。

## 验收标准

- [x] ZCode 页面布局、范例导入、编辑模式入口与已存在 CLI 页面一致，且上方为公共参数、下方左侧模型列表右侧模型参数.

- [x] 模型 `glm-5.3-flash_sub-coco` 在默认及缺少历史设置时向 ZCode 下发有效 reasoning level；范例默认模型为 `glm-5.3-flash`.

## 影响面

- 配置与脚本：不写入用户运行时配置；范例使用占位密钥。

## 任务列表

- [x] 修复 ZCode 配置页面和 reasoning 默认.

## 决策记录

- 2026-10-28：本机日志确认 `glm-5.3-flash_sub-coco` 的首次失败原因为必填 reasoning level 缺失；旧配置默认补 `max`，模型规则首选值通过 `model.options.reasoningLevel` 传入。
