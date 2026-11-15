# 部门执行 Owner 与清理凭证

状态：开发中。独立 runtime、runner 分项事实与员工只读恢复消费者已实现；round 220 已将 Codex/OpenCode 员工准备链接入准备前责任登记和原子绑定，round 222 已审查 Codex 组长多轮原生 Owner，round 224 已将生产 producer、组长真实 Loop+ scheduler/Owner 与两条员工准入接入生产组合，并在真实新建路径建立 Ledger.open。round 228 已审查已装配 Codex 路径的真实 runner/session 释放证据、精确 tab 释放能力、extension consumer 登记以及原 Owner 自行生成完整 receipt。round 234 又审查了同宿主新建且完整覆盖的 Codex 组长/员工执行集合观察与容量消费：真实 producer 封闭准入并排空在途责任，原 client 私有严格 socket 观察所有凭证，最终冷读完整封闭集合后，只有持久移除组长租约成功才实际 release；失败或 unknown 保留占用。该实现让 `observeLeaderCleanup` 在上述范围不再一概为 null，但不能外推到冷恢复、其他 CLI 或未覆盖的所有权。阶段索引消除每个 binding 重复全量读取，共享底层责任和可移除的有界订阅处理取消；取消观察不取消原执行。生产容量消费仍有范围限制：原 Owner socket 收尾后后续 client 可能不可达，是可信凭证观察的具体缺口；员工消费者在自身成功 receipt 后归还员工租约，不等于组长/整组容量已归还。OpenCode 首次原生会话、其他角色/CLI 所有权与释放、真实 Codex binary EOF/多轮 drain、生产全树 stop/continue、冷恢复及最终真实 EH/UI/平台组合仍待验收。round 225 只修复测试 fixture 的启动诊断和关闭证据，不扩展生产生命周期证明。详见[进程启动范围](department-process-production-bootstrap.md)、[Codex launcher 专题](department-codex-execution-launcher.md)、[生产组长装配专题](department-production-execution-wiring.md)和[执行集合清理专题](department-leader-execution-cleanup.md)。

## 边界

DepartmentExecutionOwnerServer 必须运行在真实执行对象生命周期可覆盖的进程中。它独占一个部门执行数据目录，接收本机 DepartmentExecutionOwnerClient 的有限请求，并通过构造时注入的 TrustedExecutionLauncher 启动既有 runner。runner port 属于可信宿主代码；IPC 不接受 executable、shell、argv、任意路径、代码、prompt 或模型输出。Loop+/部门 coordinator 仍负责角色配置、调度、acceptance 与容量租约；owner 只记录 execution identity、持有真实 runner handle、转交观察并发布 terminal/cleanup receipt。

当前 process 适配器复用 runCliProcess；OpenCode 员工的受限生产入口将真实执行对象、root/links/overlay 与配置执行租约放在固定独立 Node worker 中。round 122 的 Codex 适配器复用 `CodexOwnedExecution` 与原 `TrustedExecutionLauncher`，在受控普通 Node Owner 中持有原执行；round 224 后 Codex 组长原生 Owner 已进入真实 Loop+ 生产装配。round 228 已为实际接线的 Codex 员工/组长路径审查真实 runner/session 释放、精确 tab 释放及原 Owner 完整 receipt 生成；其验证 CLI 为固定模拟 Node，不能证明真实 Codex binary EOF、多轮自然 drain 或最终整树容量消费。未装配角色、OpenCode 首次会话及更广泛 EH/UI 组合仍不在此证据内；round 117 的 OpenCode 员工 coordinator/EH 范围见进程启动设计。

## 身份与存储

版本 1 identity 绑定 workspace、department root、leader task/module、leader/employee role、generation、CLI、config/profile SHA-256 fingerprint、session、ownerId 和 executionId。employee identity 必须额外绑定 subtaskId 与 attemptId。workspace 是不参与文件路径解析的不透明业务标识。fingerprint 由可信宿主从不含认证字段的 resolved config/profile 元数据计算；凭证、令牌、会话正文和完整 prompt 不得进入 identity。

starting 时 session 可为显式 unbound。只有原 owner launcher 可调用一次 session bind；客户端不能猜 tab/session。每个 executionId 原子写 versioned receipt。首次使用 slot index 时，先扫描并严格校验全部旧 JSON receipt，再按 slot 汇总所有代次；任何损坏/路径身份不匹配记录、同 slot 同 generation 不同 executionId、或被较新代次遮蔽的未 cleaned 记录，都会让迁移保持不可用。完整验证通过后才逐项发布 seen 与 slot 指针，最后原子写迁移完成标记。索引写入中断时标记保持缺失；当前实例继续返回 unknown，新实例会重新扫描原始 receipt、重建指针并重试。迁移不删除或改写原始 receipt，失败产生的部分索引只会在后续完整验证成功时被覆盖。迁移完成后，每次 start 只读取对应 slot 指针及其当前 execution receipt，不再扫描目录。新 slot 先写永久 seen 标记和当前指针，再写 starting receipt；指针缺失但 seen 标记存在时返回 unknown。seen 标记、slot 指针和全部 execution receipt 不做自动压缩或删除，因此保留重复请求幂等及 generation fencing；磁盘容量耗尽或任何必要事实损坏时 fail closed。exclusive owner lock 保证单一 owner server；slot 指针拒绝仍未 cleaned 的并发 generation，旧 generation 和重复 executionId 不能覆盖新记录。handoff 递增 claimGeneration，旧 claim 后续 handoff 会冲突。记录损坏、锁已存在、owner 不可达或缺失 execution object 都返回 unknown/conflict，不按 PID、mtime、超时或 Promise 状态启动替代 owner。异常退出可能留下 lock/socket；不能自动删除或偷取该锁，因为这无法证明旧 owner/载荷已退出。

Unix 使用本机 domain socket，并将 endpoint chmod 为 0600；Windows 使用本机 named pipe。endpoint 由可信目录派生，没有 TCP fallback。部署方应将 store directory 放在当前用户专属的应用数据目录中，作为 POSIX socket mode 与 Windows profile ACL 的边界。服务限制 32 条并行连接、单消息 64 KiB、每连接单请求，并拒绝未知字段和 operation。close 先关闭新 start admission；如 launcher 尚未返回 handle 或仍有未清理 handle，close 拒绝且保留 listener、endpoint 和独占锁，之后可在状态安全时重试。正常关闭时只删除本服务创建且 inode 匹配的 Unix endpoint 与 lock；Windows pipe 随 server close 释放。

## 状态与 receipt

客户端可以 start、observe、handoff。start IPC 只接收严格校验的 identity；cleanup requirements 由 owner 进程注入的可信 launcher 根据 identity 计算并在 starting 记录中持久化，客户端不能放宽必需清理项。断开客户端不会取消 owner 正持有的 runner handle；相同 executionId 重试只返回已有状态，不二次 spawn。观察结果区分 live、finalizing、cleaned、unknown、conflict。cleaned 只能由 server 内部在可信 handle 的 completion 和 cleanup 都返回后写入；IPC 没有 receipt 提交操作。

receipt 分别保存 process terminal、turn terminal、stream drain、runner release、execution root、links、temp 与 tab 结果。必需项只能为 confirmed；不适用项必须明确 not-applicable；failed 或 unobservable 一律不生成 cleaned receipt。当前合同以 required/n-a 布尔表表达执行种类。生产 adapter 必须从真实 runner 提供这些逐项事实，且对无法报告的 tab/root cleanup 返回 unobservable。

任何一个检查不成立时，owner 只保留 starting/live/cleanup-failed 等非 clean 状态。owner 丢失或记录损坏后的客户端只能得到 unknown；Loop+ 后续接线必须保留 blocked 与容量，不得通过 owner API 自动重启旧执行、释放 capacity 或绕过角色 profile。

## 精确身份的客户端清理观察

`DepartmentExecutionOwnerClient.waitForCleanup(identity, requirements, signal?)` 是只读 IPC 观察端口：必须提供可信宿主持久保存的 bound identity 和预期清理策略，只发送 observe，不调用 start/handoff，不读取磁盘 completed 状态、不创建替代 owner。live 或合法 finalizing 时沿用同一串行退避，每次只保留一个连接；只有收到与完整身份一致、且逐项 requirements 与预期一致的完整 receipt 才返回。unknown/conflict、缺失 owner、损坏响应、未绑定 session 或策略不符均拒绝；取消会关闭当前连接并移除监听器，但不取消真实执行，也不证明清理完成。原 Server 仍持有精确 entry/handle、已核验 terminal/drain、正在 await 原 cleanup，且持久 live 记录身份、revision、claimGeneration 和原 requirements 一致时，才返回只含 status、identity、claimGeneration 三字段的 finalizing；不携带 receipt。它不代表清理成功，不能填充私有完成缓存、释放 blocked/租约、启动新执行或递增 handoff claim。缺失上述内存事实仍为 unknown；调用方不能泛化重试 unknown。

所有客户端 cleaned 响应同时验证外层 identity 和 receipt.identity 完全一致，避免同一响应使用匹配当前请求的外层身份，却夹带另一执行的合法 receipt。该端口没有接管容量或调度的权限，也没有成为生产 runner 接线的替代品。

观察立即发起第一次请求；连续 live/finalizing 后分别等待 250、500、1000、2000、4000ms，此后最多每 5000ms 一次，均在上次请求结束后计时。同一 waiter 始终串行，稳定期最多 12 次/分钟，没有执行时限；退避上限不推断执行结束。取消同时覆盖正在请求与退避等待，移除 abort listener 和定时器。不同 client/waiter 不共享连接或取消信号。

### Round 372：原清理待决观察

`finalizing` 是协议 v1 新增的只读响应，不新增请求字段或持久状态。终态 Promise 结算而 terminal/drain 为 failed/unobservable 时不能返回该态。磁盘 live、PID、时间及旧 Owner 丢失均不能重建它；Server 完成原 cleanup、严格验证全部 required 项并原子提交后，才返回 cleaned。清理失败、损坏、错身份/策略、失联仍拒绝。重复 start 只观察原执行，finalizing 的 handoff 不递增 claim；close 在原清理未完成时拒绝并保留本实例锁/端点，新 start admission 继续关闭。旧客户端不认识该响应时沿用安全拒绝，不静默放行。

原 waiter 跨 live/finalizing 切换不重置 250ms→5s 退避，不设执行期限。取消只移除此 waiter 的 socket、timer 和 listener，不取消原执行、原清理或其它观察者。只有外层 identity、receipt.identity 和可信 requirements 全部匹配的完整 receipt 可进入原 client 私有缓存。员工 facade 随后仍须完成原 worker 的 shutdown/stopped 握手，`service.observe.done` 才成功；完整凭证和 stopped 不能互相替代。

新增回归使用真实 Server/Client、独立 Node Owner/载荷，以及另一个生产员工 facade、固定生产 worker 与受控 tab consumer 的直接集成。门闩期间原 waiter 必须至少两次实际观察 finalizing，既不拒绝也不成功；放行后取原 receipt，再等待原 shutdown/stopped 握手。模拟 terminal 不可核验、清理失败、Owner 失联、记录损坏、取消和协议形状错误都不产生成功。此验证不重放 round-369 的真实 OpenCode/EH 场景，不证明全角色 EH、冷恢复或 Windows/Linux 实机。

## 已实现的生产 runner 事实端口（round 105）

这些端口已位于真实 runner 的实现中，但没有改变执行所有权或部门租约消费端，**不是独立生产 Owner 接线完成**。

| 端口 | 能证明的事实 | 不能推导的事实 |
| --- | --- | --- |
| `observeChildProcessLifecycle(child)` | 先观察 spawn，再等待真实 child close 与全部自有 stdio close；输出必须 end、输入必须 finish，流错误或提前 destroy 返回 unobservable。exit/error/kill/定时器不结算该端口。 | 后代进程树、CLI session、执行目录与 tab 清理；没有观察到的 spawn 不能假定发生。 |
| `RunProcess.lifecycle` | `runCliStream`、`startOpenCodeServer` 创建 child 时安装上面的观察，并返回 processTerminal/streams/temp 结果。overlay 在真实 close 后清理，child error 不提前删除活动配置；保留第一次清理结果，不以隐式重试折叠失败。 | 普通 onExit 仍是业务回调，不能升级为完整 receipt；缺失 lifecycle 的旧/未启动 handle 不能产生成功事实。 |
| `OpenCodeRuntimeConfigOverlay.cleanup()` | 返回明确结果；核对自建目录 dev/ino、拒绝替换目录及未知内容，删除自有配置和空目录后用 lstat 确认不存在。失败不缓存成功，可信调用方可显式重试。 | 不删除未知文件、不清理他人的目录；单独 temp confirmed 不代表 runner 释放。 |
| `CodexAppServerNdjsonReader.drained` | 自然 EOF 且消费全部排队行才 confirmed；主动 close、提前结束 iterator、流错误分别保留 unobservable/failed。 | 原生 turn 终态、thread 卸载或其它 stdio 排空。 |
| `CodexAppServerConnection.observeProcessTermination()` | 联合真实 child/stdio 和 readLoop 完成及 NDJSON 自然排空。只读，不启动或停止进程。 | shutdown 的主动 reader.close、exit 标记都不能充当排空；共享 pool 仍存活时不会结算。 |
| `releaseOwnedThreadWithEvidence(listenerId, threadId)` | 限于唯一自有且无活动 operation/pending request 的 thread，持有现有 thread lease，复用 native notLoaded/closed 检查，成功后移除同一 listener。冲突/不支持/失败返回 unobservable，不停止其它 listener 的共享 pool。 | 活动共享 reader 的 streams 明确 unobservable；本端口不提供 turnTerminal，不足以生成完整 receipt。专属进程退出也须另核对真实 close/drain。 |

进程 facts 会一直等待缺失的实际 close；不设“过期即清理”的定时器。管道输入没有 finish、流被提前 destroy、原生 thread 协议不支持等情形保守不可观察，不能为获得 receipt 降低 requirements。Node fixture 验证这些端口；未把真实模型 CLI 或 Extension Host 重载标成通过。

## 新增 Codex 执行观察事实

### Round 109 / 113：Codex 共享执行观察 handle 与关联竞态修复

`CodexInteractiveRunner.createExecutionObservation(): CodexExecutionObservationHandle` 创建有界、单次使用的执行观察注册；调用方必须在真实执行请求前创建，并通过 `runStreamed(prompt, handlers, executionObservation?)` 传入。`CodexExecutionObservationHandle` 的实际签名为：

```ts
type CodexExecutionObservationHandle = {
  readonly token: Readonly<{
    runnerId: string;
    generation: number;
    abortGeneration: number;
    disposeGeneration: number;
  }>;
  readonly turnTerminal: Promise<CleanupResult>;
  cleanup(): Promise<{
    business: CleanupResult;
    turnTerminal: CleanupResult;
    executionDrain: CleanupResult;
    runner: CleanupResult;
    streams: CleanupResult;
  }>;
};
```

最小消费方式：

```ts
const observation = runner.createExecutionObservation();
try {
  await runner.runStreamed(prompt, handlers, observation);
} finally {
  const cleanup = await observation.cleanup();
  // Persist cleanup.business, turnTerminal, executionDrain, runner and streams separately.
}
```

观察注册先于 `turn/start`。不可变 token 绑定 runner listener、局部 observation generation 及创建时的 abort/dispose 代次；run 时只接受同 runner、同 token、未使用且代次未变的 handle。内部记录保存该次 operation、实际 connection 对象、thread response 和发送请求前的消息游标。pool 的 `handleNotification(message, source)` 额外提供只读 `CodexAppServerNotificationSource { connectionId, listener, sequence, ownedThread, buffered }`，来自真实派发连接和 listener；观察只接受请求之后、精确自有 thread、同 connection/listener 且非缓存重放的消息，不以可变 `this.connection` 或 `activeOperation` 证明来源。

观察 turn ID 仅由该次真实 `turn/start` 请求的原始响应闭包绑定一次；该响应即使晚于业务 settlement 或取消仍参与对账。普通主线程消息不授予或覆盖观察身份。响应前分别暂存最多 8 个 `turn/started` 候选和 8 个 terminal 候选；终态先到时不确认，等待响应精确匹配后才保存 native terminal。start 候选冲突、业务已观察的 streamed ID 与响应冲突、保留历史中重复 native ID、无效/拒绝响应或候选容量溢出均明确 `unobservable`，不改绑。保留原有业务对 streamed turn ID 与 start 响应不同的兼容行为，事实权限更严格。其它 thread、子 agent、共享 peer、旧请求响应与其它 turn terminal 不得成为本次执行事实。

业务 settlement 不清除原生观察。最终回答兜底之后，精确匹配 thread/turn 的真实 `turn/completed` 仍作为事实保存，晚到事实不会重新调用用户可见 handler。业务 settlement、interrupt 成功、Promise resolved、计时器、空 Map 和进程 exit 都不代表 turn terminal；真实 close 也不会补造缺失终态。连接在实际终态前关闭或 runner dispose 时，终态是 `unobservable`。

每个 runner 最多保留 16 项注册，达到上限拒绝新注册，不淘汰未知历史。已发送请求且终态未明时，后续工作等待；若结果为 `unobservable` 则该 runner 永久拒绝重入，不因异常、超时、删除历史或明确不可观察而放行。abort/dispose 同时唤醒 operation 与 terminal 门禁等待，移除等待监听，排队工作按既有取消合同拒绝；readiness 返回后再次核对原代次，避免取消窗口。取消只结束业务，不制造 native terminal；旧执行仍仅由其原响应与原生终态对账。cleanup 复用同一个 Promise，开始后封口并拒绝新工作。

cleanup 是逐项 async 结果。`runner` 复用 `releaseOwnedThreadWithEvidence`，继续执行 listener 唯一自有 thread、其它子线程、pending request、活动操作和 thread lease 门禁；另计数仍在执行的异步 server request handler，业务取消回复后也不能遗忘该责任。原生卸载不支持、失败或连接提前关闭均不可升级成功。`streams` 只转交既有 reader/process 观察结果；共享 reader 仍为 `unobservable`，不会因清理一个 owner 而关闭共享 pool。`executionDrain` 当前明确为 `unobservable`：协议端口没有证明未来不再产生该执行消息、相关异步 server request 与回调已完成的完整边界，现有 void 回调合同也不等待调用方返回的 Promise。这个单次回调/终态事实不替代 `CodexAppServerNdjsonReader.drained` 或 `observeProcessTermination()`。

这是共享 runner 的 additive 事实端口；后续专属执行和 launcher 不改变上述共享限制。它不修改 commandRunner、extension.ts、容量池、Owner IPC 或首次 `bindExecution`；round 106 的历史实现保守返回 null，round 234 后须结合已审查的生产组长清理观察阶段理解。它本身不证明独立 Owner、容量恢复或完整 receipt。

### Round 118 / 121：Codex 专属执行事实（区别于共享观察）

`src/interactive/codexOwnedExecution.ts` 复用同一 runner/pool Core，以一次固定执行组合真实原生会话准备、持久绑定门闩、专属源自然结束及异步消费责任。新建或精确 resume 只接受本次原始响应；通知和 loadedThreads 不授予身份，截断责任为粘性未知。专属 cleanup 等待原生终态、stdin finish、stdout/stderr end/close、NDJSON 自然 EOF/readLoop 和原 handler/回调 Promise，再分别产出 processTerminal、turnTerminal、streams、runner、executionDrain。取消、业务 settled 和主动 reader.close 不制造这些事实。

共享 observation 的 `executionDrain` 仍为 `unobservable`，共享 reader 活动时 streams 不可确认；不能以专属路径关闭共享 peer。真实 Codex 是否满足 stdin EOF 收口仍待生产验证。已验收专属 28 项及定向 40 项结果在源码未变范围复用，不是本轮重跑；详见[专属执行设计](department-codex-owned-execution.md)。

### Round 122：Codex 可信 Owner launcher（已审查的受控组合）

`src/runtime/departmentcodexexecutionlauncher.ts#createDepartmentCodexExecutionLauncher` 将原 `CodexOwnedExecution` 适配为 `TrustedExecutionLauncher`，不复制 runner、pool、RPC、NDJSON、Owner IPC 或 receipt store。

- `requirements` 在 resolver 前占位，同步获取一次可信快照，固定 identity、八字段 selection 指纹、runner args/env、runtime、prompt、handlers、Owner signal、持久确认和资源能力；最多 256 项，拒绝/未知项不淘汰，不在此阶段启动原生执行。`launch` 只消费该注册，重复调用复用首次 Promise/原 handle。可信 resolver 的配置租约及闭包资源语义仍由生产方负责。
- 新建必须 unbound + 明确 new + runner.threadId=null；resume 必须 bound 且 threadId 精确一致。原生 prepare 后，先等待可信 `confirmSession` 持久确认并返回同一个冻结 `{threadId, connectionId, token}`，再等待 Owner `bindSession` 确认，最后才允许唯一 turn/start；失败、取消或换绑不发送任务，保留原执行和消费责任。Owner signal 不绑定 EH/socket 断连，不新增公开执行/取消权限。
- handle 为 `kind=both`，processTerminal、turnTerminal、streams、runner 恒必需；Owner streams 同时要求物理 streams 与 `executionDrain` confirmed。completion 自驱动原 owned.cleanup，不等待 Owner 后调的资源 cleanup；真实源结束/消费确认后才逐项调用 runner、executionRoot、links、temp、tab 的实际释放能力。runner 还组合附加原生会话资源；未创建才 not-applicable，缺能力/非法结果保持 unobservable，抛错 failed，不以 Promise fulfilled 或超时替代证明。

round-122 独立标准 `npm run build` exit 0，同次产物新增组合 **33/33**、Owner 定向回归 **4/4**。普通 Node Owner 在启动 client 退出后继续持有原执行；受控 NDJSON 的 terminal、handler、回调和继承尾管道分别设门闩，测试资源逐项释放后才产生 receipt。主模型已核对交付源码与最终验证副本一致，本轮仅同步事实，不重跑这些执行。

上述 round-122 证据仍是模拟 NDJSON 与测试资源组合，不能证明真实 Codex EOF、生产配置 lease/authority、首次 `DepartmentRuntimeStore` 绑定或生产 session/tab 释放。round 228 另行审查了已装配 Codex 路径的生产释放链：真实 runner/session 事实映射到原 Owner，精确私有 ACK 请求关闭原 tab，原 Owner 等齐 required 事实后生成完整 receipt；但 CLI 是固定模拟 Node，安装版 EH 只核对实际 tab host/controller 与受控 ownership/settings/panel 端口，不证明真实 native CLI 或完整 UI。round 234 已把原 client 严格观察、完整集合聚合和成功后持久移除组长租约的阶段接入审查范围，详见下节；这不证明真实 Codex EOF、多轮自然 drain或所有环境均有可达的生产 client。员工可在自身成功 receipt 后归还自己的员工租约，这不代表组长/整组容量已归还。完整合同与限制见[Codex launcher 专题](department-codex-execution-launcher.md)；实现来源为 `departmentcodexexecutionlauncher.ts`、`codexOwnedExecution.ts`、`departmentexecutionowner.ts`、`departmentexecutionidentity.ts` 和 `departmentexecutionreceiptstore.ts`。

### Round 228：Codex 原资源与 receipt 生成（已审查的生产接线）

原 launcher 把 `CodexOwnedExecution` 的实际 process close、自然 pipe/readLoop、thread/execution lease 与消费者排空结果映射给原 Owner；只有 process、turn、streams、executionDrain、runner 均 confirmed 后才调用附加资源释放。保留可恢复 thread 历史，不通过删除历史或主动 reader.close 制造成功。

可信 extension 在真实员工/组长目标创建时登记原 tab 对象、本地 session 快照和 workspace，通过不可序列化能力绑定完整执行身份/代次，并在实际交互前后登记/结算消费者。固定 worker 经继承私有通道请求 `release-tab`，校验随机 token、完整 identity、bound resourceIdentity、阶段、单次请求和连续序号；严格 ACK 不接受 not-applicable 冒充 required。宿主等待原消费者，核对当前代次、持久 binding、原对象/session、workspace 和非活动状态，再由实际 sessionTabs close/refresh 端口关闭并回读。缺能力、拒绝、断连或错误 ACK 保持未知/失败；公开 Owner socket 没有新增释放写权限。

`resources-released` 只是观察节拍，原 Owner 独自验证全部 required 项并持久化 receipt。资源事实、原 receipt 生成、可信 receipt 观察、完整集合聚合和容量消费是不同阶段；测试直接读 ReceiptStore 不能代替生产聚合。详细事实来源见[Codex 员工 bootstrap](department-codex-production-bootstrap.md)、[组长原生 Owner](department-leader-native-owner.md)和[round-228 资源释放报告](/Users/fangjiawei/.sinitek_cli/loop-communications/msg_1794556451463_c5dcb99f4e8d1/subtasks/round-228-department-codex-production-resource-release.md)。其资源30项、adapter12项、隔离标准 build、安装版 EH tab 端口及 ontology 结果按原范围独立复用，未重跑或合计为一次全量运行。

## 组长代次执行集合与全部 Owner 凭证聚合（已验收基础库）

`DepartmentLeaderExecutionLedger` 和 `DepartmentLeaderExecutionCleanup` 已实现集合与只读聚合边界。`leaderExecutionSets` 与既有 append-only `executionBindings` 同存于组织运行文件，精确绑定 `rootTaskId/workspace/leaderTaskId/moduleId/generation`，不写父任务调度状态。可信宿主必须从首次原生准备前登记组长协调执行自身及该代全部员工 subtask/attempt 责任，包括此前轮次；不能从当前 bindings 或最后一轮执行列表补推全集。

每项责任固定 registrationId、角色/attempt、原 selection 与 requirements；责任先持久化，才进入原生准备。未绑定、准备失败、unsupported 或责任不明均保留 `executionId:null`。沿用 Owner identity v1 和同代槽位：同 subtask 同代的后续 attempt 若无法表示，仍登记责任但绑定拒绝并保持 null/unknown；不得改 subtask/generation 伪造可表达身份。`bindLeaderExecution` 一次原子提交原完整 binding 与责任引用，成功后才允许启动；重复登记/绑定在开放且身份策略相同时幂等，冲突拒绝，幂等登记不授予重复启动权。

`DepartmentLeaderExecutionProducer` 是宿主注入的真实生命周期能力，库没有默认生产实现。`beginTracking` 必须覆盖该代全部最早准备入口，不能收养旧的未跟踪执行或仅凭持久开放记录恢复能力；`withAdmission` 覆盖登记、准备、绑定及最终 launch grant。`closeAdmissionsAndDrain` 须真实关闭全部新准入和迟到启动授权，排空全部在途准入责任，再返回同 scope/producerId/admissionFence 的 closure。completed、idle、空 Map、超时或普通 Promise 结算均不能证明完整。低层 store 是可信 EH 内部端口，不是 UI/模型权限入口，不能绕过 producer 直接封闭。

producer 栅栏/drain 后才持久封闭，持久失败不产生成功事实；封闭不可逆，相同 closure 可重试，封闭后拒绝迟到登记和绑定，包括迟到重复请求。旧 controller 省略新字段会保留集合；通用 `write` 不能创建、删除、重开、改写成员/身份/策略或伪造封闭。已跟踪代次不能经旧 `bindExecution` 追加未登记身份，既有重复 binding 仍幂等。旧记录缺集合、已有未跟踪绑定、不完整或损坏文件均不自动补成空全集，不删除历史、不接管写者。

聚合初读只接受当前代、已持久封闭、恰含一个组长责任且每项都有精确 binding 的完整集合，否则 null/拒绝。逐项验证可信 selection，串行调用原 `DepartmentExecutionOwnerClient.waitForCleanup(identity, originalRequirements, signal)`，沿用 250ms 起、上限 5s 的 live 退避；不设“到期即成功”。全部原 Owner 凭证成功后 cold reread 同代集合、完整身份、原策略及 closure fingerprint（含成员顺序），任一变化均拒绝。缺失、错误、unknown/conflict、身份/策略不符或取消均不成功；不启动替代 Owner、不直接读磁盘 cleaned、不停止执行、不释放资源或容量。取消只结束观察，Owner 下线后磁盘 receipt 也不能补成功。

存储沿用单 EH 同步写者和 cold-read→验证/索引→临时文件 fsync→rename 的原子提交。一次操作复用一次验证所得成员、binding、slot、scope、责任和目标索引；通用 controller write 对当前/候选各验证一次。验证和 fingerprint 线性遍历，不增加两两 binding 比较或 Owner 目录扫描；不声称跨进程 CAS 或目录项掉电持久性。

直接复用已验收报告的隔离标准 `npm run build` 与 **106 个不同用例**覆盖，主模型已确认六份 TypeScript 交付与最终隔离构建源码一致；本轮不重跑。完整集合成功、单员工仍 live 阻塞和取消场景使用真实临时 RuntimeStore 与独立普通 Node Owner，取消后原执行继续、之后可重试成功且容量不变。producer 是受控测试能力，等待后重读的 mock 只证明防护边界，不是生产生命周期或真实 CLI 证明。实现来源为 `src/extensionHost/departmentleaderexecutionledger.ts`、`src/extensionHost/departmentleaderexecutioncleanup.ts`、`src/extensionHost/departmentruntimestore.ts`；调用示例、测试入口和生产缺口见[执行集合专题](department-leader-execution-cleanup.md)。

## 生产装配阶段与剩余门禁

### Round 106：持久绑定与恢复消费

`fingerprintDepartmentExecutionSelection` 只接受 version、CLI、leader/employee role、configId、revision、model、thinkingMode、openCodeVariant 八项显式元数据；拒绝额外字段，不接收 ConfigItem 或 profileDigest。revision 来自现有选择版本，调用方仍须持有角色配置执行租约；指纹不是配置或认证正文散列，也不证明获得租约。

`DepartmentRuntimeStore.bindExecution` 将 bound identity、可信 requirements 和 selection 原子保存到组织文件的 append-only `executionBindings`，核对当前组长/module/generation 及对应容量。组织唯一目标明确区分 Owner fencing：组长目标按其 execution slot + generation；员工目标按同一 execution slot + generation + 精确 attemptId。因此同一员工 subtask 的不同 attempt 可分别保留完整 binding；同精确 attempt 的 execution/owner/session/selection/requirements 替换、unbound session 或无当前租约均拒绝。它不改变 `runtime/departmentexecutionidentity.ts#executionSlot`、Owner identity v1、receipt store slot index 或 Owner 同代启动拒绝规则；存储第二个 attempt 不授予该 Owner slot 第二次启动。旧控制器保存时省略该字段会保留全部绑定，显式删除/替换拒绝；损坏文件不能用 write 覆盖为空。先 fsync 文件数据再 rename，仍依赖已有单 EH 写者，未新增跨进程 CAS 或目录项掉电持久性协议。历史绑定不自动删除；组织读写按该组织绑定数线性验证，不扫描 Owner receipt 目录，不改变 receipt store 常态按 slot 定位的成本。**round 106 当时未调用首次 bindExecution；round 117 已在受限 OpenCode 员工启动链路补齐 session 持久确认→bindExecution 持久确认→commit/start。其余执行种类仍未接通。**

Extension Host 已安装 `DepartmentExecutionRecovery.observeAttempt`：核对持久 root/workspace/leader/module/generation/subtask/attempt、原生 session、角色选择及现有 ready/configId/revision，再对应用数据根下该 ownerId 的本机端点只读 observe。内外 identity 与完整 requirements 由 Owner client 精确校验。缺绑定旧记录返回 null；冲突、损坏、断连或 owner 不可达不释放容量，即使磁盘有 cleaned receipt 也不能解锁。此端口没有 start/handoff/PID 探测或容量修改权；固定跨进程 fixture 不证明真实生产已经产生绑定。

round 224 已接入真实 producer：只接受任务仓储本次 CREATE 的内存来源记录；确认组长容量和成员快照持久化后、真实 scheduler 首次 pump 前打开 Ledger。一个 producer 同时提供员工准入和组长代次跟踪；Codex/OpenCode 员工准备在原生准备前登记责任，Codex 组长复用实际 Loop+ scheduler 与多轮原生 Owner。producer 关闭新准入和迟到 grant 后 seal 原 Owner、排空原始在途准备/消费者责任，最后才尝试持久封闭执行集合。它不能从已有记录、冷恢复或 completed/idle 状态收养代次。

组长本地 `sessionId` 继续标识任务/tab 关联，原生 Codex `executionSession` 单独持久化并精确回读；二者不可互换。producer 的 `isCurrent` 用于关闭期间继续核对原身份，`canLaunch` 在封闭时同步拒绝迟到授权且不可复活。`closeAdmissionsAndDrain` 失败、等待未结算或集合持久失败时不产生可用 closure。

round 234 将受审查的生产观察扩展到同宿主新建且完整覆盖的 Codex 组长/员工：观察初读仅接受当前代完整持久封闭集合，要求组长责任及所有成员精确 binding；严格验证 selection 后串行复用原 client 的 `waitForCleanup`、原 requirements 和退避。结束时冷读集合、generation、身份、策略及 closure fingerprint。任何缺失、错误、unknown/conflict、取消或变化都不成功，不启动替代 Owner，不直接读磁盘 cleaned，也不释放资源或容量。生产使用阶段快照减少重复全量读取，共享底层清理责任和可移除的有界订阅支持取消；取消仅结束本次观察，不取消 producer 正持有的执行。成功聚合仍须持久移除组长租约后才调用实际 release；持久化失败或观察失败保留租约。此证据不扩展到冷恢复、其他 CLI 或未经覆盖的所有权。原 Owner socket 收尾后后续 client 可能不可达，仍是生产可信凭证观察的具体缺口；员工成功 receipt 后归还员工租约不代表组长/整组容量已消费。封闭集合本身不等于 cleaned。正常收口、启动失败、继续失败和停止不能用 idle 替代证明；组织快照保存失败同样保留租约。恢复 inspect 不以 EH Map 证明跨重启 live。未安装可选门禁的旧测试宿主保留原行为；普通 Loop/Loop+ 不受部门门禁影响。

共享 Codex runner 的 exit/shutdown 仍须等待实际 process close，不能将空 `loadedThreads` Map 当原生 notLoaded/thread/closed；关闭前保留监听者。round 228 专属执行路径已将其真实 runner/session 释放事实与独立 tab 能力交给原 Owner；该路径不改变共享池卸载保留其它 listener/thread 的语义，也不把共享 shutdown 主动关闭 reader 当作自然 drain。process close 单独仍不补足 turnTerminal、stream、executionDrain 或未装配执行路径的资源事实。

Codex 的 runStreamed 结算还包括最终回答兜底；原有 dispose、共享池 release/shutdown 仍返回 void，shutdown 会主动关闭 reader，不能用它们证明真实 turn terminal、排空及线程释放。round 117 的 OpenCode 员工路径只接受已有原生 session；round 224 的 Codex 组长原生 session 已有生产多轮启动/绑定接线，round 228 又审查了该 Codex 路径的真实 runner/session/tab 释放和原 Owner 完整凭证生成。round 234 审查同宿主新建、完整覆盖的 Codex 组长/员工集合的可信凭证观察、冷读聚合及持久移除后组长租约 release；这不证明真实 Codex binary EOF/多轮 drain、socket 收尾后的后续 client 可达、OpenCode 首次原生 session/释放或其他角色/CLI 所有权。共享观察仍不能证明完整执行排空，不可将 onExit 或测试直接读取 receipt 转成整组清理证明。

生产接线需要先补齐以下可验证合同，不能只在 extension.ts 注册一个内存 Promise：

1. 扩展现有生产可信入口至 OpenCode 首次原生会话和其他角色/CLI；公开 socket/pipe 继续只收严格 identity，业务意图和角色配置只由可信代码处理。
2. 扩展现有已审查的 Codex 释放证明边界：验证真实 Codex binary EOF/多轮 drain，并补齐 OpenCode 首次原生会话/释放及其他角色/CLI 所有权。仍要求 session/tab、root/link/temp、runner/thread 的每项事实绑定同一执行和代次；不能把进程 exit、取消请求成功、read-loop 提前关闭或任务 completed 当作清理完成。
3. 将 round-234 已审查的可信观察/容量消费边界扩展到尚未覆盖的 Owner/CLI 和恢复路径，并解决 socket 收尾后 client 可能不可达的问题。只有原 Owner 全部凭证完整成功、组织持久状态通过后才能释放组长/整组容量。不能用封闭集合、fixture producer、idle 或普通 Promise 替代；员工租约的独立消费也不能替代组长容量凭证消费。
4. 保持全树 stop/continue、冷恢复、跨平台及最终真实 EH/UI/CLI 组合为根验收门禁；分别验证根/组长/员工真实生命周期和迟到回调隔离。

round 220/222/224 已分别验收员工准入、组长多轮原生 Owner、真实生产 producer 与 Loop+ 装配；round 225 仅验收 fixture 启动诊断；round 228 已验收限定 Codex runner/session/tab 释放和原 Owner receipt 生成；round 234 已验收限定新建完整 Codex 集合的生产观察/组长 lease 消费及重复超额明确拒绝。仍缺真实 Codex binary EOF/多轮 drain、socket 收尾后的可信 client 可达、OpenCode 首次原生会话/释放、其他角色/CLI 所有权、全树 stop/continue、冷恢复及最终组合。round 234 的观察新增8项与直接旧36项分别有效，准入新增5项、旧兼容9项及宿主/adapter9项分别通过，不能合并声称一次44项运行。round 224 的生产集成/交互/adapter检查与标准隔离构建按专题报告原范围复用；216/217 回归的余额失败与较宽 adapter stop/resume 挂起仍保留，不代表整套通过。普通 Node/fixture 和单平台 EH 端口结果不能替代真实 Codex CLI、完整 UI、跨平台及容量恢复验收。

round 121 收紧上述 OpenCode 准备期启动授权：adapter AbortSignal 和待启动 stream.kill 贯穿可信 coordinator，builder/prepared/commit 后重读有意义的权威字段、session 和精确持久 binding；不把自身 updatedAt 变化当撤权。identity-only start 在途仍须由 worker 请求一次私有 launch grant，宿主同步最终复核与 grant 发出为启动/取消线性化点。此前 caller 取消或撤权均禁止任务 run，迟到 ACK 不复活；此后执行仍独立于 EH，不承诺取消或完整清理。绑定/未知容量责任保留，不新增公开 IPC 权限或 receipt 事实；详见进程启动设计。

## 后续接线门禁

1. 扩展现有生产 owner launcher 到 OpenCode 首次原生会话和其他角色/CLI；保持公开 IPC identity-only、配置来源可信，原 Owner 独立于 Extension Host client connection 持有执行。
2. 在已审查 Codex runner/session/tab 释放边界上验证真实 Codex EOF/多轮 drain；补齐 OpenCode 首次原生会话释放和其他角色/CLI 所有权。每项 cleanup fact 仍须可 await、失败不吞掉并绑定同一 execution/generation，缺失能力保持 unobservable，不可弱化原 requirements。
3. 将已审查的生产观察/组长 lease 消费扩展到尚未覆盖的角色、CLI 和恢复路径；解决 socket 收尾后 client 可能不可达的可信观察问题。任一凭证缺失、unknown、冲突、取消或集合变化都保留 blocked/lease；员工租约消费不能替代组长/整组容量消费。
4. 核验生产冷恢复、全树 stop/continue、迟到回调 fencing 和跨平台真实生命周期；测试 fixture、普通 Node 组合及封闭集合本身不能替代真实 EH/CLI 证据。
