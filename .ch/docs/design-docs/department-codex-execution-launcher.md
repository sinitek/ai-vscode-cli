# Codex 可信 Owner launcher

`src/runtime/departmentcodexexecutionlauncher.ts` 将现有 `CodexOwnedExecution` 适配为 `TrustedExecutionLauncher`。它供独立普通 Node Owner 注入，不是生产 bootstrap，也不向公开 IPC 增加命令、prompt、环境、路径、stop 或任意执行能力。唯一 runner、pool、RPC、NDJSON 和 receipt store 均复用现有实现。

## 可信准备和身份

```ts
createDepartmentCodexExecutionLauncher(
  resolvePrepared: (identity: DepartmentExecutionIdentity) => PreparedDepartmentCodexExecution | null
): TrustedExecutionLauncher;

// TrustedExecutionLauncher，未改变原合同
requirements(identity: DepartmentExecutionIdentity): CleanupRequirements;
launch(identity: DepartmentExecutionIdentity,
  bindSession: (sessionId: string) => Promise<void>): Promise<TrustedExecutionHandle>;
```

`requirements` 同步调用可信 resolver 一次，快照 runner args/env（默认环境也在此刻快照）、固定 shell/日志端口、prompt、handlers、Owner signal、持久确认函数和资源释放能力；此阶段不构造原生执行对象、不探测 CLI、不生成原生进程、不发送任务。resolver 本身必须遵守该无原生启动合同。它不是公共 socket 的参数解析器；调用者仍负责真实配置执行 lease 和可信配置来源。

identity 必须通过现有精确字段校验，cli 必须为 codex。准备返回的 identity 必须完全相同；selection 使用现有八字段 allowlist 和指纹函数，要求非 null configId、相同 role/cli 和两个指纹；selection 与描述中的额外认证正文等未声明字段会被拒绝。执行描述也使用精确字段集。只有明确 `session: {intent: "new"}` 配合 unbound identity 和 runner.threadId=null，或 `{intent: "resume", threadId}` 配合相同 bound identity/runner.threadId 才能通过。

按 executionId 保留最多 256 个注册（包括拒绝项），在 resolver 前先占位。不得淘汰未知、失败或已完成项来重建同一执行。冲突身份、重入 resolver、饱和都保守拒绝；`launch` 不调用 resolver，也不在缺少 requirements 注册时补做准备。一次 launch Promise 缓存首次回调和原对象；并发或重复调用返回同一 Promise/handle，不重试。调用者必须复用同一 launcher 和 Owner，不能新建对象绕过未知执行。

快照复制数据和函数引用，但无法冻结可信能力内部的闭包、资源或 receiver。持久确认和 release 必须保持相同执行语义，不得在调用时转向另一配置、thread 或资源；不应依赖被外部改写的描述字段。代码不修改全局配置或默认共享池。

## 原生绑定门闩

```ts
const launcher = createDepartmentCodexExecutionLauncher(identity => ({
  identity, selection: trustedSelection,
  session: identity.session.state === "bound"
    ? { intent: "resume", threadId: identity.session.id } : { intent: "new" },
  runner: fixedRunnerOptions, runtime: fixedRuntimePorts,
  prompt: trustedTask, handlers: boundedTrackedHandlers,
  signal: ownerLifetime.signal,
  confirmSession: async session => {
    await persistExactBinding(identity, session.threadId, session.connectionId, session.token);
    return session; // 必须是收到的同一个冻结对象
  },
  resources: trustedResourceResponsibilities,
}));
const owner = new DepartmentExecutionOwnerServer({ directory, ownerId, launcher });
await owner.listen(); // 普通 Node；生产 bootstrap 的 authority 另行接线
```

launch 启动原 `CodexOwnedExecution.execute()`，其 prepare 在真实连接完成 initialize/thread/start 或精确 thread/resume；不使用中性任务、通知、tab、缓存或失败后换 thread。adapter 重新核对 thread identifier 和 bound 目标。它先等待可信 `confirmSession` 对精确 `{threadId, connectionId, token}` 的持久确认，要求返回收到的同一个冻结 session；再等待原 Owner `bindSession(threadId)` 写入确认，最后返回同一个 session 供原端口发唯一 turn/start。原 Owner 负责一次 unbound→bound 与不可换绑规则，没有复制写 store 或 IPC 的逻辑。

Owner signal 在准备、持久确认和 Owner 写入后都检查；取消不代表清理。绑定原 Promise 即使输给取消也保留排空责任。持久拒绝、返回其它 session、Owner 写入拒绝、raw resume 冲突及准备取消均为零任务。execute 拒绝时仍保留 handle 和原 owned 对象，通过其 cleanup 消费已创建责任；不会将有资源的失败转成一个可重新 launch 的拒绝项。

signal 是可信 Owner 生命周期，不能来自 EH/socket 存活状态。启动客户端退出/断连不触发此 signal；合法执行由 Owner 进程持有，后续客户端只用原 identity 观察或重复请求同一执行。不新增公开取消 IPC。Owner 自身丢失仍由原 receipt 合同保持 unknown，不自动启动替代执行。

## receipt 分项映射与释放

handle.kind 固定为 `both`，requirements 中 processTerminal、turnTerminal、streams、runner 恒为 true。business settlement、interrupt、Promise、process exit/close 不能替代精确 native terminal。

| Owner 分项 | 必需事实 |
| --- | --- |
| processTerminal | 原 owned.cleanup 的真实 processTerminal |
| turnTerminal | 原精确 token/connection/listener/thread/turn 的 turnTerminal |
| streams | 物理 streams **及** executionDrain 都 confirmed；任一 failed/unobservable/非法结果阻止确认 |
| runner | 原专属 runner 释放 **及** 可信附加原生会话资源 release 都 confirmed |
| executionRoot、links、temp、tab | 可信准备声明实际 owned；逐项调用原能力，未创建才 not-applicable |

runner 声明必须 owned=true，缺少 release 能力保留 unobservable，不能用 owned=false 隐去 native session 责任。其它资源声明必须明确；owned 项返回 not-applicable、非法结果或缺能力保持 unobservable，抛错保持 failed。返回值使用现有 CleanupResult 严格字段和标记字符合同。没有资源可以根据一次 Promise fulfilled 被推断已释放。

`completion` 自己驱动原 owned.cleanup（封口、自然 EOF、readLoop、真实 close 和消费责任），独立于随后 Owner 调用的资源 `cleanup()`；它不等待资源回调。`cleanup()` 复用首次 Promise，在 processTerminal、streams 和 executionDrain 全 confirmed 后才按 runner/root/links/temp/tab 调用实际 release；不足时不调用 destructive release，保留逐项 unknown。释放能力不得等待本执行 receipt 或容量归还。可能永久 pending 的能力不通过超时视为成功，也不隐式重试。

原共享观察 drain 仍 unobservable；专属执行不关闭其它共享 peer。八候选/十六观察上限、raw start 独立对账、一次 turn 绑定、截断粘性、取消唤醒、原 async handler 和回调责任均继续由已验收端口实现，本轮不改 Core。

## 本轮证据与边界

`src/test/runtime/departmentcodexexecutionlauncher.test.ts` 及 `fixtures/departmentcodexownerworker.ts` 使用普通 Node、隔离 HOME/USERPROFILE/CODEX_HOME、真实受控 NDJSON child、文件/消息门闩。fixture 无 vscode mock；不调用真实 Codex、模型或用户会话。公开 Owner fixture 只接收 identity；可信输入文件、取消 IPC 与资源标记仅为测试私有能力，不能搬成生产配置解析或公共 IPC。

跨进程测试让启动 client 退出，再由新 client 观察同一 Owner；分别阻塞 terminal、原 server handler、Promise 回调、继承 stdout/stderr 的子进程尾管道。receipt 必须等待全部事实，重复 start 不发第二次任务。另覆盖绑定拒绝、raw resume 冲突、取消、晚响应/最终回答兜底、256 项不淘汰、消息截断、缺 terminal、资源缺能力/非法返回/失败与回调失败。正常 fixture 显式释放门闩、等待 receipt/失败状态后关闭 Owner 并等待进程退出。

实际数量、命令、源码快照和有效证据范围以 round-122 attempt report 为准。原 round-121 的专属 28/28 和定向 40/40 源码未变，继续复用；没有为刷新时间戳重跑。新增 launcher 不证明真实 Codex EOF 能力；绑定/handler/回调/管道永不结束可使 completion 一直 pending。未观察调用方另起的后台任务或外部未知子孙资源。

尚需生产方提供可信 resolver、配置 lease、真实 DepartmentRuntimeStore 持久绑定确认、Owner 生命周期及所有实际资源 release，并完成 bootstrap authority 与 receipt 消费。fixture 的 runner release、tab 标记和资源文件只是测试能力；不证明真实原生会话附加资源或 VS Code tab 清理。未修改生产 process bootstrap/worker、extension、Adapter/Composition、Owner 主设计、本体或功能清单；生产 observeLeaderCleanup 继续 null。本端口及测试 receipt 不等于生产首次绑定、组织整组 receipt、容量恢复或全树 stop/continue。

来源同步供并行 authority 拥有者参考：本设计、新 launcher、原 `codexOwnedExecution.ts`、`departmentexecutionowner.ts`、`departmentexecutionidentity.ts` 与 `departmentexecutionreceiptstore.ts`；原两份 Codex 专题设计保持不变。
