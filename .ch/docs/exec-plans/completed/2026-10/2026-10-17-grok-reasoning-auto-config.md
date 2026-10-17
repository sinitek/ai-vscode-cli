# Grok 执行前自动补齐思考力度声明

- 日期：2026-10-17
- 状态：completed
- 负责人：Codex

## 背景与目标

上一轮只修复 ACP 标量参数并提示用户手工配置，未解决当前自定义模型缺少 reasoning_efforts 后仍无法使用思考档位的问题。按用户明确要求，每次创建 Grok 进程前检查实际模型配置，缺失时自动补齐后再启动。

## 范围与非目标

- 复用现有 TOML 解析、模型选择、路径解析和原子写入；只修改当前自定义模型缺失的 reasoning_efforts。
- 保留已配置列表、空列表和 supports_reasoning_effort=false，不覆盖密钥、接口、默认模型或其它字段。
- 并发启动时串行合并，避免同一配置丢失补齐结果；未选择有效思考档位时不写配置。
- 不修改内置模型目录、前端界面、依赖版本，不发送真实模型提示词。

## 验收标准

- 显式所选模型优先于默认模型；支持配置键和 model 字段匹配。
- 缺失声明的自定义模型自动补齐官方列表表结构，随后 ACP 下发所选字符串档位。
- 已有声明、显式禁用、无配置、内置模型保持不变；非法配置或写入失败不破坏原文件且不静默执行。
- 并发、重复启动幂等；构建、相关回归和真实 Grok 握手通过。

## 影响面、风险与缓解

- 代码：src/config、src/interactive/grokRunner.ts、src/i18n.ts 和测试。
- 文档：运行时参考、功能清单、ontology、PITFALLS。
- 风险：上游未必接受全部档位；仅对用户要求启用且缺少声明的自定义模型补齐插件已有标准档位，不覆盖显式限制，ACP 仍按实际广告列表设置。
- 风险：配置包含隐私；不记录内容，原子写入并保留文件权限，真实验证前在用户配置目录备份。

## 验证计划

- npm run build。
- 新增配置合并与持久化单测；runner 回归断言 spawn 前补齐并实际下发。
- 最小相关 Grok 协议、配置、宿主和 i18n 单测。
- 临时 GROK_HOME 启动真实 Grok 1.0.62，验证缺失声明自动补齐与 currentValue 回读；真实个人配置仅补齐缺失字段，不发送 prompt。
- ontology 校验与已知 15 条历史断链基线比较；变更文件空白与 git diff --check。

## 任务列表

- [completed] 检查配置读取和启动链路。
- [completed] 实现缺失声明自动补齐。
- [completed] 补充回归并验证真实调用。

## 决策记录

- 2026-10-17：用户明确授权在执行时补齐缺失配置，取代上一轮仅提示手工配置的边界。保留 ACP 字符串参数，不绕过已有档位限制。

## 当前结论

已完成启动前预检、保留式合并、并发串行原子写入、权限/符号链接保留及预检期间 dispose 防止启动的回归。第一次构建的测试帮助函数触发 TS 类型收窄导致 never 分支错误，已修复帮助函数并复验。

真实验证使用编译后的 GrokInteractiveRunner，未绕过预检：临时 GROK_HOME 只有模型配置但无 reasoning_efforts，启动后自动补齐七档，真实 Grok 1.0.62 回读 currentValue=high；用户现有配置也通过同一路径自动补齐，回读 currentValue=xhigh。写入前在用户配置目录创建私有备份；对比解析后的配置，除目标 reasoning_efforts 外字段完全一致，常规 TOML 原文为新内容前缀。未输出密钥、未发送 session/prompt。

## 最终验证与同步

- `npm run build`：通过。
- `node --test dist/test/config/grokReasoningConfig.test.js dist/test/config/grokConfigMapping.test.js dist/test/interactive/grokRunner.test.js dist/test/interactive/grokAppServerProtocol.test.js dist/test/core/i18n.test.js dist/test/extensionHost/grokCliHostWire.test.js`：51 项全部通过。
- `node --test $(rg --files dist/test | rg '/grok[^/]*\.test\.js$')`：89 项中 88 通过、1 失败。与上一轮相同的范围外旧断言：grokCliEnum 要求整页 Grok option 只有 1 个，实际是 2 个；测试、Webview 和 CLI 输入与 HEAD 无差异，不扩大修复范围。
- ontology 全量校验仍有 15 条既有缺失 source_refs；在临时目录恢复 HEAD ontology 后逐条对比，与当前完全一致，没有新增问题。
- 变更文件空白检查、`git diff --check`：通过。
- 用户现有配置重复预检 changed=false，证明幂等；实际配置仅目标模型 reasoning_efforts 改变，其它字段完全一致。
- 已同步运行时事实来源、功能清单、ontology 与 PITFALLS。无前端修改，不需要浏览器验证；可复用经验进入对应 runbook，不额外写自动记忆热区。
- 验证边界：真实验证覆盖配置修复、CLI 启动和 ACP 档位接受/回读，没有发送真实模型推理请求。
