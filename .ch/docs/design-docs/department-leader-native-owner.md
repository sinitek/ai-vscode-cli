# Codex 组长多轮原生 Owner

状态：开发中。提供可运行的独立普通 Node Owner 与可信宿主端口，round-224 已装入 extension 组合根及真实 Loop+ `runMain`；round-228 补齐已装配 Codex 路径的原生附加资源与精确 tab 释放。员工准入、单次 CodexOwnedExecution、原 Owner slot/identity v1、receipt 合同保持。

## 运行合同

`createDepartmentLeaderCodexBootstrap(identity, selection, ownerDirectory, host)` 仅接受严格 Codex/leader 身份及匹配的八字段 selection。可信 host 提供完整 `DepartmentLeaderExecutionProducer`、真实 Store、权威任务/组织/路线/容量复核、配置 builder、任务 session 唯一写者与精确回读、消息/请求/错误消费者；这些端口不能由 task 字段、模型、UI 或一个恒真回调构造生产授权。库不实现 producer，不 open/adopt scope，不创建 producer closure。

宿主端口自身还同步 cold read Store 核对 workspace/root/leader/module/generation、running、stopping 和组长容量租约。生产组合根的 `assertCurrent` 通过原 producer 额外重读 root/leader 的运行状态、workspace/module、固定角色路线与真实协调代次；不能只查时间戳、聊天或报告，也不能以测试授权函数替代权威来源。首次提交前 scope 必须已由真实 producer 使用 Ledger.open 开启。

一个协调代次使用同一 Owner identity、executionId、scope/generation 和配置/角色 selection。首次可明确 unbound/new 或精确 bound/resume。每个 invocation 是不可变 `{invocationId,prompt}`；调用 ID 冲突拒绝，完全重复返回原 launch/completion，不重发任务。完整生命周期保留最多 128 个 digest/结果责任，不淘汰未知记录；同一时刻只准入一个调用，满额或 busy 明确拒绝，不存在后台调度队列/隐藏重试。输出只经消费者传递，不保存输出历史。

`DepartmentLeaderCodexOwner` 每轮新建一个不可变 `CodexOwnedExecution`，保持原 prompt、独立 observation/transport、真实终态与物理 drain；不重复 execute 同一对象、不修改原单次执行合同。首轮取得原始 thread/start 或 thread/resume 响应，后续轮只 resume 冻结的原 thread。上一轮 task Promise 结束不足以准入下一轮；须真实 turnTerminal、processTerminal、streams、executionDrain 和 runner 事实均明确，且所有私有消费者确认。任何失败或未知使该代拒绝后续执行，不换 thread/Owner、重放 prompt 或重试。

## 首次登记、绑定及每轮授权

顺序固定：

1. 宿主同步核对权威事实与本代 producer，Ledger.admit 先保存固定 leader responsibility、selection、八项全 required，再进入配置 builder。
2. 固定 `departmentleadercodexownerworker.js` 以 Electron 普通 Node 规则 detached fork；worker 自己 acquire 真实 SharedRuntimeConfig 执行租约，核对 ready/configId/revision，持有真实执行 root/links。配置/命令/模型/思考/环境/工作目录仅来自这一次可信构造。
3. 原 `DepartmentExecutionOwnerServer` 登记同 identity 和 requirements，再允许首轮真实原生准备。公共 socket 仍只接受原 identity 请求，无新增 prompt/command/worker/module 入口。
4. 原生响应取得冻结 session 后，宿主唯一写者 `persistSession` 保存任务原生 session 并由 `readSession` 精确回读 cli/sessionId/configId；不能以 tab、通知或缓存替代。
5. 同次 admit 的 bind 回调复用 `Store.bindLeaderExecution` 原子提交组织 binding 与 responsibility 引用，并 cold read 完整 binding/selection/requirements/责任；失败保留 null 或原绑定。
6. worker 完成原 Owner.bindSession 后才请求授权。宿主再次同步核对当前 producer、任务权限、精确 session/binding，在无 await 区间发出一次性私有 grant。
7. worker 同步验证并消费该 invocation 的 grant，随后才释放原生 bind latch，允许一次 turn/start。grant ACK 不等于任务已实际送达，测试据真实 wire 统计发送。后续轮仍有原生精确 resume、持久 binding 复核、原 Owner 绑定确认、最终复核及独立一次性 grant；无需重复写任务首次 session。

Ledger admission 持有到 grant 确认，并保留原始 builder/持久化 Promise 等异步责任直到真实完成；取消不丢弃迟到持久化。业务执行/消费/物理 drain 在独立 Owner 内继续，不能因 admission Promise 结算就封闭整代。准备失败、取消、持久失败、身份冲突或不明送达均保留责任、binding 和容量，不生成成功。

已有本代责任时，新宿主 `invoke` 明确 observation-only；`observe()` 仅冷读完整原责任/binding、精确任务 session 并查询原 Owner。缺失/冲突或原 Owner 不可达保持 unknown，不启动替代 worker。当前不提供冷恢复调用控制通道。

## 私有协议与生命周期

继承 IPC 一次准备使用随机 256-bit token、完整原 identity、严格 allowlist 和控制消息大小上限。双向严格递增 sequence；每条 invocation/session/persisted/owner-bound/grant/granted/settled 均校验当前阶段与调用身份，callback ACK 引用准确原序号。重复、乱序、错误 token/身份/字段或迟到 grant 保守断开并封闭。配置描述最大 4 MiB，控制与 callback 消息最大 64 KiB；2026-11-17 起 invocation 提示词不再设置部门长度上限，精确执行数据帧由宿主和 worker 共用 `departmentleaderinvocation.ts` 验证并完整传给原 CLI。worker 和宿主分别最多 32 个未确认消费者；原 CodexOwnedExecution 仍保留自己的 64 回调门禁。消费者挂起则保留真实 drain 责任；回调拒绝/断连/溢出不升级 streams。

`closeAdmissionsAndDrain()` 同步封闭新增调用和迟到 grant，返回真实原生/消费/资源 drain；没有超时成功、空 Map closure 或 task completed 推断。grant 发出为宿主启动/取消线性化点：之前取消/撤权/封闭零任务，之后合法调用不因 AbortSignal、EH/启动宿主断连而停止。worker 消费 grant 后同步标记已授权，后续 seal 不 abort 它。断连自动封闭新增调用，已授权执行继续；无法交回消费者确认时保持 unknown。

每轮持有独立 transport，原真实 missing-terminal、原始异步请求、挂起 callback、未关闭 pipe 都阻止该轮排空和后续 invocation。协调终态须显式 seal、全部已准入调用完整物理/消费事实和资源事实；单轮成功、waitForTaskIdle 或任务状态不代表完整代次。封闭端口返回的资源事实也不是 producer closure 或容量恢复凭证。

所有八项策略为 required。安全排空后才尝试 root/links 移除和配置租约释放。round-228 在显式 seal 后聚合全部原 invocation 的实际 exclusive process close、自然 pipe/readLoop、原 thread/execution lease 与消费者排空事实，确认 runner 附加释放，保留可恢复 thread 历史；任一轮未知则 runner 仍 unknown。通过可信宿主的精确不可序列化 tab 能力完成实际关闭及回读后，原 Owner 可按原八项 required 生成完整 receipt。缺能力、拒绝、断连或失败仍 unobservable/failed，不放宽策略。生产组长容量消费未启用。缺源事实则 root/links/lease 也保持 unknown；测试 teardown 的 SIGTERM/目录删除不计清理证据。

## 验证与范围

受控宿主使用真实临时 RuntimeStore、Ledger.admit、SharedRuntimeConfig、固定 worker、原 Owner server/client 和原 CodexOwnedExecution；免费模拟 NDJSON CLI 只证明端口接线，不证明安装版 Codex、真实模型、EOF 支持或完整用户交互。隔离 HOME/USERPROFILE/CODEX_HOME，不访问用户业务配置。

本轮实体隔离标准 build 和定向结果、命令、源码对账及中间失败见 round-222 attempt 报告；有效行为覆盖两轮 new/resume、重复/冲突/串行、准备前留责、持久/绑定失败、最终 grant 前撤权/同步取消/封闭、迟到原生响应、missing terminal/挂起消费者/pipe、回调拒绝、grant 后取消和真实启动宿主退出存活。session/tab 不可观察不生成 cleaned，租约/容量边界保留。

## Round 393 callback ACK repair

Callback IPC ACK 只携带 `onRequest` 的结果，因为该回调是原生 JSON-RPC 请求/响应；通知及日志 callback 的 handler 返回值与 Codex 协议无关，ACK 固定回 `null`。这样 EH 返回的任意对象不会被意外序列化为 64 KiB IPC 负载。`onRequest` 仍走原有有界 JSON 协议；无法序列化或发送时关闭本代并保留 unknown，不能伪造成成功。worker identity、token、完整消息 allowlist、单调序号、回调并发限制、session readback、Owner bind、单次 grant 和 receipt/容量合同不变。

首次 bootstrap failure 在 Extension Host 本进程 stderr 输出一次固定 stage 标签。标签只标识拒绝消息、callback consumer、ACK 传输、session/binding、grant 检查或 worker/channel 失败，不包含 token、prompt、callback 参数、原始错误、环境或业务数据；诊断不调用宿主 callback/ACK。对外仍返回 unknown，且不会重放 invoke。round-389 协议现场只保存两次 callback 到达，未记录 callback 名称或 ACK 结果；因此无法把历史那次 failure 精确归因到具体 handler。新增受控 IPC 回归复现 ACK 携带超限通知返回值会越过消息约束的故障类别，并验证异步通知改为 null ACK 后完整到达持久绑定、Owner grant 和 turn；原现场具体 callback 的归因仍待今后启用新 stage 诊断的真实运行证据。

本轮没有改变产品业务语义、所有权或授权规则，功能清单与 ontology 无需更新。

最终验证（2026-11-14）：实体源码副本 `/var/folders/49/shyk0sxs3qg15d9w_npw48z80000gn/T/round222-leader-build-6sst9teg` 内执行：

```sh
npm run build
node --test-reporter=tap --test-concurrency=1 --test dist/test/runtime/departmentleadercodexowner.test.js
```

标准 build exit0；最终模块 **25/25**，0 failed/cancelled/skipped，约 3.52 秒。最终 6 个本轮 TS 与实体构建输入 SHA256 全匹配；未更改共享 dist。ontology `search_ontology.py --validate` 通过（4 workflows），工具 `python3 -m unittest discover -s .agents/skills/ontology/tests -p 'test_*.py'` 9/9 通过。中间模拟 CLI 首次读未创建轮次文件导致退出、grant ACK 前后统计竞态均已修正；最终结果覆盖修正，不将中间通过数相加。实际日志与环境记录保存在该实体副本。

复用 round-220 员工 82 个不同 bootstrap、round-215 交互 52 项、未变私有 IPC/launcher/runner 的历史证据，仅限原组件，不覆盖新增多轮协议。未重跑员工、EH、浏览器、ledger 聚合全套或真实 CLI。新增协议的 token/sequence/阶段检查仍需主任务独立安全审查；固定免费测试不等同所有恶意报文穷举。

后续生产 producer 必须把真实 Loop+ 组长完整协调生命周期、全部员工入口及最终 grant 一并装配，真正关闭准入、阻止迟到授权并 drain 后才允许 Ledger.close；不能用本轮测试 producer/端口 Promise 代替。生产 `observeLeaderCleanup` 保持 null。总监经典 Loop、其它 CLI 明确未支持；session/tab 释放、容量消费、全树 stop/continue、冷恢复和最终 UI 集成仍待交付，不发布完整组织可用声明。

## round-228 生产资源释放

与员工共用 `departmentexecutionresources.ts` 能力库：extension 在真实目标创建时登记原 tab 对象、本地 session 快照和 workspace，首次 leader identity 绑定能力；同代后续 invocation 仅增加原本地交互消费责任，不能重绑或替换 tab。原 native thread 独立于本地 tab UUID，后续仍只 resume 原 thread。

显式 seal 同步阻止新调用/迟到 grant，原 Owner 等全部已授权轮的真实物理和消费事实，再释放 root/links/config lease 并向宿主私有通道请求一次精确 bound identity 的 tab 释放。宿主仅在 sealed、无 active invocation、完整 binding、原身份/序号匹配时接收；worker 仍验证原 ACK 序号及严格结果，不接收 not-applicable 代替 required。公共 Owner IPC 无新增执行/清理写入口，receipt 仍由原 Owner 生成。

tab 等待原交互消费者完成，异常结算保留未知，再核对 workspace、当前组织代次及原 binding、原对象/session 和非活动任务状态；真实 sessionTabs 内部精确关闭/刷新并回读。该流程不等待自身 receipt、adapter idle/终止观察或容量归还，不构成循环。资源库有界，未知责任不淘汰，成功释放项归还内部登记槽位；重复请求返回原结果，不能关闭后继 tab。缺失终态、挂起 callback/pipe/本地消费者阻止提前释放；grant 后 EH 断连不取消原生执行，但无可信资源确认就不产成功 receipt。

本轮生产 producer/host、真实 Store、免费模拟 CLI 的最小组合覆盖同一 thread 至少两轮组长及员工的完整原 Owner receipt；错误身份/代次、失败/断连及幂等边界见 round-228 报告。隔离安装版 EH 仅验证实际 tab host/controller 与受控宿主端口；未验证真实模型、真实 Codex 版本 EOF 行为、完整 UI 或 Windows/Linux 实机。此前 round-222 的“session/tab 无能力”结论只继续覆盖未注入能力的端口路径。observeLeaderCleanup 保持 null；完整组长 receipt 不自动释放组长/整组容量，OpenCode/其它角色、全树恢复及最终根集成仍为门禁。


## round-231 后续生产消费

上述 round-228 的资源事实及原 required 策略保持。round-231 在 extension 接通仅 Codex 组长/Codex 员工完整代次的生产 `observeLeaderCleanup`：唯一 producer 关闭/排空并持久封闭集合，复用原 socket 严格验证后保存在原 client 内的私有完成观察，再核验当前配置、完整 binding 及冷重读集合；全部成功并持久移除原租约后，才实际归还组长名额。组长 drained 后保留 server 到宿主取得原 receipt，员工原 client 也按所属组保留；缺原观察而 socket 已退场仍 unknown，禁止磁盘 cleaned 补成功。只有成功组回收有界宿主引用，失败/未知保留责任与占用。此节取代本专题前述历史轮次的“生产 observe 为 null/容量消费未启用”当前状态描述。

具体合同及验证在[整组清理专题](department-leader-execution-cleanup.md)与 round-231 报告。OpenCode/其它角色、跨平台、真实 CLI/模型、完整 UI、全树控制、冷恢复及根集成仍是后续门禁，不以本轮窄范围 Codex 消费声明整体交付完成。
