# Loop 子任务通知与压缩产品及调度说明

- 日期：2026-11-06
- 状态：completed
- 类型：docs
- 负责人：Codex

## 背景与目标

把先通知再压缩、同会话后续等待及独立运行状态写入产品和调度事实，避免使用占用主运行槽的主任务并行压缩路径描述子任务后台压缩。

## 关联计划

- [时序能力实现](2026-11-06-feature-loop-subtask-notify-before-compact.md#验收标准)：提供开关、五分钟条件、三分钟超时和会话隔离事实。
- [测试计划移除审计](../../migrations/test-plan-removals/2026-11-11-nov-active.json)：提供异步门闩、失败/超时及主状态隔离证据，来源为 `source_old_path=.ch/docs/exec-plans/completed/2026-11/2026-11-06-loop-subtask-notify-before-compact.md`；文档不代替真实 CLI 验收。

## 范围与非目标

- 范围：产品功能清单、能力说明、Loop+ 调度设计和现有压缩 ontology 规则的实际同步。
- 非目标：新增生产代码、回归/夹具开发、改变页面或 CLI 协议、追加热区/事件/滚动摘要；本轮不再次编辑设计文档或本体。

## 验收标准

- [x] 产品说明完成先上报再后台压缩，保留开关、成功且超过五分钟和三分钟超时条件。
- [x] 调度设计说明子任务压缩不能复用占用主运行槽的主任务并行压缩路径，并保留同会话等待/独立状态。
- [x] 现有压缩 ontology 规则同步事实；稳定经验入设计，不重复追加记忆热区、事件记忆或滚动摘要。

## 影响面与风险

仅产品清单/能力说明/调度设计与现有本体来源；风险是文案把后台压缩当成无需等待的同会话并发。按关联实现和门闩证据核对；回滚只撤销不准确的文字，不改变压缩开关和协议。

## 验证计划

历史逐项核对清单、能力说明、调度设计和规则，执行 ontology 校验及其 Python 单测和差异空白检查。本轮仅验证计划局部链接、身份和结构，不执行历史命令。

## 测试与清单同步

- 产品功能清单、能力说明、Loop+ 调度设计和现有压缩 ontology 规则已同步；没有页面或外部协议变更，未运行真实模型付费验证和浏览器验收，未执行发布脚本。
- ontology `--validate`：通过；`python3 -m unittest discover -s .agents/skills/ontology/tests -p 'test_*.py'`：9 项通过。
- 已跟踪改动及新增文件的 `node scripts/check_trailing_whitespace.js <本次文件>` 与 `git diff --check`：通过。这里是既有校验结果，不是新增测试开发。
- 稳定经验归入调度设计：子任务压缩不能复用占用主运行槽的主任务并行压缩路径。无需额外追加记忆热区、事件记忆或滚动摘要。

## 任务列表

- [completed] 同步功能清单与能力说明中的通知/压缩边界
- [completed] 更新调度设计与压缩 ontology，避免误用主任务运行槽
- [completed] 记录既有文档校验及无需重复记忆写作的结论

## 当前结论

继承原 completed，文档交付完成。不用关联计划的 completed 证明真实付费 CLI、浏览器或 Windows/Linux 原生验收通过；原有未验证边界和真实 DSH 测试跳过按 `source_old_path=.ch/docs/exec-plans/completed/2026-11/2026-11-06-loop-subtask-notify-before-compact.md` 见测试计划移除审计。
