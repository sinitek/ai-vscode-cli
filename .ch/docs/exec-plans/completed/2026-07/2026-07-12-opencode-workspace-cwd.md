# 修复 OpenCode 工作区目录漂移

- 日期：2026-07-12
- 状态：completed
- 负责人：Codex
- owner：Codex
- claimed_at：2026-07-12
- claim_ttl：本次任务完成前
- handoff_to：

## 背景

VS Code 插件在目标项目 `/Users/fangjiawei/sinitek/sinitek-zhiqiu-workspace` 中启动 OpenCode 任务时，插件日志记录的 spawn `cwd` 正确，但 OpenCode 新建会话的 `directory`、`projectID` 与助手消息 `path.cwd/root` 均落到了 `/`，导致模型在多个仓库之间要求用户重新选择项目。

隔离复现确认：OpenCode 1.17.18 的 `run` 命令先按真实进程 cwd 创建实例，随后内部请求会读取环境变量 `PWD`。VS Code extension host 继承的 `PWD=/` 没有随 child process 的 `cwd` 自动更新，因此 OpenCode 又在 `/` 创建第二个实例和会话。将 `PWD` 同步为 spawn cwd 后，会话正确归属目标项目。

## 目标

保证通过插件启动的 OpenCode 任务同时获得一致的 OS cwd 与 `PWD`，从而始终识别当前 VS Code 项目。

## 范围

- 修正 CLI child process 环境构造。
- 覆盖 OpenCode one-shot、并行任务及复用该 runner 的上下文压缩路径。
- 增加真实子进程级回归测试。
- 同步运行时参考、能力清单与踩坑文档。

## 非目标

- 不修改 OpenCode 自身数据库中的历史错误会话。
- 不重构 VS Code workspace/session store 切换机制；现有证据表明本次事故不是 workspace key 解析错误。
- 不改变 Codex、Claude 或 OpenCode 的模型、参数和会话协议。

## 验收标准

- [x] 当父进程或 env override 中的 `PWD` 与 cwd 不一致时，CLI 子进程看到的 `process.cwd()` 与 `process.env.PWD` 都等于目标 cwd。
- [x] OpenCode one-shot 与并行执行继续显式传递目标 workspace cwd。
- [x] 相关单元测试通过。
- [x] `npm run build` 与完整测试通过。
- [x] 运行时参考、能力清单和 PITFALLS 记录该约束。

## 影响面

- 代码目录：`src/cli/commandRunner.ts`
- 测试目录：`src/test/opencodeCommandRunner.test.ts`
- 文档目录：`.ch/docs/references/`、`.ch/docs/product-specs/`、`.ch/docs/runbooks/`
- 配置与脚本：无

## 风险与缓解

- 风险：调用方显式提供错误 `PWD` 时被覆盖。
- 缓解：cwd 是插件已解析的权威执行目录，`PWD` 必须最后按 cwd 收敛；未提供 cwd 时保持原环境行为。
- 风险：历史 OpenCode 会话元数据仍显示 `/`。
- 缓解：新任务不再创建错误目录会话；OpenCode 会按 session 原始目录续接修复前已绑定 `/` 的历史会话，因此保留历史数据并要求用户升级后新建一次对话，不在插件侧直接篡改 OpenCode 数据库。

## 验证计划

- 最小相关验证：运行 `opencodeCommandRunner` 测试，断言 mock child 的 cwd/PWD 一致。
- 单元自测命令：`node --test dist/test/opencodeCommandRunner.test.js`
- 扩展验证：`npm run build` 后执行仓库完整 `node --test dist/test/*.test.js`。

## 测试与清单同步

- 单元测试新增/更新：`src/test/opencodeCommandRunner.test.ts` 新增真实 child process cwd/PWD 一致性回归。
- 单元自测结果：`node --test dist/test/opencodeCommandRunner.test.js`，42/42 通过。
- 失败处理记录：首轮测试仅因 macOS 将 `/var` 规范化为 `/private/var` 导致夹具断言失败；改为向 child 传递 `realpath` 后重跑通过，非实现缺陷。
- 功能清单：已更新 `.ch/docs/product-specs/FEATURE_INVENTORY.md`。
- 相关文档同步：已更新 CLI runtime reference、能力规格与 PITFALLS。

## 任务列表

- [x] 对齐插件日志、OpenCode export 与数据库证据
- [x] 用隔离 HOME/XDG 环境复现 stale `PWD` 行为
- [x] 同步 child process 的 cwd 与 `PWD`
- [x] 增加回归测试并同步文档
- [x] 构建并运行完整测试

## 决策记录

- 2026-07-12：采用 child process 环境根因修复，不扩大为 workspace/session store 重构。
- 2026-07-12：`PWD` 在合并调用方和 OpenCode overlay 环境后最后写入，确保不能覆盖权威 cwd。
- 2026-07-12：真实 OpenCode 隔离验证确认历史 root session 即使使用正确 cwd/PWD 续接仍会按原始目录运行，因此不篡改数据库，升级后新建一次对话。

## 当前结论

修复已完成。`npm run build` 通过，OpenCode 定向测试 42/42 通过，完整测试 485/485 通过；新 OpenCode 会话会稳定绑定当前 VS Code 工作区，历史已绑定 `/` 的会话需新建一次对话。
