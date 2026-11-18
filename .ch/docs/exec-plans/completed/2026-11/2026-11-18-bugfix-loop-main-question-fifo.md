# Loop / Loop+ 主模型提问公平排队

- 日期：2026-11-18
- 类型：bugfix
- 状态：completed
- 负责人：Codex

## 背景与目标

共用会话的主任务调用原本有独立优先队列，编排器的待办状态也会禁止提问启动。群聊协调器还延后提交第二个及后续问题，导致连续验收可以反复插队。修复为同一主任务 Tab 按实际入队顺序串行执行。

## 范围与验收

- 已开始的调用不被抢占；提问等待当前调用与先入队的工作，不等待后来发起的验收、补充需求处理或收口调用。
- 每条问题在提交时即进入共享队列；等待标记、停止、错误处理仍按原规则工作。
- 不调整 Loop+ 内部验收事件的依赖选序、批次、补充需求队列或完成门禁；不修改 Webview 结构或存储格式。

## 影响面与验证计划

- 共用会话队列、扩展宿主接线、群聊问答协调、Loop+ 编排回归；同步功能清单、设计和业务本体。
- 风险与缓解：仅调整主会话调用入队，保留从准备到退出的互斥、问题取消及调度提交边界，不引入持久化迁移。需要回滚时可整体回退本次宿主与队列改动。

## 验证结果

- `npm run build` 通过。首轮两个 TypeScript 错误来自测试夹具的可选字段断言和空数组类型收窄，修正断言后通过。
- `node --test dist/test/loop/loopMainQuestionQueue.test.js dist/test/loop/loopGroupChatCoordinator.test.js dist/test/loop/loopAskThread.test.js dist/test/loop/loopMainQuestion.test.js dist/test/loop/loopGroupChatPanel.test.js dist/test/extensionHost/loopPlusOrchestration.test.js dist/test/extensionHost/loopPlusRuntimeIntegration.test.js dist/test/extensionHost/promptSessionHealth.test.js`：406 项通过。包含两批验收之间回答、连续问题与主任务交错、排队提示及取消清理。
- `python3 verify_mac.py`：75 个回归文件的 1367 项测试通过，三轮隔离会话交接及公共 runner 交接通过。验证前后基线 `620b1532`，`git diff --binary -- src scripts verify_mac.py verify_win.py` 的 SHA-256 均为 `399455d60616cfc501fd73b192561a92c86290f2a14158a737825e4519d840b3`。报告文件名：`sinitek-loop-plus-a7eeef2a-37e4-4341-a403-108eef0bafa0.json`（系统临时目录）。
- `python3 .agents/skills/ontology/scripts/search_ontology.py --validate` 与 `git diff --check` 通过。
- 未验证 Windows 或已安装的 VS Code 扩展。未改 Webview 布局、样式或协议，现有群聊协调测试验证排队标记，不另跑浏览器验证。

## 结论

主任务调用和每条提问按实际入队顺序执行。功能清单、产品规格、调度设计、业务本体和排查手册已同步；不需要另写热区记忆。
