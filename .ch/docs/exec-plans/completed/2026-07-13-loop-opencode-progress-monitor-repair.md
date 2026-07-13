# Loop 与 OpenCode 实时进度监控修复

- 日期：2026-07-13
- 状态：completed
- 负责人：Codex
- owner：Codex
- claimed_at：2026-07-13
- claim_ttl：1 day
- handoff_to：

## 背景

已交付的 OpenCode 子代理气泡依赖 `opencode run --port` 暴露本地 HTTP/SSE API。运行日志证明 OpenCode 1.17.18 虽接受该参数，却没有监听预留端口，监控器持续收到 `ECONNREFUSED`。同时，Loop 主从模式的“子代理”是插件启动的独立 CLI 子任务，而不是 OpenCode API 的 parent/child session；这些子任务只更新各自标签页，主对话在子任务完成前没有进度气泡。

## 目标

让普通 OpenCode 内部子代理与 Loop 独立子任务都能在目标对话中持续显示独立进度气泡；实时事件不可用时，最多 60 秒内给出可见状态或新增文本，并对监控失败提供明确、低噪音的降级反馈。

## 范围

- Loop 子任务标签页到主任务标签页的进度桥接与生命周期收口。
- Loop 子任务消息存储的每秒快照同步（强于原 60 秒兜底要求）。
- OpenCode 本地服务的可靠启动、附着、关闭与失败降级。
- 通用子代理气泡状态、国际化、日志和回归测试。
- CLI 运行时、产品能力与高复发坑文档同步。

## 非目标

- 不改变 Loop 的任务拆分、并发度、重试或完成判定。
- 不展示 reasoning、工具输入、密钥、绝对路径等敏感内容。
- 不读取 OpenCode 私有 SQLite 数据库。
- 不改变 Codex App Server 已有子线程分流协议。

## 验收标准

- [x] Loop 子任务启动后，主对话立即出现带子任务名称的独立运行中气泡。
- [x] Loop 子任务可见 assistant 文本实时同步到主气泡；事件遗漏时每秒从消息存储补齐快照，强于原 60 秒兜底要求。
- [x] Loop 子任务完成、失败、中断和进程退出均能收口气泡，且不覆盖父任务最终答复。
- [x] OpenCode 内部子代理监控使用健康检查通过的受管 `opencode serve`，不再对未监听端口无限重连。
- [x] 监控不可用时显示一次可理解的降级状态，SSE 日志重试采用最长 60 秒指数退避。
- [x] 中英文、相关单元测试、TypeScript build、功能文档和差异检查通过。

## 影响面

- 代码目录：`src/cli/`、`src/lobster*`、`src/extension.ts`、`src/subagentProgress.ts`、`src/i18n.ts`
- 文档目录：`.ch/docs/design-docs/`、`.ch/docs/references/`、`.ch/docs/product-specs/`、`.ch/docs/runbooks/`
- 配置与脚本：沿用 Node 子进程、HTTP 与现有消息持久化，不新增依赖或技术栈

## 风险与缓解

- 风险：Loop 子任务消息同时写入子标签页和主气泡，导致重复或父结论误判。
- 缓解：按 taskId/subtaskId 建立独立气泡身份，只同步可见 assistant 快照，并保留 `subagentId` 元数据隔离最终结论。
- 风险：父标签页关闭、恢复或切换会话后，进度更新路由错误。
- 缓解：运行时保存父目标标识，写入前重新解析消息存储；兜底轮询使用任务记录和子标签页映射校验。
- 风险：额外 OpenCode 服务进程泄漏或端口冲突。
- 缓解：服务句柄归属单次运行尝试，所有成功、失败、中断路径统一 dispose；启动就绪检查失败后降级而不阻断主任务。

## 验证计划

- 最小相关验证：Loop 进度快照提取/去重/生命周期、OpenCode 服务启动就绪与监控连接。
- 单元自测命令：构建后运行 Loop runner/lifecycle、OpenCode monitor/command runner、subagent progress、final conclusion 相关测试。
- 扩展验证：`npm run build`、相关 `node --test`、`git diff --check`、运行态端口与进程清理检查。

## 测试与清单同步

- 单元测试新增/更新：新增 `lobsterSubtaskProgress.test.ts`；更新通用子代理、OpenCode monitor 与 command runner 回归，覆盖主 tab 接线、快照过滤、生命周期、serve 启动、运行时 overlay 清理、健康检查、attach 参数和重连退避。
- 单元自测结果：`npm run build` 通过；10 个相关测试文件共 100/100 通过；`git diff --check` 通过。
- 失败处理记录：首轮仅有新测试回调变量被 TypeScript 推断为 `never`，归类为测试夹具类型问题，改为回调数组后重跑通过。真实 CLI 冒烟确认 `/global/health` 与 `run --attach` JSONL 传输可用；手工服务未注入插件私有配置环境，模型请求返回 OpenCode `UnknownError`，未将其误判为 attach 传输失败。
- 功能清单：已同步 `.ch/docs/product-specs/FEATURE_INVENTORY.md`。
- 相关文档同步：已同步 CLI runtime reference、VS Code runtime 设计、能力规格和 PITFALLS。

## 任务列表

- [x] 冻结 Loop 子任务进度源、父气泡路由和生命周期契约。
- [x] 实现 Loop 主 tab 即时状态气泡与每秒可见消息快照同步。
- [x] 替换 OpenCode 不可用的 `run --port` 监控启动方式。
- [x] 补齐测试、国际化和事实来源文档。
- [x] 执行构建、相关测试、差异复核、VSIX 安装并归档。

## 决策记录

- 2026-07-13：运行日志显示 `run --port 57925` 后端口持续拒绝连接，不能继续把 CLI 参数存在视为服务可用。
- 2026-07-13：Loop 子任务是插件拥有的独立进程，应直接复用插件消息流和持久化状态，不伪装成 OpenCode 内部 child session。
- 2026-07-13：OpenCode 内部子代理改用受管 `serve + /global/health + run --attach`；启动失败时降级为普通父任务，不因观测能力阻断任务执行。
- 2026-07-13：Loop 主气泡只同步非 thinking、非内部子代理的 assistant 文本；工具输入和 reasoning 继续只留在子任务 tab，避免敏感内容扩散。

## 当前结论

实现完成。Loop 子任务现在启动即在主对话显示独立进度气泡，并每秒从子 tab 权威消息存储同步可见 assistant 快照；OpenCode 内部子代理由受管 `serve + attach` 提供已验证的 HTTP/SSE 数据源，保留 60 秒全量轮询并增加指数退避和可见降级状态。构建、100 条相关回归、差异检查、真实 attach 传输冒烟和 VSIX 强制安装均已完成；当前窗口需重载后才会使用新 Extension Host，重载前已运行的旧任务不会被新逻辑追溯接管。
