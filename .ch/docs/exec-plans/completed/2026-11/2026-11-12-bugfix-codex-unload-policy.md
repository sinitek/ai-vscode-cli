# Codex 即时卸载能力与启动策略

- 日期：2026-11-12
- 类型：bugfix
- 关联计划：[释放状态修复](2026-11-12-bugfix-codex-release-state.md)，由生命周期所有者消费本次导出后统一验收。
- 状态：completed
- 负责人：Codex fullstack 独立执行尝试

## 2026-11-13 重新验收

Tasklist:
- [completed] 核对已确认版本共享与未知能力专属连接策略及启动参数
- [completed] 复验能力探测、释放边界与实际公共 runner
- [completed] 汇总验证证据与平台边界并归档

与 [释放状态修复](2026-11-12-bugfix-codex-release-state.md) 共用本轮综合验收。今日新增专属 owner 隔离及登录 shell argv0 修正，保留原 thread、实际释放证据和 75 秒期限；本次不更改版本契约或用户配置。

`npm run verify:loop-plus -- --report "$env:TEMP\codex-reacceptance-20261113-final.json"` 退出 0：build、773/773、默认三轮（60222 / 60146 / 60153 ms）与公共 runner（35 ms）通过。最终按用户要求将删除重试限定 Windows，macOS/Linux 保持一次删除；再构建与清理/验收回归 68/68、公共 runner live（38 ms）通过。真实 0.162.1 确认 supported、零延迟参数、原 thread/closed 释放证据及另一会话保留；没有改能力白名单或延长交接期限。原有三轮 Windows 分支未变，沿用有效证据。

本轮审查与本机集成验收完成，按用户要求归档；原生 macOS/Linux、其它版本 live 及真实宿主边界保留，报告仍为 `fullyVerified=false`。命令、首次清理失败、修复及历史测试失败分类见 [Windows 验证记录](../../../references/codex-thread-handoff-windows-validation.md#2026-11-13-今日变更复验)，后续原生验证见 [技术债跟踪](../../tech-debt-tracker.md)。本轮仅改验收脚本、测试与文档，FEATURE_INVENTORY 与 ontology 无需更新。

## 目标与范围

独立提供 `resolveCodexThreadUnloadCapability({ command, cwd?, env? })` 和显式 `immediateThreadUnload` 参数。只确认实际执行 `--version` 得到的、准确核对过的版本；不根据邻近 npm 包版本、启动成功或版本范围推断支持。默认参数保持兼容。即时策略不构成 writer 释放证据。

拥有 capabilities 模块、runtime 参数及相应测试。必要附带修改 `src/cli/commandResolution.ts`，增加可选 cwd/env 上下文以复用现有路径、npm shim、PATHEXT 解析，不修改默认调用契约。不改 runner、pool、runnerProcess、交接脚本、中心文档或 ontology；保留既存 diff 和 package.json 1.9.2。

## 能力依据与决定

- 用户提供 macOS 0.167.0 隔离对照：默认约 60 秒，零值约 43 毫秒且其它会话保留，90 秒超过 75 秒期限；这不是本机原生 macOS 验证。
- 本机临时 HOME/workspace 执行 npm codex.cmd `--version` 得到 `codex-cli 0.162.1`；`--help` / `app-server --help` 未提供配置 schema 导出，`generate-json-schema` 仅为协议 schema。
- 上游源码经 GitHub contents API 实际读取：`rust-v0.162.1` schema blob `5864a5df77c600b6dfc9884d971040074fb6b644` 与 `rust-v0.167.0` schema 均声明 `thread_unload_delay_secs` 为 uint64，默认 60、零值立即卸载。前者要求重启、后者加载 thread 时解析；对应 config/mod.rs 两版均 `Duration::from_secs(cfg.thread_unload_delay_secs.unwrap_or(60))`。
- `rust-v0.100.0` schema blob `5fb67c22b4f7614a6eefacbea35b98aa6a3de08f` 不含该字段，作为准确 unsupported 契约。其它版本（含预发布/构建后缀）unknown。
- 证据链接：`https://github.com/openai/codex/blob/rust-v0.162.1/codex-rs/core/config.schema.json`、同路径 `rust-v0.167.0` / `rust-v0.100.0`，以及两版 `codex-rs/core/src/config/mod.rs`。官方 developers 配置页面返回 403，raw GitHub 超时；contents API 成功，未据失败页面推断能力。
- 探测只执行 `--version`，不启动模型；不传原始配置、认证或用户 HOME/session。最多 4 个探测并行、3 秒超时、4 KiB 输出；只终止自有 probe。64 项 LRU、60 秒有效期，按可执行 realpath/stat、已知 npm native payload、cwd、环境摘要隔离，合并在途请求。
- 复用 Node 单脚本包装命令；含配置/认证/任意参数、npx 等可能安装命令返回 unknown。macOS login-shell fallback 复用现有转义，因缺少可见目标身份保持 unknown。

## 验收与验证计划

- [x] 覆盖 supported / unsupported / unknown、失败、超时、输出边界、空格路径、wrapper、身份/上下文变化、并发去重及缓存边界。
- [x] 显式 true 最后追加进程级 `-c thread_unload_delay_secs=0`，保留其它覆盖、提问能力和 listen；未确认能力的调用示例不注入。
- [x] 隔离临时编译、最小相关单测和 `tsc --noEmit`；不构建/消费共享 dist，不执行正式三轮。
- [x] 写本轮报告与精确集成示例（宿主指定 round-7 报告）。
- [x] round 9 公共 runner 接入及中心文档/ontology 同步；round 11 共享 build、331/331、默认三轮 live 与独立公共 runner 即时策略实测完成。

## 风险与当前状态

独立能力/参数已于 round 9 接入插件自启公共 runner，round 11 完成 Windows 隔离集成门槛；2026-11-13 审查、复验并按上述边界归档。固定版本表对未核对的新版本保守降级；opaque wrapper 隐藏的依赖变化最多缓存 60 秒，已知 npm native payload 变化立即使 key 失效。不覆盖外部连接；75 秒期限、thread 互斥和释放证据未改变。Ontology 已随 round 9 公共修复同步，历史 9/9 结果继续按原覆盖复用；跨平台/真实宿主缺口保留。

## 本轮验证事实

- `node node_modules/typescript/bin/tsc -p . --outDir C:/Users/fangjiawei/AppData/Local/Temp/sinitek-codex-unload-r7-check --sourceMap false --incremental false`：最终通过；未读写共享 dist。
- `node --test <上述目录>/test/interactive/codexAppServerCapabilities.test.js`：最终 24/24；runtime 测试此前 24/24，后续未修改其源码/依赖，复用有效结果。
- 附带 `commandResolution.test.js`：5/7，两个 Unix 假设用例在 Windows 失败；隔离转译 HEAD 原实现得到相同 5/7，确认历史平台夹具问题。未扩大修改该测试。
- `node node_modules/typescript/bin/tsc -p . --noEmit --incremental false`：通过；之后仅修正缓存复用的测试断言并已隔离编译通过。中间 HOME 上下文修正漏传参数出现 TS2554，已修正并复编译/复测。
- 本机实际模块在临时 workspace / HOME 通过 `C:/Users/fangjiawei/AppData/Roaming/npm/codex.cmd --version` 返回 supported、0.162.1；不等于本机验证了零延迟交接。
- 首次相关合并测试 53/55（仅上述两个历史失败）；后续 HOME 测试误假设相同目标需重复探测，修正断言后能力测试 24/24。fake PID 的 killProcessTree/process.kill/跨平台 spawn 均由夹具拦截。
- 最终空白检查与报告交付见宿主指定报告；尚未执行中心接入、最终 build、正式三轮或原生 macOS/Linux 验收。已有清理/边界结果只复用原覆盖，不宣称覆盖本能力。

## 后续接入及汇合事实（round 9 / 11）

- round 9 修复 probe 超时收尾：结果有界返回，但临时 HOME/并发名额保留至自有子进程 close；能力 await 后复核活动操作，只有准确 supported 才注入，最终 args 参与连接身份。定向 16/16、隔离编译/noEmit 与 ontology 9/9 继续复用，不重复刷新。
- round 11 真实 CLI 为 `C:\Users\fangjiawei\AppData\Roaming\npm\codex.CMD` 0.162.1 / supported。新脚本直接调用公共 runner，以两个原 thread 共享旧进程，再显式切换目标配置身份；最终 args 有零延迟覆盖，真实 thread/closed 在原 thread/resume 前，另一 thread 继续旧进程回合，交接 37 ms，最终本次资源清理完整。
- 最终新增证据/超时回归 8/8 与隔离编译通过；默认综合命令内置共享构建、331/331、3/3 通过（60145 / 60175 / 60103 ms）。原 pool 脚本继续覆盖默认延迟，不把它的三轮当即时策略证明。命令、独立报告、观察器失败与被策略拒绝的遗留目录清理详见 [Windows 验证记录](../../../references/codex-thread-handoff-windows-validation.md)。
- 本机未验证 0.167.0/macOS/Linux 原生、未知/不支持版本的 live 或真实 VS Code 多窗口；用户 macOS 对照仍仅为提供的证据，不追认为本机执行。round 11 待主任务审查，当前审查结论见顶部，这些原生验证缺口仍保留。
