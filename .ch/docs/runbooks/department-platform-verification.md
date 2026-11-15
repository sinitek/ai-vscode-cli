# 产研部平台验证入口

`scripts/verify_department_platform.js` 为 Windows/Linux 的真实主机验证提供统一入口。脚本只使用主机报告的 `process.platform` 和 `process.arch`，不会接受平台模拟参数。入口自身的自动化行为测试不是平台生产证据。

## 前置条件

- 在目标 Windows 或 Linux 主机准备一份物理隔离、已构建的产品副本；副本须在共享仓库之外，`src/`、`dist/` 和产品根目录不能是符号链接或重解析目录。`node_modules/` 可以沿用已有依赖链接。脚本不安装依赖。
- 副本应由标准 `npm run build` 构建，并包含当前源码、`dist/` 及产品自身的 `scripts/verify_department_full_eh_integration.js`。如只更新了 JavaScript 验证入口且 TypeScript 源码未变，可复用该副本原有构建；不要对共享仓库运行会清理 `dist/` 的构建。
- 报告使用新的绝对路径。公开 EH scope 还会在相同目录创建 `<报告名>.public-eh-child.json`，此子报告也必须不存在。

## Windows

从仓库脚本所在目录运行，示例路径需替换为实际隔离副本和新报告位置：

```powershell
node .\scripts\verify_department_platform.js --product 'C:\department\product build' --report 'C:\department\reports\owner-core-win.json' --scope owner-core
node .\scripts\verify_department_platform.js --product 'C:\department\product build' --report 'C:\department\reports\public-codex-win.json' --scope public-codex
```

## Linux

从仓库脚本所在目录运行：

```sh
node scripts/verify_department_platform.js --product "/srv/department/product build" --report "/srv/department/reports/owner-core-linux.json" --scope owner-core
node scripts/verify_department_platform.js --product "/srv/department/product build" --report "/srv/department/reports/public-codex-linux.json" --scope public-codex
```

两种 scope 都应在对应真实主机分别运行并保留 JSON 报告。入口记录真实 `process.platform`、`process.arch`、Node 版本、执行 argv、退出码/信号、TAP 统计、入口 realpath/hash、产品源码与 dist 哈希，以及覆盖门禁。Owner 固定运行产品编译目录中的 `departmentexecutionowner.test.js`、`departmentexecutionownerclient.test.js` 和 `departmentprocessexecutionlauncher.test.js`；每个文件必须实际注册至少一个成功用例，零用例、跳过、取消、统计缺失/重复、超时或失败均拒绝。该范围通过真实 Node 进程、IPC 与既有客户端/worker fixture 检查 Owner 核心合同；它不证明 Extension Host 的真实 EH/tab 释放、根资源清理、冷恢复或完整平台验收。

`public-codex` 以新建报告路径调用产品自己的 `verify_department_full_eh_integration.js`，使用其默认全 Codex 公开新建场景、隔离用户目录、本机 loopback provider 和既有宿主退出/回收规则。父入口只有在子进程退出为零、子报告存在且记录 `result: passed`、无失败、无强制 teardown、三角色均为 Codex，且实际阶段状态符合 driver 合同（包括 `rootCreation: observed`、`directorExecution: completed`、`leaderExecution: observed` 和其余必需阶段 `passed`）时才成功。运行会按既有 EH harness 执行，可能需要已安装 VS Code、Codex CLI 和 Playwright；它不是模型质量测试。

两个范围分别报告，不能互相代替。报告中的 `execution.cleanup` 分开记录 driver close、追踪完整性、已观察直接子进程、回收尝试、强制操作、已观察进程关闭及整树关闭确认。追踪记录必须先出现 `tracker-ready`；文件缺失、损坏、溢出或 preload 写入失败均报告 `unconfirmed`。POSIX 只在原始 PID 与追踪期间记录的启动身份仍匹配时发信号；不会从已关闭/可能复用的根 PID 重新发现进程。Windows 当前没有安全的 PID 启动身份核验能力，因此不运行 `taskkill`，即使直接子进程均已关闭也不证明整树关闭。直接子进程追踪不覆盖任意后代创建的进程，报告将 `trackedProcessesCloseConfirmed` 与 `detachedTreeCloseConfirmed` 分开；后代边界无法完整观察时后者保持 `unconfirmed`。这可能使 `public-codex` 在当前追踪能力下保持失败，需补齐可证明的进程树追踪合同后再开放对应门禁。任何超时、信号中止、缺失/失败报告、零用例、跳过或强制进程回收一律失败，不得补记 Owner drain、receipt 或容量释放成功。

追踪器创建时生成的 `events.error` 路径显式传给 preload、观察器和回收器；不使用 `events.jsonl.error`。读取/观察/写入失败会在本次执行中保留，后续看似完整的解析不能将其改为通过。记录需符合类型与字段合同，未知类型、结构坏记录、无换行的截断记录及未完成的 spawn 请求不能证明零 spawn；事件文件上限仍为 256 KiB。若记录和错误 sidecar 均无法写入，preload 向有界诊断流写固定失败标记并退出 74，入口将追踪状态记为失败/未确认。

`driverExitObserved`、`driverCloseObserved` 与 `driverTermination` 分开记录直接驱动状态。POSIX 在本次驱动的 `spawn` 事件时采样 PID、父 PID、进程组和启动时间，终止及升级前重新核对；已经退出/关闭、身份改变或无法核验时跳过信号并记录原因。Windows 仍不调用 `taskkill`。单次收尾结束后才删除 tracker 并释放自有 timer/listener；任何进程卫生结果均不替代 Owner receipt、排空或容量门禁。

`node --test scripts/verify_department_platform.test.js` 仅验证入口自身：参数与路径拒绝、含空格路径、临时 TAP 子程序的零/混合/跳过/取消统计、报告合同、追踪缺失/坏行/溢出/写入失败、PID 身份变化拒绝、Windows 决策分支、close/timeout 竞态，以及受控 POSIX 分离后代的有界回收。Windows 分支测试使用注入端口，不是 Windows 实机证据；POSIX 后代测试证明本次记录的进程身份处置，不证明任意后代均可发现。测试不启动部门生产 suite、CLI、真实 EH 或 VS Code，也不能作为 Windows/Linux 实机证据。完成代码修复后仍须分别在 Windows 与 Linux 实际运行上面的产品命令；没有实机报告的平台及 `realTabAndRootCleanup`、冷恢复门禁继续开放。

新增边界用例通过真实 preload 和临时子程序制造 `events.error`，核对真实路径消费及失败状态保留；另覆盖双写失败、结构坏记录与真实零 spawn，以及注入观察/信号端口下退出或关闭后不处置、等待期间身份改变不升级、正常有界终止和包装器状态接线。这些端口测试不向非自有进程发信号，也不作为异平台实机证据。

有界收尾结束后若尚未观察到 driver close，入口对本次创建的 `ChildProcess` 执行 `unref()`，并销毁本次创建的 stdout/stderr 读取管道，避免仍活动的驱动或后代继承的管道阻止入口自然退出。`cleanup.localHandleRelease` 单独记录本地句柄释放或失败；Owner 范围在各 `ownerTestProcesses` 条目内记录。正常 close 已观察时记为 `not-needed-after-close`。释放不会发信号、调用 `taskkill` 或强制退出入口，也不关闭调用方资源。输出流错误会记录为执行失败；移除执行监听器后只保留资源自身的迟到错误保护，待该资源 close 时移除。释放触发的本地 close 不改写此前 `driverExitObserved`/`driverCloseObserved`，未观察关闭的整树仍为 `unconfirmed`；超时仍失败，不代表 Owner 清理或容量归还。

句柄边界测试使用独立外层 Node 进程、含空格临时路径及自行到期的自有程序，分别验证拒绝终止但驱动仍活动，以及驱动已退出但后代仍持有输出管道时，外层能在程序到期前自然退出。外层 watchdog 仅作失败边界，不作为通过依据；测试等待自有程序到期后清理临时文件。它们与原 POSIX 分离后代和单次回收测试一起验证入口行为，不构成 Windows/Linux、生产 Owner 或真实 EH 验收证据。

## macOS Owner 入口集成记录（round-403）

2026-11-15 17:02:38.621–17:03:01.277 UTC，在真实 `darwin / arm64 / Node v24.22.2` 主机执行一次 `owner-core` 入口，退出 0、报告 `passed`。这是包装器到真实产品编译套件的接线证据，区别于入口自身 22 项临时程序行为测试；没有重跑该行为文件或公开 EH 场景。

产品为新实体副本 `/private/tmp/round403 owner integration t5qg2dxa/physical product`，`src/dist/scripts` 均为实体目录，仅 `node_modules` 复用已有依赖链接。源码与产物的 2414 个文件执行前后均匹配 round-400 最终清单 `/tmp/round400-source-dist-manifest.json`，并匹配已标准构建的 `/tmp/round400-final-product-p5j9bna5`；40 份 runtime/测试及 CLI 进程源码与当时共享仓库一致。复用该构建，没有重新 build 或清理共享 dist。入口复制进产品，实际从宿主 cwd 调用，执行入口与产品入口 SHA-256 均为 `30868398c33fcd5cbb1b0ee1acc0e06a297ebfb4c80c237f026ec87d043504fe`。

```sh
node scripts/verify_department_platform.js --product '/private/tmp/round403 owner integration t5qg2dxa/physical product' --report '/private/tmp/round403 owner integration t5qg2dxa/owner-core-macos.json' --scope owner-core
```

该命令是已执行记录，报告已存在，不能用相同报告路径重跑。三个实际 Node 子命令均固定使用 `process.execPath --test --test-reporter=tap <编译测试绝对路径>`：

| 编译测试文件（`dist/test/runtime/`） | 实际注册 / 通过 | exit / close 观察 | 退出码 |
| --- | --- | --- | --- |
| `departmentexecutionowner.test.js` | 26 / 26 | true / true | 0 |
| `departmentexecutionownerclient.test.js` | 12 / 12 | true / true | 0 |
| `departmentprocessexecutionlauncher.test.js` | 20 / 20 | true / true | 0 |

合计 58/58；每份 TAP 统计完整且唯一，fail/cancelled/skipped/todo 均 0，无 signal、timeout、执行错误或强制回收。三份 `localHandleRelease.status` 均为 `not-needed-after-close`，真实 close 已观察，没有依靠销毁管道制造通过。

Owner scope 当前未传 `trackSpawnedChildren`，所以本次追踪完整性为 **not-enabled**，没有 spawn preload/后代完整性证据。读取 `tests[].processExitObserved/processCloseObserved` 或 `execution.cleanup.ownerTestProcesses[]` 的逐进程事实；顶层 `cleanup.driverCloseObserved=false` 是未填充的聚合默认值，不能覆盖这些逐进程观察。顶层 `detachedTreeCloseConfirmed=null` 也不是确认，整树结论仍为 **unconfirmed**。本次只证明固定 Owner 核心套件经包装器运行及 TAP/退出消费正确，不证明包装器的后代追踪已经与生产套件集成，也不证明任意后代关闭、真实 EH/tab、根资源清理或整个平台收口。不得把测试里的受控资源/receipt 断言提升为真实 EH 的清理证据。

原始报告为 `/private/tmp/round403 owner integration t5qg2dxa/owner-core-macos.json`（SHA-256 `1716ed40bf0ef2994cfa27d46c8f90a24f8a7ceb7a028cfd13687bee5f2f8c05`）；同目录 `pre-execution-manifest.json` 保存构建来源和源码/产物哈希，`execution-audit.json` 保存报告只读核对、外层退出状态及追踪边界说明，不改写原始报告。

Windows/Linux 的 owner-core 和 public-codex 实机报告仍缺失；本轮未获得已配置且已授权的异平台主机/执行端口，不猜测远程地址或读取用户连接配置，不重复诊断既有 Docker/异平台工具不可用事实。恢复条件是在真实目标主机提供物理隔离的标准构建产品、已有依赖和新的绝对报告路径，按上文分别执行；public-codex 还须满足 VS Code、CLI、Playwright 及可证明的后代关闭前置。真实 tab/root 清理、冷恢复、连续 EH，以及最终 Git 同步/合理合并和合并树全量回归均保持开放。
