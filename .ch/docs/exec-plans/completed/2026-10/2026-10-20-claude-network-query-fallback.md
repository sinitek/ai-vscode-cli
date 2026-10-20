# Claude 联网查询空结果修复

- 日期：2026-10-20
- 状态：completed
- 负责人：Codex

## 背景与目标

实际插件日志中的天气请求连续调用两次 WebSearch，工具只返回空结果包装，随后以无法获取天气结束；之前只验证了手工 CLI 提示和任务工具，没有把用户要求的 curl 路径加入实际 Runner。此次从插件统一请求入口修复，不再把 CLI 手工成功等同于插件成功。

## 范围与非目标

- 在 Claude SDK 统一输入中增加联网规则，覆盖普通、分组、Loop 子任务、Graph、会话复用与恢复。
- 当前已确认 WebSearch 空结果与 WebFetch 多站点域名安全检查失败，SDK 禁用二者；使用 Bash/curl，天气查询解析完整 JSON、精简字段并校验日期。
- 按用户追加要求，真实验证其他常用工具；只有确认能力缺失或失败时才用命令替代，已经工作的原生工具保留。
- 单次 CLI 调用与 SDK 每轮输入共用 `src/cli/claudeToolPolicy.ts`，避免只修某条入口。
- 保留用户原始提示、项目指令隔离策略、免审与原生 `/compact` 行为。
- 不修改用户配置、历史会话、运行态任务；不安装或升级依赖，不修复外部 WebSearch 服务。

## 验收标准

- 所有非原生压缩请求均携带联网规则，续聊不会漏掉；`/compact` 内容保持不变。
- SDK 禁止 WebSearch/WebFetch，但不缩小其他工具集，任务工具 opt-in 与用户 settings 保留。
- 经真实 ClaudeInteractiveRunner 查询天气，观察 Bash/curl 工具调用及带日期的天气结果，并与同源响应核对。
- 构建、相关单测、本体和改动文件校验通过；失败按测试基线分类。

## 影响面与风险

- 实现：`src/interactive/claudeRunner.ts`、`src/cli/cliRunArgStrategies.ts` 与 `src/cli/claudeToolPolicy.ts`。
- 回归：Claude Runner 与网络规则单测。
- 文档：功能清单、CLI 运行时参考、避坑指南、本体。
- 风险：curl 服务或目标网络也可能不可用；必须报告真实错误，不得编造天气。Windows PowerShell 使用 `curl.exe`，避免别名差异。
- 回滚：移除统一规则注入和 WebSearch/WebFetch 禁用项即可恢复旧行为，不影响持久化数据。

## 验证计划

- `npm run build`
- Claude Runner、网络规则、任务列表及相关压缩单测。
- `python3 .agents/skills/ontology/scripts/search_ontology.py --validate`
- 真实 SDK Runner 的普通/隔离子任务及续聊 smoke，观察工具名称、执行结果和最终回复。
- 仅检查改动文件空白与 `git diff --check`，范围外失败单独记录。

## 测试与清单同步

- 单元测试新增/更新：工具提示原文保留、续聊独立性、原生 compact、CLI 单次调用、SDK coding/恢复/隔离 loop/graph/plan、完整 JSON 解析及错误响应；同步受影响的参数断言。
- `npm run build`：通过。
- 单元自测：`node --test dist/test/cli/claudeToolPolicy.test.js dist/test/cli/cliRunArgStrategies.test.js dist/test/cli/commandRunnerCoverage.test.js dist/test/interactive/claudeRunner.test.js dist/test/interactive/claudeTaskList.test.js dist/test/core/contextCompactionRunner.test.js dist/test/interactive/manager.test.js dist/test/interactive/runnerRetention.test.js dist/test/extensionHost/promptInteractiveRuntime.test.js dist/test/extensionHost/promptOneShotRuntime.test.js dist/test/extensionHost/interactiveTurnStrategy.test.js dist/test/cli/commandRunnerCoreBranches.test.js dist/test/loop/loopMainAutoCompact.test.js`：123/123 通过。
- `python3 .agents/skills/ontology/scripts/search_ontology.py --validate`：通过，50 条规则；`python3 -m unittest discover -s .agents/skills/ontology/tests -p 'test_*.py'`：9/9 通过。
- `git diff --check`：通过。
- 功能清单、CLI 运行时参考、PITFALLS 与 ontology 已同步。
- UI 无改动，无需浏览器 smoke。

## 当前结论

日志已证实本次失败不是权限拒绝，也不是任务工具不足，而是 WebSearch 空结果后缺少真正生效的 curl 路径；现已在统一入口修复。当前接入实测结论不等于这些工具在所有环境永久不可用。

## 真实调用验证

- Claude 本机入口保持现有配置，不安装或升级 CLI/SDK；所有文件测试只在新建临时目录，未修改用户项目或配置。
- 实际 `ClaudeInteractiveRunner` 输入仅为“今天上海天气”，没有测试侧追加 curl 提示；最终 coding 首轮与续聊、隔离 loop 以及通过实际 `buildCliArgs` 的 CLI 单次调用都成功。均实际执行 Bash 的 curl + Node 解析命令，未调用 WebSearch/WebFetch。
- 真实结果为 2026-10-20、日最低 21°C / 日最高 27°C、阴天及傍晚小雨；与工具完整 JSON 及独立同源 curl 核对一致。解析后 JSON 约 2.4KB，避免原始约 39KB 响应仅显示预览。续聊仅复述前轮数据，不重新联网，原生工具输出与最终答复日期、温度一致。
- 原生成功：Write 创建、Read 读回、Edit 精确修改、Bash、ToolSearch、TaskCreate/TaskGet/TaskUpdate/TaskList、Agent 同步返回 7+8=15、NotebookEdit 修改 notebook 后读回、TaskStop 停止本次创建的 sleep 后台任务。
- WebFetch 对 example.com、wttr.in 与官方文档均报告无法验证域名安全；相同天气和文档 URL 的 curl 成功。Glob/Grep 在当前工具集合未暴露，ToolSearch 精确查找无匹配；Bash 的 find/grep 实际验证找到测试文件和修改内容。
- 未对全部 MCP、调度、Worktree 等有外部副作用或配置依赖的工具做穷举；不标注它们不可用，策略要求按真实结果判断并保留权限边界。

## 失败分流与限制

- 实测曾发现 curl 原始大响应仅给预览时模型猜错日温度，这是结果核验缺陷，已改为完整 JSON 精简输出，并增加解析器执行回归。解析器示例括号错误由新增测试发现，分类为实现缺陷，已修正并重新通过全部 123 项测试及真实调用。
- Windows/Linux 替代提示和路径边界有静态/单元覆盖，本机真实调用仅在 macOS；未宣称跨平台端到端验证。
- 未操作正在运行的 VS Code UI，没有宣称已经加载新代码。源码构建不更新已安装扩展；使用安装版时需重新打包安装修复版再 Reload Window，使用开发宿主时需重新构建并重载宿主。现有会话和私有日志未写入仓库文档。
