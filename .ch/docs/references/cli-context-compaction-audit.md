# CLI 上下文压缩能力核查

核查日期：2026-11-10。以下结论是当日 PATH 中 CLI、官方 npm `latest`、已安装包源码与隔离 ACP 探针的历史快照，不应外推为当前版本行为。当前接线事实见各 CLI 参考页及 `src/contextCompactionRunner.ts`。

## 能力边界

分别判断插件手动入口、插件执行后自动压缩和 CLI 自身压力触发的自动压缩；三者不能相互推断。该快照中，OpenCode/DSH/Kimi 没有插件手动入口，DSH/Kimi 未接入插件后台自动策略；Kimi 仍有 ACP `/compact` 命令，不能因缺少独立 RPC 就称 CLI 不支持手动压缩。

## 当日版本与实测

| CLI | 版本快照 | 隔离核查结论 |
| --- | --- | --- |
| DSH | 0.2.2-rc.1 (`latest`，仍为 RC) | `session/compact` 返回 `-32601`，未广告压缩命令；ACP `/compact` 作为普通 prompt 到达 loopback 模型，不是原生压缩。包内压力/overflow 自动压缩存在，未制造压力验证终态。Node 22.23.4 低于包声明的 `>=24.9.0`，虽完成初始化与普通回合，不代表受支持或全面兼容。 |
| Kimi Code | 2.5.2 (`latest`；未装 3.0.0-canary) | `session/compact` 返回 `-32601`；`available_commands_update` 和 `/help` 广告 `/compact`。模拟会话观察到开始及异步完成通知，但模拟摘要不证明真实摘要质量或 token 降幅。 |

探针使用隔离 HOME/CLI home/cwd、临时 provider 配置和 loopback 模型，不读用户凭据或调用真实模型。DSH/Kimi 包源码和当日官方 ACP 文档支持上述判断。Kimi 命令生命周期的后续接线说明见 [Kimi Code 官方参考](kimi-code-official-reference.md)；DSH 历史 provider 约束见 [DSH provider contract](dsh-custom-provider-contract.md)。

## 验证记录与限制

- 当日隔离 ACP 探针通过；`npm run build` 通过；四个指定的 Kimi/DSH/context-compaction 测试合计 70 项通过、0 失败。
- 未测试真实模型、上下文自动溢出、Extension Development Host 点击或 Windows 实跑。此审计没有插件行为变更，不更新产品能力或 ontology。
- 参考日期的全局升级命令、CLI 版本表和逐条协议输出已移除；若再次评估，应先读取当前源码并验证当下安装版本，不要照搬旧 `npm install -g ...@latest` 命令作为现状或授权。
