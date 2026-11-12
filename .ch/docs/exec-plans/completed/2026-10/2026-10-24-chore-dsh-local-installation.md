# DeepSeek Harness 接入 — 维护/构建/发布治理

- 日期：2026-10-24
- 状态：completed
- 负责人：协作
- owner：round-13-dsh-documentation-closeout-sync
- claimed_at：2026-10-24T11:44:20Z
- claim_ttl：收尾已完成
- handoff_to：
- 类型：chore

- 迁移来源：`.ch/docs/exec-plans/completed/2026-10/2026-10-24-dsh-integration.md`（历史标识，原文件已替换）
- 关联计划：[新功能开发](2026-10-24-feature-dsh-integration.md); [文档](2026-10-24-docs-dsh-integration.md)
- 测试计划删除审计：[十月历史证据](../../migrations/test-plan-removals/2026-11-11-oct.json)（按本页迁移来源查项；仅保留历史事实，不承担独立测试开发）。

## 本子计划目标

安装并核对本机 DSH 官方通道版本，不把插件接入等同于安装完成。

## 本子计划实施范围

仅承担下列归属条目的维护/构建/发布治理；其它类型交付见关联计划。

## 本子计划验收

遵守下列原文相应契约和验收条件，保留追加决策的优先级；不扩大历史验证结论。

## 依赖与背景

文档仍以关联实现、历史验证与追加决策的真实结果为依据。原 test companion 已于 2026-11-11 删除；测试开发不是本存活计划的现行职责。这里保留同一历史任务的依赖与边界，不声称重新执行。chore 的官方安装版本与 docs 的上游/provider 契约是 feature 接入核对的输入；最终能力文档以实现和实际验证边界为准。

共享背景和跨类型验收关系见[来源任务的归属记录](2026-10-24-feature-dsh-integration.md)；原始作者、日期和状态语义沿用头部记录。

## 历史验证与未决事项

本类型交付的实际验证以[同源原任务验证与边界](2026-10-24-feature-dsh-integration.md#历史验证与未决事项)及下列原文局部记录为准。此引用复用当时构建/定向测试/文档校验等证据，不表示单独重跑或新增通过结论；未覆盖和历史失败同样适用。

## 原文归属记录

## 背景

- 用户要求先在本机安装最新 DeepSeek Harness，再为携宁 CLI 插件增加 dsh 分组，并尽量支持上下文显示、压缩、模型切换、思考力度、skills 安装和规则文件。

## 目标

1. 本机按官方推荐通道安装可执行的 `dsh`。

## 范围

- 本机全局安装 `@deepseek-ai/dsh@latest`。

## 非目标

- 不把 `0.2.1-rc.2` 写成稳定版，不安装 `next`。

## 验收标准

- [x] 本机 `dsh` 指向官方 `@deepseek-ai/dsh@0.2.1-rc.2`，并明确它是发布候选。

## 风险与缓解

- 回滚：卸载本机全局包用 `npm uninstall -g @deepseek-ai/dsh`。不要删除 `~/.dsh`。

## 任务列表

- [x] 核对 npm 身份、`latest` 和 `next`，安装官方推荐通道。

## 决策记录

- 2026-10-24：安装 `latest` `0.2.1-rc.2`，不安装 `next` `0.2.1-rc.3`。
