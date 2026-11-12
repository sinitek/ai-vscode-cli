# Grok 思考力度配置与 ACP 验证 — 已发布行为修复

- 日期：2026-10-17
- 状态：completed
- 负责人：Codex
- 类型：bugfix

- 迁移来源：`.ch/docs/exec-plans/completed/2026-10/2026-10-17-grok-reasoning-effort.md`（历史标识，原文件已替换）
- 关联计划：[文档](2026-10-17-docs-grok-reasoning-effort.md)
- 测试计划删除审计：[十月历史证据](../../migrations/test-plan-removals/2026-11-11-oct.json)（按本页迁移来源查项；仅保留历史事实，不承担独立测试开发）。

## 本子计划目标

修复 ACP 思考力度标量参数与能力缺失静默跳过。仅承担已发布行为修复；独立文档与其他类型仍按关联计划分工；test 计划已删除，其历史证据见删除审计，不并回本计划。

## 本子计划实施范围

下列归属条目中的已发布行为修复；关联计划的交付不是本计划实施范围。

## 本子计划验收

遵守下列原文的行为/范围约束及验收标准；完成状态不等于所有历史风险、失败和待审事项已经消除。

## 依赖与背景

文档仍以关联实现、历史验证与追加决策的真实结果为依据。原 test companion 已于 2026-11-11 删除；测试开发不是本存活计划的现行职责。这里保留同一历史任务的依赖与边界，不声称重新执行。

共享背景和跨类型验收关系见[来源任务的归属记录](2026-10-17-bugfix-grok-reasoning-effort.md)；原始作者、日期和状态语义沿用头部记录。

## 历史验证与未决事项

本文件保留原任务共用的实际验证、失败/阻塞和未决事项。下面的历史命令与结果仅为当时证据，本次迁移未重新执行历史业务命令；其它子计划引用这里，不重复混合全文。

## 原文归属记录

## 背景与目标

用户反馈 Grok 分组思考力度无效。最初按 Grok 自带 `15-agent-mode.md` 看到嵌套 value 示例；进一步真实调用证明该示例与 Grok 1.0.62 实现不一致，嵌套参数返回 -32602 / SessionConfigOptionValue，改为 ACP 官方规范的字符串后成功回读 currentValue=high。此外，本机默认模型的 session/new 只有 model 选项，没有 reasoning_effort，导致插件跳过设置。`26-config-reference.md` 说明自定义模型需由 reasoning_efforts 或接口模型目录声明支持档位，单独配置默认档位不能启用能力。

## 范围与非目标

- 将 ACP 配置参数修正为字符串 value，并说明自定义模型 reasoning_efforts 的正确配置方式。

- 对未广告或不支持的思考档位给出可见提示，保留能力门控。

- 覆盖官方 session/new、session/load 配置选项形状和 initialize 兼容回退。

- 不自动修改用户真实配置、猜测网关支持档位、更换依赖或发送真实模型提示词。

## 验收标准

- 不猜测或自动修改用户模型能力。

- 已广告的档位通过 session/set_config_option 下发，缺失能力或不支持时不静默跳过。

- npm run build、最小相关单测、真实 Grok ACP 握手与配置设置验证通过。

## 影响面与风险

- 运行时：src/interactive/grokRunner.ts、src/i18n.ts、相关测试。

- 协议：src/interactive/grokAppServerProtocol.ts。

- 风险：声明并不等于上游支持；保留显式能力禁用，不修改用户个人配置，不自动降级。

## 验证计划

- npm run build。

- node --test dist/test/config/grokConfigMapping.test.js dist/test/core/i18n.test.js dist/test/extensionHost/grokCliHostWire.test.js dist/test/interactive/grokAppServerProtocol.test.js dist/test/interactive/grokRunner.test.js。

- 使用临时 GROK_HOME 和真实 grok agent stdio 验证配置广告与设置响应，不发送 session/prompt。

## 任务列表

- [completed] 定位链路并核对官方协议与本机能力响应。

- [completed] 修正标量参数和不可用提示。

## 决策记录

- value 使用字符串。放弃扩展配置 UI 或自动生成能力列表，避免对不确定的上游能力作猜测。

## 测试与清单同步

- npm run build 通过；上述五组相关测试共 41 项通过，含 session/load 标量参数断言；变更文件空白校验和 git diff --check 通过。

- 新增规则没有引入额外问题；不修复范围外缺失文档。

- 真实 CLI：Grok 1.0.62；临时 GROK_HOME 测试模型声明 low/high/max；嵌套参数重现 -32602；使用编译后的 buildGrokReasoningConfigParams 构建标量参数后成功返回 currentValue=high。

- 未向真实模型发送 session/prompt，未修改用户 config.toml；无前端修改，不需要浏览器验证。

- 不更新自动任务热区记忆；稳定事实写入运行时参考。

## 当前结论

- 参数修正和能力缺失提示已完成，构建、41 项最小相关测试、真实 CLI 设置回读及变更文件空白检查均通过。扩展检查中的旧断言与既有 ontology 断链已分类记录。用户现有自定义模型仍需按上游实际支持档位补充 reasoning_efforts；本任务未自动修改其个人配置或验证真实模型推理输出。
