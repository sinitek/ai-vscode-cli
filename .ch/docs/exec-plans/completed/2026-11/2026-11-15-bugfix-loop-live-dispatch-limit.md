# Loop+ 运行中派发上限刷新

- 日期：2026-11-15
- 类型：bugfix
- 关联计划：无
- 状态：completed
- 负责人：Codex

## 背景与目标

用户反馈配置单次派发上限 10，却未见超过 6 个子任务。当前配置、经典 Loop 提示及解析、Loop+ 新建/显式继续已支持 1–20；遗漏在运行中改配置：协议解析读取当前值，调度容量仍是启动快照。修复自然调度边界上的刷新，使提示、校验和调度一致。

## 范围与非目标

- 范围：Loop+ 主模型请求/决策提交、子任务结束触发的调度、降低容量时保留已有运行并逐步收敛、相关回归与事实来源。
- 非目标：强制模型派满、修改冲突保护、变更 CLI/框架、发布扩展。

## 验收标准

- 配置从 6 改为 10，无需停止或继续，下一次调度可运行 10 个独立任务，提示展示当前容量。
- 从 6 降为 2 不中断已有任务；运行数尚未低于 2 时不回填 pending，快照仍可恢复。
- 显式宿主容量限制、队列/验收状态和写入冲突规则不变。
- 构建及相关单测通过；功能清单、设计和 ontology 与实现一致。

## 影响面与风险

- `src/loopPlusScheduler.ts`、`src/extensionHost/loopPlusOrchestration.ts` 及对应测试。
- 调低上限的展示容量暂时覆盖已有预留；准入必须使用配置值，不能把该展示下限永久当成准入容量。通过下降与恢复测试防回归。
- 配置在自然调度边界生效，不额外打断当前主模型或主动唤醒空闲调度器。

## 验证计划

- 先补运行中 6→10 与 6→2 回归，确认修复前失败。
- `npm run build` 后运行 scheduler、编排、提示、经典 Loop 与配置相关单测。
- ontology 校验和其 Python 单测；`git diff --check`。
- 本次不改变 Webview 布局，不需要浏览器；不依赖真实模型拆分行为，使用实际生产编排/调度器的隔离夹具验证。

## 测试与清单同步

- 单元测试新增/更新：运行中 6→10 决策派发、6→2 保留运行并收敛、finish 提升 pending、显式宿主容量、无效容量拒绝和快照恢复；生产适配器补配置在主模型调用中改变的十任务场景。
- 单元自测结果：`npm run build` 通过；最终 14 文件共 378 项，377 通过，1 条范围外历史静态断言失败，新增回归全部通过。ontology `--validate` 和 9 项 Python 单测通过，`git diff --check` 通过。
- 失败处理记录：修复前两条新增编排回归稳定失败，分别为 `6 !== 10` 和降低后错误回填 `7 !== 6`；修复后通过。扩大验证中的 `loopPlusEntryRouting.test.ts` / `calls Loop+ before classic initialization and the round loop` 单独运行同样失败，断言要求 `handleLoopPlusSubtaskContinuation` 中有字面量 `if (!reported) return;`；其读取的 `src/extension.ts`、`src/extensionHost/loopPlusRuntimeAdapter.ts` 与测试文件均与 HEAD 一致（`git diff --exit-code HEAD -- ...` 通过），分类为范围外历史静态断言过期，不修改无关收口实现。
- 功能清单、设计与 ontology：已同步；同时纠正 capabilities 中经典 Loop 仍写“同一轮最多 6 个”的过期描述。稳定结论已进入设计文档，无需重复写入 memory 热区或增加 runbook；未改变架构和运维方式。

## 任务列表

- [x] 追踪配置与执行链路，定位运行中容量快照遗漏。
- [x] 回归复现并修复运行中刷新及降低容量的准入。
- [x] 验证并同步事实来源，归档计划。

## 当前结论

6 是默认值；当前源码新建/显式继续已支持配置 10，不存在始终固定 6 的派发硬上限。运行中改变配置的容量刷新缺失可稳定复现，已完成。修复前两条新增编排回归失败，修复后全部新增场景及生产适配器十任务场景通过；最终扩大验证 377 通过、1 条历史静态断言失败，构建和 ontology 检查通过。本机只读取了设置中的目标字段及已安装扩展相关代码，确认配置为 10、已安装代码未含运行中刷新；未读取或记录用户会话、未修改用户设置、未安装或发布扩展。


## 最终验证命令与边界

```sh
npm run build
node --test dist/test/loop/loopPlusScheduler.test.js dist/test/extensionHost/loopPlusOrchestration.test.js dist/test/extensionHost/loopPlusPromptBuilders.test.js dist/test/extensionHost/loopPlusDecisionStrategies.test.js dist/test/extensionHost/loopPlusRuntimeIntegration.test.js dist/test/extensionHost/loopPlusRuntimeWiring.test.js dist/test/extensionHost/loopPlusEntryRouting.test.js dist/test/extensionHost/loopMainDecisionParsing.test.js dist/test/extensionHost/loopTaskStateMachine.test.js dist/test/loop/loopPlusDecision.test.js dist/test/loop/loopPlusContracts.test.js dist/test/loop/loopParallel.test.js dist/test/core/toolSettings.test.js dist/test/session/sessionMessageActionsCoreCoverage.test.js
python3 .agents/skills/ontology/scripts/search_ontology.py --validate
python3 -m unittest discover -s .agents/skills/ontology/tests -p 'test_*.py'
git diff --check
```

- 代码定位来自 CodeGraph，具体结论由当前磁盘源码和回归核对；memory recall focus 为 `Loop Loop+ 单次派发上限 max dispatch tasks`，anchor 为空，召回热区为 starter，未作为实现事实依据。
- 生产适配器隔离测试实际执行当前宿主、持久化及调度代码，覆盖启动前设置 10 与主模型执行中从 6 改 10，两者均启动十个独立 attempt；模拟模型响应，不证明真实模型每次都会拆满十个任务。
- 未执行收费真实模型、浏览器、全量单测或 Windows/Linux 本机验证；本次没有前端渲染改动、CLI 参数变化或平台特定逻辑。不依赖用户会话来复现。
- 已安装扩展尚未更新，源码修复需要后续构建打包安装并重载宿主才能作用于该安装；本任务未发布扩展。
