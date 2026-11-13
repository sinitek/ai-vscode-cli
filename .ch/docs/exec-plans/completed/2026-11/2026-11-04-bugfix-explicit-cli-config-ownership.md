# CLI 当前配置归属与执行前按需校验

- 日期：2026-11-04
- 状态：completed
- 类型：bugfix
- 负责人：Codex

## 背景与用户决策

- 执行前比对当前主动选择的档案与目标原生配置，不一致才覆盖；禁止非主动操作恢复旧档案。
- 用户结构化确认：Loop/定时任务历史绑定与当前档案不同，改用当前档案，不暂停等待旧档案，也不隔离执行旧档案。
- 已有审计确认 Claude 会话和 Codex 共享池可能保留旧配置，必须同时处理配置身份与进程复用。

## 范围与非目标

- 覆盖七个 CLI 的按需落盘、任务启动和重试、Tab/历史恢复、Loop 恢复与配置身份读取。
- 当前激活档案保存、显式切换和用户明确编辑仍属主动操作；任务执行只允许修复当前档案的文件，不提交其它激活身份。
- 不控制外部窗口/CLI 自行写文件，不引入跨进程文件锁，不修改用户真实配置，不发送真实模型请求。
- 保留任务开始时已有模型发现、配置服务/面板及前轮审计文档改动。

## 关联计划

- 历史测试摘要：[删除审计](../../migrations/test-plan-removals/2026-11-11-nov-active.json)，在 JSON 中以完整 `source_old_path` 值 `.ch/docs/exec-plans/completed/2026-11/2026-11-04-explicit-cli-config-ownership.md` 定位历史记录；原 test 计划已删除，本计划不承接测试开发，审计不提供原计划完整正文。
- 历史文档分工：原 docs companion `2026-11-04-docs-explicit-cli-config-ownership.md` 已退役；仅留历史身份与分工，完整校验记录未恢复。本计划只承接运行行为修复。[references 索引](../../../references/index.md)仅作导航。

## 验收标准

- 当前配置语义一致时七个策略不写目标文件；不一致时按现有合并规则覆盖并读回校验。
- 任务前校验失败停止执行，不带旧配置降级；不自动激活首项、历史档案或子任务绑定档案。
- Tab/历史恢复不更改激活档案；旧任务使用当前选择，不恢复旧供应商配置。
- 配置变化导致下一回合重建相应 runner/连接，不打断其它 Tab 正在运行的进程；保留会话续接。
- 相关回归、`npm run build`、ontology 与文档检查通过，并记录未覆盖的外部并发边界。

## 风险与回滚

- 风险：旧任务模型不属于当前档案、DSH/ZCode 的合并语义、用户切换与任务准备交错、长连接共享。
- 缓解：复用现有结构化校验；任务准备不提交 active ID；配置身份变化向两层复用判定传递；增加成功、失败和竞争回归。
- 回滚：仅回退本任务差异，不覆盖既有未提交变更。

## 验证计划

- 最小单测：runtimeConfigVerification、cliruntimeconfigstrategies、conversationTabConfiguration、promptSessionHealth、manager、codexAppServerPool/runner。
- 扩展验证：配置页/模型选择、Loop 与定时任务相关测试；隔离真实 Node 协议子进程验证共享池隔离。
- 构建：`npm run build`；知识同步：ontology validate、功能清单与相关运行文档。

## 任务列表

Tasklist:
- [completed] 梳理配置写入与自动切换入口
- [completed] 明确执行校验与切换边界
- [completed] 实现配置保护与两层身份传递
- [completed] 验证运行行为、失败边界与未覆盖项

## 进展与测试记录

- ontology ready，已核对配置提交规则与当前实现；memory-recall focus 为配置切换/执行校验，anchor 为空，召回以基线为主，额外沿用前轮已确认源码。
- CodeGraph 用于定位调用链；对标记磁盘变更的文件直接核对当前源码。
- 本任务实施与验收完成；以下结果基于验证时完整工作区，未回退或认领任务开始前及执行期间的其它配置、模型发现和前轮审计改动。

## 实现与关键决策

- `runtimeConfigVerification` 复用现有结构化校验增加读前比较；七个 CLI 策略仅在不一致时落盘并读回验证。Codex 同时检查 config/auth，Claude MCP 保持顶层浅合并，ZCode 仅在实际写入前备份。
- 配置读取不再顺手创建缺失的原生文件；仅 ENOENT 视为空内容，权限等读取错误继续向上传播。首次加载、心跳与空闲刷新不根据磁盘匹配项或有序首项提交另一个激活档案；已删除的选择可清空，但不替用户另选。
- 统一任务入口在每次派发及命令修复重试前重新读取当前选择，执行校验不提交 active ID。新增队列 `requestIfIdle`，避免任务准备在等待结束后抢掉刚发起的用户切换；应用、等待与校验失败均阻止启动。
- 历史、Tab、Loop 和定时任务不恢复旧档案；旧档案与当前选择不同时，清除旧模型/思考快照，按当前档案的角色模型执行。用户明确选择“恢复原分组和配置”仍属于允许的主动切换。
- 实际原生配置、认证文本与档案 ID 生成 SHA-256 指纹，贯穿交互宿主、六类常驻 runner 与 Codex app-server 池。不同指纹不复用旧 runner/连接；仅重建对应会话的运行实例，不停止其它 Tab 保留的进程，保留原有会话续接。指纹不包含可读的密钥值。

## 验证命令与结果

- `npm run build`：通过，包含清理 dist 后的 TypeScript 编译；日志 `/tmp/cli-config-build.log`。
- 最小相关 12 文件回归：228 项通过、0 失败；日志 `/tmp/cli-config-tests-3.log`。覆盖七类策略、语义相等跳写、读写失败、队列竞争、原生文件不创建、配置/认证指纹、历史子路由、runner 重建与连接池隔离。
- 新增执行宿主、定时任务及派发契约定向验证：`node --test dist/test/extensionHost/promptInteractiveRuntime.test.js dist/test/extensionHost/scheduledTaskConfigOwnership.test.js dist/test/extensionHost/extensionHostExtractionContracts.test.js dist/test/extensionHost/promptExecutionShared.test.js`，52 项通过、0 失败；日志 `/tmp/cli-config-final-targeted.log`。
- 配置、交互、Loop 与执行宿主扩展验证：以下命令通过 1685 项，0 失败；日志 `/tmp/cli-config-final-broad.log`。

```sh
test_files=($(rg --files dist/test/config dist/test/interactive dist/test/loop dist/test/extensionHost | rg '\.test\.js$' | rg -v '(Live|liveBoundary|PluginLive|LiveBoundary)'))
node --test --test-concurrency=4 "${test_files[@]}"
```

- 会话全组验证：以下命令通过 212 项，0 失败；日志 `/tmp/cli-config-final-session.log`。与扩展组不重叠，最终两组合计 1897 项通过。

```sh
session_test_files=($(rg --files dist/test/session | rg '\.test\.js$'))
node --test --test-concurrency=4 "${session_test_files[@]}"
```

- 本机真实子进程：`codexAppServerPool.test` 启动隔离 Node JSON-RPC 子进程，同指纹共享实例，改变指纹产生不同 PID，释放其中一个 Tab 后另一 Tab 仍可使用旧进程。没有调用实际供应商或修改真实 CLI 配置。
- `python3 .agents/skills/ontology/scripts/search_ontology.py --validate`、`npm run validate:whitespace`、`git diff --check`：通过。

### 失败分类与处理

- 初次扩展验证的两条派发参数源码契约断言仍期待 `attemptInput`，属于本次行为调整后的断言过期；已更新为校正后的 `currentAttemptInput`，保留派发路径检查并重跑通过。
- 同轮另外两条模型发现 bridge 对齐断言不属本次配置归属修改范围，未为其扩大修改。当前工作区的最终重建及扩展回归已全部通过，不把中间失败当成当前遗留问题，也不将其它工作的变化计入本任务交付。

## 文档与记忆收口

- 已同步 `FEATURE_INVENTORY.md`、`sinitek-cli-plugin-capabilities.md`、`cli-runtime-reference.md`、`PITFALLS.md` 与配置应用/选择/Tab 恢复相关 ontology 规则。
- 旧审计与已归档的“警告后继续”计划保留历史事实，当前运行手册和功能清单以本次失败阻断契约为准。
- 模块分层和技术栈未改变，无需扩写根级 `ARCHITECTURE.md` 或增加通用 skill；稳定规则与复发风险已上提至运行手册、产品规格和 ontology，不重复写入热区摘要或事件记忆。
- 最终归档路径：`.ch/docs/exec-plans/completed/2026-11/2026-11-04-explicit-cli-config-ownership.md`，运行手册引用同一路径。

## 未验证项与保证边界

- 未执行真实供应商请求、Extension Development Host 端到端操作或各 CLI 的实机热加载验证；本次无页面布局变更，不运行 Chromium 页面冒烟。
- 运行中的请求不会自动迁移至新配置；保证面向下一次准备与派发。原生 CLI 自行维护的非档案元数据不属于档案选择；已有 Codex 项目信任准备逻辑不变。
- 只能约束本扩展进程内的配置归属和复用，不控制其它扩展窗口、外部 CLI 或其它进程改写文件，不提供跨进程原子性或部分写入自动回滚。配置校验失败时不启动任务。
- 已运行的旧版本扩展需重载后才能使用这些修改；没有提交、发布或修改用户真实运行配置。
