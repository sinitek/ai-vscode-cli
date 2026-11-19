# 组长整组执行集合与清理聚合

状态：开发中。round-231 已把真实生产 producer 与原 client 观察接入 extension 的 `observeLeaderCleanup`；仅同一宿主新建且全部覆盖的 Codex 组长/Codex 员工代次允许凭完整原 receipt 归还组长名额。OpenCode、其它角色、旧开放集合及冷恢复保持拒绝；根功能尚未完成。

## 完整集合的来源

`DepartmentLeaderExecutionScope` 精确绑定 `rootTaskId/workspace/leaderTaskId/moduleId/generation`。运行组织文件新增可选 `leaderExecutionSets`，与 append-only `executionBindings` 并存；不写父任务、Loop+ 调度快照或 task.status。

每个集合保存可信宿主 producerId、开放/封闭状态、不可逆的 closure，以及从该代第一次准备开始的全部责任。组长协调 producer 自身必须占一个 `target.role=leader` 责任；每个员工 subtask/attempt 都独立登记，包括历史轮次和准备失败的责任。不能从当前 bindings、最后一轮 running 列表、completed、waitForTaskIdle、空 Map 或 Promise 结算推断全集。

责任含固定 registrationId、角色/员工 subtaskId/attemptId、原 selection 和原 requirements。登记先原子持久化，之后才准许进入原生准备。未原生绑定的责任保留 `executionId:null`；准备失败或未知不能删除。原生绑定完成后，`bindLeaderExecution` 一次原子提交完整既有 binding 和集合引用，成功返回后才允许启动。绑定不可替换，不接受 unbound session、selection/requirements 变化、跨组织/代次/角色或已有槽位冲突。

组织 binding 目标按精确 scope/generation/role/subtask/attempt 区分；员工目标复用 `executionSlot(identity)` 并附加 `attemptId`，组长仍按每 scope/generation 一个协调目标。相同精确 attempt 只允许同一完整 binding 幂等，owner/session/execution/selection/requirements 变更均拒绝；不同 attempt 保留独立原身份与 Owner 引用。Owner 的 `executionSlot(identity)`、identity v1、receipt index 和同 Owner 同代启动 fencing 均不变；组织存储可记住两次 attempt 不会授权 Owner 同 slot 重复启动。不得改 subtask/generation 或伪造 identity 绕过原 Owner 冲突。

所有 attempt responsibility 都进入同一封闭集合。聚合逐项观察全部 attempt，而不是只读当前/最新 binding；旧 attempt 仍 live、缺失、unknown 或冲突就阻止成功。个体恢复继续按请求精确 subtaskId/attemptId 查找；历史 binding 的 session 与当前权威 task/session 不符时返回 null/unknown，不通过挑最新记录替代或弱化核验。

## 可信 producer 注入合同

`DepartmentLeaderExecutionProducer` 只能由宿主构造注入，不能从模型字段、浏览器输入或持久 task 数据实例化：

- `beginTracking(scope)`：证明从任何原生准备/启动之前就覆盖了该代所有准入来源。仅同一现存能力可幂等重入，不能收养旧的未跟踪运行或仅凭持久开放记录恢复这个能力。
- `isCurrent(scope)`：检查同一原生生命周期能力仍有效，不能用 task.status、timeout 或本地执行 Map 实现。
- `withAdmission(scope, work)`：覆盖登记、原生准备、绑定和最终启动授权全过程；新准入必须受 producer 的原生准入栅栏控制。在 work 结束后保留 bind 回调也无法追加绑定。登记幂等不等于重启授权；prepared handle/实际 launch 重复调用还须遵守原有可信准入与 Owner 幂等合同。
- `closeAdmissionsAndDrain(scope)`：原子关闭新增准入及迟到 launch grant，等待全部在途准入结束，再返回 `{version:1,scope,producerId,admissionFence}`。scope 必须完全一致。它不能等待一个无关 Promise 或看到 Map 为空就声明完整；执行仍可运行，实际清理由各自 Owner receipt 证明。

`DepartmentLeaderExecutionLedger` 没有生产默认 producer；注入 null 时 open/admit/close 都拒绝。库不制造 closure，不把普通 coordinator Promise 包装成生产证明。低层 store 方法是现有单 EH 写者的内部可信端口，并非面向 UI/模型的安全边界；调用者不得绕过上述能力直接封闭。

关闭先由 producer 栅栏和 drain 确认，再持久化 closure；持久失败保持磁盘开放，仍不可聚合成功。相同 closure 可重试，封闭后所有登记/绑定（包括迟到重复请求）拒绝。集合至少包含一个组长责任才可封闭；封闭但存在 null 仍不是可观察的完整集合。已封闭事实、producer 和成员不能改写。

## 运行存储与成本

所有操作复用 `DepartmentRuntimeStore` 的同步 cold-read→单次验证/索引→fsync 临时文件→rename；不增加异步写间隙、跨进程接管或 Owner receipt 扫描。验证按 leaders/bindings/sets/entries 线性构建成员、执行、slot、scope、责任和目标索引，修改使用本次索引，不再完整验证历史；controller write 仍只需当前/候选各一次验证。集合 fingerprint 按不可变登记顺序线性生成。

旧 controller write 省略 `leaderExecutionSets` 会保留事实；显式删除集合、回退状态、改成员/身份/策略、追加或伪造 closure 都拒绝。通用 write 无权创建集合。已有 executionBindings 的接口和历史幂等保持；一旦代次启用集合，旧 bindExecution 不能绕过责任登记加入新身份，必须走原子 bindLeaderExecution。旧代次未启用集合的既有绑定路径照常工作。

旧快照没有集合时只返回不可观察，不重建空全集；已有未跟踪 binding 的代次不允许事后 open/adopt。不完整集合或损坏文件仍为 unknown/error，不能覆盖为空。跨进程写者、缺失事实、原生 unbound 和旧开放集合都不能自动修复。持久机制延续原有单 EH 假设，未新增目录项掉电 fsync 或跨进程 CAS。

## 聚合边界

`DepartmentLeaderExecutionCleanup.observe(scope, signal?)` 初读只有在精确当前代次、已持久封闭、含组长责任且每项均有对应完整 binding 时才返回观察；否则 null。

观察对每项原绑定调用可信 selection verifier，再以 app-data owner 根目录加严格 ownerId 定位现有 `DepartmentExecutionOwnerClient.waitForCleanup(identity, originalRequirements, signal)`。它串行观察，复用已有 live 退避（250ms 起，最多 5s），不设“过期即成功”的期限，也不并发创建无界连接。

任何缺失/失败/不匹配 receipt、unknown/conflict、身份或策略不符都会拒绝。收到全部真实 receipt 后冷重读同一 scope，核验当前代次、成员绑定、原策略、集合顺序及 closure fingerprint 均未变，才完成。取消仅停止观察；没有 stop、handoff、替代 Owner、资源释放或容量释放权限。Owner 不在线时即使磁盘存在 cleaned receipt 也不成功。

## 后续宿主调用示例

以下为宿主接线示意，`nativeProducer`、prepare 和 launch port 必须由后续生产接线任务提供；当前不能用测试 fixture 替代它们。

```ts
const scope: DepartmentLeaderExecutionScope = {
  rootTaskId, workspace: workspaceKey, leaderTaskId, moduleId, generation,
};
const ledger = new DepartmentLeaderExecutionLedger(runtimeStore, nativeProducer);
const opened = ledger.open(scope);
if (!opened.ok) throw new Error(opened.error); // 未成功不得准备或启动

// 协调 producer 对应的真实组长执行；不是虚拟空 receipt。
await ledger.admit(scope, {
  registrationId: coordinatorRegistrationId,
  target: { role: "leader" }, selection: leaderSelection, requirements: leaderRequirements,
}, async (bind) => {
  const prepared = await prepareNativeCoordinator(); // 此时责任已经落盘
  if (!prepared.binding) throw new Error("coordinator-native-binding-unknown");
  const saved = bind(prepared.binding);
  if (!saved.ok) throw new Error(saved.error); // 责任保留，不能授权启动
  await grantPreparedCoordinatorStart(prepared); // 仍在 producer admission 内
});

// 在每一次员工原生准备之前调用，不能只放在最后一轮收口时补登记。
await ledger.admit(scope, {
  registrationId: employeeRegistrationId,
  target: { role: "employee", subtaskId, attemptId },
  selection: employeeSelection, requirements: employeeRequirements,
}, async (bind) => {
  const prepared = await prepareNativeEmployee();
  if (!prepared.binding) throw new Error("employee-native-binding-unknown");
  const saved = bind(prepared.binding);
  if (!saved.ok) throw new Error(saved.error);
  await grantPreparedEmployeeStart(prepared); // 必须核验原生准入/最终 launch grant
});

// 原生 producer 正式结束派发时调用；库不以业务 completed 触发它。
const closed = await ledger.close(scope);
if (!closed.ok) throw new Error(closed.error);
const cleanup = new DepartmentLeaderExecutionCleanup(runtimeStore, trustedOwnerDirectory, verifySelection);
const observation = cleanup.observe(scope, signal);
if (!observation) throw new Error("leader-generation-uncovered");
await observation.done; // 仅是清理证明；容量/调度发布另由宿主门禁控制
```

后续 `observeLeaderCleanup(task,generation)` 应先通过权威 task/组织/session/route 合同推导同一 scope，再消费本观察；不能直接相信调用者提交的 scope 或 registration。启动前登记必须覆盖所有原生准备入口、协调执行和该代全部员工；只有生产 producer 能证明其栅栏/drain 与真实启动授权的线性化关系后，才能安装该门禁。

## 验证及中央文档待同步

新增测试覆盖完整集合、遗漏 coordinator、空/开放集合、在途准入与封闭竞态、迟到登记、重复/身份/策略/slot 冲突、原生 unbound/准备失败责任、旧记录/损坏/持久失败、旧 controller 保留、代次/集合/closure 在等待中变化、逐项 receipt 故障、取消和完整成功。真实临时 RuntimeStore 配合既有独立 Node Owner worker 验证一组 coordinator+两员工真实 receipt 的完整聚合，以及中间员工 live 阻塞、取消不停止执行、之后重试成功。网络故障用受控本机 IPC 响应；等待后重读测试中的客户端 mock 仅隔离测试重读边界，不构成真实清理证明。

本轮已将组织 attempt binding 与 Owner fencing 的区别同步到中央事实：新增“组长代次执行集合/责任项/producer 封闭事实”概念；关系为“精确 attempt 责任绑定一个原身份，不同 attempt 分别持久，可信 producer 封闭集合，已封闭完整集合才可聚合全部 Owner receipts”。生产整组清理、容量恢复和冷恢复仍未完成；`plugin.department_task` 保持开发中。

round-217 的 source lifecycle 隔离、真实双 attempt 聚合及其限定验证仍按原报告范围有效。round-218 补了 ready 前失败回收和可取消 receipt 等待，但其强制回收仍错误依赖 POSIX 信号处理器收尾 payload，且未从 receipt store 证明没有成功凭证；round-220 修正了显式forced recovery边界，不过当时的IPC断连回归没有创建payload，不能证明断连时payload实际收尾。round-222 增加了这一缺失覆盖：测试先启动并确认精确execution的payload仍live，再断开父IPC；worker的`disconnect`事件同步将cleanup证据固定为failed，随后终止自己创建的payload，并仅在payload真实`close`回调后向精确Owner临时目录写入测试生命周期记录。Owner实际close后，父测试按executionId及ownerId核对该记录，并用只读`DepartmentExecutionReceiptStore.read`确认不存在成功`cleaned`凭证。该记录是测试资源结算证据，不是Owner receipt或恢复授权。没有payload close记录或receipt意外成功时测试失败；Owner退出、kill返回和超时都不能替代该记录。worker信号处理仍只是附加回收路径，正确性依赖明确forced/disconnect处理及真实close事件，不依赖POSIX信号回调。

round-225 修复早期启动诊断的二次失败：worker在Owner server/ReceiptStore创建目录前发送startup-error且IPC不可用时，生命周期文件可能因目录不存在而无法记录。诊断持久化失败现在降级写入stderr，同时保留原始startup/IPC错误和记录错误；该降级不创建目录或生命周期/close证据，也不影响真实payload close回调是唯一close证据来源。回收观察器的二次失败同样进入可观察诊断并保留非零结局。新增回归在Owner目录尚不存在时确定性触发IPC断开和startup-error，核对原始错误、ENOENT、worker真实close和非零退出；该测试只验证夹具诊断结算，不代表生产Owner启动、清理或容量恢复。

两个Owner入口共用的ready观察覆盖启动错误、提前close、ready缺失及调用方AbortSignal取消；失败后调用方会等待与teardown hook共用的幂等清理Promise，清理失败和原启动错误均可观察。fixture teardown 先发送 release，以 `AbortSignal` 有界等待真实 Owner receipt，再请求正常关闭；失败时经测试专用 IPC 将fixture cleanup固定为failed并回收payload。若IPC已断开，则worker按上述disconnect路径回收payload并写入close事件，父侧仅在Owner真实close后核验事件。round-223将worker进程消息发送和payload release发送统一为同步异常捕获及callback错误处理；不能送达的测试通知会记为精确Owner目录中的 `ipcSendFailed` 事件，不会中断payload实际回收，也不会成为close证明。disconnect、signal及显式强制回收入口均观察并结算同一个recovery Promise；失败写入 `recoveryFailed`，保留错误原因，退出状态非零。新增注入拒绝回归确认payload实际close后才报告recovery失败，并且真实Owner清理观察及原receipt仍不成功。round-225进一步保证诊断文件写入失败时以stderr保留原始错误及二次记录错误，不补建目录、不写close证明；recovery observer的诊断错误也会被结算为非零结果。ready消息、payload启动、forced回收通知及release消息的send错误都被处理；强制回收必须等待每个自建payload真实close，只有该close回调能写生命周期记录。正常成功路径继续由真实receipt证明，强制回收/kill仅代表测试资源收束，不能代表聚合成功、生产资源释放或容量恢复。round-218、round-220及此前未变测试结果按原报告范围复用；round-222断连payload证明、round-223 IPC结算及round-225早期诊断失败边界见各自attempt报告。本轮验证范围与结果以round-225报告为准；仅当前macOS宿主验证，Windows/Linux未实机运行。


## round-231：原观察与生产容量消费

`DepartmentExecutionOwnerClient.waitForCleanup` 只有在原 socket 的严格版本/requestId/帧、完整 bound identity、原 requirements、原 receipt 校验成功后才保存私有 `#completed`。缓存按 canonical 完整身份索引，内部不暴露，返回深副本；没有外部写入、反序列化或磁盘 receipt 恢复端口。每 client 最多256项；不同代次/策略、取消或新 client 的 socket 失联仍拒绝。公开 Owner IPC 完全不变。

生产 producer 按已持久责任保存员工和组长的原 client 与不可替换完整 binding。每代最多256项、最多128代，未知不淘汰；只有整组清理成功、租约持久移除并实际 release 后才通过 `leaderReleased` 清掉该代引用和已完成宿主记录。组长 worker 的 drained 仅作节拍，保持原 server/私有通道直到 bootstrap 用原 client 取得真实 receipt，再正常断连。员工继续原有节拍，但同一个已验证 client 被保留供整组聚合。失败的 receipt 观察不会被升级为成功；Ledger.close 证明封闭而非成功清理。

`createDepartmentProductionCleanup` 由真实 extension 装配。它从权威 task/root/组织/路线/容量和唯一 producer 推导 scope，仅 Codex 组长与 Codex 员工可入；先同步关闭准入和所有最终 grant，真实 drain 原始准备及 Owner 后持久 Ledger closure。聚合覆盖同代一个组长和全部员工 attempt，不从当前 running/最后一轮推断全集。每项使用精确原 client，核验当前角色路线、原八字段 selection、配置 ready/configId/revision、task native session 及完整 binding。全部成功后再次核验 selection，冷重读同一集合、closure、代次和 binding；调用方取消仅脱离观察，不停止 producer 持有的原 Promise 或已授权执行。

实际 adapter 的正常 `result.done` 与异常路径均已有 `closeDepartmentCoordinator`，不是仅 stop 关闭；stop 的原 producer.close 先同步封住 grant。native drain/receipt 不等待 adapter idle、容量归还或 orchestration.lifecycle，避免等待自身。没有终态、悬挂 pipe/消费者或准备时继续等待真实事实，不以超时声明成功。

orchestration 获得整组观察后，先把移除目标 leader module 租约的精确 capacity 快照持久化，再调用原 `CapacityLease.release`，最后清理成功组的宿主引用。持久失败保留内存租约、blocked 和原绑定；容量订阅按实际 release 保存后续快照。默认4组长/共享20员工及每组零余额最多一个未释放超额规则均复用，未复制 scheduler 或容量规则。

验证与限制详见 round-231 attempt 报告：物理隔离标准 build、生产 producer/实际 adapter/Store/免费 Node 协议 CLI、原 socket 退出后的原观察、六个顺序模块复用、共享员工余额、pipe/消费者/失败和取消门闩。安装版 EH 仅核对已激活 extension 的实际组合回调存在并拒绝未知身份；测试仅在隔离编译产物临时追加 getter，退出后恢复，不导出生产测试 API。此处不宣称真实模型、完整 UI、Windows/Linux、OpenCode 释放、全树 stop/continue 或冷恢复通过。此前各轮库/夹具证据继续按未变源码范围复用。


## round-234：阶段快照与有界观察订阅

本轮只改变观察成本和等待管理，业务清理、准入及容量权限合同不变。生产观察按精确 `leaderExecutionScopeKey` 共享一个底层 close/drain/聚合责任，每个工厂最多128个未知代次、合计128个当前订阅。首次观察同步调用原 producer.close，后续观察以可移除订阅等待；取消同步移除订阅和 AbortSignal listener，不给原 pending Promise 追加 reaction，不取消或重启原准备/消费者/已授权执行。没有订阅时未知底层仍留存，满额拒绝新代次，不淘汰未知责任。底层真实成功/失败后通知并清除所有订阅；不缓存调用者可提交的成功观察。只读 `observationState()` 暴露计数用于确定性诊断，不暴露结果注入、client或授权能力。

producer 的 `observationSnapshot` 只从本宿主创建的代次出发，一次核对权威 task/root/组织/容量及原producer持久集合，将完整binding与原client能力逐项精确对应到阶段内索引。它不接收外部快照，不提供launch授权，不长期缓存权威状态。生产聚合用批量策略端口替代逐binding的 `scopeFor/current/matches/facts` 冷读；每阶段每CLI只读一次ready/configId/revision，配置await后重新取得权威阶段。任务原生session、角色路线、selection八字段、requirements、完整binding与原client引用仍逐项校验；原Owner batch等待后再次执行完整批量策略校验，最后仍冷读完整封闭集合、closure、generation和全部binding，并执行同步权威复核。原client只缓存严格socket验证结果的合同完全未改；没有磁盘receipt补成功。

定向生产组合检查使用真实临时RuntimeStore、原生产producer/host/adapter和固定免费Node协议CLI。当前1/4个binding及0/128个追加历史binding的三个场景均为23次冷读，验证数分别23、2967、3036（每次读取仍完整校验当前全量历史）；两阶段配置读取均2次。观察期间的配置、generation、closure变化继续拒绝；128订阅满额拒绝、取消即时清除、重复取消/重订阅只保留同一个底层责任；准备和原生消费者门闩放行前不结算。新增8项及直接相关旧检查结果、隔离标准build和精确源码覆盖以round-234 attempt报告为准。Store存储/追加历史/原子binding算法未修改，无需重复历史绑定性能检查。

中央功能清单及ontology由并行准入修复任务维护；本轮不改变业务概念、状态机、权限、清理证据、容量消费或事实来源边界，因此无需新增本体项。OpenCode/其它角色、全树控制、冷恢复、真实CLI/模型与完整UI、Windows/Linux及最终根集成门禁保持；本轮不声明产研部整体完成。

## 停止、清理与容量诊断日志（2026-11-18）

关键事件复用 `logger.logEssential`，调试关闭仍写入应用日志 `~/.sinitek_cli/logs/sinitek-cli.YYYY-MM-DD.log` 及同日 `.N.log` 分段，沿用现有 10 MiB 轮转和保留策略。按内部 `rootTaskId`、`leaderTaskId`、`generation` 查询，并与 `department-leader-native-failed` 关联；该既有事件补充根任务 ID，私有 IPC 失败分类不变。例如：

```sh
rg 'department-(root-stop|leader-cleanup|leader-capacity|employee-capacity|lifecycle-persistence)' ~/.sinitek_cli/logs/sinitek-cli.*.log
rg 'msg_<内部根任务ID>|msg_<内部组长任务ID>' ~/.sinitek_cli/logs/sinitek-cli.*.log
```

| 固定事件 | 发生点及含义 |
| --- | --- |
| `department-root-stop-started` | 本宿主实际开始根停止，重复在途请求共享同一次记录。 |
| `department-root-stop-settled` | 原停止流程结算，附 `confirmed/unconfirmed/retained/elapsedMs`。前两项按本次捕获的原代次，分别统计本宿主已取得原整组核验结果与未取得的组长数；`retained` 是仍持组长租约数，与前两项可以重叠。已核验但释放持久失败应为 confirmed=1、retained=1。旧适配器未装整组凭证门禁不计已确认。 |
| `department-leader-cleanup` | 每个共享组清理记录 `producer-close` 与 `owner-receipts` 的开始/确认/未确认；前者只证明原 producer 的封闭及持久 closure，后者包括原集合、selection、全量原 client receipts 和末次权威核验。 |
| `department-leader-capacity` | 生命周期、idle、释放持久化失败时记录保留原因；只有既有 `CapacityLease.release()` 成功返回后才记录 `capacity-release/released`，包括正常收尾、显式停止及既有启动补偿路径。 |
| `department-employee-capacity` | 原员工租约实际归还后记录 released，清理拒绝时记录 retained；重复 release/quarantine 不重复记录，晚到结果保留员工创建时的组长代次，不记录员工正文或工具结果。 |
| `department-lifecycle-persistence-failed` | 原运行快照、释放快照或 producer closure 持久化失败；同一连续故障仅记首次，成功持久化后重新允许记录。closure 写入处直接判别持久化拒绝，不从异常文本猜测；最近128个失败代次做有界去重。 |

原因枚举固定为 `none/already-blocked/evidence-missing/evidence-rejected/persistence-failed/task-still-running/identity-changed/unexpected-failure`。仅对已知内部错误分类，未知异常统一 `unexpected-failure`，不输出异常原文。字段仅投影有界内部任务 ID（至多128个 ASCII 字母数字、下划线、连字符；其它值置 `invalid-id`）、代次、固定阶段/结果/原因、数量和耗时（整数 0..2147483647）。不写异常、堆栈、路径、会话、正文、命令、工具载荷或凭据。

根停止日志按本宿主一次停止周期去重，成功继续后开始新周期。组清理日志跟随一个原共享观察，取消订阅和128个观察者不产生额外阶段事件；最近128个 scope/代次保留抑制记录，淘汰后重新实际观察该旧代次可以再次记录，日志不承担永久审计或幂等授权。晚到的整组结果和释放记录使用操作开始时捕获的原代次，不能套用停止后递增的代次。读取界面、查询计数和轮询不产生日志。

日志为非阻塞旁路：不增加 Store/Owner/selection 核验读取，不等待日志写入；同步抛错及异步拒绝均吞掉，不改变原 receipt、持久化结果、容量门禁和原业务返回值。原生 Promise、停止标记、日志里的 confirmed、容量计数、Owner 记录里的 live 或进程退出均不是清理凭证，不能据此手工释放或继续现场根；必须沿用原 Owner 完整凭证和持久释放门禁。`producer-close/confirmed` 尤其不代表 Owner 已清理。日志写入失败可能造成事件缺失，缺日志也不能证明未执行或已释放。

本次新增日志只由隔离构建、定向生产夹具/编排回归以及独立进程临时应用日志验证；既有真实宿主停止/继续证据仍按原范围使用，不覆盖新增日志。完整命令和覆盖边界见本次 attempt 报告。共享功能清单、执行计划与本体由父任务在各并行交付验收后同步：最小增补是关键日志查找入口及“诊断无清理/容量授权”边界，不提升真实宿主或平台验收状态。
