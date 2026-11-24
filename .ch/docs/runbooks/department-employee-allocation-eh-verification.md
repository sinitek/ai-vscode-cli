# 员工额度：局部提示/UI/EH 组合验证

## 当前公开 Loop+ 场景

新根必须由公开 UI 创建，持久化 `executionMode: loop-plus`。默认档沿用隔离全局设置 4/20（每组 5）；`--workspace-capacity` 先通过工作区设置控件保存并读回 2/6（每组 3），全局仍是 4/20。两次额度保存都核对真实请求的 `expectedRevision`、同一请求 ID 的成功 settled、持久 revision 加一及 UI 数值读回。保存只改变期望参考值，不改已有占用或上次派发参考。本用例不主动制造过期 revision 冲突。

第一次派发让 `held`、`pulse` 同时真实占用。保存 0 后放行 `pulse`，下一次真正派发 `allocation-zero`，证明零参考不是禁派；恢复为原数值（手动 5 或 3）后，`allocation-restored` 的真实派发才应用恢复值。每个准入核对持久组长及其总监模块、逻辑任务 ID、scheduler 中的 attempt ID 和精确容量键 `[leaderTaskId, attemptId]`；实际组长决策提示必须与生产 reader 和持久快照一致。

收尾点总监群聊的公开中止；原 `held` 的 provider 答复扣留到宿主退出后。验证真实 Webview stop 消息、生产 `department-organization-stop` 的 live/confirmed 记录、持久原 attempt 的 `finished/stopped`、未新增派发以及组长/员工占用全部归还。最后发送正常宿主结束信号，要求退出码 0、无信号，并在退出后重读持久状态。缺少清理确认、仅见任务停止、或宿主提前/异常退出都不是通过。

在已集成源码与实体构建产物的产品树运行两档（每档用新报告路径）。使用现有隔离 HOME、工作区、VS Code profile 及本机确定性 Responses provider；不连接真实用户会话或外部模型：

```sh
node --test scripts/verify_department_employee_allocation_eh_integration.test.js scripts/fixtures/department_employee_allocation_eh_scenario.test.js
build_dir=$(mktemp -d "$PWD/.tmp/allocation-build.XXXXXX")
npm run build -- --outDir "$build_dir/dist"
node --test "$build_dir/dist/test/extensionHost/departmentemployeeallocationehhost.test.js"
node scripts/verify_department_employee_allocation_eh_integration.js --product "$PRODUCT" --report "$PRODUCT/.tmp/allocation-loop-plus-default.json"
node scripts/verify_department_employee_allocation_eh_integration.js --product "$PRODUCT" --report "$PRODUCT/.tmp/allocation-loop-plus-workspace.json" --workspace-capacity
```

当前验证器改动仅有脚本和编译后夹具单测证据；两档公开 EH 实测留待集成产品执行。以下是旧 Owner 路径的历史证据；`verifyCapturedRun` 仍严格重评原绑定、原回执、CLOSED 集合和真实 worker 退出，不使用上面的 Loop+ 判据替代。

## 历史 Owner 场景（Round-440）

本手册属于 round-440 局部候选。生产代码采用已审 da47 热点修复和 e613 提示增量，没有导入并行冷恢复或第二 EH 后继，不代表最终产品树、跨进程 CAS 或发布。

## 来源及物理树

外置工作树：`/Users/fangjiawei/.cache/codex-worktrees/sinitek-ai-vscode-cli/department-allocation-prompt-eh-round440`，分支 `codex/department-allocation-prompt-eh-round440`。基线 `da47ec72295416fd4a7ff7c877bc483d658e77ff`，提示 `e613344552c559b934561ccd3506582955dbe68a`，共同来源 `d35263a5f7d150b57b10668f2ad1c3bf0b066d43`。无冲突组合 commit `08374899d4f162e4a31fa203f80c02dbc3720a1e`，tree `9c84cdf217582f1079b00608bdb75305ab710105`；最终 harness 后继身份及所有路径哈希见 round-440 attempt 报告。

完整七条 e613 增量合入后逐字节核对；其五条已审角色提示、builder、两个测试和契约文档保持来源字节。只有 sources.json 与 Git 交接追加本轮说明。da47 的 policy、store、准入、UI 和 extension 源码未改。业务语义、权限、DTO、生命周期、事实来源未改变，因此不刷新 ontology、功能清单或中央 active 计划。

## 新增最小验证能力

专属 driver 复用 full EH driver 的 `isolatedEnvironment` 和 `createDepartmentWebviewAdapter`，以及已有免费 `createLocalResponsesServer`。专属 TS fixture 复用原公开入口/receipt/Owner 协议观察器，只旁听原产品面板请求/settled、同步准入返回后的快照、原 worker 的真实退出。保留 receiver、参数、返回 Promise 身份和原异常；不调用 writer，不替换 grant，不改 scheduler/任务/额度/容量/receipt，不引入产品测试控件，不改变 UI 文案、布局或交互。

测试入口启动时只执行已有 `openPanel` 公共命令。真实部门创建、角色选择、总监群聊打开、数字保存、恢复均分和停止全部走既有公开 Webview 控件。provider 只控制正常模型响应的时点；观察器不授予身份、容量或执行权。为在保留一个员工的同时产生真实组长事件，初次派发 held 和 pulse 两个独立员工，pulse 完成后仅 held 保持占用；不是手工唤醒 scheduler。

## 命令与隔离

在本实体树使用已有依赖的临时 node_modules 链接，未安装/升级依赖。只执行新增测试与标准 build：

```sh
node --test scripts/verify_department_employee_allocation_eh_integration.test.js scripts/fixtures/department_employee_allocation_eh_scenario.test.js
npm run build
node --test dist/test/extensionHost/departmentemployeeallocationehhost.test.js
node scripts/verify_department_employee_allocation_eh_integration.js --product /Users/fangjiawei/.cache/codex-worktrees/sinitek-ai-vscode-cli/department-allocation-prompt-eh-round440 --report /private/tmp/department-allocation-round440-run4.json
```

每次真实运行均新建隔离 HOME/USERPROFILE/CODEX_HOME/XDG、workspace、VS Code user-data/extensions；没有读取用户凭据。Codex 仅连接免费 loopback Responses，外网代理指向不可用 loopback；未调用付费 provider。最终场景版本：macOS、Node `v24.22.2`、安装版 VS Code `1.144.0`、安装版 `codex-cli 0.167.2`，11 个本地请求，provider 失败 0。未运行无关 CLI 矩阵、第二 EH 或旧浏览器测试。

## 首错与修正，原记录不覆盖

- 首次 build：新增测试误用不存在的 scheduler `.view()`，TS2339；改为现有 `.wait().view`。后续最终标准 build 通过。
- run1：公开创建/员工/保存已真实执行，但替换 VS Code API 实例的观察器未捕获产品消息，`exact real host request required` 失败。改为旁听实际 `LoopGroupChatPanel` 实例，并补 VM 行为测试。该早期失败的清理没有得到完整证明，不能用其宿主退出或遗留容量文件宣称成功；不对原环境进行冷恢复或手工改写。
- run2：真实请求与匹配 settled、desired/revision 独立保存通过；场景后续任务遗漏现有 `independentSubtaskIds`，宿主拒绝决策。修复夹具归属并补真实生产 parser 测试。该失败的公开 stop 后清理未确认，不作清理证据。
- run3：保存 0、下一次真实尝试拒绝、恢复及正常准入、提示均通过；完整 receipt/CLOSED/容量归还已到达，但旧观察器未记录进程退出，等待 close 超时，附带 CDP 清理期限耗尽。增加只保留观察句柄的退出旁听，不 ref/kill worker；修复 adapter cleanup 预算。
- run4：以上业务阶段再次通过；新观察器捕获全部 4 个真实 `exit(0,null)`，但 Electron 不发出随后等待的 close，原 driver 报告仍是失败。修正最终条件为真实 exit，并对 run4 现有证据只读重评，通过；不为刷新结果重跑同一场景。

run4 原记录：`/private/tmp/department-allocation-round440-run4.json`，原隔离目录 `/var/folders/49/shyk0sxs3qg15d9w_npw48z80000gn/T/s-allocation-eh-yOXhqC`，时间 `2026-11-16T05:11:46.675Z` 至 `05:14:47.005Z`。run1/2/3 的同名前缀报告均保留。最终源码的 main 退出断言已修正，但没有再完整运行最新 driver；这是明确的验证边界，不能声称原 run4 命令 exit 0。

最终只读复核命令（原运行和首次复核记录均不覆盖）：

```sh
node - <<'JS'
const fs = require('node:fs');
const { verifyCapturedRun } = require('./scripts/verify_department_employee_allocation_eh_integration');
const result = verifyCapturedRun('/private/tmp/department-allocation-round440-run4.json');
fs.writeFileSync('/private/tmp/department-allocation-round440-final-evidence.json', JSON.stringify(result, null, 2), { flag: 'wx' });
console.log(result.result);
JS
```

此操作不启动 EH、不生产 receipt、不释放租约、不迁移任何状态。它核对原运行源码哈希（仅声明修复了 driver 断言）、实际消息/settled、持久状态及捕获的真实 provider 提示；然后严格验证原 required receipt、完整 CLOSED 集合和相同 pid 的 `exit(0,null)`。所有 worker 退出都早于正常 host-finish 控制信号，不以宿主退出替代清理。补充报告保留原失败、源码哈希及证据文件哈希。原运行报告仍 failed，补充证据报告 passed。

## 最终观察事实

| 边界 | revision | manual | applied | 本组占用 | 结果 |
| --- | ---: | --- | ---: | ---: | --- |
| 初次两个真实员工准入后 | 2 | null | 5 | 2 | 默认 4/20，每组 5 |
| UI 保存 0 并收到匹配 settled | 3 | 0 | 5 | 2 | UI 下次生效；Owner/责任/容量不变 |
| pulse 完成后真实新 attempt | 4 | 0 | 0 | 1 | group-limit 拒绝；全局余额 19；无该 attempt Owner/责任/租约 |
| UI 恢复均分并收到匹配 settled | 5 | null | 0 | 1 | desired=5，仍下次生效；原员工保留 |
| 后续真实新 attempt | 6 | null | 5 | 2 | 常规准入，原 held 员工仍在；无 overflow |
| 公开 stop 后 | 6 | null | 5 | 0 | 4 原 Owner receipt，1 CLOSED 集合，4 自然退出，leader/employee 容量均归还 |

实际 provider 捕获 initial、zero-pending、zero-applied、restored-applied 四个组长决策；各自 revision/source/desired/applied/pending/活动数/本组与全局余额与生产快照一致。held/pending 的原身份没有靠历史 seenAttempts 推算人数；被拒 attempt 具有不同生产身份，后续恢复任务也有新身份。未知本组/有效全局边界复用 e613 原 34 项的对应范围，没有为本场景制造未知组织。

新增测试最终范围为 driver 5、scenario 3、TS fixture/生产 reader→提示 5，共 13 项通过（分组执行，非全套一次执行）。纯策略 13、原 UI/浏览器、builder 34、da47 定向 11 继续按未变输入复用，不把分树证据扩大成最终组合全量验收。

## 开放边界

本轮只关闭实际嵌套 reader→提示和总监真实 UI→EH 保存→下次准入两个集成缺口；不是最终产品接受审查。最终额度/提示/冷恢复统一树、第二 EH 与恢复证明、必要平台、远端 Git 同步合理合并、实际最终合并树全量回归仍开放。没有改 Owner/Ledger、receipt、CLOSED、墓碑、恢复回调或清理标准；没有 fetch/pull/push/发布。


## Round-698：最终接受树上的工作区人数与额度组合

本节独立于上述 round-440 历史。旧 run4 的只读重评、40c 的 53 项与双视口 router/store 烟测均不覆盖最终树的实际设置 UI→安装版 EH/CLI。本轮只补工作区 2/6 的这个缺口，不重跑旧默认实机矩阵，不代表整个部门功能或最终全量回归完成。

生产起点为已接受 `464d1113f13b1bc0f2b59ea1ba4c09976ebed713`，tree `cb6ef3649b90ed1a7dbe3b9ea78a83c503f63bd4`。独立工作树 `/Users/fangjiawei/.cache/codex-worktrees/sinitek-ai-vscode-cli/department-workspace-allocation-eh-round698-20261116`，分支 `codex/department-workspace-allocation-eh-round698-20261116`。只改专属 driver/scenario/被动 fixture、对应测试与本手册；公共 full EH driver 和所有生产源码保持基线字节。

从只读整合工作树 `department-mainline-integration-round676-20261116` 物理复制 1674 个 dist 文件，复制前、来源复制后及目标 SHA-256 manifest 相同。依赖也物理复制并解引用，不安装、不升级、不共用链接。来源/输入记录 `/private/tmp/department-round698-product-copy.json`；新增 TS 夹具用 `node node_modules/typescript/bin/tsc -p ./` 编译，成功。编译后与来源 manifest 比较，仅本轮 fixture/test 的两个 JS 和两个 map 不同，其余所有产物相同；记录 `/private/tmp/department-round698-compiled-identity.json`。标准 build 的生产基线证据复用 lp695，本轮没有重新执行 `npm run build`。

新增 `--workspace-capacity` 可选参数；无参数仍保留 4/20 入口，并以单测保留默认行为。通过 `#toolSettingsWorkspaceTab` 和原 number/change 控件分别输入 2、6；初始工作区文件不含人数，初始全局显式为 4/20。每项等待实际原宿主 `workspaceDepartmentCapacitySaved` 的匹配 scope/requestId/key、回执时磁盘值、后续原 panel state 及控件恢复，再通过原控件启用部门、选择总监 CLI/profile/config-declared model、组长/员工角色并创建部门。不直接发送桥消息、不调用配置解析或 composition 代替创建。

被动 fixture 旁听实际 `CliBridgeViewProvider` 接收/发送、原 composition 返回的 `readEmployeeCapacity`、准入返回和原 worker exit。读方法仅在产品原调用时旁听，保留 receiver、参数、返回值/Promise 身份和原异常；不调用 writer、授权、释放或制造 receipts/CLOSED。provider 的四个组长决策保存完整实际提示、当时持久快照与原 reader 返回，核对 source/revision/desired/applied/pending、全局和本组真实余额。

最小验证（按变更后有效结果分组复用，共 19 个测试）：

```sh
node --test scripts/verify_department_employee_allocation_eh_integration.test.js scripts/fixtures/department_employee_allocation_eh_scenario.test.js
node node_modules/typescript/bin/tsc -p ./
node --test dist/test/extensionHost/departmentemployeeallocationehhost.test.js
# 总监模型 harness 修正后，仅重跑受影响 driver，scenario/TS 夹具输入未变
node --test scripts/verify_department_employee_allocation_eh_integration.test.js
SINITEK_ALLOCATION_EH_TIMEOUT_MS=240000 PLAYWRIGHT_MODULE=/tmp/zq-playwright-smoke/node_modules/playwright node scripts/verify_department_employee_allocation_eh_integration.js --product /Users/fangjiawei/.cache/codex-worktrees/sinitek-ai-vscode-cli/department-workspace-allocation-eh-round698-20261116 --report /private/tmp/department-allocation-round698-run2.json --workspace-capacity
```

保留首错：首次脚本检查有新增 held-binding 断言多余右括号，driver 解析失败；scenario 5 项已通过，修正后脚本 12 项全通过。首次真实运行 `/private/tmp/department-allocation-round698-run1.json` 于 `ab99922e7fbda0669f22a4adbffeb28ffec21bfc`（tree `1e44d31d7f41edd5879db4de0468fc20cce3324b`）已通过工作区 2/6 UI 保存，但 harness 错把总监配置声明模型当成空值默认选项。失败于 `#modelSelect=`，未创建根任务或启动绑定 worker；正常宿主退出。修正为等待并选择真实 `gpt-5` 选项，补公开操作顺序单测；最终 driver 8、scenario 5、TS fixture/真实 reader composition 6 项通过。保留 `/private/tmp/department-round698-script-tests-fixed.log`、`department-round698-driver-tests-final.log`、`department-round698-driver-tests-model-fix.log`、`department-round698-host-tests.log`、`department-round698-tsc.log`。

第二次为真正的新运行，源码 commit `b992d3b668c495f398fa20d4620166733a0bf86b`，tree `4c81a722d26544eed4c7d0402b446ba7e192ed3d`；2026-11-16T10:16:17.221Z 至 10:16:37.266Z，命令 exit 0、报告 passed、failures 空。macOS、Node v24.22.2、安装版 VS Code 1.144.0、codex-cli 0.167.2，11 个免费 loopback 请求、provider failures 0。运行目录 `/var/folders/49/shyk0sxs3qg15d9w_npw48z80000gn/T/s-allocation-eh-aCwmnY`；所有 HOME/USERPROFILE/CODEX_HOME/XDG/workspace/VS Code profile/extensions/CDP/provider 均新建隔离，无用户凭据或付费模型。

| 边界 | revision | desired | applied | 实际员工占用 | 事实 |
| --- | ---: | ---: | ---: | ---: | --- |
| 新根，两个员工实际准入 | 2 | 3 | 3 | 2 | root/capacity/allocation 均 2/6，全局仍 4/20 |
| 原总监 UI 保存 0 | 3 | 0 | 3 | 2 | 原 binding/责任/容量逐值不变，UI 下次生效 |
| pulse 完成，下一真实 attempt | 4 | 0 | 0 | 1 | group-limit；全局余额 5；被拒 attempt 无 Owner、租约、责任 |
| 原 UI 恢复均分 | 5 | 3 | 0 | 1 | 匹配 settled，下次生效；held 保留 |
| 后续真实 attempt | 6 | 3 | 3 | 2 | 正常准入；原 held binding 与身份保持，无 overflow |
| 公开 stop | 6 | 3 | 3 | 0 | 4 原完整 required receipts、1 精确 CLOSED 集合、容量全归还 |

provider 实际决策 initial/zero-pending/zero-applied/restored-applied 的 revision 分别 1/3/4/6，本组与全局活动员工分别 0/1/1/1；额度余额分别 3/0/0/2，全局余额 6/5/5/5，source 为 default/manual/manual/default，与同刻生产 reader 和持久快照一致。restored-applied 提示是在恢复员工完成后生成，因此该时点只剩 held；不能与前一行准入瞬间占用 2 混同，也不用历史 attempt 数推算人数。

严格原清理证明已在实际 driver 内通过：4 个绑定 worker pid 32605、33286、32500、32572 全部实际 `exit(0,null)`，时间都早于正常 `host-finish.signal`。宿主随后 exit(0,null)，CDP 断开和 provider 正常关闭，没有强杀。额外只读身份/清理核对 `/private/tmp/department-round698-run2-identity-and-cleanup.json` 记录原报告/原始事件哈希、全部 1674 产物和运行输入哈希一致、上述退出先于 finish、四份实际 reader/快照存在，以及本轮 provider 51964/CDP 51965 端口已关闭；端口关闭不充当容量清理证明。

本轮成功后只更新本手册/交付报告，不改运行源码或产物，已有成功输入仍有效，不再实机重跑。没有重新执行空值继承/非法输入/旧 scope/双主题、Tabs/头像矩阵、旧默认 EH 场景、其它 CLI、第二 EH 或全量回归；既有未变覆盖由其原报告承担。本轮没有新增截图或独立浏览器 console 审计，原 VS Code 日志保留（其中内置扩展有无凭据和阻断网络诊断），不能宣称整个工作台零 console 消息。冷恢复与最终全量接受审查仍归其它门禁。本分支提交应合理合入原整合分支，未修改该分支或共享 master，未发布/推送。
