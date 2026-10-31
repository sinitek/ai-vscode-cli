---
memory_type: event_memory
scope: project
status: active
last_verified_at: 2026-10-24
source_of_truth: .ch/docs/memory/EVENT_MEMORY.md
derived_from: []
supersedes: []
related_paths: []
---

# 事件记忆

这个文件是记忆金字塔的 **L2**：从滚动摘要、执行计划和 runbook 中抽取重要事件。

事件记忆只保留以后会影响判断的节点，例如失败原因、成功方案、关键迁移、事故复盘、用户明确改变方向的决定。

## 什么时候更新

- 某次失败已经找到明确原因，未来可能复发
- 某次成功方案被验证有效，未来可能复用
- 某次迁移、回滚、事故、重大决策会影响后续判断
- 滚动摘要里出现了应长期记住的事件节点

## 不该写什么

- 普通任务流水账
- 没有明确结果或原因的临时观察
- 已经完全转化为 runbook、skill 或设计文档且不再需要事件索引的重复内容
- 与 `ROLLING_SUMMARY.md` 相同的任务回复、prompt 或阶段流水账

## 维护规则

- 每条事件必须能指回原始来源。
- 事件应写清“发生了什么、结果或原因是什么、可复用结论是什么”。
- 如果事件形成稳定规则，应继续上提到 L3 项目/用户画像或 L4 程序性经验。

## 当前事件

starter 默认不预置事件。接入真实项目后，从第一条真正影响后续判断的事件开始维护下表。

| 日期 | 类型 | 事件 | 结果/原因 | 可复用结论 | 来源 |
| --- | --- | --- | --- | --- | --- |
| 2026-10-24 | 失败原因 / 成功方案 | Grok 分类器用 `trim()` 丢弃纯空白 `agent_message_chunk` 和 `agent_thought_chunk` | 分块边界把 `Hello` + 空格 + `world` 收成 `Helloworld`，换行和缩进同样丢失。撤销该判断后，非空文本原样保留 | 空字符串才可忽略。宿主期望不能反过来定义丢空白。展示层负责隐藏纯空白气泡 | `.ch/docs/runbooks/PITFALLS.md` 的“Grok 分类器不能按 trim 丢弃纯空白分块”；`src/interactive/grokAppServerProtocol.ts`；`src/test/interactive/grokAppServerProtocol.test.ts` |
| 2026-10-27 | 失败原因 / 成功方案 | Kimi 默认配置精简掉 `capabilities` / `support_efforts` 后，界面仍请求 `high`，ACP 报 `available: (none)` | 保存链路只补缺失的 `thinking` 能力与五档列表，默认配置和范例同步带声明；隔离官方 ACP 实测 `high` 与完整六值广告 | UI 可选值依赖配置声明时，精简范例不能删除隐式前置条件；补齐应放在统一提交契约并保留显式限制 | `.ch/docs/exec-plans/completed/2026-10/2026-10-27-kimi-config-simplification.md`；`.ch/docs/runbooks/kimi-code-config.md` |
| 2026-10-27 | 失败原因 / 成功方案 | Kimi 新增配置模型后，长驻 ACP runner 仍缓存旧模型广告，下一轮可能报 `model ... is not advertised` | 配置写入按 `KIMI_CODE_HOME` 推进修订号；旧 runner 不再复用，新 runner 恢复原 ACP 会话后取得新广告。官方 2.3.2 隔离验证新增别名生效且 session ID 不变 | ACP 的配置广告是进程启动快照；会话内动态切换不能替代配置变更后的进程失效与恢复 | `.ch/docs/exec-plans/completed/2026-10/2026-10-27-kimi-replay-model-polish.md`；`.ch/docs/runbooks/kimi-code-config.md` |
