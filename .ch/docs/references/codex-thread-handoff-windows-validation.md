# Codex thread 交接 Windows 验证记录

- 日期：2026-11-12。
- 范围：Windows 原机的回归夹具修复及隔离真实 CLI 协议验收。
- 当前阶段（round 11）：最终共享构建、331/331 汇合回归、默认三轮兼容交接全部通过；新增公共 runner live 在真实 0.162.1 上确认即时策略，交接 37 ms，新增证据/超时回归 8/8。另有一次观察器失败及被策略拒绝的遗留目录清理，详见下段；原生跨平台和真实 VS Code 多窗口仍未验收。
- 以下“夹具/清理”历史轮次没有修改产品生命周期、依赖或 CLI 版本；后续公共产品修复另见下段，不能把旧夹具证据当跨平台产品验收。

## 后续公共产品修复

- 受控协议已证实共享 readLoop 等待用户处理器，阻塞其它会话 RPC/closed；现仅异步分离原生交互请求，绑定原 thread/listener/操作身份，热停止与关闭按原生协议取消，迟到回答无效。notLoaded 确认仅补充原有释放证据，不延长 75 秒、不重试失败 resume。
- CODEX_THREAD_HANDOFF_FAILED 增加中文阶段提示及安全 diagnostic；未知超时不归为协议不支持。能力策略已于 round 9 接入公共 runner；有效配置指纹已汇合。早期隔离编译的历史证据与本轮共享构建分开记录。
- Windows 既有 pool 单轮只证明其原覆盖；本轮补齐经过公共 runner 的真实能力/参数/释放链路。当前产品事实见 [CLI 运行参考](cli-runtime-reference.md)，执行状态见 [公共修复计划](../exec-plans/active/2026-11-12-bugfix-codex-release-state.md)。

## 汇合门禁与公共 runner 实测（round 11）

- 新增 `scripts/verify_codex_runner_unload.js`：真实调用 `CodexInteractiveRunner.runStreamed` / `updateOptions`，仅转发并观察实际能力解析和 spawn。临时 HOME/workspace、白名单环境、禁用插件同步、127.0.0.1 模型返回带固定标记的 400；每次回合须由该标记拒绝且收到原生 failed completion。显式改变 configFingerprint，恢复同一原 thread，另一原 thread 在旧进程继续回合，不直接 acquire pool、不 mock 能力、不重试 resume。
- 实际 `C:\Users\fangjiawei\AppData\Roaming\npm\codex.CMD --version` 为 0.162.1 / supported；两个真实 app-server 最终 args 均含 `-c thread_unload_delay_secs=0`，保留项目 trust 与 `--listen stdio://`。以旧进程真实 `thread/closed` 先于新进程原 thread/resume 为释放证据，交接 37 ms；4 次本地模型请求。能力探测、两个 app-server 及 taskkill 均 exit/close，全部 stdio close，HTTP 关闭、探测 HOME 与本次临时根删除。
- 初次 `npm run build` 及 `node --test dist/test/core/codexRunnerUnloadAcceptance.test.js` 通过，新增断言当时 7/7。首次 live 因链接脚本从旧 dist 找模块而在创建资源前失败，改用当前 cwd 的 dist 后通过（37 ms）。
- 默认命令 `node scripts/verify_codex_thread_handoff_acceptance.js --live --report "$env:TEMP\codex-handoff-round11-final-default-20261112.json"` 退出 0；自带共享 `npm run build` 通过，受影响回归 331/331、无跳过；默认 3/3，耗时分别 60145、60175、60103 ms，均验证冲突、原 thread、另一会话及严格清理。未传 `--runs`、未修改原 pool verifier 的固定 args/default-delay 场景。日志同名 `.log`。
- 随后收紧回合错误标记断言，并用门禁共享 dist 复验时，Windows 模块路径大小写产生不同 cross-spawn 实例，观察器漏记真实进程，且超时 race 留下后台轮询；该次报告 `codex-runner-unload-round11-final-strict-20261112.json` 为 failed，不能算通过。修复为从 runner 的模块位置 createRequire 加载同一依赖、有界轮询自行结束；仅重跑隔离编译和新增最小回归，最终 8/8（含超时不继续调度）。
- 最终命令：设置 `SINITEK_CODEX_HANDOFF_MODULE_ROOT=C:\work\sinitek-ai-vscode-cli\dist`，执行 `node scripts/verify_codex_runner_unload.js --live --report "$env:TEMP\codex-runner-unload-round11-final-fixed-20261112.json"`，退出 0，得到上述 37 ms 与完整清理证据。报告/日志均使用独立路径；导出的证据校验逻辑保留 supported/unknown/unsupported 正反向断言。unknown/unsupported 的真实 CLI 本轮未安装或验证。
- 失败复验的 verifier PID 9512 经唯一报告参数核对后定向停止，针对该 PID/临时路径的进程查询未见关联 node/cmd/codex；该次 stdio 关闭缺失不可追认。其临时目录 `C:\Users\fangjiawei\AppData\Local\Temp\sinitek-codex-runner-3kJqJM` 清理先报 EPERM，后续显式 Remove-Item 被自动审批以 `blocked by policy` 拒绝，仍保留，需宿主处理。最终成功 live 的资源独立且均已清理。
- 默认门禁后仅改新增验证脚本/新增测试及文档；没有改公共运行时代码、原 pool/acceptance 脚本或其 331 项源测试，已有门禁仍覆盖当前产品改动，不为刷新证据重复执行。后续新增测试已隔离全量 TypeScript 编译通过；历史 noEmit、ontology 9/9、归属 10/10、指纹 13/13 等事实按原覆盖复用。
- 仍未覆盖：原生 macOS/Linux、真实 VS Code 多窗口/Loop+ 调度、其它 CLI、真实模型、未知外部 writer。此脚本显式切换配置身份，不将其作为有效配置内容指纹算法的新 live 证明；该算法沿用已有 13 项受控证据。计划保持 active，主任务还需评审，不能据 Windows 受控/live 宣称全局验收完成。

## 环境与边界

- 仓库：`C:\work\sinitek-ai-vscode-cli`，基线 commit `1d6c82489ed8ee8d64ef7e0c2a2189859823eb2a`。
- 系统：Microsoft Windows 11 专业版，10.0.26200，ARM64。
- Node：v24.20.0，win32 / arm64；Codex：codex-cli 0.162.1。
- 用户报告的扩展版本为 1.9.1。工作期间出现另一任务的 `package.json` 1.9.1 → 1.9.2 修改，本轮保留且不计入修复范围。
- 真实验证沿用现有脚本的临时 CODEX_HOME、临时工作区和 127.0.0.1 模拟服务，不调用付费模型，不读取真实用户会话。只清理本次脚本创建的进程和目录。

## 四项失败的复现与分类

| 用例 | 分类 | 证据与修复 |
| --- | --- | --- |
| `Codex runner stop requests shutdown for every active app-server child` | 平台断言及夹具问题 | Windows 不调用 POSIX 负 PID 进程组 kill，旧断言得到 `[]`。旧 spawn mock 还把 taskkill 当作新 app-server。分流 taskkill，校验目标 PID 和参数，分别断言 Windows / POSIX 请求；请求后仍须显式模拟目标退出。 |
| `configuration migration hands off only the target thread and compaction preserves identity` | Windows 生命周期夹具问题 | 独立运行亦在约 75107 ms 后于最后一次 `compactThreadOnce` 失败。unsubscribe / thread/closed 夹具已存在；最后切换连接时需要旧进程退出，taskkill 被误建为 app-server、目标没有 exit/close，保护正确拒绝交接。补成功 taskkill 和独立目标退出事件，并给 POSIX 假进程补完整退出。 |
| `unsafe handoff fails closed for exiting and preserves ownership` | 终止请求统计夹具问题 | 交接本身按预期超时、未 resume、所有权保留；最后仅统计 child.kill，Windows taskkill 未计入，导致 false / true。改为统计平台终止请求，保持成功 taskkill 后目标未退出，并新增实际 close 后才能交接的断言。 |
| `shared reuse flow rejects a CLI that does not match its factory or registration` | CRLF 行尾断言问题 | 五类负向探针已产生 TS2740 / TS2322 / TS2741 / TS2345；最后用 split("\n") 和整行相等查找锚点，CRLF 留下 \r，使 anchorLine 为 0。统一按 CRLF / LF 拆行，显式断言锚点存在，两种换行均验证完整正向、负向探针及诊断范围。 |

基线命令在四个文件上用 `--test-name-pattern` 精确选择上述四项，结果 0/4、skipped=0、退出码 1；复现时通过系统临时目录下的预加载 guard 阻止真实 taskkill 和 process.kill。没有直接修改 dist；修复后的测试直接使用源码中的终止拦截。

## 修改范围

- `src/test/interactive/codexProcessFixture.ts`：复用 taskkill 分流、假 PID/参数核对、异步完成与可独立控制的目标退出；阻止假 PID 的真实 POSIX 信号。
- `src/test/interactive/codexRunnerLifecycle.test.ts`：使用公共夹具、平台请求断言、退出事件及失败时清理。
- `src/test/interactive/codexRunnerReuse.test.ts`：使用公共夹具并完整模拟目标退出，清理期间不遗留假进程所有权。
- `src/test/interactive/codexThreadHandoff.test.ts`：独立统计终止请求，明确验证成功请求并不释放所有权、实际退出才允许恢复。
- `src/test/interactive/codexAppServerNdjson.test.ts`：同组假 PID 配套终止拦截及完整退出状态，避免依赖缺失 exitCode / signalCode 的偶然行为。
- `src/test/interactive/manager.test.ts`：完整保留类型安全验证，兼容并验证 LF / CRLF。
- `scripts/verify_codex_thread_handoff.js`：临时配置禁用插件同步；补齐 RPC 等待边界；清理超时涵盖 HTTP close，跟踪进程及 stdin/stdout/stderr close，目录删除后才输出 `cleanup_verified`。失败保留各项状态及临时根路径，不增加超时、不销毁管道。
- `src/test/interactive/codexHandoffCleanup.test.ts`：覆盖 exit 后尾部输出及全部 stdio close、HTTP/stdio 超时、目录删除失败和延迟产生的终止辅助进程。
- `scripts/verify_codex_thread_handoff_acceptance.js`：报告显式记录实际 `codexCommand`，区分 npm 启动包装与同版本原生可执行文件。

## 实际验证

```powershell
npm run build
node --test --test-name-pattern 'stop requests shutdown|configuration migration hands off|unsafe handoff fails closed for exiting|shared reuse flow rejects' dist/test/interactive/codexRunnerLifecycle.test.js dist/test/interactive/codexRunnerReuse.test.js dist/test/interactive/codexThreadHandoff.test.js dist/test/interactive/manager.test.js
```

- 构建通过。四项定向测试 4/4，通过、无跳过，退出码 0；迁移用例约 80 ms。
完整相关回归命令：

```powershell
$handoffTests = @(Get-ChildItem -LiteralPath dist/test/interactive -Filter '*.test.js' | Where-Object { $_.Name -match '^(codex.*|manager|runnerLifecycle.*)\.test\.js$' } | ForEach-Object { $_.FullName }) + @('dist/test/core/promptRetry.test.js', 'dist/test/core/contextCompactionRunner.test.js', 'dist/test/core/codexThreadHandoffAcceptance.test.js')
node --test @handoffTests
```

- 结果 236/236，fail=0、cancelled=0、skipped=0，退出码 0；完整输出位于 `$env:TEMP\codex-handoff-regression.log`。

```powershell
$env:CODEX_COMMAND = Join-Path $env:APPDATA 'npm\node_modules\@openai\codex\node_modules\@openai\codex-win32-arm64\vendor\aarch64-pc-windows-msvc\bin\codex.exe'
& $env:CODEX_COMMAND --version
node scripts/verify_codex_thread_handoff_acceptance.js --live --runs 3 --report "$env:TEMP\codex-handoff-acceptance.json"
$LASTEXITCODE
```

- 此前原生三轮：三轮均完成冲突复现与交接（60115、60145、60155 ms），前两轮清理成功，第三轮 PID 6204 exited=true、closed=false；最终 passed=false、完成 2/3、退出码 1。报告和日志保留于 `$env:TEMP\codex-handoff-acceptance.json`、`$env:TEMP\codex-handoff-acceptance.log`，本次不覆盖或重复执行综合验收。

## 本次隔离清理根因与修复

- 首次指定命令使用默认 `codex`，真实输出 `writer_conflict_reproduced` 和 `handoff_verified`，交接 60194 ms、原 thread 恢复、另一会话保留、本地 HTTP 请求 1 次；但清理等待超时，报告为 passed=false、completedRuns=0、退出码 1。原失败报告保留在 `$env:TEMP\codex-handoff-acceptance.cleanup-failed.json`。
- 原生双进程只初始化、不建 thread、不访问模型，空闲 61 秒亦复现第一进程退出但 stdout/stderr 无 EOF；保留 NDJSON 读取、改用 overlapped 管道、合并 taskkill 都未解决。不能归因 npm，也无证据要求修改 pool/reader 生命周期。
- 仅查询本次 PID 的后代发现空 HOME 自动启动 `git fetch https://github.com/openai/plugins.git`。Windows Git 启动器 PID 2656 退出后，其后代 8068 → 13672 → 3080（git-remote-https）及 7636（index-pack）仍存活；Codex 与 taskkill 已退出，但旧 stdio 未 close。对这组已确认归本次探针的孤儿做定向树终止后，旧管道自然 EOF/close。未触碰其它会话或删除此前辅助目录。
- 隔离 fixture 的 config.toml 增加 `[features] plugins = false`，避免与 thread 协议无关的插件网络同步及其 Git 后代；模型仍只指向 127.0.0.1。产品配置、释放条件、任务互斥、taskkill 策略均未改变；不创建测试类型执行计划，ontology 和功能清单无需更改。
- 本次 `npm run build` 通过；`node --test dist/test/interactive/codexHandoffCleanup.test.js dist/test/core/codexThreadHandoffAcceptance.test.js` 25/25，通过且无跳过。默认 `node scripts/verify_codex_thread_handoff.js --live` 交接 60199 ms，冲突复现、原 thread、其它会话、本地请求均满足；两个启动进程及 taskkill 全部 exit/close、全部 stdio 正常 close、临时目录删除，`cleanup_verified` 后退出码 0。另行核对原生 Codex PID 6500/13368 均消失，目录 Test-Path=false。日志：`$env:TEMP\codex-handoff-round2-single.log`。成功单轮不能替代待汇合后的默认命令三轮综合验收。

## 语义及未覆盖范围

- 功能清单无需更新：本轮仅修复测试夹具和断言，没有改变用户可见行为、权限、流程或验收门槛。
- ontology 无需更新：现有 writer 交接规则仍准确，未改变概念、关系、状态机或事实来源路径。
- 不修改或重新归档历史产品修复计划；该记录承接本次 Windows 测试证据。
- 隔离 CLI 协议验收不能替代真实 VS Code 多窗口 Loop+ 调度、完整模型执行、长期稳定性和跨扩展宿主的外部 writer 场景；Linux / macOS 本轮未做原生验证。
