# 统一 Loop 完成字段转换

- 日期：2026-11-22
- 类型：refactor
- 关联计划：无
- 状态：completed
- 负责人：Codex（Loop+ 第 3 轮 `loop-completion-fields`）

## 背景与目标

模型决定与任务历史分别实现轮次估计、轮次摘要和验收条目转换。将共同转换放到纯模块，由解析和读盘入口各自应用原有缺省值。

## 范围与非目标

- 实现涉及 `src/loopCompletionFields.ts`、`src/extensionHost/promptRunRuntime.ts` 和 `src/loopTaskStore.ts`，并更新两个入口的定向测试。
- 保留经典 Loop 完成门槛、Loop+ 协议校验、旧 `maxRounds`、宿主方法签名、类型导入路径和磁盘字段。

## 验收标准

- [x] 模型入口省略缺失或非数组的轮次摘要，保留空数组。读盘统一将缺失或非数组归为 `[]`。
- [x] 两入口共享合法条目转换，保留名称兜底、严格 `true`、原样 `detail` 和轮次估计的取整及 0–100 限制。
- [x] 在 `534095ff` 加本项改动的独立副本通过构建和三个指定测试文件。

## 影响面与风险

- 模型决定和旧记录对非法、缺失值的输出形状容易在合并时混淆。用同类输入分入口断言，并复用已有经典 Loop 门槛、旧 `maxRounds` 和 Loop+ 回归测试。
- 回退可在本项范围内恢复两入口的原有转换及测试。

## 验证计划

- 用 `git archive 534095ff` 构建独立源码副本，复制本项变更并链接已安装依赖。
- 运行 `npm run build`。
- 运行 `node --test dist/test/extensionHost/loopMainDecisionParsing.test.js dist/test/loop/loopTaskStoreCoreCoverage.test.js dist/test/loop/loopTaskStore.test.js`。

## 测试与清单同步

- 两个入口补充有效、缺失、非数组、空数组、混合非法条目和边界轮次覆盖。
- `npm run build` 退出 0。指定的三个测试文件合计 74 项通过，失败、取消、跳过和 TODO 均为 0。
- 公共行为、产品能力和业务语义保持原约定，功能清单、设计规格与 ontology 无需更新。

## 任务列表

- [x] 核对现有契约并建立执行计划
- [x] 抽取共享转换并补入口测试
- [x] 在独立基线副本验证并记录结果

## 决策记录

- 两入口各自检查轮次摘要是否为数组。纯模块转换摘要数组，宿主仍以 `null` 表示字段缺失或类型无效，读盘入口以 `[]` 表示。
- 完成字段类型通过 `loopTaskStore` 继续导出。轮次估计上限属于独立转换，旧 `maxRounds` 继续走自己的兼容解析。

## 当前结论

本执行项已通过指定的隔离构建及定向测试。覆盖范围为 `534095ff` 加本项改动。并发改动合入后的验证、全仓单测、真实模型和图形宿主运行未覆盖，主任务负责独立验收。
