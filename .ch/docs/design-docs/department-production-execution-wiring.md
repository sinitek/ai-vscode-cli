# 部门生产执行准入与真实 Loop+ 接线

状态：开发中。本文记录 Codex/OpenCode 组长与员工准备链的生产宿主装配，不声明产研部整体完成。

## 实际来源与装配

`extension.ts` 使用一个 `createDepartmentExecutionProducer` 实例，将同一不可序列化 employeeAdmission 注入 Codex 和 OpenCode preparation，并将同一 producer 交给 `createDepartmentLeaderProductionHost`。真实 `LoopPlusRuntimeAdapter.runMain` 对部门组长只调用 `runDepartmentMain`；组长角色路由支持 Codex 与 OpenCode 的原生 Owner 准备，其他不支持的 CLI/身份或缺失端口明确拒绝，不能回退普通 EH runner。总监仍走经典 Loop，普通 Loop/Loop+ 保留既有入口。界面布局、tab 原名和角色图标不改。

producer 的新代来源是专用任务仓储唯一 CREATE 的实际返回值，宿主记录一次内存创建凭据。组织获得真实组长容量租约、创建并持久成员后，在 scheduler 首次 pump 前消费该凭据，按权威 root/leader/module/workspace/generation、角色路线和运行状态调用 `Ledger.open`。成员原子替代 starting reservation，持久快照不能同时把同一模块列为 preparing 和 owned。

任何旧责任、原 binding、原 native session、历史 rounds/subtasks、冷恢复任务或来自其它 producer 的代次都不能收养。持久字段不生成创建凭据；模型/UI/普通任务数据没有工厂或控制通道。异常保留未知责任和占用，不换 Owner 或重放 prompt。

## 逐轮与员工准入

同一组长使用原多轮原生 Owner 端口，同一 identity v1、scope、selection、slot 和 thread。每次真实 scheduler main 调用固定 invocationId 和 prompt；每轮仍是独立不可变 CodexOwnedExecution、transport、终态和消费者责任。首轮真实 thread/start，后续只精确 resume 原 native thread；不重复 execute 同一对象。

宿主使用原配置队列、角色配置固化、SharedRuntimeConfig 执行租约和可信配置 builder。组长仍经既有 `runPromptInteractive` 消息、日志、工具请求、用户交互和运行记录消费者；传输由 departmentCodexRun 交给独立原生 Owner，单次调用保护及无隐藏重试合同保持。原生 main 抛错会令真实 scheduler 一次暂停；普通任务保留原五次错误门槛。已完整执行但协议格式需修复的后续协调调用仍由既有 scheduler 决策，不把未知送达包装为可重试任务。

员工准入复用原 `Ledger.admit`，不复制 Store 验证，也不另开 bindExecution 路径。每个真实 scheduler attempt 在 builder/原生准备前固定 selection 和 requirements 并落盘；首次 native session 保存回读、原子 binding/责任引用回读、commit、原 Owner 绑定及最终同步复核/一次性 grant 均保留。process overlay 策略与现有 OpenCode 固定模型 overlay builder 对齐；没有模型时准备前拒绝。生产 OpenCode preparation 可在可信新 attempt 尚无原生 session 时创建并核验首个 session，随后持久化精确 `executionSession` 与 binding；后续续接只允许原生身份、binding、selection、canonical directory 和 continuation 来源逐项匹配。round-224 的已有 session/受控 fixture 只覆盖当时范围，不能作为当前生产首次创建仍未接线的依据；也不由此扩大到任意 CLI 或冷恢复接管。

## 本地会话与原生身份

任务 `sessionId` 继续是 tab/本地仓储关联键。新增顶层 `executionSession: { cli, sessionId, configId }` 专存组长原生绑定，两个字段不能互换。真实 thread 响应后，唯一任务写者保存并精确回读该字段，再经 admit.bind 原子保存组织 binding 并精确回读，worker 确认原 Owner.bindSession 后最终授权，随后才允许 turn/start。

现有交互 onThreadId 消费者对部门 main 仅维护本地键到 native thread 的映射，不 promote/migrate 本地 tab 键；员工与普通交互仍沿用原策略。

冷读与写入共享严格合同：只允许精确的 CLI、原生 session ID 与 `configId`；组长的 Codex/OpenCode 路线分别验证其固化配置和原 identity 支持的 native ID。拒绝 `local_`、本地键、空白修饰、额外字段、错误 CLI/config 和替换已绑定 thread。受控任务 repository 同时验证规范化结果；损坏绑定不被降为无绑定新建。后续调用沿用首次原绑定，只读观察已有绑定，不重复首次 session 写入；未知 continuation source 拒绝推进。

## 封闭与真实等待

`isCurrent` 只验证原代身份归属，在 closing/closed 时仍可供 Ledger.close 最终回验。独立 `canLaunch` 是不可逆启动栅栏：每次重读权威任务、组织成员/generation、workspace/module、固化路线及实际容量租约；只有 open 且 running 才返回 true。两个员工准入和组长最终 grant 均使用该栅栏，封闭后 isCurrent 仍真不能授权任务。

producer.track 从真实 main/员工外层准备入口保留原 Promise，Ledger.admit 同时覆盖原生准备、异步 session/binding 和 grant；取消后的原始 builder/持久化仍保留。每代在途责任最多 256 项、宿主最多保留 128 个新代/创建凭据，不淘汰未知责任或缓存输出。原 Owner 的每代 invocation 和 callback 数量限制不变。

真实 scheduler 协调生命周期停止新增调用后，adapter 在 idle 等待前调用生产 close；stopLeader 和 EH deactivation 也先同步封闭准入/最终 grant，再等待原 Owner seal/drain 和所有已进入的原始责任。native drain 失败也必须等挂起准备真实结算后才报告失败，不用 Promise.all 的提前拒绝跳过责任。没有原生端口时保持 unknown，仍等已进入准备，不从空集合制造 closure。

只有明确封闭、真实原生协调 drain 和所有已进入责任共同确认，才生成同 scope 的随机 admissionFence 供 `Ledger.close` 持久封闭。准备失败/取消留下 null；封闭事实与 cleaned receipt 是不同事实。取消/撤权/封闭在 grant 前发生则零任务，迟到 builder/ACK 不复活。grant 后普通取消或 EH 退出不终止原合法执行；消费者丢失、物理 pipe 或终态不明仍 unknown，不重放。

## 验证与可复用证据

Round-222 的多轮 Owner 25 项、员工 82 个不同 bootstrap 用例、交互 52 项及 launcher/私有 IPC 原结果继续覆盖未改组件。本轮改变最终准入辅助检查、原生 main 持久合同、adapter/组织入口与 scheduler 部门错误分支；新增集成覆盖这些生产装配缺口，并运行直接受影响的普通 Loop+、Ledger 和任务仓储回归，不重跑历史 native/launcher 全套。

实体隔离构建位置见 `.tmp/round224-production-wiring/build-location`。标准命令 `npm run build` 仅在物理源码副本中执行；共享 dist 不动。新增行为命令为 `node --test-reporter=tap --test-concurrency=1 --test dist/test/extensionHost/departmentproductionwiring.test.js`，HOME/USERPROFILE/CODEX_HOME 均隔离。实际生产 producer、专用任务仓储、组合入口、真实 scheduler/adapter、临时 RuntimeStore、SharedRuntimeConfig 和固定 Node worker 参与；模拟 native CLI 与界面/运行记录消费者是受控免费 fixture，非真实模型、完整 EH/UI 或真实用户交互。

最终标准构建 exit0；新增生产接线 10/10（约5.33秒）、直接受影响交互 53/53（约3.18秒）、普通 adapter 定向 12/12 通过。Ledger/组织/任务仓储/普通 scheduler 合并最小模块回归 216/217；唯一余额刷新旧用例在 round-222 原隔离产物也复现相同失败，未改写该历史期望或据此称整套通过。一次更宽的 adapter 合并执行因旧 stop/resume 用例挂起触发外部120秒保护，未计为通过；最终定向 adapter 不含该挂起用例。ontology validate 与工具9/9通过。具体命令、失败诊断及源码 SHA256 覆盖由 round-224 attempt 报告和隔离副本日志记录。测试 teardown 的 kill/remove 不计资源释放证据。

## 后续门禁

生产 `observeLeaderCleanup` 已在限定同宿主、新建且从首次准备起完整覆盖的组长执行集合中接线：原 client 的私有观察成功、完整 binding/selection 与集合 closure 校验、最终冷读后，持久移除组长租约才释放容量；缺失/失联/unknown 保留责任和容量，不从磁盘 cleaned 补成功。该范围不证明跨宿主冷恢复或所有身份/旧代 writer。round-400 passive observer 改动仅属 EH fixture：最终隔离 build 与10/10定向 IPC 测试证明真正 grant 才读回、普通 callback ACK 跳过且 observer 异常不改写/阻断原始 send；不等于生产 observer 或冷恢复已通过。round-400 cold EH 仅观察员工 binding、原 Owner live、首 EH 正常退出及退出后 binding/容量保留；第二 EH target discovery 超时并强制回收。round-403 CDP detach/close 清理诊断失败传播门禁与迟到 detach 定向回归已接受，但仅证明 harness 自有资源清理，不是 Owner receipt、CLOSED、容量释放或生产恢复；该轮 cold 仍 failed，未证明 stop 送达。round-405 observer 的实体标准 build 与11个不同定向用例通过，唯一 cold 确认公开 stop 送达、warning 为 `invalid-recovery`，未抵达 `live-leader-unverifiable`；缺完整控制后快照、四阶段身份与无新 grant/request 对照，整项主审 failed，CDP confirmed 仅证明 harness 门禁且原运行强制回收第二 EH。round-405 当时 `settleColdPublicControl` 仅有1项定向单测且最终 driver 未真实运行、冷路由准备修复已派发，均为该轮历史状态。round-408 已修复冷 stop 先复用原 `prepareRoutes` 建立可信路由、异步后重核精确身份的生产顺序；实体标准 build 与33个不同定向 composition 用例通过，暖 stop 首 await 前封闭准入保持。唯一真实 cold stop 再次送达，但 warning 为 `unverified-leader-session-or-plan`，仍非目标 `live-leader-unverifiable`，故整体主审仍 failed。CDP confirmed 后第二 EH 自行 exit 1、`forcedTeardown=false`，实际覆盖 `settleColdPublicControl` 失败等待分支；这不表示场景通过、Owner receipt、CLOSED 或容量释放。完整 afterControl、四阶段身份及第二 EH 无新 grant/request 对照仍缺。当前只读诊断/源码指向 `inspectLeaderSession` 冷 tab/session 关联边界，未直接捕获实际私有 tab 分支；上述身份边界“待审”和 round-408 warning 未到拒绝分支，均限定为 round-408 时点。round-410 只读持久身份 reader 与实际 `live-leader-unverifiable` 安全拒绝已通过主审及限定 cold 对照；running leader 无真实 target/完整 Owner aggregate 时仍 fail closed 并保留容量。真实其它角色所有权、OpenCode 冷恢复和整树组合、必要平台入口及最终真实 EH/UI 验收仍有开放门禁。round-403 macOS owner-core 固定入口套件58/58、exit 0；后代追踪未启用且整树关闭未确认，不代表 Windows/Linux、真实 EH/tab/root 或整树验收。


## Round-440 可信冷恢复 Tab 登记

原恢复协调器核验原 scope、完整 selection/requirements、独立本地 transcript 与 native session、原 authority 完整 receipts 和精确 CLOSED 后，才由既有 session manager 关联真实 Tab。协调器为该实际对象签发 WeakMap 保存的一次性内存登记能力；结构对象、磁盘 Tab ID、过期请求及重复消费不能登记。生产 restoreTarget 同步把该能力交给 DepartmentExecutionResources，测试夹具不再以 recordCreated 模拟恢复所有权。

登记绑定本 EH 的精确 Tab 对象、workspace、CLI、本地 session 和原 scope；不启动 prompt 或 grant。登记在最终 retirement 之前发生，消费者保持禁用，直到原容量持久移除、原 authority 退役和一次性 retirement 交接完成。后继 binding 必须为同 root/module/leader 的后续 generation。原代能力不授权新代启动，显式 continue 仍须走原 producer/Owner 准入。

冲突登记、活动/替换 Tab、session 漂移、失败消费者和已请求 release 不覆盖、不洗净、不驱逐；保留 256 登记及 64 消费者限额。正常 release 仍等待原消费者、核对精确 identity、关闭和回读，未知责任保留占用。真实第二 EH 组合结果见冷恢复专属 runbook 与本轮报告，不由组件通过外推。

## Round-674：OpenCode 原代启动输入与跨 EH 退出观察

原多轮 OpenCode Owner 的继承 EH 环境是首次创建输入。生产入口通过 `captureOpenCodeEnvironment(taskId)` 按精确 scope/generation 保留首次快照，再用于每轮不可变 launch 比对。返回副本防止调用者改写，最多128项；未知/失败准备保留，正常完整清理后的 `release` 删除。显式 environment、envOverrides、命令、argv、overlay、selection、native session 和 generation 仍按原门禁核对，不能借环境快照重用旧 grant。busy、重复 invocation、selection、上限、launch 和 native session 拒绝现在仅附安全类别，不输出启动内容或私有凭据。

原失败日志可见首轮之后 EH 懒加载本地化元数据，逐轮抓取整个环境会改变 launchKey。真实生产组件以可控迟到环境变更稳定得到 `:launch`，保留原代快照后两轮通过同一 Owner/native session，显式变化与重复调用仍拒绝。历史 round440 具体分支没有直接记录，不能将该回归倒写为旧运行已经捕获的 guard 分支；原失败及全部候选条件继续可审计。

冷验证复用原公共 driver、session-preparation observer、完整 receipts/CLOSED/容量门禁。新增 fixture 只被动记录实际 fork 的初始化身份和PID；独立 harness 进程通过 macOS kqueue `NOTE_EXIT|NOTE_EXITSTATUS` 捕获真正内核退出状态，跨越首EH退出。它不向业务进程发信号，不 ref、等待回收、改业务IPC或生成凭证。原 authority 真实退出后才允许测试驱动公开继续；后继完整清理之外还分别要求 Owner/authority code0、signal=null。退出事实不能替代业务完整清理，业务凭证也不能替代退出事实。当前观察器限定macOS；其它平台仍需等价实机验证。执行快照及限制见专属冷恢复runbook和round674报告。
