# Loop+ 撤销验收与直接关闭子任务

- 日期：2026-11-17
- 类型：feature
- 关联计划：无；保留工作区现有依赖和标签状态改动
- 状态：completed
- 负责人：Codex

## 背景与目标

用户确认撤销语义为本次交付不再验收，记录原因并移出待验收队列。现有 close 已覆盖运行/排队任务的中断、关页和迟到结果保护；验收协议、调度快照和展示只有 passed/failed。

## 范围与非目标

新增 reviews[].acceptance=cancelled，持久保存撤销原因；沿用冻结批次和提交事务。校对 close 全链路，补齐原因与中文状态展示。不撤回已有结论，不自动满足依赖，不改变经典 Loop，不增加框架或依赖。

## 验收标准

- 撤销必须说明原因，批次可混合通过/失败/撤销；全撤销不伪造检查结果。
- 队列移除、幂等提交、暂停/恢复、快照读取和中文展示正确。
- 撤销不满足执行依赖；关闭运行/排队子任务仍中断并释放资源，迟到结果不再入验收。
- 父任务仍遵守最终完成门禁。

## 影响面与风险

协议、scheduler、宿主策略/提示、验收反馈、投影和群聊状态；同步设计、功能清单和 ontology。主要风险为撤销误记为通过、原因丢失、混合批次漏审和旧快照兼容；通过定向回归及构建验证。已有未提交内容保留。

## 验证计划

先 npm run build，再 node --test 对应 dist/test/loop/loopPlus* 与宿主策略/编排、存储测试；按现有浏览器夹具进行最小 headless Chromium 展示验证。ontology --validate 和 Python skill 测试。Windows 原生和付费真实模型不在本次验证范围。

## 完成交付

- reviews 增加 cancelled 及必填原因，沿冻结批次提交；全批撤销不要求检查，混合批次保留其余检查与原顺序。
- scheduler 快照保存 acceptanceReason，恢复、复制与重复提交保持原因；撤销不放行依赖执行，既有父任务门禁保持。
- 既有 close 已覆盖运行/排队/中断子任务及迟到保护，本次补充关闭原因并明确显示已关闭。取消交付显示验收已撤销，反馈及锚点保留原因。
- 用户入口沿用群聊补充需求，由主任务在后续决策处理；不新增手动按钮，不撤回已有验收结论。
- 同步 scheduling 设计、FEATURE_INVENTORY、能力说明与 ontology；稳定事实已落在这些来源，无需额外扩写记忆热区。

## 验证结果

- `npm run build`：通过。
- 以下命令 18 个测试文件共 606/606 通过，0 失败/取消/跳过/TODO：

```sh
node --test dist/test/loop/loopPlusDecision.test.js dist/test/loop/loopPlusScheduler.test.js dist/test/loop/loopPlusSchedulerDependencies.test.js dist/test/loop/loopPlusDependencies.test.js dist/test/loop/loopPlusPanelState.test.js dist/test/loop/loopPlusGroupChatPanel.test.js dist/test/loop/loopTaskStore.test.js dist/test/loop/loopTaskStoreCoreCoverage.test.js dist/test/loop/loopTaskStorePersistence.test.js dist/test/core/loopPlusAcceptancePlan.test.js dist/test/extensionHost/loopPlusDecisionStrategies.test.js dist/test/extensionHost/loopPlusOrchestration.test.js dist/test/extensionHost/loopPlusPromptBuilders.test.js dist/test/extensionHost/loopPlusHandoffContracts.test.js dist/test/extensionHost/loopPlusAcceptanceCompletionGate.test.js dist/test/extensionHost/loopPlusAcceptancePlanHost.test.js dist/test/extensionHost/loopPlusRuntimeIntegration.test.js dist/test/loop/loopGroupChatPanel.test.js
```

- 覆盖：撤销原因缺失/空白/超长拒绝、混合批次和全撤销、依赖阻塞、幂等、JSON 恢复、真实文件冷加载、晚到事件及消息、关闭原因和迟到执行结果、中文反馈与定位，以及已有存储/交接/完成门禁。
- `python3 .agents/skills/ontology/scripts/search_ontology.py --validate`：通过；`python3 -m unittest discover -s .agents/skills/ontology/tests -p 'test_*.py'`：9/9 通过。
- `git diff --check`：通过。
- Chromium：通过 chromium-playwright-smoke runner 渲染生产 panelStateBuilder、scheduler、验收反馈和群聊 HTML，注入 VS Code 通常提供的 API 与语义主题变量，不改生产脚本或 CSP。1280×900、480×900 两种尺寸均通过状态、原因、锚点点击/侧栏展开及视口断言；browserErrors/httpErrors/requestFailures 均为 0，已检查截图。
- 本机证据保留于 ignored 的 `.tmp/loop-cancel-smoke/`：build.log、unit.log、desktop/result.json、desktop/success.png、narrow/result.json、narrow/success.png；任务用 scenario、HTML 夹具与服务器已清理。

## 失败分流及修正

- 首轮新增存储/页面夹具遗漏 scheduler 必需的 maxConcurrency，属于夹具问题，显式补 1 后通过。
- 附加审查提示的新例外说明含 Otherwise，触发历史 `/other/i` 禁注入断言；改成同义明确措辞，未放宽原断言，最终通过。
- 浏览器夹具起初使用不存在的 #timeline，已核对生产 DOM 改为 #timelineSlot；补齐真实宿主会提供的主题变量后确认桌面/窄屏截图，最终无错误。

## 验证边界

未运行付费真实模型完整任务、已安装扩展或 Extension Development Host 端到端、Windows 原生及全仓单测；本次结论为当前源码、隔离宿主回归与真实 Chromium 渲染通过。保留工作区此前及并发产生的无关未提交内容。

## 单独提交范围验证

用户要求仅提交本任务。以原 HEAD 为基线，在独立临时副本中只加入撤销验收、关闭原因、中文展示及对应测试/文档；未加入工作区的显式依赖、四项验收批次或子任务标签修复。scheduler 与存储回归使用基线已有的 `claimNextReview`，独立验证撤销、原因持久化、顺序、幂等和完成门禁；与尚未提交依赖功能的集成增量保留在工作区。

- 独立提交快照 `npm run build`：通过。
- 16 个相关测试文件：540/540 通过，无失败、取消、跳过或 TODO。
- 独立快照 ontology `--validate` 通过，ontology skill Python 测试 9/9 通过。
- 前文 606 项及浏览器验证为包含当时其它未提交改动的工作区证据；不将其等同于本次独立提交。此次不重复已通过的浏览器渲染。

```sh
node --test dist/test/loop/loopPlusDecision.test.js dist/test/loop/loopPlusScheduler.test.js dist/test/loop/loopPlusPanelState.test.js dist/test/loop/loopPlusGroupChatPanel.test.js dist/test/loop/loopTaskStore.test.js dist/test/loop/loopTaskStoreCoreCoverage.test.js dist/test/loop/loopTaskStorePersistence.test.js dist/test/core/loopPlusAcceptancePlan.test.js dist/test/extensionHost/loopPlusDecisionStrategies.test.js dist/test/extensionHost/loopPlusOrchestration.test.js dist/test/extensionHost/loopPlusPromptBuilders.test.js dist/test/extensionHost/loopPlusHandoffContracts.test.js dist/test/extensionHost/loopPlusAcceptanceCompletionGate.test.js dist/test/extensionHost/loopPlusAcceptancePlanHost.test.js dist/test/extensionHost/loopPlusRuntimeIntegration.test.js dist/test/loop/loopGroupChatPanel.test.js
```
