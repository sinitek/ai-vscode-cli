# 执行前仅检查配置档案身份

- 日期：2026-11-04
- 状态：completed
- 负责人：Codex

## 背景与目标

用户最初要求 Loop / Loop+ 遇到忙碌原生配置修复时只警告续跑，随后明确模型下拉切换不属于配置变化，最终收窄为“只检查档案切换变化，连接信息变化不需要比较”。最终执行准备只按 `configId` 检查档案是否切换；同一档案的版本更新、模型、连接、认证和原生内容差异均不作为配置变化检查，不再自动修复或提示漂移。完成后只提交并推送本任务改动。

## 范围与非目标

- 普通对话、Loop、Loop+ 主子任务及命令修复重试使用统一的档案身份检查与执行租约。
- 面板所见选择与锁内共享选择都只按 `configId` 判断切换，不比较 `revision`；执行准备不读取或比对档案摘要、模型、供应商、连接、认证及原生文件。
- 显式应用/保存档案仍完整写入和读回验证；保留共享状态不可执行检查、OpenCode 预检、执行租约，以及运行期间禁止切换/修改当前档案的约束。
- 不更改 runner / Codex 连接池的配置指纹隔离；该复用策略不属于档案切换检查。
- 不修改真实用户配置、不调用真实供应商模型、不修复既有范围外测试夹具、不变更框架或依赖。

## 验收标准

- 同一档案即使所见版本过期，普通、Loop、Loop+ 主子任务仍可执行；实际切换到不同档案时拒绝旧选择并请求刷新。
- 模型、连接及认证变化在空闲和并发执行时均不触发原生文件比较、修复、警告或中断；缺失原生文件也不会被执行准备重建。
- 显式应用仍可恢复档案内容；共享状态不可执行和其它原有启动失败不被忽略。租约保留、释放及运行期间禁止切换/修改当前档案仍生效。
- 构建及相关回归通过，文档与 ontology 同步；仅提交本任务文件并正常推送 `master` 至 `origin/master`，不强制推送。

## 影响面与风险

- 配置服务、共享配置协调、面板所见选择校验及相关配置/统一入口测试；不改七 CLI 原生配置策略或语义比较工具。
- 风险：执行准备不再保证原生文件与所选档案一致；由用户显式应用恢复，CLI 自身缺失配置或认证错误仍可能使实际调用失败。保留应用校验、共享状态和租约约束，不吞运行时错误。
- Git 初始提交 `f9a4fe5`，分支 `master` 跟踪 `origin/master`。当前工作区有并发的人工交互桌面提醒任务，`src/extension.ts`、功能清单及 ontology 有共享差异；仅暂存本任务 hunks，不纳入并发任务文件，不创建分支或强制推送。

## 验证计划

- `npm run build` 后运行配置服务、共享协调、统一入口、配置比较/策略和 Loop 集成测试。
- `node scripts/run_unit_tests.js`；上一轮已在未修改基线 `f9a4fe5` 复现 4 项 Webview 夹具失败，本轮继续分类记录。
- 临时 HOME 下真实文件和租约验证；ontology 校验与 `git diff --check`。
- 提交前检查完整差异和文件清单；推送后核对本地 HEAD 与远端分支一致。

## 任务列表

Tasklist:
- [completed] 将执行准备收窄为档案身份检查并补充回归
- [completed] 扩大验证并同步最终行为文档
- [completed] 生成隔离验证通过的本任务提交补丁

## 决策记录

- 2026-11-04：CodeGraph 和当前源代码确认模型下拉只写模型偏好；最初的忙碌漂移警告方案及后续的模型字段忽略方案均被用户最新要求取代，不保留字段白名单或连接信息比较。
- 2026-11-04：移除执行准备的档案摘要校验、原生配置应用回调与写保护上下文；共享协调和面板前置校验均只按档案 ID 判断切换，不以版本更新拒绝同档案任务。
- 2026-11-04：显式应用、保存、失败状态、OpenCode 预检及租约写保护仍使用原有约束；连接池指纹保留为复用隔离机制，不用于配置漂移阻断。

## 验证记录

- `npm run build` 通过；最小相关回归 97 项全通过。修正测试中将配置应用结果误写为租约结果的夹具，不改变 Kimi 保存行为。
- 扩展回归：`node --test --test-reporter=spec dist/test/config/configService.test.js dist/test/extensionHost/promptSessionHealth.test.js dist/test/config/sharedRuntimeConfig.test.js dist/test/config/runtimeConfigVerification.test.js dist/test/config/cliruntimeconfigstrategies.test.js dist/test/config/currentConfigOwnership.test.js dist/test/config/configApplyQueue.test.js dist/test/extensionHost/loopPlusRuntimeIntegration.test.js dist/test/extensionHost/subtaskCliExecution.test.js dist/test/extensionHost/loopModelRouting.test.js`，242 项全通过，无跳过。
- 回归覆盖真实面板前置校验、七 CLI × 三执行路径 × 普通/主/子任务的同档案旧版本执行、不同档案拒绝、共享状态失败、错误释放租约和临时 HOME 下真实配置/认证文件的变化及缺失；原生文件不改写，显式应用仍恢复档案内容。
- 全量：`node scripts/run_unit_tests.js`，2782 项中通过 2775、失败 4、跳过 3。工作区包含并发任务的新测试，计数与上一阶段不同。
- 失败分类：与基线 `f9a4fe5` 已复现的 4 项范围外夹具问题一致：`loopPlusModeEntry` 两项和 `looppluswebviewintegration` 一项缺少 `readVisibleConfigSelections`；`runPromptHistoryWebview` 一项缺少 `vscode`。基线证据 `/tmp/sinitek-loop-config-baseline-tests.9Nw2WX`，本轮日志 `/tmp/sinitek-profile-identity-full.log`；不修复范围外问题。
- 本机真实文件验证使用配置服务测试中的隔离 HOME 与实际原生配置、认证及租约文件，不接触用户配置或凭据、不发送供应商请求；本次没有 UI 布局改动，不需 Playwright。
- 待提交补丁使用独立临时 Git 索引，仅包含本任务 11 个文件；共享文件按 hunk 提取，排除人工交互桌面提醒差异。通过 `git archive` 导出该索引的树对象，在临时副本内单独构建，242 项相关回归全部通过，ontology 校验通过。
- 隔离全量：`node scripts/run_unit_tests.js`，2753 项中通过 2746、失败 4、跳过 3；失败与上述已复现基线相同。首次隔离运行另因仓库忽略 `package-lock.json` 而出现 `panelViewLocation` 缺少测试前置文件的环境失败；仅在临时副本补入本机 lock 文件后，该测试 3 项通过，重跑全量仅余 4 项已知失败。日志 `/tmp/sinitek-profile-identity-isolated-full.log`。
- 结构验证：`python3 .agents/skills/ontology/scripts/search_ontology.py --validate`、ontology 脚本测试 9 项及 `git diff --check` 全部通过。早期警告方案已在其归档顶部标记被本计划取代。

## 当前结论

实现、隔离回归、文档同步与 ontology 校验已完成。CodeGraph 用于入口及影响面导航，当前源代码和测试确认面板与共享租约两层均只按档案身份判断切换。Git 交付按用户授权仅提交该补丁并正常推送 `master` 至 `origin/master`，不强制推送，保留并发任务改动。稳定事实已写入运行时参考、功能清单和 ontology；架构分层不变，无需本任务修改 `ARCHITECTURE.md`，不重复扩写热区记忆。
