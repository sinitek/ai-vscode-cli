# Loop+ 群聊重启恢复

- 日期：2026-11-28
- 类型：bugfix
- 状态：completed
- 负责人：Codex
- 关联计划：无

## 范围与验收

VS Code 重启后，在原群聊点击「继续执行」应回到同一工作区、同一 Loop+ 任务的主标签和会话，即使重启前选中的是另一条对话。从主任务标签再次打开应复用同一编辑器。恢复页面时保留编辑器位置，已中止的任务等待用户继续。旧页面缺少可靠身份、任务已删除或属于其他工作区时提示用户从原任务重新打开。

## 实施与风险

- [x] 核对群聊创建、任务读取和主会话选择。旧版持久化了滚动和弹窗状态。重启后宿主失去了编辑器的消息监听，从任务标签打开才重新登记面板。按会话回退还可能选中共享会话的子任务或其他任务标签。
- [x] 加载页和内容页保存工作区、完整任务 ID、CLI 和会话定位信息。序列化恢复和手动打开共用面板登记、监听及销毁流程。普通任务从已知来源冷读取，优先采用已提交的存储迁移。部门任务沿用所有权核验。
- [x] 优先通过任务归属定位主会话，只从归属相容的标签回退。尚未取得会话 ID 时暂存主任务 ID，分配会话、切换 CLI 或新建会话后清理。缺少有效绑定的旧页面提示从原主任务标签重新打开一次。
- [x] 补充加载页绑定、恢复与同时打开、缺失或跨工作区绑定、孤立运行核对、存储迁移和主标签选择的回归。同步群聊设计、功能清单和 ontology。

## 验证

- 构建 `npm run build` 通过。群聊、存储和会话相关定向测试 492/492 通过。最小复验入口为 `node --test dist/test/loop/loopGroupChatCoordinator.test.js dist/test/loop/loopGroupChatPanel.test.js dist/test/loop/loopTaskStorePersistence.test.js dist/test/session/loopPlusSessionTabs.test.js`。
- 使用全新隔离用户目录执行 `node scripts/run_unit_tests.js`，共 6401 项，6379 通过、19 失败、3 跳过。19 个失败用例在修复前的 1.10.7 产物上逐项复现，涉及产研部组长注入、所有权补充和阻塞恢复。前后失败用例名称一致。
- macOS、VS Code 1.144.0 和本地 DSH 替身。修复前的 1.10.7 可从任务标签打开群聊并中止任务，切换对话并重载窗口后，新宿主已启动，原群聊编辑器没有恢复，续跑调用为 0。
- 修复后执行 `node scripts/loop_plus_protocol_regression_smoke.cjs --scenario=group-continue-panel --scenario=group-continue-reload --scenario=group-continue-restart`。三个场景分别验证当前窗口、重载窗口和完整退出再启动。完整重启中，首个 VS Code 进程正常退出并回收，新进程打开原来的隔离工作区。恢复时仍选中另一条对话，点击原群聊「继续执行」后切回原主标签和会话。重复确认只产生一次主调用，从主标签再打开时仍是同一个群聊编辑器。插件和 Webview 错误均为 0。
- `python3 .agents/skills/ontology/scripts/search_ontology.py --validate` 通过。真实宿主验证范围为 macOS 上的合成任务。原始测试报告在 `.tmp/loop-plus-protocol-regression/group-continue-restart-last.json`，全量回归与旧版对照在 `.tmp/group-binding-full-final.log` 和 `.tmp/group-binding-baseline-tests.log`。
