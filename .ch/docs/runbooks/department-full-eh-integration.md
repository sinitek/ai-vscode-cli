# 产研部公开入口 Extension Host 组合验证

本验证目标是从隔离安装版 VS Code Extension Host 的真实 Webview 控件选择“产研部”并提交提示，验证生产根创建、Codex 总监/组长/员工执行、Loop+ `event_driven` 验收、汇报与容量归还。公开设置 `departmentEnabled` 通过工具设置启用，历史 Owner 场景另验证 Owner 回执。

最新限定混合新建验证见 [round-369](#opencode-组长的限定混合公开场景round-369)；以下各轮历史按各自 CLI、身份与源码范围保留。

## 普通 Loop+ 新建场景（2026-11-22）

从公开产研部入口验证两次派发、两组 Loop+ 员工执行与事件验收、会话持久化、容量归还及总监完成。新建场景使用 `--scenario loop-plus`，也是默认值。历史 Owner 专用场景使用对应历史构建。

```sh
node scripts/verify_department_full_eh_integration.js --scenario loop-plus \
  --product /absolute/path/to/isolated-built-extension --report /absolute/path/to/new-report.json
```

macOS 的真实 VS Code 1.144.0 和 Codex 以隔离 HOME 运行。本机确定性响应服务处理 19 个请求，两个组长均完成验收，最终占用为空，Owner 执行集合和绑定均为空，宿主正常退出。员工失败复核和显式停止续接另由 `departmentruntimeintegration.test.ts` 覆盖。

## 新建场景状态（round-350；续接最新结果见 round-366）

2026-11-15 的完整隔离公开入口场景 **passed**。实际证据为 `/tmp/round350-complete-public-eh.json`，对应本轮 attempt 报告 `round-350-department-leader-lifecycle-public-eh-repair.md`；后续运行须使用自己的当前 attempt 报告与 `--report` 指定的全新 JSON，不能沿用这个通过结论。

本次从空任务库启动，经真实工具设置 UI 开启 `departmentEnabled`、选择产研部并发送独特提示。真实 Codex 总监派发两个组长，各组长通过生产 Loop+ 派发一名员工、验收运行时生成的 `event_driven` 事件并汇报。统一根验收方案、总监完成汇报、两组完整 producer 集合和四个原 Owner 的精确 receipt 均已核对；每份 receipt 的八项必需清理事实均 confirmed。首次容量持久归还后第二个模块合法派发，最终容量的 leaders/employees 均为空；`forcedTeardown=false`，host 正常退出，15 次本机 Responses 请求无协议失败。

隔离构建目录为 `/tmp/round350-department-leader-build-aatkA6`，隔离运行目录为 `/tmp/s-dept-eh-7N4bVA`。平台为 macOS、Node v24.22.2、VS Code 1.144.0、Codex 0.167.2。使用已安装真实 EH、CLI、worker 和生产 parser，但 Responses 是仅监听 127.0.0.1 的确定性文本协议服务；通过不表示真实模型质量、业务代码验收、Windows/Linux/OpenCode 或 Git 合并后的全量回归通过。

本轮修复了两处独立启动生命周期问题：组长在首次状态投影前经既有 tracker 幂等取得编排所有权，生命周期结束后释放，避免异步准备窗口被孤儿检测判停；专属 Codex 执行保留稳定 local transcript key，将 native 准备/恢复交给专属 Owner 端口，不再被普通共享历史恢复提示阻塞。普通共享恢复校验、归属/停止/工作区/角色/配置复核和清理容量门禁继续生效。所有权本身不证明 drain 或容量可释放。

阶段 fixture 对初始空 scheduler 的 `completion allowed:yes` 仍先派发员工，只有实际员工执行与事件验收后才允许组长完成；员工身份以 `(leaderTaskId, subtaskId, attemptId)` 为范围，同名的 leader-local attempt 不能互相覆盖。未知阶段、重复身份、协议错误、超预算和超时继续失败。

原 Owner 在生产 client 验证清理完成后可以自然退出，事后 cold socket 的 `owner-unreachable` 不构成成功证据。EH 测试 fixture 因此被动记录原 `DepartmentExecutionOwnerClient.waitForCleanup` 的成功返回：保留同一个 Promise、参数、拒绝和生产流程，不授予权限、不释放资源、不重试，也不从磁盘 receipt 恢复成功。驱动读取这份测试观察记录，重新核对精确 binding identity、requirements、receipt schema 和全部必需事实；缺记录、记录失败或不匹配均失败，原 socket 查询仅作保守后备。`streams` 继续使用生产端口的物理 streams 与 executionDrain 组合事实，不能以 task completed、进程退出或 teardown 替代。

## 停止后继续的所有权回归（round-353）

round-350 的新建公开 EH 成功事实保留；它没有覆盖 `stop → continue`。本次没有重复该新建场景，而是对停止清理后的同任务续接增加确定性回归。`continueRoot` 在续接组长首次写入 running、恢复 producer 和启动 scheduler 之前，重新取得既有 `loopOrchestrationOwnership`，并将该份责任交给本代真实协调生命周期。释放捕获本代的回调，不从可变 member 读取后代的释放责任。同步启动拒绝会先取消并等待实际 idle/清理，再释放编排所有权；清理未知仍阻止容量释放。

总监在等待 `host.continueRoot` 前取得同一 tracker，将同一释放责任移交总监循环，避免 root 已投影 running 而协调者尚未启动的窗口。并发重复续接拒绝进入；等待期间停止、取消或归属变化时复核停止代次、工作区、固化路由及目标会话，迟到成功不能重启总监。拒绝或取消后的部分 running 恢复由原停止门禁收口，不能留下无协调者的 running root。

实体隔离构建 `/tmp/round353-continuation-build-nybsdysx` 的标准 `npm run build` 通过。定向 composition 11 项、随后追加的同步启动拒绝 1 项、continuation 5 项及受影响 orchestration/production composition/tree control 23 项通过，共 40 个不同用例；具体命令、源码 hash 和日志见 `round-353-department-continuation-ownership-repair.md` attempt 报告。本次 continuation 使用隔离 HOME 下的真实普通 Node Owner/受控 NDJSON CLI、生产 producer/仓储/配置租约/清理端口，非真实 Codex binary 或新的 EH 运行。成功用例先完成原代清理，核对 CLOSED 集合、持久容量归还和继续证明，再在续接准备及协调等待调用真实 `isLoopTaskRunOrphaned`；取消用例确认编排结束后 tracker 归零，但未绑定责任仍未知、容量保留且不能继续。

tracker 只说明真实协调仍活跃，不证明 native drain、receipt、继续证明或容量归还。round-350 的四原 Owner receipt 和后续合法派发证据仅属于其原新建场景；本次没有把它升级为 stop/continue 的公开 EH 或 OpenCode 组合证据。Windows/Linux、完整 OpenCode、Git 合并及合并后全量回归仍为独立门禁。

## 续接路由准备期间的撤销回归（round-357）

round-353 的所有权移交继续保留；本轮补的是更早的 `prepareRoutes` 等待窗口。续接在首个 await 前冻结 task/root/target 归属并登记同根唯一的宿主请求责任，等待结束后先核对该请求仍有效，再进入 ensure/recovery、running 恢复、producer 重开或补充需求提交。这个请求记录不建立执行 controller、不恢复执行权限，也不作为原生清理或容量证据。

`organizationControl.stop` 在 ensure 前撤销该根的待准备请求；即使没有 controller、恢复核验失败，旧请求也不能把这次停止当作新的基线。dispose 同样撤销全部待准备请求。拒绝与迟到 finally 只删除自己的请求记录，不能删除停止后明确发起的新请求；旧代错误收口也不能停止后代正在移交的协调者。真正恢复 running 前仍取得原 director ownership，并将同一释放责任移交真实循环，清理未知和旧代隔离门禁未放宽。

本轮物理隔离构建 `/tmp/round357-continuation-build-xgp7qe6b` 的标准 `npm run build` 通过。新增 8 个确定性路由门闩用例与受影响的既有 composition 12 个用例通过，共 20 个不同用例；具体命令、夹具修正前失败分类、分批有效范围和源码 hash 见当前 `round-357-department-continuation-route-cancellation-repair.md` attempt 报告。覆盖停止后旧请求拒绝、等待期间重复拒绝、迟到 finally 不清除合法后继、准备拒绝后显式重试、无 controller 且停止恢复核验失败、两种 dispose 边界以及工作区/路由/session 变化。旧 composition 在内存敏感性探针中无法拒绝已失效请求，新回归按预期失败。

这些用例是 VS Code mock、临时任务夹具和真实 composition/control 的定向回归，新增用例使用可控总监决策端口，不是公开 EH、真实 Codex/模型或新的 receipt/容量证明。round-353 未变的 5 项生产续接与 23 项回归按原范围复用；round-350 完整新建 EH、四原 Owner receipt 和容量归还事实仍按原范围保留。本轮没有重跑它们，也没有修改 extension.ts 的并发 OpenCode 映射；完整 OpenCode 组合、Git 合并和合并后全量回归仍是独立门禁。

## 公开群聊停止后继续（round-359，完整场景未通过）

独立场景复用原驱动、生产 EH fixture 和原 client 被动 receipt 观察器，通过 `--scenario stop-continue` 选择；省略该参数仍运行原新建场景。没有新增用户入口，也不调用内部 composition API。新阶段协议在真实员工请求到达后用有界本机 provider 门闩等待，经实际总监群聊的“中止”控件停止根，读取原代 CLOSED 集合、每个原 Owner 完整 receipt 与持久容量为空，再核对 1 秒内没有自动复活。随后用同一群聊的“继续执行”对话框提交明确需求，检查原 root/组长任务、本地会话、原生绑定与后继代次；后继中断事件必须按生产 parser 标为 failed 并明确派发带 `continueFromSubtaskId` 的后续员工，不伪造成功验收。

```sh
PLAYWRIGHT_MODULE=/absolute/path/to/playwright \
SINITEK_DEPARTMENT_FULL_EH_TIMEOUT_MS=90000 \
node scripts/verify_department_full_eh_integration.js \
  --scenario stop-continue \
  --product /absolute/path/to/physical-isolated-product \
  --report /absolute/path/to/new-stop-continue-report.json

node --test scripts/fixtures/department_continuation_eh_scenario.test.js
```

本轮标准隔离构建 `/tmp/round359-continuation-product-rj2d4jqz` 通过，源码 manifest 为 `/tmp/round359-source-hashes.json`。原 round-357 build 不能直接复用：准备期间并发 OpenCode 接线改变了 extension 和会话校验文件，因此复制当前源码重新构建，未修改这些生产文件。新协议共 6 个不同用例通过；未重跑 round-350 新建 EH、round-353 受控续接或 round-357 的 20 项 composition。

最终 JSON `/tmp/round359-public-stop-continue-eh-final.json` 的结果为 **failed / successorCleanup**。macOS arm64、Node v24.22.2、VS Code 1.144.0、真实 Codex 0.167.2；仅本机 127.0.0.1 Responses，共 11 请求、0 协议失败。从空库经工具设置、角色选择、一次根验收方案和公开发送创建根 `msg_1794711126819_3f30156ef87b6`。真实组长/员工启动后公开停止成功，原代两份八项 required/confirmed receipt、CLOSED 集合、持久容量归还和没有自动复活均已确认；公开继续在同宿主产生 generation 3，原 root、组长任务和组长 native thread 保持，实际完成中断事件复核、后继员工执行和真实事件验收。

后继员工 `text-protocol-continued` 的 Owner binding 为 native thread `01a1dd1e-93f2-7980-ba39-d596e44a83c7`，而生产子任务 `executionSession` 最终为原 thread `01a1dd1e-8840-76b3-b178-2ee61eee3b65`。预准备 reservation 明确为 unbound。`departmentproductioncleanup.ts` 的精确 session 对账因此不成立，日志记录 `leader-cleanup-selection-conflict`；generation 3 成员 blocked，leader 容量保留。四原 Owner 个体 receipt 虽均有完整事实，也不能替代整组身份一致性或允许归还容量。驱动保留此失败，没有放宽门禁、重写记录或强制释放。最小后续生产修复范围是 `departmentcodexpreparation.ts` 读取后续员工的固定 session 与 `loopPlusRuntimeAdapter.ts` 的 continuation 选择/完成后持久化之间的身份交接；不得删除 cleanup 对账。完整诊断见当前 attempt 报告和 `/tmp/round359-continuation-failure-analysis.json`。

首次报告 `/tmp/round359-public-stop-continue-eh.json` 保留同一缺陷导致的后继等待超时；补充只读即时诊断后使用新 JSON 重跑停止续接场景，未覆盖旧证据。两次 `forcedTeardown=false`、host exit 0，后续进程扫描未见含各隔离根路径的残留；这些只说明验证宿主收尾，不是整组 cleanup 通过。

未验证后继完整组织清理、后继容量归还后的合法再派发和总监最终汇报。未到达的最终 gate 仍要求完整 producer 集合、每个精确 Owner/资源 receipt、原 native thread 保持及第二模块实际观察容量复用，不能以 root/组长 completed 代替。该公开场景不证明精确 prepareRoutes 竞争窗口、冷恢复、OpenCode、跨平台或真实模型质量；Git 合并及合并后的全量回归仍独立。

## 续接原生会话交接修复（round-362，完整场景仍失败）

round-359 的双重身份失败保留为历史证据。本轮在 `departmentcodexpreparation` 复用 `resolveLoopSubtaskSession`，在首次原生准备前固定兼容来源及 session/CLI/config；准备、原响应持久化和最终 grant 的既有复核同时检查来源和当前子任务。兼容 `continueFromSubtaskId` 交给真实 `thread/resume`，目标已有冲突绑定则拒绝。任务 executionSession 的原生写入及读回仍先于 Store binding 和 grant。adapter 继续使用既有会话串行锁，等待后检查固定来源；Department Codex 的后写只核对已建立绑定，不再从普通 target 覆盖它。写回冲突保留占用，取消继续走原清理合同；普通 Loop+ 和 OpenCode 分支不变。

物理隔离产品 `/tmp/round362-product-ok3qhyoc` 的标准 `npm run build` 通过，794 个源码文件的 SHA-256 清单为 `/tmp/round362-source-hashes.json`，源码/脚本对应关系见 `/tmp/round362-snapshot-audit.json`。本轮六个新 preparation 回归在旧实现上失败，修复后 preparation 38/38、adapter 写回/停止边界 9/9、普通 repair/follow-up 恢复 4/4 通过。原协议 fixture 未改，六项协议结果复用。并行 OpenCode 容量测试及其 fixture 后续变化未纳入此构建；本轮生产源码和四个协议/驱动脚本与产品匹配。

仅重跑既有 `--scenario stop-continue`，唯一报告 `/tmp/round362-public-stop-continue-eh.json`，日志 `/tmp/round362-public-stop-continue-eh.log`；参数沿用上节，`--product` 指向本轮产品，`--report` 指向全新路径。平台 macOS arm64、Node v24.22.2、VS Code 1.144.0、Codex 0.167.2，使用临时 HOME/USERPROFILE/CODEX_HOME、空任务库及仅监听 127.0.0.1 的免费确定性 Responses。11 个请求，无协议错误；公开设置、发送、停止、原代清理、无自动复活和同宿主继续均到达。root=`msg_1794712234630_a63394121ce298`，leader=`msg_1794712235307_97442afdded718`。

后继 generation 3 员工与原 generation 1 员工均绑定原 thread `01a1dd2f-70b1-78c0-b221-1ed59133865f`；组长两代均绑定 `01a1dd2f-6eca-7680-822f-e10d2992b31b`，后继 Owner 与原 Owner 不同。原 client 的四份 receipt 均经精确身份及八项必需事实核验，两代集合均 CLOSED，持久 leaders/employees 容量均为空；没有再出现 `leader-cleanup-selection-conflict`。这些分项不等于完整组织验收通过。

本次完整结果 **failed**，阶段 `successorCompletion`，90 秒超时。组长 scheduler 已 completed，后继员工实际事件验收为 passed，组长已汇报；但 `departmentorchestration.ts` 的 `completed(task)`（本快照第 615 行）要求每个 subtask 的最新 acceptance 全部 passed，仍包含原中断来源的 failed。`track` 因此将组织成员标为 failed；当前 fixture 按生产 organizationStatus 等待，不会据 task completed 擅自派发第二模块。只读诊断 `/tmp/round362-continuation-failure-analysis.json` 保留精确身份、全部原 receipt、CLOSED 集合、容量与这项完成合同不一致。后续需单独确定已接受后继如何结算被替代来源，不能删除精确清理门禁或把个体 receipt 当作组织完成。

总监最终完成汇报、容量归还后的合法再派发和完整场景成功门禁未到达；不声称通过。`forcedTeardown=false`、host exit 0，运行目录进程扫描为零；这只是宿主收尾，原生 drain 依据原 client receipt，超时仍为失败。没有修改 `departmentproductioncleanup`、组织完成判定或其它并行生产文件。冷恢复、OpenCode、Windows/Linux、真实模型质量、Git 合并和合并后全量回归继续独立开放。本次是既有固定会话合同的缺陷修复，中央 ontology/功能清单无需新增业务语义；新诊断事实由中央文档所有者按本报告同步。

## 历史诊断与组件证据（截至 round-347）

以下失败描述保留为历史事实，已由上述 round-350 新运行关闭；各组件证据仍只适用于其原身份与范围。

本仓库现有 `scripts/verify_department_codex_owner_host.js` 从已准备的任务和可信 `runPromptOverride` callback 开始；它能检查指定员工绑定与独立 worker 存活，但脚本自身声明不覆盖 UI，也不证明完整 receipt。`scripts/verify_department_group_cleanup_host.js` 只检查 composition observer 的保守拒绝路径，结果明确 `capacityReleased: false`。这些脚本不是本 runbook 目标的通过证据。

`scripts/verify_department_full_eh_integration.js` 是新增的公开入口驱动：必须传入实体隔离且已构建的扩展目录和一个不存在的 JSON 报告路径。它在临时 HOME/CODEX_HOME、空任务库、隔离 VS Code user-data 和 workspace 下启动 Extension Host；连接 127.0.0.1 的 Responses fixture；通过真实 Webview mode selector、prompt input 和 send button 操作公开入口。fixture 对未匹配阶段和超预算请求失败。阶段响应由 `scripts/fixtures/department_full_eh_scenario.js` 提供，按生产提示中的真实任务、当前事件、attempt 和协调上下文选择；不再读取任意子串映射 JSON。未知阶段、身份变化、未登记事件或超预算请求立即失败。该 fixture 是确定性协议服务，不是真实模型或独立代码审查。驱动不会把 root/task 文件出现升级成 receipt 或容量归还。

本机 Responses fixture `scripts/fixtures/codex_local_responses_server.js` 默认对每个请求返回相同的静态最终答复，无法驱动总监派发、组长事件批次验收、员工结果和总监完成决策。它现支持可选的阶段脚本回调及 `maxRequests`：未知/不匹配的请求、空答复和超预算请求返回失败，`assertHealthy()` 可让调用者将 fixture 错误升级为验证失败。其专属协议测试只证明本机 HTTP/SSE fixture 的确定行为，不代表真实部门 parser 或 Extension Host 组合已通过。

实际公开发送链路在 Webview `interactiveModeSelect` / `promptInput` / `sendPrompt` 控件，经 `sendPrompt` 消息和 `handleSendPromptMessage` 检查公开开关后进入 `startDepartmentPrompt`。`scripts/verify_department_conversation_host.js` 已包含 VS Code Chromium/CDP Webview 驱动技术，但它使用预置部门任务验证会话标签和群聊 UI；它不能作为本目标的运行数据，也不能证明公开入口创建根、真实 worker 执行或完整 Owner receipt。完整公开入口场景使用下述独立 harness；是否通过只以本次唯一运行 JSON 的实际阶段为准。

清理证据必须按身份与场景区分。`scripts/verify_department_group_cleanup_host.js` 的 `capacityReleased: false` 来自不支持/未知观察路径，证明该拒绝路径保留占用，不证明受支持的新建 Codex 组无法释放容量；`scripts/verify_department_codex_owner_host.js` 的 `completeReceipt: false` 来自冷身份/资源能力不完整的隔离场景，也不是正常生产新建身份的失败证据。round-234 的 `departmentproductioncleanupperformance.test.ts` 对有效生产 binding、真实 producer、配置租约及受控原生消费者运行了正向清理观察：消费者放行后原 `producer.close` 返回成功，观察责任完成；它证明受支持身份在该受控生产组件组合内可清理，但不证明公开 UI、真实 Extension Host、新建部门根或完整组织容量归还已通过。

因此完整场景仍需独立 harness 实际验证，而不能由这些负例判定必然失败，也不能把 round-234 的组件级成功提升为 EH 通过。这些旧组件检查没有修改生产入口、Owner、清理门禁或容量实现。

round-335 再次核对了真实生产路径：公开发送由 Webview `sendPrompt` 消息进入 `handleSendPromptMessage`，根任务经 `prepareDepartmentInvocation` 与 `getDepartmentRuntimeComposition().startDepartmentPrompt` 创建；组长容量只在 `departmentorchestration` 收到真实清理 observation 并成功持久化释放后归还。生产 wiring 在 `src/extension.ts` 将 observation 委托给 `groupCleanup.observe(task, generation)`。该端口返回 `null` 时 orchestration 会保留成员为 blocked 并保留 lease；不得以启动完成、Owner 退出或测试 fixture 的回调替代 observation。

round-338 的真实公开入口执行（macOS，VS Code 1.144.0，Node v24.22.2，Codex CLI v0.167.2）确认隔离设置、空任务库、Extension Host、Webview 的 `department` 选择、角色 profile 和验收方案确认均通过。公开确认后扩展向 Webview 报告“总监独立会话创建失败”；任务库仅出现 `.department-source.json` / `.department-owner.json` 元数据，没有 root/task，Responses 请求数为 0。因此阻断发生在原生模型执行之前，组长派发、Owner receipt、自然 drain 和容量归还均未验证。代码路径在 `src/extensionHost/departmentruntimecomposition.ts` 创建根之前调用 `createRoot`；生产实现 `src/extension.ts` 的 `createRoot` 先执行 `ensureLocalSession(target.cli, target.tabId)`，随后要求 `resolveLoopTaskSessionId(target)` 返回 session ID，缺失时抛出该错误。

round-343 修复了这个创建顺序：根/组长 target 在执行输入进入普通 session draft 前创建，不能依赖默认只处理非空 draft 的 `ensureLocalSession`。部门创建边界显式请求现有 session lifecycle 为指定 tab 分配并持久化 local session key；它是 UI/任务的稳定本地 key，不是 Codex thread。真实 native thread 仍必须由后续 Codex Owner 的原始 `thread/start` 响应创建并走独立持久绑定。并发任务对 `extension.ts` 另有未提交修改，本次只触碰 `createRoot` 和 `createLeaderTarget` 的 session 调用点。

EH driver 现在从默认关闭的工具设置开始，通过真实 Webview `#toolSettingsButton` 与 `#departmentEnabled` 控件开启部门模式，等待 `.sinitek_cli/settings.json` 持久化后再选 department 并提交提示。驱动在 root/task 文件出现后会继续等生产 task 状态变化并记录运行时 task 快照；Responses 缺少明确阶段映射、协议失败、task 未完成或缺少 receipt/capacity 证据都会导致失败。task `completed` 不能替代 Owner receipt、execution drain 或容量归还。该轮尚未提供阶段映射和 Owner reader；后续交付及其实际到达范围见 round-347 记录。

round-343 真实 EH 诊断（macOS，VS Code 1.144.0，Node v24.22.2；隔离构建 `/tmp/department-public-entry-build-YA9xNv`）报告为 `/tmp/round343-department-public-entry-eh-final2.json`。公开工具设置确认从关闭状态经 UI 保存为开启；真实 Webview 选择 department、角色 profile、验收方案并发送唯一 prompt；从空库观察到 runtime root ID `msg_1794695708542_a352aa84d4c72`，根 session key 为 lifecycle 创建的 `local_1794695567033_54f87d8f536cb`。随后生产 director execution 失败，task 状态进入 `needs-review`，面板显示“部门执行归属无效，拒绝启动。”；本地 Responses 请求为 0。`src/extension.ts` 当前 `prepareDepartmentInvocation` 的身份/状态 fail-closed gate 在约第 4036 行拒绝执行。这个生产派发归属门禁由并行任务维护，本轮未修改。

因此 root/session-lifecycle 缺陷已消除，但真实 Codex turn 尚未启动；组长/员工派发、event-driven 验收、汇报、Owner receipt、自然 drain 与容量归还均未验证。对后续重跑，需先修复生产 `prepareDepartmentInvocation` 对真实新建 root 的归属/状态复核，再使用本报告之后的全新隔离构建和报告路径。不要通过预置 root、伪造 native thread、阶段猜答或放宽门禁绕过该失败。

本轮没有完成公开入口到完整 receipt/容量再派发的 Extension Host 场景。已有的 round-234 正向组件验证和 round-333 负例范围按原适用性保留；它们都没有捕获公开 `sendPrompt` 生成的 root/attempt/event 身份，也没有证明完整组织 receipt 后的真实容量再派发。新增驱动只报告其实际达到的阶段，不应将局部 UI/fixture 检查解释为完整通过。

## 本轮实现与证据边界（round-347）

总监的旧失败已定位为生命周期问题。`prepareDepartmentInvocation` 的条件没有放宽；分项诊断的真实 EH 报告确认拒绝时 task 已被标为 `stopped`。部门 composition 的总监循环此前不在 `collectRunningLoopTaskIds` 使用的编排所有权中，异步准备/协调等待期间会被孤儿检测判停。现在生产 composition 在启动总监循环前取得原 `loopOrchestrationOwnership`，直到该循环及其错误收尾结束才释放；工作区、角色、配置 revision、目标 session 和 running 状态复核照旧。所有权仅代表活跃编排，不能作为原生清理事实。

round-347 的只读核验从运行时实际生成的根和任务库读取 `DepartmentRuntimeStore`，枚举完整 execution set 与所有 binding，向每个 binding 的原 `ownerId` 对应 socket 发 `observe`。必须匹配精确 identity 和 requirements，且原 Owner 返回 `cleaned`、全部必需 cleanup facts confirmed。`streams` 沿用生产 launcher 将物理 streams 与 executionDrain 合并的合同；本 harness 不用 host 退出或空 Map 补造 drain。还要求所有 producer set closed、closure 存在、全部责任有唯一 binding、成员 completed 以及持久容量为空，才能返回完整证据。第二个模块的合法模型派发必须在首次完整证据之后，最终还要核对真实组长事件和统一根验收方案。只读核验不释放容量、不写 receipt、不重发执行。

实体隔离标准构建通过；新增 composition 生命周期及实际受影响的 fixture/runtime integration 共 44/44，通过的范围包括活跃等待、停止后不复活、失效工作区和元数据拒绝。阶段 fixture 定向测试 6/6。旧 Responses fixture 未改，原默认协议 3/3 继续复用。关联旧 production composition 套件在本轮隔离快照中为 3/17：多个 harness 共用持久 taskSource 与固定 director-session，首例后触发目标会话唯一性拒绝；完整日志为 `/tmp/round347-productioncomposition-regression.log`。并行夹具迁移后续又修改了 session 隔离，不能把这组旧快照失败说成已验证的新修订结果，也不能将该套件计入通过。旧受控组件正向清理和负向拒绝证据仍按其原身份范围使用，不提升为完整 EH 通过。

round-347 的完整运行报告为 `/tmp/round347-department-public-entry-eh-built-current.json`（root `msg_1794698695939_a7656c37313388`，leader `msg_1794698696430_4888206eaf51`，具体事实以此 JSON 为准）。隔离安装版 VS Code 的工具设置 UI、模式选择、验收方案确认、公开 sendPrompt、从空库创建根以及真实 Codex 总监派发已到达。本轮随后发现组长在原生请求之前进入 `stopped`：producer set 仍 open，尚无 binding，组长 lease 保留；完整 EH 结果是 **failed**。`loopPlusRuntimeAdapter.runEventDriven → loopPlusOrchestration.createParent → appendHostMessage` 与扩展的 running/orphan 检测是后续需核对的生命周期边界；当前证据没有记录 setter 调用栈，不能把静态可疑路径写成已证实的停止调用者。员工执行、event-driven 验收、总监完成汇报、原 Owner 完整 receipt、自然消费者 drain 和容量再派发仍未在 EH 验证。host 正常退出与 forcedTeardown=false 仅是验证宿主收尾事实。

平台为 macOS、Node v24.22.2、VS Code 1.144.0、Codex 0.167.2。本机服务回答协议数据，不验证真实模型质量或业务代码交付；Windows/Linux 未执行。生产门禁没有因此放宽。

### 当前公开入口驱动

使用前需先将当前源码复制到物理隔离目录并在该目录运行标准 `npm run build`；禁止传入仓库共享 `dist`。内置阶段协议覆盖任务摘要、总监派发/等待/汇报、组长派发/当前事件验收/汇报和员工答复，来源为 `loopOrchestration.ts`、`loopPlusPromptBuilders.ts` 及 `loopPlusScheduler.ts`。只使用最新 native user message，避免把历史答复中的示例当作新请求：

```sh
PLAYWRIGHT_MODULE=/absolute/path/to/playwright \
node scripts/verify_department_full_eh_integration.js \
  --product /absolute/path/to/isolated-built-product \
  --report /absolute/path/to/new-department-full-eh-report.json
```

运行器拒绝重用已有报告文件、共享/符号链接 `dist`、未知 Responses 请求及超预算请求。它会记录每个阶段状态、isolated roots、fixture request/failure 数以及强制 teardown 标志。缺少 root、Owner receipt、自然 drain 或容量归还证据时，结果必须为 `failed`；强制回收不会被解释为清理成功。当前 fixture 不是模型，只监听 127.0.0.1，也不读取用户凭据或用户会话。

## 完整 harness 的验收条件

- 用物理隔离的源码构建加载 extension 与 fixture，不读取或写入仓库共享 `dist`。
- 临时 `HOME`、`USERPROFILE`、`CODEX_HOME`、VS Code user-data、extensions、workspace 和部门任务库各自位于本轮临时目录；不读用户 Codex 凭据、会话、日志或业务数据。
- 只连接 `127.0.0.1` 上的本机 Responses provider；Codex CLI binary 使用隔离 HOME 下的 provider 配置，测试不得访问外部模型服务。
- 通过真实 UI 操作选择 department 并发送独特提示；验证设置关闭时公开 UI/发送门禁拒绝启动，启用时从空任务库创建一个真实 root ID。
- 按生产提示和 parser 协议响应每一个真实请求，分别验证组长派发、`event_driven` acceptance event、员工 identity/attempt 归属、统一 root acceptance plan 和 director 汇报。捕获运行时创建的 root、task、attempt、event 与 Owner identity，不预设这些 ID。
- 对每一个原生 Owner 等待最终 receipt；检查完整必需 cleanup facts，不能将 business settled、EH 退出、进程 close 或测试 teardown 当作 drain。
- 确认 production group capacity 的 lease 确实归还，且下一项合法调度观察到空余容量。任何 `null`/`unknown`、缺失 receipt、fixture 未知请求、请求预算溢出、超时或强制回收均使场景失败。
- 所有 child 与 EH 自然退出后才记录通过；强制 teardown 只负责回收本轮持有的进程，不生成清理事实。

## 已运行的局部检查

```sh
node --check scripts/fixtures/codex_local_responses_server.js
node --experimental-strip-types --test src/test/extensionhost/fixtures/departmentlocalresponses.test.ts
```

本机环境为 macOS、Node v24.22.2、Codex CLI v0.167.2。上述只检查 Responses fixture 协议和旧默认响应兼容性，不启动 VS Code、不启动 Codex binary、不创建部门 root，也不证明本 runbook 的完整验收条件。这些局部检查本身不能宣布组合成功；完整场景的新证据见上方 round-350 当前状态。每次执行报告须记录隔离构建来源、VS Code/Codex 版本、唯一运行 JSON 报告路径、全部 worker/Owner 结果及自然资源释放事实；若有任何条件未满足，结论必须保持失败或未验证。

## 公开停止续接的修复交付结算与新阻断（round-364）

round-362 的历史报告 `/tmp/round362-public-stop-continue-eh.json` 与其局部成功范围保留。本轮新增宿主 `repairSource`，由当前已成功提交的 failed review 精确关联新派发任务，不从 `continueFromSubtaskId` 推断需求已修复。组织完成读取源当前 attempt/event 和全部后继最新 reviewed/completed/passed，保留原 failed/stopped；无关失败、错身份、缺关系、重复/循环、源新失败、未审/停止后继及任何开放工作门禁均拒绝。完整合同见 [产研部设计](../design-docs/department-mode.md#停止后显式修复的组织完成结算round-364)。交付结算不是清理或容量授权。

本轮物理产品 `/tmp/round364-product-xkn82r6d` 标准 `npm run build` 通过，源码与脚本共 861 文件的 SHA-256 清单为 `/tmp/round364-source-hashes-final.json`，构建/运行时核对未发现源文件差异。64 个不同定向用例通过：完成判断 24、宿主关系提交/保存/读回/无效验收/普通同子任务重试 8、受影响决策策略 28、真实 host/adapter 组织完成 3、记录规范化 1。具体具名命令与初期失败分类见本轮 attempt 报告。未变化的 round-362 会话/绑定 51 项、6 项协议、20 项路由撤销及 round-350 新建 EH 直接复用，不重复执行。

本轮仅运行公开 `--scenario stop-continue`，使用真实安装版 VS Code 1.144.0、Codex 0.167.2、Node v24.22.2/macOS，隔离 HOME/USERPROFILE/CODEX_HOME、workspace、VS Code 数据及空任务库，免费确定性 Responses 仅监听 127.0.0.1：

```sh
PLAYWRIGHT_MODULE=/tmp/round343-playwright/node_modules/playwright \
SINITEK_DEPARTMENT_FULL_EH_TIMEOUT_MS=90000 \
node scripts/verify_department_full_eh_integration.js \
  --scenario stop-continue \
  --product /tmp/round364-product-xkn82r6d \
  --report /tmp/round364-public-stop-continue-eh.json
```

该运行 **failed**（exit 1，`activePhase=successorCompletion`），不能宣称公开 stop→continue 全场景通过。新 JSON、日志 `/tmp/round364-public-stop-continue-eh.log` 及只读派生诊断 `/tmp/round364-continuation-failure-analysis.json` 属于本轮，不覆盖先前证据。

实际到达：真实设置 UI、公开发送、根创建、组长/员工执行、公开停止、原代完整清理、无自动复活、公开继续、同根/组长/员工原生 thread 恢复、后继事件验收及组长最终汇报。root 为 `msg_1794714189610_f03d28bf397038`，组长为 `msg_1794714190147_49668d01aca138`。原 `text-protocol/lp1-text-protocol` 保持 stopped/failed，`text-protocol-continued/lp2-text-protocol-continued` 保存精确原 source/attempt/finish event，最新 reviewed/completed/passed。生产组织 member 已是 completed，原阻断“历史失败导致成员 failed”消除。

只读原 client 审计确认四个原 Owner（两代组长和员工）各自八项 required facts 均 confirmed，完整集合 CLOSED 且有 closure，`cleanupEvidence.complete=true`，持久 leaders/employees 容量均为空。同角色两代原生 thread 相同而 Owner/executionId 不同；员工 thread `01a1dd4d-43f4-7db2-846d-77b853d230a5`，组长 thread `01a1dd4d-4292-72f2-ac14-e6a83d6b4870`。这些事实来自完整生产 binding/selection/requirements 与原 client 结果，不是从个体磁盘 receipt、退出或空集合推断。

新阻断：root 仍 running；11 次 Responses 请求无协议失败，但公开继续后只有组长/员工请求，最后是 leader-report，没有后续总监请求、总监完成汇报或合法下一模块实际执行。静态来源指向 `departmentruntimecomposition.ts` 的 `launchDirector/directorLoop` 与完成唤醒：新建 `handleDirectorDecision` 为 `startLeader(...).done` 挂汇报/wake，`departmentorchestration.continueRoot` 则重新 `track`，没有建立对应后继完成通知。现有证据定位了缺失端口和观察停滞，尚未用确定性控制器门闩证明唯一根因；本轮未修改该生命周期或放宽 harness/清理断言。下一任务应先证明续接总监 launch/wake 的实际控制器生命周期，再复验 stop-continue，不能以新建场景替代。

`forcedTeardown=false`、host exit 0；单独只读进程扫描 `/tmp/round364-process-audit.json` 为零残留，仅说明宿主收尾，不代替 receipt。最初派生审计的进程列表包含执行该审计的 shell 命令自身（同命令文本含隔离根），后续独立扫描消除该观察污染；原运行报告未修改。

本轮没有读取用户凭据/会话、调用外部模型或改变 UI。总监最终汇报、实际合法再派发仍未验证；冷恢复、真实 OpenCode 完整 EH、Windows/Linux、真实模型质量、Git 同步合理合并及合并后全量回归继续独立开放。所有 `/tmp` 证据需按主任务保留策略归档，后续使用当前 attempt 与唯一 `--report` JSON。


## 公开停止续接完整收口（round-366）

round-364 的 failed/successorCompletion 与四原 Owner 局部成功历史保持不变。本轮先在实际 composition/controller 上用门闩复现两个独立缺口：后继组长 `track` 不通知总监，以及旧 run 的 finally 尚未清除 `c.run` 时继续不能启动新循环。修复统一各代结算通知，并将 director run 定义为包含错误收尾/ownership release 的完整生命周期，显式继续等待旧代完成后再复核并移交。模型返回固定 stopRevision；旧代迟到结果不影响新代；调用期间 wake revision 不丢失。清理未知仍 blocked 且保留容量，通知不是 receipt。合同见[设计规格](../design-docs/department-mode.md#续接组长结算与总监循环交接round-366)。

本轮物理产品为 `/tmp/round366-product-f8pr6y72`，src/dist 均为实体副本，仅 node_modules 引用现有依赖。标准 `npm run build` 通过，28 个 composition 用例与 5 个直接受影响的组织 host/adapter 用例通过。`/tmp/round366-source-hashes-final.json` 保存 848 个源码/脚本文件的构建快照；本轮修改的三个 TS 文件及 Codex EH 驱动/协议均匹配验证快照。构建后并行 OpenCode 目录参数校验、专用脚本及其测试发生变化，未覆盖那些新修订；不覆写并行成果，也不将本轮 Codex 结果提升为最新 OpenCode 验证。完整命令、差异清单和检查范围见本轮 attempt 报告。

首次本轮复验 `/tmp/round366-public-stop-continue-eh.json` 因新增的等待后身份复核过严而 failed/publicStop：总监首次本地 transcript 占位 session 合法迁移成原生 thread，被误判变化后暂停。该失败报告不覆盖。本轮修正并补三项回归：仅首次可信绑定由返回任务、持久任务、真实 tab 一致确认才接受；已绑定变化与读回冲突仍拒绝。最后标准构建与全部 28 项 composition 用例在修正后执行。

唯一最终完整报告 `/tmp/round366-public-stop-continue-eh-final.json` 为 **passed / exit 0**：

```sh
PLAYWRIGHT_MODULE=/tmp/round343-playwright/node_modules/playwright \
SINITEK_DEPARTMENT_FULL_EH_TIMEOUT_MS=90000 \
node scripts/verify_department_full_eh_integration.js \
  --scenario stop-continue \
  --product /tmp/round366-product-f8pr6y72 \
  --report /tmp/round366-public-stop-continue-eh-final.json
```

真实安装版 VS Code 1.144.0、Codex 0.167.2、Node v24.22.2/macOS arm64，从隔离空任务库经工具设置 UI 开启、公开模式/角色/方案选择与发送；在真实组长/员工执行期间公开停止，完整原代清理并无自动复活，再公开继续。18 次免费本机 Responses 请求、零协议失败，后继事件验收和组长汇报后出现 `director-capacity-reuse`（第 12 次）、下一模块真实员工执行（第 15 次）、最终 `director-report`（第 18 次）。root `msg_1794716096362_08492c385723c` completed；原组长 `msg_1794716097017_b603be09f8a3f8` 和后续组长 `msg_1794716101444_13235382540458` 都完成真实 Loop+ 门禁与统一根方案。原 stopped/failed 保留，后继精确 repairSource 与通过验收结算不变。

六个原 Owner（原模块组长/员工各两代，加新模块组长/员工）均由原 client 返回完整 required receipt，三个执行集合 CLOSED 且 closure 完整，最终持久 leaders/employees 容量为空。原组长 thread `01a1dd6a-5b67-74f3-8e2c-ef6ca3d06b1b`、员工 thread `01a1dd6a-5cc9-7e31-b4c9-1ca1e3c48581` 在后继保持，Owner/executionId 不同；容量返回完整证据先于下一次合法派发与执行。只读核验 `/tmp/round366-evidence-audit.json` 逐一关联全部 binding/selection/requirements、原 client 返回、receipt、任务终态和再派发顺序；不写运行状态或生成清理权限。host exit 0、`forcedTeardown=false`、独立 `/tmp/round366-process-audit.json` 零残留仅为自然宿主收尾旁证，不替代清理凭证。

未读取用户凭据、用户会话或真实业务数据，不调用外部/收费模型；仅本机确定性 provider 回答生产 parser 协议。未重跑 round-350 新建场景，未改会话交接、repairSource、OpenCode 执行或 cleanup 门禁。此结果关闭本平台既定公开 stop-continue 场景，不证明精确路由竞争窗口、冷恢复、真实 OpenCode 完整 EH、其它平台或真实模型质量。Git 同步合理合并、合并后全量回归仍独立开放；临时证据需按主任务保留策略归档，后续运行使用当前 attempt 与新 `--report` 路径。

## OpenCode 组长的限定混合公开场景（round-369）

新增 `--leader-cli opencode` 仅启用 **Codex 总监 → OpenCode 组长 → Codex 员工**的新建组合。默认仍为 Codex 新建，既有 `--scenario stop-continue` 仍仅接受 Codex；未知 CLI、参数、重复/缺值参数及未支持的续接组合均拒绝。此轮复用 round-366 的标准构建/33 项与完整 Codex 公开续接、六原 Owner 审计，不重跑该场景。OpenCode 员工、全 OpenCode、跨代续接和冷恢复没有因此通过。

此前已接受的 `/tmp/round366-opencode-native-report-01.json` 是 OpenCode **1.19.5** 的受控 tab/native-drain 证据：同一个 Owner `c4259933-7732-40a7-920c-ae49b3734d47`、session `ses_e2297e34bffe9UWS3eMlSdmOWp` 双轮真实执行自然 close/drain，原 client 完整 receipt 与 stopped 双确认成立。准备和两轮任务都使用唯一 canonical 隔离根 `/private/tmp/round366-opencode-native-product-01/tmp/sinitek-loop-subtask-QMwdiq`，原生 session 的真实 directory 相同。生产 leader host 先登记 Ledger，再创建并保留该代唯一 root，将准备/执行 cwd 固定为真实路径；准备的 GET session directory 必须匹配，首次持久绑定及逐轮原生输出只读核验不变。worker 只持原 host root capability，封闭后通过同代 release-root 消费原能力，原宿主核验/清理后才确认；receipt/stopped 不能由磁盘 cleaned 补造。跨代旧 session directory 与新根不匹配仍拒绝，没有开放冷恢复。该旧受控证据本身不证明 EH/整组容量；以下混合场景独立补这一缺口。

本轮实体产品 `/tmp/round369-product-jvd4r87c` 的 src/scripts/media/docs 与 dist 均为物理副本，仅 node_modules 链接现有依赖；标准 `npm run build` 通过。新增/受影响共 **23 个不同用例**通过（参数/证据 4、场景 10、可选 provider 3、原 native provider 兼容 3、EH fixture 3）。测试 fixture 被动观察原 client 成功返回及真实 worker IPC，保持原 fork/send、Promise、回调和拒绝，不改清理器或生产入口。OpenCode provider 新增可选 `respond`，默认 native-drain 合同及既有调用测试保留；只监听 127.0.0.1，模型固定且请求有界，未知阶段/标题身份、空响应、错误事件和超预算均失败。

首次 `/tmp/round369-mixed-public-eh.json` **failed/leaderExecution**：公开角色选择了默认模型，持久路由 `model:null` 与实际准备的 `isolated/native-drain` 在 `extension.ts/runDepartmentLeaderPrompt` 的精确模型复核处不一致，且 leader host 本身要求显式 selection.model。组长 needs-review、OpenCode 请求 0、无 binding，容量保留；不是模型/provider 故障。本轮未竞争修改生产默认模型映射，也不放宽门禁。混合驱动改用公开模型控件明确选择 `isolated/native-drain`；Codex 默认选择保持原行为。默认 OpenCode 组长模型选项的接线限制交主任务评审。

唯一最终报告 `/tmp/round369-mixed-public-eh-explicit-model.json` **passed/exit 0**：

```sh
PLAYWRIGHT_MODULE=/tmp/round343-playwright/node_modules/playwright \
SINITEK_DEPARTMENT_FULL_EH_TIMEOUT_MS=90000 \
node scripts/verify_department_full_eh_integration.js \
  --leader-cli opencode \
  --product /tmp/round369-product-jvd4r87c \
  --report /tmp/round369-mixed-public-eh-explicit-model.json
```

平台 macOS arm64、Node v24.22.2、VS Code 1.144.0、Codex 0.167.2、OpenCode 1.19.5。临时 HOME/USERPROFILE/CODEX_HOME、XDG/config/data/cache/state、CLI 配置、VS Code 数据、工作区及任务库均隔离；白名单环境去掉用户凭据，非 loopback proxy 指向关闭端口，仅配置两个免费本机 provider，不安装或升级依赖。通过真实工具设置开启 departmentEnabled、角色 CLI/profile/明确模型、统一根方案和发送控件从空库创建 root `msg_1794718284570_a3c736341894`。两组长 `msg_1794718285189_59edeceb425b58`、`msg_1794718290432_1da4e24f9caf28` 各在同原 Owner/session 下完成 dispatch/accept/report 三轮，员工为真实 Codex `text-protocol/lp1-text-protocol`，事件 ID 来自当前持久 scheduler。9 次 Responses 与 8 次 Chat Completions（含 2 次单独识别/有界标题），均无协议失败；没有内部 composition 调用或预置任务。

| 模块/角色 | 原 Owner | 原生 session | 完整 receipt |
| --- | --- | --- | --- |
| 1 / OpenCode 组长 | `725c676a-2626-48cd-a5f3-9950dc0b1a62` | `ses_e22743eddffeC8TSGOt71g3d6s` | `9394cf9a-8d0d-409c-9d31-2f771c996f66` |
| 1 / Codex 员工 | `238b95ef-a5cc-4073-87bc-864a0c4a4a3f` | `01a1dd8b-c87b-76f0-83c9-0b74e6ed0e94` | `41170a48-31e2-4643-baed-b128422f7792` |
| 2 / OpenCode 组长 | `e690784d-3951-41bd-b83f-cca74390b254` | `ses_e22742be1ffeoY5LBNqv4gbGar` | `2996f8cb-b7a8-437b-b7d4-199cae41de90` |
| 2 / Codex 员工 | `f0043c49-4dbf-4fe5-80cd-f2ed10ca2d7b` | `01a1dd8b-d9bc-7a01-8b30-62e4c0ff40d5` | `10fbaf0f-611e-443e-8ff0-840ab469b6bb` |

四份 receipt 按各自原 required 策略核对：OpenCode process turnTerminal 为 not-applicable，其余 required confirmed；Codex 八项 required confirmed。两个完整集合 CLOSED 且 closure/scope/selection/binding 一致，原 client 记录逐项匹配，OpenCode 的 grant/settled、一次 seal/shutdown/stopped 和 worker 自然 close 均有原 IPC；Codex 原生绑定/grant/terminal/resources-released 也逐项可检索。首模块持久租约移除与容量归还完整观察先于合法第二模块派发及实际员工执行，最终 root/组长 completed、统一方案、总监最终汇报和持久容量为空。只读派生 `/tmp/round369-evidence-audit.json` 再核对全部原身份、三轮 grant ACK/真实 drain、receipt 和执行顺序。host exit 0、`forcedTeardown=false`、`/tmp/round369-process-audit.json` 零残留仅作卫生旁证，未替代 receipt/drain。

源码清单 `/tmp/round369-source-hashes-final.json` 保存 868 个源/脚本 hash；`/tmp/round369-source-correspondence.json` 保存 dist hash 与运行后核对，864 匹配，4 个并发差异均为未执行的 OpenCode 员工准备/worker 文件及其测试，未由本轮修改。实际 Codex 员工、OpenCode 组长闭包、两份 TS fixture/test 和最终驱动/协议匹配产品快照；不声称那些并发新修订已构建或被此运行验证。首次失败使用同一产品 TS，最终仅更新 JS 的公开明确模型选择和对应参数测试，没有失效已完成的 TS build/fixture 或未改 provider/场景测试。

本轮未改产品 UI 外观、生产代码、cleanup、OpenCode 员工/private 或共享停止器。round-350/362/364/366 历史证据均保留。仍开放 OpenCode 员工及全部角色组合、默认模型接线限制、跨代/冷恢复、必要平台、未覆盖来源租约、真实模型质量，以及全部实现测完后的 Git 同步合理合并与合并后全量回归；active 计划保持 in_progress。后续运行用当前 attempt 与全新 `--report`，临时证据需按主任务策略归档。


## OpenCode 默认模型公开路径修复（round-372）

持久偏好及面板的 `model:null` 继续表示所选 CLI 档案的默认；仅新根可信宿主解析将三角色 OpenCode 默认固化为同 CLI/configId 的具体有效模型，显式模型及 Codex 默认不变。候选按确切档案校验模型、变体和力度，并以不含配置正文的读取修订标记核对两次读取；每次 OpenCode 档案读取前后核对共享选择修订，等待后复核工作区/目标 tab/会话、模型选择、heartbeat 与保存屏障。内容、配置修订、偏好或作用域漂移拒绝，不将新的默认静默用于已解析请求。执行快照进入 root 后不再跟随配置默认变化；selection、argv/overlay、binding 和原 Owner 清理继续核对具体相同模型，不重写旧任务、不认领未知 Owner。缺失/非法默认、错档案及不适用变体/力度仍拒绝。读取修订不进入执行快照，也不授予执行或清理权限。

round-369 的首次 `/tmp/round369-mixed-public-eh.json` 仍为 failed/leaderExecution，不能改写为通过；明确模型 `/tmp/round369-mixed-public-eh-explicit-model.json` 与 round-366 Codex stop→continue/六原 Owner 原证据保留，没有重跑。默认模型修复只涉及 `departmentConfiguration.ts`、`departmentConfigurationHost.ts` 和 `modelSettings.ts`，未修改生产入口、Owner 协议、员工 worker、原生会话或清理器。驱动新增 `--leader-model default|explicit`，OpenCode 旧默认参数仍 explicit，Codex 仍 default；不支持参数/组合/重复或缺值明确拒绝。真实公开控件及外观不变。

物理隔离产品 `/tmp/round372-product-io4pur6l` 的 src/scripts/dist 均非链接，node_modules 仅链接现有依赖，没有安装、升级或写共享 dist。标准 `npm run build` 通过。最初构建新增测试 import 大小写不一致（TS1149）已修正；最终构建日志 `/tmp/round372-build-with-host-regression.log`。**26 个不同直接相关用例通过**：核心配置与直接宿主/默认模型 19、生产默认快照 launch/binding/cleanup 1、参数/原证据断言 5、追加的真实 modelSettings 漂移接线 1。后者是 EH 后追加的测试代码，重新标准构建及运行该具名用例；未更改已通过 EH 对应生产源码/脚本，不重跑其余有效检查。覆盖三角色默认、显式与 Codex 默认、错档案/缺失/非法默认、变体/力度、读取内容与同模型 revision 漂移、工作区/目标/保存屏障/选择变化；总监/员工默认的直接宿主与真实 argv/overlay builder 回归不能声称它们完成了真实全角色 EH。

```sh
npm --prefix /tmp/round372-product-io4pur6l run build
# 测试在独立临时 HOME/USERPROFILE/CODEX_HOME/XDG 下，以产品为 cwd：
node --test dist/test/core/departmentconfiguration.test.js dist/test/extensionHost/departmentConfigurationHost.test.js dist/test/extensionHost/departmentopencodedefaultmodel.test.js
node --test --test-name-pattern='OpenCode default snapshot reaches production' dist/test/extensionHost/departmentleaderproductionhost.test.js
node --test --test-name-pattern='real host default resolution rejects' dist/test/extensionHost/departmentConfigurationHost.test.js
node --test scripts/verify_department_full_eh_integration.test.js
PLAYWRIGHT_MODULE=/tmp/round343-playwright/node_modules/playwright \
SINITEK_DEPARTMENT_FULL_EH_TIMEOUT_MS=90000 \
node scripts/verify_department_full_eh_integration.js \
  --leader-cli opencode --leader-model default \
  --product /tmp/round372-product-io4pur6l \
  --report /tmp/round372-mixed-default-public-eh.json
```

唯一新 EH 报告 `/tmp/round372-mixed-default-public-eh.json` **passed/exit 0**。macOS arm64、Node v24.22.2、VS Code 1.144.0、Codex 0.167.2、OpenCode 1.19.5；全新隔离根 `/tmp/s-dept-eh-NYZyAw`，HOME/USERPROFILE/CODEX_HOME/XDG、CLI profiles、VS Code 数据、workspace 和空任务库全部隔离，环境白名单和关闭端口代理，仅免费 127.0.0.1 Responses/Chat Completions，不读取用户凭据、不访问收费模型。真实工具设置开启、部门模式/角色默认模型/统一根方案/发送后 root `msg_1794721747250_a19d6c621b3588` 创建。持久组长偏好仍为 null，UI 为 `__default__`，root/两个组长/两个原 leader Owner 的具体模型均为 `isolated/native-drain`。

9 次 Responses、8 次 Chat Completions（含两次单独识别的标题）零协议失败；两组长各同 Owner/session 三轮原生 dispatch/accept/report，Codex 员工使用真实 `text-protocol/lp1-text-protocol` 及运行时事件验收。四原 client 完整 required receipt、两集合 CLOSED/closure 与 binding/selection 一致；OpenCode 七 required confirmed、turnTerminal not-applicable，Codex 八 required confirmed。首模块完整清理与持久容量归还先于合法第二模块派发和实际员工执行，最终 root/组长 completed，总监最终汇报完成。

| 模块/角色 | 原 Owner | 原生 session | 完整 receipt |
| --- | --- | --- | --- |
| 1 / leader (opencode) | `e5024077-59bb-434e-b3fb-ab25f3f4bf93` | `ses_e223f6994ffesFYdnNokFyDziq` | `04eb2c46-b16b-416a-bbb2-bc9c2bb4cc80` |
| 1 / employee (codex) | `1ff81d03-96d5-49a7-880a-598fd4d8e7db` | `01a1ddc0-9c1d-73c0-8b78-11b1f1434944` | `b8b61fc1-d9b5-4af7-a382-06e63d0fee20` |
| 2 / leader (opencode) | `f9d0e592-4c5a-4ddc-bc60-d7aef748ec58` | `ses_e223f591cffehzyfK3fWBrBLw2` | `849dce94-84da-49e7-bcfc-766aab9a699e` |
| 2 / employee (codex) | `32c731d7-8ebe-45bb-8016-f55b54387490` | `01a1ddc0-abcc-77b1-bacb-fffc340112ef` | `f8130b1a-9ed9-4c41-b339-c54038bc8582` |

只读 `/tmp/round372-evidence-audit.cjs` → `/tmp/round372-evidence-audit.json` passed，逐一核对原 client 返回、所有 required、原协议握手、成功 grant ACK、真实 settled/drain、两 CLOSED 全集及清理→再派发→实际执行→总监汇报顺序；不能替代新一次执行。host exit 0、`forcedTeardown=false` 和 `/tmp/round372-process-audit.json` 零残留仅为卫生旁证。

`/tmp/round372-source-hashes-final.json` 保存 873 个 src/scripts hash；`/tmp/round372-source-correspondence.json` 保存 dist hash、12 项运行关键 hash 与并发差异：869 相同，4 项为并发共享 Owner/其测试、finalizing 观察测试和 worker 测试夹具。本轮未写这些文件。**生产 `src/runtime/departmentexecutionowner.ts` 的后续并发修订不在本次通过快照内**，即使默认模型三处及 EH 驱动全部匹配，也不能声称整个当前仓库或新 Owner 修订已由此运行验证。运行后追加的 host 单测不改变生产闭包。最终 Git 合并后必须统一重验。

员工根能力修复和共享 finalizing 观察的新修订由并行任务负责，本轮不预记成功。OpenCode 员工及全角色 EH、跨代/冷恢复、必要平台、未覆盖来源租约、剩余主题/窄屏和真实模型质量，以及全部实现测完后的 Git 同步合理合并、合并后全量回归仍独立开放。 未改 helper 的 9 项、round-369 未变 provider/场景/协议结果按原范围复用；本次没有重复明确模型新建或 Codex stop→continue。临时 /tmp 证据需由主任务按保留策略归档。


## 全角色 OpenCode 公开新建扩展（round-374）

本轮交付可执行的全角色参数与协议/证据扩展，**完整 EH 仍失败，未验证 OpenCode 员工或全角色组织成功**。保留 round-372 默认模型混合通过、round-366 Codex 公开 stop→continue 及既有 Owner 用例；没有重跑它们或改写历史失败。本轮没有修改生产执行、Owner、worker、清理或 UI 外观，也没有修改中央事实文件。

`--director-cli codex|opencode`、`--employee-cli codex|opencode` 省略时仍为 Codex；既有 `--leader-cli`、`--leader-model default|explicit` 的默认行为不变。未知、重复、缺值及任何 OpenCode 角色的 stop-continue 组合明确拒绝。总监通过既有 currentCli/profile/主模型控件选择档案默认值（该控件既有 handler 将等于档案默认的选择存为 null）；组长和员工使用既有 `__default__` 控件。成功门禁要求三角色 root 有效快照为该档案具体模型，而 UI/持久默认偏好不变。

Chat Completions 适配复用同一生产阶段 parser 和持久身份核对，覆盖经典总监、Loop+ 组长、员工及有界标题/摘要。仅解码安装版 one-shot 的确切双引号 argv 包装；未知请求（含隐藏重试“继续”）、错传输/身份、重复员工执行或事件验收、无员工验收的完成、超预算继续失败。Responses 与 Chat 各最多 32 请求，Chat 场景还受共享阶段预算限制；原 provider 默认 native-drain 行为及合同未改。

被动原 client receipt 观察器保持不变；IPC 观察器增加 process 员工 worker 和安全 launch 字段，不记录 token/env/配置正文/prompt，也不替换 send 或成功回调。成功断言按每份 binding 的真实 role/CLI 区分协议，要求四原 client receipt、精确两 CLOSED 全集、原会话/selection、OpenCode 七 required confirmed 与 turnTerminal not-applicable、首次 grant 前任务/binding/容量持久回读、员工 argv/overlay、准备及实际 assistant turn 的同一 canonical directory、组长三轮和原 stopped/自然 close。原生 SQLite 读取仅为只读运行旁证，不能生成执行或清理权限。第二模块必须仍经原完整清理/持久容量归还后实际派发与员工执行，最后总监汇报/root 完成。**这些新增成功分支在本次真实 EH 中均未到达；通过的合成断言测试不能代替它们。**

```sh
npm --prefix /tmp/round374-final-product-4rz6b_vm run build
node --test scripts/verify_department_full_eh_integration.test.js scripts/fixtures/department_full_eh_scenario.test.js
# 编译后的被动 IPC 具名测试在产品 cwd、全新 HOME/CODEX_HOME/XDG 环境运行：
node --test --test-name-pattern='passive EH IPC observer' dist/test/extensionHost/departmentfullehproductionhost.test.js
# 已执行的真实 EH 命令，第三次保留诊断日志；不要覆盖报告：
PLAYWRIGHT_MODULE=/tmp/round343-playwright/node_modules/playwright \
SINITEK_DEPARTMENT_FULL_EH_TIMEOUT_MS=90000 \
node scripts/verify_department_full_eh_integration.js \
  --director-cli opencode --leader-cli opencode --leader-model default --employee-cli opencode \
  --product /tmp/round374-product-5_kxxv8s \
  --report /tmp/round374-all-opencode-public-eh-diagnostic.json
```

两次实体 src/scripts/dist 标准构建通过（最终 `/tmp/round374-final-build.log`），只链接已有 node_modules，未清理共享 dist、未安装依赖。脚本最终 23/23；初版 host fixture 3/3，其中最终修改的 IPC 用例再具名 1/1，通过日志 `/tmp/round374-final-host-fixture-test.log`，另外两项未改范围复用。两脚本 `node --check` 通过。最终 873 文件清单 `/tmp/round374-source-hashes-final.json`、dist/关键 Owner hash 与并发比对 `/tmp/round374-source-correspondence.json`；比对时零差异。Owner `departmentexecutionowner.ts` 为 `510697df04e64187be893a98242fc15be9744ffb187bad5512e7531f018794bc`。最终产品生产源码与首次产品一致，六处变化仅为本轮脚本/fixture/test；不能将最终补充的成功断言和测试声明为第三次 EH 已执行版本。第三次实际 driver/scenario 快照另存 `/tmp/round374-eh-driver-diagnostic.js`、`/tmp/round374-eh-scenario-diagnostic.js`。

三份唯一真实报告均保留 failed：`/tmp/round374-all-opencode-public-eh.json` 首次未识别 one-shot 引号及摘要标题（夹具问题，已修）；`/tmp/round374-all-opencode-public-eh-envelope.json` 与 `/tmp/round374-all-opencode-public-eh-diagnostic.json` 已识别摘要及总监派发 JSON，却暴露更早的原生输出交接阻断。第三次 macOS/Node 24.22.2、OpenCode 1.19.5、真实 VS Code；隔离根 `/tmp/s-dept-eh-6df02K`，root `msg_1794724262428_a7ce2ccd06ed5`。公开设置/默认角色/统一方案/发送已完成，6 次免费 Chat 请求；随后未知“继续”及其标题被严格拒绝。root running、subTasks 为空，没有组长、员工、attempt/event 或四份 Owner；不能把场景已返回的 moduleCount=1 当作生产派发。

精确因果审计 `/tmp/round374-all-opencode-failure-analysis.json`：本机原生 DB 中总监 JSON 已 completed，但生产日志 `runPrompt-one-shot-missing-final-conclusion-retry` 的 stdoutLength/stderrLength 均为 0，无法采用 session/最终答复，继而隐藏重试。旧报告误标 leaderExecution；只读审计明确为 **directorExecution/output-handoff-before-module-persistence**，旧报告保持原样，最终 driver 提前固定实际阶段。独立最小原生对照 `/tmp/round374-native-attach-diagnostic.cjs` → `.json`：相同安装版 CLI/隔离 profile/免费 provider，带 `--attach` exit 0/stdout 0/stderr 0，不带 attach stdout 923/stderr 4312；`/tmp/round374-native-attach-noauto.cjs` → `.json` 证明去掉 `--auto` 的 attach 仍零输出。此对照不是公开组织执行，不能替代任何 Owner/容量证明。

最小后续修复域是 `openCodePromptRunTemplate.ts` 的 managed monitor 准备/attempt stream/原生答复消费（443–548）、`promptOneShotRuntime.ts` 及 `openCodeRunArgs.ts` 的 attach 接线（19–28）。未直接禁用监控、伪造 stdout/会话、从 DB 补宿主答复、重放决策或回答未知重试来造成功；没有接管并行 Owner/员工修复。三次 host exit 0、forcedTeardown=false、`/tmp/round374-process-audit.json` 零匹配残留仅为卫生事实，**没有任何组长/员工自然 drain、原 client receipt、CLOSED 或容量清理成功结论**。同生产阻断确认后不重复跑同一失败场景；完成修复后须用最终匹配产品/脚本和全新报告复验。

中央事实所有者待同步：本轮参数/协议交付及 23 项脚本结果；全角色路径仍被 OpenCode 总监 attach 输出交接阻断，OpenCode 员工和全角色 EH 仍开放；不得由本轮构建或零残留外推新 Owner 已通过组织集成。跨代/冷恢复、其它平台、未覆盖来源租约、最终 Git 同步合理合并及合并后全量回归继续独立开放。临时证据由主任务按保留策略归档。

## OpenCode managed 输出交接及全角色公开新建通过（round-375）

保留上节 round-374 的全部失败及原生对照。本轮最终唯一通过报告为 `/tmp/round375-all-opencode-public-eh-complete.json`，只读证据复核 `/tmp/round375-evidence-audit.cjs` → `/tmp/round375-evidence-audit.json`。macOS、VS Code 1.144.0、Node 24.22.2、已安装 OpenCode 1.19.5（binary SHA256 `feaafead8cd563af0c2dcb386b0757e4355e327ebb6bd1aaad5440fe2f83596c`）；总监/组长/员工均 OpenCode、档案默认模型。此前通过的 Codex 新建/stop→continue、混合场景及不受影响的默认模型和 Owner 检查未重复运行。

### 生产修复及边界

安装版原生 run 源码的只读摘录 `/tmp/round375-installed-run-source.txt` 证实：noninteractive attach 启动 SSE 消费后，其等待函数在 attach 时立即返回，能先于 stdout 消费退出。复用 round-374 已有带/不带 attach 和去 auto 对照，没有重复基础诊断。`src/cli/openCodeManagedPrompt.ts` 在共享 template 的 managed-server Loop main 路径使用该原生 server 的同步 message API：创建或读取固定 native session，先校验 canonical directory/parent，再设置现有子代理 monitor 的 parent；一次提交带唯一请求 message ID 的原 prompt、model、variant。仅采用此次返回的 assistant，严格校验 session/parent request/model/directory/completed/part 身份及重复 part，经既有 JSONL parser 完成 session adoption 后退出。总等待最多 120 秒且响应/输出受字节预算限制，取消或过期执行的迟到结果拒绝。没有查询历史生成答复、重放决策、全局移除 attach、禁用监控或改原重试政策。Owner 的 `departmentProcessStream` 不使用此分支，仍不依赖 EH monitor server、零隐藏重试；配置 attach 和非 main 角色保留原 transport。

真实推进后另外暴露并最小修复两处员工生命周期问题：`extension.ts` 的可信 `recordDepartmentSubtaskTarget` 在第一次 prompt 投影前登记刚创建的 OpenCode tab，不能依赖尚未存在的 loop tab context；登记仅证明创建，不授予执行权。`departmentprocesspreparation.ts` 在 task/session/binding 持久回读完成后、commit/start/grant 前固定原 tab capability，清理重用同一个 capability，避免输出采用 native session 后才尝试绑定。原身份/配置/授权/清理校验及 Owner/worker 未放宽。实际回归先在旧实现得到 `cleanup-observation-unknown:owner-lost-or-cleanup-unverified`，修改后通过。

驱动的 overlay 场景补齐 `temp=true` 严格策略：即使 binding、原 requirements/receipt、持久回读副本一致降级为 temp=false/not-applicable 也拒绝；生产无 overlay 时的合法 not-applicable 未改。全角色两模块最多七个已识别标题请求（总监三、组长二、员工二）；第八个或外来身份拒绝，整体 32 请求预算及未知阶段门禁不变。

### 命令与匹配产品

```sh
# 在实体 src/scripts/dist 产品 cwd 执行；只链接已有 node_modules
npm --prefix /tmp/round375-final-product-5kdjp24p run build
# 同一产品 cwd 的具名直接相关检查
node --test dist/test/cli/openCodeManagedPrompt.test.js dist/test/extensionHost/openCodePromptRunTemplate.test.js
node --test dist/test/extensionHost/promptOneShotRuntime.test.js dist/test/extensionHost/promptParallelRuntime.test.js
node --test --test-name-pattern='fresh Department employee tab registration' dist/test/extensionHost/extensionHostExtractionContracts.test.js
node --test dist/test/runtime/departmentprocessbootstrap.test.js
# 最终脚本；与运行产品中的实体副本一致
node --test scripts/verify_department_full_eh_integration.test.js
node --test scripts/fixtures/department_full_eh_scenario.test.js
PLAYWRIGHT_MODULE=/tmp/round343-playwright/node_modules/playwright \
SINITEK_DEPARTMENT_FULL_EH_TIMEOUT_MS=180000 \
node scripts/verify_department_full_eh_integration.js \
  --director-cli opencode --leader-cli opencode --leader-model default --employee-cli opencode \
  --product /tmp/round375-final-product-5kdjp24p \
  --report /tmp/round375-all-opencode-public-eh-complete.json
node /tmp/round375-evidence-audit.cjs
```

最终 TS 标准构建 `/tmp/round375-capability-green-build.log` 通过；上述检查分别 33/33、28/28、1/1、51/51、9/9、15/15，共 137 个不同用例通过；两脚本 `node --check` 通过。最后仅调整 JS 标题预算并复制到实体产品，未改 TS；没有清理共享 dist、安装/升级依赖或发布。`/tmp/round375-complete-source-dist-manifest.json` 保存 875 个 src/scripts 和完整 dist 共 2479 文件 hash；`/tmp/round375-complete-source-correspondence.json` 证明运行前后工作区源码/脚本零差异、产品零变更。Owner SHA256 `510697df04e64187be893a98242fc15be9744ffb187bad5512e7531f018794bc`，worker `a18dcb1eb91bfb443842e9f94f25c79a9cce0c7e964738d666931ac25681fe21`。本节是运行后的文档变更，不在 EH 产品中，不影响执行闭包。

### 新旧运行证据

| 唯一报告（/tmp/） | 实际结果及首阻断 |
| --- | --- |
| `round375-all-opencode-public-eh.json` | failed；总监原输出已交接并派发真实组长；员工 tab 未登记，未执行员工；9 次 Chat，无 provider 错误。 |
| `round375-all-opencode-public-eh-final.json` | failed；员工已真实执行，但原 capability 绑定过晚，员工 cleanup 未确认；11 次 Chat，无 provider 错误。旧未知租约保留。 |
| `round375-all-opencode-public-eh-capability.json` | failed；两模块员工执行、首模块容量归还已到达，夹具第七个合法标题被旧六次预算拒绝；四个体清理观察不能替代该场景通过。 |
| `round375-all-opencode-public-eh-complete.json` | passed；22 次 Chat（七标题、二摘要，其余为真实生产阶段），0 Responses，零 provider/阶段错误，全部成功门禁到达。 |

最终从全新隔离 `/tmp/s-dept-eh-3eZOT9` 空库启动（部门模式起初 false），经真实工具设置、三角色档案/默认控件、统一验收方案及公开发送。root `msg_1794727662286_a1c714ed26c4e8`；组长 `msg_1794727664653_2ce71ca90da628`、`msg_1794727677617_a86cfb4db4de9`。UI/持久偏好保持默认 null，三角色 root 固化 `isolated/native-drain`；实际 selection/employee argv/overlay 与原 binding 一致。两实际员工均为各自组长内的 `text-protocol/lp1-text-protocol`，身份由运行时发现并核对，不能跨组长合并。

| 模块/角色 | 原 Owner | 原生 session | 原 client 完整 receipt |
| --- | --- | --- | --- |
| 1 / leader | `c5a6f2ba-6e98-4ee8-b93d-fb959fd6e0bb` | `ses_e21e52105ffeXanopFWA1vG7OZ` | `6ed57a49-3624-41f4-a2b9-a1bcfe71282d` |
| 1 / employee | `f2fe15bd-5a17-4e1d-9bda-b7d648cf9a4f` | `ses_e21e5192bffe72fLWPp1FpkejQ` | `00bd1875-b72c-4d15-93da-22a361303a7b` |
| 2 / leader | `2df88ebf-9327-4128-ab5a-e82328581105` | `ses_e21e4ee70ffeefEt2bNqGw9dVJ` | `63098bdd-1b17-4dd6-aa9d-15a25242c5b8` |
| 2 / employee | `3fc6fcb2-3883-42f8-b9ca-9f6dad1af5a7` | `ses_e21e4e71affeFz3U82AzrvqODR` | `3fff246e-3a2a-4a39-afca-0ecfbd03aedd` |

四份均由既有被动观察器记录 `original-client-waitForCleanup-return`，processTerminal/streams/runner/executionRoot/links/temp/tab 七项 confirmed、turnTerminal not-applicable。两组长各同 Owner/session 三轮 dispatch/accept/report、自然 settled/drained/stopped；两员工原 stopped，四 worker 自然 owner-close 0。原生准备及实际 task cwd 为同一 canonical 目录、首次 grant 前原 task/session/binding/容量持久回读齐全；SQLite 仅只读旁证。两个精确 CLOSED 集合各含 leader+employee，完整身份及 selection/requirements 对齐。首模块两 receipt completedAt `1794727671706` / `1794727668826`，在持久容量空且原集合完整的读验后才返回第二合法派发；第二组长 grant `1794727678495`、第二员工 grant `1794727680674`，随后实际员工事件验收、第二完整清理及总监最终汇报/root completed。业务终态、空 Map、磁盘 receipt 或退出未被用作清理授权。

最终 host exit 0、forcedTeardown=false 仅为卫生证据。卫生扫描发现前一次 failed/final 的旧 cleanup-failed 员工 worker PID 63736，已核对其旧 root/Owner 后单独 SIGTERM；`/tmp/round375-failed-run-worker-hygiene.json` 记录该强制卫生动作，旧未知清理/租约未改，不能补该失败运行成功。最终通过运行四个原 worker 的自然 close 均早于其 host 收尾。

中央事实所有者待同步：此匹配快照已首次通过全角色 OpenCode 默认模型公开**新建** EH，包含新 Owner、员工真实执行、四原凭证及两模块容量再派发；记录 managed 原输出兼容和两个 tab 生命周期修复，不覆盖 round-374/本轮三次失败历史。OpenCode stop→continue/跨代/冷恢复、其它平台、未覆盖来源租约、真实模型质量及最终 Git 同步合理合并/合并后全量回归仍独立开放。未改中央 design/inventory/ontology/active 计划，不预记并行任务结论。所有 /tmp 证据由主任务按保留策略归档。

## round-376：managed Loop main 权限、父回合活动与 agent

本轮只补 round-375 新 managed 传输未覆盖的工具合同；保留上一节全角色 OpenCode 默认模型文本公开 EH 及中间失败，不重跑该 EH 或未变的 Owner/receipt/CLOSED/容量检查。

安装版 OpenCode 1.19.5 的 `run --auto` 在同 server `/event` 消费 `permission.asked`，对非显式 deny 回复 `/permission/{requestID}/reply` 的 `once`。`openCodeManagedPrompt.ts` 现在提交前建立同 canonical directory 的有限订阅；父 assistant 必须匹配本轮随机 request message、原 session、provider/model/directory。permission 必须再匹配该消息的实际 tool call；当前子会话必须来自该轮 task metadata 并经原生 session GET 校验 parent、directory、创建时间及 model。`session.created`、孤立 busy、旧消息和其它 session 不授予回应权。原生显式 deny 不会发 ask，本轮真实验证明确覆盖；question/plan_enter/plan_exit 即使出现 ask 也 reject，不写全局 allow/always。重复问询幂等，取消/过期/成功/错误关闭本轮订阅及请求，不读取 DB 历史补输出。

本轮有效 step/tool/reasoning/text 只通知 one-shot 看门狗已有的真实活动端口；不造 stdout、不用空心跳/无 child 通知充当活动。60 秒无活动仍超时，helper 总等待仍为 120 秒。确定性回归还发现同步 managed kill 会抢先回报 cancellation，现改为先结算原看门狗错误再终止，保留超时诊断和重试分类。最终输出仍只由原 synchronous response 完整校验后一次交付。

one-shot/parallel 从原 `buildCliArgs` 取得最终 argv，维持已有 model 替换及显式 variant 优先级；支持 `--agent name`/`--agent=name`，先核对原生 `/agent`，再以同 agent 提交并核验最终响应。managed API 只接受可表达的有效参数：agent、model/-m、variant、json format，以及已由准备器/原生 server 消费的 port/auth/pure 和原 auto/print-logs 标志；command/file/fork/continue/session/dir/title 等不能表达的覆盖模式及其它未知参数明确报错，不静默丢弃。配置 attach、非 main 及独立 `departmentProcessStream` 保持原 stream/零隐藏重试；原 Owner/worker/清理器未修改。

### 实际命令与证据

```sh
# 全新实体 src/scripts/dist 产品，仅复用已安装 node_modules
npm --prefix /tmp/round376-final-product-j6hsaz4f run build
# 最后受影响的消费者，22/22
cd /tmp/round376-final-product-j6hsaz4f
node --test dist/test/extensionHost/promptOneShotRuntime.test.js
# 此前实体产品运行的47个 helper/template/parallel用例仍匹配最终源码/dist
# 原命令还包含最后变更前的22个one-shot；其旧范围由上面的最终22项替换
cd /tmp/round376-product-uzjcu_ru
node --test dist/test/cli/openCodeManagedPrompt.test.js dist/test/extensionHost/openCodePromptRunTemplate.test.js dist/test/extensionHost/promptOneShotRuntime.test.js dist/test/extensionHost/promptParallelRuntime.test.js
node --test scripts/verify_opencode_managed_main.test.js
# 以下是 headless 生产 one-shot host + 准备器 + monitor 的最小原生工具验证，非公开EH
cd /tmp/round376-final-product-j6hsaz4f
node scripts/verify_opencode_managed_main.js \
  --product /tmp/round376-final-product-j6hsaz4f \
  --report /tmp/round376-managed-main-tool-final.json
```

最终 build 日志 `/tmp/round376-final-build.log` passed。定向 TS 共69个不同用例（最终one-shot22 + 可复用helper/template/parallel47），验证器3个，共72个。`/tmp/round376-timeout-red.log` 保留修复前确切超时诊断失败，`/tmp/round376-final-oneshot-tests.log` 为修复后22/22；其它日志和源码对应详见本轮报告。

新增验证器以环境白名单启动隔离子进程，HOME/USERPROFILE/CODEX_HOME/XDG/profile/workspace 全新；只用安装版 OpenCode 和免费127.0.0.1 Chat provider（总预算6次、实际3次含1标题）。实际生产 `createPromptOneShotRuntimeHost`、`createOpenCodeSubagentRuntimePreparer`、`startOpenCodeServer`、helper/template/monitor 执行，UI存储/输出为 headless 宿主适配，不替换执行、权限、输出或完成回调。一次提交读取隔离文件，另一文件明确 deny。最终 session `ses_e21b43a74ffe37tIG5voLbUDnY`；显式 agent `isolated_reader` 与最终响应一致，原 message/parent/cwd 相符；一个准确 ask、一个 once、原生 read completed、被拒 read error、原最终答复及 session adoption 成立，两订阅关闭、server退出、无强制卫生回收。没有 Department Owner 或组织容量的新证明。

保留 `/tmp/round376-managed-main-tool.json` 的失败：夹具最初使用绝对 read pattern；原生源码明确按 worktree 相对路径问询，导致合法文件也被 deny、provider严格拒绝缺失读取。修正为全新隔离 git worktree 的 `allowed.txt` 精确 ask 后 `/tmp/round376-managed-main-tool-native.json` passed。随后加强超时回归发现上述诊断抢占，修复后才用最终匹配产品输出 `-final.json`，不是重复已通过的文本 EH。三个报告不互相覆盖。

`/tmp/round376-final-source-correspondence.json` 保存125文件生产闭包及2481文件完整hash；最终src/scripts与当前工作区无差异、运行前后产品无变更。Owner `510697df04e64187be893a98242fc15be9744ffb187bad5512e7531f018794bc`、worker `a18dcb1eb91bfb443842e9f94f25c79a9cce0c7e964738d666931ac25681fe21` 未变。仅追加本节和本轮报告是运行后文档动作。

待中央事实所有者同步此 managed main 工具/活动/agent 合同及证据范围；不提升为全工具、真实模型质量、所有版本、其它平台或公开EH的新证明。OpenCode跨代目录/公开继续/冷恢复、未覆盖来源租约、必要平台、最终Git同步合理合并与合并后全量回归继续开放。
