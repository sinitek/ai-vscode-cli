# DSH 思考力度选项 — 新功能开发

- 日期：2026-10-25
- 状态：completed
- 类型：feature
- plan_id：2026-10-25-feature-dsh-thinking-effort
- source_plan_id：2026-10-25-dsh-thinking-effort
- created_at：2026-10-25

- 迁移来源：`.ch/docs/exec-plans/completed/2026-10/2026-10-25-dsh-thinking-effort.md`（历史标识，原文件已替换）
- 关联计划：[文档](2026-10-25-docs-dsh-thinking-effort.md)
- 测试计划删除审计：[十月历史证据](../../migrations/test-plan-removals/2026-11-11-oct.json)（按本页迁移来源查项；仅保留历史事实，不承担独立测试开发）。

## 本子计划目标

补齐 DSH 默认验证模型能力声明与四档思考选择下发。仅承担新功能开发；独立文档与其他类型仍按关联计划分工；test 计划已删除，其历史证据见删除审计，不并回本计划。

## 本子计划实施范围

下列归属条目中的新功能开发；关联计划的交付不是本计划实施范围。

## 本子计划验收

遵守下列原文的行为/范围约束及验收标准；完成状态不等于所有历史风险、失败和待审事项已经消除。

## 依赖与背景

文档仍以关联实现、历史验证与追加决策的真实结果为依据。原 test companion 已于 2026-11-11 删除；测试开发不是本存活计划的现行职责。这里保留同一历史任务的依赖与边界，不声称重新执行。

共享背景和跨类型验收关系见[来源任务的归属记录](2026-10-25-feature-dsh-thinking-effort.md)；原始作者、日期和状态语义沿用头部记录。

## 历史验证与未决事项

本文件保留原任务共用的实际验证、失败/阻塞和未决事项。下面的历史命令与结果仅为当时证据，本次迁移未重新执行历史业务命令；其它子计划引用这里，不重复混合全文。

## 原文归属记录

## 目标

- 让 AI 对话面板在 DSH 分组显示并下发 DeepSeek 当前适配器支持的思考力度，避免复用 Grok 的扩展档位。

## 背景与范围

- DSH 面板已经消费 ACP 返回的 `reasoningOptions`，但当前运行 patch 没有为手写模型声明 `reasoningEfforts`。

- 已安装 `@deepseek-ai/dsh@0.2.1-rc.2` 的 DeepSeek 适配器支持 `off`、`low`、`high`、`max`；不支持 `medium`、`xhigh`、`ultra`。

- 本次只修改 DSH 配置契约、运行 patch、不改变 Grok、通用 ThinkingMode 类型或外部服务。

## 验收标准

1. 默认验证模型的 DSH 运行 patch 声明 `off: null`、`low: low`、`high: high`、`max: max`。

2. 面板依据当前模型的 DSH ACP 广告值直接显示原始 value，选择后经 `session/set_config_option` 发送标量并等待 ACP 确认。

3. 其它自定义模型仅在显式声明能力时显示选项；`reasoningEfforts: false` 只显示关闭档。

4. 仅显示 DeepSeek 规范档位；`minimal`→`low`、`medium` / `xhigh`→`high`、`ultra`→`max` 的兼容别名不作为额外选项，旧 DSH `medium` 归一为 `high`，存量 `ultra` 不隐式改写。

5. 旧 DSH profile 缺少能力字段时仍能读取；默认验证模型在规范化保存和运行 patch 时补齐能力声明。

## 风险与验证

- 运行时 DSH 版本或 provider schema 漂移可能改变档位；以仓库记录的已安装版本和当前官方适配器源码为事实来源。

- 先运行 DSH 配置、ACP runner、Extension Host 相关测试，再运行 `npm run build`。

- 若本机真实 DSH 端点可用，补充一次真实 ACP 启动并确认 `reasoningOptions` 为四项。

## 验证记录

- DSH 相关配置、模型选择、Extension Host、ACP runner 与 Webview 测试：`node --test dist/test/cli/dshConfigModels.test.js dist/test/config/dshConfig.test.js dist/test/config/dshconfigpage.test.js dist/test/extensionHost/dshModelSelection.test.js dist/test/extensionHost/dshInteractiveHostWire.test.js dist/test/extensionHost/dshPluginLiveBoundary.test.js dist/test/interactive/dshAppServerProtocol.test.js dist/test/interactive/dshRunner.test.js dist/test/webview/openCodeThinkingWebview.test.js`，68 项通过、1 项跳过、0 项失败。

- `python3 .agents/skills/ontology/scripts/search_ontology.py --validate`：通过（2 domains、17 concepts、16 relations、62 rules、2 workflows、3 documents）。

- 未执行真实账号/端点上的新一轮 ACP 验证或 VS Code 图形面板点击；现有运行契约与此前隔离实跑记录继续作为依据。

## 当前阶段

- 实现、测试、计划可归档。
