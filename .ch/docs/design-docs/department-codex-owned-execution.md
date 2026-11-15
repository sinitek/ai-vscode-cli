# Codex 专属执行的进程内生命周期端口

`src/interactive/codexOwnedExecution.ts` 为可信普通 Node 调用者提供一次任务的原生会话预备、持久绑定门闩和消费排空组合。它委托同一个 `CodexInteractiveRunner` 和同一 pool；不包含生产 Owner bootstrap、DepartmentRuntimeStore 写入、公开 IPC、容量或完整 receipt。原 EH facade、共享 runner 和原 observation.cleanup 的合同保持不变。

## 入口与固定身份

```ts
new CodexOwnedExecution(options: CodexOwnedExecutionOptions);
prepare(): Promise<CodexOwnedSession>;
execute(): Promise<void>;
cancel(): void;
cleanup(): Promise<CodexOwnedExecutionResult>;
readonly observation: Pick<CodexExecutionObservationHandle, "token" | "turnTerminal">;
```

构造参数固定 runner options、显式 CodexRuntimePorts、prompt、handlers、调用方 AbortSignal 和 `bindSession(session): Promise<CodexOwnedSession>`。构造时复制 args/env 和回调函数，沿用冻结的 shell/日志端口。原 observation 在准备或发送任何真实请求前建立，携带冻结的 runner/执行/abort/dispose token。没有 updateOptions、追加任务或 retry 接口；同一对象重复 prepare、execute、cleanup 分别复用各自的同一 Promise，失败和未知事实也不会生成替代 runner。

prepare 复用原 initialize 与 thread/start；已有可信 threadId 则复用原 thread lease/handoff 和 thread/resume。只接受真实响应的非空 thread.id，resume 响应必须等于请求 ID。通知、本地名称和 tab 标签不能满足这个条件。此阶段不发送 turn/start、任务 prompt 或中性任务。返回冻结的 `{threadId, connectionId, token}`。

execute 等待 prepare 后调用一次 bindSession。可信调用方必须先完成该精确身份的持久写入，再返回收到的同一个冻结 session 对象。拒绝、不同对象/身份、已取消或已失去调用方生命期均阻止发送任务。此检查只证明调用方履行了进程内门闩合同，不证明真实生产持久化已经接线。bindSession 原 Promise 即使输给取消竞态也保留消费责任。

```ts
const execution = new CodexOwnedExecution({
  runner: trustedFixedRunnerOptions,
  runtime: fixedRuntimePorts,
  prompt: trustedTask,
  handlers: trackedHandlers,
  signal: callerLifetime.signal,
  bindSession: async (session) => {
    await persistTrustedBinding(session.threadId, session.connectionId, session.token);
    return session;
  },
});
const session = await execution.prepare(); // 尚无 turn/start
try {
  await execution.execute(); // 同一执行，非第二次启动
} finally {
  const facts = await execution.cleanup();
  // 分别读取六项事实；任一未知项都不能升级为完整 receipt。
}
// 需要停止等待时使用 execution.cancel() 或 callerLifetime.abort()。
```

## 排空与释放

专属模式强制使用已有 exclusiveOwnerId 和唯一 listener；即使版本探测允许共享，也不会加入默认共享连接。能力探测、启动解析、环境、cwd/PWD、配置与 lease 规则仍来自原核心。prepare 完成后执行复用同一连接和配置，不重建进程或重新选择运行端口。其它连接不能通过旧 handoff 机制强制关闭仍存活的专属执行；必须等待它自身完成收尾。

cleanup 封住新入口，等待既有业务执行；正常完成还等待精确的原生终态，最终回答 fallback 不触发传输收口。显式取消会唤醒等待并请求原有 interrupt，随后允许通过 stdin EOF 请求结束专属生产源；仍独立保存晚到原响应和原生 terminal。缺失 terminal 在来源实际结束后保持 unobservable。

专属 pool 路径不调用旧 shutdown 来开始收尾：封口后拒绝新 retain、withThread 和主动 request/notify（初始化响应必要的 initialized 除外），等待已经登记的 server handler 与回复责任，再 end stdin。既有读循环、精确来源和 listener 保留，直到 NDJSON 自然 EOF/队列消费和实际 child close 完成。close 先到时先 join readLoop，才做最终 listener 清理，避免丢失排队尾部响应/终态。无 thread 的进程尾部通知也交给专属 listener；未知 thread 的 buffer 不会当作已消费责任成功。

结果分别为：

| 字段 | 可确认条件 |
| --- | --- |
| business | 原 runStreamed 业务 Promise 已结算；不表示成功或 native terminal |
| turnTerminal | 原 observation 的精确来源、请求边界与原响应 turn ID 对账成功；8 项候选和 16 项注册上限未放宽 |
| processTerminal | 原 processLifecycle 实际 child close |
| streams | 原自有 stdin finish、stdout/stderr end 与 close，加原 NDJSON 自然 EOF 和队列消费；不改变已有 observeProcessTermination 语义 |
| runner | 独占归属/lease 门禁通过，实际进程结束，listener 最终卸载且请求责任完整 |
| executionDrain | 上述专属生产源已结束、readLoop 已结束、没有未完成/无法归属的消息或请求，加包装登记的所有回调已完成且无拒绝 |

共享 observation.executionDrain 仍固定 unobservable，共享 reader 活动时 streams 仍不可观察。专属端口不能关闭共享 peer。process exit、业务 settled、interrupt 成功、空 Map、主动 reader.close、计时器或请求退出本身不提供 drain/terminal 证明。

专属 handlers 是原回调参数/返回类型的扩展，接受同步返回或 Promise；onRequest 继续返回原 JsonRpcResolution。额外 onNotification 接收原 listener 的真实 connection/listener/sequence/ownedThread/buffered 来源，包括业务结束后的尾部通知，但不重新触发已结束业务的可见输出。包装捕获同步异常及 Promise 拒绝，cleanup 等待原 Promise；错误使 executionDrain failed。取消回复不会取消或忘记原 server handler。调用方必须把其异步消费责任纳入实际返回的 Promise；脱离返回值另起的后台任务不在该端口的可观察范围。每个对象仅保留活跃责任；64 项回调责任或 pool 64 项 handler task 达上限时拒绝新增责任并粘性记录失败/不可观察，绝不淘汰旧责任后成功。

stdin EOF 后若又有必须发送的回复，写失败保留不可观察；未回答的原生 RPC、无法路由的 buffer、流错误、提前 destroy、旧主动 shutdown 等也不能成功。NDJSON 现在消费 premature close 为明确流失败，避免在没有 end 时永久等待，不将 close 当作自然 EOF。

## 验证与尚缺组合

round-118 的无 vscode mock 普通 Node 测试使用隔离 HOME、真实可执行 NDJSON 子进程与文件/通知门闩，覆盖准备、绑定前零任务、绑定拒绝/不匹配、幂等、终态早于响应、fallback、取消、异步回调/handler、真实尾部与 exit-before-close、流错误及提前销毁、默认共享存活。exit-before-close 用本任务创建的子孙 Node 持有继承管道，释放文件门闩后才产生尾部与 EOF；不能将这项模拟协议能力等同真实 Codex 协议承诺。实际命令和数量以 round-118 attempt report 为准。

round-320 后，真实本机 Codex CLI/app-server 的 stdin EOF 与自然关闭已有版本限定证据：macOS arm64、Node v24.22.2、codex-cli 0.167.2，临时 CODEX_HOME 和本机模拟 Responses provider。两个独立 owned 对象分别取得真实 turn/completed、stdin finish/close、stdout/stderr自然end/close、child exit/close、NDJSON队列与executionDrain确认；第二对象通过精确thread/resume继续同一原生thread。详细命令和独立证据见 `.ch/docs/runbooks/department-codex-native-drain-verification.md` 与 round-320 attempt报告。该证据不外推到其它版本/平台、真实provider/模型或生产目录。生产源、绑定Promise、回调或handler永不完成仍可让cleanup保持pending；超时和强制进程回收从不算成功。进程事实不证明未知外部子孙、文件锁、生产持久写入或容量恢复。

只验证本机 macOS，未做 Windows/Linux 实机、真实模型、用户会话或 Extension Host smoke。生产 observeLeaderCleanup 继续 null。后续集成方还需可信 launcher、生产首次持久绑定、Owner IPC、资源组合和 receipt 消费；本轮不修改这些并行 authority 文件。可由其拥有者在 ontology source_refs 增补本设计与 codexOwnedExecution/Core 端口；不将内部端口称作用户功能或生产 Owner 已完成。


## 准备凭据与丢失责任修复（round-121）

专属准备在构造时固定最初可信 resume 目标（或明确新建），在同一个 connection 上必须完成本次真实 thread/start 或 thread/resume 请求。即使 initialize/readiness 前后收到 thread/started，pool 已 claim 并填充 loadedThreads，也不能替代原请求响应、跳过请求或将新建改成 resume。通知继续路由、派发与登记消费责任，但不修改专属主 thread 身份。只在原响应具有非空 thread.id、resume 与固定目标相符、operation 仍活动且 abort/dispose 代次有效时，保存不可变的 connection/thread/generation 凭据；execute 只复用此凭据及连接，不再凭 cache 做准备。缺失/冲突响应或取消不能发送 turn/start，晚到响应不能复活已取消准备。

未归属 thread 的通知仍沿用最多 40 项的路由 buffer。专属模式首次截断即粘性记录 owned-unrouted-messages-truncated；随后 claim、buffer 清空、回调成功、自然 EOF 和真实 close 都不能消除该事实或确认 executionDrain。streams 的自然结束与消费责任丢失是独立事实。共享模式原有路由与有界截断行为不变。

pool 的 handlerTasks 强引用集合仅用于专属生命周期。共享连接仍通过原 handlingOwners 阻止原 handler 未结束时释放，保留取消回复、晚拒绝消费及后续请求处理，但不会额外强引用每个已取消、永不结算的 handling/completion Promise。专属模式仍保留原 handler 与 completion 到其真正结束，取消回复不能遗忘排空责任，原 64 项准入门禁不变。

round-121 新增普通 Node/真实 NDJSON 用例覆盖 readiness 前后通知、新建与 resume 的正确 raw 响应、缺失/冲突响应、取消与晚响应、45 项未归属通知截断后 claim/自然 EOF，以及共享三批共 72 个未结束 handler 的取消和继续服务。既有专属异步回调/handler 等待用例同组回归。实际构建和用例结果以 round-121 报告为准；未重复的 round-118 结果仅在源码未受影响的范围继续有效。未改变公共接口、生产绑定、本体 authority 或 observeLeaderCleanup null 门禁。


## 真实 Codex 本机 Responses 排空验证（round-320）

`scripts/verify_codex_owned_native_drain.js` 在隔离源码build上加载 `CodexOwnedExecution`，不安装 vscode mock。它从已安装 Codex CLI 建立真实 app-server stdio child，仅将 Responses 请求送至同一测试目录附属的 loopback HTTP fixture，配置 `requires_openai_auth = false` 且不给子进程继承用户认证环境。fixture 按 Responses SSE 返回完成的本地答案，不请求真实模型。

验证顺序为不可变执行1 `thread/start`→真实 turn terminal→owned cleanup/自然 EOF；然后不可变执行2以相同 `CODEX_HOME` 和精确 thread ID 新建对象/专属连接，真实 `thread/resume`→另一个 turn→自然 EOF。验证记录实际 binary/version、两代请求/响应、持久 thread 路径、终态/handler与逐项cleanup结果、各stdio end/close以及进程exit/close。`scripts/fixtures/codex_local_responses_server.js` 只提供本地fixture。命令、版本、原始结果和限制由round-320 attempt报告指定；使用 runbook `.ch/docs/runbooks/department-codex-native-drain-verification.md` 描述前置条件、命令和失败语义。

有界等待只用于判失败，强杀只用于回收本测试实际启动的进程并使整次验证失败；它不能成为terminal或drain证据。只有六项业务/native terminal/process/streams/executionDrain/runner事实都confirmed、stderr/stdout/stdin自然关闭、child真实exit/close以及第二次精确resume和turn完成，场景才通过。此验证局限于报告所记录的真实CLI版本、本机平台和模拟Responses provider；不表示真实远端模型、组织runtime持久绑定或完整receipt已证明。
