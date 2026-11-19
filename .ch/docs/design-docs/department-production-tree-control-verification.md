# 生产整树停止与显式继续验证

本说明记录 round 237 的受控生产集成测试。测试已交付，生产正向继续未通过；不能据此宣称部门整树停止/恢复已完成根集成。

## 实现与范围

- 测试：`src/test/extensionHost/departmenttreecontrolintegration.test.ts`。
- 窄夹具：`src/test/extensionHost/fixtures/departmenttreecontrolfixture.ts`。
- 复用 `departmentproductionwiringfixture.ts` 的真实受控任务来源、公共更新路由、合法总监根/模块/组长元数据、固化 Codex 角色配置和统一验收方案；同一 composition/host、adapter、production producer、RuntimeStore、原 Owner 与原 client 完成执行及观察。
- 共享夹具只新增可选 treeControl 额度配置、原 main invocation 观察数组、根控制目标 Map 和真实 tab 查询。按实际 root 查询职责/绑定，使第二部门使用同一宿主；默认调用不启用根控制。没有新增 producer、准入策略或清理成功注入。
- 两个组长各有一个真实授权员工，常规额度为 1，第二组的员工占唯一超额；断言完整 `[leaderTaskId, attemptId]` 对应当前员工。另一个 root 的 Codex 组长保持在真实协议 turn 门闩处，验证停止隔离。
- 模型替身仅为免费固定 Node NDJSON Codex 协议 CLI，UI 消费者受门闩控制。员工走生产 Owner 资源路径，adapter 不创建普通模拟执行目录；成功凭证来自原 client 的严格 Owner 观察，绝不把 fixture 的普通 root disposer 当证据。
- 根组织控制使用生产 composition 入口；本场景没有运行总监模型 turn，沿用夹具的空闲总监停止端口。不是完整 Extension Host、真实 UI 或真实模型验收。

## 场景断言和实际结果

### 两组执行后的整树停止：停止阶段断言通过，正向继续失败

1. 在两个原生员工的真实消费者尚未结束时请求 `organizationControl.stop`。根任务变为 stopped，停止生命周期保持 pending；普通员工、原超额及组长租约均保留。
2. 原责任未结算时，根 `organizationControl.continue` 权威拒绝为 `root-not-ready`；任务、main、employee builder、tab、execution root、绑定计数不增加。停止后的新模块派发失败，原 producer scope 的迟到 admission 明确 sealed。
3. 原超额身份不变；另一部门的 runtime/capacity 和运行状态保持不变。
4. 放行真实消费者后，等待 stop 生命周期成功结算。通过原 client 逐项读取精确 identity/policy 的 Owner receipt，验证所有必需 cleanup 部分；冷读历史 CLOSED 完整集合与全部绑定；持久和内存中的普通/超额员工及组长租约均归还。adapter 真实 idle。
5. 两名员工各自保留 outcome=stopped 的 attempt，reviewQueue 含精确 `buildLoopPlusFinishEventId(subtaskId, attemptId)`，且未修改已发 main prompt。
6. 必需的正向继续断言仍失败：`部门继续被拒绝：leader-still-active-or-unverified`。后继代次真正 main/review 的执行、以及旧回调对后继代次不写入/不释放的断言保留在测试中，但因入口失败未执行，不能宣称通过。

生产调用链：`organizationControl.continue` → `continueDepartmentPrompt` → `departmentorchestration.continueRoot` → `inspect` → `inspectLeaderSession`。正常 Owner tab 清理已关闭组长 tab，`continueRoot` 在核验现有会话时返回 `leader-still-active-or-unverified`（当前源码约第 241–243 行）。extension 的实际 `inspectLeaderSession` 同样要求真实 tab/session/main 任务上下文存在。夹具没有在清理后伪造或重建 tab 来绕过此门禁。

另一个尚未动态进入的源码缺口：继续路径递增代次后直接调用 `runtime.runEventDriven`，未调用新代次 producer 入口；现有 `openNewLeader` 明确仅接受同宿主新建任务 provenance，不能用于收养已有 executionSession/历史集合。应由主审定义并实现清理后的合法会话目标、新代次 producer/Owner 接线和旧代次隔离，再运行保留的正向断言。本轮不修改任何运行时代码、不收养旧开放集合、不删除历史、不重建 Owner 补跑。

### 未绑定准备期间停止：通过

真实 producer 已登记 executionId=null 的 leader 责任后，在原 builder 门闩处停止；pending 时继续明确拒绝。放行迟到准备后，原 stop 以“尚未核验全部执行清理”拒绝，native `turn/start` 为零。原 null 责任、未知组长占用及持久容量保持不变，成员为 blocked；再次继续权威拒绝 `execution-cleanup-unverified`。停止和取消没有成为清理凭证。

## 完成与失败回收

所有生命周期都立即安装 fulfilled/rejected settlement 观察；等待门闩、状态、stop、原 client 清理、adapter idle、source close 都有 12 秒失败界限，超期输出 pending 诊断并失败。状态轮询是条件等待，不用固定 sleep 推导成功。

子进程在模块加载前使用全新 HOME/USERPROFILE/CODEX_HOME。父进程 55 秒硬期限只能失败并回收本子进程组；成功同时要求 exit 0、TAP 无失败以及 `DEPARTMENT_TREE_CONTROL_COMPLETE:<场景名>`。完成标记仅在所有 fixture lifecycle 已结算、原 teardown 结束且受控 source.close 返回 true 后输出；提前退出、挂起 Promise 或单独 exit 0 均不算成功。拒绝原因保留并输出；原夹具强制终止自建 worker、删除临时目录只属于失败回收，不计正常清理证据。

## 验证记录

构建/测试 cwd 均为实体副本 `/private/tmp/loopplus-round237-y6ou7jk3`；每次标准构建前检查 realpath 和 `src` 非 symlink，共享 node_modules 只读复用。未构建、清理或引用共享 dist。之前轮次误构建共享 dist 的披露仍成立，本轮证据不依赖它。

最终源码快照 2 含 772 个 TypeScript 文件，审计时与工作区逐文件一致；摘要算法为排序后连接 relative path、NUL、文件 SHA256，再计算 SHA256，结果 `a42bc7e3dd1814243f9539601c26d98f299efaa0b49e52f06f4f1447819c1eac`。仅文档/报告在最终检查后修改。

| 范围 | 命令 | 结果 |
| --- | --- | --- |
| 最新源码全树标准构建 | `npm run build` | 通过，日志 `build-round237-current-snapshot.log` |
| 新整树模块 | `node --test dist/test/extensionHost/departmenttreecontrolintegration.test.js` | 父层 2 项：1 通过、1 失败；失败为清理后显式继续，非超时；两个子进程均完成原生命周期/source close 并输出完成标记。日志 `tree-round237-current-snapshot.log` |
| 共享夹具直接兼容检查（快照 1） | `node --test --test-name-pattern='production composition uses one producer for two native mains and codex employee admission' dist/test/extensionHost/departmentproductionwiring.test.js` | 1/1 通过；未重跑整个模块。最终快照仅并行依赖更新，此旧结果保留原源码范围 |
| 受影响源码类型检查（快照 1） | `./node_modules/.bin/tsc -p tsconfig.round237.json` | 包含仓库 `.d.ts` 后通过；配置仅存实体副本，未写工作区 |

初次编译修正了本轮 env 推导遗漏 `NODE_TEST_CONTEXT` 的类型问题；其余早期标准构建被并行 OpenCode fixture 的 nullable session argv 类型错误阻塞。未修改该任务文件；并行所有者修正后同步最新源码至实体副本，最终标准构建通过。两次早期场景失败属于夹具：误用当前代次 API 查询 stop 后的历史集合、无关部门正常额外 main 干扰全局计数；分别改为冷读历史集合和真实独立 turn 门闩。详细每次命令/日志见本轮 attempt 报告，均未隐藏为成功。

复用已有 round234 准入 23 项、round232 普通 stop/continue 具名 1 项、整组观察新增 8 项及旧 36 项的有效结果，未为重复证明运行旧大套件。上述结果仅证明原局部范围。

## 留给主审的边界

生产正向整树继续和旧回调对后继代次隔离尚未通过；冷恢复、真实模型/原生二进制 EOF、完整 EH/UI、OpenCode 及其它 CLI、Windows/Linux 平台根门禁均未覆盖。没有发布扩展或调用真实模型。

本轮仅增加测试/观察和专属说明，未改变产品合同、权限、运行时状态机或事实来源；不竞争中央设计/计划、功能清单及 ontology 同步。主审修复真实恢复路径时，应同步对应用户行为、代次/资源来源和恢复流程本体，不能把本测试的局部停止证据写成整树恢复已完成。

## Round 239：清理后的同宿主显式继续

Round 237 的失败根因现已修复。原组 Owner 清理成功、旧集合 CLOSED、持久容量归还后，原生产 producer 在内存中签发 continuation provenance，精确绑定旧 scope、完整集合及 leader native session；缺失证明、集合变化、仍有容量、route/session 冲突或冷宿主均不能恢复。继续时通过宿主可信 target API 为同一 Loop task 取得/建立实际 tab，在新代 task/member/leader lease 持久化后、scheduler pump 前开启新的 execution set。新代 Owner 创建新的 execution identity，并仅 resume 原生 thread；不改发旧 prompt，不收养旧集合。原 stopped attempt 和 review event 保留，旧 producer scope 的 admission 仍 sealed。

实体源码副本标准 build 通过。`node --test dist/test/extensionHost/departmenttreecontrolintegration.test.js` 为 2/2 场景通过：两组及唯一 overflow 的整树 stop/fence/真实 Owner 清理/显式新代继续/旧代回调隔离，以及 stop-before-binding 后保留 null 责任并拒绝继续。该受控 fixture 使用固定 Node Codex 协议 CLI 和真实 host/adapter/producer/store/original Owner client，不调用真实模型或 Codex 二进制，不是完整 EH/UI 或冷恢复验收。实际扩展可信 tab/session API 接线已写入源码，但测试直接经生产 fixture composition 验证，不通过完整扩展激活覆盖该 UI 边界；主审仍应审阅 production wiring 与同会话 native resume 合同。

Round 237 原失败证据保留为历史；本轮回归及实现记录见 round-239 attempt 报告。

## Round 240：closing 回调与 continuation proof 生命周期

已获 grant 的 Leader 原生输出回调可以在停止同步封闭 admission 后继续完成，但授权/build/session binding 仍走 `scope`/`canLaunch`。回调每次使用原 generation 的 `observationScope`，并核对闭包中的 Leader 对象仍是当前对象；其 ack 完成后 Owner drain 才能形成完整清理凭证。新 generation 取代 Leader 对象并退休旧 scope 后，旧 scope 的观察会拒绝，不能获取 successor consumer。专门捕获旧生产 delegate 并在 successor consumer 存在时调用的断言确认回调拒绝且 successor handler 调用数仍为零。

producer 仅在原 Owner 全部绑定和 CLOSED set 可核验、容量持久移除后退休。可继续的非 completed 任务持有一次性内存 continuation proof，`openContinuedLeader` 成功后消费；completed 任务会清除 proof。未绑定、未知或失败的执行仍保留 generation、lease 和原始责任，不以退休/强制 teardown 代替证据。

proof 生命周期按 task id 精确读取与清理。创建或退休另一任务时不遍历历史 continuation proof；completed 状态在本任务退休或被查询继续资格时清理，不因此增加累计任务数上限或驱逐仍可继续任务。

Round 240 新增受控生产链路场景：native turn 已获 grant 后由固定协议 CLI 的输出门闩暂停；停止先关闭新授权并保持组长容量，放开输出后真实 callback/terminal、Owner drain、集合关闭与容量归还完成，再显式继续进入 successor。原两组/overflow 整树用例增加 successor 存在时的旧 scope 拒绝断言；普通正常完成用例检查 completed task 不保留 proof；未绑定责任用例确认不能提前 retire。验证范围与未覆盖项见 round-240 attempt 报告。固定协议 CLI 和受控 UI consumer 不代表真实 Codex、完整 EH、冷恢复或跨平台通过。

## Round 326：冷宿主恢复边界

冷宿主只允许对已持久化、唯一且完整的 employee binding 建立只读 Owner 观察。Recovery 按可信任务/attempt、root/workspace、leader/module/generation、固化 CLI/session、selection fingerprint、当前路由和容量租约核对身份，再通过原 `DepartmentExecutionOwnerClient` socket 观察原 Owner；它不启动替代执行，也不因 Owner 返回 `cleaned`、任务 idle 或磁盘 receipt 释放容量。Codex 与 OpenCode 员工的受控 Node Owner fixture 验证新 Recovery 实例对原 binding 的 live/cleanup 观察，以及未知 cleanup、配置不符和 Owner 不可达时失败并保留容量。

组长冷恢复仍 fail-closed。新 Extension Host 没有原 producer 的 generation provenance、原组长 Owner 的可达观察能力和完整聚合器时，运行中组长由 `inspectLeaderSession` 返回 `live: null`，`recoverRoot` 必须返回 `live-leader-unverifiable`；composition 将恢复入口标为失败/blocked，原持久容量不变。旧的 closed execution set 或单个 receipt 不能重建 producer，也不能授权继续、重放 prompt 或释放租约。尚缺可跨 EH 证明原组长 Owner、完整协调执行集合及同一代次状态的安全协议；在该协议形成前不宣称组长或整树冷恢复通过。

本轮新增覆盖为 Recovery 的 Codex/OpenCode 员工原 Owner 只读观察和生产编排层组长未知观察拒绝。它不证明真实 Extension Host 重启后的 owner endpoint 存活、真实 CLI/model、完整 UI 或跨平台恢复。
