# Codex 启动链路对比与中断风险排查

- 日期：2026-04-23
- 状态：completed
- 负责人：Codex

## 背景

当前 VS Code 插件内执行 Codex 任务时，用户反馈“经常会莫名中断”。参考目标系统 `/Users/fangjiawei/work/cli_mcp/apps` 中同类能力表现稳定，本次对比两者启动 Codex 任务的方式，定位关键差异与高风险点。

## 目标

梳理当前系统与目标系统的 Codex 启动链路，对比进程启动参数、会话模式、工作目录、环境变量、I/O 接管、超时/销毁、事件监听与错误处理差异，并输出最可能导致中断的原因。

## 范围

- 当前仓库内与 Codex 启动、会话续接、子进程管理相关代码
- 目标系统 `/Users/fangjiawei/work/cli_mcp/apps` 内与 Codex 任务启动相关代码
- 两边运行脚本、适配层与调用入口的差异分析

## 非目标

- 本轮不直接修改目标系统代码
- 本轮不做无依据的大规模重构
- 本轮不扩展到 Claude / Gemini 的完整链路

## 验收标准

- [x] 找到当前系统中 Codex 任务的主启动入口与关键调用栈
- [x] 找到目标系统中等效启动入口与关键调用栈
- [x] 汇总两者关键差异并标注中断风险等级
- [x] 给出基于代码事实的原因判断与后续修复建议

## 影响面

- 代码目录：`src/interactive/codexRunner.ts`、`src/interactive/manager.ts`、`src/extension.ts`、目标系统 `backend/src/infra/codex/` 与 `backend/src/app/services/`
- 文档目录：`.ch/docs/exec-plans/`、`.ch/docs/runbooks/PITFALLS.md`
- 配置与脚本：本轮仅分析，不做运行配置变更

## 风险与缓解

- 风险：仅靠静态代码对比，无法百分之百证明单一点根因
- 缓解：把“已确认代码差异”和“高概率根因推断”分开记录，并给出可验证的修复顺序

## 验证计划

- 最小相关验证：静态梳理调用链、`spawn` 参数、环境变量、会话恢复、销毁策略差异
- 扩展验证：执行 `codex --version`、`codex app-server --help`，确认当前仓库使用的 `--listen stdio://` 仍为有效参数

## 测试与清单同步

- 单元测试：本轮为排查分析，不新增
- 功能清单：无用户可见能力变更，不更新 `FEATURE_INVENTORY`
- 相关文档同步：补充执行计划与避坑指南

## 任务列表

- [x] 梳理当前仓库 Codex 启动链路
- [x] 梳理目标系统 Codex 启动链路
- [x] 对比启动方式与中断处理差异
- [x] 输出结论与修复建议

## 决策记录

- 2026-04-23：先做静态链路对比，避免在目标系统无关业务逻辑上消耗上下文。
- 2026-04-23：确认目标系统主链路同样使用 Codex app-server，但其启动前置、环境隔离、关闭策略和日志能力明显更稳。

## 当前结论

### 当前系统主链路

- 入口：`src/extension.ts` 中交互式运行逻辑 → `src/interactive/manager.ts` → `src/interactive/codexRunner.ts`
- 启动方式：macOS 下固定通过 `/bin/zsh -lc 'codex app-server --listen stdio://'` 启动；`spawn` 参数为 `detached: true`、`env: process.env`
- 会话方式：每轮新起一个 app-server 子进程，通过 `thread/start` / `thread/resume` + `turn/start` 续接 thread
- 默认能力：插件默认 Codex 参数为 `--dangerously-bypass-approvals-and-sandbox --sandbox danger-full-access --enable web_search_request`
- 关闭方式：完成或异常时直接 `killProcessTree()`，没有“先关 stdin、等待 close、再 SIGTERM/SIGKILL”的分阶段收尾

### 目标系统主链路

- 入口：`backend/src/app/services/ResearchReportService.ts` → `backend/src/infra/codex/CodexAppServerClient.ts`
- 启动方式：直接 `spawn(input.cliPath, spawnArgs)`，不经过 shell，不设置 `detached`
- 环境隔离：显式设置 `CODEX_HOME` / `CODEX_HOME_DIR`，并移除 `npm_config_prefix`
- 启动前置：会先 `resolveCodexProjectPath()`、`ensureCodexProjectTrusted()`，并通过 `-c projects.<path>.trust_level="trusted"` 注入 trust override
- 关闭方式：`stdin.end()` → 等待 close → `SIGTERM` → 超时后再升级；同时保留原始流日志与 session history snapshot

### 已确认的关键差异

1. **进程创建方式不同（高风险）**
   - 当前系统在 macOS 永远包一层 login shell：`zsh -lc`
   - 目标系统直接启动可执行文件，不经过 shell
   - 这会带来 shell 启动脚本、副作用输出、别名/函数解析、信号传递链条更复杂等额外不稳定面

2. **子进程是否 detached 不同（高风险）**
   - 当前系统 `detached: process.platform !== 'win32'`
   - 目标系统未启用 detached
   - 当前系统后续用 `killProcessTree()` 杀整组进程，任何误触发 `dispose/stop` 都更容易把正在运行的 Codex 整体打断

3. **环境变量与 Codex Home 管理不同（高风险）**
   - 当前系统直接继承 `process.env`，不显式固定 `CODEX_HOME`
   - 目标系统显式设置 `CODEX_HOME`、`CODEX_HOME_DIR`，并清掉 `npm_config_prefix`
   - 这意味着当前系统更容易受 VS Code Extension Host 环境、shell 初始化、外部 npm/node 环境污染影响

4. **项目 trust 前置不同（中高风险）**
   - 当前系统不做 trust 文件预处理，也不注入 `projects.<path>.trust_level="trusted"`
   - 目标系统启动前会确保 trust 落盘并注入 override
   - 当 Codex 对项目 trust 或 config 读取更敏感时，当前系统更容易出现额外中断或异常请求链路

5. **关闭策略不同（高风险）**
   - 当前系统多数场景下直接 `killProcessTree()`
   - 目标系统先尝试优雅收尾，再升级到 `SIGTERM`
   - 这使目标系统更不容易在边界态把“即将完成/正在 flush 的回合”粗暴打断

6. **默认任务复杂度不同（中风险）**
   - 当前系统默认启用 `web_search_request`，并允许更宽松的文件/网络访问；交互式模式默认也更贴近日常 IDE 对话
   - 目标系统对 `readableRoots`、sandbox policy、project trust、输出 schema 都更严格，运行面更收敛
   - 当前系统实际运行中的外部依赖面更大，因此更容易把网络、权限、工具链噪音表现成“莫名中断”

7. **观测与诊断能力不同（中风险）**
   - 当前系统缺少目标系统那样完整的 raw stream logger、session history snapshot、lifecycle 埋点
   - 同样的中断在当前系统更容易表现为“突然没了”，而不是“能准确归因到哪一段退出”

### 最可能的根因判断

- **最高概率组合根因**：当前系统在 macOS 上采用 `zsh -lc` + `detached=true` + `killProcessTree()` 的组合，并且没有显式固定 `CODEX_HOME` / trust / graceful shutdown；相比目标系统，这条链路多了 shell、副作用环境、进程组信号、粗暴销毁四类不稳定因素。
- **次高概率放大器**：当前系统默认开启 `web_search_request`，并使用更宽的 sandbox/read 权限，使任务在运行期接触更多外部依赖，失败面更大。
- **诊断盲区**：当前系统没有目标系统那种细粒度 lifecycle/raw log，导致真实退出原因未被保留，最终表现成“莫名中断”。

### 建议修复顺序

1. 把当前仓库 Codex app-server 启动改成“优先直接 spawn 绝对可执行路径，不走 `zsh -lc`”。
2. 去掉 `detached`，改成与目标系统一致的显式生命周期控制。
3. 为 Codex 子进程显式构造环境：固定 `CODEX_HOME` / `CODEX_HOME_DIR`，移除 `npm_config_prefix`。
4. 启动前增加 workspace trust 处理，并注入 `projects.<path>.trust_level="trusted"` override。
5. 把当前 `killProcessTree()` 的粗暴收尾改成“先关 stdin、等 close、再升级信号”的渐进式关闭。
6. 复制目标系统的 raw stream logger / lifecycle 日志最小子集，先把中断原因可观测化。

### 已验证什么 / 未验证什么

- 已验证：两边真实代码入口、`spawn` 参数、env 构造、thread/start/resume、turn/start、abort/timeout/close 策略、默认 Codex 参数。
- 已验证：本机 `codex-cli 0.110.0` 下 `codex app-server --listen stdio://` 仍是有效参数，`stdio://` 也是默认值。
- 未验证：尚未在当前仓库直接打补丁并执行长时任务回归，因此“哪一个差异单独占主因”仍需最小改造后用日志复核。
