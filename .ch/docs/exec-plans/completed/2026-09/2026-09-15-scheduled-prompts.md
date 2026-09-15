# AI 对话定时任务

- 日期：2026-09-15
- 状态：completed
- 负责人：Codex
- owner：Codex
- claimed_at：2026-09-15
- claim_ttl：本次会话

## 背景

用户需要在 AI 对话面板中设置执行时间和提示词，到时自动调用当前对话执行链，并支持附件。入口位于发送按钮左侧，默认执行时间为第二天 00:00。

## 目标

新增可持久化的一次性定时任务，提供创建、查看、删除和保存管理能力；扩展重启后仍能恢复未执行任务，并在到点后复用现有 `sendPrompt` 流程执行。

## 范围

- Webview 发送区定时入口、表单弹窗和任务管理弹窗。
- 定时任务 JSON 存储、附件持久化、启动恢复和到点调度。
- 与现有 CLI、模型、交互模式、上下文选项及对话 Tab 的衔接。
- 中英文 i18n、功能清单和单元测试。

## 非目标

- 不新增重复执行/cron 表达式。
- 不改变现有立即发送、队列、Loop 或 Graph 语义。
- 不改变现有临时附件清理策略。

## 验收标准

- [x] 发送按钮左侧显示土黄色定时按钮，带可辨识的 SVG 时钟图标。
- [x] 点击后可设置时间、提示词、CLI/模式并添加附件；默认时间是下一天 00:00。
- [x] 添加后任务持久化，管理弹窗可查看和删除；添加成功后弹窗保持打开，使用右上角关闭。
- [x] 到点后任务自动执行，附件可被 CLI 读取；任务状态记录完成或失败。
- [x] 扩展重启后未到点任务继续调度，运行中任务恢复为待执行，终态历史按保留策略清理。
- [x] `npm run build` 与相关单元测试通过。

## 影响面

- 代码目录：`src/scheduledTaskStore.ts`、`src/extension.ts`、`src/sessionMessageHandlers.ts`、`src/sessionMessageActions.ts`、`src/webview/*`。
- 文档目录：`.ch/docs/product-specs/FEATURE_INVENTORY.md`、`.ch/docs/ontology/domains/cli-plugin-runtime.json`。
- 配置与脚本：新增 `~/.sinitek_cli/scheduled-tasks.json` 及 `scheduled-attachments/` 运行时目录。

## 风险与缓解

- 风险：扩展重启时错过时间导致任务永不执行。缓解：启动时扫描任务并立即执行已到期任务。
- 风险：附件被临时文件清理删除。缓解：定时任务附件使用独立目录，任务完成/删除时清理。
- 风险：保存的 Tab 已关闭。缓解：执行时使用保存 Tab，缺失则创建同 CLI 的新 Tab。
- 风险：定时任务与当前运行冲突。缓解：沿用现有 `runPrompt` 对目标 Tab 的停止/切换语义，并在任务状态中记录执行失败。

## 验证计划

- 最小相关验证：定时任务存储规范化、默认时间计算、调度器到期/删除/失败路径单测。
- 单元自测命令：`npm run build`；`node --test dist/test/scheduledTaskStore.test.js`。
- 扩展验证：`npm run test:unit`；运行 Impeccable detector 检查变更 Webview 文件。

## 测试与清单同步

- 单元测试新增/更新：`src/test/scheduledTaskStore.test.ts`。
- 单元自测结果：`npm run build` 通过；`node --test dist/test/scheduledTaskStore.test.js` 9/9 通过；`node --test dist/test/webview/cliPageStaticRenderCoverage.test.js` 7/7 通过；Impeccable detector 未报告问题；`git diff --check` 通过。
- 失败处理记录：`clipagescriptruntimecoverage.test.js` 20 个场景中 19 个通过，失败场景为既有任务列表解析断言（`shouldHideParsedTaskListMessage` 对 `Tasklist update` 的旧预期），与本次定时任务交互改动无关，未修改既有解析契约。
- 功能清单：已新增“AI 对话 / 定时任务”能力条目。
- 相关文档同步：已更新 CLI 插件运行时 ontology；定时任务使用独立 JSON 和附件目录，不新增数据库 SQL。

## 任务列表

- [x] 梳理并确定现有发送、附件、状态和生命周期契约
- [x] 实现定时任务存储、附件目录和到点调度
- [x] 接入 PanelMessage、执行链和启动/重启恢复
- [x] 实现定时入口、表单和管理弹窗及 i18n
- [x] 补测试、功能清单和 ontology，并完成构建验证

## 决策记录

- 2026-09-15：定时任务采用一次性执行；任务与附件使用独立持久化文件和目录；执行复用现有 `sendPrompt` 处理路径。
- 2026-09-15：管理弹窗的提交按钮改为“添加”，成功后保留弹窗并清空表单，右上角关闭按钮作为唯一关闭入口。
- 2026-09-15：终态任务保留优先读取全局历史保留回调，未提供回调时回退 30 天。

## 当前结论

定时任务已交付：入口、添加弹窗、管理列表、附件持久化、工作区隔离、重启恢复、到点执行、失败记录和国际化均已接入；构建与定时任务/静态页面测试通过，计划可归档。
