# 任务执行自动修复与单次新会话重试

- 日期：2026-10-18
- 状态：completed
- 负责人：Codex

## 背景与目标

任务执行遇到工具设置“自动修复”已支持的问题时，自动复用已有修复能力，成功后在原任务 Tab 使用新会话重放原任务一次，避免要求用户手动修复、重开会话和重新发送。

## 范围与非目标

- 覆盖统一 runPrompt 下的交互、OpenCode 单次和并行执行。
- 当前问题范围为 CLI 启动命令缺失（spawn ENOENT）；复用命令查找、Windows 注册表 PATH、绝对路径持久化能力。
- 一次原始请求最多一次修复后重试；第二次执行关闭通用隐式重试，防止扩大重试次数。
- 不自动安装 CLI，不重试普通业务、鉴权、计费、用户中断或配置解析错误；不删除旧会话历史。
- 不改动工作区内其它未提交功能。

## 验收标准

- 可修复的启动错误触发修复并在同一 Tab 清除旧会话绑定后重试原始输入。
- 保留模型、思考力度、图片、Loop/Graph 元数据和执行目录；新会话重新追加原始用户消息。
- 修复失败或重试失败停止；普通错误不调用修复，手动停止、Tab 关闭、工作区切换或新任务替代后不重试。
- 已有正常会话也强制换新，而不依赖会话健康检查；旧历史保留。
- 相关单测、构建通过，产品规格、功能总表、本体和用户说明同步。

## 影响面与风险

- 代码：命令修复、统一任务入口、三条执行链错误传播与重试限制、会话清理。
- 风险：旧执行上下文被复用、并发任务误重试、ENOENT 被吞掉或错误地识别普通文件缺失。
- 缓解：单次协调器、按 Tab 取消与当前上下文检查、只在命令确实未解析且查到可执行文件时重试、原始错误透传。

## 验证计划

- 新增协调器成功、失败、取消、替代、预算和输入保留用例。
- 补充三条执行链 ENOENT 传播和第二次执行禁用隐式重试的回归用例。
- 补充正常会话强制换新且保留历史的生命周期用例。
- `npm run build` 后从相关 `dist/test` 扩大到任务、会话、命令修复与 Webview 相关测试。
- 本机真实验证仅使用临时 CLI 脚本与临时目录，不修改用户实际 CLI 命令设置。

## 当前进展

- 已按 memory-recall（focus：自动修复/自动重试/新会话，无 anchor）和 ontology 恢复业务范围；召回只有通用记忆，无专项历史。
- CodeGraph 指向命令修复与任务入口；已读取当前文件确认事实。ENOENT 当前被通用隐式重试排除，OpenCode 在非 throwOnError 时吞掉最终失败，需要单独透传。
- Ontology 校验已有 15 处缺失文档引用，前一任务已证实 HEAD 基线同样存在；本次不扩展修复。

## 测试与文档结果

- 最终 `npm run build` 通过；统一协调器、三条执行链、会话、Loop+ 接线/集成、停止/退出、Webview、hidden retry 和命令运行相关回归共 231 项通过。
- CLI 修复整组有 3 项旧断言失败：CLI_LIST 已包含 Grok，而期望数组仍只含三个 CLI。使用 `git show HEAD:src/test/cli/cliCommandRepair.test.ts` 转译后对当前实现执行，复现完全相同的 3 项失败；分类为历史断言过期，不在本任务修改。
- CLI 修复整组其余 5 项通过，包含新增启动错误识别；`node --test --test-name-pattern='identifies command startup ENOENT' dist/test/cli/cliCommandRepair.test.js` 单独通过。
- 本机通过 Node `spawn` 启动不存在的临时命令，复用 `locateCliExecutableForRepair` 从临时用户目录查到 Node 可执行文件并写入临时设置。成功路径捕获真实 ENOENT 后以空 session ID 重放原输入；失败路径重放子进程退出 17 后停止。两条路径均断言 `executions=2, repairs=1, freshSessions=1`，全部通过并清理临时目录；没有改写用户 CLI 配置。
- `python3 .agents/skills/ontology/scripts/search_ontology.py --validate` 仍为原有 15 处缺失引用；新增来源文件均存在。`python3 -m unittest discover -s .agents/skills/ontology/tests -p 'test_*.py'` 为 8 通过、1 个当前本体验证用例因同样的 15 处缺失引用失败，无新增问题。
- `git diff --check` 和本次源文件/文档定向空白检查通过；`src/webview/viewContentStrings.ts:65` 原有行尾空白与 HEAD 完全一致，未顺手修改。
- 架构、产品规格、功能总表、CLI 运行参考、本体和既有 ENOENT 排障段落已同步；热区无需重复记录。
- 未启动真实用户 CLI 或 VS Code Extension Development Host，避免消耗真实服务或改写本机实际配置；本次是执行链行为与说明文案变化，没有新增页面布局，浏览器端由现有 Webview 自动化覆盖。

### 最终相关测试命令

```sh
npm run build
node --test \
  dist/test/extensionHost/promptAutoRepair.test.js \
  dist/test/extensionHost/promptSessionHealth.test.js \
  dist/test/extensionHost/promptInteractiveRuntime.test.js \
  dist/test/extensionHost/promptOneShotRuntime.test.js \
  dist/test/extensionHost/promptParallelRuntime.test.js \
  dist/test/extensionHost/promptRuntime.test.js \
  dist/test/extensionHost/promptRuntimeCoreCoverage.test.js \
  dist/test/session/sessionLifecycleCoreCoverage.test.js \
  dist/test/session/sessionMessageHandlersCoreCoverage.test.js \
  dist/test/extensionHost/loopPlusEntryRouting.test.js \
  dist/test/extensionHost/loopPlusRuntimeWiring.test.js \
  dist/test/extensionHost/loopPlusRuntimeIntegration.test.js \
  dist/test/extensionHost/extensionDeactivateStopAll.test.js \
  dist/test/webview/cliPageStaticRenderCoverage.test.js \
  dist/test/webview/clipagescriptruntimecoverage.test.js \
  dist/test/core/hiddenRetry.test.js \
  dist/test/cli/commandRunnerCoreBranches.test.js \
  dist/test/cli/commandRunnerCoverage.test.js
```

## 交付结论

已实现“遇到现有自动修复范围内的启动错误 → 自动修复 → 同 Tab 新会话重试原任务一次”。第二次执行不再进入通用重试，失败、停止、目标失效或任务替代后均不继续恢复。无剩余实施事项；已知基线测试/文档问题保留证据，不扩大修复。
