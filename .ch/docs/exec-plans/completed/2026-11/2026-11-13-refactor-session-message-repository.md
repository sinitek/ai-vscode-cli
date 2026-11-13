# 实例级 SessionMessageRepository 抽取

- 日期：2026-11-13
- 类型：refactor
- 状态：completed
- 负责人：Codex（Loop+ 第二轮独立 attempt）
- 关联计划：无；panelStateBuilder / 群聊投影及 Codex runner 身份专项由其它任务负责。

## 背景与目标

将 sessionLifecycle 中的消息读写、缓存、规范化、Claude transcript 恢复、Grok 连续思考合并和永久裁剪标记收敛到实例级 factory。生命周期继续负责会话、Tab、运行身份、健康状态宿主更新和裁剪授权。

## 范围与非目标

修改 sessionLifecycle、新增 sessionMessageRepository 及其行为测试，保留公共 lifecycle 集成测试。使用 sessionStore 原有 IO 和序列化，不引入容器、继承、全局实例、额外格式或重复业务规则。不改 UI、runner、pool、配置身份、调度、任务记录、snapshot 或 active ids；不发布、升级依赖或读取真实历史。

## 验收标准与不变量

- [x] 动态 workspace + CLI + sessionId 缓存键，命中保留数组身份且更新健康。
- [x] 顺序保持 read → sanitize → 适用且未永久裁剪时 Claude 恢复 → Grok 合并 → 必要回写 → 缓存/健康。
- [x] 普通保存写失败继续保留缓存/健康更新、void 返回及原日志；读取错误仍由 loadErrors 传递。
- [x] Repository 独占 Set/WeakSet，草稿绑定和 mergeSessionMessages 的结果显式继承标记，重启不复活。
- [x] lifecycle 保留精准身份、id+content 陈旧检查、用户/最终答复/活动消息保护；裁剪写成功后才原地改所有数组并调整活动索引。
- [x] artifact、过期和跨 workspace 清理的范围、时机、日志、映射行为不变。

## 风险与缓解

核心风险是缓存身份变化、闭包固定 workspace、标记丢失和写失败时误删。以真实临时文件覆盖 Repository 行为并复用 lifecycle 永久清理、健康和迁移回归。并发编辑前重读，保留其它任务改动。可通过还原本次精确差异回退，不更改磁盘格式。

## 验证计划

1. `npx tsc -p tsconfig.json --outDir .tmp/loop-refactor-session-messages --sourceMap false --incremental false`
2. 对独立输出执行 Repository、sessionLifecycleCoreCoverage、sessionStoreCoreCoverage。
3. 对独立输出执行相关 session 测试，检查静态边界及 whitespace。

不运行或消费共享 dist；标准 build、真实 CLI、VS Code/Webview 手验、完整覆盖率门槛由主任务协调或明确记录未验证。

## 文档与 ontology

独立设计文档记录实现所有权。已查询 ontology manifest、会话/气泡保留规则及 source_refs，并核对 chat-bubble-retention 设计与当前源码。内部抽取保持业务概念、权限和来源入口有效，不争写 ontology domain、ARCHITECTURE、FEATURE_INVENTORY 或共享记忆。execution-plan skill 文件在工作区预先被删除，按 git HEAD 中的原文执行流程，不恢复用户删除。

## 任务与进展

- [x] CodeGraph 优先定位后直接核对源码、底层 IO、现有集成测试及文档规则。
- [x] 抽取 Repository 并最小化接线。
- [x] 新增行为测试、运行验证并记录精确结果。
- [x] 设计沉淀、完成归档及 attempt 报告。

## 验证结果与未验证项

最终代码验证完成；标准 build 与主任务合并验收不属于本 attempt。设计见 [SessionMessageRepository](../../../design-docs/session-message-repository.md)。

| 检查 | 精确命令/动作 | 结果与有效范围 |
| --- | --- | --- |
| 独立编译（两次） | `npx tsc -p tsconfig.json --outDir .tmp/loop-refactor-session-messages --sourceMap false --incremental false` | 两次退出 0；第二次在回调闭包接线和两个新增 lifecycle 测试之后，为最终源码有效编译 |
| 初始核心检查 | `node --test .tmp/loop-refactor-session-messages/test/session/sessionMessageRepository.test.js .tmp/loop-refactor-session-messages/test/session/sessionLifecycleCoreCoverage.test.js .tmp/loop-refactor-session-messages/test/session/sessionStoreCoreCoverage.test.js` | 47 项，46 通过、1 失败。之后 lifecycle 接线和测试增加，相关部分由下一行替代；Store 本身及依赖未改，7/8 证据保持有效，没有为了刷新证据重跑 |
| 最终 Repository + lifecycle | `node --test .tmp/loop-refactor-session-messages/test/session/sessionMessageRepository.test.js .tmp/loop-refactor-session-messages/test/session/sessionLifecycleCoreCoverage.test.js` | 41/41 通过：Repository 12，lifecycle 29（原 27 + 新 2）；0 跳过 |
| 其余 session 测试 | 下方 PowerShell 枚举独立目录，排除已覆盖的三文件后运行 | 237 项，235 通过、2 失败，0 跳过；未修改失败模块/测试 |
| 失败用例临时诊断 | `node --require ./.tmp/loop-refactor-session-messages-tools/isolate-home.cjs --test --test-name-pattern 'loads and exports historical|returns path and upload' .tmp/loop-refactor-session-messages/test/session/sessionMessageHandlersCoreCoverage.portable.cjs` | 临时编译副本将 parent filename 的反斜杠转为斜杠；os.homedir 指向自动清理的临时目录。选中 2/2 通过；不是原测试全绿的替代 |
| 静态边界 | `node .tmp/loop-refactor-session-messages-tools/audit-boundaries.cjs` | 通过：公开工厂参数/返回类型不变；三个抽取正文除 health 回调限定外相同；底层 IO 和失败模块/测试与 HEAD 相同；Repository 无禁止导入；lifecycle 不再持有裁剪集合。首次临时脚本未规范 CRLF 导致文本比较失败，修正脚本后通过，无产品源码变动 |
| ontology 状态 | `python .tmp/loop-refactor-session-messages-tools/search_ontology.py --root C:/work/sinitek-ai-vscode-cli --status-report` | ready；2 domain / 17 concept / 16 relation / 135 rule / 2 workflow。脚本取自 git HEAD，因为原路径已被删除 |
| ontology 查询 | `python .tmp/loop-refactor-session-messages-tools/search_ontology.py --root C:/work/sinitek-ai-vscode-cli --query 'pruned' --limit 4 --show-record` | 找到永久删除规则，核对其现有 source_refs；没有改共享域。最初未显式 root、随后使用代理 workspace root 的尝试因脚本位置及 junction 边界失败；改用 `.ch` 的实际目标根后成功。猜测规则 ID 无匹配后用关键词补足 |

其余 session 测试的精确命令：

```powershell
$sessionTests = @(Get-ChildItem -LiteralPath .tmp/loop-refactor-session-messages/test/session -Filter '*.test.js' | Where-Object { $_.Name -notin @('sessionMessageRepository.test.js', 'sessionLifecycleCoreCoverage.test.js', 'sessionStoreCoreCoverage.test.js') } | ForEach-Object { $_.FullName })
node --test $sessionTests
```

失败分类：

- `sessionStoreCoreCoverage` 的 `reports orphan deletion errors and sanitizes persisted messages into a stable sequence`：Windows 不提供该夹具依赖的 Unix 目录写权限语义；清理成功删除目录后 finally 的 `chmodSync(cliDir, 0o755)` 报 ENOENT。该例后续 sanitize 断言未执行，不能声称通过。未修改生产存储或该测试。
- `sessionMessageHandlersCoreCoverage` 的历史导出及上传两例：旧 mock 用 `parent.filename.endsWith("panelMessageHandlers/session.js")` / workspace.js，Windows 父模块路径使用反斜杠导致未命中，实际调用了文件适配器。仅在临时副本规范路径后 2/2 通过，支持夹具平台问题分类；原测试仍保留失败事实。mock 漏出创建的合成 fixture 上传和四份导出已按精确路径、内容确认后删除；没有读取或更改用户真实会话存档。

新增 Repository 测试覆盖成功、顺序、缓存身份/健康、动态 workspace+CLI 隔离、Grok 合并、恢复资格/异常、普通写失败、恢复回写失败、loadErrors、标记传播/重启、裁剪写失败及清理范围。新增 lifecycle 用例保留四组独立数组及活动索引的失败保护，以及缓存命中后宿主健康刷新。真实磁盘序列化通过临时目录，不调用真实 CLI；transcript 回调以测试端口模拟。

尚未验证：标准 `npm run build`、全仓 test:unit、100% 覆盖率门槛、真实 CLI/transcript 解析及 Extension Host/Webview 手验。按任务要求未运行/消费共享 dist，不执行发布脚本、不升级依赖。并行修改的 panelStateBuilder/群聊源代码不属于本方向验证所有权，主任务须协调最终合并构建。功能清单/ontology 语义和 source_refs 保持有效，无需共享修改；架构实现所有权已落独立设计文档，未写共享记忆。

归档已验证：完成文件存在、active 同名文件不存在、状态为 completed，设计与计划的双向相对引用均可解析。`node scripts/check_trailing_whitespace.js` 对六个最终产品/文档文件及 `git diff --check -- <同一文件清单>` 均退出 0。精确清单和 attempt 报告自身的 whitespace 检查另记在报告。最后一次代码检查后仅有本文档、设计及报告变更，不使 TypeScript/行为测试结果失效。
