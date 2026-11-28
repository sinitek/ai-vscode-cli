# 产研部重启后的组长入口与总监状态

- 日期：2026-11-27
- 类型：bugfix
- 关联计划：无
- 状态：completed
- 负责人：Codex

## 背景

VS Code 在产研部执行中重启后，从会话 Tab 打开已登记组长任务可能报“找不到 Loop 任务”，总监/组长群聊也可能把旧存储中的 `running` 误作当前宿主仍在执行。问题横跨会话恢复、Loop 身份目录、部门来源 Owner 和 Webview 投影；只改错误提示或终止按钮不能修复根因。

## 目标

对已登记部门历史任务提供可验证的只读回退；将持久状态与当前宿主的执行所有权分离；只在证据充分时把失去 Owner 的 `running` 投影成中断，不改写历史记录、不接管、不自动重放。

## 范围

- 组长会话 Tab 与群聊按显式任务 ID 读取可信历史部门源，并校验工作区、根/模块父子关系、唯一身份和物理记录。
- 来源 Owner 存在或身份状态不确定时保持“执行状态待核实”及只读；确认当前来源无 Owner 时，将历史 `running` 只投影为本宿主中断。
- 群聊 transcript 状态以已验证任务快照为准，历史只读不触发修复写盘；页头下方常显历史只读与执行结论。
- 更新状态边界、功能清单、本体来源和回归覆盖；不清理 Owner、持久化改状态或启动 CLI。

## 非目标

- 不改写或迁移 `~/.sinitek_cli` 数据，不清理锁/Owner，不接管其他宿主执行。
- 不自动重启、续跑或终止任何任务；不把 `needs-review` 改成 `stopped`。
- 不修复本任务之外的 Loop/Loop+ 测试失败，不发布、不提交。

## 验收标准

- [x] 已登记组长任务的显式 Tab/群聊入口不因仅存在于受控历史来源而丢失。
- [x] 可信无 Owner 的历史 `running` 不显示为当前宿主运行；Owner 存在/身份不明时不误判中断。
- [x] `needs-review` 等非运行状态按任务快照显示；只读展示不更改任务或 transcript 文件。
- [x] 窄屏和补丁刷新后，组长弹窗仍可见只读边界及执行状态。
- [x] 构建、相关回归、本体校验与隔离 Extension Host 三场景完成；全量测试结论记录并分类。

## 影响面

- 代码：`src/extension.ts`、`src/extensionHost/departmentHistoricalTaskStore.ts`、部门 Tab/群聊投影与 Loop 群聊 Webview。
- 测试：历史来源可信读取、会话投影、状态边界、常驻提示、隔离 Extension Host 检查。
- 文档：部门群聊 UI 合同、`FEATURE_INVENTORY.md`、CLI runtime ontology。

## 风险与缓解

- 风险：多个来源、旧物理记录或保留 Owner 可能造成误认/误接管。
- 缓解：按任务 ID 唯一解析并核对注册来源、无符号链接、来源 marker、身份目录、父子关系和工作区；Owner 存在及任何读取失败都 fail closed 为未核实；历史读取不写盘。
- 风险：旧群聊 Markdown 状态陈旧。
- 缓解：仅在展示时将状态行映射为当前快照标签，保留历史文件字节不变。

## 验证计划

- 最小相关验证：历史来源/Loop 群聊/部门投影单测，`npm run build`。
- 单元自测命令：`npm run test:unit`；若并发运行失败，逐项隔离失败并记录证据。
- 扩展验证：用隔离 HOME、工作区和安装版 Extension Host 检查运行中重启、待复核重启、正常场景；不运行真实 CLI、不触碰用户任务执行。

## 测试与清单同步

- 新增/更新：`src/test/extensionHost/departmentHistoricalTaskStore.test.ts`、`src/test/loop/loopGroupChatPanel.test.ts`、`scripts/verify_department_conversation_host.js`。
- 构建：`npm run build` 通过。
- 定向单测：`node --test` 针对 11 个历史身份/来源、会话、群聊及 Webview 测试文件，183/183 通过。
- Extension Host：历史运行中重启与待复核重启均正常退出；正常状态正常退出；三份报告均无 Webview 错误。运行中/待复核场景历史运行数据哈希不变，组长入口与只读 UI 可见；待复核未被误标中断。
- Ontology：`python3 .agents/skills/ontology/scripts/search_ontology.py --validate` 通过（2 domains、27 concepts、24 relations、211 rules、4 workflows）。
- 全量单测：`npm run test:unit` 以及构建后 `node --test --test-concurrency=1 <全部 dist/test/**/*.test.js>`（串行）结果一致：6292 项中 6253 通过、34 失败、2 cancelled、3 skipped。串行复跑确认不是单纯并发资源超时。隔离 `git archive HEAD` 后选取相同失败文件复测，基线也有 8 个测试文件失败和 2 项取消；基线部门测试加载另有 `LOOP_PLUS_TASK_TYPES` 循环初始化问题，部分 Loop+ 用例相同超时，故基线失败文件与当前失败项目并非逐项同因，不能据此宣称每项都是已证明的历史失败。当前 `promptSessionHealth` 18 项的 `ReferenceError` 经代码核对来自源码提取式测试没有向 VM 注入 `resolveCompletedLoopSubtaskTabBinding`，非历史读取路径。另有一项配置导出断言失败及若干部/Loop+ 模块失败，均不在本次历史来源读取/状态投影范围；不扩展修复它们，也不将全量标记通过。当前 Loop 身份目录和任务存储相关两文件单独运行 67/67 通过。
- 功能清单：已更新重启历史入口、Owner 与状态映射、只读及不自动重放边界。
- 相关文档：已更新 `.ch/docs/design-docs/department-group-chat-ui-contract.md`；Ontology source_refs 已登记历史 reader 与回归测试。

## 任务列表

- [x] 核验 Loop 身份、部门来源 Owner、会话与群聊入口的事实来源
- [x] 实现受控历史只读读取及当前宿主状态投影
- [x] 补充 UI/身份/Extension Host 回归并同步契约、清单和本体
- [x] 完成最终差异核验、全量单测分类与归档

## 决策记录

- 2026-11-27：当前任务记录是持久快照而非活动执行证明。读取失败、Owner 存在或身份不唯一不能推断“已中断”；只有无 Owner 且关系/身份/工作区均核验成功才映射失联运行态。
- 2026-11-27：只读 Webview 投影不重写任务 JSON 或群聊 Markdown，不将 `needs-review` 合并为 `stopped`；展示状态取可信快照而不是历史文本。
- 2026-11-27：核对指定历史记录时，领导记录快照为 `running`、同来源未发现 Owner；根任务为 `needs-review`。该样本只读核验，未暴露 ID、路径或内容到产物。

## 当前结论

历史入口、状态投影、常驻只读提示和文档同步已实现；构建、183 项定向单测、三类隔离宿主场景和 ontology 校验通过。并行及串行全量结果一致（6253/6292 通过，34 失败、2 cancelled、3 skipped）；干净 HEAD 对照确认全量仍有多类范围外失败，但不将全部当前失败归因为相同基线原因，也不宣称全量通过。`git diff --check` 通过。本地运行数据未修改，未发布或提交。
