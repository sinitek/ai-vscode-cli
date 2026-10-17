# Grok 思考力度配置与 ACP 验证

- 日期：2026-10-17
- 状态：completed
- 负责人：Codex

## 背景与目标

用户反馈 Grok 分组思考力度无效。最初按 Grok 自带 `15-agent-mode.md` 看到嵌套 value 示例；进一步真实调用证明该示例与 Grok 1.0.62 实现不一致，嵌套参数返回 -32602 / SessionConfigOptionValue，改为 ACP 官方规范的字符串后成功回读 currentValue=high。此外，本机默认模型的 session/new 只有 model 选项，没有 reasoning_effort，导致插件跳过设置。`26-config-reference.md` 说明自定义模型需由 reasoning_efforts 或接口模型目录声明支持档位，单独配置默认档位不能启用能力。

## 范围与非目标

- 将 ACP 配置参数修正为字符串 value，并说明自定义模型 reasoning_efforts 的正确配置方式。
- 对未广告或不支持的思考档位给出可见提示，保留能力门控。
- 覆盖官方 session/new、session/load 配置选项形状和 initialize 兼容回退。
- 不自动修改用户真实配置、猜测网关支持档位、更换依赖或发送真实模型提示词。

## 验收标准

- 文档明确如何声明 reasoning_efforts，不猜测或自动修改用户模型能力。
- 已广告的档位通过 session/set_config_option 下发，缺失能力或不支持时不静默跳过。
- npm run build、最小相关单测、真实 Grok ACP 握手与配置设置验证通过。
- 同步功能清单、运行时事实来源与 ontology。

## 影响面与风险

- 运行时：src/interactive/grokRunner.ts、src/i18n.ts、相关测试。
- 协议：src/interactive/grokAppServerProtocol.ts。
- 文档：运行时参考、功能清单、ontology。
- 风险：声明并不等于上游支持；保留显式能力禁用，不修改用户个人配置，不自动降级。

## 验证计划

- npm run build。
- node --test dist/test/config/grokConfigMapping.test.js dist/test/core/i18n.test.js dist/test/extensionHost/grokCliHostWire.test.js dist/test/interactive/grokAppServerProtocol.test.js dist/test/interactive/grokRunner.test.js。
- 使用临时 GROK_HOME 和真实 grok agent stdio 验证配置广告与设置响应，不发送 session/prompt。
- python3 .agents/skills/ontology/scripts/search_ontology.py --validate；git diff --check。

## 任务列表

- [completed] 定位链路并核对官方协议与本机能力响应。
- [completed] 修正标量参数和不可用提示。
- [completed] 补充回归、验证并同步文档。

## 决策记录

- 2026-10-17：以 ACP 官方规范和真实 CLI 响应纠正 Grok 自带文档过期示例，value 使用字符串。放弃扩展配置 UI 或自动生成能力列表，避免对不确定的上游能力作猜测。

## 测试与清单同步

- npm run build 通过；上述五组相关测试共 41 项通过，含 session/load 标量参数断言；变更文件空白校验和 git diff --check 通过。
- 扩展验证：`node --test $(rg --files dist/test | rg '/grok[^/]*\.test\.js$')` 共 78 项，77 通过、1 失败。范围外旧断言位于 src/test/cli/grokCliEnum.test.ts，要求整页 Grok option 仅 1 个，实际有 2 个。`git diff --exit-code HEAD -- src/test/cli/grokCliEnum.test.ts src/webview src/cli src/config` 通过，证明测试及其 HTML/CLI/配置输入均未变更；不为该断言扩大修改范围。
- ontology 全量校验发现 15 条既有 source_refs 断链。使用 HEAD 中的原 ontology 在临时目录重跑并逐条比较：与当前 15 条完全一致，新增规则没有引入额外问题；不修复范围外缺失文档。
- 真实 CLI：Grok 1.0.62；临时 GROK_HOME 测试模型声明 low/high/max；嵌套参数重现 -32602；使用编译后的 buildGrokReasoningConfigParams 构建标量参数后成功返回 currentValue=high。
- 未向真实模型发送 session/prompt，未修改用户 config.toml；无前端修改，不需要浏览器验证。
- 已同步运行时参考、功能清单、ontology 和 PITFALLS。
- 不更新自动任务热区记忆；稳定事实写入运行时参考。

## 当前结论

参数修正和能力缺失提示已完成，构建、41 项最小相关测试、真实 CLI 设置回读及变更文件空白检查均通过。扩展检查中的旧断言与既有 ontology 断链已分类记录。用户现有自定义模型仍需按上游实际支持档位补充 reasoning_efforts；本任务未自动修改其个人配置或验证真实模型推理输出。
