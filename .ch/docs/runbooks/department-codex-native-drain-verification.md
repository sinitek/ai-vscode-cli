# 验证真实 Codex 专属执行的自然排空

本 runbook 使用本机已安装的真实 Codex CLI/app-server、临时 HOME/CODEX_HOME/workspace 和仅监听 loopback 的免费 Responses provider。它不读取用户 Codex 配置、凭据、会话或业务数据，也不连接真实模型服务。生产 runner 和 pool 从隔离源码构建加载；脚本不会安装 `vscode` mock。

## 前置条件

- Node.js、npm，以及可执行的真实 `codex` binary。
- 已构建且源码与当前工作区目标 runner/core 匹配的隔离副本。不得用仓库共享 `dist`。
- 空闲 loopback TCP 端口。脚本只监听 `127.0.0.1`。

先确认当前源码与隔离副本相符，再运行：

```sh
node --check scripts/fixtures/codex_local_responses_server.js
node --check scripts/verify_codex_owned_native_drain.js
node scripts/verify_codex_owned_native_drain.test.js
node scripts/verify_codex_owned_native_drain.js --live \
  --module-root /absolute/path/to/isolated-build/dist \
  --report /absolute/path/to/new-report.json
```

必须通过 `--module-root` 显式指定独立源码副本的构建目录；脚本不读取环境变量作为替代，也不会回退到仓库共享 `dist`。报告路径必须尚不存在。CLI binary 可以通过 `CODEX_BINARY=/absolute/path/to/codex` 显式指定；版本必须能够由其 `--version` 输出识别。执行环境仅继承查找该 binary 必需的 PATH/平台变量，并把 HOME、CODEX_HOME、临时目录固定到新建目录；不继承认证 token。临时 Codex 配置声明 `requires_openai_auth = false`，provider endpoint 是脚本动态选择的本机端口。

## 场景和判定

脚本创建第一项不可变 `CodexOwnedExecution`：先调用真实 `thread/start`，经同一 CLI 响应流生成一个短回答，等待原生 turn terminal，再执行自然 stdin EOF 排空。它分别检查 business、turnTerminal、processTerminal、streams、executionDrain 和 runner 全部 confirmed；child exit/close、stdin/stdout/stderr end/close 必须由事件观察到。新建 thread 的真实响应路径需位于临时 CODEX_HOME，并在下次执行前仍存在。

第二项执行使用新建对象、新专属连接和完全相同的 thread ID，必须取得真实 `thread/resume` 请求/精确响应，再完成一次独立 turn 及自然收尾。Responses provider 的 `previous_response_id` 不属于本验证合同，可能为空；续接证据是 app-server 原生请求/响应中的精确 `thread/resume` 与同一持久 thread ID。两次 Responses 请求都由本机 fixture 处理，任务只会发送给本地 fixture，不会调用真实模型。

任一阶段超时、协议错误、身份不符、未排空、状态为 failed/unobservable/not-applicable、流未自然结束、进程仍存活或 fixture 回收触发 kill，均为失败。超时和 kill 只允许回收本测试持有的子进程，不构成清理证据。脚本失败时仍尝试写唯一 JSON 报告，记录binary版本、环境、原生请求和已得清理事实；失败报告不得被表述为自然排空成功。

真实 Codex 对本机 Responses fixture 所需的协议版本和会话文件布局会随 CLI 版本变化。报告应保留实际版本。通过只证明该binary版本、当前平台和此受控provider路径；不证明远端模型、所有Codex版本、真实业务目录、Extension Host、DepartmentRuntimeStore或完整Owner receipt。脚本不能读取/复制用户会话来增强测试。

## 证据解释

每次运行的结果以对应的 attempt 报告及本次 `--report` 指定的 JSON 文件为准；本 runbook 不固定引用某一轮的报告路径。`streams`、`processTerminal`、`executionDrain` 和原生 turn terminal 是独立事实。若实际 runner 将 executionDrain 保守返回 unobservable，即使进程与streams已自然结束，也必须保留失败；不得通过编辑 fixture、杀进程或合并其他字段推导成功。复测前需确认源码版本及隔离build，避免运行旧dist。该命令不执行 build；也不运行其它既有测试套件。
