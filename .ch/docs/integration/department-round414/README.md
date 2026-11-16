# 产研部本地候选来源与边界

本目录交付可审查的本地候选，不表示最终 Git 同步、合理合并或合并树全量回归完成。基线 `f5b5ac57e4b9f956abdb29f82cf8e50d345c2b95`；候选分支 `codex/department-candidate-round414-20261116`。共享 master、索引和用户修改不参与本候选提交。

## 审查入口

- [文件清单](manifest.json)：332 条选择路径，每条有来源/候选 SHA-256、大小、基线哈希、选择方式、报告提及及精确静态依赖边。报告提及可能是在描述未修改范围，不独立作为归属证明。
- [报告清单](reports.json)：从父记录 `subTasks[].communicationFile` 解析，保留已接受、失败、阻塞报告及审查历史。`completed` 不等于 `acceptance=passed`；历史报告不升级为当前文件字节的验收。
- [逐 hunk 清单](hunks.json)、[依赖边](dependencies.json)、[排除与转换](exclusions.json)：共享文件混合变更按当前 diff、具体依赖和报告交叉核对。新增文件由完整文件哈希界定；已有文件由 hunk 哈希及符号上下文界定，仍需主审判断共享合同。
- [构建来源对应](build-source-correspondence.json)：冻结时整个 src 与 round-410 已接受构建实体源码 807/807 一致，package.json、tsconfig.json 一致；之后仅四个候选文件移除 EOF 空行，最终 803 个逐字节一致、4 个仅 EOF 空白不同。既有结果按其范围复用，本轮未构建。
- [检查记录](checks.json)、[路径审阅](path-review.json)、[远端冲突风险](conflict-risk.json)：仅补丁适用性、路径/大小写、哈希及空白。远端是现存本地 ref，未 fetch。

## 需求及必要共享依赖

| 需求/依赖 | 当前代码证据 | 报告证据与限制 |
| --- | --- | --- |
| 三层组织，真实 Loop 总监及 Loop+ 组长复用 | src/extension.ts 的 getDepartmentRuntimeComposition、runDepartmentLeaderPrompt；extensionHost/departmentruntimecomposition.ts、departmentorchestration.ts；loopOrchestration.ts、loopPlusRuntimeAdapter.ts | round-26/31 装配、round-224 producer 接线及后续修复。不是另建模拟调度器；全部共享调用点随依赖纳入。 |
| 三角色配置、统一方案 | departmentConfiguration.ts、departmentSettings.ts；extensionHost/departmentConfigurationHost.ts、modelSettings.ts；settingMessageHandlers/preferences.ts；webview/viewContentScript/departmentConfiguration.ts | 角色路由、存储、宿主校验与页面状态依赖一并纳入。报告接受状态逐条见 reports.json，不将早期未接线结果当最终通过。 |
| 4/20 全部门同时运行额度、每组零余额一个超额、派发前余额 | departmentcapacity.ts、departmentprompts.ts；extensionHost/departmentemployeeexecutionadmission.ts、departmentruntimestate.ts、departmentproductioncleanup.ts；loopPlusOrchestration.ts、loopPlusPromptBuilders.ts | 准入、执行责任、清理证明与容量归还同时保留。业务完成不能代替清理，未知身份不归还容量。 |
| 跨组协作 | departmentcollaboration.ts；loopPlusDecision.ts、loopPlusOrchestration.ts；departmentorchestration.ts 的协作投递与持久回执 | round-351 已接受的真实 Owner 协作及持久化组合结果按当时快照复用，fixture 超额派发的历史失败仍保留。 |
| 组长弹窗、完整操作栏、原 tab 名称及 👴🏻👨🏻👶🏻 图标 | webview/departmentGroupChatModal.ts、loopGroupChatPanel*.ts；extensionHost/departmentConversationTabs.ts、loopGroupChatPanelCoordinator.ts、sessionTabs.ts；viewContentScript/messageRendering.ts | 图片/链接宿主的目标上下文及过期请求保护是弹窗必要依赖，chatImageHost.ts、chatLinkHost.ts 一并纳入；没有在本次重新设计 UI。 |
| 三模式开关默认开/开/关、20 多 CLI 性能警告 | modeAvailability.ts、toolSettings.ts、panelStateBuilder.ts、sessionMessageActions.ts、extension.ts；viewContentHtml.ts、settingsAndOverlays.ts、viewContentStrings.ts | 公开发送/异步配置/定时入口的关闭门禁和已有任务续接豁免一起纳入。sessionMessageActionsCoreCoverage.test.ts 未被报告明确列名，以新增两项真实 API 回归 diff 为伴随证据。 |
| 普通 Node CLI/Codex 核心与兼容 facade | cli/commandRunner.ts → cliProcessRuntime.ts → processLifecycle.ts/processTermination.ts；interactive/codexRunner.ts、codexAppServerPool.ts、codexRunnerProcess.ts、codexAppServerCapabilities.ts → 各 Core 与 RuntimePorts/Host | round-109 CLI 提取与 round-117 已接受 Node 核心提取报告。不可只复制 Owner 而丢掉真实进程核心、NDJSON 排空或 overlay 清理合同。 |
| 存储路由、Owner、身份及组长聚合 | loopTaskStore.ts、loopTaskIdentityCatalog.ts；departmentProductionTaskStore.ts、departmentOwnedTaskRepository.ts、departmentOwnedTaskSource.ts、departmentOwnedSourceController.ts、departmentOwnershipIndex.ts；runtime/department*owner*.ts、extensionHost/departmentleaderexecutionledger.ts | round-97 repository、round-101 source wiring 及后续生产修复。公开 router 的 handled 拒绝/墓碑、完整 reader、首次发布及独立 owner worker 都是闭合依赖。 |
| Loop+ 失败交付的明确后继及夹具存储合同 | loopPlusCompletion.ts、loopTaskStore.ts 的 repairSource、loopPlusDecisionStrategies.ts/loopPlusOrchestration.ts；test/extensionHost/fixtures/loopPlusRuntimeFixture.ts 与相关 consumers | repairSource 的可信派发/持久化是部门组长完成判断依赖。round-348 的历史合同修复与 round-351 已接受删除顺序/真实 Owner 结果分别保留，不能把不同快照拼作一次全绿。 |

以上路径省略的 src/ 前缀按 manifest 精确路径为准。每个共享文件仍有文件级报告提及、代码入边/出边及 hunk 清单；静态相对导入检查不代替类型或运行时合同审查。

## 排除、并发与最终集成

- ontology 只移植部门相关对象语义，保留基线中未变对象的文本。三个安装/ZCode 对象的 source_refs `symbol → anchor` 与部门无关，其作者归属待核对，候选不纳入，共享原件完整保留。无关全文件格式化也不纳入。精确对象及哈希见 exclusions.json。
- 平台任务的两份 JS 在盘点后发生修改，本候选使用 round-403 已接受实体副本，脚本 SHA-256 为 `30868398c33fcd5cbb1b0ee1acc0e06a297ebfb4c80c237f026ec87d043504fe`，测试为 `772cddf6be63b100c825d7bbf1ea962e967f1324ee04efb10df6c6b2f60bbeb0`。runbook 与 round-403 已接受哈希 `07734b66d652189bd11c49ae0b87cbdccf38170e9636d27f344c1ce4629ce202` 一致。读前/后检查不使并发版本成为已接受快照；round-414 追踪增量须在主审后另整合。
- 不复制凭据、任务记录、调度快照、Owner receipt、运行现场、node_modules、dist、.tmp 或 .codegraph。本机 ignored package-lock.json 不在 Git 基线或候选中；已有构建的依赖安装不由本次重现。
- 本地 origin/master 为 `8f396c1b809c43320aad9c4c43eb05c9cf2a3c58`，比基线多 29 提交，44 条选择路径重叠。补丁在临时基线索引适用，在临时 origin 索引不适用；这只是冲突风险定位，未执行 merge。重点审查 frozen review batch、attempt identity、stop/continue、config lock、session/tab cleanup、存储/fixture API 的组合。
- round-410 只证明 macOS 全 Codex 冷宿主安全只读拒绝：`live-leader-unverifiable`、四阶段身份/责任/容量对照、无新 grant/request。它不是恢复接管、Owner CLOSED、员工验收、容量归还或总监完成。round-400/405/408 等失败及各自执行快照继续保留。
- 根 feature 保持 active / in_progress；平台、可恢复接管、完整 Owner 聚合及最终同步/合理合并/合并树全量回归门禁继续开放。实现与必要验证收口后，单独集成步骤再决定最终远端同步和合并，并在真实合并树执行全量回归、修复实现或夹具。本提交不关闭任何门禁。
