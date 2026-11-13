# 主任务主动澄清表单 — 新功能开发

- 日期：2026-09-30
- 状态：completed
- 负责人：Codex
- owner：orchestrator-clarification
- claimed_at：2026-09-30
- claim_ttl：已完成并归档
- 类型：feature


### 目标

Loop、Loop+ 的主任务如果对需求有疑惑，或认为方案有关键缺口，返回 `clarify` 决策。宿主在群聊弹出与人工交互同类的表单，用户提交后继续执行，拒绝则暂停待复核。

### 范围

- 经典 Loop 与 Loop+ 决策协议、持久化 `pendingClarification`、群聊弹窗。
- 同一进程内等待；宿主重启后凭持久化表单冷恢复。

### 非目标

- 不让子任务弹这个表单。
- 不把用户提问「我要提问」并进补充需求。

### 验收

- `clarify` 且带 1 到 8 个合法字段才接受；非法决策按原协议失败处理。
- 表单出现在 Loop/Loop+ 群聊，颜色只用 VS Code 主题变量。
- 提交后答案进入补充要求并继续主任务；拒绝或停止不再显示表单。
- 同一任务最多主动澄清 8 次。

### 结论

经典 Loop、Loop+ 主任务返回 `clarify` 后，宿主在群聊等待表单。提交写入补充要求并继续；拒绝进入 `needs-review`；停止清表单。

## 分类依据与真实状态

feature：新增主任务clarify表单协议与冷恢复；test：cf0bfab6新增core/orchestratorClarification及更新主决策/调度/HTML覆盖；docs：同提交loop-plus-scheduling及产品/ontology明确加入clarify。共享提交中的超时/自动打开归另一个9/30来源，不复制整篇记录或擅扩Graph/generated。

当前记录继承 `completed`；本轮仅语义拆分/命名迁移，未执行上述历史业务命令，不改变失败、阻塞或未发布结论。

## 测试类型记录清理

2026-11-11 按用户明确授权删除本来源的 test 类型计划；历史验证命令、结果、失败、跳过与限制见 [测试计划删除审计](../../migrations/test-plan-removals/2026-11-11-jul-sep.json)（按原来源路径检索）。本记录的作者、日期、状态与历史结果不变，不接回独立测试开发，也不表示本轮重跑历史命令。
