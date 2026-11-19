# Codex 独立 Node 核心

本轮将交互 Codex 的宿主配置依赖收拢至薄 facade。普通 Node 调用者可在没有 `vscode` 模块、没有 mock 或 loader 替换的进程中加载并运行同一交互核心。这是未来独立 Owner launcher 的依赖前置；尚未实现生产 bootstrap、首次绑定、完整 receipt 或容量恢复。

## 入口与依赖

| 原公开路径（Extension Host 默认入口） | 唯一实现（普通 Node 入口） | 宿主差异 |
| --- | --- | --- |
| `src/interactive/codexRunner.ts` | `codexRunnerCore.ts` | facade 构造时快照既有 shell 设置和日志函数 |
| `src/interactive/codexAppServerPool.ts` | `codexAppServerPoolCore.ts` | facade 将相同端口交给核心连接，无独立 pool |
| `src/interactive/codexRunnerProcess.ts` | `codexRunnerProcessCore.ts` | 显式 shell / 日志端口，直接复用 `cli/commandResolution` |
| `src/interactive/codexAppServerCapabilities.ts` | `codexAppServerCapabilitiesCore.ts` | 显式且固定的 shell / 日志端口，保留唯一缓存与并发门禁 |

`codexRuntimeHost.ts` 是唯一宿主适配器，读取原 `cli/config.getMacTaskShell` 和原 `logger.logInfo/logError`。核心只导入 `codexRuntimePorts.ts`，不读取 VS Code 设置；没有修改全局 logger、toolSettings、commandRunner 或 CLI process core。原路径保留公开类型、函数和默认 EH 构造方式，facade 子类只委托初始化，没有第二套运行状态。

实际运行依赖还包括纯 Node 的 NDJSON reader、protocol/events/runtime helpers、i18n、runtime config、command resolution、process argv/lifecycle、用户目录与原子写工具；type-only 的 CleanupResult 不引入 Owner 运行时。新增测试在全新 `node -e` 中遍历实际 `require.cache` 子图，拒绝加载 vscodeMock、logger、historyRetention、toolSettings、cli/config、commandRunner 和宿主端口，再通过真实 NDJSON Node executable 运行交互协议。仅搜索 import 不能替代此检查。

## 显式运行端口

```ts
export type CodexRuntimePorts = Readonly<{
  macTaskShell: "bash" | "zsh";
  logInfo: (message: string, data?: unknown) => void | Promise<void>;
  logError: (message: string, data?: unknown) => void | Promise<void>;
}>;

// codexRunnerCore.ts
new CodexInteractiveRunner(options: CodexRunnerOptions, runtime: CodexRuntimePorts);

// codexRunnerProcessCore.ts
resolveSpawnCommand(command: string, args: string[], runtime: CodexRuntimePorts): ResolvedSpawnCommand;
killProcessTree(child: ChildProcess, runtime: CodexRuntimePorts,
  signal?: NodeJS.Signals | number): boolean;
requestChildShutdown(child: ChildProcess, mode: "graceful" | "terminate",
  runtime: CodexRuntimePorts): void;

// codexAppServerCapabilitiesCore.ts
resolveCodexThreadUnloadCapability(input: CodexCapabilityInput,
  runtime: CodexRuntimePorts): Promise<CodexThreadUnloadCapability>;

// codexAppServerPoolCore.ts
acquireCodexAppServer(spec: CodexAppServerConnectionSpec,
  listener: CodexAppServerListener, runtime: CodexRuntimePorts): CodexAppServerConnection;
new CodexAppServerConnection(spec: CodexAppServerConnectionSpec, runtime: CodexRuntimePorts);
```

Node 核心 runner、连接和能力入口校验并冻结端口副本，必须显式提供 bash/zsh 与两个日志函数，不悄悄使用宿主设置或默认空日志。runner 整个生命周期使用同一个 shell 选择，传给启动解析和能力探测；更改原端口对象或宿主设置不会改变已有 runner 的选择。独立日志函数是可信本地调用方责任；它们不应自己引入宿主依赖或抛错。日志返回值仍沿用原异步日志合同，不是清理证据。

```ts
import { CodexInteractiveRunner } from "./codexRunnerCore";
import type { CodexRuntimePorts } from "./codexRuntimePorts";

const runtime: CodexRuntimePorts = {
  macTaskShell: "bash", // 可信启动配置中的固定选择
  logInfo: (message, data) => localLog("info", message, data),
  logError: (message, data) => localLog("error", message, data),
};
const runner = new CodexInteractiveRunner({
  command: trustedExecutable,
  args: trustedCodexArgs,
  cwd: isolatedWorkspace,
  env: preparedEnvironment,
  thinkingMode: "medium",
  interactiveMode: "coding",
  threadId: trustedNativeThreadId,
}, runtime);
const observation = runner.createExecutionObservation();
try {
  await runner.runStreamed(trustedPrompt, handlers, observation);
  const facts = await observation.cleanup();
  // 各字段分别消费，unobservable 不能转为完整 receipt。
} finally {
  runner.dispose(); // 原业务销毁合同，不是终态/排空证明。
}
```

上例仅展示可信进程内接口，不是 Owner IPC 请求格式，也不授权外部 IPC 传入任意命令、路径或 prompt。

## 共享状态与兼容性

连接 Map、processConnections、threadLeases、connection/listener/observation ID 生成器均只存在于核心模块。facade 调用和 Node 核心调用使用同一模块实例；没有按宿主/角色新建 pool 上下文，也不允许通过注入端口绕过 thread lease。共享连接第一次创建时固定其日志端口，后来 retain 不替换进程的日志归属。共享 key 仍由实际 command、args、cwd、Codex HOME、provider、fingerprint 和 exclusiveOwnerId 构成；shell fallback 已体现在实际 command/args。能力缓存额外纳入固定 shell 选择，继续保留原 64 项 LRU/TTL、4 个 pending/live probe 上限和真实 close 后释放探测责任。

命令解析改为直接导入原 commandResolution 的同一实现；未改解析规则、mac login-shell 转义、base env、cwd/PWD、进程树终止与 shutdown escalation。能力探测继续只执行 allowlist 版本查询，隔离 HOME/cwd 和环境，未知 shell-only executable 仍不能确认共享能力。新 Node fixture 用显式环境验证运行子进程收到 base env，而 probe 不收到凭据哨兵、PWD 或原配置路径。

交互 turn、回调、最终回答兜底、streamed/response turn ID 兼容、取消、dispose、thread handoff 均复用原代码。round-113 的身份和观察状态完整搬入核心：执行前冻结 token；真实 connection/listener/sequence/ownedThread/buffered 来源；原始 start 响应独立对账和一次绑定；8 项候选与 16 项注册上限；未知终态阻塞、unobservable 后粘性拒绝重入；abort/dispose 唤醒并移除监听；未结束 async server handler 阻止释放。提取不重置或淘汰历史。

## 证据与未完成边界

新增 `codexNodeRuntime.test.ts` 在没有安装 vscode mock 的测试进程及全新普通 Node 子进程中加载核心。真实临时可执行 Node fixture 支持 `--version`、交互 NDJSON 和确定性 RPC 门闩；覆盖显式端口与 shell 快照、真实派发来源、terminal 先于原响应、最终回答兜底后的晚响应、原取消执行的晚响应、阻塞排队取消/监听移除及共享 peer 保活。EH 生命周期另验证原宿主设置/日志适配和启动/探测同一快照。构建、用例数量、执行顺序与并行源码影响以 round-117 attempt report 为准。

本轮没有增加排空推断。`executionDrain` 继续 unobservable；共享 reader 活动时 `streams` 不可观察。业务 settlement、interrupt、process exit、主动 reader.close、facade 返回、dispose 均不能补 native terminal 或完整 receipt，单执行 cleanup 不关闭共享 peer。独立 Owner 仍需可信 launcher 持有 handle、准备隔离配置、持久绑定、资源组合与完整 receipt 消费；生产 observeLeaderCleanup 的 null 门禁保留。

本轮是内部依赖提取，公开用户行为和 authority 规则未改变；不改并行任务拥有的 Owner 主设计、ontology 或功能清单。原 source_refs 中 runner/pool 路径仍是有效兼容入口；后续本体来源同步可补上述 Core 文件与本设计，不能将其标为生产 Owner 或容量恢复完成。本机验证平台为 macOS；Windows wrapper 和 Linux 分支保留兼容实现，未声称实机验证。

## 后续专属执行端口（round-118）

可信 Node 调用方现在可选用 [Codex 专属执行端口](department-codex-owned-execution.md)，通过同一 Core/pool 完成无任务的原生会话准备、精确身份绑定门闩和单次执行。它的独占 stdin/自然 EOF 收尾与 Promise 回调消费责任可提供独立 executionDrain 事实；本文件上文所述原共享 handle 的 unobservable 合同保持不变。该入口不是生产 Owner、首次持久化接线或完整 receipt，具体可观察条件与未完成边界以专属设计和 round-118 报告为准。


### 专属准备与排空边界修复（round-121）

专属入口的准备身份现在以固定初始 resume 目标与本次 raw thread 请求响应建立 connection/thread/abort/dispose 凭据；初始化通知与 loadedThreads 只提供路由信息，不能替代该凭据或修改专属主身份。未归属通知截断留下不可逆的 executionDrain 未知事实。handlerTasks 仅由专属排空持有，共享连接保留原取消与 handlingOwners 释放门禁，避免无限保留已取消 handler 的新增强引用。详见专属设计的 round-121 章节。普通 Node/EH facade、固定运行端口、探测与命令解析未改；本轮不是生产 Owner 或容量恢复交付。
