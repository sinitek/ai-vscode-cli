# Codex thread 交接 Windows 验证记录

- 日期：2026-11-12。
- 范围：Windows 原机的回归夹具修复及隔离真实 CLI 协议验收。
- 当前阶段（2026-11-13）：今日变更影响审查完成，build、773/773、默认三轮与公共 runner 复验通过；最终限定仅 Windows 删除重试后，build、68/68 及公共 runner live 再验通过，三份修复计划按此范围归档。原生跨平台和真实 VS Code 多窗口仍未验收；历史失败及清理记录保留。
- 以下“夹具/清理”历史轮次没有修改产品生命周期、依赖或 CLI 版本；后续公共产品修复另见下段，不能把旧夹具证据当跨平台产品验收。

## 2026-11-13 今日变更复验

本次按用户要求检查昨天三份修复受今天代码变化的影响。对比 `a589f3c9..a4f4a269`，结合 CodeGraph 调用链与当前源码核对：未知/不支持即时卸载能力采用专属 owner；已确认能力仍共享连接并注入零延迟参数；原 thread、释放证据、其它会话隔离和 75 秒期限保留。配置身份算法未被今日提交修改，宿主新增的活动运行保护不改变 cwd 及压缩 metadata 传递。

### 补充回归与失败分类

- `node --test --test-reporter=tap dist/test/config/codexRuntimeConfigIdentity.test.js dist/test/config/configService.test.js dist/test/cli/processArgv.test.js`：49/49，fail/cancelled/skipped/todo 均为 0。覆盖 trust 写入与无关项目不改变指纹、配置/认证/来源变化隔离、路径与 symlink、无效配置拒绝及 shell 参数辅助逻辑。`processArgv` 的真实 zsh 用例仅在 macOS 执行，本机 Windows 没有执行该原生分支。
- 今日修改的 commandRunner 登录 shell 回归单独执行：`node --test --test-reporter=tap --test-name-pattern "uses only mocked macOS-shell resolution for stream and capture commands" dist/test/cli/commandRunnerCoverage.test.js`，1/1、无跳过；通过 mock 验证 argv0 与 npm prefix 处理，不代替原生 macOS。
- 初次四文件补充检查 60/66，6 项均来自 `commandRunnerCoverage`。从 Git 只读取 `a589f3c9` 的 `commandRunner.ts` 与其测试，使用当前 TypeScript 转译到系统临时 preload，通过 Node 模块加载钩子复测，仍为 11/17；六个失败用例名称与当前结果完全一致。其余解析依赖在今日未修改；这些已有 Windows 命令路径/平台夹具失败单独登记技术债，不作为本次回归，也不把失败结果追认为通过。没有改写共享 dist 或产品代码。
- `python3 .agents/skills/ontology/scripts/search_ontology.py --validate` 通过。ontology Python 测试初次为 5/9，原因是 Windows 默认 GBK 解码遇到 UTF-8 子进程输出；在当前测试进程设置 `PYTHONUTF8=1` 和 `PYTHONIOENCODING=utf-8` 后 9/9 通过。`python3 -m unittest discover -s scripts/tests -p 'test_verify_loop_plus.py'` 11/11 通过。
- 日志保留于 `$env:TEMP/codex-reacceptance-20261113-identity.tap`、`codex-reacceptance-20261113-shell.tap`、`codex-reacceptance-20261113-supplement.tap`、`codex-reacceptance-20261113-command-runner-baseline.tap`。

### 综合验收首次失败与清理修复

- 命令：`npm run verify:loop-plus -- --report "$env:TEMP\codex-reacceptance-20261113-1305.json"`。build 成功，768/768 回归、无跳过；真实 `codex.CMD` 为 0.162.1，三轮均恢复原 thread 并保留另一会话，耗时 60133 / 60188 / 60151 ms。前两轮清理通过；第三轮删除本次临时根返回 `EPERM`，综合报告 `passed=false`、公共 runner 未执行，退出 1。保留 JSON、同名 `.log` 和 `.console.log`，不将该轮追认为通过。
- 失败清理事件中的所有已跟踪自有进程已 exit/close，全部 stdio 已 close；检查当前 Codex 进程后未发现该失败临时根的命令行。对 `sinitek-codex-handoff-sLCgdM` 校验绝对路径在系统临时目录且名称精确匹配后，稍后直接删除成功，确认 exists=false。这支持短暂文件占用分类，不推断为产品 writer 交接失败。
- 修改 `scripts/verify_codex_thread_handoff.js` 公用清理：关闭证据齐备后，仅 Windows 对删除临时根的 `EPERM` / `EBUSY` / `ENOTEMPTY` 最多重试 5 次（首次加 5 次重试），间隔 100–500 ms，仍受原 10 秒清理期限约束。按用户要求，macOS/Linux 保持一次删除行为，错误直接抛出；不重复 RPC/交接、不延长 75 秒期限、不删用户目录。其它错误、重试耗尽、未关闭进程/管道及超时仍失败；到期后停止后续删除尝试。
- `codexHandoffCleanup.test.ts` 新增 Windows 三类暂时错误恢复、持续错误失败、原期限到期后不再删除的 5 项回归，以及 macOS/Linux 三类错误只删除一次的 6 项 mock 回归（共新增 11 项）。平台 mock 在每项测试后恢复；原有 exit 后尾输出、HTTP/stdio 未关闭、非暂时错误与清理期间新增子进程断言保留。公共 runner 共用该清理函数。

### 最终复验与归档边界

- `npm run verify:loop-plus -- --report "$env:TEMP\codex-reacceptance-20261113-final.json"` 退出 0：build、773/773、fail/cancelled/skipped/todo 均为 0。默认 `codex.CMD` 0.162.1 的三轮交接为 60222 / 60146 / 60153 ms；原 thread 与另一会话均保留，每轮进程/stdio/HTTP 关闭及临时目录删除均确认。公共 runner 35 ms，确认 supported、零延迟 args、真实 `thread/closed` 在原 thread/resume 前，另一会话继续运行且清理完整。报告、同名 `.log`、`.console.log` 和 `.runner.json` 保留。
- 上述综合验收完成后，按用户反馈将重试限定为 `process.platform === "win32"`。最终 `npm run build` 退出 0；`node --test --test-reporter=tap dist/test/interactive/codexHandoffCleanup.test.js dist/test/core/codexThreadHandoffAcceptance.test.js dist/test/core/codexRunnerUnloadAcceptance.test.js dist/test/core/loopPlusFixAcceptance.test.js` 为 68/68、无跳过，日志 `$env:TEMP\codex-reacceptance-20261113-win32-only.tap`。Windows 次数/期限和 macOS/Linux 一次删除均有回归覆盖；mock 不代替原生平台验证。
- 最终 `node scripts/verify_codex_runner_unload.js --live --report "$env:TEMP\codex-reacceptance-20261113-win32-only.runner.json"` 退出 0，交接 38 ms、真实 thread/closed、原 thread 与另一会话均保留，所有资源清理确认。最终平台限制没有改变 Windows 分支，复用已完成的三轮有效证据，不为刷新报告重复广泛测试，也不改写旧报告对应的代码阶段。
- 今日变更未发现破坏昨日修复，源码审查与本机 Windows 隔离集成验收完成；三份 bugfix 计划按用户要求移至 `completed/2026-11/`，同步引用。原生 macOS/Linux、其它版本 live、已安装扩展/真实 VS Code 多窗口、其它 CLI、真实模型与未知外部 writer 仍未验收，见 [技术债跟踪](../exec-plans/tech-debt-tracker.md)。报告 `passed=true`、`fullyVerified=false`，归档不表示全平台或全仓单测通过。

本轮仅修复验收脚本并补记录，没有改变用户可见行为或业务语义，`FEATURE_INVENTORY.md`、运行架构和 ontology 无需更新。后续计划迁移仅更新引用路径；保留昨天失败、未覆盖范围与历史证据，不写入自动热区记忆。

## 后续公共产品修复

- 受控协议已证实共享 readLoop 等待用户处理器，阻塞其它会话 RPC/closed；现仅异步分离原生交互请求，绑定原 thread/listener/操作身份，热停止与关闭按原生协议取消，迟到回答无效。notLoaded 确认仅补充原有释放证据，不延长 75 秒、不重试失败 resume。
- CODEX_THREAD_HANDOFF_FAILED 增加中文阶段提示及安全 diagnostic；未知超时不归为协议不支持。能力策略已于 round 9 接入公共 runner；有效配置指纹已汇合。早期隔离编译的历史证据与本轮共享构建分开记录。
- Windows 既有 pool 单轮只证明其原覆盖；本轮补齐经过公共 runner 的真实能力/参数/释放链路。当前产品事实见 [CLI 运行参考](cli-runtime-reference.md)，执行记录见 [公共修复计划](../exec-plans/completed/2026-11/2026-11-12-bugfix-codex-release-state.md)。

## 汇合门禁与公共 runner 实测（round 11）

- 新增 `scripts/verify_codex_runner_unload.js`：真实调用 `CodexInteractiveRunner.runStreamed` / `updateOptions`，仅转发并观察实际能力解析和 spawn。临时 HOME/workspace、白名单环境、禁用插件同步、127.0.0.1 模型返回带固定标记的 400；每次回合须由该标记拒绝且收到原生 failed completion。显式改变 configFingerprint，恢复同一原 thread，另一原 thread 在旧进程继续回合，不直接 acquire pool、不 mock 能力、不重试 resume。
- 实际 `C:\Users\fangjiawei\AppData\Roaming\npm\codex.CMD --version` 为 0.162.1 / supported；两个真实 app-server 最终 args 均含 `-c thread_unload_delay_secs=0`，保留项目 trust 与 `--listen stdio://`。以旧进程真实 `thread/closed` 先于新进程原 thread/resume 为释放证据，交接 37 ms；4 次本地模型请求。能力探测、两个 app-server 及 taskkill 均 exit/close，全部 stdio close，HTTP 关闭、探测 HOME 与本次临时根删除。
- 初次 `npm run build` 及 `node --test dist/test/core/codexRunnerUnloadAcceptance.test.js` 通过，新增断言当时 7/7。首次 live 因链接脚本从旧 dist 找模块而在创建资源前失败，改用当前 cwd 的 dist 后通过（37 ms）。
- 默认命令 `node scripts/verify_codex_thread_handoff_acceptance.js --live --report "$env:TEMP\codex-handoff-round11-final-default-20261112.json"` 退出 0；自带共享 `npm run build` 通过，受影响回归 331/331、无跳过；默认 3/3，耗时分别 60145、60175、60103 ms，均验证冲突、原 thread、另一会话及严格清理。未传 `--runs`、未修改原 pool verifier 的固定 args/default-delay 场景。日志同名 `.log`。
- 随后收紧回合错误标记断言，并用门禁共享 dist 复验时，Windows 模块路径大小写产生不同 cross-spawn 实例，观察器漏记真实进程，且超时 race 留下后台轮询；该次报告 `codex-runner-unload-round11-final-strict-20261112.json` 为 failed，不能算通过。修复为从 runner 的模块位置 createRequire 加载同一依赖、有界轮询自行结束；仅重跑隔离编译和新增最小回归，最终 8/8（含超时不继续调度）。
- 最终命令：设置 `SINITEK_CODEX_HANDOFF_MODULE_ROOT=C:\work\sinitek-ai-vscode-cli\dist`，执行 `node scripts/verify_codex_runner_unload.js --live --report "$env:TEMP\codex-runner-unload-round11-final-fixed-20261112.json"`，退出 0，得到上述 37 ms 与完整清理证据。报告/日志均使用独立路径；导出的证据校验逻辑保留 supported/unknown/unsupported 正反向断言。unknown/unsupported 的真实 CLI 本轮未安装或验证。
- 失败复验的 verifier PID 9512 经唯一报告参数核对后定向停止，针对该 PID/临时路径的进程查询未见关联 node/cmd/codex；该次 stdio 关闭缺失不可追认。其临时目录 `C:\Users\fangjiawei\AppData\Local\Temp\sinitek-codex-runner-3kJqJM` 清理先报 EPERM，后续显式 Remove-Item 被自动审批以 `blocked by policy` 拒绝，仍保留，需宿主处理。最终成功 live 的资源独立且均已清理。
- 默认门禁后仅改新增验证脚本/新增测试及文档；没有改公共运行时代码、原 pool/acceptance 脚本或其 331 项源测试，已有门禁仍覆盖当前产品改动，不为刷新证据重复执行。后续新增测试已隔离全量 TypeScript 编译通过；历史 noEmit、ontology 9/9、归属 10/10、指纹 13/13 等事实按原覆盖复用。
- round 11 仍未覆盖：原生 macOS/Linux、真实 VS Code 多窗口/Loop+ 调度、其它 CLI、真实模型、未知外部 writer。此脚本显式切换配置身份，不将其作为有效配置内容指纹算法的新 live 证明；该算法沿用已有 13 项受控证据。当时计划保持 active、待主任务评审；当前复验和归档范围见顶部，不能据 Windows 受控/live 宣称全局验收完成。

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
