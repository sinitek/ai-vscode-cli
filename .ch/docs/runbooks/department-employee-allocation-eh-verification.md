# 员工额度：局部提示/UI/EH 组合验证

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
