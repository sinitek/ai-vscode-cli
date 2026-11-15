# Loop+ 中断后显式继续与切模型恢复

- 日期：2026-11-15
- 类型：bugfix
- 关联计划：无
- 状态：completed
- 负责人：Codex

## 背景与目标

用户报告 Loop+ 中断后，群聊继续与切模型无法唤醒，主聊天输入“继续执行”可以恢复。对照三个入口、持久化状态与本机日志，修复恢复门禁差异。

## 范围与非目标

覆盖群聊继续、切模型、Loop+ 显式续跑及必要回归；不修改用户运行记录，不发布扩展，不替换 CLI 或框架。

## 验收标准

- 显式恢复在主模型空闲时可唤醒中断编排，仍保护实际运行的调用与同级子任务。
- 继续与切模型保留任务、模型配置、验收队列及 attempt 的既有语义。
- 回归测试覆盖失败现场对应状态、正常恢复、运行中保护与重复请求。
- 构建和相关测试通过，功能清单、设计及 ontology 按行为变化同步。

## 影响面与风险

- 入口：src/extensionHost/loopGroupChatPanelCoordinator.ts、src/extensionHost/loopPlusOrchestration.ts、src/extension.ts。
- 风险：把等待控制器当作真实执行，或重复启动主模型；以执行所有权、已有串行机制和回归测试约束。
- 回滚：撤销本次代码与文档差异；不迁移持久化结构。

## 验证计划

- 读取本机任务和日志，只记录脱敏结论。
- `npm run build`。
- 使用真实 Loop+ adapter、临时磁盘任务记录和脚本主模型，从面板消息分别验证继续与切模型都实际调用主模型；检查模型路由、活动子任务保护和资源释放。
- 运行 Loop/Loop+ 协调器、模型恢复、运行时集成、崩溃恢复、等待巡检及群聊 Webview 回归。
- 校验 ontology 与相关 Python 单测；检查本次改动文件的空白。

## 任务列表

- [completed] 核对入口与本机记录，定位恢复门禁差异
- [completed] 对齐继续和切模型的主任务唤醒与模型路由
- [completed] 补齐面板状态、协调器和真实 adapter 集成回归
- [completed] 验证构建、相关测试并同步设计、功能清单和 ontology

## 验证结果

- `npm run build`：通过。
- `node --test dist/test/loop/loopGroupChat.test.js dist/test/loop/loopGroupChatCoordinator.test.js dist/test/loop/loopGroupChatPanel.test.js dist/test/extensionHost/loopModelSwitchResume.test.js dist/test/extensionHost/loopPlusOrchestration.test.js dist/test/extensionHost/loopPlusRuntimeIntegration.test.js dist/test/extensionHost/loopCrashRecovery.test.js dist/test/extensionHost/loopWaitWatchdog.test.js`：302 项通过。
- `loopPlusRuntimeIntegration.test.js` 使用真实 adapter 和隔离磁盘任务存储验证群聊继续消息触发第二次主模型调用；另验证切模型在保留活动子任务时启动主模型并使用新路由。
- `python3 .agents/skills/ontology/scripts/search_ontology.py --validate`：通过。
- `python3 -m unittest discover -s .agents/skills/ontology/tests -p 'test_*.py'`：9 项通过。
- 对本次涉及的源码、测试和文档执行 `node scripts/check_trailing_whitespace.js <files>` 与 `git diff --check`：通过。
- 未运行真实 VS Code Extension Development Host 或真实模型验证；回归验证覆盖了面板消息协调器、adapter、host、脚本模型执行回调和临时磁盘存储。构建产物需加载后才能在已安装扩展中手工验收。

提交前复核：将暂存区导出到隔离临时目录，排除其它会话的停止/标签延迟修改后，`npm run build` 通过；上述 8 个定向测试文件共 301 项通过（不包含另一任务新增的停止顺序测试）；Ontology 校验通过。

## 当前结论

2026-11-15 复查补齐了控制器仍在但主模型空闲的场景。群聊继续将文本与对话输入一样排入 `userMessageQueue`，并在调度前同步运行时提示；按钮依据主模型实际忙闲展示。切模型先持久化路由，再通过真实可恢复子任务或主任务继续路径唤醒执行。集成测试确认两种入口都启动了真实 adapter 的主模型调用，切模型使用新模型且没有停止活动子任务；经典 Loop、完成/失败上限、无效快照和实际主模型忙状态均由定向回归覆盖。
