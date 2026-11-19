# OpenCode 同宿主原会话目录续接

## 范围与能力来源

部门 OpenCode 续接保留原 `ses_ID`，使用新 Owner、execution claim 和隔离根。原根必须经原 dispose 移除；不能保留旧根或使用 persistent cwd 冒充清理完成。同代组长多轮继续复用同一 Owner/root/session。

移动授权只来自当前宿主 producer 保留的原 client 与私有 retired provenance。跨组长代次要求原整组完整 receipt、精确 CLOSED 冷读和持久容量移除；同代员工显式续接要求精确源 attempt 的完整 receipt、stopped 和员工持久租约移除，不要求整组结束。磁盘 binding、任务字段、PID、session 字符串及冷宿主均不能制造此能力。

源 workspace/root/module/leader、员工 subtask/attempt、generation、CLI/config/selection 指纹、原 session 与原 canonical directory 都须精确一致。原目录的 canonical 值在原 capability 有效时固定；删除后不重新 realpath 旧路径。旧路径被重新占用即拒绝。每个精确来源只能消费一次；session 的移动 reservation 保留精确来源/目标链，只有上一目标的原 Owner 已真实排空、原 stopped 且员工持久租约移除，才能推进下一次移动。结果未知不清锁、不自动重试，也不能回退消费更早来源。

## 原生准备与持久提交

安装版 OpenCode 1.19.5 的 SDK、TUI 和服务实现提供 `POST /experimental/control-plane/move-session`。本实现只发送：

```json
{"sessionID":"ses_ORIGINAL","destination":{"directory":"/canonical/new-owned-root"},"moveChanges":false}
```

服务检查目的目录 projectID；`moveChanges:false` 不捕获、应用或丢弃 Git 改动。成功响应为 204 空 body，不能当成执行授权。私有认证 loopback 准备器先 GET 验证原 ID/源目录，移动后再 GET 冷读原 ID/新 canonical directory，并验证 project 不变、无子会话或其它 workspace 关联。不使用 TUI synthetic prompt，不写原生 DB，不 fork、不创建替代会话、不重放决策。

原根 assert/dispose 能力在首次 canonical lookup 前固定。每个异步边界复核配置租约、路由、当前代次、源记录、准入、根能力和取消；员工 worker 经有界私有 IPC 向宿主复核。任务 executionSession 和 Store binding 持久回读通过后才允许最终 grant。请求有绝对 10 秒期限，server 输出有界；准备 server 的真实 processTerminal/streams/overlay drain 完成后才释放配置租约。失败不发 prompt/grant，保留未解决的准备责任及容量。

原生身份与本地 transcript 身份独立。显式续接允许现有 tab 的本地 transcript health transition，但该确认不能授予原生移动或执行权限，后者仍必须通过 producer 私有来源校验。旧子会话和旧消息不因父 session 移动取得当前权限。

## 公开验证

使用实体 `src/scripts/dist` 产品，标准 `npm run build`，不 clean 工作区共享 dist。仅支持已有 Codex stop→continue，以及三角色全部 OpenCode、默认模型的 stop→continue；其它混合或不支持参数继续拒绝。

```sh
PLAYWRIGHT_MODULE=/tmp/round343-playwright/node_modules/playwright \
node scripts/verify_department_full_eh_integration.js \
  --product /tmp/round378-final-product-g_oh6bis \
  --report /tmp/round378-all-opencode-stop-continue-final.json \
  --scenario stop-continue \
  --director-cli opencode --leader-cli opencode \
  --employee-cli opencode --leader-model default
```

2026-11-15 本次报告 `result=passed`：真实 macOS VS Code EH、OpenCode 1.19.5、隔离 HOME/USERPROFILE/CODEX_HOME/XDG/profile/任务库和免费 loopback Chat provider；25/32 请求，无 provider 错误。通过现有设置、发送、停止、继续控件完成原代停止、无自动复活、原组织及原组长续接、原组长/员工 session 保持、新 Owner/root 与目录冷读、后继员工执行及真实事件验收、容量持久归还后的第二模块执行、总监最终汇报及根完成。

六个原 client 各自返回完整 required receipt，三个精确 CLOSED 集合分别为 module-1 generation 1、module-1 generation 3、module-2 generation 1。processTerminal/streams/runner/executionRoot/links/temp/tab 均 confirmed，turnTerminal 按 OpenCode 策略 not-applicable；员工均有原 stopped 握手。证据来自被动原 client 观察器；只读原生 DB 用于 session/directory/turn 旁证，不能补清理成功。进程退出、无残留及 `forcedTeardown=false` 仅作卫生记录。

证据索引：

- 原生 API 实现及旧根删除探针：`/tmp/round378-native-move-source.json`、`/tmp/round378-native-move-probe.json`。
- 最终公开报告：`/tmp/round378-all-opencode-stop-continue-final.json`；六 Owner/receipt/目录/握手摘录：`/tmp/round378-six-owner-audit.json`。
- 完整实体产品清单：`/tmp/round378-final-source-dist-manifest.json`；保守完整生产闭包：`/tmp/round378-production-closure-manifest.json`；宿主对应：`/tmp/round378-final-source-correspondence.json`。
- EH 后只改两个测试及其四份编译产物：`/tmp/round378-post-eh-test-only-diff.json`。生产源码、脚本及生产 dist 未改变，实际 EH 证据仍匹配。

历史失败保留：`round378-all-opencode-stop-continue-initial.json` 因不存在的 Playwright 模块未进入公开操作；`round378-all-opencode-stop-continue-native.json` 在原代完整清理及组长目录移动后，员工 transcript health reset 被 tab consumer 拒绝，停于 successorCleanup，不能声称下游成功。现有 session transition 确认补齐 OpenCode 后，最终新报告才通过。旧失败不由新成功回写。

round-375 的全 OpenCode 新建 EH、round-376 managed main 权限/活动/agent，以及 round-366 Codex 公开续接按未变范围复用；本轮没有重放这些组合。新增目录、来源、竞争、取消、配置漂移、持久提交及协议检查见 round-378 执行报告，门闩测试不外推为公开 EH。

## 连续续接与自身重试（round-382）

round-378 的公开 EH 只证明一次停止后续接。后续审查发现：整代 session Set 永久占用会阻断 A→B→C；自身恢复时当前新 open attempt 又会被错误当作来源。round-382 修正为有界的 session 来源/目标链，保留全部历史 original；在保留原 client、binding、selection、canonical 目录、完整 required receipt、stopped 和持久容量门禁的前提下，仅允许精确上一目标成为下一来源。同宿主跨组长退役证明携带链头，仍要求原整组 CLOSED 与容量归还；未知目标没有原清理事实时，链不能前进。旧来源重放、同 session 并发及迟到旧能力均拒绝。

自身恢复沿原 `resolveLoopSubtaskSession` 语义，不引入新字段或新权限。宿主要求目标恰为当前唯一 running/open attempt，选择源 subtask 最新的非当前目标 attempt；只排除该精确目标，任何其它较新来源仍拒绝。配置准备前后也固定自身历史来源，避免 await 期间变化被遗漏；任务自身 session 持久写回单独核验，不把该合法写回误当来源漂移。

实体产品 `/tmp/round382-product-bnjb31a7`（src/scripts/dist 均为实体副本）标准 `npm run build` 通过。26 个不同定向检查分批通过，详见本轮报告：

- 原 `departmentleaderproductionhost` 夹具通过生产准备服务、真实 detached worker、真实原 client receipt/stopped 路径执行 A→B→C，以及同一 subtask 三个 attempt 的自身恢复。均只创建一次 session、移动两次、执行三次；原 native ID 保持，三个 Owner/execution/root 不同。受控 CLI 校验当前 directory 与最终 `--session`，不是真实 OpenCode/EH 证据。调度与容量记录由夹具通过真实 scheduler/Store 驱动，未声称本轮重新覆盖公开容量调度。
- 未退员工容量、缺原 stopped、较新未绑定来源、准备 await 期间自身来源变化、未知 reservation、并发重复及旧来源重放均拒绝且不 grant；失败保留未绑定责任。原生网络未知结果/取消/冷读拒绝路径没有改动，沿 round-378 原范围复用。
- 原七项跨代来源/CLOSED/config/重占用/并发拒绝、五项续接生命周期和一项 finalizing/receipt/stopped 回归通过。

证据：`/tmp/round382-employee-tests.log`（9项）、`/tmp/round382-new-and-cross-generation-tests.log`（11项）、`/tmp/round382-lifecycle-tests.log`（6项）；最后仅对新增迟到复核断言重跑两个链用例，`/tmp/round382-final-chain-tests.log` 2/2，不重复累计。最终标准构建 `/tmp/round382-build-test-final.log`。`/tmp/round382-source-dist-manifest.json` 保存产品和宿主对应；同轮并发的 `scripts/fixtures/department_full_eh_scenario.js`、`scripts/verify_department_full_eh_integration.js` 变化未覆盖、未回滚，本轮 fixture 检查不依赖它。

本轮没有重跑公开 EH，也不宣称连续两次公开 stop→continue 或真实模型验证。round-378 六 Owner/三 CLOSED 及总监汇报仍是其原快照的有效历史事实；本轮新增权限条件与链推进只由上述最小定向范围验证。未改变公共 Owner 协议、原生移动协议、清理 requirements、零隐藏重试或冷宿主只读规则。中央事实由并行所有者同步。

## 连续公开场景与操作适配器（round-388）

以下为 round-388 的历史交付；其提前等待停止审阅的顺序由 round-393 修正，binding schema 结论又由 round-397 修正，不能据早期 mock 测试声称真实公开续接兼容。

新增 `createDepartmentSuccessiveContinuationEhScenario`，限定总监、组长、员工三角色均走 OpenCode Chat Completions；场景复用现有新建协议、最新用户消息解析、持久任务身份核对、标题预算和第二模块/最终总监协议。它最多提供两次有界继续提示。员工 A 与 B 的响应各自保持在有超时的 provider latch，只有外部公开操作适配器在观察生产 root 已 stopped 后释放对应响应。场景以持久 currentReview 的精确 event/subtask/attempt 为依据，将 A、B 的停止历史分别判为 failed，并只派发 `continueFromSubtaskId` 精确指向上一个停止来源的 B、C。C 的完成事件通过同一生产任务身份核验后才接受，原基础场景继续处理组长报告、第二模块和总监最终汇报。

新增 `driveSuccessiveContinuation` 接收 browser、scenario、任务/运行时读取、清理观察、health callback、report 和有限 timeout。它只选择唯一真实 Webview iframe：协议 `vscode-webview:`、`extensionId=sinitek.sinitek-cli-tools`、`purpose=webviewPanel`；确认总监群聊及目标 root 后点击既有 stopTask，等根真实停止、事件失败审阅、原完整清理及容量归还，再检查无自动复活并点击 continueTask、填写原 continue dialog。两轮各记录操作前后任务身份、原 binding、native session、根验收方案、generation 和新 leader execution owner ID、容量投影和请求数量；新 generation/owner 必须出现，session 和原任务身份保持。共享 `department_full_eh_scenario.js` 只新增可选 `continuationPrompts`，上限两条；既有 `continuationPrompt` 和默认调用保持原语义。未修改产品 UI 或共享公开 EH 驱动，场景与 adapter 尚未接入真实 EH 执行入口。

验证范围：两个新增脚本 suite 共 10 项行为测试，覆盖 A→B→C、失败事件精确性、重复事件与 attempt、错误 root/leader、来源不匹配、未清理拒绝、错误 Webview、绝对超时、异常清理释放和第二模块/总监报告协议；基础 scenario 15 项和现有一次续接场景 7 项作为直接兼容回归，总计 32 项。均为本机 Node 确定性夹具，不是生产 worker、Owner receipt、容量、公开 UI 或真实 EH 证明。本轮没有运行安装版 OpenCode/EH，也没有修改或复制已有验证器；连续两次公开 stop→continue 的真环境门禁仍开放。

产品 manifest 和既有验证器的完整 Webview extension id 均为 `sinitek.sinitek-cli-tools`。任务文字中的 `sinitik.sinitek-cli-tools` 与当前产品身份不同；adapter 按 `package.json` 的 publisher/name 和现有验证器使用实际已安装产品 ID，避免匹配不存在的 iframe。

## 保留门禁

当前事实仅覆盖同宿主、已证明原 client 排空后的显式续接。跨宿主冷恢复仍只读观察；必要其它平台、未知来源租约、未覆盖 CLI/模型组合、真实模型质量、最终 Git 同步合理合并及合并树全量回归仍开放。中央设计、功能清单、ontology、覆盖表与根计划由事实所有者同步，本 runbook 不提前关闭它们。

## 连续续接适配器状态修正（round-393）

连续场景按生产的暂停/恢复顺序建模：公开 stop 后只等待持久 root stopped、源 attempt 的唯一 pending stopped event 和原 Owner 清理/容量归还；此时 scheduler 停止 pump，因此不能要求 stopped event 已有 currentReview 或 successor。释放本轮被闩锁的本地 provider 响应后，才通过公开 continue dialog 恢复组织；随后组长请求携带生产格式的详细事件行和编号 acceptance batch，适配场景逐项核对 root、leader、event、subtask、attempt、outcome、detail 与持久 review，再将精确 A/B 停止事件验收为 failed 并只派生直接后继。接受后验证 seenAttempts 已 reviewed、持久后继的 `continueFromSubtaskId` 精确指向该来源。两轮重复此过程，C 的完成和后续基础场景收尾路径不变。

公开操作适配器复用共享验证器导出的 `createDepartmentWebviewAdapter`，也允许调用方注入兼容工厂。它先定位完整扩展 `sinitek.sinitek-cli-tools` 的 `webviewView` 并经 `#openCurrentLoopGroupChat` 打开当前群聊，然后在有界期限内通过 CDP 查找唯一 `webviewPanel`，校验目的和 root 后才点既有 stop/continue/input/confirm 控件。CDP 目标发现覆盖不出现在普通 `page.frames()` 中的 OOPIF。适配器只关闭自己打开的 Webview/CDP session，finally 总会释放 scenario latch，不关闭调用方 browser。

round-393 当时宣称身份投影已采用真实 binding；round-397 审查确认该结论不成立：adapter 和测试都错误地把 selection/requirements/configId 放在 identity 内，16/16 只覆盖了同样错误的 mock。该历史结果仍证明其当时覆盖的停止/继续顺序，不能作为生产 binding 兼容证据。生产结构及本轮修正见下节；两轮真实容量和清理仍须由原清理观察器证明。

round-393 定向验证命令：

```sh
node --test scripts/fixtures/department_successive_continuation_eh_scenario.test.js scripts/fixtures/department_successive_continuation_ui.test.js
```

结果 16/16 通过（场景协议 5 项；公开适配器行为及拒绝测试 11 项）。覆盖生产暂停顺序、两轮来源/事件门禁、错误 extension/purpose/root、未清理、Owner/root session 漂移、延迟 binding、无普通 frame 的目标定位、公开 stop 超时及 finally 释放。JavaScript 与文档范围未改 TypeScript，因此复用 round-388 已验证的标准构建，不重跑。适配器和状态测试尚未接入共享 EH driver；本结果不是连续两次真实 OpenCode stop→continue、真实 Owner receipt 或真实容量闭环证据。后续需由 shared-driver 所有者接入后，另用全新隔离产品完成真实公开场景并保留完整运行报告。

## 连续适配器 binding 合同修正（round-397）

生产 `DepartmentExecutionBinding` 严格为 `{identity, selection, requirements}`。identity 仅包含 version、workspace、root/module/leader、generation、role、CLI、两份指纹、bound session、owner/execution，员工再带 subtask/attempt；configId、revision、model、thinkingMode、openCodeVariant 从顶层 selection 读取，全部八项 cleanup 策略从顶层 requirements 读取。适配器复用生产 `isDepartmentExecutionBinding`，因此 selection 指纹不一致、额外 identity 字段或缺失完整策略均不能通过。即便后继记录本身合法且指纹已重算，来源与后继 selection/requirements 漂移仍拒绝。

`driveSuccessiveContinuation` 原导出入口不变，可选注入 `isExecutionBinding`，默认从同产品 `dist/extensionHost/departmentruntimestate` 加载生产 validator；后续驱动接入时须使用与实际运行产品匹配的 validator。`nativeSessions(runtime, scope?, isExecutionBinding?)` 允许限定 `{rootId, leaderId}`，只核验目标责任历史。历史 binding 不变但可新增合法 binding；其它组长新增不同 native session 不造成目标误拒绝。

总监使用生产经典 Loop 的 `cli/workspaceKey/sessionId`（原生 `ses_ID`）作为权威身份，不伪造 director Owner 或必填 executionSession；组长保留本地任务 sessionId，同时要求实际 `executionSession:{cli,sessionId,configId}` 与精确 leader binding 一致。员工任务也以相同 executionSession 合同核验。新 generation 出现后继续等待完整 leader binding 与任务会话持久化；A→B 和 B→C 分别等待后继的精确 subtask/attempt binding 与任务会话，再核对 CLI/config/selection、原 native session、不同 Owner/execution、固定作用域与新代次。每轮最后重新读取完整 runtime 并核对历史，记录包括后继的 binding，不能复用更早的 leader-only 快照。

公开 stop→pending stopped event→释放本轮 provider latch→原清理与持久容量归还→无自动复活→公开 continue→精确旧事件审阅为 failed→直接后继的顺序保持。webviewView 打开群聊、唯一目标 webviewPanel、共享 OOPIF/CDP 工厂、调用方 browser 所有权均保持。适配器自己的等待与已获取 Webview session 的释放共用同一绝对截止，迟到获取的自有 session 也发起释放；finally 释放所有 scenario latch。共享 driver/CDP 实现未改。

本轮测试夹具通过当前生产 identity validator、selection 指纹函数及 binding validator 构造/核验。测试仅将这两个生产 TS 合同从当前 src 转译到 `os.tmpdir()` 下的实体临时 JS，再加载并在 suite 后移除，不依赖共享 dist 的新鲜度，也无固定本机产物路径。根/组长的权威会话及 routes 均有实际值；stop mock 只产生 pending 事件，review/后继只在 continue 后发生，保持阶段独立。

验证：

```sh
node --test scripts/fixtures/department_successive_continuation_ui.test.js
node --test --test-name-pattern='public adapter follows|webview target lookup|waits for full top-level|preserves target history|final successor persistence' scripts/fixtures/department_successive_continuation_ui.test.js
```

第一条在最终冷读补充前 41/41 通过，日志 `/tmp/round397-successive-binding-ui-tests.log`；补充后第二条只复验受影响的四条成功路径和新增历史/旧 execution 反例，7/7 通过（与第一批重合的四项不重复累计），日志 `/tmp/round397-successive-binding-final-boundary-tests.log`。覆盖完整顶层结构两轮、配置/模型/思考/变体/revision、合法但漂移的 cleanup 策略、指纹错误、task session 不符、延迟或永久缺失完整 binding、允许新增历史与原 binding 不变、C 的来源及 Owner/session 边界。这里均为适配器行为测试，不是原 Owner receipt、真实持久容量闭环或连续公开 EH 证明。

本轮只改适配器 JS、对应测试及本 runbook；scenario、基础协议、共享 driver、生产 TypeScript、调度器、产品 UI 均未改。复用未变 TypeScript 标准构建、基础场景 15 项和单次续接 7 项的既有结果，不重跑已通过公开组合。真实连续两次 OpenCode stop→continue、全部原 receipt、容量闭环及最终汇报仍须 shared-driver 所有者接入后，在全新隔离产品中运行验证。跨宿主冷恢复、必要平台、最终 Git 同步合理合并与合并树全量回归继续开放。中央事实/ontology 由其所有者同步，本轮不修改。

## 连续两次公开续接驱动接入（round-400）

新增显式 `--scenario successive-stop-continue`，仅接受三角色 OpenCode 和 `--leader-model default`。省略 scenario 的新建、原 `stop-continue`、`cold-start` 及未知/重复/缺值参数拒绝合同保留。沿原 provider、生产清理观察器、连续 scenario 与公开 UI adapter 执行，不增加第二套驱动。adapter 的 binding validator 从 `--product` 指定的实际隔离产品加载；CDP 连接、目标发现、控件等待和自有 session 收尾消费共享能力及同一绝对截止。

```sh
PLAYWRIGHT_MODULE=<已有固定版本 Playwright 模块目录> \
SINITEK_DEPARTMENT_FULL_EH_TIMEOUT_MS=240000 \
node <隔离产品>/scripts/verify_department_full_eh_integration.js \
  --product <实体 src/scripts/dist 隔离产品> --report <新的报告路径> \
  --scenario successive-stop-continue \
  --director-cli opencode --leader-cli opencode --employee-cli opencode \
  --leader-model default
```

真实运行发现并修正四处场景/公开操作假设，未改生产调度器、Owner 或 UI：

- 实际 VS Code 的群聊 panel URL 可缺少 purpose。仅 root-scoped panel 分支允许把这种 URL 作为候选；仍核对完整 extension ID，并通过公开 `#panelSubtitle` 和总监/root 正文证明唯一目标。共享 CDP 工厂同时覆盖 OOPIF；其它 purpose/extension、重复目标和错误 root 继续拒绝，旧 unscoped 匹配不变。
- 实际停止员工的持久 subtask 是 `status=blocked, summary=stopped`，pending event/seenAttempt 另存。只接受这个精确停止投影，普通 blocked 不作为停止证据。
- stop 的完整清理/容量写回后，合法暂停栅栏 generation 仍可能稍后持久化。adapter 等待原代次加一的暂停栅栏后才固定无自动复活基线；运行代次实际为 1→3→5，暂停栅栏为 2/4。
- 生产 review detail 可跨行。scenario 按完整 detail 和其后的 acceptance batch 边界核验事件，任一后续行不符仍拒绝。

最终真实执行 `/tmp/round400-all-opencode-successive-multiline.json` 在 macOS VS Code EH、OpenCode 1.19.5、全新隔离 HOME/USERPROFILE/CODEX_HOME/XDG/profile/workspace/空任务库及免费 loopback Chat provider 中完成 A→B→C 两次公开 stop/continue、C 实际完成并验收、第二模块实际执行和总监最终汇报。27/32 provider 请求，无 provider 错误；UI 两轮均记录 `two-stops-and-continues-observed`，保存 8 个唯一原 Owner、4 个完整 CLOSED、4 员工执行。默认偏好仍 null，根有效模型及原 binding/overlay 为同档案具体模型。

**该原始执行报告仍为 failed，不能称为当前完整驱动一次运行通过。** 最后新增聚合断言错误要求组长 launch IPC 也携带 `retired`；实际组长在 fork 前完成目录移动，只有员工准备 IPC 携带该来源字段。已按两个生产路径修正：员工继续核对精确 retired identity/selection；组长核对来源和新代原 binding/session、不同绝对目录、首次 grant 持久读回，并由原生目录/每代 turn 冷读旁证核对。修正仅涉及验证器及对应反例，未重执行已完成的生产决策。

新增 `/tmp/round400-all-opencode-successive-offline-audit.json` 对原始报告、原 protocol/receipt ndjson 和只读 native DB 作离线补核验，mixed、successive、native 三项全部 passed；原文件哈希固定且历史报告不回写。每份原 receipt 的 required 项（含 overlay/temp）confirmed，turnTerminal 为策略 not-applicable；原 stopped、每代 canonical directory、两轮旧容量移除先于新 grant、原任务/binding 首次 grant 前持久读回均通过。离线审计不是另一场 EH，也不能把原报告的 pending/not-confirmed 阶段重标成 passed。完整驱动退出结果与该审计的合并接受仍由主审判断。

保留本轮中间失败：`/tmp/round400-all-opencode-successive-public.json` 为缺 purpose 导致 panel 发现超时；`...-panel.json` 为停止投影误判，未继续；`...-stopped.json` 为第二次 stop 的合法暂停栅栏变化误判；`...-final.json` 为 C 的多行 review detail 被旧单行解析拒绝。每次仅在现有输出定位后修正，未给未知 prompt 通用成功答复，也未把 teardown 当清理。

定向证据分批保存，重叠用例不累计：入口/原合同聚合检查、8 Owner/4 CLOSED 和每代原生 turn 聚合反例、实际产品 validator 接线、原冷 CDP 绝对期限及新增 root-scoped OOPIF（4/4）、停止投影/完整多行协议场景（最终 6/6）、两轮 UI/延迟暂停栅栏（最终 3/3）、角色分别核对原生来源与聚合（最终 2/2）通过。日志见 round-400 报告。中间测试 fixture 缺完整 requirements/pid、代次未同步的失败保留；修正的是夹具，未放宽生产凭证策略。未变基础/单次场景及原 TS 检查复用，不重跑已有真实组合。

实体产品标准 build 三批均通过，最后实际运行产品为 `/tmp/round400-multiline-product-v2prtras`；`src/scripts/dist` 为实体目录。执行清单 `/tmp/round400-source-dist-manifest.json` 与运行后产品完全匹配；`/tmp/round400-post-execution-correspondence.json` 保存当前宿主差异及 Owner/准备器哈希。执行后仅本任务验证器/测试的来源断言修改，另有并发所有者的 full-EH observer fixture/test 和 cold fixture 源码变化；这些更新未覆盖在该执行快照内，本轮没有修改它们。尤其 observer 虽位于 src/test，却是实际 EH 入口，不能把后来版本宣称为已验证。当前 driver 的离线核验哈希与原运行 driver 哈希分别保留。

本轮接入和真实业务执行事实超出 round-397 的 mock 范围，但不关闭跨宿主冷恢复、必要平台实机、未知来源租约、最终 Git 同步合理合并或合并树全量回归。中央覆盖表/ontology 由事实所有者按原报告与离线补核验分别同步。


## round-403：CDP 清理是驱动成功门禁

保留 round-400 的原始 failed 报告及修正后的 mixed/successive/native 只读审计；本轮没有重跑两次连续公开 EH。连续 adapter 和调用 wrapper 现在将自有连接关闭拒绝、挂起、adapter 返回的未确认清理诊断及 target/session detach 失败传播为失败。若先有业务错误，保留原错误并附加 cleanupDiagnostics，不以收尾错误替换它；最终 driver 也检查清理诊断，不能只把错误存进数组后给出 passed。

wrapper 在原总预算内预留最多 1 秒（短预算为十分之一）清理余量，并把固定 actionDeadline/cleanupDeadline 传给 UI adapter 和共享 CDP 工厂。candidate、discovery 和迟到 session 都只释放本次自有资源；截止已到也发起一次释放，但不继续等待超过原清理截止。root-scoped discovery 必须先完成 discovery session 清理，再移交唯一选中 target；候选释放失败立即拒绝，不再继续轮询。迟到获取只执行有界自有 detach 并保存失败诊断，不恢复公开操作。adapter 不关闭调用方 browser；wrapper 仅断开自己建立的 CDP 连接。

定向测试日志 `/tmp/round403-driver-tests.log` 保留初批 14/16（候选失败未立即拒绝的两条 Node 计数失败）；修复后仅重跑该分支 4/4：`/tmp/round403-candidate-final-tests.log`。其它初批通过项保持有效，包括正常业务后的 disconnect 拒绝/挂起、adapter 清理诊断及原业务错误保留、root-scoped OOPIF 和冷绝对期限。UI 受影响分支 5/5，日志 `/tmp/round403-ui-tests.log`；新增迟到连接回归 1/1，`/tmp/round403-late-connection-tests.log`。这些是行为测试，不是新的连续 EH 成功。

只修改 JS/文档；当前 src 与 `/tmp/round400-cold-product` 已接受标准 build 完全一致，原 manifest 全量核对无漂移，复用其 TS 构建与 observer 10/10。实体新产品 `/tmp/round403-cold-product-czwx04lf` 的 src/scripts/dist 均非 symlink；清单 `/tmp/round403-source-dist-manifest.json` 和运行后 correspondence 保存准确对应。新补的迟到连接 test 在产品冻结后增加，未改执行 driver/UI/生产源码；不把产品内旧 test 说成最新测试。完整闭包和命令见 round-403 attempt 报告。

本轮唯一真实检查为全 Codex cold-start，未通过：root-scoped 面板发现已完成，公开 DOM 点击信号已写入，但第二 EH 未取得 stop 消息送达证明，未执行到生产 warning/控制后快照。第二 EH exit 1 后 target/session detach 未确认，最终 driver 同时保留 evidence 超时与 cdpCleanup 失败；无强制 teardown。详见冷启动 runbook 和 `/tmp/round403-cold-real-report.json`。此结果不否定 round-400 连续 EH 的原业务/Owner事实，也不证明冷恢复通过或生产恢复缺陷。必要平台、真实冷恢复、Git 整合和合并树全量回归继续开放。
