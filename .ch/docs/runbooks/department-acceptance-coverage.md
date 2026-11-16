# 产研部逐项验收覆盖

## 收尾结论（Round723，截止 lp722 已独立接受）

现有 feature 的实现、合理主干合并后官方全量、指定真实 mixed 组合与原目录交接均已有接受结果。[原 feature 计划](../exec-plans/completed/2026-11/2026-11-13-feature-department-mode.md)标记 `completed` 并按 2026-11 归档；本次收尾记录待主审独立接受，最终主任务完成由主审决定，未发布。下方 Round721 及更早正文均为历史快照，原索引、全部 22 项映射、失败/取消/受控中断和 manifest 勘误保留，不将历史待办全局改绿。

- **已接受交接**：lp721 正常合入已接受；lp722 原打开目录已安全切至 `codex/department-mainline-integration-round676-20261116` / `f78706a8a541c389799fa617f7a80d1892f62a70` / tree `477723271a956a786605cf9088c8e98ad9222b64`，切换前 master 实际 clean，master ref 仍 `f5b5ac57e4b9f956abdb29f82cf8e50d345c2b95`；原整合 worktree detached 于同一 f787、内容 clean。其它 34 个 worktree 登记及全部 refs 在 lp722 记录范围保持，原目录交接不再待操作。
- **原件与失败诊断**：228 个非ignored untracked（3416383 字节）精确归档，106 个 tracked 精确恢复，334 条完整回滚映射。归档 `/Users/fangjiawei/.cache/round722-original-handoff-dt2oahtr` 的 `rollback-map.json` SHA256 为 `8f0761489f13ab3d708660937d4bed81b70798b1759cf82c8baa78ab672c38f4`；旧备份 `/Users/fangjiawei/.cache/round718-original-checkout-ggf4x1v6` 继续保护，不复制原内容。restore 本身 exit0 后，raw-index 封口曾 exit1 并暂停；后续三个稳定窗口及 1151 条 index 比较确认仅 106 条 stat-cache 变化，零 blob/mode/path/flags/stage 语义变化，extensions 相同；actor 未确认，未猜测。补完验证后普通安全切换通过，不隐去中间失败。
- **复用运行证据**：lp715 实际输入 `c66439cbf5c5f2dc12a84c40f9fb8a7f29af2e3b` / tree `4fa24544d9396d91fa6c516d6cad24d19eafa35a`，一次标准 `npm run build` exit0；一次官方 `node scripts/run_unit_tests.js`，397 文件、5472 项中 5469 通过、0 失败、0 取消、3 门控跳过，自然 exit0。lp719 完整物理产品唯一 180 秒 mixed cold-recovery exit0 仅证明原完整 receipts/CLOSED、持久容量移除、原 authority 自然退役、公开 continue 唯一后继、OpenCode 原 session 与 move/readback、最终公开 stop 及直接观察 workers；不外推总监最终业务汇报，后者复用 round-366/375 等已有相应历史接受证据。本轮不重跑运行、来源或备份验证。
- **覆盖限制与保护**：原生 Windows/Linux 无目标条件、三个 DSH live 环境门控未运行，付费模型、任意崩溃/外部 writer、所有后代及其它未覆盖矩阵仍有限制；强制卫生回收与 authority 自然退出分开。ignored dist/node_modules/.tmp/.codegraph、私有备份及独立树继续保护，旧 dist 可能与交付源码不同，未更新或验证匹配。本轮只有文档/本体路径引用后继，既有运行结果未失效；不清理、不重新交接、不宣称发布。

## 历史结论（Round721，截止已接受 lp719 / lp720；保留原文）

lp718 原目录保全及 lp717 需求事实文档已接受；lp720 已正常合入 c651 三文档并保留 2db 两份保全材料。lp719 的完整产品闭包与唯一 mixed 冷恢复也已正式接受，本轮正常合入完整 `0817→6313→1fe10c6` 来源，保留 lp716 装配失败和 lp719 成功两段，见[冷恢复记录](department-cold-start-verification.md)。因此下方截至 lp715 的“当前独立补验”和“保全任务未审”是历史快照，不再作为现行待办；其原索引、全部 22 项映射和失败记录原样保留。

- **特定组合缺口已关闭**：lp719 在 `6313d889450cb4e6f802acd86ef07137fff40b53` / tree `542799c4a3587f02de489da2ae87e7a99c78747d` 的完整物理产品执行一次 180 秒 mixed cold-recovery，exit0、无强制回收。第二 EH 无 prompt 重放；原完整 required receipts / 精确 CLOSED 后持久容量移除、原 authority 自然退役；仅公开 continue 创建唯一后继，保留 OpenCode 原 native session 并完成 move/readback，最终公开 stop 完整收尾。worker 退出仅限直接观察集合，不能外推全部后代或总监最终业务汇报。
- **未变证据复用**：6313 与0817只有文档差异，生产代码仍对应 lp715 测试输入 `c66439cbf5c5f2dc12a84c40f9fb8a7f29af2e3b` / tree `4fa24544d9396d91fa6c516d6cad24d19eafa35a`。复用一次标准 build 与官方397文件/5472项：5469通过、0失败/取消、3环境门控跳过、自然exit0；lp707存储、lp717文档及lp718保全各按未变范围复用。本轮不重跑这些检查。
- **仍开放的交付**：原目录安全切换到准确最终接受交付分支及干净交接尚未执行；操作前须临近重验并按变化追加保全，解决同分支 worktree 占用，分类不是丢弃许可。[保全快照](../integration/department-mainline-integration/original-checkout-preservation.md)保持原字节；本整合树 clean 不等于原 master clean。
- **限制继续有效**：Windows/Linux实际目标条件、三项DSH门控跳过、付费模型、任意崩溃/外部writer和所有后代不由本场景证明。原Round698/711失败、受控中断、manifest勘误、强制卫生与自然退出区别保留。根feature继续active / `in_progress`，不归档、不宣称全部完成。准确本轮合并身份见[整合交接](../integration/department-mainline-integration/README.md)与[来源记录](../integration/department-mainline-integration/sources.json#round721AcceptedColdFinalFactsMerge)。

## 截至 lp715 的接受快照（lp717来源，保留原文）

截至 2026-11-16 **lp715 主审接受**；本轮 round-718 只同步已接受事实。文档基线为 `0817f4519f3d5aa481af9ea64e848019da480b0e` / tree `b4d9054ad26fe49cd0d3c495c7fdb89463ebd850`。根功能仍为**开发中**，[原 feature 计划](../exec-plans/completed/2026-11/2026-11-13-feature-department-mode.md)保持 active / `in_progress`，不新增平行计划或提前归档。

原始要求及补充 **1–22** 按最新父记录 `rootPrompt` / 全部 `supplementalRequirements` 顺序核对。报告从相关 `subTasks[].communicationFile` 定位；lp 编号是执行 ID，报告文件轮次可能不同，以下同时列出，不能仅凭文件轮次推断接受状态。主通信 `main-task.md` 的 lp715 审查是本次接受范围截止点；不消费本批共享存储＋真实混合冷链补验或原目录保全任务的未审结果。

**当前结论：用户要求的合理合并后官方全量已经完成。** 实际测试输入 `c66439cbf5c5f2dc12a84c40f9fb8a7f29af2e3b` / tree `4fa24544d9396d91fa6c516d6cad24d19eafa35a`，一次标准 `npm run build` exit0；一次官方 `node scripts/run_unit_tests.js` exit0，397 个编译文件、5472 项中 5469 通过、0 失败、0 取消、3 环境门控跳过，63770.400166ms，自然退出。随后仅五份中央文档形成 0817，结果继续覆盖其代码。此处复用执行事实，本轮没有运行这些命令，不将来源定向结果相加为全量。

## 当前事实来源与后续证据索引

业务语义先按 ontology 查询并打开 `source_refs` 核对：`plugin.department_task`、`plugin.rule.department_workspace_capacity`、`plugin.rule.loop_store_confirmed_contributions` 等提供导航，当前代码、明确规格及已接受报告为核对依据。旧压缩描述或下方 round-410 快照中的“待做”只代表其时点，不能推翻后继接受结果。稳定角色、权限、状态机及路径未变，本轮不改 ontology 数据或重跑未变工具 9 项。

| 索引 | 报告定位与原输入 | 已接受范围及限制 |
| --- | --- | --- |
| U：既有弹窗/主题 | 下方历史索引 U：round-121、round-338；[会话验证](department-conversation-verification.md) | 真实历史组长弹窗、适用完整操作栏、275px 可见面、关闭不 stop、焦点/非零滚动恢复；深浅主题及宽窄屏显示 fixture 按未变输入复用。历史终态可用动作不等于全部运行态操作，不笼统重开旧证据。 |
| V675：最终角色图标 | lp675 `department-allocation-avatar-role-icons-continuation`，`round-675-department-allocation-avatar-role-icons-continuation.md`；`a3a0d37a0723791645259c4abebbd6d129d52b79` / tree `87f0009e53b5aebd14f206ebad73993a4b38c492` | 部门☀️/🌛/⭐️、普通 Loop/Loop+ 主🌛/子⭐️，总/组/员及 tab 原名保持。标准 build、不同14项为未变11＋修复3、两入口1440深/280浅 fixture；首轮2失败/Tabs超时保留，不称新真实 EH。 |
| M693：语义合并修复 | lp693 `department-mainline-semantic-merge-repair`，报告 **round-694** 同 ID；`c40acbfc78c7bdd6bf54d036b07dbdaaac0fe443` / tree `39990e005069af63fad598248915801f3efe4335` | modal-only refresh 与未知显式 threadId 有界缓冲/确认后路由；build、2/3/1 定向及系统 Chrome smoke 分别有效。旧加载探针受控中止未达刷新断言、默认浏览器缺失保留，非真实 EH。 |
| W694：工作区配置 | lp694 `department-workspace-count-overrides`，`round-694-department-workspace-count-overrides.md`；`40c77d3eb7eabd511ab569cdc25e08e6ed348d5a` / tree `39e191a4482b40f75072ea44463df0f7e7a4da68` | 合法 workspace→global→4/20，空值单项继承，scope/requestId、原子保存，新根冻结。最终 build、8 文件53/53、1440深/280浅 Webview→真实 router/store fixture；原首错保留，不代替实机。 |
| G695：主干/工作区合并 | lp695 `department-final-mainline-workspace-merge`，round-695 同 ID；`464d1113f13b1bc0f2b59ea1ba4c09976ebed713` / tree `cb6ef3649b90ed1a7dbe3b9ea78a83c503f63bd4` | 独立主干分支后继续；fetch 确认 `origin/master=2cda37b568465c3ace4c5cbe3c953471260496e2`，真实 merge `4b47d0a7`、`b7524181` 保留 c40/40c 历史，11 文本冲突逐项合并。build、329/137/95/8/2 分批结果不合称一次全量；来源/冲突见[整合材料](../integration/department-mainline-integration/README.md)。 |
| A697：真实人数/额度 | lp697 `department-final-workspace-allocation-eh`，报告 **round-698** 同 ID；实际 run2 `b992d3b668c495f398fa20d4620166733a0bf86b` / tree `4c81a722d26544eed4c7d0402b446ba7e192ed3d`；最终仅 runbook 后继 `b02cfe1a34c427937efd625735cf267bc67ac711` | [真实 UI→EH/CLI](department-employee-allocation-eh-verification.md)：全局4/20保持，workspace保存2/6，新根冻结2/6，默认3→保存0→下一 attempt应用/拒绝→恢复3→下一 attempt准入；四份真实提示/reader/持久快照对照。原四完整 receipts、精确 CLOSED、持久容量归还、四 worker 先于宿主自然退出；19不同测试分组有效。首轮模型选择 harness 失败保留，非整个工作台无 console 或新主题截图审计。 |
| K698：全 Codex 第二 EH | lp698 `department-final-cold-recovery-composition`，round-698 同 ID；运行输入464/tree cb6e；文档后继 `1c1c25d6ecb54fcb77689fe71cd8d721bf0cef2c` | [冷链 runbook](department-cold-recovery-eh-verification.md)：全 Codex 一次 passed，原完整 receipt/CLOSED、第二 EH 公开 stop、容量持久移除、原 authority 认证退役/内核退出早于唯一显式后继；最终 stop清理，五登记 worker/双 EH 自然0/null。**同报告 mixed beforeControl failed 保留**，不能称该 attempt 双组合通过；通用阶段模板 pending 不证明总监最终业务报告。 |
| K699：混合第二 EH/旧根 | lp699 `department-cold-orphan-control-repair`，报告 **round-702** 同 ID；实现 `fa6e1ddea02096bfc4f96b9f6e42513c5addbe48`，仅计数文档后继 `a90b6c9eb498643a6a65a2dc9a23ce4bc032a91d` / tree `44ad9aaf293649332b438b9574b016cb16a58e2f` | 可信部门根不再仅因本地 runner 缺席被普通 orphan 改停止；保留原 stop入口及未确认停止屏障。一次 mixed 第二 EH passed：真实 move/readback、新 canonical root、原 native/local session保持、完整3 receipts及2＋1 CLOSED、空容量、五 worker/双 EH自然退出。精确 round698 旧根另由公开 stop正常收尾，原 authority真实0/null。实机后 stop竞态/settled负例仅由最终 build/22定向覆盖，不冒称这些分支 E2E；旧88项中另2项失败不改写。 |
| T705：冷生命周期夹具 | lp705 `department-cold-lifecycle-regression-repair`，报告 **round-706** 同 ID；`6879fc01ecc440a17b40f5bc50ae47ebe825a58d` / tree `96b8c2bb8ec55406ef4d0cfda033ef875316d97d` | 六测试/夹具修复十项旧失败，必要 tsc、五文件60/60；生产794产物同字节。真实 gate/adapter idle/t.mock和原凭证断言保持。三次自有 worker强制卫生回收不是自然退出、receipt或容量证明；旧 OpenCode 内部首抛未追溯，不新增 EH。 |
| S707：严格存储后继 | lp707 `department-store-authority-retention-repair`，round-707 同 ID；完整 `74be413f→94267bb3f4343c9ccee0f9f75e99c6a2f492df50` / tree `f96fbea2fc801dac1b28487d7eb582a61439fff9` | 普通严格异常/errno、目标 commit/ordinaryMoves权威；同 gate单文件分类/提交、一次 catalog读；未知整文件保留，known-reader不退旧副本；owned未确认仍ready=false。build、81普通/handoff＋29共享 owned边界分别通过；不与历史103累加。旧祖先未接受事实保留，不声称真实多进程压力、断电/崩溃或旧外部 writer已验。 |
| D709：存储合同文档 | lp709 `department-store-contract-facts-sync`，round-709 同 ID；`2999a3b0589eaab2f52b355e41487cc44a2331c6` / tree `f2166f380da2d914ba1530317fb5f2ac21c82623` | [中央存储合同](../design-docs/department-mode.md#生产归属索引与存储事实)及 ontology confirmed_contributions 同步普通/owned区别；两文档、validate/工具9项。该独立文档树本身无94267源码；lp715已确认二者实际统一，不再列为未合入。 |
| F712：旧迁移夹具 | lp712 `department-legacy-store-migration-regression-repair`，报告 **round-714** 同 ID；测试 `4d36ef021aa88bd2f5e12aeeeb8c26105c624ee6`，仅五文档后继 `f1c499f36cfc06d604a10716ca7c2354fd3c3a05` / tree `b025197d0949d1a368e2828f33c9c335b0b65a30` | build与文件26/26，导入前隔离 HOME的无catalog兼容、真实 writer登记的已知源/兄弟及真实unsafe-root拒绝；finally不污染相邻例。生产未改；不把 Round711失败改绿。 |
| F713：群聊撤销夹具 | lp713 `department-group-chat-revocation-regression-repair`，报告 **round-714** 同 ID；`53fc392b4c4563537e935f9c307d90257e344a5e` / tree `a5de04cfa4a0abc6d87c1995241de55c85f629dd` | 完整 dispatcher结算后再refresh，精确失效DTO、根state/generation、七种归属变化零迟到副作用/旧实例不复活。37/37后仅撤销顺序改变，由最终8项替代该范围，其它29不变；**不是45项**。模拟宿主单测、生产未改，无新浏览器/EH。 |
| F714：Owner等待夹具 | lp714 `department-codex-owner-wait-regression-repair`，报告 round-714 同 ID；`bbed2d585fad47652f0099b8576bed2c2a627bea` / tree `aa1dd6ffd6a4bf7b1f74242ef8ff56305ae37d17` | 最终build、launcher35/35及未变正常路径消费者76/76；有界等待/取消/漏文件事件和自有资源收尾。双持久/原session/terminal/EOF/callback/drain及失败不释放均保留。35个直接登记ChildProcess自然0/null、forced空，不外推所有孙进程；原两历史超时首次停点未知。 |
| F715：三修复统一官方全量 | lp715 `department-final-accepted-repairs-full-regression`，round-715 同 ID；精确测试及最终身份见页首 | 正常合入53fc与bbed，迁移f1/严格存储/冷/额度/发送/transport历史保留，三测试字节等同接受来源；一次build及官方全量5472/5469/0失败/0取消/3跳过已接受。五材料仅文档后继；[来源机器记录](../integration/department-mainline-integration/round698-full-regression.json)中的 `round715Followup` 是本次独立结果，不覆盖历史字段。 |

## 原始目标与当前接受范围

| 原始目标 | 当前实现与证据 | 适用边界 |
| --- | --- | --- |
| R1 三层组织及三角色 AI | `src/department.ts`、`src/departmentConfiguration.ts`、`src/extensionHost/departmentConfigurationHost.ts`、`src/extensionHost/modelSettings.ts`；总监使用当前所选 CLI 分组的模型/思考力度，组长和员工可选其它 CLI/档案/模型/力度。M/D/E/G历史接受及 A697/K698/K699真实链路。 | 接受相应 Codex/OpenCode角色与冻结快照；不能推断所有 CLI/任意模型/平台。 |
| R2 总监 Loop、组长复用真实 Loop+ | `src/extensionHost/departmentruntimecomposition.ts`、`src/extensionHost/departmentorchestration.ts`、`src/extensionHost/loopPlusRuntimeAdapter.ts`；提示保留“例如按模块给各组长、组长再拆子功能”的粗粒度例子，例子不限制唯一拆分方式。统一方案、组长事件验收与总监依据汇报结束沿 P/E/G及后继。 | 总监负责派发/协调/最终确认，**无需代码或测试验收**；不能用单轮返回、tracker清零替代组长门禁。 |
| R3 默认4/20同时运行 | `src/departmentSettings.ts`、`src/departmentcapacity.ts`、组织host/cleanup；C/A697，工作区覆盖见W694。 | 默认4组长、全部门共享常规20员工；不是累计人数或每组20。完整清理及持久移除后释放，未知留责；新根冻结人数。 |
| R4 层级群聊/独立组长页/tab识别 | `src/extensionHost/departmentGroupChatProjection.ts`、`src/extensionHost/loopGroupChatPanelCoordinator.ts`、`src/extensionHost/departmentConversationTabs.ts`、`src/webview/departmentGroupChatModal.ts`；U/V675/M693/F713。 | 总监页面内弹窗打开精确组长；保留现有 tab原名。真实历史弹窗、显示fixture、运行控制/EH分别按原场景，不互相替代。 |

上列源码使用仓库根相对路径。进一步语义见[中央设计](../design-docs/department-mode.md)、[额度策略](../design-docs/department-employee-allocation.md)、[生产接线](../design-docs/department-production-execution-wiring.md)及[群聊合同](../design-docs/department-group-chat-ui-contract.md)。

## 全部22项补充要求：最终要求与接受事实

| 编号与原意（按记录顺序） | 当前合同、入口及接受证据 | 剩余范围或历史解释 |
| --- | --- | --- |
| 1 组长随时请求总监通知另一组协作 | 组织host/composition在运行中中转至同部门目标 Loop+补充队列；P的真实仓储投递、持久回执/幂等及既有wake。 | 根完成须无未处理协作；不是仅结束总结，不承诺任意 CLI恢复组合。 |
| 2 人数限同时运行、完成释放，全部门共享20员工 | C/E/G、A697/K698/K699及原pool/production cleanup；员工含overflow计实际占用。 | 需原资源完整清理、原完整receipt、精确CLOSED/最终冷读及持久容量移除；停止请求、业务completed或EH退出本身不释放。 |
| 3 尽量复用已有能力，Loop+作为组长 | 同一adapter/scheduler/验收器/runner，P/E/G、G695。 | 不另造调度器；总监仍Loop职责。 |
| 4 验收方案配一次、各组统一 | 根配置/持久快照→所有组长同一方案，P/E/G。 | 组长不可独立覆盖，总监不验收；未要求任意修改所有已冻结方案。 |
| 5 总监群聊打开组长用弹窗 | coordinator/内嵌bridge，U/M693/F713。 | 精确task/instance/归属、await后复核；关闭不stop，恢复阅读/焦点。 |
| 6 👴🏻👨🏻👶🏻作为角色tab图标 | **历史要求**，旧U与下方历史快照保留。 | 被补充19的☀️🌛⭐️替代，不再是现行验收标准。 |
| 7 组长弹窗有Loop+同排操作栏，总监页专门做 | 原projection/panel/host；U真实历史适用工具栏、M693刷新、K699公开控制及F713撤销。 | 历史终态隐藏不适用动作合理；不从历史fixture外推所有运行操作已E2E。 |
| 8 零余额每组最多再派1名，避免干等 | `DepartmentCapacityPool`→host准入/adapter，C及额度策略、已接受容量后继。 | **全部门余额零**才允许每组一个未释放应急；只有本组额度耗尽、全局有余额不触发。原overflow未释放不得再领，不因余额回正或扩容抹掉。 |
| 9 每次派发先知道当前余额 | 原生产reader/prompt每轮最新快照，A697四决策对照；真实启动同步原子重判。 | 余额仅参考不预留，未知明确未知；不从历史任务数估算。 |
| 10 tab保持原名，如codex2，只加图标 | U/V675，`formatConversationTabLabel`只前置可信角色图标。 | 不追加角色/模块/编号，原编号/重命名/持久值保持，身份在tooltip。 |
| 11 同步Git、合理合并后全量回归，修问题或夹具 | G695主干/工作区合理合并，S707/T705/F712/F713/F714修复；F715实际统一树官方全量已接受。 | **该官方全量门禁已完成，不再列未执行**；历史失败/3跳过保留。最终原目录安全切交付分支/干净交接另开放，不等于推送发布要求。 |
| 12 常规设置三模式开关，默认Loop/Loop+开、部门关 | `src/modeAvailability.ts`/`src/toolSettings.ts`及设置router，新建/定时异步后复核，M及真实公开设置。 | 已有任务继续、可信内部组长不被公共新建开关误伤。 |
| 13 警告本机须并行20多个CLI的性能 | 常规设置卡/角色区中文性能警告，M的1280/280可见性。 | 产品警告已覆盖，不新增所有硬件/20多个付费模型性能承诺。 |
| 14 尽量多任务推进，无需等所有验收修复 | 独立写域与逐项接受，各来源就绪后推进，G695及后继来源历史。 | 不设共享round gate，不以并行跳过主审；本轮不改调度或启动子代理。 |
| 15 默认平均分配，20/4每组最多5 | `src/departmentemployeeallocation.ts`，默认 `ceil(maxEmployees/maxLeaders)`，分母是配置组长数；20/4=5，A697的6/2=3。 | 组额度不预留/扩大共享池；所有员工含overflow仍计占用，原有限应急例外保持。 |
| 16 最好由总监发起时要求，灵活可人为控制 | 已接受额度/提示生产接线及A697：总监配置根人数、提示传当前本组/全局余额与默认来源。 | 补充17给出直接UI数字调配的最终做法；不新增另一套模型直接写容量或按活跃组数重均分机制。 |
| 17 总监UI数字调配，下次组长派发才生效 | 原总监reader/writer与真实CAS，A697真实UI 3→0→3。save只改desired/revision；下一真实新attempt先持久applied，即使随后拒绝。 | 不取消旧员工、不改原Owner/责任；已held/pending幂等不当新attempt。全局有余而本组0时拒绝无新Owner/租约。 |
| 18 成员面板头像改总/组/员 | 原renderDepartmentRosterPanel明确层级角色映射，V675继承round441/443来源与新字符fixture。 | 初始/patch、总监/组长modal一致，不从任务名首字或任意participant.role推身份。 |
| 19 ☀️🌛⭐️代替人形图标 | V675：部门总监☀️/组长🌛/员工⭐️，优先于普通main/subtask展示。 | 最终现行要求；补充6及旧截图只作历史，不追认为新emoji已验。 |
| 20 原Loop/Loop+主/子图标改🌛⭐️ | V675：经典/事件驱动main🌛、subtask⭐️，历史列表同映射。 | 无角色普通会话不装饰，不按名称推断；tab原名/tooltip/模式保持。 |
| 21 先从主干分支合理合并/处理冲突，再在分支续做 | round676从fetch后主干e890建独立分支，G695再合2cda/40c，保留来源历史和语义冲突处理，后续同分支修复到F715。 | 步骤已有接受事实；原master脏内容不能丢弃，最终交付切换须保全/接受HEAD并解决另一worktree占用。 |
| 22 工作区可配组长/员工人数，优先全局 | W694 `resolveEffectiveDepartmentLimits`，逐项workspace→global→4/20；A697真实UI2/6→生产新根及准入。 | 空值继承、非法读继承/写拒绝、scope/requestId隔离；**仅作用于新根冻结快照**，旧根/恢复不热迁移容量、不释放未知租约。 |

## 已关闭事实、历史失败与仍开放门禁

- **已关闭且不重开**：旧主题/窄屏/真实历史弹窗、最终图标、工作区人数和额度真实UI链、全Codex第二EH、mixed第二EH及旧根公开stop正常收尾、主干合理合并与三修复统一官方全量。各结果仍受上表原输入/平台/具体场景限制；单测自然退出不替代历史worker、receipt/CLOSED或容量证明。
- **必须保留的失败历史**：Round698原464输入官方5439项中5265过/165失败/6取消/3跳过/exit1；后续121个不同case是分批修复，不是第二次全量。Round711官方5462项中5454过/3失败/2取消/3跳过/exit1及精确自有PID74508受控中断保留，Owner两历史超时的首次停点仍未知。lp712/713/714关闭指定回归，lp715证明新统一输入绿，不追改旧失败。round675首错/Tabs超时、额度run1/2清理未知/run4 driver failed与只读审计、旧cold/guard限制均留在原历史及报告。
- **manifest勘误**：round695把历史抄录 `28a1bc69a4488c46aa24ee0d4a5379c12e07d7714df0e8ad3b0794352c85c412` 与实测 `28a1bc69a4488c46aa24ee4d0a5379c12e07d7714df0e8ad3b0794352c85c412` 分开；round698回读原round674第109行确认原始值与实测一致，是交接抄录勘误。保留原matches=false及勘误字段，不称原来源损坏，也不重算未变实体来刷新证据。
- **当前独立补验**：lp715接受截止点，`department-final-store-cold-composition`尚未完成/接受；唯一新缺口是在0817的新共享store/catalog提交主体下，用既有mixed场景验证第二EH持久身份、原完整receipt/CLOSED、容量移除、原authority退役及显式后继。由独立所有者执行，不重跑全Codex、workspace额度、主题/窄屏或官方全量；本表不预记它通过，也不把旧冷链重新统称未运行。
- **最终目录交付开放**：原打开目录master/f5b5ac57既存tracked/untracked脏内容须保全/分类；保全任务有独立所有者，本轮不消费未审结果。最后安全切准确接受HEAD的交付分支、处理另一worktree占用、达到干净交接仍开放。不得据0817独立树干净推断原目录干净；本轮不推送发布。
- **平台限制**：现有真实场景是macOS arm64、对应VS Code/Codex/OpenCode版本与隔离免费确定性provider。Windows/Linux仍缺实际目标主机/执行端口，必要进程/路径/tab/root清理差异未原生验证；恢复条件见[平台入口](department-platform-verification.md)。入口fixture、POSIX快照/有限直接进程观察不等于完整后代树或异平台证据，不重复诊断工具缺失，不猜测连接或扩大任意平台矩阵。
- **三个DSH环境跳过**：`dshLoopSessionResumeLive`中的changed cwd/original cwd resume及failed acceptance/tab closure/process disposal后Loop+续接，需 `SINITEK_DSH_LOOP_LIVE=1`；`dshPluginLiveBoundary`需显式DSH live及loopback配置。lp715未开启条件，不能称真实DSH集成通过；它们与Windows/Linux缺主机是不同限制，不要求凭据或任意模型矩阵。
- **其它未覆盖范围**：远程付费模型质量、真实多进程压力、崩溃/断电、旧二进制/直接外部writer、损坏catalog的任意接管均未由本次证据证明；不把这些范围限制新增成无限验收承诺。未知/冲突/失联继续fail closed、留责，不以PID缺席、磁盘cleaned或EH退出补权限。最终接受及组合影响审查仍由主审完成。

## round-410 历史快照（保留原文，非现行待办）

以下保留原覆盖表时点、当时14项补充和失败边界；当前22项、最终图标、已关闭门禁及仍开放范围以上文为准。

截至 2026-11-16 round-410 中央事实同步。根功能仍为**开发中**，[现有计划](../exec-plans/completed/2026-11/2026-11-13-feature-department-mode.md)保持 active / `in_progress`。本表是需求与接受证据的映射，不是新的执行计划或根验收结论。原始目标及补充 1–14 的顺序取自父任务的 `rootPrompt` / `supplementalRequirements`；报告位置由同一父记录各 `subTasks[].communicationFile` 解析，以下用轮次与子任务 ID 定位，不复制运行时身份或原始日志。

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
