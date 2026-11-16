# OpenCode 员工原生执行目录与排空验证

本手册只覆盖部门 OpenCode 员工首次调用。组长双轮证据沿用 round-366；本验证不启动组长 prompt，不运行 Codex EH，也不证明完整 EH、跨代续接、冷恢复或整树容量端到端。

## 生产目录合同

`createDepartmentProcessPreparation` 在可信员工 admission/Ledger 责任登记后，持久创建不可替代的 preparation reservation，才可 fork 原 Owner。原 worker 在该责任内创建一次 `createLoopSubtaskExecutionRoot`，保存原 dispose/assertCurrent 能力，使用其 canonical realpath 作为以下操作的唯一目录：原生 session POST/GET、只读 export 核验、真实任务 run 及其事件订阅。

原生准备复用 `createDepartmentOpenCodeSession(requireDirectory: true)`，POST 和 GET 都核对真实目录。旧 bound ID 只 GET，不能 POST、fork 或换 Owner；旧 session 所属目录与本次隔离根不一致即拒绝。这不构成跨代恢复支持。私有 argv 拒绝目录、attach、continue、fork 覆盖，公共 Owner IPC 保持 identity-only；employee-only validator 不变。

每个私有 grant 前保留配置、scope、任务 session、Store binding 栅栏，并核验原根 inode 和原链接身份。准备服务必须独立 close、stdio、overlay 排空，任务的 executionSession 保存回读及 Store 原子 binding 回读都早于一次性 grant。取消、迟到 finalize、断连和错误目录不能重新启动或重放 prompt。

只有 captured child close 和 stdio drain 后，原 launcher 才调用资源 release。根/links 由保存的原能力清理；未知内容、根或链接替换及 overlay 清理失败都保留责任和配置租约。原 tab capability 等原消费者完成、核对身份、实际关闭并回读消失；全部本地资源与 tab 成功才释放配置租约。原客户端严格核验完整 required receipt 后，协调器以私有幂等 shutdown/stopped 握手退役原 worker；这一步不补造缺失 receipt。原客户端 `waitForCleanup` 保留已验证凭证；退役后的新冷客户端查询为 unknown，不能读磁盘 cleaned 冒充原观察。

## 使用

先准备实体隔离构建，`src` 和 `dist` 均不得是链接；只可复用原项目 node_modules，不能安装/升级依赖或清理共享 dist。标准命令在隔离产品内执行：

```sh
npm run build
node --test dist/test/runtime/departmentopencodesessionpreparation.test.js
```

验证器必须从仓库脚本启动，并显式指定隔离模块、全新 product 和 product 外全新 report：

```sh
node scripts/verify_opencode_employee_native_drain.js --live \
  --module-root /private/tmp/employee-build/dist \
  --product-root /private/tmp/employee-native-product-new \
  --report /private/tmp/employee-native-report-new.json
```

可选 `--binary` 必须为绝对路径。不允许重复/未知参数、路径逃逸、链接依赖、已有报告或 product。Windows 使用对应盘符绝对路径。验证器按其实际依赖闭包核对物理 TS 与当前源码，记录全源码及 dist hash；无关并发差异单列。CLI/provider 需保持安装版支持，不硬编码用户 session，不读用户配置或凭据。

环境仅继承 PATH/PATHEXT/SystemRoot/WINDIR/ComSpec/SYSTEMDRIVE；HOME、USERPROFILE、XDG config/data/cache/state、APPDATA、OpenCode 配置、临时目录和工作区全部隔离。provider 复用 `opencode_local_provider_server.js` 的 native-drain 协议，仅监听 127.0.0.1，总预算 3 个请求（含 title）；所有模型都选免费本地 provider，远程代理指向关闭的 loopback 端口。每阶段有界等待，默认任务/原凭证等待 45 秒。

一次实际员工 prompt 使用生产 builder、facade、worker 和原客户端；输出通过生产 OpenCode tab stream/parser 和逐次持久绑定 validator。tab host 受控，但 WeakMap capability、消费者门闩及实际 Map 删除回读真实执行。独立 readonly export 只确认本次原生历史，不能补任务自然排空证据。

报告逐项记录版本/binary hash、源码闭包、Owner/generation/revision/session、各 process 的 close/stdio、准备服务停止分类、输出消费者、原 required receipt、stopped、tab 消失和配置租约。teardown 前单独记录正常生命周期是否通过；任何失败的强制回收只列 hygiene，不算 cleanup 证明。失败 product、原生历史和责任记录保留，不重放授权 prompt。

## 本轮证据

round-369 的实际命令、隔离构建差异、结果及尚未覆盖范围见本轮 attempt report。真实安装版运行结果只适用于该报告记录的平台及版本；受控 tab 不是真实 EH/tab，组织容量、全角色 EH、跨代/冷恢复、Windows/Linux 实机和合并后全量回归仍是独立门禁。

2026-11-15 本机新场景：macOS arm64 / Node v24.22.2 / OpenCode 1.19.5，报告 `/private/tmp/round369-opencode-employee-report-02.json` 为 passed；1 次员工任务、2 个免费 SSE 请求（title + task），同根原生 session `ses_e226a2862ffe0kdd7B1N3VrE04`。准备服务 SIGTERM 后独立 close/drain，任务 code=0/signal=null 自然结束，原完整 receipt/stopped、根/links/overlay、配置租约及受控 tab 全部确认，`normalLifecyclePassedBeforeTeardown=true`、`forcedCleanup=[]`。源码闭包 87 文件匹配；构建副本的并发测试类型修正及另一个 EH 测试差异仅属无关测试，详见 attempt report。

首次本轮原生场景的任务也已自然排空，但验证器误把 finalizing 期间的 unknown 当作必须 live，导致在消费者门闩尚未解除时失败并强制回收 Owner。其 `/private/tmp/round369-opencode-employee-report-01.json` 永久保留 failed，不能算原凭证成功。修正只允许门闩期间 live/unknown、仍禁止 cleaned；最终成功仍必须由原 client 严格验证完整 required receipt。第二份报告来自独立新隔离产品/任务，未接管、重放或替换第一份责任。


## Round 372：长 consumer 门闩的观察修复

上面的 round-369 首次失败和第二次成功保留为当时事实。round-372 修复后，原 Owner 已确认真实 terminal/drain 且仍等待原 cleanup 时可返回严格三字段 `{status: "finalizing", identity, claimGeneration}`，没有 receipt。员工验证器中间断言兼容 live/finalizing/unknown，但必须精确身份、正确形状且禁止 cleaned/夹带 receipt；unknown 仍不能令原 `waitForCleanup` 自动重试或成功。原等待链只对合法 finalizing 沿用 live 的 250ms、500ms、1s、2s、4s、5s 有界串行退避，稳定期最多 12 次/分钟；取消不影响原 consumer 或 Owner。

无需重跑安装版成功场景即可检查本轮修复。在实体隔离产品标准构建后运行：

```sh
npm run build
node --test dist/test/runtime/departmentexecutionowner.test.js \
  dist/test/runtime/departmentexecutionownerclient.test.js \
  dist/test/extensionHost/departmentprocessfinalizingobservation.test.js \
  scripts/verify_opencode_employee_native_drain.test.js
```

直接 facade 回归复用现有临时配置/任务夹具和固定生产 worker，受控 Node CLI 及后代真实 close/stdio 后继续保留 tab consumer，原自动 waiter 至少两次观察 finalizing 且不结算。释放 consumer 后严格验证原完整 required receipt；在可信宿主边界扣住 shutdown 请求、尚无 stopped 时 `service.observe.done` 仍不成功，交付 stopped 后才成功。它是本机进程/生产 facade 观察链证明，不是安装版 OpenCode、真实 EH/tab、组织容量释放或冷恢复证明。最终原生验证仍要求原 receipt/stopped、tab/根/链接/overlay 与配置租约逐项确认，不能用 finalizing 或业务结束代替。
