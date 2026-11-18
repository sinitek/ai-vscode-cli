# 部门进程执行的独立 Owner 启动

## 当前配置契约（2026-11-18）

角色配置由可信宿主按实际准备时读取并固定；不得以跨窗口锁、执行租约、共享选择快照或 `isCurrentSelection` 阻断任务启动。保留原子写入、进程内 CLI 配置应用队列、必要读回和 runner 指纹隔离，跨窗口竞争按最后完成者生效。Owner 的身份、代次、责任账本、准入、准备期撤权、排空、原始 receipt 及清理后归还容量保持不变；下方较早轮次中的配置租约/共享 revision 描述仅为历史记录。

状态：开发中。接通范围仅为既有 process 策略的 OpenCode 员工 attempt，支持缺少 executionSession 时首次创建原生会话，以及已有 `ses_…` session 的原生 export 核验；尚不支持自定义思考工作区文件。未接通总监/组长或交互 CLI；不得将 Codex 降级为 print/process。完整生产组织组合尚未通过。

## 可信调用与持久顺序

`extension.ts` 的 `prepareDepartmentInvocation/runPromptNow` 保留固化角色和配置应用队列，不再有执行租约检查。一次性内部 `departmentProcessStream` 闭包复用原有配置命令拆分、`buildCliArgs`、mac shell 与环境快照。它不来自模型 JSON、公开命令或 Owner socket。`promptOneShotRuntime` 和 `promptParallelRuntime` 继续消费既有 OpenCode parser、消息与会话展示端口；Owner 模式禁用隐藏的替代执行、自动运行后压缩及 EH 持有的监控 server。自定义思考工作区文件尚未移到 Owner root，生产入口在任何写入/启动前保守拒绝；模板的 Owner 分支也不调用 EH 工作区文件写入端口，避免改写原工作区。

`createDepartmentProcessPreparation(host)` 的宿主端口为真实生产任务 read/update、`DepartmentRuntimeStore`、workspace 标识和可信 `prepareLaunch(selection, sessionId: string | null)`。实时 adapter 的 `authorizeAttempt` 是新启动的必要能力；恢复时缺失绑定不能通过新建 service/Owner 补跑。单实例最多保留 256 项启动/观察/准入事实，饱和拒绝，不淘汰未知执行。

1. 核对权威 root/leader/module/workspace、running、generation、scheduler 中唯一真实 subtask/attempt、组长及员工既有容量租约。只允许缺少 session 或精确 OpenCode/config 原生 session；已存在但非法/冲突的 session 不降级为新建。当前仅接收 OpenCode employee。
2. 从八字段 allowlist 固定 selection 和指纹；configId/revision 来自现有配置执行选择。Ledger.admit 在 builder 或任何原生准备前持久登记责任；不得使用含认证正文的 profileDigest。
3. 固定仓库 worker 经继承的私有 fork IPC 接受一次严格 preparation。token 绑定本 worker 与精确 identity；拒绝未知字段、重复 preparation 与错误 session 参数。4 MiB 描述上限，argv 至多 4096 项。私有操作及回执各自严格递增序号；公开 socket/pipe 完全沿用最终 bound identity-only 操作。
4. worker 自己取得 `SharedRuntimeConfig` 执行租约并复核 ready/configId/revision。EH 的租约不能替代 worker 的跨 EH 生命周期责任。已有 session 使用相同 CLI prefix 的只读 `export <session>` 核实 ID。首次 session 则由下述 Owner 自有 server 协议创建、核验和冻结，再由可信 builder 重建最终 argv，随后同样通过 export 核验；真实 close/drain/exit0 和有效响应均必要，此时尚未发送任务 prompt。
5. worker 创建真实执行 root/links 和 OpenCode overlay，固定 launcher requirements，回传 prepared。EH 通过现有生产仓储保存并回读精确 executionSession，再 `bindExecution` 并回读 exact identity；两次持久确认后才 private commit、identity-only start；commit ACK 后再次核对当前授权及精确持久 binding。
6. 公开 start 在途时 worker 尚不执行任务，先通过继承私有通道回传一次 `launch-request`；宿主同步复核后发出绑定 token/identity 的一次性 `launch` grant，worker 消费 grant 后才复用 `createDepartmentProcessExecutionLauncher` → `runCliProcess`。启动前私有连接丢失禁止 launch；启动后 EH 消失不取消执行。已有持久绑定只观察原 Owner，不准备替代 worker，不重发任务 prompt。

EH 始终是任务/组织文件唯一写者；worker 不修改这些文件。worker 只持有自己的 Owner receipt/配置租约及执行资源。Electron EH fork 设置 `ELECTRON_RUN_AS_NODE=1`，固定 worker 不导入 vscode 或 CLI 配置。

## OpenCode 首次原生会话（round 237）

仅私有 preparation 可携带 unbound identity，且不可有 session 参数。worker 在原配置执行租约下，经同一个 `runCliProcess` 启动它实际持有的 `serve --pure --hostname 127.0.0.1 --port 0`；命令 prefix、完整基础环境、任务环境覆盖和 OpenCode 配置 overlay 均来自可信固定快照。临时 server 的用户名/随机密码只在必要内存中覆盖，地址仅从该 child 的有界 stdout 解析，不连接外部或未知共享服务。

已安装 OpenCode 1.19.5 的 `/doc` 声明 `POST /session`。本机无模型检查实际发送 `{}` 创建，并以 `GET /session/{id}` 核验同一 ID，新会话消息数为 0；`session` CLI 子命令本身没有 create。实现没有 prompt/message 请求、原生数据库写入或自行生成 session ID。server 每次最多一次 POST，失败不重试。请求和启动有时间/响应体上限；超时或取消只请求终止，只有实际 child close 和自有 stdout/stderr 排空（含 native overlay 清理）才允许准备继续或释放配置租约。若未能证明，则保留未知责任，不生成 cleaned。

server 真实关闭后，worker 冻结返回的 ID，只发送一次严格 `native-session` 回执。bootstrap 只允许同 owner/execution/root/workspace/module/generation/attempt/selection 指纹上的 session 字段 unbound→bound，token/序号/未知字段或重复回执冲突均拒绝。宿主复核权威和 caller 生命周期后，调用同一 `prepareLaunch(selection, nativeId)`；extension 仍用现有 `buildCliArgs` 产生唯一精确 session 参数，不替换字符串。除该参数外的 argv、环境、overlay、路径、command 和 shell 快照不可漂移。worker 仅接受一次精确 token/序号/identity 的 finalize，然后才创建最终 process launcher。

EH 在原 admission 内保存 executionSession 并精确回读，再原子提交完整 binding/责任引用并精确回读；之后才 commit/start/grant。session 保存是本次允许的唯一授权快照变化，不能采纳其它 session、路由或 attempt 变化。每个异步 builder/native/prepared/commit 边界继续核对当前权威、容量、配置、代次和取消。`SharedRuntimeConfig.isCurrentSelection` 是持有执行租约期间的只读同步 metadata guard，使最终 grant 复核配置 ready/configId/revision 也不引入 await；worker 同样在准备、commit、start 和实际 grant 边界核验，合法配置切换仍由原租约机制拒绝。

原生准备前的 `opencode-preparations/<slot hash>.json` 以 wx/fsync 持久保留 identity/八字段 selection，收到可信 ID 后另存一次 `.native.json` 冻结回执；不保存 prompt、argv、环境、认证/配置正文或 profileDigest。它是未知责任的单次准备保留记录，不是 receipt 或恢复启动授权。断连、取消、写入失败均不删除记录或原生历史；重入有 binding 只观察原 Owner，无 binding 但已有准备记录则拒绝另建 Owner/session。失败需后续可信恢复设计处理，本轮不接管。

## 准备期撤权与启动线性化（round 121）

每次可信异步 builder、worker prepared、commit ACK 返回后都重读授权。最终复核比较 root/leader running、workspace/module、角色 routes/limits、根及组长 CLI/session、组长调度模式、generation、唯一 subtask/attempt、原生 executionSession 和已有容量；session 保存和 binding 确认后还须重读精确 identity/selection/requirements。task.updatedAt、聊天或报告字段不作为授权签名，避免自己的合法 session 写入导致误拒；写 session 时使用当前 subTasks，保留等待期间其它合法变动。

启动/取消的线性化点是**宿主收到 worker 的 launch-request 后，同步复核通过并发出一次性私有 grant**。复核与发送之间没有 await；公开 start 请求发出、commit ACK 或 PID 都不是启动授权。取消先发生时关闭并永久撤销本次准备通道，迟到 prepared/committed/launch-request ACK 不能复活，已持久绑定不删除，不换 Owner 重发。worker 消费 grant 后在同一次事件的 Promise 微任务中调用现有 launcher/runCliProcess，期间没有新的异步能力或 I/O 等待；它仍检查相同 identity、phase 和私有连接。授权发出后调用方取消可能与实际 OS spawn 在传输中重叠，按已经授权启动处理，不承诺取消成功，也不杀死独立 Owner。若 grant 未送达，结果为 unknown；不得推断任务已启动或允许替代重试。

caller AbortSignal 不依赖任务记录变化；可信 isAborted 同步 guard 也在最终 grant 复核。准备期 EH 断开或撤权不发 prompt。若只读原生 export 仍活动，worker 必须等待其真实 close/drain 后归还准备租约；取消 ACK 不充当排空或 receipt。已启动执行继续跨 EH 断开存活。未启动路径只清理实际拥有的准备资源，不为 native-session/tab 缺失能力制造 confirmed，原有容量和未知责任继续保留。

## 输出与事实

内部事件绑定 token、完整 execution identity 和严格递增序号，stdout/stderr 每片最多 8192 UTF-16 单位。单发送在途、最多 40 项待发（输出在 32 项开始舍弃并制造可检测序号缺口）；断开或背压不阻塞真实 stdio 消费。序号缺口、通道丢失均为不可观察，不伪造业务或清理成功。旧 attempt 的事件只能进入其原 handlers，现有 run-active 门禁阻止写入新调用。

业务 onExit/onError 与完整 receipt 分离。返回的 stream lifecycle 只用于真实 processTerminal/streams；其 temp 显式要求查询 Owner 完整 receipt。共享的 `startDepartmentProcessInvocation` stream 在异步准备期间允许 kill 请求取消；adapter 的 AbortSignal 同时贯穿 extension、coordinator 和 worker 私有准备通道。kill 的 true 仅表示收到取消请求，不证明已停止或已清理；私有 grant 发出后的取消不回滚已经授权的 Owner 执行，已返回的 Owner handle.kill 仍为 false。没有新增公开 stop IPC。

| 项目 | 当前事实来源 | 当前缺口 |
| --- | --- | --- |
| processTerminal / streams | runCliProcess 在创建 child 后立即安装的真实 lifecycle | exit、PID、定时器和业务 Promise 均不能代替 |
| turnTerminal | process 合同明确 not-applicable | 不用于交互执行 |
| runner/session | runner 仅在 process launcher 已确认原 child close 与全部 stdio drain 后释放 worker 持有的配置执行租约；OpenCode 原生 session 历史保留 | 不删除 session；close/drain 缺失时不释放其它资源 |
| root / links | worker 创建的真实执行目录，首次实际 dispose 结果共用且不重试 | 删除失败保留失败 |
| temp | 只合并核心 overlay lifecycle 与额外 temp 资源；overlay 失败原样保留 | overlay 清理失败不得被其它资源成功覆盖；配置租约属于 runner 释放 |
| tab | worker 通过严格私有事件请求原 EH capability；原消费者结束、精确 identity 仍拥有、实际关闭并回读消失后确认 | 缺 tab capability、消费者失败、EH 断连或对象变化保持 unknown |
| group/capacity | 已封闭完整集合可包含 Codex 组长及 OpenCode/Codex 员工；逐项等原 Owner receipt、复核 selection 和 binding、冷读集合一致后才由既有 orchestration 持久移除容量 | OpenCode employee 的真实 VS Code EH/CLI 完整链路尚未作本轮实机验收；任一失败仍保留容量和原责任 |

进程自然 close/drain 后，Owner 按序释放 runner（含配置租约）、root/links、overlay 与其它 temp、tab；每项必须来自真实能力，Owner receipt 仅在全部 requirements 满足时生成。生产组清理可观察含 OpenCode employee 的完整集合，并复用原 producer 保存的 client；最终冷读、selection/binding 核验与现有持久容量移除顺序不变。任何能力缺失/失败/身份变化/断连仍是 unknown，保留责任和占用。OpenCode 原生 session 与历史保留，不作为释放动作。该接线没有拓宽到 OpenCode 组长、其它 CLI、冷恢复或全树控制；整体 EH/CLI 与跨平台仍待验收。

环境合同保持已验收顺序：完整基础环境（缺省 process.env）→任务 envOverrides→生成的 overlay→cwd 覆盖 PWD；不修改传入对象，不向显式隔离环境补入遗漏的宿主变量。

## 验证与后续门禁

`departmentprocessbootstrap.test.ts` 使用普通 Node 加载真实 coordinator/worker，真实临时配置租约和 runtime 绑定、受控 Node CLI、后代持有尾管道及文件门闩；拒绝配置/身份/持久写入冲突时任务 spawn 为零。任务 Map 是该组测试的替身，不代表生产仓储证据。独立 starting host 退出后由原 Owner 持有载荷，新 host 只读观察。

`verify_department_process_owner_host.js` 单独以私有 HOME/workspace/user-data 启动已安装 VS Code，复用自动激活及 extension-test 正常退出机制，不新增产品 debug 命令。测试入口通过激活已持有的生产仓储/router 执行真实 session 更新、组织绑定、coordinator 和固定 Node worker，使用既有 OpenCode parser 与消息文件 API。它是内部端口的最小 EH 场景，不自动驱动整个 runPromptNow/模型路由/浏览器交互；这些仍需整体集成验收。真实 CLI 的 export/run 协议由免费 Node fixture 替代，不能据此宣称真实 OpenCode 模型或原生 session 清理通过。

后续必须完成真实角色配置/模型的整体调用验收、runner/session/tab 的实际释放、总监/组长及交互执行 Owner、整组 receipt 聚合、容量释放、全树 stop/continue 与冷重启恢复。当前不开放组长整组清理门禁、不发布扩展。不改变本体概念、公开 IPC、receipt 或 4/20/每组一个超额规则；只补充已有 launcher 实现和窄范围生产来源引用。

round 121 新增文件/消息门闩检查覆盖 builder、prepared、commit ACK 和公开 start 在途期间的权威撤回与 caller 取消；放行旧 ACK 后任务 run 仍为零。最终字段变化及自身 updatedAt 改变分别验证拒绝/兼容。`verify_department_process_owner_host.js --prelaunch-cancel` 在隔离真实 EH 中运行真实 adapter → 与 extension 相同的 stream bridge → coordinator → 固定 worker：只读原生 export 等待门闩时取消，任务记录不变、任务 run 为零，export 真实排空后租约释放；容量仍保留。该场景使用注入的可信 builder/会话目标与容量回调替身，不驱动完整 runPromptNow/角色选择或浏览器，也不重复声称成功输出证据。

round 237 的 `departmentopencodesessionpreparation.test.ts` 在不安装 vscode mock 的普通 Node 中，使用真实独立 worker/runCliProcess、真实临时配置租约、Ledger 与原子 binding 存储，以及免费 HTTP/CLI 协议夹具。任务仓储仍是 Map/文件替身，runner/session/tab 仍 required/unobservable；不宣称真实生产仓储、完整 runPromptNow、模型、UI 或跨平台验收。门闩覆盖创建、持久化、commit 与 final grant 的撤权/取消/配置冲突/断连、首次 ID 冻结、两次回读前零任务、重复准备/恢复不重放及严格私有身份/序号。旧已绑定生产/EH 存活证据只按未变范围复用。OpenCode 整组观察仍 null，不修改 Codex、容量算法、producer/cleanup 或持久化后归还顺序。
