# Round 416 三方语义整合审查

基线 `f5b5ac57e4b9f956abdb29f82cf8e50d345c2b95` 是两个实际父提交的共同祖先。候选父 `c53f9defc811e5fddcf87e2d052ab0c6069c3087` 保持不变，另一父为执行前已有本地 `origin/master` 的 `8f396c1b809c43320aad9c4c43eb05c9cf2a3c58`，未访问远端。Git 真正报告 11 路径、32 冲突块；44 路径双方有修改，其中 33 路径自动合并。旧补丁 15 处不适用不是此次冲突数量。

| 真实冲突路径 | 保留与解决依据 |
| --- | --- |
| `.ch/docs/product-specs/FEATURE_INVENTORY.md` | 部门交付历史与 origin 巡检/显式继续条目并列，保留历史失败边界。 |
| `src/extension.ts` | 合并部门身份读取、组织控制、真实 Owner transport 与 origin 准备取消、活动检测、attempt 身份、配置锁释放诊断、准备完成状态。保留抽取的 parallel runtime 单一定义，将 origin 的停止 attempt 身份写入该实际实现，未重复复制已抽取函数。 |
| `src/extensionHost/loopGroupChatPanelCoordinator.ts` | 保留部门 modal 实例绑定、AsyncLocalStorage/Proxy 跨 await 授权、原根/组长路由；加入 origin 显式继续和提问排队状态。继续保留 `completeDepartment`，同时导出 `handleMessage`。 |
| `src/extensionHost/loopPlusRuntimeAdapter.ts` | 准入前不建资源，部门明确拒绝为未启动 failed；真实 native main 无普通执行回退。普通准备取消/失联观察、完成身份、预绑定关闭与部门终止观察/完整清理/隔离失败共存。普通 Tab 在报告及压缩确认后关闭；部门必须先由 Owner 完整清理才能释放容量。部门租约不会因普通 tab 活动探针为 false 而被巡检提前释放。 |
| `src/extensionHost/promptInteractiveRuntime.ts` | origin 准备失效检查与候选冻结 executionProfile 模型选择并存，不退回当前 UI 模型。 |
| `src/promptRunState.ts` | 同时规范化 departmentConfiguration 与 loopAttemptId，保留 legacy 无身份记录可读。 |
| `src/test/extensionHost/fixtures/loopPlusRuntimeFixture.ts` | 合并 beforeRun/preparation failure/activity 端口与单一注入持久层、删除先提交、墓碑、无 Map fallback、独立 Owner 终止观察。模拟 transport 保留 beforePromptStart/runPromptOverride；未接触用户任务。 |
| `src/test/extensionHost/loopPlusOrchestration.test.ts` | 两方新增 suite 均保留。冻结批次让 beta 失败 review 后才能验证 repairSource；不把后到事件纳入已发请求。same-id 拒绝测试给出完整 reviews/subtaskIds，再验证调度拒绝不改运行中元数据。 |
| `src/test/extensionHost/loopPlusRuntimeIntegration.test.ts` | 保留持久化/模式授权/Codex binding 回归及 origin 动态额度、压缩、失联进程回归，分别闭合测试作用域。 |
| `src/test/extensionHost/promptInteractiveRuntime.test.ts` | 两方 import 与测试保留，冻结模型及 ownership 测试均编译。 |
| `src/test/session/sessionTabCliSwitch.test.ts` | 部门身份读端口与 origin 新 Tab start 事件端口均保留。 |

附带修复仅在新 worktree：`promptParallelRuntime.ts` 的停止记录传播 loopAttemptId；`departmentGroupChatHost.test.ts` 提供新增 recordPromptHistory fixture 端口；`loopPlusRuntimeAdmission.test.ts` 更新普通 Tab 的报告/压缩确认时机，并新增 Owner 收尾期间活动探针为 false 仍保留容量测试；`looppluswebviewintegration.test.ts` VM 夹具加载真实部门 presentation 与 origin 渲染失败/loading 辅助函数。没有更改生产布局、颜色或交互设计。

首轮行为失败还发现执行错误被清理/租约失败覆盖。适配器现保留执行、目录清理、租约释放的全部诊断；普通清理失败维持记录/日志语义，部门清理失败维持 quarantine，不把业务结果或 runPrompt settle 当作 Owner 关闭证明。

## 自动合并仍有共享合同风险

完整 33 路径清单见 `overlap-review.json.automatic_overlap_paths`。下面是审查分组，表示本轮静态语义审查及最小回归范围，不代表最终全量验收。

| 路径/组 | 合同与本轮证据 | 尚待最终整合 |
| --- | --- | --- |
| `sharedRuntimeConfig.ts` | 两方配置身份/锁保留；origin 增加跨进程超时诊断及有界后台释放重试。sharedRuntimeConfig 单测通过。配置租约与部门容量租约为不同责任，后者仍要求 Owner 关闭。 | 真实多宿主/跨平台锁与故障环境。 |
| `loopOrchestration.ts`, `loopPlusDecisionStrategies.ts`, `loopPlusOrchestration.ts`, `loopPlusPromptBuilders.ts`, `loopPlusDecision.ts` | 真实 Loop/Loop+ 复用、事件驱动，无批次屏障/共享轮次门槛。请求冻结当前完整 FIFO 验收批次，后到事件留到下次；执行结束不等于 passed。repairSource 只从宿主已确认 failed review 生成并持久回读后派发，模型伪造/失败写入回归通过。实时派发额度与部门共享池双层约束保留。 | 真实部门多组并行、跨组协作及合并树全量回归；冻结批次不等于组织同步屏障。 |
| `promptOneShotRuntime.ts`, `promptParallelRuntime.ts`, `promptRunRuntime.ts`, `promptRunTypes.ts`, `sessionTabs.ts`, `sessionMessageActions.ts`, `sessionMessageHandlers.ts` | 保留 candidate 抽取、真实 runner/core、身份路由与 origin attempt/停止/显式继续、预绑定 Tab 关闭。parallel、interactive、会话 Tab 最小回归通过。 | 不能将 ordinary `runtimeInterrupted` 恢复或巡检当成部门冷 Owner 接管；round-410 安全拒绝仍有效。 |
| `loopTaskStore.ts`, `panelStateBuilder.ts` | store 相对候选仅加入 runtimeInterrupted 类型/规范化；受控 router、身份目录、墓碑及失败无普通路径回退未被替换；departmentruntimestore/identity catalog 通过。fixture 注入持久层失败与删除回归通过。 | 真正持久介质/跨宿主并发和最终平台增量。 |
| `i18n.ts`, `webview/loopGroupChatPanel*.ts`, `webview/types.ts`, `webview/viewContentHtml.ts`, `webview/viewContentScript/{coreRuntimeState,messageRendering,settingsAndOverlays}.ts`, `webview/viewContentStrings.ts` | 保留主题语义、部门 modal、原名角色图标、窄屏样式和三模式开/开/关与性能警告；兼容 origin 等待指示和对话加载。75 项相关渲染/静态/VM 检查通过。 | 无新浏览器/真实 EH 视觉证据；不要把静态/VM 通过当作真实 UI 验收。 |
| `loopPlusEntryRouting.test.ts`, `loopPlusPromptBuilders.test.ts`, `loopGroupChatPanel.test.ts`, `sessionMessageActions.test.ts` | 两方自动合并后的测试依赖编译；其中 panel 本轮执行，其余仅继承父证据，未为了刷新而重跑。 | 后续合并树全量测试须覆盖所有自动合并输入。 |
| `.ch/docs/design-docs/loop-subtask-session-reuse.md`, `.ch/docs/ontology/domains/cli-plugin-runtime.json`, `ARCHITECTURE.md` | 两方文档共存，三个归属未定 ontology source_refs 对象逐项仍等于候选/基线，未读取共享原件。 | 安装/ZCode 三处引用修改继续待归属复核。 |

## 证据及剩余门禁

本目录是新树证据；`department-round414/` 的 11 份材料逐字节不变，仍仅证明旧候选。旧源码与 round-410 构建对应、历史 CLI/EH/失败记录继续按各自快照范围复用，不证明新树已通过旧全量门禁。

平台三路径逐字节保持 round-403 接受版本，哈希见 `preserved-materials.json`；没有读取/拷贝共享并发平台字节。平台后续增量必须单独审查合入。未纳入凭据、运行私有数据、临时执行现场、本机索引、dist 或 node_modules；依赖仅通过未提交的临时符号链接使用现有安装，不声明安装可重现。

保留所有首错日志和后续结果，命令/覆盖/跳过项见 `checks.md`。本轮没有 fetch/pull/push/发布、旧 EH/真实 CLI 或全量测试。根 feature 保持 active/in_progress，平台、最终同步/合理合并和真实合并树全量回归门禁继续开放。
