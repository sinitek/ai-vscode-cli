# 进程型 Department TrustedExecutionLauncher

`src/runtime/departmentprocessexecutionlauncher.ts` 提供 `createDepartmentProcessExecutionLauncher(resolvePrepared): TrustedExecutionLauncher`，将现有 `runCliProcess` 适配到 `DepartmentExecutionOwnerServer`。模块和运行时依赖可由普通 Node 加载，不导入 VS Code 或 `cli/config`。它补充既有 launcher 实现，不改变 identity、IPC、receipt、容量、本体或用户功能语义；本轮无需修改功能清单和 ontology。生产接线完成后，需由对应负责人将本实现作为 Owner 主设计及 runtime ontology 的来源引用。

## 可信准备边界

同步 `DepartmentProcessExecutionResolver(identity)` 返回 `PreparedDepartmentProcessExecution | null`。准备对象包含：完整 identity、只含 allowlist 元数据的 `DepartmentExecutionSelection`、`executionMode: "process"`、`CliProcessRuntimeLaunch` 和逐类资源所有权/释放能力。配置执行租约由可信准备方获取并持有，直至其实际释放能力完成；指纹不代替租约。不能使用包含 auth/env 正文的 `profileDigest`。本适配器不保存或记录命令参数、prompt、配置正文、凭据、环境数据。

准备方必须已经获得并持久绑定真实原生 session，且最终 CLI 参数确实对应该 session 和 role selection。适配器只接受合法、完整、bound 的 identity，精确核对 `sameExecution`、selection.role/cli 及 `fingerprintDepartmentExecutionSelection` 的两个结果；未准备配置（含 null configId）、缺失准备结果、身份/selection冲突、unbound 和非 process 执行均拒绝。它不调用 bindSession、不生成 session ID，不负责首次 `DepartmentRuntimeStore.bindExecution`，也不会把 Codex 交互 turn 改写成 print/process 执行。

`requirements` 和 `launch` 共用一份固定准备快照。identity、selection、argv、环境覆盖和资源 owned 元数据均复制；释放函数及其原始 receiver 的归属保留，准备方必须保持该能力对同一资源有效。默认基础环境在准备时取 `process.env` 快照，显式基础环境不会补入宿主省略键。最终合并继续由核心执行：基础环境 → 任务覆盖 → overlay覆盖 → cwd设置PWD。配置拆分和 CLI 参数准备仍由可信上层完成，本适配器不重新解析或重建策略。

示意调用（变量均由可信进程内准备代码取得）：

```ts
const launcher = createDepartmentProcessExecutionLauncher((identity) => {
  const prepared = preparedByExecutionId.get(identity.executionId);
  return prepared ?? null;
});
const requirements = launcher.requirements(boundIdentity);
// 上层在首次启动前持久绑定同一 identity、selection 和 requirements。
const server = new DepartmentExecutionOwnerServer({ directory, ownerId, launcher });
await server.listen();
```

准备对象的 `resources` 必须明确列出 runner、executionRoot、links、temp、tab，每项为 `{ owned: boolean, release?: () => CleanupResult | Promise<CleanupResult> }`。runner能力覆盖该执行的runner和已绑定原生session；temp描述核心overlay之外的临时资源。`owned: false` 仅适用于准备合同确实不拥有该类资源，不能同时提供释放函数。`owned: true` 且缺失能力仍固定为必需，cleanup返回unobservable，不能为了receipt改成不必需。

Owner公开socket/pipe协议仍只接收严格identity；不得将resolver或prepared对象变成接收executable、argv、prompt、环境、路径、认证正文或清理要求的公开IPC。

## 事实映射

| Owner字段 | 来源与门禁 |
| --- | --- |
| kind | 固定process；requirements.processTerminal=true、turnTerminal=false、streams=true。其余要求从资源owned推导，temp还合并overlay存在性。 |
| processTerminal | 仅转交核心lifecycle中真实spawn/child close观察；PID、onExit、onError、kill和业务Promise均不证明终态。 |
| turnTerminal | not-applicable，明确进程型执行无原生交互turn终态。 |
| streams | 仅转交核心实际stdin finish、stdout/stderr end及自有stdio close观察。 |
| runner/session、executionRoot、links、tab | 真实close和排空确认后逐项await可信释放能力；没有能力时unobservable；抛错failed；非法结果unobservable；拥有资源返回not-applicable仍为unobservable。 |
| temp | 核心lifecycle的overlay结果与额外temp释放结果合并，两者都必须满足自身所有权要求；先出现的overlay失败保留，overlay成功不能覆盖额外temp失败。 |

lifecycle缺失、reject或形状非法返回保守unobservable；流未排空不会变成成功，也不触发可能仍被进程使用的资源释放。overlay清理由原核心负责，本模块不重复调用。所有释放结果严格校验CleanupResult字段/长度/字符约束，错误正文不写入结果。资源能力不能反过来等待同一receipt或容量归还，否则会循环等待；这项能力实现约束由后续可信组合负责保证。

同一executionId仅保留同一canonical identity，重复launch共享同一Promise和handle，重复cleanup共享同一Promise；失败不自动重试。缓存最多256项，含准备失败和已完成项，不淘汰活动事实，不把旧execution变成新spawn。长期生产Owner须在后续bootstrap中管理实例生命周期/饱和门禁，不能通过新建适配器绕过既有Owner持久事实。输出由核心消费但不累计到适配器缓存，监听和缓冲沿用核心的有界观察。

## 本轮验证范围与尚未接线项

新增独立Node Owner fixture实际加载适配器、Server和Client，无vscode mock；启动受控Node child，启动客户端退出后Owner仍持有执行对象。child退出后descendant继续持有stdout/stderr，直到门闩放行并写出尾部；Owner在真实close/drain后才产出receipt。文件资源实际创建/释放；fixture的session/tab能力只验证调用和结果映射，不证明真实CLI session或VS Code tab已清理。失败路径分别覆盖缺失必需能力、root和额外temp失败；核心overlay成功不掩盖失败。另有窄范围测试注入缺失/reject/未排空lifecycle，只用于验证保守映射，不当作真实成功证据。

独立生产bootstrap、真实角色准备/配置租约/原生session、首次持久绑定、整组执行聚合、容量释放及冷重启恢复仍未完成。生产`observeLeaderCleanup`继续保守关闭，不能因本适配器测试通过提前开放。本轮macOS Node fixture不等于Linux/Windows实机、Extension Host重载、真实CLI或真实VS Code清理验收。进程树终止、mac login shell/NVM、argv0与Windows taskkill均复用既有核心，未新增或复制实现。
