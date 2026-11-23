# 产研部模式：需求与设计边界

## 新任务的轻量 Loop+ 封装（2026-11-22）

总监仍用经典 Loop 做模块分派和汇报汇总。新根记录固化 `executionMode: "loop-plus"`，组长从根继承；组长的主回合、员工 attempt、会话续接、失败复核、验收和显式停止复用普通 Loop+。组织层保留角色路由、独立会话、统计和汇报，不因员工额度、独立 Owner/producer 或清理回执阻塞 Loop+ 派发。归还组长占用用原调度生命周期和实际 idle，不生成 Owner 清理凭证。

新产研部员工以真实工作区为执行目录，读取该工作区的项目指令，使用相对路径创建的顶层文件直接进入交付目录。Grok 和 DSH 仍按原协议使用稳定隔离目录来续接会话。

无该标记的历史记录仍属于原 Owner 路径；本变更不接管、迁移、自动重跑或假定原执行已清理。下文 Owner 相关说明与证据仅适用于该历史路径。对新版任务，显式停止后可继续；故障重启并留下未确认活动占用的场景不自动重放。

## 整组中止

总监群聊和总监标签页的“中止”都关闭当前产研部的派发，停止总监 Loop 及组长 Loop+ 和其活动员工。即使某个组长已标记阻塞或正在单独收尾，其它组长也会立即收到停止请求。宿主在同一次中止中处理原执行清理和状态保存。已停止且无待清理执行的任务重开后可以直接继续。群聊按钮及续接反馈见[群聊交互契约](department-group-chat-ui-contract.md)。

## 当前无锁配置边界（2026-11-18）

角色路线仍覆盖 `CLI_LIST` 全部 CLI，并沿用有效角色档案、可信 Owner 身份、代次、账本、准入、排空与清理归还。配置由准备时可信宿主读取并冻结；不以共享选择 revision、配置锁或执行租约挡住跨窗口任务，最后完成写入生效。下方早期配置 ABA/共享 revision 文字仅记述历史设计，不能作为新增门禁依据。

- 日期：2026-11-13
- 状态：原 feature 实现与既定交付范围 completed（Round723，截止 lp722 已独立接受）；2026-11-17 角色模型表单 bugfix 的产品与主干合并已主审接受，原计划 completed 并归档；最终记录仍待独立文档主审，未发布。
- 根 feature：[执行计划](../exec-plans/completed/2026-11/2026-11-13-feature-department-mode.md)
- 当前清单：[功能总表](../product-specs/FEATURE_INVENTORY.md)

## 本次表单修复状态（2026-11-17）

[本次 bugfix 计划](../exec-plans/completed/2026-11/2026-11-17-bugfix-department-model-form.md)已按真实接受事实完成并归档。总监当前模型/力度可操作，组长、员工各只有 CLI/模型/力度，OpenCode 单力度槽，顶部 CLI/档案/模式及原主题布局保持；本节替代旧版独立档案选择要求。同 CLI 使用总监当前档案，跨 CLI 使用目标已确认激活档案，缺身份拒绝，不自动激活或使用首档；内部精确 configId 仍保存/冻结。

父主通信 lp5 已接受宿主 ready/configId/revision 与独立选择上下文的候选/保存/新根 ABA 防护、落盘成功才发布内存；lp8 已接受同 panel 先应用模型状态、四节点恢复、目标修订/迟到回执隔离和模式切换先失效令牌再执行完整 `syncModelSelectorByInteractiveMode`。主审已对照总监普通主模型/力度与 OpenCode main 模型/variant 的消息、存储及实际启动读取，确认同一选择；角色载荷经生产 validator 和隔离 WorkspaceSettings 保存核对。

复用宿主标准 build/89 项、UI 标准 build/11 项及最终生成生产 Webview 桥接 smoke（严格错误 []、1280 深色/280 浅色截图已主审）。这是代码组合审查与生成页面 fixture，不是真实 EH/CLI。lp9 已接受最新 fetch 主干 `61b00091` 合入实际分支，最终 HEAD `1e1c0d3e18003c5e0578f87eb61e90286698718d`（另一父为 `d136369f`）；最终 build 通过，夹具修复后 37 项加未变六文件 256 项复用，去重 293，非最终全套重跑。原 18 项未暂存/3 项未跟踪和权限恢复，stash/备份保留，无推送或发布。真实命令、失败分类及限制见归档计划。

下方 Round723 及更早收尾、失败和限制保持其历史输入与范围，lp1/lp2/lp6/lp7 未接受及后继修复记录亦保留在本次计划，不以成功覆盖历史。旧 5469 项全量和冷恢复不证明本次新交互。最终记录的独立文档接受与父任务宿主完成状态仍由主审决定。

## 当前交付状态（Round723）

lp721 正常合入及 lp722 原目录安全交接已接受，原 feature 计划已按 2026-11 归档。原目录占用交付分支，本轮基线 f787/tree4777；master ref 未改且切换前 clean，原整合树 detached f787。228 原 untracked 受限归档、106 tracked 精确恢复，334 完整回滚映射和原件保全继续有效。中间 raw-index 封口 exit1 与三个稳定窗口/1151 条仅 106 stat-cache 变化、零 stage 语义变化的诊断保留，actor 未知，见[收尾覆盖](../runbooks/department-acceptance-coverage.md)。

复用 lp715 一次标准 build 及官方 397 文件/5472 项（5469 通过、0 失败/取消、3 门控跳过、自然 exit0）和 lp719 唯一 180 秒 mixed 冷链 exit0，按原 receipts/CLOSED、持久容量、authority 自然退役、公开 continue 唯一后继、OpenCode 原 session/move-readback、最终公开 stop 及直接 workers 观察范围成立。总监最终业务汇报沿用 round-366/375 等相应历史接受证据，不由冷链推导。原生 Windows/Linux、三 DSH live 门控、模型/任意崩溃/外部 writer/全部后代限制仍有效，ignored dist 可能与交付源码不同且未更新/验证。本轮无业务合同或运行实现变化，不重跑运行验证。

下方旧开发阶段及“待验收”叙述均保留为其时点的历史事实，由本段和覆盖表给出现行截止；不改写失败历史，不把强制卫生回收称自然退出。

## 历史需求与交付边界（保留原文）

在现有 Loop、Loop+ 之外提供“产研部”，形成总监→组长→员工三层。人数设置、模式/角色配置与就绪门禁、中央组织 host/Loop+ 装配、容量策略与余额提示、记录驱动群聊、生产来源 Controller/Repository/identity catalog 路由和若干真实公开宿主场景已有分范围实现及审查证据。仍须区分生产接线、特定平台/角色/执行代次的端到端证据与完整根门禁；本设计状态仍为开发中。

| 层次 | 本批可记录的事实 | 尚不能据此宣称 |
| --- | --- | --- |
| 已实现模块 | 三层身份、组织 host、真实 Loop+ 适配、参考额度与执行占用记录、根方案继承、总监中转协作、弹窗授权、文件贡献索引及确认写入端口。 | 全部直接/旧版本存储写者的可信协调、跨宿主冷恢复和完整组合仍未全覆盖。 |
| 已装配能力 | 中央生产 composition 持有组织/容量 host，并接入 Loop/Loop+ 创建、协调、员工准入、受限 Owner 和生产来源 store；群聊查询经专用 Controller/Repository/identity catalog 与普通 store 路由。 | 未有可信来源授权时仍 fail closed；不能将“Controller 已装配”扩大为所有写者均遵循协议。OpenCode 跨代续接、冷恢复及必要平台组合仍未验收。 |
| 已有验证证据 | round-350/366/369/372/375/378/400/410 有 macOS 安装版 VS Code/EH 限定场景；round-376 另有安装版 OpenCode 的 headless managed-main 工具交互；另有原生 CLI drain、Owner、容量、UI、设置和定向回归的独立证据。round-400 successive OpenCode 执行事实、原 failed driver 与三项离线审计分开保留。round-405/408 cold warning 与缺口属于各自历史快照；round-410 冷宿主安全只读拒绝已通过，精确 warning 为 `live-leader-unverifiable`，完整四阶段身份/责任/保留容量对照通过且无新 grant/request。 | 每项只证明其报告所列平台、角色、provider、代次、源码快照与流程；round-410 不证明可恢复接管、Owner 清理、员工验收或容量归还，也不累计为全树恢复、跨平台或最终合并后的完整通过。 |

中央生产 composition、组织/容量 host、Loop+ adapter、根创建/启动/协调端口及生产来源 store 已装配。`extension.ts#getDepartmentOwnershipIndex` 实际创建 `createDepartmentProductionTaskStore`，经 `DepartmentOwnedSourceController`、`DepartmentOwnedTaskRepository`、identity catalog 和普通任务 store 路由；生产来源已由 extension 的 createDepartmentProductionTaskStore 装配 Controller/Repository、identity catalog 与普通 store router；受控写入、保留/删除、墓碑保护及跨进程通信保留有分批执行事实。round-101/102 整项失败历史保留，round-100 接口/关闭屏障、round-103 正常激活退出及 round-351 真实存储协作/删除和 authority 后继 runtime 回归已接受。未支持的 import/restore/legacy 或外部写者须写前拒绝/撤销，不将旧 lifecycle host 拒绝当作生产未装配；未知来源交接、损坏恢复与真实冷宿主仍需精确验证。

round-350 在 macOS 安装版 Extension Host 使用真实 Codex 0.167.2 binary、worker/parser/存储及原 Owner 完成公开新建场景，四项原 Owner 完整凭证、自然清理、容量归还与合法再次派发通过；模型响应来自本机确定性 Responses fixture，不证明远程模型质量、所有 CLI 或跨平台。round-320/321 另证明两个独立 Codex 原生执行对象的 thread/start、同 thread resume 及双轮自然 EOF/stdio/NDJSON/drain，范围不含生产双持久 binding、完整 Owner receipt 或容量。

round-375 最终标准构建、137 个不同用例和三角色全 OpenCode 默认模型公开新建 EH 已通过：两模块、四原 Owner 完整 required receipt、员工 stopped、两个精确 CLOSED 全集、首次 grant 前持久身份/binding 回读、容量持久归还后实际第二次派发及总监最终汇报均成立。round-375 整项 attempt 当时的 failed 历史保留；该次具体最终场景执行事实经后继 round-376 修复 managed-main 权限/活动/agent 兼容缺口后由主审接受。模型响应来自本机确定性 Responses fixture；不扩展为远程模型质量、OpenCode 跨代续接、冷恢复、其它平台或所有 CLI 行为。round-376 的标准构建、72 个不同用例及安装版 OpenCode 1.19.5 的真实工具交互，是 headless 生产 one-shot host 加实际 preparer/template/helper/monitor 的范围，不是新的公开 EH 或 Department Owner/容量证明。

续接事实已更新：round-353 停止代次竞态保留为历史失败；round-357 在首次 await 前登记请求 token、拒绝重复续接并由 stop/dispose 撤销，迟到 finally 按 token 隔离（20 个不同 composition 用例分批通过）。round-366 Codex 公开 stop→continue 完整 EH 已通过，含原/后继责任、三代 CLOSED、容量归还、总监再派发和最终汇报；不得用旧 round-359 失败覆盖后继通过。round-378 macOS 安装版 OpenCode 1.19.5 单次 stop→continue 的限定执行事实成立，整项实现当时未通过主审的历史保留。round-382 已接受修复永久 session reservation 对 A→B→C 的阻断及自身新 attempt 来源识别，实体标准 build、26 个不同定向用例及代码合同审查通过。round-400 后续真实同宿主公开执行两次 stop/continue，实际到达 A→B→C、8 个原 Owner、4 个 CLOSED、C 验收、第二模块和总监汇报；原机器报告因新增末端 verifier 把组长 IPC 按员工字段核验仍为 failed。只读离线审计按原报告、协议、receipt 与 native DB 的 mixed/successive/native 三项通过，不是新的 EH，也不改写原 result；并发 observer 最终源码与 EH 执行快照不同。round-400 当时的整体主审失败保留为历史。round-403 后继修复已通过代码审查及定向回归：harness 自有 CDP 清理失败会传播到 driver failure gate，迟到 discovery detach 也受清理门禁约束；这只证明 harness 资源清理，不证明 Owner receipt、CLOSED、容量释放或生产恢复。round-403 macOS owner-core 固定入口套件 58/58、exit 0，但后代追踪及整树关闭未确认。round-405/408 的 warning、控制证据缺口及整体失败均保留为各自历史快照；round-410 后继身份修复已审查接受，唯一全 Codex 安装版 cold 场景通过安全只读拒绝：公开 stop 精确到达 `live-leader-unverifiable`，完整 before/after activation/control 四阶段身份、selection、requirements、方案/档案、session/attempt、责任全集与保留容量一致，且无新 grant/责任或 provider 请求重播。该实现仅以只读持久身份 reader 支持拒绝，不能授权恢复、spawn、Owner 清理或容量释放；员工仍 live、责任未关闭且原 binding/租约保留。round-410 不把 405/408 快照合成成功，不证明可恢复接管。跨代冷恢复、必要平台与最终 Git 合理合并/合并树全量回归仍开放。

round-405 与 round-408 的冷 warning、证据缺口及整体失败均为当时历史快照：405 是 `invalid-recovery` 且第二 EH 被强制回收；408 是 `unverified-leader-session-or-plan`、完整对照不足且第二 EH 自行 exit 1。round-410 后继身份边界修复已通过代码主审、标准构建及21个不同定向用例；唯一 macOS Codex 0.167.2 / VS Code 1.144.0 免费 loopback cold 场景通过安全只读拒绝，精确 warning 为 `live-leader-unverifiable`，四阶段身份/责任/容量对照通过、无新 grant/request、两 EH 自然 exit 0 且无强制回收。只读 reader 复用持久 RuntimeStore、transcript parser 与原 binding validator，不生成可执行 target/provenance、不创建 tab 或写盘；无有效身份仍拒绝为 `unverified-leader-session-or-plan`，无真实 target 的 running leader 在成员登记、容量恢复或持久写入前拒绝。原 endpoint unknown/unreachable、员工 live、责任 open、binding 与容量占用保留；这不是恢复接管、Owner receipt/CLOSED、员工验收或容量归还。跨宿主可恢复接管、必要平台、未覆盖来源/角色及最终 Git 合理合并/合并树全量回归继续开放。

round-372 三项修复均已有主审接受的限定证据：Owner 协议 v1 的 `finalizing` 仅返回 `status/identity/claimGeneration`，无 receipt；只对仍持精确 entry/handle、terminal/drain 可核验且正在原 cleanup、持久 live 身份/revision/claim/requirements 一致的原 Owner 暴露。client 对 live/finalizing 沿用串行 250ms 至 5s 退避；unknown/conflict/失联/坏证据立即拒绝，finalizing 不缓存成功、不释放容量、不 spawn、不推进 handoff claim，close 仍拒绝并保留锁；员工 done 仍需要原完整 required receipt 与原 stopped。员工 OpenCode 根能力在首次 realpath/assert 前先捕获原 assert/dispose；核验失败由原 dispose 处理，清理失败保留根、配置租约及责任容量。默认模型修复保持 UI/持久 `model:null`，仅新根可信宿主固化三角色 OpenCode 同档案具体模型并拒绝异步配置/目标/保存屏障漂移；26 项与限定公开 EH 通过，但默认模型 EH 使用较早 Owner 快照，不代表最新 Owner 或全部角色 EH。详细验收范围见[逐项覆盖表](../runbooks/department-acceptance-coverage.md)。

## 角色与模型配置

| 角色 | 行为与完成责任 | 现行表单与绑定契约（产品修复已接受） |
| --- | --- | --- |
| 总监 | 沿用经典 Loop 的汇报驱动职责：仅派发粗粒度工作、协调、处理运行中反馈、依据组长汇报确认整体完成；不检查代码，不执行代码或测试验收。 | 在当前 CLI 分组直接操作模型、思考力度，复用主选择处理；顶部显示当前 CLI/档案/模式，不增加独立总监档案。 |
| 组长 | 每名组长对应一个真实、独立、封装复用的 Loop+ 任务；拆分员工工作并执行 Loop+ 验收。 | 仅选择 CLI、模型、思考力度；档案由当前绑定确定，不提供独立档案选择。 |
| 员工 | 复用已有子任务执行能力，完成交付并向所属组长返回结果，不自行替代验收。 | 与组长分别配置，但每个角色也仅有 CLI、模型、思考力度；不提供独立档案选择。 |

### 执行角色 CLI 能力准入（2026-11-17）

`DEPARTMENT_EXECUTION_CLIS` 直接复用 `CLI_LIST`：Codex、Claude、OpenCode、Grok、DSH、Kimi Code、ZCode 全部可担任总监、组长、员工。表单、保存、配置解析和 producer 不维护额外角色白名单，沿用已启用 CLI、有效档案和模型能力校验。

总监沿用经典 Loop；组长及员工沿用 Loop+。Codex/OpenCode 保留既有专用 Owner；其余五种由 `departmentinteractiveruntime.ts` 捕获原交互 runner，接入同一责任账本、代次 authority 和清理聚合。ACP 握手返回真实 session 后完成持久绑定与授权，再发送 prompt。Claude 用其原生 `--session-id` 能力预选 UUID，在 SDK 启动前完成同样的准入，后续沿 SDK 原会话恢复。

Loop+ 为新员工创建的交互 Tab 初始可以没有本地 transcript session。派发前宿主先在原 Tab 建立本地会话键，再进入原 interactive runner；该键只定位 UI/消息，不替代 CLI 返回的原生 session。Codex、OpenCode 的 Owner 路径及已有员工会话续接保持原准入。若启动前准备失败，员工 attempt 以实际失败返回并保留原有 cleanup/容量门禁；生命周期日志按 attempt 记录安全阶段码，不记录 prompt、会话或异常正文。

组长本地 `sessionId` 保持稳定，真实 CLI ID 写入独立 `executionSession`；员工沿普通 Loop+ 策略接管真实会话。停止先封闭新启动，再等待原 runner、输出流与消费者；员工的执行目录、Tab 由现有 adapter 清理，全部完成后才能归还名额。旧任务、未知 Owner 和容量文件不自动重写。本次取代此前只允许 Codex/OpenCode 的处理，详见[修复计划](../exec-plans/completed/2026-11/2026-11-17-bugfix-department-all-cli-execution.md)。

非 Codex/OpenCode 组长续接时，可信部门运行时只从当前有效代次的交互 Owner binding，或 producer 已核验的代次续接证明中取得 native session，并将它单独传给原交互 runner；本地 transcript key 仍用于消息定位。新代尚无原生 binding 时显式按首次会话启动。缺失、冲突、关闭代次或无法回读精确账本 binding 时拒绝执行，不依赖可丢失的通用 session-meta 映射，也不绕过普通会话及员工的本地历史只读校验。

Grok 员工的 ACP `session/load` 需要首次启动的 cwd。部门 Owner 将隔离执行目录标识随原生会话一起持久化；原子任务重试和经 `continueFromSubtaskId` 的多跳续接都沿用该目录。每轮仍由 Loop+ adapter 在 runner 停止后拆除登记链接，保留空目录供以后恢复。恢复失败不创建替代会话，不放宽原绑定冲突校验；不自动改写缺少目录标识的历史会话。

### 完整提示词传递（2026-11-17）

组长与员工复用原 Loop+ 提示词，不施加部门层的长度上限或截断。Codex/OpenCode 组长共用 `departmentleaderinvocation.ts` 的结构合同；仅精确 invocation 数据帧不套用控制帧大小上限，宿主和固定 worker 同步处理。员工准备消息的配置大小预算排除提示词正文及承载提示词的 CLI 参数。原配置预算、身份/token/序号、阶段、持久绑定和最终授权继续核对，公共 Owner socket 不接受执行提示词。其余 CLI 继续复用既有交互 runner。

员工角色提示要求将构建副本、缓存和临时测试日志放在当前工作目录之外的系统临时目录，并把需验收的证据保存到任务约定的持久位置。隔离工作目录含未登记的内容时，宿主保留现场。原 Owner 无法取得完整清理证据时会保留执行责任和占用名额。

### 本次三控件与精确身份合同

- 组长、员工各保留角色标签及 CLI/模型/力度三控件，与 Loop+ 子模型的当前配置绑定规则一致。OpenCode 的 variant/effort 使用同一个力度槽，沿其现有模型能力及存储语义，不并列第四个变体控件。总监控件必须与实际启动读取的主模型/力度（OpenCode 主角色 variant）一致，不能只更新显示摘要或另一角色存储。
- 同 CLI 使用总监当前档案；跨 CLI 使用目标 CLI **已确认激活档案**，由面板已有 `activeConfigIdByCli`/共享 helper 获得明确身份，宿主权威复核。`configId` 保留在角色偏好、候选/保存消息和新根冻结快照内，消息形状不变。已有显式异档案偏好不能成为隐藏选择，须按当前绑定重新确认并保存；不得自动选列表首档、激活档案、后台回写旧偏好或启动 CLI 来获取候选。目标身份缺失、加载中或失效时给出中文配置指引并拒绝新根。
- 候选、保存和新根解析在相关 await 前后复核当前绑定、scope/requestId（候选/保存）及配置/选择修订；workspace、模式、CLI、总监档案、目标激活身份或相关修订变化均撤销过期结果，A→B→A 不复用旧令牌。保存按角色防重入，落盘成功后才发布内存；失败保留已存配置及其它角色草稿，并可重试。角色偏好仍按工作区与总监 `configId` 隔离；加载、未保存、保存中/失败及无效配置继续阻止新根。
- 通用 `getDepartmentRoleCandidates(cli, configId)`/精确档案 reader 仍只读调用者指定档案；“必须等于当前绑定”的约束放在本次表单入口、保存及新根边界，不能全局改写 reader 的参数含义。运行中根、已有任务补充、恢复与 Owner 使用原冻结合同，不热迁移；默认模型和精确启动快照沿下述既有规则。
- 保留顶部当前 CLI/档案/模式栏及原纵向角色组、中文标签、28px 原生 select、6px 间距、既有主题和 wrap。280px 下控件可收缩折行，长模型名不溢出且 title/aria 可读；hover/focus 沿现有样式。加载只禁用依赖候选的模型/力度；保存期间禁用同角色；空配置/模型给出已有配置入口指引，错误就地中文与重试，显式默认与未选择区分。此为已有界面窄修，不新增视觉系统。

### 后续表单精简与初始化修复（2026-11-17）

- 总监、组长、员工三行配置位于多行输入框下方的 `input-footer`，与 Loop+ 主子模型使用同一底部区域；在发送操作栏之前，DOM/键盘顺序与视觉顺序一致。顶部 CLI/档案/模式栏仍位于输入框上方。
- 组长、员工一行与 Loop+ 子模型保持相同的信息层级：CLI、模型、适用的具体力度。不再显示“沿用档案力度/沿用默认变体”选项；无力度能力时隐藏力度选择。优先保留有效选择，否则采用有效的 CLI 力度、medium 或首个能力档；用户选择模型或力度后，将当前显示的具体力度一起保存，OpenCode 只保存 variant。
- 去掉面板和模式开关下的黄色性能警告，性能指导放在全局及工作区“产研部员工最多人数”说明。去掉角色行右侧的过期说明；底部统一状态、按角色重试和新根发送保护继续保留。
- 本地模式 change 先发送宿主 `interactiveMode.<cli>` 设置，再同步失效令牌和完整模型控件。`applyState` 批量应用期间暂缓部门渲染，等待模型、力度和模式归一化发出设置消息后，才按同一 panel 的最终身份请求角色候选；随后才处理 Loop 队列自动续发。避免候选 await 被随后初始化设置作废，首次模型下拉不再依赖切换角色 CLI 才可用。
- 回归使用生成生产 Webview 及真实 `handlePanelMessageWithDeps` 并发处理消息，覆盖冷恢复产研部、编码切入、已有面板切入并归一化力度；不通过第二次 panel、CLI 切换或手动重试掩盖初始化。该验证不代表真实 VS Code EH 或 CLI 任务启动。

以下为既有配置合同及历史验证边界；本次新增当前绑定约束的真实接受与失败后继见已归档 bugfix 计划。

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
| 总监组织适配器 | 接受总监分派和协调意图与角色配置快照，校验部门归属和停止状态。 | 创建、绑定并控制真实组长 Loop+，由宿主维护根协调状态。 |
| 组长 Loop+ 宿主封装 | 复用现有 Loop+ 创建/续跑、派发、验收、补充需求、停止/恢复入口；注入部门身份与共享额度适配。 | 独立任务 ID、调度快照、验收与完成结果；Loop+ 自身为验收权威。 |
| 根层方案传播 | 复用模板选择与快照能力，接收根任务唯一方案，向既有、新建及恢复的组长传递；不接受组长覆盖。 | 全部组长使用同一根方案；若支持运行时更新，统一同步结果可观察，不一致时阻止验收/整体完成。 |
| 员工余额参考 | 每次组长决策前提供部门及分组参考额度、实际占用和余额。读取失败时标记未知。 | 模型决定派发数量，实际占用随执行登记。 |
| 员工执行身份 | 启动前核对所属根、组长、子任务、attempt、代次和停止状态。 | 复用既有 Loop+ runner，按 attempt 登记实际占用，清理确认后释放。 |
| 运行中反馈与协作投递 | 接受有来源、目标和去重 ID 的组长请求；唤醒总监，由总监向目标 Loop+ 添加补充需求。 | 待处理/投递/失败/处理结果及回执；不能仅写入完成总结。 |
| 展示投影 | 读取宿主认可的根、组长任务与员工状态、额度和投递状态。 | 群聊与成员树只作投影，不能通过 UI 或模型直接修改任务 JSON。 |

已实现 `src/extensionHost/departmentorchestration.ts#createDepartmentOrchestrationHost`，返回根注册/恢复、组长启动、全树停止/继续、员工准入、总监协作处理及根完成检查端口；`departmentruntimestate.ts` 定义 version 1 组织快照（组长状态/代次、模块预留、协作、已确认根补充需求）。`LoopPlusRuntimeAdapter` 提供部门准入/容量观察及任务等待端口，通过既有 `runEventDriven` 创建真实组长。共享池通过注入依赖由同一组织 host 使用，而非复制调度器。

round 220/222/224 已审查的生产执行阶段：真实新建的组长任务由 CREATE 返回时记录进程内来源凭据；组长容量与成员快照持久化后、scheduler 首次 pump 前，生产 callback 对该新代调用 `Ledger.open`。同一个真实 producer 注入 Codex 与 OpenCode 员工准入，并由组长生产 host 挂接 Codex 原生 Owner；组长继续使用真实 Loop+ scheduler 和多轮原生执行。任务本地 `sessionId` 与原生 `executionSession` 分离持久化。关闭时同步撤销 `canLaunch`，保留 `isCurrent` 供最终身份复核，seal 原 Owner 并等待在途准备/责任结算后才尝试封闭集合。冷读或恢复记录不能被 producer 收养，completed、idle、空集合和普通 Promise 不能代替 drain。

这只是已审查生产接线的阶段，不表示所有身份的整组资源/容量门禁或完整根流程均已通过：round-228 已审查 Codex runner/session 释放映射、精确 tab 关闭、extension consumer 登记及原 Owner receipt 生成；round-234 将组长 lease 消费限定到同宿主新建且完整覆盖的 Codex 集合。round-239 补 OpenCode employee process 资源桥：原 Node Owner 以真实 child close/drain 为 runner 释放前置，随后释放 worker 配置租约并单独清理 overlay；私有请求原 EH tab capability 等消费者结束、核对原 identity、关闭并回读，process preparation 保留原 OwnerClient。round-350 macOS 安装版 EH 使用真实 Codex 0.167.2 binary、worker/parser/仓储及原 Owner，通过本机确定性 Responses fixture 完成公开新建场景的四项原 Owner receipt、自然清理、组长容量归还及合法再次派发；不是远程模型质量、所有 CLI 或跨平台证明。round-351 OpenCode 并行 tab 状态/输出/取消隔离及原 transport drain、round-353 Owner 消费者零重试各为独立受控回归。round-353 续接所有权窗口由 round-357 修复：首 await 前登记根级可撤销 token，stop/dispose 撤销，重复请求拒绝，迟到 finally 只移除自身 token；实体隔离 build 与 20 个不同 composition 用例通过。round-359 当时的公开 stop→continue EH 未通过：后继员工准备产生的新 session 与继续路径持久目标 session 不一致，组级清理核对持久 session 与原 Owner binding 时发现 `leader-cleanup-selection-conflict`，阻止整组清理并保留容量；后续 round-366 Codex 公开 EH 已完整通过，不删除或放宽清理门禁。tracker 和请求 token 只证明活跃编排/准备责任，不证明 native drain、完整 receipt、CLOSED 集合或容量释放。round-359 OpenCode 专题将 leader 的 native-session 检查接到 tab-isolated parallel consumer：每次调用读取持久 executionSession 并在调用内固定首次核验 ID，不写普通 metaStore 映射；8 项校验器与 1 项接线检查不证明真实 OpenCode CLI/EH 或整组容量。缺能力、拒绝、失败、identity 变化或断连仍保留 unknown/占用；原生 OpenCode session 历史不删除。OpenCode 组长明确模型/默认模型混合公开新建已有 round-369/372 证据，Codex 公开 stop→continue 已由 round-366 通过；OpenCode 全角色、未覆盖整树控制、跨代/冷恢复及必要平台仍待验收。员工消费者在自身成功 receipt 后归还员工租约，不表示组长/整组容量已消费。round-225 只改善 Owner 测试 fixture 的启动诊断与实际关闭断言。

round-320/321 已验证真实 Codex 0.167.2 在 macOS arm64、本机 Responses fixture 下由两个独立执行对象完成 thread/start、同一 thread 的 thread/resume 及两轮自然 EOF、stdio/NDJSON、execution drain 和 runner 收尾，无强制回收；该证据不证明生产双持久绑定、完整 Owner receipt 或容量。来源见[真实排空验证手册](../runbooks/department-codex-native-drain-verification.md)；生产整组资源/容量证据与此低层真实 native 生命周期证据分别核对，不把它记为从未验证，也不扩为所有场景通过。OpenCode 完整生产组合/整组容量、其它角色/CLI、未覆盖的全树停止继续、冷恢复、必要平台、最终真实 EH/UI、Git 同步合理合并及合并后全量回归仍为根门禁。

部门准入返回 `null` 拒绝，普通无部门任务返回 `undefined` 委托原准入；原端口也缺失时保持普通执行兼容。已有 overflow 时不同新 attempt 的 `null` 是明确拒绝，adapter 以 failed finish 进入既有验收，不应与可恢复 `stopped` 中断混淆。Codex 生产资源清理及其组容量消费有独立受审查范围；round 239 新增 OpenCode employee process 的 receipt 资源接线与混合 employee 集合观察，round 350 的 EH 仅验证 Codex 确定性 Responses 新建场景，不能把 OpenCode 接线当作完整清理通过。恢复依赖可信 `inspectLeaderSession` / `observeRestoredExecution`，不能用已结束 Promise 冒充存活执行核验。参见[Loop+ 调度](loop-plus-scheduling.md)。冷恢复、其他角色/CLI 和最终真实 EH/UI/CLI 组合仍待验收；模块存在不代表这些根门禁已经通过。CodeGraph 当前有未解析引用及新文件未覆盖，以上事实另经当前源码核对。

调度、资源名额、任务记录及快照写入由主机拥有。模型只提交受校验的分派、协调和补充需求意图；不能直接编辑任务 JSON、active IDs、Loop+ 快照或租约。封装保持单一调度/验收实现，不复制调度器、验收器或 CLI runner，也不直接改写其内部队列以绕过准入。

## 人数、共享额度与租约生命周期

人数设置通过 `src/departmentSettings.ts` 统一宿主/Webview 正数向下取整和安全整数规则。两项逐项按有效工作区值、有效全局值、默认值（4 名组长、16 名常规员工）的顺序取值；工作区空输入删除单项覆盖，非空非法保存拒绝。PanelState原字段仍是全局值，`workspaceDepartmentMaxLeaders`/`workspaceDepartmentMaxEmployees` 为 number/null；空值显示继承全局占位。保存使用最新副本及宿主scope/requestId，完整临时文件替换成功才发布内存，失败保留已存配置。生产 `resolveDepartmentPromptConfiguration` 解析实际工作区有效值，冻结到新根，后续准入沿用该快照；已有任务继续使用启动时保存的额度，设置变更不热迁移旧根或重写冷恢复原代。设置值为：

| 键 | 默认值 | 语义 |
| --- | --- | --- |
| `departmentMaxLeaders` | 4 | 总监决策时参考的组长并发人数。 |
| `departmentMaxEmployees` | 16 | 组长决策时参考的部门共享员工并发人数。 |

两个值只进入模型提示，实际派发数量由总监和组长决定。参考余额为零或未知时，仍可派发。组长实际占用持续到其 Loop+ 工作和原 Owner 清理结束。员工租约在相应执行结束、清理完成后释放，结果仍可等待组长验收。

所有实际员工都计入占用，包括旧版本标记为超额、正在清理及恢复后仍存活的执行。参考余额按 `max(0, 参考额度 - 实际占用)` 计算。

每次组长决策前取得最新参考快照，读取失败时提示未知。宿主按实际身份登记占用，组长和员工分别使用 `trackLeader` 及 `trackEmployee`。

池可恢复旧快照中的 `employeeOverflow`。员工租约以 `[leaderTaskId, attemptId]` 为身份，重复派发复用原占用。组织快照持久化组长、代次与协调状态。

同一部门由拥有它的扩展宿主统一管理共享额度，各组不能各自使用一份部门额度。本设计不承诺多个 VS Code 宿主/窗口、不同部门或机器之间共享同一资源池；如果后续支持这些边界，必须有明确所有权、协调实现和独立证据。

已实现模块的生命周期约束（真实扩展链路仍待集成验证）：

- 启动核对当前任务、代次、attempt 身份及原 Owner 授权。原 Loop+ 调度继续负责写入冲突、暂停、取消和验收。
- 员工运行完成、失败或取消后，确认相应真实执行结束且清理完成再幂等释放常规/超额租约；不能因停止请求或状态标为停止就提前释放仍在写入的进程。重复 finish/cancel/停止回调不得重复释放或删除新 attempt 租约。
- 停止根任务阻止新组长和员工启动，并传播给所有相关 Loop+；停止单个组长仅作用于其成员。排队成员取消后移除等待，迟到异步准备/回调不能重新启动。
- 恢复前核对持久化部门/组长/attempt 归属、常规/超额标记、旧租约与真实活动进程：仍存活的执行占用名额，确认结束且清理完成的回收，未知状态保留阻塞和原因。不能盲目清池、丢弃超额标记或把快照全部重新启动；不同部门不能借用或释放对方租约。
- 参考额度调整只影响决策上下文。已有执行及旧超额记录随各自的原清理生命周期释放。

`executableMember` / `validAttempt` 已在申请前及等待后核对当前 root/owner/member 关联、running 状态、组长 lease、代次、真实 task/subtask/attempt 与固定路由。持有租约不等于有执行授权：恢复观察拒绝后成员为 blocked，拒绝新准入，余额查询返回 null；迟到取得的仅本次新租约归还，原员工/超额/组长占用继续保留，健康同部门成员及其他部门不被清池。`continueRoot` 不能隐式解除未核验清理的 blocked。

Codex 整树停止后的显式继续合同要求原 producer 仍由同一宿主持有、原组完整 Owner 清理已核验、CLOSED 集合和全部 binding 可读、员工与组长容量已持久归还后，才能获得一次内存 continuation provenance。原代身份指纹不变；新 generation 单独打开新集合，并在 scheduler 首次 pump 前沿可信原生 session 取得/恢复真实任务 tab。原 native thread 仅用于同一任务会话的可信 resume，新代 Owner 使用新的 execution identity；旧集合、责任与 stopped/review 历史不重写、不收养。旧 generation callback 每次检查其原 scope，不能读写新代任务结果或释放后继租约。round-353 当时的 prepareRoutes 等待期迟到续接复活竞态仍保留为历史失败；round-357 已在首个 await 前登记同根可撤销 token，拒绝重复续接，stop/dispose 撤销并按 token 隔离迟到 finally，20 个不同 composition 用例分批通过，非一次全量运行。round-353 的实体 build 与 40 个不同定向用例继续按原源码范围复用；composition 的修复范围由 round-357 新证据覆盖。Codex 公开 stop→continue 的完整 EH 已由 round-366 接受。OpenCode round-382 后继已修复同宿主连续链及自身恢复来源识别：最多256项精确来源/目标链头，逐次核对原client、binding/selection、canonical目录、完整required receipt、原stopped和持久员工容量移除；未知目标不推进，旧来源不回退，竞争/迟到授权拒绝。实体build、26个不同定向用例和代码合同审查通过；未运行连续公开EH。tracker 和 token 不证明原生 drain、完整 receipt、CLOSED 集合或容量释放。OpenCode 冷恢复、真实模型/完整 VS Code UI 或其它 CLI 的恢复路径也未由该受控场景证明。

已获 grant 的原代 stream callback 在 generation closing 时仍可通过只读 `observationScope` 核对其捕获 scope，并仅向同一个 Leader 对象的当前消费者完成 ack；启动、binding 和新 grant 继续要求 `canLaunch`。新代已建立后，旧 scope 的观察拒绝，不会借用 successor 的 consumer。只有完整清理、CLOSED set、持久容量归还和 binding/session 校验都成功后才退休原代：非 completed 且可继续任务保留一次性内存 provenance，成功打开 successor 后消费；completed 任务不持有 continuation proof。未知或失败清理既不退休也不驱逐 producer 的有界责任引用。

## 总监均衡分轮派工

总监每轮先检查剩余目标与依赖。当多个目标可独立交付、写入范围互不冲突且并行有实际收益时，可同轮派给多位组长。局部或强耦合工作建议由一组完成，存在先后依赖的工作建议分轮推进。

经典 Loop `continue.subtasks` 提交本轮要启动的模块。宿主按实际执行和启动预留计算占用，余额随协调上下文提供给总监。组长结算和群聊补充需求唤醒同一串行总监循环。派发复用经典 Loop 的活动写入冲突检查。故障组长清理确认后可取消并用新模块 ID 重派。总监按已有汇报、原始目标和新增要求判断业务完成。

## 运行中协作与补充需求

协作流程为“来源组长→总监→目标组长 Loop+”。组长在执行中发出请求时，总监应获得可处理事件并及时协调，不以整批组长全部结束为前置条件。由总监向目标组长的真实 Loop+ 添加补充需求，复用其排队、唤醒和重新调度能力；不能让模型直接写另一个任务的 JSON 或通信路径。

跨组消息的逻辑信封至少包含部门根 ID、来源组长任务 ID、目标组长任务 ID、稳定去重 ID 与请求正文，宿主验证二者确属同一部门。记录来源及目标可供群聊查看，回执区分“已进入目标补充需求队列”和“目标已经处理”；已入队不等于已完成协作。

宿主需持久化/恢复待投递状态及去重依据，重试沿用同一 ID，重复事件不重复添加需求。目标忙碌时复用既有补充需求队列；目标不存在、停止、失败或已完成时，向来源与总监展示明确结果和未处理事项。`coordinateCollaboration` 将 stable ID、来源/目标/正文保存到组织快照并标为 `pending` / `awaiting-director`，`processDirectorCollaboration` 核验运行目标后调用既有 `submitUserMessage(taskId, text, deliveryId)`，目标队列持久化同一 ID/正文且同文幂等、冲突拒绝。round-366 已验收总监循环由组长新建/续接真实结算唤醒并在公开 Codex stop→continue 流程继续协调、再派发和最终汇报；这不代表所有 CLI/失败恢复下协作组合均通过。`delivered` 仅表示入队，不能静默重开完成任务或跨部门替代。

组长用正常 Loop+ 决策附带 `departmentCollaborations`，例如验收时发起配合请求。总监用同一选中的经典 Loop JSON 附带 `directorCollaborations`，指定 `deliver` 或 `dismiss`。附加字段格式错误或投递失败按协作单独记录。未处置的请求作为事实交给总监判断。

## 防阻塞与真实授权

总监（经典 Loop）与组长、员工（Loop+）通过 `src/departmentprompts.ts` 共用防阻塞提示。授权范围内可逆、低风险的常规决策默认自主处理。素材授权不明时优先换用许可明确且符合用途的免费素材或自制替代，并保留来源与许可；不得降级硬性要求。实际提权、访问控制、付费、破坏性操作和对外副作用仍依赖真实授权。

先尝试合规替代或安全修复，并继续独立工作；只有不可替代的批准或用户决策才请求确认。必交目标确实无法推进、没有合规替代且无独立工作可继续时，按原流程报告真实阻塞与恢复条件。此规则仅调整产研部提示词，不改宿主授权、状态机、重试或验收门槛。

## 状态与完成边界

以下是展示/协调语义，不新增或承诺已实现的枚举值：

| 对象 | 非终态边界 | 完成依据 |
| --- | --- | --- |
| 员工 attempt | 等待名额、准备、运行、停止清理中；完成/失败结果可能仍待验收。 | 真实执行结果提交给所属组长，执行结束不等于验收通过。 |
| 组长 Loop+ | 员工活跃/排队、结果待验收、验收修补、补充需求待处理、暂停或错误未解决。 | 该真实 Loop+ 所有验收及完成门禁通过并持久化完成；一次回复或全部员工退出不够。 |
| 总监/部门根任务 | 有活动执行、待清理资源、待处理澄清或本轮尚未确认的新用户要求。 | 总监依据原始目标和真实组长结果作出经典 Loop 完成决策，宿主确认执行资源已结算。 |

组长按普通 Loop+ 的持久完成结果结算，包括宿主允许的直接完成。产研部另外等待原执行清理。总监自动收口时，未启动模块、失败汇报和待处理协作进入提示，由总监判断是否影响整体目标。宿主在写入前检查真实归属、活动执行、清理、持久化、当前澄清和用户补充需求。群聊人工确认继续核对各组完成汇报及协作处置。

## 界面规格（展示及授权模块已实现，待生产集成）

沿用现有简体中文、VS Code 主题语义色、工具栏和窄屏成员抽屉，不重新设计布局或交互体系。

- 新建总监根完成可信组织注册与真实会话绑定后，自动以其 task ID 打开现有总监群聊。面板打开异步进行，不占用任务启动；展示错误单独记录，不能改变已启动任务。前置准备、注册或绑定失败时不展示；普通 Loop/Loop+ 的打开行为不变。
- 总监群聊成员树为总监→全部组长→各组员工，显示所属关系和真实状态；组长群聊仅按宿主可信当前 `state.task.id` 与 `department.leaders[].taskId` 精确匹配，显示本人及本组员工，不显示总监或其它组。无匹配时保持空状态，不回退其它组；本组无员工沿用空组提示。模块命名只用于可读性，不参与身份匹配，也不强制按模块拆分。
- 组长成员行不重复提供打开本人群聊入口；员工状态与验收定位、返回总监群聊导航保留，主题、28px/12px 头像、8px 间距、4px 行内边距及 hover/focus/disabled、窄屏抽屉沿用现有样式。事实来源为 [renderDepartmentRosterPanel](../../../src/webview/loopGroupChatPanel.ts)、[渲染回归](../../../src/test/loop/departmentGroupChatPanel.test.ts)和[浏览器 smoke](../../../scripts/department_group_chat_smoke.cjs)；显示过滤不改变下述宿主授权合同。
- 总监群聊专门呈现协调职责：粗粒度分派、组长进度汇报、待处理协作请求、向目标组追加补充需求的投递/失败状态，以及整体完成的开放事项；按汇报驱动经典 Loop 展示，不放入总监代码检查或验收职责，不以最终总结替代运行中协调。
- 总监页的组长入口在页面内弹窗打开对应组长群聊。Loop+ 适配器按宿主任务记录区分普通任务和部门任务；组长在启动、继续和澄清时不自动打开独立 Webview，澄清请求仍按原流程通知并同步到已打开的组长弹窗。复用同一群聊展示与操作能力，组长弹窗保留现有 Loop+ 完整同排操作栏及其可用性规则，不用精简按钮替代；所有读取、提问、补充需求及停止操作绑定宿主校验的对应组长任务 ID，验收方案受根层统一契约约束，继承方案不可独立覆盖。关闭弹窗不停止任务，回到保留原阅读位置的总监页；普通旧 Loop/Loop+ 群聊不被强行改为三层。
- 部门组长聊天气泡隐藏“打开 Loop 群聊”，包含恢复的历史及实时消息；只依据可信角色投影，不修改持久消息动作。角色投影到达后更新消息渲染缓存，普通 Loop/Loop+ 与总监原入口保留。
- Tab 保留现有会话命名及持久化值。总监和组长分别使用 ☀️、🌛；子任务沿用普通 Loop+ 的 ⭐️ 和会话名，悬停显示“子任务 N：标题”。详细规则见[群聊展示接口](department-group-chat-ui-contract.md)。
- 总监和组长的会话角色投影须绑定真实任务与 session；同名会话可保持同名，不能用成员树头像、CLI 相同或静态标题推断角色。子任务使用 Loop+ 的任务关联，不另投影员工角色。隔离 Extension Host 的展示验证不替代生产组织启动、冷恢复或真实 CLI/模型执行验收。
- 人数设置说明默认参考值为 4 名组长和 16 名员工。实际占用包含仍在清理的执行，无法读取时显示未知。

round-121 已在隔离 macOS Extension Host 的真实生产任务/会话恢复路径补验指定组长的页面内弹窗：实际 sandbox srcdoc、精确 leader task 身份、历史状态的完整现有操作栏、单次展示关闭且无 stop/cancel、来源按钮焦点/原阅读位置恢复，以及实际可见 275px Webview 的 tab/tooltip/溢出。证据与限制见[角色会话验证](../runbooks/department-conversation-verification.md)；这不是运行态操作、跨主题真实 EH、真实模型执行、冷恢复或组织全组合通过。

群聊展示/授权模块已实现记录驱动的成员树与页面内组长弹窗、完整同排 Loop+ 操作、动态主题桥接及关闭后的阅读/焦点恢复。每次敏感动作及 await 后副作用/回包，协调器重新核对当前根、组长、workspace、模块、`event_driven`、`departmentInvalid` 和 taskId/instanceId 绑定；浏览器标识或旧投影不是授权。关闭仅释放展示/提问/资源订阅，不停止已提交任务。根控制端口缺失时拒绝，方案保持只读。详见[群聊展示接口](department-group-chat-ui-contract.md)，其中真实宿主导航/资源/CSP 和员工 tab 仍有集成门禁。

| 界面状态 | 最低可读要求 |
| --- | --- |
| 默认 | 显示角色、任务归属、参考额度、实际占用和余额。总监展示协调事项，组长弹窗显示完整同排 Loop+ 操作栏。 |
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

> 总监将账号和报表交给两个组长。组长按普通 Loop+ 拆解工作，参考余额为零时也由组长决定派发数量。账号组长可以在验收决策中附带用户字段协作请求。总监用经典 Loop JSON 将请求投递给报表组长，报表组长把它作为补充需求处理。总监按根目标与已收到的组长汇报判断整体完成。

实际拆分按可独立交付和依赖关系选择，不强制每次按模块，也不要求每组耗尽名额。

## 验证与事实同步

本文需求来自父任务原始目标和 14 项补充需求；逐项实现、验收与剩余项映射见[部门逐项验收覆盖](../runbooks/department-acceptance-coverage.md)。模块事实由父任务 `communicationFile` 指向的已接受报告和当前源码共同核对。文档/ontology 检查不证明未覆盖角色的生产启动、跨代冷恢复、必要平台或合并后的全量回归。根计划保持 `in_progress`，功能清单保持“开发中”。

验证覆盖角色配置、会话隔离、参考额度及零余额派发、实际占用、独立的清理与恢复、根方案快照、普通 Loop+ 验收和完成、运行中协作投递与去重、旧记录以及群聊和设置交互。验证记录注明实际平台和覆盖范围。

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

总监协议用 `waiting` 表示仍有启动中/运行中的组长、当前只等待其汇报；宿主不派发重复模块，保持根任务运行并由原组长结算事件唤醒。若无运行组长却返回 waiting，总监转入 `needs-review`，避免永久空等。`blocked` 专用于确有阻塞证据的情况；有效 blocker 或已失败/blocked 组长使总监根进入 `needs-review`，既有组长、员工和 Owner 容量仍按原清理凭证结算。旧版缺 blocker 的 blocked 在无组长失败时兼容为等待，不作为真实故障依据。生命周期日志可投影白名单错误码（如 `DEPARTMENT_NATIVE_UNKNOWN`），不写入异常正文、路径、会话或凭据。

不改变 repairSource、历史失败、最终需求覆盖、开放工作门禁或精确清理合同。tracker、结算通知和 wake 均不能替代原 client 完整 receipt、CLOSED 全集、最终冷读及持久移除先于容量 release。实际验证结果与历史失败见[公开 EH 运行手册](../runbooks/department-full-eh-integration.md)。

组长交付结算同时识别正式验收通过和免验收汇报确认。免验收子任务的记录与最新 attempt 都要明确 `requiresAcceptance: false`，执行成功且组长实际确认汇报后才可按 `reported` 结算。修复链仍使用正式验收。正常恢复组织时，若原 `failed` 成员通过身份、完成证据和占用核验，且已无活跃执行或容量占用，可修正这类旧误判。整个部门继续按根任务门禁结算。

Loop+ 组长的本地会话晋升到原生会话时，宿主核对组长 `main` 转录并在部门任务仓储同步更新会话绑定。显式继续遇到旧本地绑定时，以同一组长最近持久化的 `main` 回合和原生会话转录核对身份。目标必须无活动执行，且至多有一个相符的聊天标签。仓储确认新绑定后，继续入口重读原任务并执行原有准入检查。原任务文件、子任务和验收记录沿用。证据冲突或绑定无法读回时维持中止。Owner 代次仍走独立的续接核验。

## OpenCode 组长 canonical 根与限定混合 EH（round-369）

OpenCode 组长每代由原宿主在 Ledger 准入后创建唯一 canonical 隔离根，准备服务和全部原生任务使用同一真实 cwd；准备时核对原生 session directory，任务继续核对固定 executionSession/CLI/config revision/原 binding。固定 worker 仅持原 host root capability，release-root 必须由原代宿主验证并清理，完整原 receipt 与 stopped 双确认后才可能参与 CLOSED 全集聚合。round-369 时跨代 session directory mismatch 会拒绝；round-378 已证明受控同宿主来源移动的单次新目录匹配及后续冷读；round-382 已修复 A→B→C reservation 与自身重试来源识别，实体build、26个不同定向用例及代码合同审查通过，但没有连续公开EH。冷宿主 running leader 仍因缺原 producer provenance/完整 Owner aggregate 而 fail closed。

round-369 独立公开新建组合仅为 Codex 总监、OpenCode 组长、Codex 员工：通过真实工具设置、角色/明确模型、一次统一方案及 sendPrompt，从空库完成两模块真实 Loop+ 事件验收、四原 Owner 完整 required receipt、两个 CLOSED 全集、持久容量归还后的下一模块实际执行与总监最终汇报。免费 loopback Responses/Chat Completions 分别驱动原 CLI，非真实模型质量证明。默认模型 null 在现生产精确选择复核处被拒，首份失败保留；明确选择 `isolated/native-drain` 的限定组合通过，未修改生产门禁。全部身份、命令及源码差异见[公开 EH runbook](../runbooks/department-full-eh-integration.md#opencode-组长的限定混合公开场景round-369)。Codex round-366 公开 stop→continue 保留；OpenCode 员工、全角色组合、跨代/冷恢复、必要平台、来源租约及最终 Git 合并后回归仍独立开放。


## OpenCode 默认模型的有效执行快照（round-372）

持久偏好及面板的 `model:null` 继续表示所选 CLI 档案的默认；仅新根可信宿主解析将三角色 OpenCode 默认固化为同 CLI/configId 的具体有效模型，显式模型及 Codex 默认不变。候选按确切档案校验模型、变体和力度，并以不含配置正文的读取修订标记核对两次读取；每次 OpenCode 档案读取前后核对共享选择修订，等待后复核工作区/目标 tab/会话、模型选择、heartbeat 与保存屏障。内容、配置修订、偏好或作用域漂移拒绝，不将新的默认静默用于已解析请求。执行快照进入 root 后不再跟随配置默认变化；selection、argv/overlay、binding 和原 Owner 清理继续核对具体相同模型，不重写旧任务、不认领未知 Owner。缺失/非法默认、错档案及不适用变体/力度仍拒绝。读取修订不进入执行快照，也不授予执行或清理权限。

默认模型的 Codex 总监/OpenCode 组长/Codex 员工混合公开新建组合以及 round-375 三角色全 OpenCode 默认模型公开新建组合，均在各自 macOS 安装版 CLI/EH 快照中通过；round-375 的四原 Owner 完整 receipt、员工 stopped、两个精确 CLOSED、首次 grant 前身份/binding 持久回读、容量归还后第二次实际派发和总监最终汇报按该场景成立。round-375 整体 attempt 的 failed 历史保留，后继 round-376 只修复 managed-main 权限/活动/agent 兼容缺口；其 headless OpenCode 1.19.5 one-shot 交互不是新公开 EH 或 Department Owner/容量证明。round-369 首次默认模型失败和早期检查失败均保留。OpenCode 员工真实原生目录/排空/完整 receipt＋stopped、round-372 根能力捕获及 finalizing 观察按原独立范围复用。OpenCode 原会话跨代目录交接/公开继续、冷恢复、必要平台及最终 Git 同步合理合并/合并后全量回归仍开放。已有 round-121 真实弹窗/275px/焦点和非零滚动恢复、动态主题及 round-338 深浅主题 tab 证据按未变范围复用，不笼统重开主题/窄屏门禁；远程付费模型质量不是额外用户要求。命令、原身份与快照差异见[专属 runbook](../runbooks/department-full-eh-integration.md#opencode-默认模型公开路径修复round-372)。
