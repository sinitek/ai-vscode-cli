# 统一 DSH、Kimi Code 与 ZCode 的 Runner 元数据

- 日期：2026-11-22
- 类型：refactor
- 状态：completed
- 负责人：Loop+ 第 4 轮 Runner 元数据执行尝试
- 关联计划：`.ch/docs/exec-plans/completed/2026-11/2026-11-22-refactor-dsh-kimi-acp-decoding.md`、`.ch/docs/exec-plans/completed/2026-11/2026-11-22-refactor-loop-completion-fields.md`，仅共享本轮合并验证，无实现依赖。

## 背景与目标

三种 Runner 策略重复实现会话选项准备、新登记与原地更新。抽取本地元数据函数，保留每个 CLI 的运行时行为。

## 范围与非目标

- 修改 `src/interactive/runnerLifecycleStrategies.ts` 和对应策略单测。
- 不调整 Manager 的指纹检查、CLI 构造和取消、ZCode 异步释放、ACP 解码或 Loop 字段契约。

## 验收标准

- [x] 保留会话 ID 裁切和各 CLI 的空 ID 消息、reason，以及各阶段独立参数快照。
- [x] 保留新登记默认值、原地更新中的缺省与显式空值、各 CLI 的复用条件与构造参数。
- [x] 在包含 ACP、Loop 与 Runner 三处重构的独立源码副本完成构建及策略、Manager、ZCode 释放测试。

## 影响面与风险

- 元数据登记只处理共同字段；构造、复用身份判断、取消和释放保留在原入口。行为不变，功能清单、架构、Ontology 和热区记忆无需同步。
- 新登记的缺省值不能用于原地更新；为原地更新保留单独入口，并检查缺省、空字符串、空参数、`null` 和空环境对象。以定向测试防回归；若需回退，仅撤回本项两份源码及测试改动。

## 验证计划

- 以项目基线和三项当前源文件构建独立副本，链接已安装依赖，运行 `npm run build`。
- 执行 `node --test dist/test/interactive/runnerLifecycleStrategies.test.js dist/test/interactive/manager.test.js dist/test/interactive/managedZcodeDisposal.test.js`。
- 对照 ACP 89 项、Loop 74 项的隔离源码证据，不重复执行仍有效的检查。

## 进度与验证记录

- [x] 核对规则、当前实现和独立验证结果。
- [x] 提取局部函数并补充定向测试。
- [x] 完成合并源码构建、定向测试与归档。

### 验证记录

- ACP 先前副本的 5 个源码/测试文件与当前工作区逐文件 `cmp` 相同，其 `npm run build` 和 89 项 ACP/Runner 定向测试结果仍覆盖本轮文件未改的 ACP 路径。Loop 先前副本的 5 个源码/测试文件同样相同，其构建和 74 项 Loop 定向测试结果仍覆盖本轮文件未改的 Loop 路径。本轮单独创建包含上述十个文件及本次两个文件的整合副本并复核全部 12 个覆盖文件一致，避免把先前孤立结果误称为合并态证据。
- 整合副本 `npm run build` 通过。随后执行 `node --test dist/test/interactive/runnerLifecycleStrategies.test.js dist/test/interactive/manager.test.js dist/test/interactive/managedZcodeDisposal.test.js`：47 项通过，0 失败、0 跳过、0 取消。覆盖本次新增策略元数据用例、现有配置指纹/Manager 用例及 ZCode 异步释放屏障。
- 未运行全量测试、真实 CLI、VS Code GUI、浏览器或其他平台检查。构建和测试后只更新本计划并归档、填写外部执行报告；源码和测试未再改变。
- 后续可审查策略 helper 的边界、三 CLI 构造参数契约和空值语义；自动化结果不替代主任务验收。无遗留阻塞。
