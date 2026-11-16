# Loop+ 主任务活动状态修复

- 日期：2026-11-16
- 类型：bugfix
- 关联计划：无
- 状态：completed
- 负责人：Codex

## 背景与目标

群聊已读取 mainModelBusy，但成员和状态卡只依赖 scheduler 快照。主任务回答问题、处理用户消息、再次规划或收尾时，scheduler 可为 idle / waiting，导致活动主模型显示空闲或等待。

## 范围与非目标

将现有主 Tab 运行信号及提问 onStarted 生命周期接入只读投影、成员状态和思考气泡；沿用验收冻结批次及终态优先级。不改变 scheduler、持久化格式、模型调用和调度门禁。

## 验收标准

- 主模型实际运行时，空调度队列和历史子任务不会导致主任务显示空闲；同级子任务仍运行时可同时显示主模型运行。
- 提问排队不会伪造主模型活动；实际开始、成功、失败或中止后立即更新。
- 真正空闲、验收、首次分解、暂停、停止、完成、非法快照及经典 Loop 保持正确语义。
- 通过相关回归、npm run build 和 Chromium 真实页面增量更新验证。

## 影响面与风险

- 代码：loopPlusPanelProjection、loopGroupChatPanelState、群聊协调器、Webview 类型和渲染。
- 风险：把后台控制器所有权误作主模型活动或覆盖终态；仅使用现有 Tab 运行信号和实际开始的提问，保留终态/验收优先级。
- 回滚：撤销本计划对应代码与规格变更，无数据迁移。

## 验证计划

- npm run build
- node --test --test-reporter=dot dist/test/loop/loopPlusGroupChatPanel.test.js dist/test/loop/loopGroupChatCoordinator.test.js dist/test/loop/loopGroupChatPanelState.test.js dist/test/loop/loopPlusPanelState.test.js dist/test/loop/loopGroupChatPanel.test.js dist/test/extensionHost/loopPlusRuntimeIntegration.test.js
- 本机 Chromium 加载真实构建的群聊 HTML，通过宿主 `contentPatch` 验证 waiting → running 与并发子任务场景。
- ontology 校验与单测、git diff --check。

## 测试与清单同步

- 单元测试：覆盖主模型运行投影、并行子任务活动、提问排队/开始/结束及主调用开始/结束；群聊 HTML 回归断言主任务运行状态和主/子任务思考气泡。
- 单元自测结果：`npm run build` 通过；`node --test --test-reporter=dot dist/test/loop/loopPlusGroupChatPanel.test.js dist/test/loop/loopGroupChatCoordinator.test.js dist/test/loop/loopGroupChatPanelState.test.js dist/test/loop/loopPlusPanelState.test.js dist/test/loop/loopGroupChatPanel.test.js dist/test/extensionHost/loopPlusRuntimeIntegration.test.js` 通过。最初浏览器用例断言了相反的思考气泡顺序，按现有子任务先于主任务的展示顺序修正后复跑通过；实现行为无缺陷。
- 浏览器验证：Chromium 140.0.7339.16 加载实际生成的群聊 HTML，并通过宿主 `contentPatch` 检查 waiting → running；主、子任务思考气泡同时存在，480px 视口无横向溢出，页面无脚本错误。临时脚本和截图未纳入仓库。
- 功能清单、产品规格及 Loop+ 调度设计均已补充主任务实时活动展示规则；Ontology 规则 `plugin.rule.loop_plus_subtask_chat` 已更新，Ontology 校验和 9 项单测通过。
- 不更新热区或事件记忆；稳定规则已经进入设计文档、功能清单和 Ontology。

Tasklist:
- [completed] 定位调度快照与主模型忙闲信号脱节
- [completed] 修复只读投影及提问刷新并补回归
- [completed] 完成验证、规格同步及计划归档
