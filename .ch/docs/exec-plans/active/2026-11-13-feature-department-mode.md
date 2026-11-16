# 产研部三层协作模式

- 日期：2026-11-13
- 类型：feature
- 关联计划：无；本文件承接整个产研部 feature，所属测试、设置、群聊和文档工作不另建 test/chore/docs 计划。
- 状态：in_progress
- 负责人：协作
- owner：产研部根 feature 集成负责人；本轮文档尝试维护规格与交接
- claimed_at：2026-11-13
- claim_ttl：下一次根 feature 集成前重新核对
- handoff_to：未知外部来源交接/损坏恢复与真实冷宿主验证、OpenCode 原会话跨代目录续接/公开继续、必要平台、最终 Git 同步合理合并及合并后全量回归（Codex 公开续接见 round-366；全 OpenCode 默认模型公开新建见 round-375；managed-main 工具交互见 round-376）

## 背景

用户要求在现有 Loop、Loop+ 之外增加“产研部”，组织为总监→组长→员工。总监沿用经典 Loop 的汇报驱动职责，仅派发粗粒度工作、协调并依据组长汇报确认整体完成，不检查代码、不执行验收；组长必须是封装复用的真实 Loop+ 任务，保持全部验收门禁；员工复用已有子任务执行能力。

用户已澄清：默认同时最多 4 名组长（无例外），整个产研部共享常规 20 名员工；不是累计只能创建这些成员，也不是每组 20 名。新增零余额规则为每位组长最多同时持有一个未释放的超额员工；全部真实员工均计入占用，实际结束且清理完成释放。每次派发决策前取得最新参考余额，未知不得伪造 0/20，真实启动由宿主原子重判，参考快照不预留名额。组长运行中可以请求其他组长配合，由总监及时向对应 Loop+ 添加补充需求，不能等所有组长结束才处理或只在总结中记录。

用户决定：验收方案在产研部根层统一配置一次，所有组长继承同一根任务方案快照，不逐组配置、不得独立覆盖，不增加总监验收职责。总监页在页面内弹窗打开组长群聊，不默认新增组长 Webview 标签；关闭保留总监阅读位置且不停止任务。总监、组长、员工 tab 只在原始会话名称前装饰 👴🏻、👨🏻、👶🏻 图标；不追加角色、模块或任务编号，原会话命名、编号、重命名和持久化值不变，完整身份由 tooltip 展示。

## 目标

建立可恢复的三层组织执行能力，复用现有 Loop/Loop+ 调度、验收、配置与 CLI runner，保留旧记录兼容性。稳定需求与接口边界见[产研部设计规格](../../design-docs/department-mode.md)。本轮文档交付不等于根功能实现或发布。

## 范围

已有独立交付涵盖组织元信息/容量池、人数设置、模式及三角色配置、实时余额提示、组织 host/Loop+ 适配、统一根方案继承、总监中转协作、全树生命周期端口、群聊展示/授权及生产归属索引。round-26 中央 composition 已装配；当前 `extension.ts#getDepartmentOwnershipIndex` 实际经 `createDepartmentProductionTaskStore` 挂载 Controller/Repository、identity catalog 和普通 store 路由，round-101/102 的限定执行事实按后继审查复用（两份整项失败保留）；round-100/103/351 分别接受接口、正常退出及真实存储/删除/后继 runtime 回归。仍需验证全部直接/旧版/外部写者、跨进程生命周期和真实冷宿主，不将其描述成来源模块完全未装配。受限角色/代次的 Owner 与真实 EH 证据也不能替代完整根验收。

仍需核实拟支持来源写者的可信交接/损坏恢复与真实冷宿主，完成 OpenCode 原会话跨代目录续接/公开继续、必要平台及最终合并回归。round-350 macOS 安装版 EH 使用真实 Codex 0.167.2 binary、worker/parser/仓储和原 Owner，通过本机确定性 Responses fixture 完成公开新建场景；不证明远程模型质量、全部 CLI 或跨平台。round-357 的 20 个不同 composition 用例证明 prepareRoutes 首个 await 前 token 登记、stop/dispose 撤销、重复续接拒绝及迟到 finally 隔离。round-359 successor binding 冲突失败保留历史；round-366 后续公开 Codex stop→continue EH 已通过完整续接、六原 Owner receipt、三代 CLOSED、容量归还、总监再派发和最终汇报。round-372 finalizing/root capability/default-model 均有独立接受范围。round-375 三角色全 OpenCode 默认模型公开新建及 round-376 managed-main 工具交互已按各自范围接受；后者不是新 EH/Owner/容量证据。OpenCode leader validator/parallel consumer 的定向检查不证明跨代续接。tracker/token 仅表示编排/准备责任，不是 native drain/receipt/CLOSED/容量证明；三角色 tab 与历史弹窗也只按其原报告范围复用。

## 非目标

- 不复制 Loop+ 调度器、验收器或 CLI runner，不让模型直接编辑任务 JSON、快照或资源计数。
- 不将总监变为代码/测试验收者，不把组长降为一次普通子调用。
- 不承诺多个 VS Code 扩展宿主共享同一额度；本阶段以单宿主管理同一部门为边界，多宿主语义另行核实。
- 本轮只同步文档及已核对实现合同的 ontology，不改运行态、任务记录或主通信，不发布，不把未装配设计登记成当前运行保证。

## 验收标准

- [ ] 模式入口独立于 Loop/Loop+；总监使用当前 CLI 分组的模型和思考力度，组长、员工可各自选择 CLI、档案、模型及对应思考力度，端到端保持角色快照。
- [ ] 根任务与每个组长有独立任务 ID、会话归属和可恢复绑定；旧任务缺少部门元信息时仍按原 Loop/Loop+ 读取、执行、展示。
- [ ] 默认同时最多 4 名组长且没有例外；全部门共享常规 20 名员工，余额 = max(0, 常规额度 - 实际占用)，全部真实员工包含超额均计入占用。零余额时每位组长最多持有一个尚未释放的超额员工，不同组长分别受限；等待不占执行额度，实际结束且清理完成释放。
- [ ] 每次组长决策取得最新参考快照，未知明确未知、不得伪造 0/20；模型看到的余额不预留名额，真实启动原子重判常规/超额资格。超额有部门/组长/attempt 归属与恢复标记；重复派发、停止请求、恢复、扩容或余额回正不能抹去仍运行租约。降低额度不强杀存量，常规准入不足时只允许上述有限例外；失败、取消、重复/迟到回调及跨部门访问不能造成越界启动或租约泄漏。
- [ ] 组长为真实 Loop+，全部验收门禁通过才算完成；总监不验收代码/测试；存在活跃或未处理组长、未投递/未处理协作及补充需求时不能整体结束。
- [ ] 产研部层统一配置一次验收方案，全部组长继承同一根任务方案快照、不逐组配置或独立覆盖；复用既有方案存储/选择/快照，模板后续编辑不隐式改变运行任务。若支持运行时修改，必须根层明确更新并由宿主统一同步，禁止新建/既有/恢复组长方案漂移，不一致或失败时阻止验收和整体完成；不增加总监验收职责。
- [ ] 协作运行中投递到同部门目标 Loop+，带来源、目标及去重 ID；不可用目标反馈可观察，重试不重复投递，不允许任意跨任务访问。
- [ ] 复用现有中文、VS Code 主题、工具栏和窄屏抽屉；成员树为总监→按模块/交付目标命名组长→所属员工。总监页以页面内弹窗打开组长群聊，复用群聊展示/操作并绑定正确组长，保留完整同排 Loop+ 操作栏，不默认新增 Webview 标签；关闭不停止任务，保留总监阅读位置，加载/错误/禁用/空态及键盘焦点进入、约束与关闭恢复可用。
- [ ] 总监群聊专门展示粗粒度分派、组长汇报、协作请求及补充需求投递状态、整体完成开放事项，保持汇报驱动的协调职责；主题修复复用 VS Code 语义色、字号、间距与现有组件，设置窄屏和余额未知态可读。
- [x] 总监 👴🏻、组长 👨🏻、员工 👶🏻 角色图标装饰实际会话 tab 原名；原编号、重命名和持久化值不变，完整层级/任务身份在 tooltip；总监/组长/员工真实会话投影通过隔离宿主场景检查。
- [ ] 设置键 `departmentMaxLeaders` / `departmentMaxEmployees` 与持久化、默认/非法值、UI 回传一致；人数设置不能替代三角色配置或运行时接线。
- [ ] 相关单测、旧模式回归、Chromium 宽窄屏与本机真实 CLI/VS Code 链路验证有各自证据和平台范围，未覆盖项显式保留。
- [ ] 规格、功能清单及经实现事实核对后的 ontology/架构同步完成；根目标完成前不归档本计划。

## 影响面

- 已核对模块：`src/department.ts`、`src/departmentcapacity.ts`、`src/departmentConfiguration.ts`、`src/extensionHost/departmentConfigurationHost.ts`、`src/extensionHost/modelSettings.ts`、`src/extensionHost/departmentorchestration.ts`、`src/extensionHost/departmentruntimestate.ts`、`src/extensionHost/loopPlusRuntimeAdapter.ts`、`src/extensionHost/loopPlusOrchestration.ts`、`src/extensionHost/loopPlusPromptBuilders.ts`、`src/loopTaskStore.ts`、`src/extensionHost/departmentOwnershipIndex.ts`、`src/extensionHost/departmentGroupChatProjection.ts`、`src/extensionHost/loopGroupChatPanelCoordinator.ts`。保留现有调度器、验收器与 CLI runner 单一实现。
- 配置已装配：`departmentMaxLeaders` / `departmentMaxEmployees`、工作区 `departmentRoleRoutesByDirectorConfig`、配置 scope/issue、角色保存屏障与新根就绪校验；启动/补充端口仍由中央可信注入，不接受浏览器最终路由。
- 文档：本计划、[设计规格](../../design-docs/department-mode.md)、[功能清单](../../product-specs/FEATURE_INVENTORY.md)、`ARCHITECTURE.md` 以及现有 ontology 域/跨域流程。群聊详细接口 [只读来源](../../design-docs/department-group-chat-ui-contract.md) 本轮不改。

## 风险与缓解

| 风险 | 缓解与交接要求 |
| --- | --- |
| 每个组长各持 20 个名额，或零余额反复加人导致无界超额 | 同一部门使用一个宿主常规员工池；每组最多一个未释放超额租约、组长无例外，超额计入实际占用；启动原子重判，等待不计执行名额。 |
| 余额过期/未知被当作预留；扩容或恢复清掉超额标记 | 决策前最新参考快照，未知明确未知；参考不预留，启动核验部门/组长/attempt，运行超额保持标记至实际结束且清理完成；扩容、余额回正不重置资格。 |
| 停止/失败先释放但旧进程仍写入；恢复重复租约 | 释放与真实执行终止确认关联；启动失败回收预留，重复释放幂等；恢复先核对存活执行与旧租约，再允许新派发。 |
| 一次组长调用返回被误认为完成 | 真实 Loop+ 的验收队列、补充需求和完成门禁为权威；总监只聚合有效结果与协调状态。 |
| 总监等待整批组长造成协作死锁 | 运行中反馈事件唤醒总监，及时将补充需求入目标 Loop+；根完成与消息入队按宿主顺序检查。 |
| 跨组访问或消息丢失/重复 | 同部门身份核验、来源/目标/去重 ID、可观察投递回执和失败；重试复用同 ID，不接受模型任意文件/session 路径。 |
| 角色配置串线与旧记录误迁移 | 明确配置快照及 session 归属；旧记录无部门信息不推断三层角色；不可用配置明确报错，不回退总监编码。 |
| 组长各自改方案或读取新模板造成验收漂移 | 根层一次确认同一快照，组长仅继承；复用普通群聊时限制单任务覆盖入口。若支持运行时修改，必须根层显式更新、宿主统一同步，未同步或失败阻止验收与根完成。 |
| 弹窗误操作别组、关闭即停止或丢失阅读/焦点 | 按组长 ID 与打开代次绑定展示/动作/异步结果，复用群聊操作；关闭仅释放展示订阅，保留总监阅读位置并恢复焦点；真实宿主验证后再标完成。 |
| 索引有结果但来源租约不可信，重复物理身份被覆盖 | 文件贡献保留歧义；唯一来源重读；外部写入公开前同步撤销来源租约，失败后显式完整重建。异步 watcher/恒真 isCurrent 不算可信装配。 |
| 恢复 blocked 仍持租约被误当作可执行 | 准入前/等待后核对当前关联、running、代次和 lease；blocked 返回未知余额并拒绝新增，保留原占用至真实结束清理核验。 |
| 工作区 ABA 或迟到保存解锁错误新根 | 宿主代次 scope、requestId、scope-local 保存屏障和 await 后重核；OpenCode 按确切档案/主角色/默认模型读 variant，Claude off 不扩大到其他 CLI。 |
| 迁移一半成功或写入 void 返回被当作成功 | 结果式写入、同步事件；迁移目标与源均确认后才返回，部分失败保留恢复材料并使索引失效。 |
| 并行改动、索引滞后导致契约漂移 | 写前重读，按接口边界合并；CodeGraph 当前有待解析引用和磁盘变更提示，不能据其缺失推断能力不存在。 |

回滚/缓解边界：新模式入口未集成前不作为可用能力发布；若后续停用新入口，仍保留已有任务记录和诊断。不能删除租约记录来冒充清理，也不能用旧 Loop 降级绕过组长验收。

## 验证计划

- round-400 中央事实同步验证：受影响 Markdown 结构/仓内链接/空白、active 文件及 `in_progress` 核对通过；更新既有 workflow 事实/source_ref 后执行 `python3 .agents/skills/ontology/scripts/search_ontology.py --validate` 和 `python3 -m unittest discover -s .agents/skills/ontology/tests -p 'test_*.py'`，9 项 ontology helper 测试通过。schema/框架未改；不运行应用 build、运行时单测、EH 或浏览器。
- 后续单元自测命令：先 `npm run build`，再按落地测试名执行 `node --test dist/test/<相关测试>.js`；具体新增文件由对应实现尝试提供。本次不执行占位命令。
- 复用边界回归入口：`node --test dist/test/loop/loopPlusScheduler.test.js dist/test/loop/loopTaskStore.test.js dist/test/extensionHost/loopPlusOrchestration.test.js dist/test/loop/loopGroupChatPanel.test.js dist/test/loop/loopPlusGroupChatPanel.test.js dist/test/core/toolSettings.test.js dist/test/core/workspaceSettingsStore.test.js`，须使用构建后的同一版本；不与会清理 dist 的构建并行运行。
- 后续重点用例：默认 4 名组长无例外、跨组共享常规 20 员工；多组同时零余额各最多一个超额、同组重复派发被阻止、超额计入占用；决策快照过期/未知不伪造或预留，启动原子重判；释放后再获例外与跨部门隔离；租约失败/取消/重复及迟到回调/停止恢复/降低额度不强杀、扩容或余额回正不抹去运行超额归属；真实组长验收失败阻止根完成；统一根方案继承、模板编辑隔离与组长覆盖拒绝，以及若支持运行时修改时的全组同步/失败恢复；运行中转发/去重/目标不可用/跨部门拒绝；旧模式无新字段；角色 CLI/档案/模型/思考力度隔离。
- 扩展验证：headless Chromium/真实 VS Code Webview 检查宽屏和实际收窄后的 Webview surface、VS Code 主题、余额已知/未知态、总监协调内容、组长弹窗完整同排 Loop+ 操作栏、页面内弹窗加载/失败/禁用/空态、动作目标、关闭不停止、阅读位置和键盘焦点恢复；本机真实 VS Code + CLI 检查根→组长 Loop+→员工、根方案传播、协作和全树停止恢复。角色 tab 只加图标并保留原名；分别记录证据的平台和边界，不能用 DOM 夹具或单平台结果宣称完整组织链路通过。

## 测试与清单同步

- round-121 补验：独立实体源码副本标准 `npm run build` exit 0；同次产物串行运行部门 panel/host 与普通群聊 panel 共 87 项通过。真实宿主新证据 `/tmp/sinitek-dept-conversation-J6j2qa/report.json`，正常 exit 0、无强制清理/进程残留/owner marker；详细命令、版本、失败中间过程和截图见本轮 round-121 报告及[验证 runbook](../../runbooks/department-conversation-verification.md)。不重跑未变主题矩阵；既有浏览器夹具结果保持其原边界。

- round-121 已审查事实：普通更新与 modal 内容共用精确同源 VS Code shell 的 `active-frame` 归属判定，opaque child 的 source/origin/channel/task/instance 与宿主授权未放宽。macOS 深色受控历史场景加载精确组长 srcdoc，核对历史状态适用的完整操作栏；一次 load/close 无 stop/cancel，原入口焦点恢复，非零 scrollTop 120→120；实际完整可见 Webview 为 275×794px，完整 tooltip 与无溢出通过。会话名/编号/重命名/持久化保持，仅加 👴🏻/👨🏻/👶🏻。主模型已复看截图，新增只读 UI 静态扫描无发现；本轮不重复。旧失败/强制回收仍属失败，不扩写为运行态操作栏、真实 EH 跨主题、模型或冷恢复通过。

- round-122 已审查事实：复用 `CodexOwnedExecution` 与 `TrustedExecutionLauncher` 的[Codex 可信 launcher](../../design-docs/department-codex-execution-launcher.md)完成一次可信快照、有界不淘汰注册、新建/精确 resume、可信持久确认及 Owner 绑定双层门闩；kind=both，streams 同时要求物理排空与 executionDrain，真实附加责任逐项释放，缺能力/失败保持未知。隔离标准 build exit 0，新增组合 33/33 与 Owner 定向 4/4 通过，受控普通 Node Owner 在启动 client 退出后持有原执行。主模型已核对交付源码与最终验证副本一致；模拟 NDJSON 和测试资源不证明生产 bootstrap、首次生产绑定、真实 Codex EOF 或生产 session/tab 释放；共享观察仍不可据此取得专属排空能力。

- 执行集合基础库已审查通过：[执行集合专题](../../design-docs/department-leader-execution-cleanup.md)固定 root/workspace/leader/module/generation，从首次原生准备前登记组长协调执行与该代全部员工 attempt；组织 binding 目标按精确 attemptId 保存同 subtask 的多个历史执行，而不改变 Owner executionSlot、identity v1、receipt index 或同 Owner 同代启动 fencing。同一 attempt 身份/策略不可替换。未绑定、准备失败、unsupported 或责任不明仍保留 null/unknown，不伪造 subtask/generation。可信 producer 关闭全部准入和迟到启动授权、排空在途责任后才持久封闭，库无默认生产 producer，completed/idle/空 Map/普通 Promise 不证明完整。绑定与责任引用原子持久化，封闭不可逆；旧 controller 省略字段保留集合，通用 write 不能创建/删除/重开/改写，已跟踪代次的旧 bindExecution 不能追加未登记身份，既有重复绑定幂等。仅当前代、含组长且逐项精确绑定的完整封闭集合验证 selection、串行复用原 OwnerClient.waitForCleanup/原 requirements/既有退避；同 subtask 的旧 attempt 仍 live/unknown 会阻止成功；完成后 cold reread 集合、代次、身份、策略和 closure fingerprint。缺失/错误/unknown/conflict/取消/变化均不成功，不启动替代 Owner、不直接读磁盘 cleaned、不释放资源或容量。单 EH 同步写者、原子 fsync+rename、单次验证及线性索引假设不变，不声称跨进程 CAS 或目录项掉电持久性。

- 该基础库直接复用已验收隔离标准构建和 106 个不同用例，六份 TypeScript 交付已由主模型确认与最终隔离构建源码一致。完整集合成功、员工 live 阻塞及取消使用真实临时 RuntimeStore 和独立普通 Node Owner；round-214 当时的 producer 是受控测试能力，不证明生产生命周期。round-224 后生产 producer、首次登记和新绑定端口已在真实 Loop+ 组合接线；round-228 随后主审并完成限定 Codex 资源释放及原 Owner receipt 生成；round-234 又在同宿主新建且完整覆盖的 Codex 路径审查生产凭证观察、集合聚合及持久移除后组长容量 release。该阶段能力不是任意 `observeLeaderCleanup` 调用均可成功，亦未覆盖 socket 收尾后 client 不可达、冷恢复或其它角色/CLI；各轮检查按原报告范围复用，不将分项证据合并或扩大。

- round-220/222/224/225 已主审，源码与范围分别见[员工准入报告](/Users/fangjiawei/.sinitek_cli/loop-communications/msg_1794556451463_c5dcb99f4e8d1/subtasks/round-220-department-employee-ledger-admission-wiring.md)、[组长原生 Owner 报告](/Users/fangjiawei/.sinitek_cli/loop-communications/msg_1794556451463_c5dcb99f4e8d1/subtasks/round-222-department-leader-native-owner.md)、[生产 producer 装配报告](/Users/fangjiawei/.sinitek_cli/loop-communications/msg_1794556451463_c5dcb99f4e8d1/subtasks/round-224-department-production-producer-loopplus-wiring.md)及[Owner fixture 诊断报告](/Users/fangjiawei/.sinitek_cli/loop-communications/msg_1794556451463_c5dcb99f4e8d1/subtasks/round-225-department-owner-fixture-startup-diagnostic-repair.md)。round-220 的 82 个不同员工用例、round-222 的多轮 Owner 25 项、round-224 的生产集成 10/10、交互 53/53、adapter 定向 12/12 及隔离标准 build、round-225 的 fixture 9 项及隔离 build，各按原报告范围复用，不累加成一次运行。round-224 模块回归 216/217 的旧余额失败已在旧产物基线复现，当时较宽 adapter stop/resume 场景挂起；历史命令不记为整套通过，后继 round-228/232 定向、round-234 准入和已接受 round-351 runtime 结果见覆盖表。

- 已审查生产接线：只在真实 CREATE 返回时记录组长新建来源；容量与成员快照持久化后、scheduler 首次 pump 前打开 Ledger；同一 producer 注入 Codex/OpenCode 员工准入，组长复用真实 Loop+ scheduler 与多轮原生 Owner。本地 `sessionId` 与原生 `executionSession` 分离；关闭时 `isCurrent` 仍校验身份、`canLaunch` 阻止迟到 grant。round-225 只修复 fixture 诊断，不能作为生产资源/容量证明。

- round-228 Codex 资源释放已主审，事实来源为[资源释放报告](/Users/fangjiawei/.sinitek_cli/loop-communications/msg_1794556451463_c5dcb99f4e8d1/subtasks/round-228-department-codex-production-resource-release.md)、[员工 bootstrap](../../design-docs/department-codex-production-bootstrap.md)及[组长原生 Owner](../../design-docs/department-leader-native-owner.md)。资源30项、adapter12项、隔离标准 build、安装版 EH tab 端口及 ontology 各复用原报告范围；固定模拟 Node CLI 不是真实 Codex binary，EH 的实际 controller/close 加受控 ownership/settings/panel 不证明完整 UI/native CLI。既有员工消费者可以消费自身成功 receipt 归还员工租约；当时封闭集合、测试直接读 ReceiptStore 及员工租约消费均不代表组长/整组容量归还，后续受限观察/消费范围见 round-234。

- round-234 已主审两个独立范围：整组观察新增8项与直接旧36项分别有效，不合称一次44项运行；重复超额新增5项、旧兼容9项和宿主/adapter定向9项分别通过，均复用原报告结果。观察实现只覆盖同宿主新建且完整覆盖的 Codex 组长/员工：producer 封闭准入并排空在途责任，原 client 私有 socket 观察全部凭证，完整封闭集合经最终冷读后，先持久移除组长租约才实际 release；失败/unknown 保留占用。阶段索引减少逐 binding 全量重复读取，共享底层责任与可移除有界订阅支持取消，不新增启动授权或磁盘 cleaned 恢复。CLI 为固定模拟 Node，round-234 不证明真实 Codex binary 或完整 EH/UI。重复超额时不同新 attempt 现在同步拒绝、不创建 waiter，并以 `failed` finish 进入既有 Loop+ 验收；held/pending 同身份幂等、旧等待 API及普通余额恢复后的常规授予保留。failed 拒绝不能与可恢复 stopped 中断混写。详情见[观察修复报告](/Users/fangjiawei/.sinitek_cli/loop-communications/msg_1794556451463_c5dcb99f4e8d1/subtasks/round-234-department-group-cleanup-bounded-observation-repair.md)及[准入结算报告](/Users/fangjiawei/.sinitek_cli/loop-communications/msg_1794556451463_c5dcb99f4e8d1/subtasks/round-234-department-duplicate-overflow-admission-settlement.md)。

- 历史结果继续按原属性保留：round-224 模块回归 216/217 的余额失败经旧产物基线对照，当时较宽 adapter stop/resume 挂起；round-234 的后续独立实体构建不依赖共享 `dist`，不把此前共享产物误构建/历史失败改写为通过。当前同组重复超额拒绝另有 round-234 通过的定向证据，普通 stop→continue 已有后继定向证据及 round-351 runtime suite，Codex 生产续接由 round-366 另行通过，不反写旧宽运行成功。

- round-320/321 真实 drain 的已审查事实：round-320/321 已验证真实 Codex 0.167.2 在 macOS arm64、本机 Responses fixture 下由两个独立执行对象完成 thread/start、同一 thread 的 thread/resume 及两轮自然 EOF、stdio/NDJSON、execution drain 和 runner 收尾，无强制回收；该证据不证明生产双持久绑定、完整 Owner receipt 或容量。详情见[真实排空验证手册](../../runbooks/department-codex-native-drain-verification.md)。本轮只读取父记录 communicationFile 定位的报告，不重跑脚本或 build。
- round-353 主审当时发现 prepareRoutes 前停止代次未固定，40 项定向与 build 不覆盖该竞态；历史失败保留。round-357 的 20 个不同 composition 用例是分批 13 项与修正后 7 项，保留中间夹具失败，不声称一次 20 项全绿运行；只证明首 await 前 token 撤销等窄范围。
- round-359 OpenCode native-session validator 8 项及接线 1 项分别通过；不再沿用旧 mapping helper 的写入职责。one-shot 源仍是零重试测试合同来源，不是 leader 当前执行消费者。
- 本轮无业务/UI 代码变更，不运行应用构建、运行时单测或浏览器，不复制运行时私有身份或原始日志。
- 已有结果按其报告范围复用：blocked 准入修复 10 项；生产索引累计 72 个不同回归（不是一次 72 项运行）；配置当前覆盖 71 项，其中最终受影响 59 项加仍有效 12 项，另有 280×960 深色 Chromium 发送交互。其私有编译、确定性 CLI/宿主夹具及 bridge 注入不能替代标准构建、真实 VS Code/CLI、冷重启或最终集成。
- 来源为父任务 `communicationFile` 指向的 round-23 blocked-admission、production-ownership-index、configuration-route-scope-repair 报告及其源码；必要沿用 round-20 生命周期、此前主题/窄屏的限定证据，不重复旧检查。本轮不为其他报告补全未声明的验证结论。
- 功能清单保持“开发中”，准确列独立模块与未集成范围；ontology/架构仅记录已有源码支撑的合同。中央/tab 后续完成须补记唯一实例、可信来源生命周期、实际根启动/恢复、协作/停止恢复及真实会话身份的验收事实。

## 任务列表

Tasklist:

- [completed] 按 execution-plan、memory-recall、ontology 与 CodeGraph 恢复相关事实来源
- [completed] 记录三层角色、4/20 常规共享额度、运行中协作及界面规格，新增开发中清单入口
- [completed] 将根层统一方案、页面内群聊弹窗及三角色图标的新决定写入待交付规格，保留实现/验证边界
- [completed] 同步每组一个零余额超额租约、最新参考余额与原子准入、总监协调展示及组长完整同排操作栏的新增规格（仅文档）
- [completed] 独立实现容量策略与实时余额提示：共享常规池、每组一个未释放超额、原子重判及恢复标记；blocked 成员初始/等待后准入封闭
- [completed] 独立实现人数设置、模式/角色配置及工作区代次隔离、保存屏障和新根就绪门禁；Claude off / OpenCode 权威路由已核对
- [completed] 独立实现真实组织 host 与 Loop+ adapter 端口、根固化方案继承、部门成员方案覆盖拒绝及组长完成门禁
- [completed] 独立实现运行中协作待处理、总监批准转发/显式处置、目标队列持久化去重回执及根完成阻塞
- [completed] 独立实现全树停止/继续与根局部恢复合同，真实观察拒绝保留占用，不隐式解封 blocked；round-357 已修复路由准备期间的撤销/重复请求窗口，round-366 后续公开 Codex stop→continue EH 完整通过。round-359 冲突失败保留历史，不外推为 OpenCode/跨代通过
- [completed] 独立实现群聊成员树、页面内组长弹窗完整操作栏、动态主题及记录/实例授权边界
- [completed] 独立实现生产文件贡献索引与存储确认/同步事件，保留重复身份和模块歧义、来源失效及显式重建
- [completed] 同步上述已验收模块事实到设计、开发中清单、现有 ontology 与架构；验证结果见本轮报告
- [in_progress] 根 feature 中央生产装配及最终组合验收；真实角色 tab 与受控历史弹窗展示已单独通过，不认证未验收的生产执行改动
- [completed] 生产来源 Controller/Repository、identity catalog、普通任务 store 路由已由 extension 装配；round-101/102 分批事实与 round-100/103/351 接受范围分别复用，旧失败不改写
- [pending] 对拟支持的旧版本/直接外部 writer 证明同步撤销/排空/发布及跨宿主交接；未知 marker/损坏 catalog 的恢复及真实冷宿主仍开放。round-103 已通过正常激活/退出，公共受控写者、catalog/保留与删除路径按 round-100/101/102/351 复用；未支持路径写前拒绝，不再列为生产未装配
- [completed] round-26 已接线中央 production composition、组织/共享容量 host、runtime store、生产根创建/启动/协调控制入口及 Loop+ adapter；完整角色与真实 EH 组合验收仍由根门禁跟进
- [completed] round-375 三角色全 OpenCode 默认模型公开新建 EH：两模块、四原 Owner 完整 required receipt、员工 stopped、两个精确 CLOSED、首次 grant 前身份/binding 持久回读、容量归还后第二次实际派发及总监最终汇报按该场景通过；round-375 整项 attempt failed 历史保留，模型使用本机确定性 Responses fixture
- [completed] round-376 managed-main 的 OpenCode headless 生产 one-shot host＋真实安装版 1.19.5 工具交互与72个不同用例通过；仅作 managed-main权限/活动/agent参数合同证据，不是新公开 EH、Owner 或容量证明
- [completed] 修复 OpenCode 同宿主 A→B→C 连续续接与自身重试来源识别：round-382 有界 256 项精确 source/target 链头，逐次核验原 client、binding/selection、canonical directory、完整 receipt、stopped 与持久员工容量移除，未知/竞争/迟到/来源变化 fail closed；实体 build、26 个不同定向用例及代码合同主审通过。未运行连续公开 EH
- [pending] 完成 OpenCode 冷宿主 running leader 的原 producer provenance/完整聚合真实 EH 验证，并覆盖必要平台与尚未覆盖的角色/CLI 恢复组合；round-382 Codex-only 冷 EH 因 Playwright 缺失在公开 UI 发送前失败，无任务/binding/Owner/第二 EH 观察。不得以 tracker 清零替代原 Owner drain/receipt/CLOSED/容量证据
- [completed] 完成 👴🏻/👨🏻/👶🏻 真实会话 tab 图标投影，保留原名，验证身份 tooltip 与关闭展示不停止运行
- [completed] round-121 修复 VS Code shell 至 active-frame 的精确消息来源识别；隔离 macOS 深色历史 fixture 实证组长 srcdoc/适用操作栏、单次关闭无 stop/cancel、焦点/原位置恢复及可见 275px 真实 Webview；见角色会话验证 runbook，不代表组织运行态门禁通过
- [completed] round-122 Codex 专属可信 Owner launcher 受控组合通过：隔离标准 build、33 项组合及 4 项 Owner 定向回归，保持共享观察限制；不代表生产 bootstrap/首次绑定及真实资源释放
- [completed] round-125 将已审查弹窗与 Codex launcher 事实同步至中央功能清单、Owner 主设计及 ontology source_refs，保留有效旧证据和失败属性
- [completed] 验收组长代次执行集合与全部 Owner 凭证聚合基础库：精确 scope、首次准备前责任登记、可信封闭、原子绑定及串行聚合后冷重读；复用标准 build 与 106 个不同用例
- [completed] round-214 续接中断的执行集合文档/本体同步，保留稳定 ID 及既有证据边界；检查结果见指定 attempt 报告
- [completed] round-216 修正组织 binding 历史对不同 employee attempt 的唯一性，验证全部 attempts 独立持久并聚合；Owner 启动 slot/identity 合同保持不变
- [completed] round-217 修复 round-216 source lifecycle 测试隔离及双attempt Owner fixture 确定性门闩；round-218 补足ready前失败回收与可取消receipt等待；round-220 修正显式强制回收的凭证边界，但其IPC断连用例未创建payload。round-222 增加payload保持live时断连、worker固定failed cleanup并等待真实payload close、测试目录close事件核对及原ReceiptStore无成功cleaned检查；ready失败现等待同一teardown结算并暴露清理错误。round-223 统一处理worker/payload异步IPC发送错误，记录失联通知失败，消费并记录disconnect/signal/显式recovery拒绝；拒绝回归确认只在payload真实close后非零退出、没有成功receipt。round-223最新实体隔离源码副本标准`npm run build`、目标严格编译通过，受影响cleanup八项通过；较早构建因隔离副本未刷新未作为最终证据。详细范围见本轮attempt报告。fixture证据仅代表测试资源结算，生产门禁未改变；仅macOS实测，Windows/Linux未验证
- [completed] round-225 补齐Owner目录创建前startup-error与IPC不可用组合：诊断记录失败降级stderr并保留原始错误及ENOENT，不重建生命周期证据；新增真实子进程close、非零退出和未创建Owner目录断言。最终隔离标准构建、目标编译和受影响cleanup回归以round-225报告记录为准；round-223结果按原范围复用。仅macOS实测；不构成生产Owner或容量恢复证明。
- [completed] round-220/222/224 已验收员工准入、组长多轮原生 Owner、真实生产 producer、首次登记、原子新绑定及 Loop+ 生产装配；round-225 仅修复 Owner 测试 fixture 启动诊断，不扩大资源/容量证据
- [completed] round-228 已审查已装配 Codex runner/session 的真实释放映射、精确 tab 关闭能力、extension consumer 登记及原 Owner 完整 receipt 生成；30 项资源/生产组合、12 项 adapter、标准隔离 build 与安装版 EH tab 端口按各自报告范围复用，不累加为一次全量运行；CLI 是固定模拟 Node，EH 不证明完整 UI/真实 native CLI，也不覆盖生产整组容量消费
- [completed] round-350 公开入口 EH 新建场景通过四项原 Owner 完整 receipt、自然清理、组长容量归还与合法再次派发；macOS 安装版 EH 使用真实 Codex 0.167.2 binary，模型响应来自本机确定性 Responses fixture，不证明远程模型质量、全部 CLI 或跨平台
- [completed] round-351 真实 Store fixture 持久删除先于隐藏、删除失败保留可读记录；OpenCode 并行 tab 输出/完成/取消隔离及原 transport 排空等待按各自实体隔离构建与定向测试范围通过，不合并为一次累计运行
- [completed] round-353 可信 Owner 消费器有效重试预算固定为零，46 项模板/parallel/one-shot 回归通过；另有源合同 18/19、一项旧 sessionTabs 文本断言分类为过期，未声称整份合同测试全绿
- [completed] round-357 修复 continuation 路由准备首个 await 期间的 stop/dispose 撤销窗口：首 await 前登记同根 token，重复续接拒绝，等待后复核身份/路由，迟到 finally 隔离；实体隔离标准 build 与 20 个不同 composition 用例按报告范围通过
- [completed] round-359 公开 stop→continue EH 的 successor binding 冲突失败按历史保留；round-366 后续公开 Codex EH 完整通过续接及根完成路径。该结果不证明 OpenCode、跨代冷恢复或其它平台
- [completed] round-359 OpenCode leader native-session validator 每次核对持久 executionSession、单次 invocation 固定首个核验 ID，移除普通 metaStore 映射写入；8 项校验器与 1 项生产接线检查按原范围通过，不代表真实 OpenCode/EH 或整组容量
- [pending] 完成冷宿主可恢复接管、必要平台和未覆盖的真实公开根组合；round-400 OpenCode 两轮公开 stop/continue 的具体执行事实及只读审计不改变原 failed driver 结果，也不构成一次新的完整 EH passed，且并发 observer 最终源码与该 EH 快照不同。round-403 已接受 CDP 清理失败传播门禁和迟到 discovery detach 的定向 driver/UI 回归；该轮 cold 仍 failed。round-405 `invalid-recovery`、第二 EH 强制回收及当时未真实运行最终 `settleColdPublicControl` driver 均保留为历史。round-408 冷 stop 已修复为先经原 `prepareRoutes`、异步后重核身份；唯一真实 cold 的 `unverified-leader-session-or-plan`、缺完整身份/afterControl 对照及整项失败均限定为该轮快照。round-410 持久身份只读核验已通过主审和唯一 macOS cold 安全拒绝场景：公开 stop 精确命中 `live-leader-unverifiable`，四阶段身份/责任/保留容量对照及无新 grant/request 通过；不证明可恢复接管、Owner 清理或容量释放。round-403 macOS owner-core 固定平台套件 58/58、exit 0 仅覆盖原固定入口；后代追踪与整树关闭未确认，Windows/Linux 和未覆盖来源/角色仍开放。当前待办是可恢复接管及生产 target/live 能力、必要平台、其余公开组合，和最终 Git 同步/合理合并/合并树全量回归；已接受主题/窄屏按未变范围复用。所有实现完成后执行最终合理 Git 同步/合并及合并后全量回归并修复发现的问题或 fixture
- 当前冷场景门禁已由 round-410 修订：身份边界修复经代码主审、标准 build 与21个不同定向用例接受；唯一 macOS Codex 0.167.2 / VS Code 1.144.0 cold 场景以公开 stop 命中 `live-leader-unverifiable` 安全拒绝，完整四阶段身份/责任/保留容量对照一致，无新 grant/request 或 provider 重播，CDP 无诊断且两 EH 自然退出。round-405/408 的旧 warning、各自证据缺口和失败结果保持历史。remaining scope 是可恢复冷接管及其生产 target/live 能力、未覆盖来源/角色、必要平台和最终 Git 同步/合理合并/合并树全量回归；本次不证明 Owner 清理、CLOSED 或容量归还。计划保持 `active / in_progress`。
- [pending] 根 feature 全部验收后更新真实状态及功能清单，再考虑归档

## 决策记录

- 2026-11-15（round-372 中央事实同步）：Owner `finalizing` v1 是无 receipt 的只读三字段状态，仅原精确 Owner 在 terminal/drain 可核验、原 cleanup 进行中且内存/持久 live identity 与 revision/claim/requirements 一致时返回。client 对 live/finalizing 使用原串行退避，unknown/conflict 立即拒绝；不缓存成功、不释放、不 spawn、不推进 claim，close 保留锁；员工 done 仍需完整 receipt+stopped。员工 OpenCode 根能力在首次 realpath/assert 前捕获原 assert/dispose，异常清理失败保留根、配置租约及容量。新根可信宿主固化三角色 OpenCode 默认模型，但偏好 `model:null` 不变；限定公开 EH 使用较早 Owner 快照，不代表最新 Owner/全部角色 EH。Owner/facade 27 项与未变 client/verifier 17 项为分批有效结果，不是44项单次最终运行；默认模型 26 项/公开 EH、root capture 4 项分别按原报告范围复用。
- 2026-11-15（部门覆盖核对）：父记录原始目标与当时已登记的13项补充要求逐项映射见[验收覆盖表](../../runbooks/department-acceptance-coverage.md)。round-366 Codex 公开 stop→continue 已通过；round-359 冲突失败保留为历史。round-350/369/372 公开 EH 均为各自限定 provider/角色/新建场景。来源 store 当前已装配；所有 writer、跨代/冷恢复与真实平台完整门禁仍开放。根 feature 继续 `in_progress`，不归档。
- 2026-11-15（round-378/382 中央证据同步）：round-375 三角色全 OpenCode 默认模型公开新建场景及 round-376 managed-main 工具交互均按各自快照接受；round-375 整项 attempt failed 历史保留。round-378 macOS 安装版 OpenCode 1.19.5 stop→continue 最终执行事实按限定场景有效：原 session 保持、新代独立 Owner/root、六原 Owner 完整 receipt、三个 CLOSED、grant 前持久读回、容量归还后再派发和总监最终汇报；move 204 后 GET 冷读，leader 跨代核对整组闭包，员工核对原 attempt。round-378 整项失败历史保留。round-382 后继修复已由主审接受：有界精确 source/target 链头、自身重试来源识别，实体 build 与 26 个不同定向用例通过；没有连续公开 EH。Codex-only 冷 EH 因 Playwright 缺失在发送前失败，无生产任务/binding/Owner/第二 EH 观察；冷宿主 running leader provenance/聚合、必要平台及最终 Git 同步/合理合并/合并树全量回归仍开放。round-376 仍只是 headless one-shot 工具证据。根计划保持 active / `in_progress`。
- 2026-11-16（round-400 中央事实同步）：被动 ACK observer fixture 的最终隔离 build 与 10/10 定向 IPC 检查通过；仅真正 grant 读回、普通 callback ACK 跳过，异常不改写/阻断原 send。唯一 cold EH 到员工 binding、原 Owner live、首 EH 正常退出和退出后 binding/容量保留，第二 EH target discovery 超时并强制回收，未到公开 stop/warning。OpenCode successive EH 实际执行两次 stop/continue、A→B→C、8 Owner/4 CLOSED、C 验收、第二模块和总监汇报；原机器 driver 结果 failed，角色修正后的 mixed/successive/native 只读审计 3 项通过，不是新的一次 EH pass，且 observer 最终源码与执行快照不同。并行 CDP 清理门禁待验。覆盖表现有原始目标及 14 项补充要求；冷拒绝对照、必要 Windows/Linux 与入口集成、未知来源/角色范围、最终 Git 同步/合理合并及合并树全量回归仍开放。计划继续 `active / in_progress`。
- 2026-11-16（round-403 中央事实同步）：round-400 OpenCode successive EH 及 round-400 passive observer 证据保留各自执行快照与边界；原 driver/整体主审 failed 未回写。CDP cleanup failure 传播及迟到 discovery detach 修复已通过直接受影响 driver/UI 定向回归，不是新一轮完整 EH。cold 复试越过 discovery 且点击返回，但没有已送达 stop、精确 warning 或完整控制后快照；后续 cold observer 修复尚未验收。平台入口 macOS owner-core 固定套件 58/58 通过，后代追踪未启用且整树关闭未确认。覆盖表映射原始目标和全部14项补充要求；计划仍 `active / in_progress`，冷恢复、Windows/Linux、未覆盖来源/角色及最终 Git 同步/合理合并/合并树全量回归保持开放。
- 2026-11-16（round-405 中央事实同步）：round-405 实体标准 build 与11个不同定向用例通过；唯一 cold 使用生产 API observer 和真实 root 关联确认公开 stop 送达，实际 warning 为 `invalid-recovery`，不是目标 `live-leader-unverifiable`。缺完整控制后快照、四阶段身份与无新 grant/request 对照，整项主审仍 failed；CDP confirmed 仅证明 harness 自有资源门禁，原运行仍强制回收第二 EH。后补 `settleColdPublicControl` 单测通过但最终 driver 未运行，不合成快照。生产冷 stop 路由准备修复已派发待审。根计划保持 `active / in_progress`，必要平台、未覆盖来源/角色、冷恢复完整拒绝对照及最终 Git 同步/合理合并/合并树全量回归继续开放。
- 2026-11-16（round-408 中央事实同步）：生产冷 stop 已修复为先经原 `prepareRoutes` 建立可信路由并在异步后重核身份；实体标准 build 与33个不同定向 composition 用例通过，暖 stop 首 await 前封闭准入保持。唯一真实 cold stop 送达，warning 为 `unverified-leader-session-or-plan`，不是目标 `live-leader-unverifiable`；缺完整 afterControl、四阶段身份及无新 grant/request 对照，整项主审 failed。CDP confirmed 后第二 EH 自行 exit 1、`forcedTeardown=false`，实际覆盖 `settleColdPublicControl` 的失败等待分支，不代表场景通过或容量释放。源码/只读诊断指向 `inspectLeaderSession` 冷 tab/session 关联边界，未直接捕获私有 tab 分支；后继身份修复已派发待审。round-405 原 `invalid-recovery`、第二 EH 强制回收及当时最终 driver 未运行的历史不改写。计划保持 `active / in_progress`，完整冷拒绝对照、必要平台、未覆盖来源/角色和最终 Git 合理合并/合并树全量回归继续开放。
- 2026-11-16（round-410 中央事实同步）：round-410 持久 leader identity reader 修复已由主审接受；最终实体标准 build 与13项身份、5项恢复/继续、3项 composition 回归分别通过。唯一 macOS 安装版 Codex 0.167.2 / VS Code 1.144.0 免费 loopback cold 场景安全拒绝通过，公开 stop 精确命中 `live-leader-unverifiable`，四阶段身份、责任全集及保留容量对照通过，无新 grant/request、无 provider 请求重播，CDP 无诊断且两 EH 自然 exit 0。仅证明冷宿主只读身份判断和 fail-closed 拒绝；endpoint unknown/unreachable、employee live、责任 open、原 binding/容量保留，未证明接管、Owner receipt/CLOSED、员工验收或容量释放。round-405/408 历史结果不合并。计划仍 `active / in_progress`；可恢复接管、必要平台、未覆盖来源/角色及最终 Git 合理合并/合并树全量回归继续开放。

- 2026-11-15（round-332）：任务模式开关为全局设置，缺失/非法值按 Loop 开、Loop+ 开、产研部关处理。新用户任务与定时任务在宿主入口拒绝关闭模式，并在异步配置屏障后复核；已存在 Loop/部门任务续接和可信组长 Loop+ 内部派发不受开关约束。隔离 TypeScript build 与 71 项定向测试、另 3 项定时入口测试通过；设置面板 Chromium smoke 在 1280px/280px 覆盖默认值、键盘切换、保存禁用、警告可见及无横向溢出。部门会话 smoke 因现有 Tab fixture 期望组织总览名称而页面实际显示 `👴🏻 Codex` 未通过，未据此修改 tab 标题/图标要求。`impeccable` detector 返回空发现。验证未覆盖真实 VS Code 宿主、真实 CLI 派发、跨主题/平台完整组合；部门会话 smoke 的 fixture 断言仍待独立确认。详见 round-332 子任务报告。

- 2026-11-13：用户确认默认 4 名组长、部门共享常规 20 名员工，非累计数量；最新决定允许零余额时每位组长最多一个未释放超额员工，实际结束且清理完成释放，组长人数无例外；按用户要求使用真实 `in_progress` 状态拼写，保留模板其余主要章节。
- 2026-11-13：总监沿用经典 Loop 协调语义；组长保留真实 Loop+ 验收，运行中协作必须投递为目标组补充需求；优先封装复用既有能力。
- 2026-11-13：当前四项交付不能冒充模式配置、嵌套运行时、协作转发及停止恢复已接通。设计态规则不直接写入运行态 ontology。
- 2026-11-13：按用户新增决定，验收方案在部门根层统一配置，全部组长继承同一快照且不可覆盖；复用模板/选择/快照能力，运行时修改如提供须根层显式更新并由宿主统一同步，不增加总监验收。
- 2026-11-13：总监页用页面内弹窗打开组长群聊，关闭不停止、保留阅读位置和恢复焦点；角色图标采用 👴🏻/👨🏻/👶🏻。2026-11-14 用户明确 tab 文本保持既有会话原名，仅在前面装饰角色图标；完整层级与身份置于 tooltip。真实会话投影已在隔离宿主观察，组织启动和完整恢复仍待门禁验收。

- 2026-11-13：余额按全部真实员工含超额占用计算，每次决策取得最新参考快照，未知明确未知；真实启动由宿主原子重判。超额按组长/attempt 归属恢复，停止请求、扩容或余额回正不释放运行租约；降低额度不强杀存量。
- 2026-11-13：组长页面内弹窗保留完整同排 Loop+ 操作栏，总监群聊专门呈现分派、汇报与运行中协调；UI 接线及主题修复由对应实现任务交付，不扩大总监验收职责。

- 2026-11-13（本批事实同步）：组织、配置、群聊及生产索引已有独立验收模块，替换初期“全部待实现”的描述；不将独立端口当作已完成中央装配。源码与来源报告均核对后才同步 ontology。
- 2026-11-14（round-228 当时结论）：按已审查 round-220/222/224/225 与当前生产源码修正 Owner/生产阶段描述；生产 producer、员工准入、Codex 组长原生多轮 Owner 与限定 Codex runner/session/tab 释放及原 Owner receipt 生成均已审查。当时真实 Codex EOF/多轮 drain、生产可信 receipt 观察、`observeLeaderCleanup`/组长容量消费及其他根门禁仍开放。round-224 216/217 回归保留余额失败和挂起事实，计划继续 active/in_progress；后续 round-234 的限定观察/消费事实见下条。
- 2026-11-14：round-234 主审后，`observeLeaderCleanup` 的已验收生产能力限定于同宿主新建、完整覆盖的 Codex 组长/员工集合；所有原 Owner receipt 严格观察且集合最终冷读一致后，持久移除组长租约才 release。已有 overflow 下不同新 attempt 明确 failed 拒绝，不形成新 waiter；不扩大到真实 Codex CLI、其它角色/CLI、socket 收尾后 client 可达性或冷恢复。旧216/217余额失败与较宽stop/resume挂起作为历史/未解决属性保留。
- 2026-11-14：round-234 已审查限定 Codex 完整集合观察、持久移除后组长租约 release，以及已有未释放超额时新 attempt 明确 failed 拒绝；旧余额失败和较宽 stop/resume 挂起仍作为历史/未解决事实保留。计划保持 active/in_progress。
- 2026-11-15（round-350/351/353/357/359）：round-350 macOS 安装版公开 EH 使用真实 Codex binary，但 Responses fixture 提供模型响应；新建 Codex 场景的原 Owner receipt、自然清理和容量释放后再派发通过。round-357 以首 await 前 token 和撤销核验修复 continuation 路由等待窗口，20 个不同 composition 用例及实体 build 通过。round-359 公开 stop→continue EH 到达后继执行但 successor cleanup 因 session/Owner binding 冲突失败，容量保留；OpenCode native-session validator 只读接入 parallel consumer 的 8+1 项检查按独立范围通过。分项结果不合并，全树生命周期和真实 OpenCode 仍待门禁。

## 历史结论（round-359；当前结论以需求覆盖表及 round-366/372 为准）

根 feature 保持 `in_progress`，计划继续 active，不归档。三角色 tab 展示与受控历史弹窗、中央 production composition、Codex 专属 launcher、生产 producer/员工准入/Codex 组长多轮原生 Owner，以及限定 Codex runner/session/tab 释放、Owner receipt 生成和 round-234 同宿主新建完整 Codex 集合的观察与组长租约消费均有各自范围的独立审查证据。round-350 公开 EH 使用真实 Codex binary，但模型答复来自确定性 Responses fixture，仅证明本机新建场景；round-351 并行 tab 隔离、round-353 零重试和 round-357 continuation prepareRoutes 取消窗口分别按独立报告复用。round-359 OpenCode 只读 native-session validator 的 8 项与 1 项接线检查不证明真实 OpenCode/EH。round-359 公开 stop→continue EH 完整门禁因后继员工 session/Owner binding 冲突失败，容量正确保留。观察成功只在完整集合冷读一致且原 Owner 全凭证成功后成立，组长租约持久移除后才 release；未知/失败保留占用。仍未完成的根门禁包括可信来源租约覆盖所有写者、尚未覆盖的 Codex drain 生产组合、OpenCode 完整生产组及容量消费、其他角色/CLI 所有权、原 Owner socket 收尾后的可信可达观察、冷恢复、公开继续的后继 session 修复及完整验收、必要平台和最终真实 EH/UI 组合。tracker 仅表示活跃编排责任，不是 drain/receipt/CLOSED/容量凭证；封闭集合本身不等于 cleaned。最终 Git 同步、合理合并和合并后全量回归仍待完成。round-224 的 216/217 余额失败与较宽 adapter stop/resume 挂起保留当时未解决的历史属性（后继 round-228/232/234 定向及 round-351 runtime 结果见覆盖表），不记为整套通过；round-234 修复了限定范围内不同新 attempt 重复超额的明确拒绝/failed结算。

来源层次为当前代码、父任务 communicationFile 指向的已审查报告、稳定设计/群聊接口。round-125 已同步 Codex launcher 受控 Node 组合（33/33 与 Owner 定向 4/4，非生产 bootstrap/首次绑定），本轮复用其证据边界；Codex Node core 报告的 158 项、5 项 Node 与 1 项 EH 端口覆盖仍不代表独立 Owner、完整 receipt 或容量恢复。round-216 组织索引不改变上述 Codex 执行事实或 Owner fencing，仅使同员工不同 attempt binding 可分别保存。CodeGraph 定向读取了当前 store/ledger/recovery/cleanup；本轮不重复既有执行或 UI 截图审查。

round-228 生产 producer/ledger 事实同步见 round-228 attempt；round-231 同步 Codex 资源释放；round-237 同步 round-234 组级观察、容量消费及准入结算；本轮依据父记录 `communicationFile` 更新 round-320/321/350/351/353/357/359 的限定事实和公开续接 EH 报告中的精确失败；该新失败报告不作为额外成功验收。没有重跑仍有效的 build、行为、EH 或浏览器验证。后续验收聚焦来源租约、尚未覆盖的 Codex drain 生产组合、OpenCode 完整生产组与容量消费、其他角色/CLI 所有权、公开继续的 session 交接修复、冷恢复、必要平台和最终真实组合。round-224 的 216/217 失败与较宽 adapter stop/resume 挂起保留历史；后继 round-228/232/234 和 round-351 各按定向范围结算，不把旧宽命令写成通过。


## round-364 续接修复交付结算

- [completed] 宿主从成功提交当前 failed review 及关联派发产生精确 repairSource；保存/读回失败无后继启动，模型元数据不可信；历史失败保留，原会话交接与清理合同未改变。
- [completed] 共享组织完成判断核对精确修复链、最新验收、终态、非空通过最终覆盖及全部开放工作门禁；同子任务重试与无失败直接工作兼容。实体隔离标准 build 与 64 个不同定向用例通过。
- [completed] 公开 stop-continue 复验消除 round-362 成员 failed：后继 reviewed/completed/passed、member completed、四原 Owner 完整 receipt、两代 CLOSED、持久容量移除；原 thread 保持、后继 Owner 不同。证据 `/tmp/round364-public-stop-continue-eh.json`。
- [completed] 保留该轮 JSON 整体 failed/successorCompletion 历史；后继 round-366 完整公开 EH 已通过。该轮状态为：root running、11 次本机响应止于组长最终汇报，未有总监后续请求、完成汇报及容量归还后的合法下一模块执行。该缺口已由 round-366 controller launch/wake 后继修复，不改清理门禁。
- [pending] 真实 OpenCode 完整 EH、冷恢复、必要平台及 Git 同步合理合并和合并后全量回归独立收口。round-350 新建成功与 round-362 局部成功/整体失败历史保留，不能拼接为完整 stop-continue 成功。


## round-366 续接总监生命周期与公开 EH 收口

- [completed] 实际 controller 门闩先确认后继 track 无通知、旧 run 收尾阻止续接两项根因；统一每代结算通知和 wake，旧代 stopRevision 隔离，继续等待完整旧 run finalizer 后移交 ownership。同根无并行总监循环，模型期间 wake 不丢失。
- [completed] 清理未知仍 blocked/保留容量，停止后迟到结果不复活；首次本地占位 session 的合法真实绑定须返回任务/持久读回/tab 一致，已绑定变化及冲突拒绝。最终物理隔离标准 build、28 项 composition 及 5 项直接受影响组织回归通过。未变的完成结算/策略/仓储/会话与协议证据继续复用。
- [completed] `/tmp/round366-public-stop-continue-eh-final.json` 完整 passed：公开设置/发送/停止/继续，原 thread 与任务保持、后继新 Owner，后继事件验收与结算、总监再派发、下一模块实际执行、总监最终汇报；六原 Owner 完整 receipt、三个 CLOSED 全集及持久容量归还。18 次本机确定性响应无协议失败，原责任自然收尾。先前 round-362/364 整体失败及本轮首次复验失败保留，不追改历史。
- [pending] 根 feature 仍 in_progress/active：真实 OpenCode 完整 EH、冷恢复、必要平台、尚未覆盖的来源租约/角色组合，以及最终 Git 同步合理合并和合并后全量回归独立收口。本机免费 fixture 不证明真实模型质量；本次 tracker/wake 不是清理权限。

## round-369 OpenCode 组长限定混合公开 EH

- [completed] 复用 round-366 Codex 公开 stop→continue 与六原 Owner 审计，不重复运行。同步已接受 OpenCode 1.19.5 同 Owner/session 双轮、唯一 canonical 隔离根、准备/任务真实 directory 与原 root capability/receipt/stopped 合同；跨代目录不匹配及冷恢复继续拒绝。
- [completed] 参数化现有驱动 `--leader-cli opencode`，复用两模块生产阶段、真实 Webview 设置/角色明确模型/统一方案/发送及原 client 被动观察器；加入有界 Chat Completions 适配和原 worker IPC 只读握手证据，不复制 harness、不改生产门禁。实体隔离标准 build 与 23 个不同直接相关检查通过。
- [completed] `/tmp/round369-mixed-public-eh-explicit-model.json` passed：限定 Codex 总监/OpenCode 组长/Codex 员工，新建两模块真实事件验收、四原 Owner 完整 required receipt、两个 CLOSED 全集、容量持久归还后的实际下一模块与总监最终汇报；9 次 Responses/8 次 Chat Completions 无协议失败。原默认模型 null 的首次 `/tmp/round369-mixed-public-eh.json` failed 保留；精确模型复核/host 要求显式模型，本轮通过公开明确选择完成限定场景，未修生产默认模型映射。
- [pending] feature 继续 active/in_progress：OpenCode 员工及全角色组合、跨代/冷恢复、必要平台、未知来源交接，以及全部实现测完后的 Git 同步合理合并和合并后全量回归。并发 OpenCode 员工/共享停止器代码不由本轮修改或预记成功；完整快照差异和限定证据见本轮 attempt 与 runbook。


## round-372 默认 OpenCode 模型快照修复

- [completed] 仅在可信宿主生成新根快照时解析三角色 OpenCode 有效默认；UI/持久 null、Codex 默认、显式选择与变体/力度合同保持。精确档案读取修订及等待后的工作区、目标、偏好和保存屏障复核；已有 root 不重解析默认，不放宽 selection/fingerprint/cleanup。
- [completed] 物理隔离标准 build 和 26 个不同直接相关用例通过；总监/员工默认限直接宿主与真实 argv/overlay builder 回归，组长另有生产 launch/binding/cleanup 及真实 EH。未改 helper 的本轮 9 项继续按原范围复用。
- [completed] `/tmp/round372-mixed-default-public-eh.json` passed：真实 UI 默认模型新建，Codex 总监/OpenCode 组长/Codex 员工，两模块、四原 Owner 完整 receipt、两个 CLOSED 全集、容量持久归还后实际下一模块与总监最终汇报。9 次 Responses/8 次 Chat Completions 无协议失败；首份 round-369 默认模型 failed 不覆盖。源码/产物与并发共享 Owner 新修订的边界见本轮报告，不能称整个当前仓库已验证。
- [completed] round-372 阶段交付的根能力、finalizing 与默认模型修复均已接受；其时全角色公开 EH 尚待审查的状态由 round-375 后继新建场景关闭。round-121 弹窗/275px/焦点/滚动恢复、动态主题及 round-338 深浅主题 tab 证据按未变范围复用，不笼统重开主题/窄屏；远程付费模型质量不是额外用户要求。当前未关闭门禁见本计划 round-378 决策及[验收覆盖表](../../runbooks/department-acceptance-coverage.md)。


## round-436：逐组额度生产接线候选（2026-11-16）

- [completed] 以已接受 d352（父083d纯策略）建立独立外置实体树；复用策略、保留11条UI字节，不导入返修冷恢复或提示Git后继。
- [completed] RuntimeStore 同根原子快照维护版本化额度；单EH同步CAS、旧controller保留、可信生命周期初始化/登记/配置clamp、损坏拒绝和只读不迁移。
- [completed] 原真实准入路径在身份/幂等/取消门禁后应用最新desired并持久化，即使拒绝仍应用；与原同步pool保留之间无await。真实租约含overflow计数，额度降低保留原员工/责任/清理标准。
- [completed] extension 安装已有总监reader/writer及独立ownership index，composition安装Loop+每轮精确容量reader；未改布局、文案、主题或iframe消息边界。
- [completed] 本实体树标准 `npm run build` 通过；2个store、3个host、3个composition及1个production lifecycle不同新增用例通过。覆盖默认5、保存/下次尝试、CAS竞争、缩容历史、未知/错根/错成员、持久失败、重复attempt、共享总额/overflow和原清理后释放。composition准入夹具手工建立合法scheduler快照；单独生产生命周期使用真实producer/adapter/Owner和免费模拟CLI自动派发，不是安装版EH或真实模型验证。
- [pending] 合并后继提示渲染和返修冷恢复；复核恢复/所有权标准及所有写者，真实UI→EH保存、第二EH、必要平台、最终远端同步、合理合并与真实最终合并树全量回归。策略13、UI40/最后host5、浏览器和提示builder34只复用原输入证据，不重跑刷新或冒称本候选全量通过。

根计划保持 `active / in_progress`。本轮命令、中间夹具失败、源码哈希和本地候选身份记在round-436外部attempt报告；不改变历史失败或根验收结果。详细持久化及准入边界见[逐组员工额度设计](../../design-docs/department-employee-allocation.md)。


## round-676 主干累计整合交接

- [completed] 已从fetch后 `origin/master` `e890e36352570b6cda9fc531df06ca2007a09ec6` 建立独立分支 `codex/department-mainline-integration-round676-20261116`；角色图标候选 `a3a0d37a0723791645259c4abebbd6d129d52b79` 与主干共同祖先为 `8f396c1b809c43320aad9c4c43eb05c9cf2a3c58`。完整来源与冲突记录见 `.ch/docs/integration/department-mainline-integration/`。
- [completed] 从 `c76b5132d6c0430dfb03f150fb8220010265e32f` 对照导入round-674实体55条tracked差异路径（含非Git/未提交累计变化），排除生成的 `.local` memory index。round-674最终12路径patch仅作身份/增量验证，未替代完整实体。原始patch、manifest与src/scripts closure哈希记录于sources.json。
- [completed] 13个Git真实冲突逐项按主干与已审部门合同合并，保留冻结验收批次、attempt/request/session行为，以及部门authority、generation、Ledger、完整receipt/CLOSED和持久容量门禁。必要的3个缺口修复与首次build错误记录在round-676报告。
- [completed] 最终整合树标准 `npm run build` 通过；这仅验证组合TS/构建入口，不关闭单测、真实UI-EH/CLI、冷恢复业务、平台或全量回归门禁。
- [pending] 后续实现统一以round-676最终本地整合提交为基线。用户新增要求支持工作区层组长/员工人数设置并优先于全局配置；需先核对字段解析、保存与进入准入的实际调用链后实现并验证，不能将当前全局人数规则误记为已覆盖工作区优先级。
- [pending] 真实UI→EH、冷恢复/原代真实端点与完整清理凭证、Windows/Linux必要平台、最终分支全量回归及剩余原始功能验收仍开放。round-675首轮失败/Tabs超时、额度run1/2清理未知/run4 driver失败及只读复核通过、旧cold guard分支未直接捕获等历史不重写。

计划仍保持 `active / in_progress`，本次不是根任务归档或整体完成。


## round-694：工作区组长/员工人数覆盖（2026-11-16）

- [completed] 从已整合主干 `ac1b8199d3c164f76c1043bc21bfffc13a0ae60e` 创建隔离分支 `codex/department-workspace-capacity-round694-20261116`；不使用整合返修index/dist或依赖链接，不改coordinator/pool。
- [completed] 工具设置－工作区两张同构卡分别覆盖组长/员工人数；空值继承，全局占位随全局变化，change/blur去重，保存中禁用、失败中文恢复及scope/request隔离。存储optional同名字段，损坏值继承，公共正值取整/safe integer规则，无任意上限。
- [completed] 生产modelSettings真实读取工作区有效值，逐项工作区→全局→4/20；原全局PanelState语义保持，新增workspace前缀number/null。保存最新副本、持久化成功才发布内存；共享工作区保存接口改为临时文件写完后替换，覆盖部分写入/替换失败保留旧文档。
- [completed] 本地标准 `npm run build` 通过；8个直接相关测试文件53/53通过，覆盖存储/部分写入与替换失败/消息路由/面板投影/真实生产配置解析及原角色回归；ontology结构校验和9项工具测试通过。生成Webview＋真实设置router/store的Chromium fixture在1440深色、280浅色两场景通过，检查继承/保存/去重/重载/清除/非法/失败恢复/全局变化和几何，无浏览器错误；截图已人工复核。首次旧scope错误提示用例26/27、缺默认浏览器、旧网格断言、CSP桥接夹具及新增单域workflow校验失败保留在外部attempt报告；均由本轮修复或纠正。最终53项、结构9项及最终浏览器结果分别有效，不重复旧CLI/EH矩阵，不替代真实安装版EH或全量回归。
- [pending] 本提交合理合回同一round-676整合分支后，由主审复核最终组合；真实安装版UI-EH/CLI、必要异平台及合并树全量回归保留。工作区覆盖只作用于新部门快照，既有准入按冻结原根人数执行；不引入运行容量热迁移，不取消既有执行、不释放未知租约、不重写原代快照。默认均分、全部门共享及完整证明释放、下一次派发应用总监额度、零余额每组一次未释放应急名额均不变。

保留round-676语义遗漏、历史失败和各次未覆盖边界；根feature仍为active/in_progress，不归档。
