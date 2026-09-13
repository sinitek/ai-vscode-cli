# 修复 Kimi Codex 最终气泡与用户输入

- 日期：2026-09-13
- 状态：completed
- 负责人：Codex
- owner：Codex
- claimed_at：2026-09-13
- claim_ttl：same-day

## 背景与目标

近期 `kimi-k3` 通过 Codex 执行任务时出现两类异常：

1. assistant 已产生可展示的最终回复，但最终气泡判定没有稳定识别；
2. 用户输入弹窗显示已提交答案，Codex app-server 收到的 `answers` 却为空或不符合协议，模型因此误以为没有收到回答。

目标是修复两条链路的根因，保持既有 `[final_answer]` 协议和用户消息展示行为，并用回归测试锁定协议字段、消息类型和状态边界。

## 范围与非目标

- 范围：Codex app-server 用户输入响应序列化、Webview 到扩展宿主的交互负载、Codex assistant 事件到最终气泡的归一化与收口判定。
- 非目标：不修改 Codex 上游模型行为，不重构无关 CLI runner，不调整已有 Loop 机器协议。

## 验收标准

- 每个 Codex `requestUserInput` 问题的值按 app-server 契约编码为 `{ answers: string[] }`，多个问题全部保留。
- 用户提交消息展示的值与发送给 Codex 的值来自同一份规范化 submission；空提交不会伪装成已收到有效回答。
- Codex assistant 消息满足显式 `final_answer` 类型，或非 `thinking` 正文包含 `[final_answer]` 时，最终气泡样式和任务收口一致。
- `phase: null`、增量/完成事件拆分及普通 commentary 不会互相误判。
- 相关单测、`npm run build` 和必要的文档/本体校验通过。

## 影响面与风险

- 影响 `humanInteraction.ts`、Codex runner/app-server 适配、交互运行时及 Webview 消息归一化。
- Codex 版本间用户输入 schema 可能存在差异；以本机生成的当前 app-server 类型和现有运行日志共同校验，未知形状不得静默丢值。
- 严格最终答复策略若过宽会把过程消息收口，过窄会触发无意义重试；保持显式协议优先并只在有明确正文标记时兜底。

## 验证计划

- 先运行相关 `humanInteraction`、Codex runner/protocol、interactive runtime、Webview final-answer 测试。
- 执行 `npm run build`，再按 `.ch/docs/TESTING.md` 运行必要单元测试。
- 执行 `npm run validate:whitespace` 和 ontology 校验（如仓库脚本可用）。
- 以 Kimi 原始 rollout 的关键事件做静态链路核对，不把生产私有数据写入仓库。

## 单元测试变化

- 增加多问题 Codex 用户输入答案的协议编码回归测试。
- 增加空值、数组值和内部字段映射边界测试。
- 增加 `phase: null` 与正文 `[final_answer]` 的最终气泡/任务收口回归测试。

## 功能清单与文档

- 已有最终答复协议和运行时事实文档需核对；若现有条目已覆盖，则在此记录无需重复扩写的理由。
- 本次异常的可复发前置条件和协议 schema 变化写入执行计划或 `PITFALLS.md`，不写入生产数据。

## 当前进展与下一步

- 已完成近期 Kimi rollout 和本机 Codex 生成类型的核对。
- 已修复答案从 Webview submission 到 JSON-RPC response 的丢失点，以及 final message 的事件归一化缺口。
- 已完成文档同步、相关回归测试、核心测试和页面测试。

## 决策记录

- 2026-09-13：最终气泡协议采用“显式 `final_answer` 类型或非 thinking 正文包含 `[final_answer]`”二选一；`turn.completed` 单独不构成最终气泡。
- 2026-09-13：Codex `requestUserInput` 响应按生成的 app-server 类型映射为每题 `{ answers: string[] }`，而不是扁平字符串对象。

## 验证结论

- `npm run build`：通过；`npm run test:core`：21/21 通过。
- `npm run test:page`：183/183 通过；页面覆盖测试中的模拟渲染错误日志属于既有故障注入，测试断言全部通过。
- 本次相关 8 个测试文件：90/90 通过。
- `npm run validate:whitespace`：通过；ontology 校验和 ontology Python 单测：9/9 通过。
- 已执行 `git diff --check`，未发现空白错误；未执行真实 VS Code Webview 或生产 Kimi rollout 验证。
