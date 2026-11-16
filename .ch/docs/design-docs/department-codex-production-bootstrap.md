# 部门 Codex 员工生产启动与首次绑定

本专题描述员工 attempt 的生产调用与资源释放接线（开发中）。它复用唯一 `CodexOwnedExecution`、Codex launcher、Owner server/client 和 receipt store；组长执行见独立专题。已有员工消费者可在原 Owner 完整 receipt 后归还该员工租约；round-231 已接通仅完整覆盖 Codex 新代的生产整组观察及组长容量消费，详见文末及整组清理专题。

## 可信边界与调用路径

`extension.ts` 的 `prepareDepartmentInvocation` 固化员工角色路线，经配置应用队列和现有 `acquireRuntimeConfigExecution` 取得本次 configId/revision 租约。`runPromptNow` 只为部门组长任务下的 Codex 员工注入 `PromptRunExecutionOptions.departmentCodexRun`。普通 Loop、Loop+ 和普通交互继续采用原 runner；OpenCode 仍采用原 process 通道。未开放打印模式替代。

交互策略使用同一组 assistant、trace、task-list、token、subagent、request 和 session 消息回调。部门分支不在 EH 创建/登记 runner，不从 tab 或映射猜原生 thread，不在业务收尾时用 UI session 覆盖 executionSession。自动隐藏重试在这个单次执行端口上关闭；重复调用也不能建立替代 Owner。自定义思考工作区文件暂不支持，准备时明确拒绝，不修改原工作区文件。

`createDepartmentCodexPreparation(host)` 使用实际任务仓储及可信生产 producer 注入的 `Ledger.admit`，builder 前留责，首次 session 后经 `admit.bind` 原子写入完整 binding/责任引用并精确回读。adapter 已有 owns-resources/observe-termination 两个注入端口按 CLI 分流到该协调器；它的 AbortSignal 和同步 isAborted 守卫传入所有准备边界。原 adapter 无需另建一套状态机。

```ts
createDepartmentCodexPreparation(host: DepartmentCodexPreparationHost): {
  authorizeAttempt(taskId: string, subtaskId: string, attemptId: string): void;
  observe(taskId: string, attemptId: string, subtaskId?: string): { done: Promise<void> };
  rejectUnstarted(taskId: string, subtaskId: string): void;
  run(taskId: string, subtaskId: string, handlers: CodexOwnedStreamHandlers,
      expected: { configId: string | null; revision: string },
      prepare: (selection: DepartmentExecutionSelection, threadId: string | null)
        => Promise<DepartmentCodexLaunchDescription>,
      lifetime?: DepartmentProcessInvocationLifetime): Promise<void>;
};
```

准备描述只来自 EH 可信闭包，固定 command/args/env、模型、思考、shell、prompt、工作区和配置协调目录。私有 wire 不接受 worker/module/认证正文扩展字段，八字段 selection、config/profile 指纹、CLI、employee 角色、模型/思考和 thread 目标必须一致。影响启动/能力探测的 shell 固定为同一个选择。公开 Owner socket 仍然只接受严格 identity。

## 准备、持久化与启动顺序

1. 同步读取 root/leader running、工作区、模块、完整部门路线、generation、唯一 running subtask/attempt 和两种容量占用。确认 adapter 为此 attempt 给出的进程内准入。
2. await 可信描述准备后重新核对权限。每个缓存最多256项，不淘汰失败/未知执行。新 host 遇到已有 execution binding 只能 observe，不能 replay。
3. 在 Owner 目录下以执行槽位哈希创建 `codex-preparations/*.json`，排他创建、写入并 fsync。只记录 identity/selection，不记录 prompt、命令、环境或认证内容。它是保留的一次性启动资格消耗记录，不是 receipt 或调度快照。部分写入/失败不删除，防止 EH 在原生创建后、持久绑定前退出导致新 host 换 Owner/thread 重发。
4. `startDepartmentCodexOwner` fork 固定仓库 worker。沿用 Electron 的 `ELECTRON_RUN_AS_NODE=1`、空 execArgv、detached 和现有跨平台 Owner endpoint。worker 自行取得真实 `SharedRuntimeConfig` 租约，核对 ready/configId/revision，并创建实际 execution root/links。
5. worker 将原 launcher 注入原 Owner。`requirements` 本身不启动原生执行；public start 创建原单次对象。它只 initialize，并由本次真实 thread/start 或精确 thread/resume 原响应取得冻结 session（threadId/connectionId/token）。无任务 prompt 或 turn/start。
6. worker 的 confirmSession 私有请求送达 EH。EH 保存并回读精确 `subtask.executionSession`，重读权限，再通过同次 admission 的 bind 回调原子提交并回读完整 identity/selection/requirements 与责任引用。新建为 unbound→精确 bound；resume 必须与原目标相同。失败不换 thread。
7. EH 返回 persisted 后，worker 继续等待原 Owner.bindSession 的确认，然后发出 owner-bound 私有消息。EH 最后一次同步核对权限、精确任务 session 和 binding；不经过 await，直接发出一次 grant。
8. worker 消费 grant 后才释放原冻结 session 给原 owned.execute，发送唯一 turn/start。grant 投递/ACK 不明只保留 unknown，不重新发起任务。

权限签名排除 updatedAt、聊天和报告内容；每个异步边界重新读取语义事实。取消、持久失败、session 冲突、撤权、私有断连和迟到 ACK 在 grant 前均不能启动任务。grant 发出是 EH 的启动/取消线性化点；此后合法执行由原独立 Owner 持有，EH/client 消失不等于执行取消。没有新增公共 stop 或任意执行接口。

## 消费和资源事实

私有通道每条携带版本、随机token、完整原identity和连续sequence，准备最大4MiB，后续消息最大64KiB。最多32个在途消费责任。每个输出/请求/日志回调按精确sequence ACK；同步返回、异步返回、拒绝和断连均被消费，丢失或超限留下粘性未知。EH 转回既有消息及日志设施；无无界输出队列。原异步server handler及原caller回调仍由 owned 核心等待，日志消费也必须结算后才能完成额外传输观察。

`handle.kind=both`，保持 launcher 的逐项映射：processTerminal、精确turnTerminal、物理streams+executionDrain、runner和附加资源分别独立。业务 settled、interrupt、exit、空队列、grant 或 Promise 完成均不是终态/排空证据。专属 reader 仍须自然EOF、尾部派发、真实close和全部消费责任结束；共享观察语义及peer存活不升级。原start响应对账、候选/观察上限、一次绑定、取消唤醒及旧代次隔离完全保留在未复制的Core内。

Owner 持有执行 root/links（同一幂等释放函数）、配置执行 lease（temp 责任）。round-228 将现有专属执行的实际 process close、自然 pipe/readLoop、thread/execution lease 及异步消费者排空事实接入 runner/session 附加释放；保留可恢复 thread 历史，不删除历史、不主动 reader.close，也不以 exit 通知作为 close 证明。源、turn、物理 streams、executionDrain 和 runner 全确认后才逐项尝试资源释放。tab 通过下面的宿主能力释放；缺能力仍 required/unobservable。消息/回调失败时保留 unknown，无超时成功和隐式重试。EH 临时配置租约结算不替代 worker 的独立租约释放。

## round-228 精确 tab 能力与原 Owner 收尾

`departmentexecutionresources.ts` 只在可信宿主实际创建目标时登记精确 tab 对象、本地 session 快照和 workspace；弱引用中的不可序列化 target/capability 绑定完整 identity/generation。模型、UI、持久 tab ID 或结构相似对象不能产生能力。既有同步 session 写者可以确认准确的新建本地 session 转换；任意借用、替换 tab 或后继代次均拒绝。extension 为实际 adapter 员工目标和组长目标登记能力，原交互调用持有本地消费责任；回调拒绝或本地消费者异常为粘性未知。最多 256 个未释放目标、每目标 64 个消费者；满额拒绝，未知不淘汰，已证实关闭项释放登记容量，旧能力只返回其原幂等结果。

原 worker 只在真实 native/消费排空后，通过继承私有通道发一次 `release-tab`：随机 token、完整原身份、精确 bound resourceIdentity、阶段与序号严格校验。宿主等待原消费者真实结算，再核对原持久 binding/当前代次、精确原对象/session、非活跃任务和 workspace；调用实际 sessionTabs 关闭/刷新端口并回读目标不存在。该内部端口仅对精确拥有对象绕过组长普通关闭锁，保留原 UI 关闭语义、会话名/图标与布局，不取消合法原生任务。关闭失败、断连、错误或迟到 ACK 不产生成功 receipt。公开 Owner IPC 无新增接口。

原生 terminal 先交回既有交互消费者，私有通道保留到释放尝试完成及原 Owner 清理观察之后，避免“tab 等待交互结束、交互等待 receipt”的循环。`resources-released` 仅为开始观察的节拍，不是清理证据；原 Owner 仍独自验证全部 required 事实并持久 receipt。tab 释放不等待 adapter 终止观察、waitForTaskIdle 或容量归还。原 binding/session 历史保留。

## 验证与未覆盖边界

以下为 round-125 历史基线，缺失释放的描述由 round-228 上述实现及本轮报告更新：定向证据及命令写入 round-125 attempt 报告。当时证据为25项Node启动专项（保留有效14项，加最终协调器11项）、22项受影响交互检查，以及安装版EH正常/准备期取消两个场景。正常EH中，真实测试CLI在接受turn/start之前读取生产任务文件和runtime文件，确认executionSession及完整binding已持久化；EH退出后同一Owner仍live且重复identity start不重发。缺session/tab释放能力仍为unknown，未产出完整receipt。Node专项不安装vscode mock，使用真实受控Node NDJSON和确定性门闩；原生协议和资源能力是免费模拟CLI，不是对真实Codex能力的证明。安装版EH脚本 `scripts/verify_department_codex_owner_host.js` 使用临时HOME/workspace/用户数据和实际adapter、生产任务仓储与配置租约、生产协调器/worker；其可信fixture runPrompt回调替代UI入口，不宣称浏览器或真实模型验证。实际 runPromptNow/交互策略接线另由编译、相关交互回归和源合同核对覆盖。

本轮不改中央Owner设计、本体、FEATURE_INVENTORY、容量、全树stop/continue或生产observeLeaderCleanup。后续事实同步可引用本专题及四个新生产模块，区分员工首次原生持久绑定接线与仍缺的资源释放、组织receipt和容量恢复。执行集合库已落地；已跟踪leader代次的未登记调用会被现有bindExecution拒绝，本轮不绕过该门禁。

尚未验证真实模型、已安装真实 Codex 的 stdin EOF/卸载行为、Windows/Linux 实机或从 UI 发起的完整组织流程。本轮受控模拟 CLI 证明生产资源接线，隔离安装版 EH 证明实际 tab 端口；不扩大为真实模型或完整组织 UI 验收。缺响应、终态、管道关闭、持久确认、handler/callback结束时可能长期pending，不能以超时成功代替事实。保留的准备记录没有自动清理/重试通道；未知attempt需要后续可信恢复审查。

## 中断修复的证据对账与后续同步

round-214 修复报告单独记录恢复事实，不改写 round-125 的调度状态或原报告。初次核对时 742 个 TypeScript 文件和 EH 验证脚本与已有实体隔离构建副本逐字一致；原 25 项启动专项的组合覆盖、最终 22 项交互结果和两份 EH 报告作为复用基线。EH 的 `observed` 是模拟 CLI 接收任务时保存的快照，本次直接检查其中任务 executionSession、完整 runtime binding、worker 配置租约 PID 与唯一 turn/start，没有为补报告再次启动 EH。

本次另外修复私有合同的 shell 类型强转：macTaskShell 只接受字符串 bash/zsh，数组等值在 fork 或持久化之前拒绝。该变更后，在新的实体隔离源码副本执行标准 `npm run build`，再运行合同拒绝及新建/resume最小回归，7/7 通过；未变的授权、消费、取消和 EH 结果继续复用。最终 742 个 TypeScript 文件与新副本逐字一致，与原副本仅相差这一合同检查及追加测试。指纹清单与对账结果保存在 `.tmp/round214-codex-repair/`；它们是审查证据，不是运行快照、清理 receipt 或启动授权。

执行集合库已落地，但本接线只对未跟踪 scope 使用原 `bindExecution`。已跟踪代次仍由 RuntimeStore 的登记责任与原子绑定保护拒绝未登记调用；本接线不打开集合、不登记 producer，也不回退绕过拒绝。生产 producer 及全部首次登记入口是独立后续门禁。中央事实同步应仅登记员工首次原生绑定与单次 grant 的窄范围能力，继续保留组长生产执行、组织清理聚合、容量恢复、全树 stop/continue、冷恢复和真实 session/tab 释放门禁。

## 单次调用的交互收尾

round-215 修复交互层遗漏：异常分支原已禁止部门端口重试，但端口正常返回、既无有效结论又无可接受的主 turn 完成时，缺少结论分支仍会加入通用隐藏重试队列。外层随后等待并再次调用部门端口；生产入口的一次调用保护虽拒绝第二次调用，仍会产生额外等待、重试消息及覆盖原失败原因。

`handleMissingFinalConclusionForTab` 现在先沿用原结论判定；不满足时，部门端口直接返回 error，经原 `cleanupAfterRun` 保存准确原因“任务已退出，但没有有效的最终结论，无法确认任务完成。”和中文“任务失败”。该分支位于排队消息、重试计数和 delay 之前，不制造 assistant final、完成通知或成功状态。抛出的原始错误仍保留并向调用者传播。普通交互及未注入部门端口的 Loop 员工仍沿用通用隐藏重试。

实际员工携带 `loopTaskId`，生产 `shouldRequireExplicitFinalAnswerForRun` 对其返回 false，所以真实主 turn completed 仍可在没有显式 final 气泡时成功；若策略要求显式 final，仅完成通知仍不足以成功。相邻自然语言澄清续跑要求 `humanInteractionEnabledForVibeRun`，而该条件要求没有 `loopTaskId`，不适用于真实部门员工，无需扩大修改。

本次实体隔离标准 `npm run build` 及受影响交互模块 `node --test dist/test/extensionHost/promptInteractiveRuntime.test.js` 通过，52/52、零跳过。新增六项覆盖空输出/仅思考的一次调用与零重试成本、合法主 turn 完成、显式 final 严格性、普通交互与普通 Loop 重试；原抛错用例强化为真实员工输入并检查原错误及零重试。测试端口可重复调用，不依靠生产 invoked 保护或二次调用抛错通过。测试使用宿主夹具及 mock 重试等待，不调用真实模型，也不新增 EH/UI 端到端证明。

具体命令、隔离副本、源码对账与复用范围见 round-215 报告。原私有合同7/7、25个不同启动专项及EH正常/取消证据继续仅覆盖未变启动链；旧交互22/22由本次当前模块结果补充和替代。没有重跑启动协议、EH、浏览器或ledger集合检查。此修复不改变 Owner 的资源责任、未知保留、释放能力或任何根集成门禁。

## round-228 验证与后续门禁

实际命令、实体隔离构建副本、源码对账、受影响回归、受控生产组合与安装版 EH 报告见 round-228 attempt 报告。生产 producer/host、真实临时 Store 和免费模拟 CLI 覆盖员工及同 thread 两轮组长的完整原 Owner receipt；挂起输出/本地消费者/pipe 阻止提前释放，错误身份/代次、关闭失败、消费者拒绝、私有断连和伪造确认不成功。安装版 EH 使用真实 tab host/controller 及受控 settings/panel/ownership 端口，不是完整 extension 全局入口或浏览器用户流程验证。

OpenCode 首次会话和资源释放、其它角色、生产整组 receipt 聚合/容量消费、全树控制与冷恢复仍待后续；生产 observeLeaderCleanup 保持 null。本轮只扩展已装配 Codex 路径的清理事实，不改变单次调用、首次持久绑定、grant fencing 或配置选择策略，不发布扩展。


## round-231 后续生产消费

上述 round-228 的资源事实及原 required 策略保持。round-231 在 extension 接通仅 Codex 组长/Codex 员工完整代次的生产 `observeLeaderCleanup`：唯一 producer 关闭/排空并持久封闭集合，复用原 socket 严格验证后保存在原 client 内的私有完成观察，再核验当前配置、完整 binding 及冷重读集合；全部成功并持久移除原租约后，才实际归还组长名额。组长 drained 后保留 server 到宿主取得原 receipt，员工原 client 也按所属组保留；缺原观察而 socket 已退场仍 unknown，禁止磁盘 cleaned 补成功。只有成功组回收有界宿主引用，失败/未知保留责任与占用。此节取代本专题前述历史轮次的“生产 observe 为 null/容量消费未启用”当前状态描述。

具体合同及验证在[整组清理专题](department-leader-execution-cleanup.md)与 round-231 报告。OpenCode/其它角色、跨平台、真实 CLI/模型、完整 UI、全树控制、冷恢复及根集成仍是后续门禁，不以本轮窄范围 Codex 消费声明整体交付完成。
