# Runbooks 目录说明

这里用于沉淀运行、发布、排障、值班和环境操作手册。

当前仓库还是骨架阶段，因此这里只定义用途，不预设具体系统内容。

## 当前重点文件

- `.ch/docs/runbooks/PITFALLS.md`：真实踩坑条目、维护规则和条目模板。
- `.ch/docs/runbooks/PITFALLS_HISTORY.md`：历史归档入口；只有真实历史条目达到拆分阈值后再展开专题文件。
- `.ch/docs/runbooks/grok-model-config.md`：Grok 多模型配置、语义回放、任务列表与上下文用量口径。
- `.ch/docs/runbooks/kimi-code-config.md`：Kimi Code 安装自检、隔离验证、配置模板、失败现象处置与不能做的事。
- Codex Windows thread handoff 的隔离验证边界及清理故障证据见 [参考记录](../references/codex-thread-handoff-windows-validation.md)；当前用户可见契约以 [CLI runtime reference](../references/cli-runtime-reference.md) 为准，活动计划仍未完成。
- Node、ACP 压缩探针和交付历史见 [references 索引](../references/index.md)，属于有日期的历史证据，不是通用操作授权或当前版本保证。

## 未来建议收录

- 本地开发环境启动手册
- 测试环境初始化手册
- 发布与回滚手册
- 常见故障排查手册
- 数据修复与审计操作手册

## 维护规则

- runbook 要面向“接手的人或代理立刻能执行”来写。
- 一旦发现真实踩坑，默认先补充到 `PITFALLS.md`，不要为空内容预建多层分片。
- 不要把关键操作只留在聊天或平台 wiki。
- 如果一条风险还没形成稳定规避动作，先停留在 `.ch/docs/memory/ACTIVE_RISKS.md`；形成长期规避法后再上提到 runbook。
