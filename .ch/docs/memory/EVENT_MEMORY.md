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
| 2026-11-24 | 失败原因 / 关键决策 | Loop+ 决策被拒绝后手动继续成功 | 旧版两次自动纠错中，首答及第一次续答将派发写入 `controls`，最后一次结构合法但目标在主模型调用期间已结束，通用错误掩盖了控制目标变化 | 首次协议失败直接续跑同一任务一次，按当前快照处理，控制拒绝提供目标 ID，二次失败暂停并保留验收 | `.ch/docs/design-docs/loop-plus-scheduling.md#协议失败后的自动续跑` |
| 2026-11-23 | 失败原因 / 成功方案 | Grok Loop+ 旧任务升级后无法续跑 | Grok `session/load` 依赖原 cwd，而 1.9.x attempt 清理会删除空临时根；升级后的根身份校验因此拒绝旧绑定 | 从原生索引唯一核验旧 cwd 后按原 session 恢复；无法安全确认时显式新建会话继续当前子任务，保留旧会话数据，不能静默假装上下文已继承 | `.ch/docs/exec-plans/completed/2026-11/2026-11-23-bugfix-grok-loop-legacy-resume.md`；`.ch/docs/runbooks/PITFALLS.md` |
| 2026-11-21 | 失败原因 / 成功方案 | 产研部组长有原生会话却被当成只读历史 | 首轮后的通用自动压缩和群聊提问用本地 Tab 键查普通会话映射，未走部门原生会话入口 | 同一组长的提问和调度共用队列及原 Owner，普通压缩不进入组长会话 | `.ch/docs/exec-plans/completed/2026-11/2026-11-21-bugfix-department-leader-session-continuation.md` |
| 2026-11-21 | 失败原因 / 成功方案 | 产研部中止未确认 | 冷中止只在首次请求断连时转发，原代次控制冲突和轮询失败跳过原 Owner，默认日志缺少原因 | 扩大原 Owner 中止转发范围，按代次记录固定原因和转发结果，群聊汇总原因 | `.ch/docs/exec-plans/completed/2026-11/2026-11-21-bugfix-department-stop-unconfirmed-feedback.md` |
| 2026-11-21 | 失败原因 / 成功方案 | 产研部冷中止部分失败 | 原代次通信失败时总监停止状态没有保存。未绑定票据或前一个 Owner 的回执缺失可挡住同组其它执行的取消 | 先保存停止派发，再独立取消各组和原 Owner。完整证明只用于确认退出和释放占用 | `.ch/docs/exec-plans/completed/2026-11/2026-11-21-bugfix-department-stop-partial-drain.md` |
| 2026-11-21 | 失败原因 / 成功方案 | 产研部长代次中止断连 | 46 张票据的完整响应超出旧请求帧上限，仍监听的 worker 静默关闭连接 | 请求和快照响应分别限长，中止并行通知可达原代次，原清理按回执确认 | `.ch/docs/exec-plans/completed/2026-11/2026-11-21-bugfix-department-generation-response-size.md` |
| 2026-11-21 | 失败原因 / 关键决策 | 产研部一次中止整组任务 | 旧整组中止等待单组收尾并跳过阻塞组长，且群聊要求额外核验。宿主并行停止组长 Loop+ 和活动员工，完成原执行清理 | 同组中止合并处理，收尾与状态保存留在宿主。已保存且清理完成的停止任务重开后可直接继续 | `.ch/docs/exec-plans/completed/2026-11/2026-11-21-bugfix-department-single-stop.md` |
| 2026-11-21 | 失败原因 / 关键决策 | 产研部组长回执观察失败及派发规则简化 | Tab 关闭后活动会话读取失败可阻断已有回执的读取。改以原持久绑定读取回执。参考额度和未处置业务工作由模型判断 | 以原 Owner 回执确认清理，以普通 Loop+ 终态确认组长结算。通过正常决策 JSON 传递协作 | `.ch/docs/exec-plans/completed/2026-11/2026-11-21-bugfix-department-leader-receipt-observation.md` 和 `.ch/docs/exec-plans/completed/2026-11/2026-11-21-feature-department-advisory-capacity.md` |
| 2026-11-20 | 失败原因 / 成功方案 | 产研部组长完成后被总监汇报为失败 | 组织结算遗漏成功且已确认的免验收汇报 `reported`。只读复核在同一份任务记录上从拒绝转为通过 | 核对最新尝试与任务状态，按正式验收和免验收汇报的证据分别结算，独立核验清理与占用 | `.ch/docs/exec-plans/completed/2026-11/2026-11-20-bugfix-department-report-settlement.md` |
| 2026-11-19 | 失败原因 / 成功方案 | 产研部三名 Codex 员工在会话绑定前失联 | 源码开发宿主与标准构建共用 `dist/`，先清理再编译使新 Worker 无法启动。真实宿主重叠验证中，保留旧产物后首个员工在构建结束前进入原生执行，两轮均通过验收并归还容量 | 按持久绑定阶段区分启动失联和回调失联。清理构建在独立产物副本或宿主退出后执行 | `.ch/docs/exec-plans/completed/2026-11/2026-11-19-bugfix-employee-worker-build-gap.md` |
| 2026-11-13 | 失败原因 / 成功方案 | Loop+ 未完成轮次误用历史完成状态，跨 Tab 继续又替换同会话活跃 runner | 历史摘要未以最近用户轮次为界，宿主只按目标 Tab 判断运行；新增会话门禁、状态恢复校准和迟到回调保护，保留写锁交接 | 完成展示、真实运行与 Tab 关闭分别验证；平台差异需固定实际 CLI 版本和 canonical 临时路径，不回滚释放安全保护 | `.ch/docs/runbooks/PITFALLS.md#loop-假完成必须核对轮次与会话所有权`；`.ch/docs/design-docs/vscode-cli-extension-runtime.md#Tab-运行状态与配置协调` |
| 2026-11-04 | 失败原因 / 成功方案 | macOS 人工交互通知命令成功但用户看不到提示 | 裸脚本缺少有效应用身份、系统拒绝授权、JXA 将空触发器桥接为 `NSNull` 分别阻断展示；改为固定身份的后台应用、现代通知 API、主线程桥接及 `$()` nil 后，用户确认看到“携宁 CLI 提醒” | 通知验收必须分开核对授权、系统投递和用户可见性；授权等待不能占用窗口提醒清理队列 | `.ch/docs/runbooks/PITFALLS.md#macos-通知命令成功不等于实际展示`；文档交付来源：`.ch/docs/exec-plans/completed/2026-11/2026-11-04-docs-human-interaction-desktop-attention.md#验收与结果` |
| 2026-11-02 | 失败原因 / 成功方案 | Loop+ DSH 验收修复复用同一会话仍失败 | HOME 已正确找回，但每轮随机 cwd 被 DSH 的 canonical workspace 检查拒绝；稳定空执行根后，真实 DSH 跨进程续接并完成文件修复 | 恢复身份不止 session ID；还需稳定 HOME 与 cwd，且不能牺牲项目规则隔离。旧随机 cwd 会话明确失败，不假恢复 | `.ch/docs/design-docs/loop-subtask-session-reuse.md`；`src/test/extensionHost/dshLoopSessionResumeLive.test.ts` |
| 2026-10-24 | 失败原因 / 成功方案 | Grok 分类器用 `trim()` 丢弃纯空白 `agent_message_chunk` 和 `agent_thought_chunk` | 分块边界把 `Hello` + 空格 + `world` 收成 `Helloworld`，换行和缩进同样丢失。撤销该判断后，非空文本原样保留 | 空字符串才可忽略。宿主期望不能反过来定义丢空白。展示层负责隐藏纯空白气泡 | `.ch/docs/runbooks/PITFALLS.md` 的“Grok 分类器不能按 trim 丢弃纯空白分块”；`src/interactive/grokAppServerProtocol.ts`；`src/test/interactive/grokAppServerProtocol.test.ts` |
| 2026-10-27 | 失败原因 / 成功方案 | Kimi 默认配置精简掉 `capabilities` / `support_efforts` 后，界面仍请求 `high`，ACP 报 `available: (none)` | 保存链路只补缺失的 `thinking` 能力与五档列表，默认配置和范例同步带声明；隔离官方 ACP 实测 `high` 与完整六值广告 | UI 可选值依赖配置声明时，精简范例不能删除隐式前置条件；补齐应放在统一提交契约并保留显式限制 | `.ch/docs/exec-plans/completed/2026-10/2026-10-27-feature-kimi-config-simplification.md#2026-10-27-思考声明回归修复`；`.ch/docs/runbooks/kimi-code-config.md` |
| 2026-10-27 | 失败原因 / 成功方案 | Kimi 新增配置模型后，长驻 ACP runner 仍缓存旧模型广告，下一轮可能报 `model ... is not advertised` | 配置写入按 `KIMI_CODE_HOME` 推进修订号；旧 runner 不再复用，新 runner 恢复原 ACP 会话后取得新广告。官方 2.3.2 隔离验证新增别名生效且 session ID 不变 | ACP 的配置广告是进程启动快照；会话内动态切换不能替代配置变更后的进程失效与恢复 | `.ch/docs/exec-plans/completed/2026-10/2026-10-27-bugfix-kimi-replay-model-selection.md#验收标准`；`.ch/docs/exec-plans/completed/2026-10/2026-10-27-feature-kimi-model-management.md#当前结论`；`.ch/docs/runbooks/kimi-code-config.md` |
