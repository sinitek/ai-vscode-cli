# 子任务创建气泡去重

- 日期：2026-10-29
- 状态：completed
- 负责人：Codex
- owner：子任务创建气泡修复
- claimed_at：2026-10-29
- claim_ttl：本次会话内
- handoff_to：无

## 背景

用户报告 Loop、Loop+、Graph 子任务创建时出现正常气泡与系统气泡，只保留正常样式；补充确认主任务不在修改范围。Loop+ adapter 在调用统一 runPrompt 前，通过 appendSubtaskPrompt 将同一提示词额外写成 system 消息；经典 Loop 与 Graph 也向新建子会话写入启动说明。

## 目标

子任务创建提示词统一由现有 runPrompt 路径生成正常 user 气泡，不再额外生成子会话创建 system 气泡。

## 范围

- Loop+ adapter、宿主 wiring 与测试夹具中的重复提示词入口。
- 经典 Loop、Graph 对子会话的创建说明写入及相关测试。
- 功能清单、能力规格、相关 ontology 描述。

## 非目标

- 不改主任务的派发提示、进度、错误、完成消息及调度流程。
- 不修改气泡样式，不做全局 system 消息隐藏，不改写历史会话数据。
- 不处理工作区已有的配置备份、上下文压缩等并行改动，不提交代码。

## 验收标准

- [x] Loop+ 子任务仅由 runPrompt 生成正常提示词气泡，保留任务、轮次、子任务元数据。
- [x] 经典 Loop 与 Graph 不向子会话额外写入创建 system 消息，父会话仍记录派发。
- [x] 主任务与执行错误等系统消息保持原有行为。
- [x] 最小相关单测、npm run build 与文档结构校验通过。

## 影响面

- 代码目录：src/extensionHost/、src/extension.ts、相关 src/test/。
- 文档目录：.ch/docs/product-specs/、.ch/docs/ontology/、本执行计划。
- 配置与脚本：无新增配置、依赖或脚本。

## 风险与缓解

- 风险：删除重复 system 消息后丢失子任务上下文。
- 缓解：验证正常 user 消息仍携带 taskRole、loopTaskId、loopRound、loopSubtaskId；Graph 继续保留 graphRunId/graphNodeId 与节点目标绑定。
- 风险：误删父会话派发或异常说明。
- 缓解：限定删除子会话创建写入，通过宿主测试验证消息归属，保留通用 system 写入 API。

## 验证计划

- 最小相关验证：相关 adapter 集成、经典 Loop 跨 CLI 子任务执行、Graph 宿主测试。
- 单元自测命令：npm run build；node --test dist/test/extensionHost/loopPlusRuntimeIntegration.test.js dist/test/extensionHost/loopPlusRuntimeWiring.test.js dist/test/extensionHost/subtaskCliExecution.test.js dist/test/graph/graphExtensionRuntime.test.js。
- 扩展验证：ontology --validate；git diff --check；根据现有宿主/页面夹具补充本机 Webview 渲染验证。

## 测试与清单同步

- 单元测试新增/更新：Loop+ 集成测试验证同文案仅一个 user 气泡、身份元数据不丢失且主任务提示仍只有一条；经典 Loop 与 Graph 跨 CLI 测试验证创建消息只写父会话，Graph 同时覆盖 executor 与 planner 节点。测试夹具开放 getMessages，并在子任务关闭清理消息之前采集快照。
- 单元自测结果：npm run build 通过；下列 7 个测试文件共 67 项通过。
  - node --test dist/test/extensionHost/loopPlusRuntimeIntegration.test.js dist/test/extensionHost/loopPlusRuntimeWiring.test.js dist/test/extensionHost/subtaskCliExecution.test.js dist/test/extensionHost/extensionHostExtractionContracts.test.js dist/test/graph/graphExtensionRuntime.test.js dist/test/loop/loopSubtaskLifecycle.test.js dist/test/loop/loopSubtaskProgress.test.js
- 回归前证据：Loop+ 同文案消息计数为 2 而非 1；经典 Loop 与 Graph 均观测到对子会话的 system 写入。移除写入源后相关断言通过。
- 失败处理记录：扩展执行上述测试及 dist/test/webview/clipagescriptruntimecoverage.test.js，172 项中 171 项通过、1 项失败。失败为 keeps the owning conversation tab errored for error bubbles through append, update, collapse, and recovery，断言 undefined !== true。使用 node --test --test-name-pattern='keeps the owning conversation tab errored' dist/test/webview/clipagescriptruntimecoverage.test.js 单独运行仍复现。分类为范围外失败：该测试只依赖 Webview/配置脚本，不加载本次修改的宿主模块，相关源码与该测试文件均未在本次任务修改；工作区原有相关改动保留，不为此扩大修复范围。
- 浏览器验证：使用本地已安装 Chromium 和项目 smoke runner，加载真实 getWebviewHtml 与 Loop+ adapter 测试夹具产生的创建消息，模拟 VS Code API bridge（未启动真实 Extension Development Host、未调用真实 CLI）。node .agents/skills/chromium-playwright-smoke/scripts/run_smoke.mjs --scenario .tmp/subtask-bubbles-smoke.json 通过：1 个 .message.user、0 个 .message.system，气泡可见且正文匹配；无 browserErrors、httpErrors 或 requestFailures。截图及 result.json 留在 .tmp/playwright-smoke/subtask-creation-bubbles/，任务专用服务脚本与 scenario 在验证后移除。
- 结构校验：ontology --validate 通过（2 domains、17 concepts、16 relations、77 rules）；git diff --check 通过；限定宿主文件的界面检测器返回 []。
- 功能清单：已同步 .ch/docs/product-specs/FEATURE_INVENTORY.md。
- 相关文档同步：能力规格及 ontology 新增 plugin.rule.subtask_creation_user_bubble；不改变架构边界或运维入口，无需改 ARCHITECTURE.md。一次性修复细节保存在本计划，不写热区记忆或 ROLLING_SUMMARY.md/EVENT_MEMORY.md。

## 任务列表

- [x] 定位子任务创建消息来源。
- [x] 删除重复创建消息并补充回归断言。
- [x] 验证、同步文档并归档计划。

## 决策记录

- 2026-10-29：从写入源消除冗余创建消息，保留现有正常气泡和非创建系统消息；不新增前端内容去重或 CSS 隐藏规则。

## 提交前隔离验证

- 仅暂存本任务的 12 个代码、测试和文档文件；共享文档按差异块隔离，不纳入 ZCode、配置备份或 Webview 测试等其他任务改动。
- 使用 git checkout-index 导出待提交快照，复用已安装依赖后执行 npm run build。构建在未修改的 src/test/webview/clipagescriptruntimecoverage.test.ts 第 2128、2168、2172 行出现 TS1005/TS1128 语法错误。
- 报错测试与 HEAD 内容完全一致；另将 HEAD 独立导出并构建，复现相同三项语法错误，确认为原有基线失败，不在本任务修复。此前构建通过的记录来自包含其他未提交改动的工作区，不等同于本次独立提交的构建通过。
- 基于待提交快照生成的 dist 产物运行上述 7 个测试文件，67 项全部通过；ontology 校验通过，暂存差异通过 git diff --cached --check。

## 当前结论

已从 Loop+ adapter 及宿主 wiring 删除额外的系统提示词写入，从经典 Loop/Graph 删除子会话启动说明写入，并移除不再使用的 Graph 子节点启动文案构建器。正常 user 提示词、父会话派发观测、异常及完成消息保持现有路径。原工作区构建、67 项相关测试、浏览器气泡验证及文档结构校验通过；提交前独立快照的 67 项相关测试与 ontology 校验通过，构建存在已对照 HEAD 确认的基线语法错误。扩展 Webview 错误状态断言另有一项范围外失败，证据见上文。不改写旧会话，因此已有重复历史消息不自动删除。
