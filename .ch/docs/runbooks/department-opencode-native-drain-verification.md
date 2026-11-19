# OpenCode 原生同代多轮与排空验证

本验证器使用真实安装版 OpenCode、免费 loopback Chat Completions provider，以及生产 `createDepartmentLeaderProductionHost`、原生 session preparation、CLI builder、固定 Node Owner、parser、原生 ID validator、Ledger/Store 和原清理客户端。它不启动 VS Code/EH，不运行真实收费模型，也不证明完整组织树容量回收。

## 执行

显式提供物理隔离构建的 `dist`、不存在的 product 根和不存在的报告路径。product 与报告的父目录必须已存在；二者不得重叠，也不得位于仓库或构建目录内。不要构建或清理共享 dist，不安装/升级依赖。

```sh
node --check scripts/verify_opencode_owned_native_drain.js
node --check scripts/verify_opencode_owned_native_drain.test.js
node --check scripts/fixtures/opencode_local_provider_server.js
node --test scripts/verify_opencode_owned_native_drain.test.js
node scripts/verify_opencode_owned_native_drain.js --live \
  --module-root /private/tmp/isolated-build/dist \
  --product-root /private/tmp/new-opencode-product \
  --report /private/tmp/new-opencode-report.json
```

可以用绝对路径 `--binary` 指定安装版 OpenCode。版本及 run/export help 在隔离环境中读取；不支持约定协议时拒绝继续。Windows/POSIX containment、symlink escape、旧报告、重复参数和相对路径均有拒绝检查。Windows/Linux 实机执行仍需独立验证。

只继承 PATH/PATHEXT/SystemRoot/WINDIR/ComSpec/SYSTEMDRIVE。HOME、USERPROFILE、XDG、APPDATA、TEMP、OpenCode config/data/cache/state 都在全新 product 内；不继承 API key、用户代理、NODE_OPTIONS 或 OpenCode 配置。禁用模型目录抓取、升级、项目配置、外部 plugins/skills 和自动压缩。仅启用本地 `isolated/native-drain`，主/小模型同源；provider 绑定 `127.0.0.1`，外部代理指向关闭的 loopback 端口，NO_PROXY 仅 loopback。此配置隔离不是操作系统网络沙箱证明。

provider 使用已安装 binary 内可核对的 `@ai-sdk/openai-compatible` Chat Completions 协议，支持 JSON/SSE、有限请求预算和 text-only 回答；拒绝远程 model、错误鉴权、未知端点、无效 JSON/schema 和超限请求。OpenCode 的标题调用也可能使用 SSE，单独分类为 title，不能误当第二轮任务。没有 Codex Responses 协议或 HTTP prompt endpoint 替代执行。

## 成功合同

1. 唯一生产 producer 在无 prompt 原生准备前持久登记责任；生产 helper 启动独占认证准备服务，POST 创建并 GET 核验真实 `ses_`。准备服务的停止属于合同内行为，必须独立 close 和 stdio drain，不能计成任务自然退出。
2. 唯一任务写者保存并回读 `executionSession`；Store 原子 binding 并回读后才有首次私有最终 grant。
3. 同一 generation、Owner、execution identity、revision 和 native session 串行调用两轮。每轮保留本地 transcript key，stdout 经过生产 parser/validator；子进程自然 close、stdio 和输出消费者排空之后才允许下一轮。
4. 使用受控 tab host，但实际调用生产 WeakMap capability、消费者结束、精确 ownership、close 和消失回读。该能力只能证明受控 tab，不能声称真实 EH/tab 关闭。
5. seal 交给原生产清理链路。仅原 bootstrap 的严格 receipt 加 stopped 握手可产生 cleaned；逐项 required cleanup、配置租约清零、封闭集合及原 worker 正常关闭均需验证。只读 export 证明本次 session 的两条真实回答及历史仍在。验证器不主动归还容量。

Node 预加载观察器仅记录原 spawn/fork、grant、close、stdio 和私有 stopped 事件，所有调用原样委托，不修改产物、不伪造 receipt、不替换清理器。product 保留 audit、原始输出及 source/dist SHA-256 清单。源码对应检查覆盖验证器加载的生产依赖闭包和固定 worker；不相关并发编辑单独记录。模块依赖变化时拒绝使用旧构建。

任务生命周期和关闭各限 45 秒，短轮询限 10 秒，provider/任务写者也有界。超时即失败，未完成轮次不能补跑或重放。失败时 SIGKILL 仅为 hygiene，报告明确区分；不因 provider 回答、export、进程被回收或磁盘 cleaned 而成功。正常完成证明必须早于 teardown。失败 product 中责任、binding、session 历史和容量不删除。

## round-364 本机结果：阻断，未通过双轮

macOS arm64、Node v24.22.2、OpenCode 1.19.5。2026-11-15 的唯一实际任务场景产物：

- `/private/tmp/round364-opencode-native-report-02.json`
- `/private/tmp/round364-opencode-native-product-02/process-events.jsonl`
- `/private/tmp/round364-readonly-export-diagnostic.json`
- `/private/tmp/round364-native-failure-analysis.json`

真实首次准备、task session/Store binding 回读和首次 grant 已发生，独占准备服务 PID 56876 在 SIGTERM 后真实 close，stdout/stderr 均 end/close。原 Owner PID 56877、任务 PID 56878。原生会话为 `ses_e22b2eb86ffeu74Ap6tWf8KUhL`，ownerId 为 `ece92e82-78e9-43c2-9141-356f319c1cb3`，generation 1。provider 收到两个免费 SSE 请求，分别对应 CLI 日志中的 title 和 build；未发生协议失败。

第一轮原生日志已有 `exiting loop`，只读 export 在自然 close/stdio 完成后读到 assistant `finish: stop`、完整 `NATIVE_DRAIN_TURN_1_OK`。但任务 CLI 超过 45 秒没有自然 close，无 stdout consumer 回调及 drain 请求。没有第二轮、完整 receipt/stopped 或成功 tab 关闭。超时后强制回收 Owner/任务仅为 hygiene；原集合保持 open、容量仍为 `leaders: ["module"]`，配置租约未被伪造清除。

精确阻断阶段：session 准备在 `product/workspace`，固定 worker 将任务运行于自己的 `product/tmp/sinitek-loop-subtask-*`；原生 session/export 和 assistant path 仍属于前者。安装版 CLI 的本地 run 订阅当前实例事件，事件服务按 directory 过滤，并等 session idle 才返回。此目录差异是待生产修复任务核查的兼容点，不把推测当已证实根因。本任务未更改生产路由、执行根或清理门禁。

失败后仅增强验证器的实时输出/失败摘要、源码清单和 title 分类，并补单测；这些增强未再次启动真实 prompt，原失败证据保持有效，但最终版本的成功分支和新增实时诊断尚无真实双轮通过证据。完整 EH、真实 tab、整树容量、收费模型、冷恢复、其它平台和合并后全量回归继续开放。

## round-366 修复与本机通过证据

生产目录合同已修复，未通过更换验证器 cwd 绕过隔离：Ledger 登记后由生产 host 创建唯一执行根；真实原生 session 的 POST/GET、同代两次任务 cwd 及事件目录全部固定在该根。准备响应必须提供匹配的真实目录，允许 realpath 别名；目录不明/冲突即拒绝。私有 worker 不再为生产组长另建第二个根，seal 后通过原宿主 root capability 请求身份校验及链接清理。普通 Loop+ 和员工原有行为未迁移。跨代旧 session 只读核验其目录，不能以新根、新会话或 fork 获得启动能力。

安装版源片段保存在 `/private/tmp/round366-installed-directory-snippets.json`：`run` 订阅 `/event` 并等本 session 的 `session.status idle`；该事件流使用 `location.directory === instance.directory` 过滤。没有额外真实 prompt 对照或重放 round-364 调用。

2026-11-15，macOS arm64、Node v24.22.2、OpenCode 1.19.5，新场景命令：

```sh
node scripts/verify_opencode_owned_native_drain.js --live \
  --module-root /private/tmp/round366-build-wy_9wha6/dist \
  --product-root /private/tmp/round366-opencode-native-product-01 \
  --report /private/tmp/round366-opencode-native-report-01.json
```

结果为 `passed`，退出 0。三个免费 SSE 请求为 title 一次、task 两次，无 provider 失败。native session `ses_e2297e34bffe9UWS3eMlSdmOWp`，Owner `c4259933-7732-40a7-920c-ae49b3734d47`，execution `7dc4b6b8-5060-4cb1-b5ab-7c3fefdcf7fb`，generation 1。准备、两次任务与 export 的原生目录均为 `/private/tmp/round366-opencode-native-product-01/tmp/sinitek-loop-subtask-QMwdiq`，区别于原工作区；规则文件和 `.agents` 均未进入根。

两轮分别解析出 `NATIVE_DRAIN_TURN_1_OK` / `NATIVE_DRAIN_TURN_2_OK`，每轮原生绑定读取核验 6 次，本地 transcript key 保持 `local_transcript`。同一 identity 和 revision，唯一 Owner、两个 grant；首次 task session 与 Store binding 回读先于 grant，第二轮在首轮自然关闭和消费者完成后才启动。两次 CLI 的 close 均 code 0 / signal null，stdin/stdout/stderr 分别实际结束和关闭，未发送任务 kill。准备服务按原协议 SIGTERM 后独立 close/stdio drain。

原 client 完整 required receipt 的 processTerminal、streams、runner、executionRoot、links、temp、tab 均 confirmed；唯一 seal、receipt/stopped 握手、原 worker 自然关闭、集合 closed、配置 leases 为空、原根消失及受控 tab 消失均已验证。只读 export 自然关闭并保留四条消息/两次回答，用于核对历史，不代替上述排空。`normalLifecyclePassedBeforeTeardown=true`，`forcedCleanup=[]`。审计另外记录了共享 `runCliProcess.killProcessTree` 的延迟升级定时器在准备服务已经 close 约 2 秒后仍尝试 SIGKILL；该动作没有用于证明服务排空，不是任务进程信号，且需由共享生命周期后续单独评估取消定时器/PID 复用风险。报告和 product 保留审计、原始 stdout/stderr、原生 export 及源码/构建 SHA-256 对应关系。

本次新增目录证据断言及其测试通过；原 8 项参数/provider/隔离验证结果复用。定向生产 host 15/15、Owner/bootstrap/目录/执行根 41/41、受影响整树组合 2/2、员工 helper 直接兼容用例 1/1；标准 build 在物理隔离 src/dist 中通过。共享组合 fixture 只补齐原生 HTTP 的真实 directory 字段，未改变调度、验收或容量算法。两个不相关的并发文件变更由依赖闭包检查单独列出，不覆盖它们的结果。

此结果关闭 round-364 的组长目录/无输出/自然双轮排空缺口；round-364 的原责任和现场不被删除或补记成功。受控 tab 仍非真实 EH；真实 EH/UI/tab、真实组织整树容量端到端、跨代恢复、Windows/Linux 实机及合并后全量回归仍开放。员工在 workspace 准备再切换执行根的旧路径不在本次迁移范围，本次员工回归仅证明共享 helper 未改变其既有合同，不构成员工真实 binary 目录兼容证明。
