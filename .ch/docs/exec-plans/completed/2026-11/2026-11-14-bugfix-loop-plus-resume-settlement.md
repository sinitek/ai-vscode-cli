# Loop+ 停止后续跑与失败诊断

- 日期：2026-11-14
- 类型：bugfix
- 关联计划：无
- 状态：completed
- 负责人：Codex

## 背景与目标

近期 Loop+ 出现“自动调度已暂停，验收队列保持不变。running executions are still live”。只读核对实际任务与消息，区分停止后开放执行、CLI 启动失败、会话交接失败与环境阻塞，修复可复现的执行收尾/恢复缺陷并提供中文可操作诊断。

## 范围与非目标

覆盖 Loop+ 停止、执行收尾与显式继续链路及最小相关回归。保持用户运行数据、当前调度和验收队列不变；不停止运行任务、不发布、不修改依赖或模型配置。

## 验收标准

- 根据当前宿主真实执行所有权决定是否继续，不能把安全门禁删掉或用快照猜测成功。
- 停止后等待期间保留队列和 attempt；迟到结果、显式继续与重复通知不丢失、不重复执行。
- 用户可见暂停提示使用中文并说明实际条件。
- 构建与最小相关回归通过，记录本机只读取证与验证边界。

## 影响面与风险

- 代码：`src/loopSubtaskSession.ts`、`src/extensionHost/loopPlusRuntimeAdapter.ts`、`src/extensionHost/promptAutoRepair.ts`、`src/cli/cliCommandRepair.ts`、`src/extension.ts`；编排结算规则保留并补缺失子任务回归。
- 文档：Loop+ 调度设计、排障手册、功能清单及 ontology。
- 风险：取消后句柄与进程生命周期不同；必须保持原执行结束前不重派的边界。
- 回滚：回退本次源码变更；不需要运行数据迁移。

## 验证计划

- `npm run build` 后运行最小 Loop+ 编排、适配器、恢复与 scheduler 回归。
- 如涉及 Codex 所有权，执行 `npm run verify:loop-plus`，使用隔离环境，不接管用户会话。
- 本机证据只读提取错误与队列结构，不把用户原始日志或运行数据提交入仓库。

## 测试与清单同步

- 单元测试新增/更新：来源租约等待取消及后继排序、已执行租约不提前释放、后台压缩等待取消、启动准备迟到不派发、无子任务/句柄的残留预留结算及重新派发、shell 127 一次修复、宿主 PATH 与 shell 差异、普通 cwd ENOENT 不误修复。
- 最小回归命令：`node --test --test-reporter=tap dist/test/loop/loopSubtaskSession.test.js dist/test/loop/loopSubtaskAutoCompact.test.js dist/test/cli/cliCommandRepair.test.js dist/test/extensionHost/promptAutoRepair.test.js dist/test/extensionHost/promptSessionHealth.test.js dist/test/extensionHost/loopPlusRuntimeIntegration.test.js dist/test/extensionHost/loopPlusOrchestration.test.js dist/test/extensionHost/loopCrashRecovery.test.js dist/test/loop/loopPlusScheduler.test.js`，291/291 通过，无跳过。
- 构建：`npm run build` 通过；统一隔离检测另执行一次构建，通过。
- 失败处理记录：新增磁盘 fixture 首次构建缺少必填完成汇总字段，按夹具类型错误补齐；首轮单测 288/289，压缩等待用例使用时间戳 1，被历史保留规则裁掉任务，导致错误新建会话。改为当前时间并明确断言磁盘绑定后，291/291 通过；未放宽产品保留或会话规则。
- 功能清单、调度与会话复用设计、停止排障手册、ontology 会话复用及命令修复规则已同步；不涉及架构边界变化。稳定失败原因与处理方法进入 runbook，不重复写入 memory 热区。

## 当前进展

- 已完成 memory-recall（focus 为 Loop+ 主任务报错、暂停、验收队列及恢复，anchor 为空）、ontology 状态与规则召回、CodeGraph 索引同步及调用链查询。
- 最新同句提示来自停止后的显式继续，快照保留两个开放 running attempt，父任务 stopped、主模型失败计数 0，最近主模型正常返回 wait。源会话没有新 attempt 已启动的明确证据，不能断言模型服务报错或历史具体等待点。
- 历史 command-not-found、会话交接失败和 ENOSPC 分开解释。当前只读磁盘检查约 215 GiB 可用；旧 handoff 失败沿用已有不可重试暂停与版本能力隔离，不删除 writer 安全门禁。
- 可复现源码缺口：来源租约、后台压缩以及 `runPrompt` 启动前等待未响应取消，Promise 可长期占 running。新增仅准备阶段的取消：等待者返回 stopped；队列尾保留前驱依赖；实际调用开始后仍等返回；迟到准备因取消 guard 不启动 CLI。
- 既有冷恢复可以把无句柄 running 结算为 stopped/lost-process；新增回归证明原子任务记录完全缺失时也可恢复、保留原验收并重新派发，不伪造成功。
- shell 127 原来未被 ENOENT 修复覆盖，且宿主 PATH 可解析时会提前跳过。现仅识别 Codex app-server 启动包装的缺命令错误，允许固定已发现的绝对路径，原输入只重放一次。

## 本机验证与交付边界

- `npm run verify:loop-plus -- --report /tmp/loop-plus-fix-20261114-settlement.json`：退出 0，macOS arm64 / Node 24.22.2 / 默认解析 Codex 0.167.2；必要回归 801/801，无跳过。此版本采用 exclusive 策略，三轮交接均以原进程真实退出为释放证据（42/43/43ms），公共 runner 交接 45ms。另一会话保留，全部自有进程退出、stdio 关闭与临时目录删除已验证。报告保留 `fullyVerified=false`。
- 真实 shell 最小复现：临时目录假 codex、受限 PATH、隔离 ZDOTDIR；`zsh -fc 'codex --version'` 返回 127，经生产识别函数确认可修复，再用生产命令构建器生成含空格的绝对路径命令，返回 0。临时目录清理完成，不调用模型、不写用户配置。
- `python3 .agents/skills/ontology/scripts/search_ontology.py --validate` 通过；`python3 -m unittest discover -s .agents/skills/ontology/tests -p 'test_*.py'` 9/9 通过。
- `git diff --check` 与本次变更文件的 trailing whitespace 校验通过。
- 未验证 Windows/Linux 原生运行、已安装扩展、图形 VS Code、多窗口及真实模型完整任务；全仓单测未运行，统一必要回归与最小回归有重叠，不能相加当作独立覆盖。
- 用户当前运行数据、进程、调度与验收队列没有修改；没有安装、重载或发布扩展。源码修复不自动改造旧宿主的内存等待，不声称指定任务已恢复；新版本需在其它运行任务允许重载时加载，再显式继续原父任务。
