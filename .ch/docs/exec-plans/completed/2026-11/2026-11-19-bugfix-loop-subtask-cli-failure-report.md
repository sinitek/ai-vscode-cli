# Loop / Loop+ 子任务 CLI 失败上报

- 日期：2026-11-19
- 类型：bugfix
- 状态：completed
- 负责人：Codex
- 关联计划：无；不改动工作区已有的部门 Codex 回调修复。

## 背景与范围

子任务 CLI 调用失败时，经典 Loop 可能只保存状态或最后一条助手回复；Loop+ 抛错路径能提供消息，但仅返回 `error` 的路径会用助手正文代替诊断。主任务暂停或返回 `blocked` 时可能遗漏真实故障。

## 验收与验证

- 以当前子任务调用的终态和错误为准，将脱敏、有长度上限的诊断写入汇报与阻塞证据；没有诊断时明确未知，不从模型正文推断。
- Loop+ 保留现有验收、恢复和派发门禁；修复成功、关闭、停止及被替代的失败不作为新的阻塞原因。经典 Loop 保持现有重试与显式续跑行为。
- 构建、运行最小相关回归及更广的 Loop 测试，校验本体和工作区差异。不重放用户任务、不请求真实模型。

## 实现与验证结果

- 交互、单次和并行调用在失败终态写入诊断；经典 Loop 保留最终重试错误，Loop+ 将同一 attempt 的诊断交给现有验收队列。已验收的失败在后续阻塞复核仍可作为证据，已替代或取消的结果不再充当当前故障。同步功能清单、调度与恢复说明、避坑手册和本体。
- `node --test --test-name-pattern='最后一次 CLI 错误|passes a returned CLI failure|does not reuse a CLI failure' dist/test/extensionHost/{loopWaitWatchdog,loopPlusRuntimeIntegration}.test.js`：三条回归通过。最初经典 Loop 夹具缺少重试文案接口，补齐夹具后通过；初次构建的宿主端口类型接线错误已修正。
- `python3 verify_mac.py`：构建成功，78 个测试文件共 1465 项通过、无跳过；3 轮 Codex pool 和 1 轮公共 runner 隔离交接均通过并清理资源。使用本机 Codex CLI 和临时 HOME、本机模拟模型，不代表已安装插件、其它平台或真实模型已验证。
- 扩展回归先前运行 `node --test dist/test/extensionHost/{loopPlus*,loopWaitWatchdog,loopMainDecisionParsing,subtaskCliExecution,prompt*,extensionHostExtractionContracts,departmentruntime*,departmentproduction*,departmenttree*}.test.js dist/test/loop/*.test.js dist/test/runtime/departmentcodexbootstrap.test.js`：1579 通过、1 失败。失败为部门清理场景 `closure-persistence`，在隔离的未修改 `29ed50c6` 基线用相同用例复现，未改清理逻辑。
- 本体校验、9 项本体测试与 `git diff --check` 通过；未重放或修改历史用户任务。
