# Loop+ 活动子任务期间续跑按钮互斥

- 日期：2026-11-23
- 类型：bugfix
- 关联计划：无
- 状态：completed
- 负责人：Codex

## 背景与目标

Loop+ 主模型处于等待、但调度器仍有活动子任务时，群聊把“主 Tab 空闲”误判为任务可继续，导致“中止”和“继续执行”同时出现。应以 scheduler 的开放 attempt 与子任务中断状态区分可续跑恢复和仍在执行。

## 范围与验收标准

- 普通 Loop+ scheduler 有活动子任务时隐藏普通“继续执行”，保留“中止”。
- 群聊继续入口和宿主处理器共享同一门禁，过期/伪造消息不能绕过。
- 活动 attempt 清空后，已标记 blocked 的开放 attempt 仍可显式续跑；切模型触发主模型的既有路径不回归。
- 更新功能清单、状态边界设计和 ontology。

## 影响面与风险

- 影响群聊控制器投影、续跑协调和 Loop+ 群聊协调器测试。
- scheduler 有活动的兄弟任务与 blocked attempt 并存时，必须保持中止可用并拒绝继续，待活动任务结束后再恢复。

## 验证计划

- `npm run build`
- 运行 `loopGroupChatCoordinator`、`loopPlusRuntimeIntegration`、`loopPlusGroupChatPanel` 定向单测。
- 验证 ontology、whitespace 和 `git diff --check`。
- 不读取或修改用户任务记录，不发布扩展。

## 进展

- 已复现触发条件：Loop+ 控制器使父任务被视为运行；主 Tab 空闲兜底未检查 scheduler 是否仍有开放的活动子任务。
- 已加入活动执行门禁和 coordinator 状态回归。存在非中断活动 attempt 时保留“中止”、隐藏普通“继续执行”；只有活动 attempt 清空后才恢复 `blocked` 子任务。宿主拒绝过期普通续跑请求，切模型路径保持独立。
- 已同步恢复边界设计、功能清单和 `plugin.rule.loop_subtask_interruption_isolated` ontology 规则。

## 验证结论

- `npm run build`：通过。
- `node --test dist/test/loop/loopGroupChatCoordinator.test.js dist/test/extensionHost/loopPlusRuntimeIntegration.test.js dist/test/loop/loopPlusGroupChatPanel.test.js`：147 项通过，0 失败；集成用例覆盖活动兄弟仍运行时拒绝恢复 `blocked` 子任务。
- `python3 .agents/skills/ontology/scripts/search_ontology.py --validate`：通过，2 个 domain、27 个 concept、24 个 relation、202 个 rule、4 个 workflow 均通过校验。
- `git diff --check`：通过。
- 未执行真实 VS Code 图形宿主验证；本次行为由协调器与 Loop+ runtime/panel 自动化回归覆盖。未读取或修改用户任务记录，也未发布扩展。
