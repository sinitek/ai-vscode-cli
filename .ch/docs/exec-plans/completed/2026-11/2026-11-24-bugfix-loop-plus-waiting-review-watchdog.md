# Loop+ 等待验收的分钟巡检

- 日期：2026-11-24
- 类型：bugfix
- 关联计划：`.ch/docs/exec-plans/active/2026-11-23-bugfix-loop-plus-handoff-and-recovery.md`（同属 Loop+ 交接，不修改其现有工作）
- 状态：completed
- 负责人：Codex

## 背景与目标

符合依赖条件的普通完成回报即时唤醒主任务；若唤醒遗漏，五分钟失联巡检可能因为同级任务仍在执行而跳过。为本宿主空闲的 Loop+ 主任务增加每分钟一次的待验收检查。现场调查还须区分可验收事件被前置最新 attempt 合法阻塞与真实漏唤醒。

## 范围与验收

- 复用扩展宿主时钟和正常验收入口，即使还有其它子任务运行也能补唤醒。
- 不抢占主调用，不重复检查已经确认依赖阻塞且未变化的快照，不绕过暂停、中止或澄清门槛。
- 不改变五分钟失联检查、Codex 主回合意外退出重试、调度依赖或快照格式，不冷启动历史任务，不发布。

## 影响面与验证

- 宿主定时器、Loop+ 编排、定向回归、设计与产品规格、功能清单、排障手册和 Ontology。
- 模拟验收事件提交后唤醒遗漏，使用受控时钟验证 60 秒边界、同级仍运行、单一主调用和依赖阻塞；再运行构建及相关集成测试。
- 风险：重复调度或对暂停任务发起主调用。保留既有运行门槛，复用串行消费者；可单独回滚分钟验收回调，不迁移数据。

## 单元自测与清单同步

- 单元测试新增/更新：`src/test/extensionHost/loopPlusOrchestration.test.ts`、`src/test/extensionHost/loopWaitWatchdog.test.ts`、`src/test/extensionHost/loopPlusEntryRouting.test.ts`。
- 构建：`npm run build -- --outDir .tmp/loop-plus-review-watch.JNHwOt/dist` 通过；输出隔离在 ignored 的 `.tmp/`。
- 定向测试：3 个入口文件与 60 秒 watchdog / 验收场景共 10/10 通过。
- 扩展回归：Loop+ orchestration、runtime integration、acceptance completion gate、handoff contracts、scheduler 与依赖排序共 8 个文件 393/393 通过。
- 文档检查：Ontology `--validate` 与 `git diff --check` 通过。
- 失败处理记录：首次构建发现一处新测试错误回调的 TypeScript 参数类型不兼容，修正回调后重建和上述测试均通过。
- 功能清单：已同步 `.ch/docs/product-specs/FEATURE_INVENTORY.md`；补充 `.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md`、设计说明、排障手册与 Ontology。
- 未覆盖：未重载扩展宿主或用新代码操作仍在运行的现场任务；真实任务后续行为须在正常扩展宿主重载后观察。

## 当前进展

- 已确认分钟时钟可复用，原失联检查和验收唤醒应分开。
- 已实现独立的每分钟验收巡检；通过 scheduler 快照与 seq 识别未变化的依赖等待，复用原串行入口，不改 scheduler 持久格式。
- 现场复核发现某待验收子任务依赖的前置最新 attempt 仍在执行，因此其验收被 scheduler 按 `execution_pending` 暂缓，而非丢失唤醒；此前置 attempt 完成后，主任务再次启动并处理该验收，随后正常建立新的修复 attempt。检查期间没有修改任务存储或打断运行中的子任务。
- 构建通过；定向测试 10/10、相关扩展回归 393/393、Ontology 校验与 `git diff --check` 通过。
- 未对仍运行中的现场任务执行人工唤醒或重载扩展。分钟兜底源码需在扩展宿主加载新版本后生效；工作区源码变化不会自动替换现存运行时。

## 当前结论

实现及本地验证完成。真实现场案例解释为最新前置 attempt 尚未完成时后继验收被合法延迟；本次改动同时为未来的可验收漏唤醒提供每分钟宿主兜底，不绕过前置依赖。
