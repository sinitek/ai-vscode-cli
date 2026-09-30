# 主任务主动澄清表单

日期：2026-09-30
状态：completed
负责人：Codex
owner：orchestrator-clarification
claimed_at：2026-09-30
claim_ttl：已完成并归档

## 目标

Loop、Loop+ 和 Graph 的主任务如果对需求有疑惑，或认为方案有关键缺口，返回 `clarify` 决策。宿主在群聊或 Graph 运行图弹出与人工交互同类的表单，用户提交后继续执行，拒绝则暂停待复核。

## 范围

- 经典 Loop 与 Loop+ 决策协议、持久化 `pendingClarification`、群聊弹窗。
- Graph planner / replanner 的 `clarify` 结果、运行图弹窗。
- 同一进程内等待；宿主重启后凭持久化表单冷恢复。

## 非目标

- 不改 Graph「我要说话」。
- 不让子任务或非 plan 节点弹这个表单。
- 不把用户提问「我要提问」并进补充需求。

## 验收

- `clarify` 且带 1 到 8 个合法字段才接受；非法决策按原协议失败处理。
- 表单出现在 Loop/Loop+ 群聊和 Graph 运行图，颜色只用 VS Code 主题变量。
- 提交后答案进入补充要求并继续主任务；拒绝或停止不再显示表单。
- 同一任务最多主动澄清 8 次。

## 验证

- `npm run build` 通过。
- `node --test` 相关 140 项通过：澄清解析、Loop 主决策、Loop+ 协议与调度、Graph artifact / kernel / prompt、群聊和运行图 HTML。

## 结论

经典 Loop、Loop+ 和 Graph plan 节点返回 `clarify` 后，宿主分别在群聊或运行图等待表单。提交写入补充要求并继续；拒绝进入 `needs-review`；停止清表单。非 plan 节点的 `clarify` 记为失败。Graph plan 节点保持 `ready`，等待信号是 `pendingClarification`。
