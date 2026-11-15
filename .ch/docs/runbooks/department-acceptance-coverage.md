# 产研部逐项验收覆盖

截至 2026-11-16 round-410 中央事实同步。根功能仍为**开发中**，[现有计划](../exec-plans/active/2026-11-13-feature-department-mode.md)保持 active / `in_progress`。本表是需求与接受证据的映射，不是新的执行计划或根验收结论。原始目标及补充 1–14 的顺序取自父任务的 `rootPrompt` / `supplementalRequirements`；报告位置由同一父记录各 `subTasks[].communicationFile` 解析，以下用轮次与子任务 ID 定位，不复制运行时身份或原始日志。

## 已接受证据索引

各行独立复用，不相加成一次全量测试；早期报告整项 failed 时，仅复用后来主审保留且未失效的具体执行事实。

| 索引 | 报告与可复用范围 | 限制与后继 |
| --- | --- | --- |
| S：来源/仓储 | round-100 `dept-repository-controller-contract-repair` 25 项、`dept-close-rebuild-regression` 5 项；round-101 `department-production-source-wiring` 的生产组合 6 项、公共 store 23 项及未变仓储等分批事实；round-102 `department-production-source-retention-repair` 的 catalog 1 项、生产来源/跨进程通信保留 7 项、仓储修正 1 项、普通通信清理 2 项。 | round-101/102 整项报告仍 failed，不能称其全部验收通过。round-103 `dept-activation-smoke-exit-repair-103` 已接受自动激活、真实 source/catalog、主进程 exit 0、owner/锁释放、无强制清理；关闭了 round-102 的隔离退出失败，未验证冷恢复。 |
| P：存储与编排后继 | 已接受 round-351 `department-fixture-persistence-boundary-settlement`：真实生产来源＋中央 composition 协作 1 项、Owner 删除 1 项、composition 17 项、runtime integration 44 项，分别通过。 | fixture 删除先持久提交再隐藏，失败仍可读；真实 Owner 删除后保留身份路由，提交故障保留原文件/marker。round-338/340/344 authority 宽 runtime 的 19 项失败经 round-347/348 中间修复后，由本轮最终真实存储/fixture边界证据结算；不称旧失败运行通过，也不冒称全库回归。 |
| C：容量/准入 | 早期已接受容量与余额合同；round-234 `department-duplicate-overflow-admission-settlement` 新准入 5 项、旧兼容 9 项、宿主/adapter 9 项分别通过；`department-group-cleanup-bounded-observation-repair` 新观察 8 项与直接旧 36 项分别通过。 | round-224 的 216/217 余额失败与宽 adapter stop/resume 挂起保留历史。round-228/232 定向余额/普通 stop→continue 事实按原范围复用；round-232 暴露的重复超额 waiter 被 round-234 明确 failed 拒绝关闭；round-351 后继 runtime suite 通过，不反写早期宽命令为通过。 |
| U：群聊/tab | 已接受 round-121 `department-modal-delivery-and-narrow-repair`：87 项相关回归、真实 macOS EH 精确组长弹窗、275px 可见 Webview、完整适用历史操作栏、关闭不 stop/cancel、焦点及非零 scrollTop 120 恢复；round-114/早期动态主题证据按未变范围复用。已接受 round-338 `department-role-tab-smoke-fixture-repair`：Chromium 1280/280、深浅主题、原 tab 名/角色 tooltip/模式/键盘焦点/运行关闭锁。 | 真实 EH 是历史 fixture；Chromium 是生成页面＋受控 bridge，不是 CLI 执行。两类证据不互换；没有 UI 源码变化时，不再笼统重开全部主题/窄屏门禁。 |
| M：模式开关/权限 | round-332 `department-mode-settings-boundary-repair` 的设置页 1280/280 Chromium、默认值/警告/键盘/保存门禁和分批定向结果；后继 round-338/340/344 的创建权限事实及 P 的 runtime 修复。 | round-332 整项失败及旧 tab 文案失败保留；tab fixture 由 U 的 round-338 后继接受。新建入口异步复核与可信内部组长派发不同，旧任务继续不被模式开关禁用。权限报告不替代真实生产树证据。 |
| E：真实 Codex 生产场景 | 已接受 round-350 `department-leader-lifecycle-public-eh-repair`：macOS 安装版 EH、Codex 0.167.2 binary、真实 worker/parser/仓储/原 Owner；新建两模块、四原完整 receipt、自然清理、容量归还后合法再派发。round-366 `department-resumed-director-lifecycle-wakeup-repair`：28 项 composition、5 项组织回归及公开 stop→continue EH 完整通过；六原 receipt、三代 CLOSED、总监后续派发/最终汇报。 | 本机确定性 Responses provider；是真实 binary 与限定生产生命周期证据，不是远程模型质量或所有 CLI/平台保证。round-353/359/362/364 竞态/冲突/唤醒失败保持历史；round-357 首 await 前可撤销 token 的 20 项分批证据继续有效。 |
| O：OpenCode 分层证据 | round-378 限定公开 stop→continue 执行事实及其整项当时未过主审的历史均保留。已接受 round-382 后继修复：有界 256 项精确 source/target 链头，逐次核对完整身份、原 client、binding/selection、canonical directory、required receipt、原 stopped、持久员工容量移除；未知 target 不推进，旧来源不回退，竞争/迟到/来源漂移拒绝。自身恢复仅排除当前精确 running/open target；leader 跨代仍需整组 CLOSED 与容量归还，同代员工无新增整组屏障。证据为实体标准 build 与 26 个不同定向用例及代码合同主审，未运行连续公开 EH。 | round-382 Codex-only cold EH 因 Playwright 缺失在公开 UI 发送前失败，无生产任务/binding/Owner/第二 EH 观察；running leader 冷宿主缺原 producer provenance/完整聚合仍 fail closed 并保留容量。必要平台及真实连续续接 EH 仍开放；round-366 Codex 公开 stop→continue 和 round-378 一次限定 OpenCode 场景不互相扩展。本机 provider、平台和旧失败属性按原报告保留。 |
| D：默认模型 | 已接受 round-372 `department-opencode-default-model-snapshot-repair`：26 项分批定向检查及混合公开新建 EH；UI/持久 null 不变，新根固化同档案具体模型，配置/目标/保存屏障漂移拒绝。round-375 另通过三角色全 OpenCode 默认模型公开新建 EH。 | round-372 EH 使用较早 Owner 快照，不证明最新 finalizing Owner；总监/员工默认的直接接线检查与公开 EH 范围分别按原报告记录。round-369 首次默认模型失败及 round-375 整项 attempt failed 历史均保留，不覆盖后续接受的具体执行结果。 |
| F：原 Owner 清理观察 | 已接受 round-372 `department-owner-finalizing-observation-repair`：最终 Owner/facade 27 项及未变 client/verifier 17 项分批有效；`department-employee-root-capability-capture-repair` 最终新增 4 项及未变范围复用。 | 非一次 44 项最终运行；没有重放真实 EH。根能力在 realpath/assert 前捕获原 assert/dispose，核验异常沿原 dispose；清理失败保留根/配置租约/责任容量。finalizing 不是 receipt 或容量凭证。 |
| G：全 OpenCode 默认模型公开新建 | round-375 `department-opencode-attach-output-full-eh-repair` 的最终标准构建、137 个不同用例和三角色全 OpenCode 默认模型公开 EH 新建场景已由后继主审接受；具体含两模块、四原 Owner 完整 required receipt、员工 stopped、两个精确 CLOSED、首次 grant 前持久身份/binding 回读、容量持久归还后第二实际派发及总监最终汇报。 | round-375 整项 attempt 当时的 failed 历史保留；只复用其最终场景执行事实，managed-main 缺口由 round-376 修复。macOS 安装版 EH 使用本机确定性 Responses fixture，不证明远程模型质量、跨代续接、冷恢复或其它平台。各快照及分批结果仍按原报告，不合算为一次全量运行。 |
| H：managed-main OpenCode 工具交互 | round-376 `department-managed-main-permission-activity-repair`：最终实体标准构建、72 个不同用例及 headless 生产 one-shot host＋实际 preparer/template/helper/monitor＋安装版 OpenCode 1.19.5 的真实工具交互通过。 | 原 `--auto` 下仅精确当前消息和核验子会话的 ask 回应 once；显式 deny 保留，question/plan 拒绝。真实关联父活动才解除 60 秒启动期限，无活动仍超时，总预算 120 秒。agent 双写法传递并核验，model/variant 原优先级不变，API 无法表达的参数拒绝。有界事件/关联表；最终输出来自原同步响应完整核验，无 DB 历史拼接/决策重放。配置 attach、非 main、独立 Owner stream 不被替换。此项不是新公开 EH 或 Department Owner/容量证明。 |
| I历史：round-400 连续 EH、round-400 observer 与 round-403/405/408 CDP/cold | `department-successive-full-eh-integration` 的原 macOS 安装版 OpenCode 1.19.5 同宿主公开执行完成两次 stop/continue 的 A→B→C、C 验收、第二模块及总监汇报；原始执行事实含 8 个唯一 Owner、4 个精确 CLOSED 和 4 个员工完整原凭证。修正角色后对原报告/协议/receipt/只读 native DB 的 mixed/successive/native 只读审计 3 项通过。round-405 冷 observer 使用生产 API 对象并按真实 root 面板关联，11 个不同定向用例与实体标准 build 通过；唯一 cold 已证明公开 stop 消息送达并记录生产 warning。round-408 冷 stop 路由修复经实体标准 build 与33个不同定向 composition 用例，唯一真实 cold 再次证明 stop 消息送达。 | round-400 原机器 `result=failed` 与整体主审 failed 保留；三项离线审计不构成新 EH pass，且 observer 最终源码与执行快照不同。round-403 harness 自有 CDP 清理失败传播/迟到 detach 门禁及定向回归已接受，仅证明 harness 资源门禁；其 cold 整体仍 failed。round-405 实际 warning `invalid-recovery` 保留为该轮历史；round-408 实际 warning 为 `unverified-leader-session-or-plan`，仍非目标 `live-leader-unverifiable`，且缺完整 afterControl、四阶段身份和无新 grant/request 对照，cold 整体主审仍 failed。CDP `confirmed=true` 后第二 EH 自行 exit 1、`forcedTeardown=false`，仅证明 `settleColdPublicControl` 失败等待分支结束，不是场景成功、Owner 清理或容量释放；round-405 的强制回收及当时最终 driver 未运行不改写。round-408 执行时的源码/只读诊断指向 `inspectLeaderSession` 冷 tab/session 关联边界，未直接捕获实际私有 tab 分支；身份边界修复在该时点仍待审，round-410 后继修复及限定冷安全拒绝场景已通过主审，详见 I410。round-403 macOS owner-core 58/58 仍仅原固定入口范围，后代追踪与整树关闭未确认；必要平台、未覆盖来源/角色、冷宿主可恢复接管与最终 Git 合理合并/合并树全量回归继续开放。各执行快照分开，不累计为闭包。 |
| I410：冷宿主身份边界与安全拒绝 | round-410 `department-cold-leader-identity-boundary-repair` 已由代码主审接受：标准 build、13 项新增持久身份回归、5 项恢复/继续与3项 composition 边界分别通过；唯一 macOS Codex 0.167.2 / VS Code 1.144.0 免费 loopback cold 场景精确送达公开 stop 并以 `live-leader-unverifiable` 拒绝，完整四阶段身份/selection/requirements/方案档案/session/attempt、责任全集及保留容量对照一致，无新 grant/责任或 provider 请求重播，两 EH 自然 exit 0、CDP 无诊断且无强制回收。 | 这只证明冷宿主安全只读拒绝；reader 不生成 target/live/provenance、不建 tab、不写盘。原 leader endpoint unknown/unreachable，employee 仍 live、责任 open，原 binding 和容量保留；不证明接管、Owner receipt/CLOSED、员工验收或容量归还。round-405/408 warning 与失败、round-400 successive 原 driver failed及三项离线审计均按各自快照保留，互不合并。round-410 build/test分批检查不累计为一次全量运行。 |

## 原始目标

本表 O/I 项保留 round-378、round-400、round-405、round-408 的失败历史及 round-382/403 后继接受事实，并分别记录 round-410 冷安全拒绝。round-400 successive OpenCode 具体执行与离线审计不改变原 failed driver；round-382 冷 EH 在公开 UI 发送前因 Playwright 缺失失败；round-400 cold EH 止于 target discovery 并强制回收；round-403 cold 整体失败且无 stop 送达证据。round-405 的 `invalid-recovery`、round-408 的 `unverified-leader-session-or-plan`、缺失对照及各自整体失败仍仅是其历史快照。round-410 只读身份核验后 cold 场景通过安全拒绝对照，精确命中 `live-leader-unverifiable`，完整四阶段身份/责任/容量不变且无新 grant/request；不合并不同源码快照，也不证明可恢复接管、Owner 清理或容量归还。round-403 macOS owner-core 58/58 只覆盖原固定入口，后代追踪及整树关闭未确认，不代表跨平台或整树验收。

| 要求 | 当前实现入口与接受范围 | 真正剩余范围 |
| --- | --- | --- |
| R1：Loop、Loop+ 外新增总监→组长→员工；三角色 AI/模型/力度，总监沿当前 CLI 档案，其余可跨 CLI | `src/department.ts`、`src/departmentConfiguration.ts`、`src/extensionHost/departmentConfigurationHost.ts`、`src/extensionHost/modelSettings.ts`；配置 scope/保存屏障及 M/D，E/O/G 验证相应实际角色路由。 | OpenCode 三角色默认模型公开新建已有 G 的限定接受证据；OpenCode 跨代续接/冷恢复仍开放，其它 CLI 能力按实际支持与配置检测，不能从 Codex/OpenCode 推断通用所有权。 |
| R2：总监经典 Loop 派粗任务，真实 Loop+ 组长拆分并验收，员工交付；总监仅协调/依据汇报确认结束 | `departmentruntimecomposition.ts`、`departmentorchestration.ts`、`LoopPlusRuntimeAdapter`、`loopOrchestration.ts`（均在 `src/extensionHost/`）；P/E/O 已覆盖真实 scheduler/事件验收、两模块与总监最终汇报。 | E/O 之外的角色/恢复组合；总监不增加代码/测试验收，不能把单次组长返回、tracker 清零当完成。 |
| R3：系统 AI 任务设置默认 4 组长/20 员工，可持续分派 | `src/toolSettings.ts`、`src/departmentcapacity.ts`、组织 host；C 的原子准入/共享余额、E/O/G 的清理后实际再次派发证据。 | G 覆盖的是 macOS 全 OpenCode 默认模型新建两模块场景，不是跨代恢复或全部支持平台；不是累计最多成员，也不是每组 20。 |
| R4：层级群聊、独立组长 Loop+，总监可打开组长界面、tab 可识别 | `src/extensionHost/departmentGroupChatProjection.ts`、`loopGroupChatPanelCoordinator.ts`、`departmentConversationTabs.ts` 及 `src/webview/departmentGroupChatModal.ts`；U 的真实展示与浏览器证据。 | 运行态全角色公开流程的未覆盖操作按场景核对，已有主题/窄屏/历史弹窗证据不重开。 |

## 全部 14 项补充要求

| 编号与原意 | 实现入口、已接受证据 | 剩余事项/解释 |
| --- | --- | --- |
| 1：组长随时请求总监通知另一组协作，相当于目标 Loop+ 补充需求 | 组织 host 的 collaboration/补充队列、composition 总监中转；P 的真实仓储跨组投递、持久回执与幂等，加既有运行中唤醒合同。 | 不是结束总结；根完成须无未投递/未处理协作。未扩为所有 CLI 恢复场景。 |
| 2：限制同时运行，完成释放；全部门共享 20 员工 | 容量 pool、host、`departmentproductioncleanup.ts`；C/E/O/G。G 的 round-375 三角色全 OpenCode 默认模型公开新建场景含完整 Owner receipts、精确 CLOSED 集合、容量持久归还后第二次实际派发及总监汇报。 | 所有实际员工含超额均计占用，等待不算执行；原资源完整清理、集合冷读和持久移除后才 release，未知保留。G 仅限该 macOS/本机确定性 provider/新建快照；跨代公开继续、冷恢复、必要平台及最终合并回归仍开放。 |
| 3：尽量封装复用 Loop+ 等已有能力 | composition 注入同一 adapter/scheduler、验收器、runner；P/E/O。 | 不另造组长调度器；真实支持的 CLI/恢复边界保留。 |
| 4：产研部统一配置一次验收方案，各组一致 | `departmentConfiguration.ts`、组织 host、任务 store 根快照、adapter；P/E/O 均核对根继承/成员不可覆盖。 | 总监不承担验收；用户没要求任意运行时变更所有已固化方案，不新增该门禁。 |
| 5：总监页面内弹窗打开组长群聊 | `loopGroupChatPanelCoordinator.ts`、Webview 内嵌 bridge；U。 | 精确 task/instance 授权，关闭只关闭展示、不停任务，焦点/阅读位置证据已有。 |
| 6：👴🏻/👨🏻/👶🏻 表示总监/组长/员工 | `departmentConversationTabs.ts`、`src/sessionTabs.ts`；U。 | 只作展示投影，不授予组织权限。 |
| 7：组长弹窗有 Loop+ 同排完整操作栏，总监群聊单独设计 | 群聊 projection/host/panel 复用 Loop+ 操作与状态；U 的真实历史适用操作栏、原动态主题合同。 | 历史终态不显示不适用动作不等于缺操作；运行态全角色操作不由历史 fixture证明。 |
| 8：员工余额为 0 时每组最多再派一个，避免干等 | `DepartmentCapacityPool.tryAcquireEmployeeWithOverflow` → host `acquireAttemptExecution` → adapter finish；C。 | 同组已有未释放超额时不同新 attempt 立即 failed 拒绝，无新 waiter/资源；held/pending 完整身份幂等；取消是 stopped，不与 failed 混写。 |
| 9：每次派发先知道当前余额 | adapter/prompt builder 当前 snapshot，host 启动原子重判；C，P 的后继 runtime 回归。 | 参考余额不预留；未知明确未知，不能合成 0/20；并发消耗后实际启动仍核对。 |
| 10：tab 保持原名（如 codex2），只加图标 | 宿主会话投影、原 session store，U 的真实持久原名及浏览器检查。 | 完整层级/身份放 tooltip，不能追加角色、模块或编号。 |
| 11：全部做完测完后同步 Git、合理合并，再全量回归并修复问题/夹具 | 根计划与最终集成流程。 | **用户明确未完成门禁**：尚未做最终 Git 同步/合理合并及合并后全量回归；单项旧结果不能代替。 |
| 12：工具设置-常规配置中三模式可开关，默认 Loop/Loop+ 开、产研部关 | `src/modeAvailability.ts`、`src/toolSettings.ts`、宿主新建/定时入口及配置页面；M，E/O/D 公开工具设置路径。 | 已有任务继续、可信组长内部 Loop+ 不受公共新建开关误伤；异步配置之后还须复核。 |
| 13：产研部提示本机需支持并行 20 多个 CLI 的性能 | 设置卡片/角色区警告及 M 的桌面/280px 可见性。 | 是产品警告要求，不新增实测 20 多付费模型或所有硬件性能达标的验收要求。 |
| 14：尽量多任务并推进，无需等所有验收修复 | 根任务并行 subtask/责任分配及本表按独立报告复用证据；round-400 的 driver 与被动 observer 事实分别记录，不等待一个报告修复后才记录另一份已审查结论。 | 并行推进不跳过各自验收；本批 successive driver 仍 failed，后续修复需重新审查，最终 Git 同步/合理合并及合并树全量回归仍是明确门禁。 |

表中 `src/extensionHost/` 下的无前缀文件名均指该目录；精确导航与路径见[中央设计](../design-docs/department-mode.md)、[来源设计](../design-docs/department-owned-source.md)和[生产接线设计](../design-docs/department-production-execution-wiring.md)。

## 所有权、恢复与最终收口

生产来源已装配，不能仍称 null/未接线：`extension.ts#getDepartmentOwnershipIndex` → `createDepartmentProductionTaskStore` → `DepartmentOwnedSourceController` / `DepartmentOwnedTaskRepository` → identity catalog / 普通 store router。公共 update/append/rebind/delete/retention 走受控事务，部门 import/restore/legacy migration 未支持时写前拒绝；catalog 墓碑保护删除身份，无 source 的另一进程也不能将部门身份当普通任务或删除其通信。S/P 已覆盖这些限定路径、真实磁盘协作/删除、事务故障、close 后拒绝和正常宿主退出。旧 lifecycle host 的拒绝不证明当前 extension 未装配，也不因一个来源创建成功就证明全部 writer。

尚无接受证据的是旧版本或直接外部写者的**协调交接**、未知 marker/损坏 catalog 的显式恢复及跨宿主重建权限。`revokeBeforeExternalChange` 必须先撤销读取/写入准入，未证实写者静止则 close 保留 marker；当前不支持的路径明确拒绝，不把“允许这些写者运行”作为原始用户新要求。最小后续是对拟支持的具体 writer 证明同步撤销/排空/持久发布，再验证真实宿主冷启动，不能用 watcher、PID、年龄或恒真租约补授权。

`finalizing` 协议 v1 严格仅 `status/identity/claimGeneration`、无 receipt。仅原 Server 仍持精确 entry/handle、terminal/drain 已核验且正在原 cleanup，内存与持久 live identity/revision/claim/requirements 一致才可返回；原 client 对 live/finalizing 串行沿用 250ms→5s 退避，unknown/conflict/失联/坏证据立即拒绝。该状态不缓存成功、不释放容量、不 spawn、不递增 handoff claim；close 拒绝且保留锁。员工 done 必须原完整 required receipt **及**原 stopped。tracker/token 只证明活跃编排责任，不证明 native drain、receipt、CLOSED 或容量。F 是定向 Owner/facade 证据，D 的旧 Owner EH 不能替代其真实组合核验。

剩余收口按性质区分：

- **用户要求的最终实现/验证**：全 OpenCode 默认模型公开新建 EH 已由 round-375 的具体最终场景执行事实和 round-376 后继修复审查接受，不再列为待验收。round-378 整项未通过主审及其一次限定 OpenCode 公开 stop→continue 执行事实均作为历史保留；round-382 已接受修复 A→B→C reservation 阻断和自身新 attempt 来源识别问题，证据为实体标准 build、26 个不同定向用例及代码合同主审。round-400 后续 macOS/OpenCode 1.19.5 连续两次公开 stop/continue 实际到达 A→B→C、8 个 Owner/4 个 CLOSED、C 验收、第二模块及总监汇报；但原机器 driver 报告仍 failed，修正后 3 项离线只读审计通过，不是当前全 driver 单次 passed。并发 observer 最终源码与该 EH 快照不同。round-410 已接受 macOS 全 Codex cold 场景的公开 stop、安全 warning `live-leader-unverifiable`、完整四阶段身份/责任/保留容量及无新 grant/request 对照；不再将这项安全拒绝验证列为缺失。可执行 target、完整原 Owner 聚合和可恢复接管仍须分别证明；本次只读 reader 不生成执行能力，unknown/unreachable leader、live employee、open responsibility、原 binding 与容量继续保留。其它未覆盖 CLI/平台组合按实际支持入口及必要平台范围核对，不将本轮 macOS Codex 结果外推。最终 Git 同步、合理合并及合并树全量回归仍是用户明确门禁。
- **已约定恢复/所有权合同**：同宿主 round-378 移动保留原 `ses_ID`，以原 API 冷读源目录、移动后核对新 canonical directory/project/session，只有跨组长代次要求完整原组闭包；同代员工只需原 attempt 清理。round-382 代码修复合同继续有效。round-400 连续公开执行到达上述实际闭包和只读审计，但因原始 driver result failed 且 observer/driver 快照不同，不视为连续公开 EH 全链最终验收。round-405/408 被动 observer、warning 和缺失冷对照按 I 行保留为历史。round-410 已取得完整四阶段身份/责任/保留容量及无新 grant/request 对照，并实际命中 `live-leader-unverifiable`；这只验证安全拒绝，冷宿主没有可执行 target/完整 Owner aggregate 时仍保留容量。Codex round-366 已通过范围不重复列为缺口。
- **验证范围限制**：现有真实场景为 macOS arm64、已记录 CLI/VS Code 版本和本机确定性免费 provider；必要受支持平台的进程/tab/根清理差异仍需收口。远程付费模型质量、无限平台/provider 组合不是新增用户门禁。U 已验证的主题/窄屏范围复用，后续仅核对受 UI 改动实际影响的部分。
- **用户明确最终门禁**：完成实现与验证后，由根任务统一同步 Git、合理合并；对合并树做全量回归并修复生产或夹具问题。历史失败、平台属性及各快照限制保留，最终审查不能以本表代替。
