# Loop+ 等待主任务的分钟补充需求

- 日期：2026-11-28
- 类型：bugfix
- 状态：completed
- 关联计划 `../../active/2026-11-28-bugfix-loop-subtask-minute-watchdog.md` 负责子任务失联核实。本计划处理已经确认中断或没有在途执行的父调度。

## 目标与验收

- 复现普通 Loop+ 最后一个开放 attempt 已中断、父任务等待的现场形状。复用已有分钟时钟和补充需求队列，把可执行的续跑提示交给同一主任务。
- 子任务运行、修复、主任务验收均空闲才补充。主任务将开放且已中断的 attempt 作为自己要处置的异常。支持续接相容会话、用新会话继续原逻辑 ID，以及关闭原预留并派新 ID 接替剩余工作。
- 主提示、决策助手和宿主对等待资格使用一致的事实。保留显式依赖、活动兄弟任务和冻结验收批次的归属。
- 同一提示持久化成功后才消费。并发巡检、用户停止、暂停、历史记录与运行中的兄弟任务有回归覆盖。

## 实施与验证

- [x] 从指定任务只读快照、调度器、宿主和群聊补充需求入口核对根因。
- [x] 分钟巡检通过既有补充需求队列唤醒原主任务。相同消息复用持久化记录，写入失败留待下次巡检。
- [x] 主提示、决策助手和宿主把中断预留与真实执行分开。主任务按已有产物续派或安排新 ID 接替。接替准入、原 ID 依赖和写入校验成功后才清理旧 attempt。提交时再次核对中断身份，保护已经手动续跑的成员。
- [x] 验收等待的前置中断时，调度器重新向主任务提供控制入口。独立验收已提交的结论和后续事件各自保留。

### 验证记录

- `npm run build` 通过。针对分钟唤醒、原会话与新会话、接替与写入失败、迟到指令、显式依赖和冻结验收运行 `node --test --test-name-pattern='满槽|中断|分钟|main reprompt|restored interrupted|commits controls|dispatch waits|controls fail|full interrupted|report confirmation precedes'`，覆盖六个相关测试文件，21 项通过。
- `node scripts/loop_plus_protocol_regression_smoke.cjs --extension-host-only --scenario=idle-supplement-extension-host` 在隔离 macOS arm64 Extension Host 通过。真实分钟时钟、合成模型和任务存储驱动 3 次主调用、2 次子任务尝试、1 条补充需求，历时约 64 秒。
- 扩大至 Loop+、等待巡检、恢复与会话相关测试后，966 项中 961 项通过。3 项 `loopPlusHandoffContracts` 冷恢复诊断及手动恢复空写入断言已用改动前模块复现。2 项 `loopPlusAcceptancePlanDialog` 的 VM 夹具缺少 `isLoopMainTab`，改动前构建复现相同错误。
- `node scripts/verify_prompt_rule_index.cjs` 通过。`python3 .agents/skills/ontology/scripts/search_ontology.py --validate` 通过，本体测试 9 项通过。设计、功能清单和诊断手册保留恢复步骤与权限边界。
