# 产研部模式：需求与设计边界

- 日期：2026-11-13
- 状态：实现与既定交付范围 completed（Round723，截止 lp722 已独立接受）；最终主任务接受由主审决定，未发布。
- 根 feature：[执行计划](../exec-plans/completed/2026-11/2026-11-13-feature-department-mode.md)
- 当前清单：[功能总表](../product-specs/FEATURE_INVENTORY.md)

## 当前交付状态（Round723）

lp721 正常合入及 lp722 原目录安全交接已接受，原 feature 计划已按 2026-11 归档。原目录占用交付分支，本轮基线 f787/tree4777；master ref 未改且切换前 clean，原整合树 detached f787。228 原 untracked 受限归档、106 tracked 精确恢复，334 完整回滚映射和原件保全继续有效。中间 raw-index 封口 exit1 与三个稳定窗口/1151 条仅 106 stat-cache 变化、零 stage 语义变化的诊断保留，actor 未知，见[收尾覆盖](../runbooks/department-acceptance-coverage.md)。

复用 lp715 一次标准 build 及官方 397 文件/5472 项（5469 通过、0 失败/取消、3 门控跳过、自然 exit0）和 lp719 唯一 180 秒 mixed 冷链 exit0，按原 receipts/CLOSED、持久容量、authority 自然退役、公开 continue 唯一后继、OpenCode 原 session/move-readback、最终公开 stop 及直接 workers 观察范围成立。总监最终业务汇报沿用 round-366/375 等相应历史接受证据，不由冷链推导。原生 Windows/Linux、三 DSH live 门控、模型/任意崩溃/外部 writer/全部后代限制仍有效，ignored dist 可能与交付源码不同且未更新/验证。本轮无业务合同或运行实现变化，不重跑运行验证。

下方旧开发阶段及“待验收”叙述均保留为其时点的历史事实，由本段和覆盖表给出现行截止；不改写失败历史，不把强制卫生回收称自然退出。

## 历史需求与交付边界（保留原文）

在现有 Loop、Loop+ 之外提供“产研部”，形成总监→组长→员工三层。人数设置、模式/角色配置与就绪门禁、中央组织 host/Loop+ 装配、容量策略与余额提示、记录驱动群聊、生产来源 Controller/Repository/identity catalog 路由和若干真实公开宿主场景已有分范围实现及审查证据。仍须区分生产接线、特定平台/角色/执行代次的端到端证据与完整根门禁；本设计状态仍为开发中。

| 层次 | 本批可记录的事实 | 尚不能据此宣称 |
| --- | --- | --- |
| 已实现模块 | 三层身份、组织 host、真实 Loop+ 适配、共享容量/每组超额、根方案继承、总监中转协作、弹窗授权、文件贡献索引及确认写入端口。 | 全部直接/旧版本存储写者的可信协调、跨宿主冷恢复和完整组合仍未全覆盖。 |
| 已装配能力 | 中央生产 composition 持有组织/容量 host，并接入 Loop/Loop+ 创建、协调、员工准入、受限 Owner 和生产来源 store；群聊查询经专用 Controller/Repository/identity catalog 与普通 store 路由。 | 未有可信来源授权时仍 fail closed；不能将“Controller 已装配”扩大为所有写者均遵循协议。OpenCode 跨代续接、冷恢复及必要平台组合仍未验收。 |
| 已有验证证据 | round-350/366/369/372/375/378/400/410 有 macOS 安装版 VS Code/EH 限定场景；round-376 另有安装版 OpenCode 的 headless managed-main 工具交互；另有原生 CLI drain、Owner、容量、UI、设置和定向回归的独立证据。round-400 successive OpenCode 执行事实、原 failed driver 与三项离线审计分开保留。round-405/408 cold warning 与缺口属于各自历史快照；round-410 冷宿主安全只读拒绝已通过，精确 warning 为 `live-leader-unverifiable`，完整四阶段身份/责任/保留容量对照通过且无新 grant/request。 | 每项只证明其报告所列平台、角色、provider、代次、源码快照与流程；round-410 不证明可恢复接管、Owner 清理、员工验收或容量归还，也不累计为全树恢复、跨平台或最终合并后的完整通过。 |

中央生产 composition、组织/容量 host、Loop+ adapter、根创建/启动/协调端口及生产来源 store 已装配。`extension.ts#getDepartmentOwnershipIndex` 实际创建 `createDepartmentProductionTaskStore`，经 `DepartmentOwnedSourceController`、`DepartmentOwnedTaskRepository`、identity catalog 和普通任务 store 路由；生产来源已由 extension 的 createDepartmentProductionTaskStore 装配 Controller/Repository、identity catalog 与普通 store router；受控写入、保留/删除、墓碑保护及跨进程通信保留有分批执行事实。round-101/102 整项失败历史保留，round-100 接口/关闭屏障、round-103 正常激活退出及 round-351 真实存储协作/删除和 authority 后继 runtime 回归已接受。未支持的 import/restore/legacy 或外部写者须写前拒绝/撤销，不将旧 lifecycle host 拒绝当作生产未装配；未知来源交接、损坏恢复与真实冷宿主仍需精确验证。

round-350 在 macOS 安装版 Extension Host 使用真实 Codex 0.167.2 binary、worker/parser/存储及原 Owner 完成公开新建场景，四项原 Owner 完整凭证、自然清理、容量归还与合法再次派发通过；模型响应来自本机确定性 Responses fixture，不证明远程模型质量、所有 CLI 或跨平台。round-320/321 另证明两个独立 Codex 原生执行对象的 thread/start、同 thread resume 及双轮自然 EOF/stdio/NDJSON/drain，范围不含生产双持久 binding、完整 Owner receipt 或容量。

round-375 最终标准构建、137 个不同用例和三角色全 OpenCode 默认模型公开新建 EH 已通过：两模块、四原 Owner 完整 required receipt、员工 stopped、两个精确 CLOSED 全集、首次 grant 前持久身份/binding 回读、容量持久归还后实际第二次派发及总监最终汇报均成立。round-375 整项 attempt 当时的 failed 历史保留；该次具体最终场景执行事实经后继 round-376 修复 managed-main 权限/活动/agent 兼容缺口后由主审接受。模型响应来自本机确定性 Responses fixture；不扩展为远程模型质量、OpenCode 跨代续接、冷恢复、其它平台或所有 CLI 行为。round-376 的标准构建、72 个不同用例及安装版 OpenCode 1.19.5 的真实工具交互，是 headless 生产 one-shot host 加实际 preparer/template/helper/monitor 的范围，不是新的公开 EH 或 Department Owner/容量证明。

续接事实已更新：round-353 停止代次竞态保留为历史失败；round-357 在首次 await 前登记请求 token、拒绝重复续接并由 stop/dispose 撤销，迟到 finally 按 token 隔离（20 个不同 composition 用例分批通过）。round-366 Codex 公开 stop→continue 完整 EH 已通过，含原/后继责任、三代 CLOSED、容量归还、总监再派发和最终汇报；不得用旧 round-359 失败覆盖后继通过。round-378 macOS 安装版 OpenCode 1.19.5 单次 stop→continue 的限定执行事实成立，整项实现当时未通过主审的历史保留。round-382 已接受修复永久 session reservation 对 A→B→C 的阻断及自身新 attempt 来源识别，实体标准 build、26 个不同定向用例及代码合同审查通过。round-400 后续真实同宿主公开执行两次 stop/continue，实际到达 A→B→C、8 个原 Owner、4 个 CLOSED、C 验收、第二模块和总监汇报；原机器报告因新增末端 verifier 把组长 IPC 按员工字段核验仍为 failed。只读离线审计按原报告、协议、receipt 与 native DB 的 mixed/successive/native 三项通过，不是新的 EH，也不改写原 result；并发 observer 最终源码与 EH 执行快照不同。round-400 当时的整体主审失败保留为历史。round-403 后继修复已通过代码审查及定向回归：harness 自有 CDP 清理失败会传播到 driver failure gate，迟到 discovery detach 也受清理门禁约束；这只证明 harness 资源清理，不证明 Owner receipt、CLOSED、容量释放或生产恢复。round-403 macOS owner-core 固定入口套件 58/58、exit 0，但后代追踪及整树关闭未确认。round-405/408 的 warning、控制证据缺口及整体失败均保留为各自历史快照；round-410 后继身份修复已审查接受，唯一全 Codex 安装版 cold 场景通过安全只读拒绝：公开 stop 精确到达 `live-leader-unverifiable`，完整 before/after activation/control 四阶段身份、selection、requirements、方案/档案、session/attempt、责任全集与保留容量一致，且无新 grant/责任或 provider 请求重播。该实现仅以只读持久身份 reader 支持拒绝，不能授权恢复、spawn、Owner 清理或容量释放；员工仍 live、责任未关闭且原 binding/租约保留。round-410 不把 405/408 快照合成成功，不证明可恢复接管。跨代冷恢复、必要平台与最终 Git 合理合并/合并树全量回归仍开放。

round-405 与 round-408 的冷 warning、证据缺口及整体失败均为当时历史快照：405 是 `invalid-recovery` 且第二 EH 被强制回收；408 是 `unverified-leader-session-or-plan`、完整对照不足且第二 EH 自行 exit 1。round-410 后继身份边界修复已通过代码主审、标准构建及21个不同定向用例；唯一 macOS Codex 0.167.2 / VS Code 1.144.0 免费 loopback cold 场景通过安全只读拒绝，精确 warning 为 `live-leader-unverifiable`，四阶段身份/责任/容量对照通过、无新 grant/request、两 EH 自然 exit 0 且无强制回收。只读 reader 复用持久 RuntimeStore、transcript parser 与原 binding validator，不生成可执行 target/provenance、不创建 tab 或写盘；无有效身份仍拒绝为 `unverified-leader-session-or-plan`，无真实 target 的 running leader 在成员登记、容量恢复或持久写入前拒绝。原 endpoint unknown/unreachable、员工 live、责任 open、binding 与容量占用保留；这不是恢复接管、Owner receipt/CLOSED、员工验收或容量归还。跨宿主可恢复接管、必要平台、未覆盖来源/角色及最终 Git 合理合并/合并树全量回归继续开放。

round-372 三项修复均已有主审接受的限定证据：Owner 协议 v1 的 `finalizing` 仅返回 `status/identity/claimGeneration`，无 receipt；只对仍持精确 entry/handle、terminal/drain 可核验且正在原 cleanup、持久 live 身份/revision/claim/requirements 一致的原 Owner 暴露。client 对 live/finalizing 沿用串行 250ms 至 5s 退避；unknown/conflict/失联/坏证据立即拒绝，finalizing 不缓存成功、不释放容量、不 spawn、不推进 handoff claim，close 仍拒绝并保留锁；员工 done 仍需要原完整 required receipt 与原 stopped。员工 OpenCode 根能力在首次 realpath/assert 前先捕获原 assert/dispose；核验失败由原 dispose 处理，清理失败保留根、配置租约及责任容量。默认模型修复保持 UI/持久 `model:null`，仅新根可信宿主固化三角色 OpenCode 同档案具体模型并拒绝异步配置/目标/保存屏障漂移；26 项与限定公开 EH 通过，但默认模型 EH 使用较早 Owner 快照，不代表最新 Owner 或全部角色 EH。详细验收范围见[逐项覆盖表](../runbooks/department-acceptance-coverage.md)。

## 角色与模型配置

| 角色 | 行为与完成责任 | CLI、档案、模型及思考力度 |
| --- | --- | --- |
| 总监 | 沿用经典 Loop 的汇报驱动职责：仅派发粗粒度工作、协调、处理运行中反馈、依据组长汇报确认整体完成；不检查代码，不执行代码或测试验收。 | 使用当前 CLI 分组及其当前选择的模型和思考力度。 |
| 组长 | 每名组长对应一个真实、独立、封装复用的 Loop+ 任务；拆分员工工作并执行 Loop+ 验收。 | 组长角色可独立选择其他 CLI、配置档案、模型及该模型对应的思考力度。 |
| 员工 | 复用已有子任务执行能力，完成交付并向所属组长返回结果，不自行替代验收。 | 员工角色与组长角色分别配置 CLI、档案、模型及对应思考力度。 |

角色配置应复用现有配置档案、模型和思考力度能力检测，在宿主启动时解析成任务快照；切换界面当前配置不能悄悄改变正在运行的成员。具体字段名和续跑时沿用原配置/显式改用当前配置的接线，后续按既有续跑契约核对。配置失效必须可见失败，不能静默改用总监执行员工工作。不强制每位组长或员工逐个单独配置。已实现模式入口及组长/员工角色级配置，角色偏好以工作区 `departmentRoleRoutesByDirectorConfig` 按总监档案保存；配置模块本身不证明启动；中央 composition 的根创建/启动已装配，限定 Codex 新建 EH 范围见前文。

已实现的配置边界由 `src/departmentConfiguration.ts`、`src/extensionHost/departmentConfigurationHost.ts`、`src/extensionHost/modelSettings.ts` 及 `src/sessionMessageActions.ts` 共同承担：

- 工作区作用域由宿主的 workspace key、递增代次、当前 CLI 与总监档案组成；A→B→A 也不能复用旧令牌。候选与保存请求携带 scope/requestId，宿主在异步返回后、落盘前核对当前作用域，浏览器丢弃迟到候选/保存回执。`DepartmentConfigurationSaveBarrier` 按作用域与角色保留 pending/failed，同角色保存不重入，保存成功才更新内存；失败重试成功才能解除该作用域新根屏障。
- 新根在候选加载、草稿未保存、保存中/失败或配置无效时不可发送；验收确认、排队与最终发送保留 scope。宿主重读权威配置，在配置应用、候选解析等 await 后复核作用域、目标会话及实际选择。round-372 仅对新根可信宿主将总监/组长/员工 OpenCode 默认固化为同一所选 CLI/configId 的有效模型，UI/持久 `model:null` 和已固化根不变；其时全角色公开 EH 仍待验收，后继 round-375 已接受三角色全 OpenCode 默认模型公开新建场景。生产来源 index/store 已装配，但拟开放的旧版/外部 writer 协调交接仍需独立证明，当前不支持路径写前拒绝；缺能力或授权时明确拒绝，不回退普通 Loop。
- Claude 候选允许 `off`，仍按该 CLI 现有规范化规则过滤，并非对所有 CLI 放宽。OpenCode 总监重读确切档案，使用主角色模型存储 `getOpenCodeRoleModelFromStore(..., "main")`；`model: null` 保留 CLI 默认语义，解析该档案默认模型以查询对应主角色 variant。未选择 variant 时省略，无效显式模型拒绝，不能改默认或借别的档案缓存。面板默认模型变体只用档案匹配的已加载状态，可信启动仍重读档案；读取候选不激活档案、不改原生配置或泄露凭据。

## 根层统一验收方案（模块已实现，生产集成待最终验收）

验收方案在产研部层统一配置一次。根任务保存用户确认的方案快照，所有组长继承同一根任务方案快照，包含固定基线及所选附加审查；不逐组要求配置，不允许组长独立覆盖。组长仍由各自真实 Loop+ 执行全部验收门禁；根层配置方案不增加总监的代码检查、测试或验收职责。

复用[现有 Loop+ 验收方案快照](loop-plus-scheduling.md#验收方案快照)的存储、选择和模板/快照语义：`loopPlusAcceptancePlans`、`loopPlusAcceptancePlanSelection` 属于已有工作区模板能力，`loopPlusAcceptancePlan` 是已有任务快照能力。配置解析已生成固化方案；组织 host 在根注册/恢复时核对 `loopPlusAcceptancePlan`，以根快照创建/恢复组长，并校验组长快照与根相同。部门基线快照由任务存储保留；`applyAcceptancePlan` 拒绝部门成员独立覆盖。生产 composition 已装配根创建/注册与组长入口，但可信来源授权、完整生产组装及恢复仍待最终验收，不能据模块传播或受控场景宣称完整根入口可用。模板之后被编辑、删除或当前选择改变，不隐式改变运行任务；新建组长和恢复组长均继承根任务快照，不重新读取最新模板而产生漂移。

复用组长群聊时，验收方案应显示为根层继承状态；已有普通 Loop+ 的单任务方案修改入口不能让部门组长独立覆盖根方案。若实现运行时修改，必须由用户在根层明确更新，宿主统一同步至全部相关组长及后续新建/恢复的组长；同步未完成或失败必须可观察，并阻止以不一致方案继续验收或整体完成。正在进行的验收需按既有安全重问机制使用一致的新快照，不将部分传播当作全部完成。具体同步身份、顺序和恢复字段待实现核对；本规格不宣称目前已支持运行时统一修改。

## 任务身份、会话与兼容

根部门任务拥有独立根任务 ID。每位组长拥有独立 Loop+ 任务 ID，显式绑定部门根 ID、组长身份及模块/交付目标；组长不能仅以根任务内一条普通 attempt 冒充真实 Loop+。员工隶属于组长的 Loop+ 子任务/attempt，并通过该归属关联部门。

总监主会话归根任务，组长主会话归各自 Loop+，员工执行会话归相应组长子任务及 attempt。展示 Tab、持久化任务 ID 与真实 CLI session 是不同身份；恢复绑定由宿主核验 CLI、档案和真实会话有效性。组长切换群聊不会借用总监 session，员工也不能任意引用另一组 session。复用[既有子任务会话规则](loop-subtask-session-reuse.md)，保留停止/失败诊断及配置不兼容时的可观察处理。

部门元信息应为可选、可识别的扩展，由宿主持久化并校验。现有 Loop/Loop+ 记录没有新元信息时，原模式、session 绑定、调度和展示继续工作；不从标题“账号组长”等文字推断部门，不批量改写旧记录。未知或无效部门关联可观察地拒绝新部门动作，不据此重分配旧任务所有权。`src/department.ts` 已实现 version 1 的 `DepartmentMetadata`：`rootTaskId`、`parentTaskId`、`leaderSubtaskId`、`role`、`moduleTitle`、三角色 `routes` 和 `limits`。`LoopTaskRecord.department?` 缺失兼容旧记录；非法数据以 `departmentInvalid` 显式保留拒绝语义，不按标题推断归属。员工执行身份仍由组长任务/subtask/attempt 关联，不要求每个员工变成独立根记录。会话 tab 投影使用宿主确认的任务、父子和 session 关系，只有角色图标装饰已有会话名，完整身份由既有 tooltip 展示；投影仅用于展示/模式提示，不授予组织操作权。

## 宿主封装与复用接口

下表保留逻辑职责；其已实现端口与未装配边界见表后，不将描述性接口名当作实际 API：

| 边界 | 输入及行为 | 输出/状态与权威来源 |
| --- | --- | --- |
| 总监组织适配器 | 接受总监分派/协调意图与角色配置快照，校验部门归属、额度和停止状态。 | 创建、绑定并控制真实组长 Loop+；根协调状态由宿主维护。 |
| 组长 Loop+ 宿主封装 | 复用现有 Loop+ 创建/续跑、派发、验收、补充需求、停止/恢复入口；注入部门身份与共享额度适配。 | 独立任务 ID、调度快照、验收与完成结果；Loop+ 自身为验收权威。 |
| 根层方案传播 | 复用模板选择与快照能力，接收根任务唯一方案，向既有、新建及恢复的组长传递；不接受组长覆盖。 | 全部组长使用同一根方案；若支持运行时更新，统一同步结果可观察，不一致时阻止验收/整体完成。 |
| 员工余额参考 | 每次组长派发决策前，由宿主提供当前部门额度/实际占用/余额、该组超额租约状态及快照标识或时间；读取失败明确未知。 | 仅供决策参考，不预留名额；不得伪造 0/20。 |
| 员工执行准入 | 由各组长既有执行宿主在真正启动前原子重判部门余额、该组超额租约、attempt 与停止代次。 | 获准后复用既有 CLI runner；常规余额为 0 时，每位组长最多持有一个未释放的超额员工。已有未释放超额时，不同新 attempt 明确拒绝并以 `failed` 进入 Loop+ 验收，不保留新 waiter、不启动资源；held/pending 的完整身份幂等、旧等待 API 与常规名额恢复后的授予仍保留。 |
| 运行中反馈与协作投递 | 接受有来源、目标和去重 ID 的组长请求；唤醒总监，由总监向目标 Loop+ 添加补充需求。 | 待处理/投递/失败/处理结果及回执；不能仅写入完成总结。 |
| 展示投影 | 读取宿主认可的根、组长任务与员工状态、额度和投递状态。 | 群聊与成员树只作投影，不能通过 UI 或模型直接修改任务 JSON。 |

已实现 `src/extensionHost/departmentorchestration.ts#createDepartmentOrchestrationHost`，返回根注册/恢复、组长启动、全树停止/继续、员工准入、总监协作处理及根完成检查端口；`departmentruntimestate.ts` 定义 version 1 组织快照（组长状态/代次、模块预留、协作、已确认根补充需求）。`LoopPlusRuntimeAdapter` 提供部门准入/容量观察及任务等待端口，通过既有 `runEventDriven` 创建真实组长。共享池通过注入依赖由同一组织 host 使用，而非复制调度器。

round 220/222/224 已审查的生产执行阶段：真实新建的组长任务由 CREATE 返回时记录进程内来源凭据；组长容量与成员快照持久化后、scheduler 首次 pump 前，生产 callback 对该新代调用 `Ledger.open`。同一个真实 producer 注入 Codex 与 OpenCode 员工准入，并由组长生产 host 挂接 Codex 原生 Owner；组长继续使用真实 Loop+ scheduler 和多轮原生执行。任务本地 `sessionId` 与原生 `executionSession` 分离持久化。关闭时同步撤销 `canLaunch`，保留 `isCurrent` 供最终身份复核，seal 原 Owner 并等待在途准备/责任结算后才尝试封闭集合。冷读或恢复记录不能被 producer 收养，completed、idle、空集合和普通 Promise 不能代替 drain。

这只是已审查生产接线的阶段，不表示所有身份的整组资源/容量门禁或完整根流程均已通过：round-228 已审查 Codex runner/session 释放映射、精确 tab 关闭、extension consumer 登记及原 Owner receipt 生成；round-234 将组长 lease 消费限定到同宿主新建且完整覆盖的 Codex 集合。round-239 补 OpenCode employee process 资源桥：原 Node Owner 以真实 child close/drain 为 runner 释放前置，随后释放 worker 配置租约并单独清理 overlay；私有请求原 EH tab capability 等消费者结束、核对原 identity、关闭并回读，process preparation 保留原 OwnerClient。round-350 macOS 安装版 EH 使用真实 Codex 0.167.2 binary、worker/parser/仓储及原 Owner，通过本机确定性 Responses fixture 完成公开新建场景的四项原 Owner receipt、自然清理、组长容量归还及合法再次派发；不是远程模型质量、所有 CLI 或跨平台证明。round-351 OpenCode 并行 tab 状态/输出/取消隔离及原 transport drain、round-353 Owner 消费者零重试各为独立受控回归。round-353 续接所有权窗口由 round-357 修复：首 await 前登记根级可撤销 token，stop/dispose 撤销，重复请求拒绝，迟到 finally 只移除自身 token；实体隔离 build 与 20 个不同 composition 用例通过。round-359 当时的公开 stop→continue EH 未通过：后继员工准备产生的新 session 与继续路径持久目标 session 不一致，组级清理核对持久 session 与原 Owner binding 时发现 `leader-cleanup-selection-conflict`，阻止整组清理并保留容量；后续 round-366 Codex 公开 EH 已完整通过，不删除或放宽清理门禁。tracker 和请求 token 只证明活跃编排/准备责任，不证明 native drain、完整 receipt、CLOSED 集合或容量释放。round-359 OpenCode 专题将 leader 的 native-session 检查接到 tab-isolated parallel consumer：每次调用读取持久 executionSession 并在调用内固定首次核验 ID，不写普通 metaStore 映射；8 项校验器与 1 项接线检查不证明真实 OpenCode CLI/EH 或整组容量。缺能力、拒绝、失败、identity 变化或断连仍保留 unknown/占用；原生 OpenCode session 历史不删除。OpenCode 组长明确模型/默认模型混合公开新建已有 round-369/372 证据，Codex 公开 stop→continue 已由 round-366 通过；OpenCode 全角色、未覆盖整树控制、跨代/冷恢复及必要平台仍待验收。员工消费者在自身成功 receipt 后归还员工租约，不表示组长/整组容量已消费。round-225 只改善 Owner 测试 fixture 的启动诊断与实际关闭断言。

round-320/321 已验证真实 Codex 0.167.2 在 macOS arm64、本机 Responses fixture 下由两个独立执行对象完成 thread/start、同一 thread 的 thread/resume 及两轮自然 EOF、stdio/NDJSON、execution drain 和 runner 收尾，无强制回收；该证据不证明生产双持久绑定、完整 Owner receipt 或容量。来源见[真实排空验证手册](../runbooks/department-codex-native-drain-verification.md)；生产整组资源/容量证据与此低层真实 native 生命周期证据分别核对，不把它记为从未验证，也不扩为所有场景通过。OpenCode 完整生产组合/整组容量、其它角色/CLI、未覆盖的全树停止继续、冷恢复、必要平台、最终真实 EH/UI、Git 同步合理合并及合并后全量回归仍为根门禁。

部门准入返回 `null` 拒绝，普通无部门任务返回 `undefined` 委托原准入；原端口也缺失时保持普通执行兼容。已有 overflow 时不同新 attempt 的 `null` 是明确拒绝，adapter 以 failed finish 进入既有验收，不应与可恢复 `stopped` 中断混淆。Codex 生产资源清理及其组容量消费有独立受审查范围；round 239 新增 OpenCode employee process 的 receipt 资源接线与混合 employee 集合观察，round 350 的 EH 仅验证 Codex 确定性 Responses 新建场景，不能把 OpenCode 接线当作完整清理通过。恢复依赖可信 `inspectLeaderSession` / `observeRestoredExecution`，不能用已结束 Promise 冒充存活执行核验。参见[Loop+ 调度](loop-plus-scheduling.md)。冷恢复、其他角色/CLI 和最终真实 EH/UI/CLI 组合仍待验收；模块存在不代表这些根门禁已经通过。CodeGraph 当前有未解析引用及新文件未覆盖，以上事实另经当前源码核对。

调度、资源名额、任务记录及快照写入由主机拥有。模型只提交受校验的分派、协调和补充需求意图；不能直接编辑任务 JSON、active IDs、Loop+ 快照或租约。封装保持单一调度/验收实现，不复制调度器、验收器或 CLI runner，也不直接改写其内部队列以绕过准入。

## 人数、共享额度与租约生命周期

人数设置通过 `src/departmentSettings.ts` 统一宿主/Webview 正数向下取整和安全整数规则。全局非法值回退4/20；工作区两项 optional 同名字段独立覆盖，非法/缺省读取继承全局，空输入删除单项，非空非法保存拒绝。PanelState原字段仍是全局值，`workspaceDepartmentMaxLeaders`/`workspaceDepartmentMaxEmployees` 为 number/null；空值显示继承全局占位。保存使用最新副本及宿主scope/requestId，完整临时文件替换成功才发布内存，失败保留已存配置。生产 `resolveDepartmentPromptConfiguration` 解析实际工作区有效值，冻结到新根，原后续准入消费该快照；本设置不热迁移旧根或重写冷恢复原代。设置值为：

| 键 | 默认值 | 语义 |
| --- | --- | --- |
| `departmentMaxLeaders` | 4 | 同一产研部同时运行的组长上限，没有超额例外。 |
| `departmentMaxEmployees` | 20 | 同一产研部全部组长共享的常规同时运行员工额度；零余额例外见下文。 |

两个值不是累计创建数量；成员结束后可创建/调度新的成员。等待名额的成员不占执行额度；组长和员工使用各自层级额度，不能按组长数乘出常规员工总额。组长在其真实 Loop+ 工作仍未结束（含待员工结果/验收）时不能仅因一次模型调用结束释放组长运行名额。员工实际执行结束且清理完成才释放员工租约，其结果仍可等待组长验收，不把待验收结果算作运行员工。

零余额规则是每位组长最多同时持有一个尚未释放的超额员工，不同组长各自受限；不是整个部门只能有一个，也不是每次派发都可以再加一个。组长人数没有例外。所有真实员工（含超额、停止清理中及恢复后仍存活的执行）均计入部门实际占用，余额 = max(0, 常规额度 - 实际占用)。余额不是“20 减常规员工数”，不得漏算超额员工。

每次组长派发决策前取得最新参考快照；未知项明确显示未知，不能伪造 0/20 或沿用过期值冒充当前值。模型看到的余额不预留名额；真实启动必须由宿主原子重判：余额大于 0 时按常规准入；余额为 0 且该组无未释放超额租约时才允许再派 1 个，否则等待。参考快照未知不等于零，仍需宿主核实后准入；并发组长可能看到同一余额，不能凭快照直接启动。

超额租约必须有部门、组长及 attempt 归属和可恢复的超额标记。重复派发不能为同一 attempt 取得多份租约；已有超额租约未释放时，该组不能取得第二份。扩容或其他员工结束使余额回正后，仍运行的超额租约不能被改标为常规、抹去或提前释放以再开例外；其实际结束且清理完成后，该组才重新具备一次零余额例外资格。池快照已保留 `employeeOverflow`，员工身份为规范化 `[leaderTaskId, attemptId]` 元组；组织快照单独持久化组长/代次与协调状态。生产快照持久化和真实冷重启接线仍待中央验收。

同一部门由拥有它的扩展宿主统一管理额度，各组不能各建一份“20 人池”。本设计不承诺多个 VS Code 宿主/窗口、不同部门或机器之间共享同一资源池；如果后续支持这些边界，必须有明确所有权、协调实现和独立证据。

已实现模块的生命周期约束（真实扩展链路仍待集成验证）：

- 申请额度、确认 attempt 身份、判断常规/超额资格和启动须受宿主统一原子准入约束；配置或 runner 准备失败回收未启动预留。额度可用及零余额例外均不绕过 Loop+ 本身的冲突、暂停或验收条件。
- 员工运行完成、失败或取消后，确认相应真实执行结束且清理完成再幂等释放常规/超额租约；不能因停止请求或状态标为停止就提前释放仍在写入的进程。重复 finish/cancel/停止回调不得重复释放或删除新 attempt 租约。
- 停止根任务阻止新组长和员工启动，并传播给所有相关 Loop+；停止单个组长仅作用于其成员。排队成员取消后移除等待，迟到异步准备/回调不能重新启动。
- 恢复前核对持久化部门/组长/attempt 归属、常规/超额标记、旧租约与真实活动进程：仍存活的执行占用名额，确认结束且清理完成的回收，未知状态保留阻塞和原因。不能盲目清池、丢弃超额标记或把快照全部重新启动；不同部门不能借用或释放对方租约。
- 失败、取消、停止、宿主中断、恢复及降低设置值时，都要防止越过上述有限例外、重复启动和租约泄漏。降低额度不强杀运行项，不冒充存量执行已经消失：组长达到/超过新上限时不能新增；员工余额按新常规额度重算，为 0 时仅可按每组一个未释放超额租约的规则准入，其余等待。降低额度本身不将存量常规租约改成超额，也不消除已有超额归属。池支持额度变更和根局部恢复；设置热更新到活跃根、持久化及真实恢复观察接线仍待集成，不据池接口推断自动热更新已完成。

`executableMember` / `validAttempt` 已在申请前及等待后核对当前 root/owner/member 关联、running 状态、组长 lease、代次、真实 task/subtask/attempt 与固定路由。持有租约不等于有执行授权：恢复观察拒绝后成员为 blocked，拒绝新准入，余额查询返回 null；迟到取得的仅本次新租约归还，原员工/超额/组长占用继续保留，健康同部门成员及其他部门不被清池。`continueRoot` 不能隐式解除未核验清理的 blocked。

Codex 整树停止后的显式继续合同要求原 producer 仍由同一宿主持有、原组完整 Owner 清理已核验、CLOSED 集合和全部 binding 可读、员工与组长容量已持久归还后，才能获得一次内存 continuation provenance。原代身份指纹不变；新 generation 单独打开新集合，并在 scheduler 首次 pump 前沿可信原生 session 取得/恢复真实任务 tab。原 native thread 仅用于同一任务会话的可信 resume，新代 Owner 使用新的 execution identity；旧集合、责任与 stopped/review 历史不重写、不收养。旧 generation callback 每次检查其原 scope，不能读写新代任务结果或释放后继租约。round-353 当时的 prepareRoutes 等待期迟到续接复活竞态仍保留为历史失败；round-357 已在首个 await 前登记同根可撤销 token，拒绝重复续接，stop/dispose 撤销并按 token 隔离迟到 finally，20 个不同 composition 用例分批通过，非一次全量运行。round-353 的实体 build 与 40 个不同定向用例继续按原源码范围复用；composition 的修复范围由 round-357 新证据覆盖。Codex 公开 stop→continue 的完整 EH 已由 round-366 接受。OpenCode round-382 后继已修复同宿主连续链及自身恢复来源识别：最多256项精确来源/目标链头，逐次核对原client、binding/selection、canonical目录、完整required receipt、原stopped和持久员工容量移除；未知目标不推进，旧来源不回退，竞争/迟到授权拒绝。实体build、26个不同定向用例和代码合同审查通过；未运行连续公开EH。tracker 和 token 不证明原生 drain、完整 receipt、CLOSED 集合或容量释放。OpenCode 冷恢复、真实模型/完整 VS Code UI 或其它 CLI 的恢复路径也未由该受控场景证明。

已获 grant 的原代 stream callback 在 generation closing 时仍可通过只读 `observationScope` 核对其捕获 scope，并仅向同一个 Leader 对象的当前消费者完成 ack；启动、binding 和新 grant 继续要求 `canLaunch`。新代已建立后，旧 scope 的观察拒绝，不会借用 successor 的 consumer。只有完整清理、CLOSED set、持久容量归还和 binding/session 校验都成功后才退休原代：非 completed 且可继续任务保留一次性内存 provenance，成功打开 successor 后消费；completed 任务不持有 continuation proof。未知或失败清理既不退休也不驱逐 producer 的有界责任引用。

## 运行中协作与补充需求

协作流程为“来源组长→总监→目标组长 Loop+”。组长在执行中发出请求时，总监应获得可处理事件并及时协调，不以整批组长全部结束为前置条件。由总监向目标组长的真实 Loop+ 添加补充需求，复用其排队、唤醒和重新调度能力；不能让模型直接写另一个任务的 JSON 或通信路径。

跨组消息的逻辑信封至少包含部门根 ID、来源组长任务 ID、目标组长任务 ID、稳定去重 ID 与请求正文，宿主验证二者确属同一部门。记录来源及目标可供群聊查看，回执区分“已进入目标补充需求队列”和“目标已经处理”；已入队不等于已完成协作。

宿主需持久化/恢复待投递状态及去重依据，重试沿用同一 ID，重复事件不重复添加需求。目标忙碌时复用既有补充需求队列；目标不存在、停止、失败或已完成时，向来源与总监展示明确结果和未处理事项。`coordinateCollaboration` 将 stable ID、来源/目标/正文保存到组织快照并标为 `pending` / `awaiting-director`，`processDirectorCollaboration` 核验运行目标后调用既有 `submitUserMessage(taskId, text, deliveryId)`，目标队列持久化同一 ID/正文且同文幂等、冲突拒绝。round-366 已验收总监循环由组长新建/续接真实结算唤醒并在公开 Codex stop→continue 流程继续协调、再派发和最终汇报；这不代表所有 CLI/失败恢复下协作组合均通过。`delivered` 仅表示入队，不能静默重开完成任务或跨部门替代。

根完成检查与新消息入队必须有宿主顺序保障，避免检查后丢掉协作请求。失败投递仍是开放事项，直到已重试成功、重新分派或显式处置并留痕；仅把错误写进总结不算处理。

## 状态与完成边界

以下是展示/协调语义，不新增或承诺已实现的枚举值：

| 对象 | 非终态边界 | 完成依据 |
| --- | --- | --- |
| 员工 attempt | 等待名额、准备、运行、停止清理中；完成/失败结果可能仍待验收。 | 真实执行结果提交给所属组长，执行结束不等于验收通过。 |
| 组长 Loop+ | 员工活跃/排队、结果待验收、验收修补、补充需求待处理、暂停或错误未解决。 | 该真实 Loop+ 所有验收及完成门禁通过并持久化完成；一次回复或全部员工退出不够。 |
| 总监/部门根任务 | 有活跃、待启动或未处理的组长，未处理反馈、未投递协作或未消费补充需求，失败/取消工作尚无明确处置。 | 总监依据组长有效结果确认总体目标达成，且宿主核对无开放工作/消息/租约清理；不进行代码或测试验收。 |

总监整体完成受“全部组长有效完成或已显式处置、全部补充需求和协作已处理、没有活跃执行和待清理资源”约束；若支持根层方案运行时更新，尚未完成统一同步同样阻止整体完成。停止与失败不是完成；取消组长不自动视为目标完成，需要明确处理剩余工作。总监不检查代码，不执行验收，不能覆盖组长验收失败，也不自行运行代码或测试来替代组长 Loop+ 门禁。

组织 host 的 `canCompleteRoot` / `confirmRootComplete` 已同步核对唯一模块归属、全部真实组长完成且验收通过、无运行/排队/复核/用户消息、无模块预留/员工/组长占用、无澄清、根补充需求已确认且协作已投递或显式处置，再确认完成写入。中央 production composition 已装配总监根创建、启动、协调和控制入口；round-350 新建 Codex EH 覆盖总监派发/协调和汇报确认的限定场景，但 round-359 后继清理冲突阻止该公开流程完整通过。总监仍不承担代码或测试验收职责。

## 界面规格（展示及授权模块已实现，待生产集成）

沿用现有简体中文、VS Code 主题语义色、工具栏和窄屏成员抽屉，不重新设计布局或交互体系。

- 成员树为总监→按模块/交付目标命名的组长→各组员工，显示所属关系和真实状态。模块命名用于可读性，不强制每个任务按模块拆分。
- 总监群聊专门呈现协调职责：粗粒度分派、组长进度汇报、待处理协作请求、向目标组追加补充需求的投递/失败状态，以及整体完成的开放事项；按汇报驱动经典 Loop 展示，不放入总监代码检查或验收职责，不以最终总结替代运行中协调。
- 总监页的组长入口在页面内弹窗打开对应组长群聊，不默认新增组长 Webview 标签。复用同一群聊展示与操作能力，组长弹窗保留现有 Loop+ 完整同排操作栏及其可用性规则，不用精简按钮替代；所有读取、提问、补充需求及停止操作绑定宿主校验的对应组长任务 ID，验收方案受根层统一契约约束，继承方案不可独立覆盖。关闭弹窗不停止任务，回到保留原阅读位置的总监页；普通旧 Loop/Loop+ 群聊不被强行改为三层。
- tab 标题保留现有会话命名、编号、重命名和持久化值；总监 👴🏻、组长 👨🏻、员工 👶🏻 仅作为可见名称前的展示图标，不追加角色、模块或任务编号文本。无可信角色投影时显示原普通标签。tooltip 承载完整角色层级、模块、root/task/员工 ID；浏览器提交的展示字段不建立身份。
- 总监/组长/员工的会话投影须绑定真实任务与 session；同名会话可保持同名，不能用成员树头像、CLI 相同或静态标题推断角色。隔离 Extension Host 已检查真实面板投影、原名与弹窗入口；它不替代生产组织启动、冷恢复或真实 CLI/模型执行验收。
- 人数设置说明明确“默认同时最多 4 名组长，无例外”“全部门共享常规 20 名员工”“零余额时每位组长最多一个未释放超额员工，实际结束且清理完成释放”；余额展示包含超额占用，未知明确未知。角色 CLI/档案/模型/思考配置入口已有独立接线和就绪校验，不能拿配置表单存在表示三层真实执行已完成。

round-121 已在隔离 macOS Extension Host 的真实生产任务/会话恢复路径补验指定组长的页面内弹窗：实际 sandbox srcdoc、精确 leader task 身份、历史状态的完整现有操作栏、单次展示关闭且无 stop/cancel、来源按钮焦点/原阅读位置恢复，以及实际可见 275px Webview 的 tab/tooltip/溢出。证据与限制见[角色会话验证](../runbooks/department-conversation-verification.md)；这不是运行态操作、跨主题真实 EH、真实模型执行、冷恢复或组织全组合通过。

群聊展示/授权模块已实现记录驱动的成员树与页面内组长弹窗、完整同排 Loop+ 操作、动态主题桥接及关闭后的阅读/焦点恢复。每次敏感动作及 await 后副作用/回包，协调器重新核对当前根、组长、workspace、模块、`event_driven`、`departmentInvalid` 和 taskId/instanceId 绑定；浏览器标识或旧投影不是授权。关闭仅释放展示/提问/资源订阅，不停止已提交任务。根控制端口缺失时拒绝，方案保持只读。详见[群聊展示接口](department-group-chat-ui-contract.md)，其中真实宿主导航/资源/CSP 和员工 tab 仍有集成门禁。

| 界面状态 | 最低可读要求 |
| --- | --- |
| 默认 | 显示角色、任务归属、常规额度与实际占用/余额、该组超额资格；总监展示协调事项，组长弹窗显示完整同排 Loop+ 操作栏，动作中文标签清楚。 |
| 加载 | 区分正在加载与真实零成员；弹窗切换组长时清楚标识加载目标，不展示上一组的内容或接受旧异步结果。 |
| 空 | 说明尚未分派组长/员工或群聊尚无消息；未接通能力不伪造运行成员。 |
| 失败 | 显示读取、配置、投递或运行失败的具体原因及适用的恢复动作；弹窗失败仍可关闭回总监，不误报为空。 |
| 禁用 | 无权限/目标无效/停止或未接通时，动作禁用并有可读原因；组长不能独立修改继承方案。 |
| 键盘焦点 | 可用成员与导航入口支持键盘触发，有可见焦点和可读名称；弹窗打开后焦点进入弹窗，Tab 不落入背后总监页，Escape/关闭按钮关闭后恢复至来源入口，入口失效时落到可用总监控件；抽屉沿用现有关闭/焦点规则。 |

页面内弹窗复用现有主题与组件的颜色、字号、间距和关闭交互；背景总监页阅读位置在打开、内容刷新、关闭后保持。窄屏群聊继续使用成员抽屉，不新增另一套布局。弹窗宿主需按当前目标与打开代次绑定异步返回，关闭/切换后的迟到消息不能污染其他组或总监页；关闭只结束展示订阅，任务继续运行。这些展示机制已有独立实现、浏览器夹具及上述限定历史 fixture 的真实宿主证据；未覆盖的运行态、主题和交互组合仍须集成验证。

## 生产归属索引与存储事实

`src/extensionHost/departmentOwnershipIndex.ts` 已实现按规范化物理文件路径替换贡献，并按 workspace/root/module 查询，更新只处理变更文件。相同任务 ID 在不同物理文件、相同模块的多个任务都保留歧义，不采用最后写入覆盖；授权须恰好一个 ID，再经 `readTaskRecord` 从唯一物理来源重读当前记录。读路径不重新枚举任务目录，不缓存旧授权结果；发现缺失、重复或归属改变即拒绝/失效。

`new`、`rebuilding`、`invalid`、`disposed` 均不授权；订阅/读写失败、未知来源变更或租约撤销使完整性失效，仅显式成功的完整 `rebuild` 恢复可用，单次成功写不能自愈。生产入口 `createDepartmentProductionTaskStore` 将 `DepartmentOwnedSourceController`、`DepartmentOwnedTaskRepository`、identity catalog、正常任务写入与 owner router 连到 `extension.ts#getDepartmentOwnershipIndex`；round-101/102 已审查生产挂载、读取/写入确认、持久身份和清理保留语义。更早的 lifecycle host 拒绝测试不是当前 extension 未装配证据。仍开放的是所有旧二进制/外部直接 writer、跨进程代际交接、冷启动重建与真实退出完整性；在来源失效、无法确认或授权缺失时继续 fail closed，不回退全库扫描授权。

`src/loopTaskStore.ts` 提供结果式读写、确认删除、严格发现和同步变更事件。普通严格 `writeLoopTaskStore` / `updateLoopTaskRecord` / `appendLoopRound` 在真实读取或写入失败时传播原异常及 errno；`writeLoopTaskStore(): void` 正常返回表示提交已确认，void 签名不表示静默失败。显式 boolean try 端口在未提交时返回 false；真实缺失任务保留原 null/no-op 语义，身份或输入拒绝边界不因此放宽。普通宽容查询仍兼容，不能把容错读取结果当作提交依据：提交读取完整拒绝损坏 JSON、错误 shape 和无效记录；完整索引读取也不把坏文件或已发现后消失的文件伪装为空库。字节写入采用同目录 stage 加原子 rename，rename 前失败保留旧字节并尝试清理临时文件；文件持久化及 identity catalog 发布确认后才发布成功贡献与缓存，失败使来源失效。

普通跨文件迁移先完整校验 source 和 target、保留兄弟记录，以目标持久写入及 catalog 发布为 commit，再维护旧源。之后源重写/删除失败属于维护失败，记录错误并保留恢复材料，但仍返回已提交身份，不撤销目标权威或让缓存、冷查找、时钟回退重选旧副本。catalog 的 `ordinaryMoves` 是可选内部元数据，形如 `{ taskId: { file: 已提交普通目标绝对路径, sources: 已知旧源链 } }`；旧无字段 snapshot 仍兼容，普通历史来源不能据此提升为 owned。相对/绝对/dot/大小写等别名须按规范路径及文件系统身份判断；确认同一文件时保留实际已知位置，不删源或重复迁移，不按平台盲目统一大小写。最终文件 symlink 仍拒绝，合法目录别名兼容；这些实现约束不表示全部 Windows/Linux 文件系统组合已实测。

已知普通读口 `readKnownOrdinaryLoopTaskRecord` 在同一非重入 writer gate 内按当前 catalog 服从已提交目标；仅无 move 时使用精确已知来源。目标读取失败、缺少任务或目录无法确认即 null，不枚举全库、不回退旧副本、不缓存旧授权；owned、墓碑、受控来源及无效部门身份继续拒绝。短暂锁竞争立即拒绝，后续调用重新读取，不盗锁、等待或自动恢复。

普通任务 retention 以单个已发现文件为有界批次，在同一 writer gate 和当前 snapshot 内完整校验（包括过期记录）、分类、过滤及提交；每文件一次 catalog 读取，不分类后另起 writer，也不嵌套同一非重入锁。锁未知、catalog 损坏或未发布时整文件保留，恢复后须重新分类，不依据未知取得删除权；已确认旧源可清理，兄弟及当前有效目标保留。首次普通安装真实无 catalog 保持兼容，不授权部门通信 GC；后者缺失、锁定、损坏或未发布目录时整次删除拒绝。此批次不是全库原子快照，不跨调用缓存授权，也不增量修复未知 catalog。

普通原子提交及提交后的维护失败，不等同 owned 多文件事务：owned 写入未确认或部分提交仍保留 `ready=false`，不能以普通旧目录恢复或源清理合同宣称 owned 成功/回滚。受控根、持久 marker、catalog/tombstone、未知身份 fail-closed、owner 交易、普通记录不可提升、最终文件 symlink 拒绝及合法目录别名保护均保留；未知目录恢复和失效索引恢复仍须显式 `recover` / 完整 `rebuild`，单次成功贡献不能冒充完整重建。存储成功仅表示当前受支持端口确认，不代表旧二进制/外部直接 writer、真实多进程压力、崩溃断电、冷恢复或全部平台门禁已通过。

## 给 AI 的提示示例

下面仅为解释组织与协作的例子，不是硬编码模块规则或已运行记录：

> 总监将账号、报表两个模块分别交给不同组长；组长各自通过真实 Loop+ 拆解接口、页面、测试等员工任务，员工共享全部门常规 20 个运行名额，零余额时各组长最多持有一个未释放的超额员工，派发参考最新余额，真实启动由宿主重判。账号组长在执行中发现报表需要同步用户字段，通过总监请求协作；总监立即向报表组长对应 Loop+ 添加字段约定的补充需求。报表组长收到并纳入其调度/验收，处理结果经总监反馈账号组长。各组 Loop+ 验收完成后，总监确认整体目标达成，不重复验收代码或测试。

实际拆分按可独立交付和依赖关系选择，不强制每次按模块，也不要求每组耗尽名额。

## 验证与事实同步

本文需求来自父任务原始目标和 14 项补充需求；逐项实现、验收与剩余项映射见[部门逐项验收覆盖](../runbooks/department-acceptance-coverage.md)。模块事实由父任务 `communicationFile` 指向的已接受报告和当前源码共同核对。文档/ontology 检查不证明未覆盖角色的生产启动、跨代冷恢复、必要平台或合并后的全量回归。根计划保持 `in_progress`，功能清单保持“开发中”。

后续实现至少核对：角色配置及 session 隔离；4/20 常规并发、每组一个零余额例外、超额计入占用、最新余额/未知提示与启动原子重判；跨组等待/释放及不同部门隔离；失败/取消/停止/恢复/容量降低、扩容与余额回正不抹去运行超额租约；根方案快照继承、模板编辑隔离、组长覆盖拒绝，以及若支持运行时更新时的统一传播与失败恢复；真实 Loop+ 验收门禁；运行中协作投递/去重/不可用目标/跨部门拒绝；旧记录与原 Loop/Loop+ 回归；Chromium 宽窄屏与 VS Code 主题下的总监协调内容、组长弹窗完整同排 Loop+ 操作栏、设置及余额未知态可读性，页面内弹窗的目标绑定、阅读位置、关闭不停止和焦点恢复；已验收展示范围与未验收的完整组织启动/恢复分别记录。各证据注明实际平台和未覆盖项。

截至本批已核对源码并同步 ontology 域、既有跨域功能变更流程及架构导航；只登记已实现模块合同与装配限制，不将未验收中央/tab 变化登记为当前运行保证。运行时元信息/组织/容量快照各有独立格式，ontology 只是仓库语义导航。

### 冷宿主执行观察边界

round-382 Codex-only 冷启动真实尝试在公开 UI 发送前因缺少 Playwright 模块失败；没有创建任务、binding、Owner 或第二 EH 观察。round-400 的一次冷运行则证明员工 binding、原 Owner `live`、首 EH 正常退出，退出后持久 binding/容量仍保留；第二 EH target discovery 超时并触发强制卫生回收，未有公开 stop、warning 或第二宿主控制后快照。两次均不证明生产冷恢复成功或拒绝行为完成。running leader 缺原 producer provenance/完整 aggregate 时仍以 `live-leader-unverifiable` 拒绝并保留容量；round-400 任务没有抵达该拒绝观察。

跨 Extension Host 的冷恢复仅允许对权威任务、精确 execution binding、固化 CLI/session/selection 和当前容量租约均一致的员工执行连接原 Owner 做只读观察；受控 Codex/OpenCode Owner fixture 覆盖该合同。观察不启动替代执行、不消费 binding，也不单独释放容量。缺失/冲突 binding、配置漂移、Owner 不可达或 unknown cleanup 均保持占用并阻塞。组长恢复仍 fail-closed：新宿主没有原 producer generation provenance 和可达的完整协调 Owner aggregate，目标合同由 `recoverRoot` 以 `live-leader-unverifiable` 拒绝并保留持久容量。round-405 的公开 stop 未越过路由准备前置，得到 `invalid-recovery`；round-408 修复原 `prepareRoutes` 顺序及异步后身份复核后，公开 stop 到达生产观察器但 warning 为 `unverified-leader-session-or-plan`，仍未抵达目标拒绝分支。源码/只读诊断指向 `inspectLeaderSession` 冷 tab/session 关联边界，未直接捕获实际私有 tab 分支；unknown producer/Owner 责任继续占用。上述 round-405/408 执行结论属于各自历史快照。round-410 已以只读持久身份核验实际到达 `live-leader-unverifiable`，并通过完整四阶段身份/责任/保留容量及无新 grant/request 对照；身份成立但无真实 target 仍拒绝执行，磁盘 receipt、CLOSED 集合或任务 idle 不能重建 producer 或授权重放。安全拒绝不等于可恢复接管。

已有结果按原报告范围复用：round-350 限定新建 Codex 真实 binary EH；round-366 Codex 公开 stop→continue 全流程通过；round-369/372 分别为 OpenCode 组长明确模型与混合默认解析限定组合；round-375 三角色全 OpenCode 默认模型公开新建 EH 后继接受，覆盖两模块、四原 Owner 完整 receipt、两 CLOSED 全集、容量归还后再次派发及总监汇报。round-378 与 round-382 的各自边界见上文。round-400 连续公开执行确已两次 stop/continue 到 A→B→C 并收集 8 Owner/4 CLOSED、C 验收、第二模块与总监汇报事实；完整 driver 原始结果 failed，修正后的只读离线审计 3 项通过，但并非新的单次 EH 通过，且执行快照与最终 observer 源码有差异。round-400 passive observer 的 10/10 定向结果只验证 fixture IPC 观察边界；唯一冷运行未到公开 stop/warning。round-376 managed-main 工具交互仅是 headless one-shot 证据，不是新 EH 或 Owner/容量证明。round-121 验证历史组长弹窗、角色图标、275px Webview 与焦点/滚动恢复。各结果不合并为一次全量运行，也不证明冷宿主恢复或必要平台。round-357 的 20 项仍仅为首 await 续接撤销窗口定向证据。已装配生产 source store 不等于全部 writer 已受控；后续可复用来源/权限回归，但仍需核对跨版本/外部写者与真实冷宿主。最终合理 Git 合并和合并后全量回归仍待执行。

## 停止后显式修复的组织完成结算（round-364）

会话来源与需求修复是两份不同事实：`continueFromSubtaskId` 仅用于兼容原生会话恢复，不能结算历史失败。生产宿主成功验证并提交当前 `accept` 批次后，依据其中 **failed** 的 `reviews[].subtaskIds`，为成功派发的新子任务写入可选 `repairSource = { subtaskId, attemptId, finishEventId }`。来源是实际 scheduler finish event，字段由宿主产生；模型填写的同名元数据不进入记录。passed review 的独立 follow-up 不取得修复关系。同一子任务的新 attempt 继续按最新 attempt 验收，不添加替代边。

验收提交失败不派发；派发、保存或读回未确认时不启动后继，撤下本请求的修复关系，不能由迟到保存恢复。记录恢复只保留严格三字段的来源；坏记录保留无效哨兵，组织完成继续拒绝。旧记录没有关系时不能依据标题、prompt 或共享 thread 推断修复。

组织完成同时要求 task completed、scheduler completed、非空且全部 passed 的最终需求覆盖，以及无 running/pending/review/currentReview/userMessage/clarification/parentStopped。每个子任务最新 attempt 必须 reviewed；真实 completed/passed 的交付可直接通过，历史 failed/stopped 仅在其**当前精确 attempt/event**的全部修复后继最终通过时结算。失败历史不删除、不改写。缺源、错 attempt/event、源后来新增失败、无关失败、未审/停止/失败后继、重复身份或循环均拒绝。多级关系以严格时间向前的边和反向单次结算解析，排序后 O(n log n)，不递归也不重复全量扫描。无失败的直接工作仍可在明确最终需求覆盖及其余门禁成立时完成。

这是交付结算规则，不能证明 native drain、receipt、CLOSED 集合或容量可归还。精确 session/config、原 client、完整责任集合、原 Owner 八项 required facts、持久租约移除先于后续派发的合同保持不变。冷恢复、真实 OpenCode 完整 EH、Windows/Linux、真实模型质量、Git 合并和合并后全量回归仍独立开放。历史 round-362 已证明原 thread 保持、四原 Owner 完整 receipt、两代 CLOSED 和持久容量归还，但整体在 successorCompletion 失败；该历史不被本次修复抹去。


## 续接组长结算与总监循环交接（round-366）

新建、显式续接及恢复观察统一从组织 host 的 `track` 收尾通知 `leaderSettled(root, task, generation)`，不再只为新建 `startLeader.done` 挂独立汇报。每代通知一次，仅当前归属/代次有效；中央 composition 重读根、成员、工作区和角色配置后汇报真实状态并增加 wake revision。清理未知可以报告 blocked，但不能完成或归还容量；通知发生在既有清理观察、持久结算及编排 ownership 释放之后，不构成清理凭证。停止/dispose 后迟到通知不复活根。

总监 controller 的 `run` 保存包含错误处理与 ownership 释放的完整 Promise。显式继续在取得自己的 ownership 后等待旧 run 的 finalizer，再复核同一请求、stopRevision、工作区/配置/目标后恢复组长并移交同一 release。旧循环固定 stopRevision，模型返回后先检查撤销，不能处理旧代完成、停止新循环或释放新代 ownership。同根无并行总监循环；模型调用期间到达的 wake revision 在返回后消费，不依赖轮询或定时器。首次可信原生绑定允许本地 transcript 占位 session 交接到模型回传任务、持久任务和真实 tab 三者一致的 session；已绑定 session 变化或读回冲突仍拒绝。

不改变 repairSource、历史失败、最终需求覆盖、开放工作门禁或精确清理合同。tracker、结算通知和 wake 均不能替代原 client 完整 receipt、CLOSED 全集、最终冷读及持久移除先于容量 release。实际验证结果与历史失败见[公开 EH 运行手册](../runbooks/department-full-eh-integration.md)。

## OpenCode 组长 canonical 根与限定混合 EH（round-369）

OpenCode 组长每代由原宿主在 Ledger 准入后创建唯一 canonical 隔离根，准备服务和全部原生任务使用同一真实 cwd；准备时核对原生 session directory，任务继续核对固定 executionSession/CLI/config revision/原 binding。固定 worker 仅持原 host root capability，release-root 必须由原代宿主验证并清理，完整原 receipt 与 stopped 双确认后才可能参与 CLOSED 全集聚合。round-369 时跨代 session directory mismatch 会拒绝；round-378 已证明受控同宿主来源移动的单次新目录匹配及后续冷读；round-382 已修复 A→B→C reservation 与自身重试来源识别，实体build、26个不同定向用例及代码合同审查通过，但没有连续公开EH。冷宿主 running leader 仍因缺原 producer provenance/完整 Owner aggregate 而 fail closed。

round-369 独立公开新建组合仅为 Codex 总监、OpenCode 组长、Codex 员工：通过真实工具设置、角色/明确模型、一次统一方案及 sendPrompt，从空库完成两模块真实 Loop+ 事件验收、四原 Owner 完整 required receipt、两个 CLOSED 全集、持久容量归还后的下一模块实际执行与总监最终汇报。免费 loopback Responses/Chat Completions 分别驱动原 CLI，非真实模型质量证明。默认模型 null 在现生产精确选择复核处被拒，首份失败保留；明确选择 `isolated/native-drain` 的限定组合通过，未修改生产门禁。全部身份、命令及源码差异见[公开 EH runbook](../runbooks/department-full-eh-integration.md#opencode-组长的限定混合公开场景round-369)。Codex round-366 公开 stop→continue 保留；OpenCode 员工、全角色组合、跨代/冷恢复、必要平台、来源租约及最终 Git 合并后回归仍独立开放。


## OpenCode 默认模型的有效执行快照（round-372）

持久偏好及面板的 `model:null` 继续表示所选 CLI 档案的默认；仅新根可信宿主解析将三角色 OpenCode 默认固化为同 CLI/configId 的具体有效模型，显式模型及 Codex 默认不变。候选按确切档案校验模型、变体和力度，并以不含配置正文的读取修订标记核对两次读取；每次 OpenCode 档案读取前后核对共享选择修订，等待后复核工作区/目标 tab/会话、模型选择、heartbeat 与保存屏障。内容、配置修订、偏好或作用域漂移拒绝，不将新的默认静默用于已解析请求。执行快照进入 root 后不再跟随配置默认变化；selection、argv/overlay、binding 和原 Owner 清理继续核对具体相同模型，不重写旧任务、不认领未知 Owner。缺失/非法默认、错档案及不适用变体/力度仍拒绝。读取修订不进入执行快照，也不授予执行或清理权限。

默认模型的 Codex 总监/OpenCode 组长/Codex 员工混合公开新建组合以及 round-375 三角色全 OpenCode 默认模型公开新建组合，均在各自 macOS 安装版 CLI/EH 快照中通过；round-375 的四原 Owner 完整 receipt、员工 stopped、两个精确 CLOSED、首次 grant 前身份/binding 持久回读、容量归还后第二次实际派发和总监最终汇报按该场景成立。round-375 整体 attempt 的 failed 历史保留，后继 round-376 只修复 managed-main 权限/活动/agent 兼容缺口；其 headless OpenCode 1.19.5 one-shot 交互不是新公开 EH 或 Department Owner/容量证明。round-369 首次默认模型失败和早期检查失败均保留。OpenCode 员工真实原生目录/排空/完整 receipt＋stopped、round-372 根能力捕获及 finalizing 观察按原独立范围复用。OpenCode 原会话跨代目录交接/公开继续、冷恢复、必要平台及最终 Git 同步合理合并/合并后全量回归仍开放。已有 round-121 真实弹窗/275px/焦点和非零滚动恢复、动态主题及 round-338 深浅主题 tab 证据按未变范围复用，不笼统重开主题/窄屏门禁；远程付费模型质量不是额外用户要求。命令、原身份与快照差异见[专属 runbook](../runbooks/department-full-eh-integration.md#opencode-默认模型公开路径修复round-372)。
