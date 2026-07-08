# 功能总表

这个文件是当前仓库功能清单的**单一事实来源**。

作为 starter，这里默认从空表开始；当首个真实能力进入规划或实现时，再新增条目。

## 更新规则

- 新增能力时新增一行。
- 修改已有能力时更新状态、角色、规格来源、测试状态和备注。
- 下线能力时不要直接删除，改成 `removed` 并保留历史说明。
- 如果一个功能变更无法直接链接到规格，至少要能链接到执行计划或设计文档。
- 不要让 README、聊天记录、任务单、临时表格分别维护不同版本的功能列表。

## 什么时候必须更新

- 新增用户可感知能力、后台能力、运维能力或平台能力。
- 修改已有能力的行为、权限、流程、入口、状态或适用角色。
- 能力进入暂停、废弃、替换、下线状态。
- 需求没有新增页面，但改变了导入导出、通知、审计、报表或批处理能力。

## 状态枚举

- `proposed`：已识别，但尚未进入实施
- `in-progress`：正在建设
- `active`：已经交付且当前生效
- `deprecated`：仍存在，但不建议继续使用
- `removed`：已下线，仅保留历史记录

## 维护边界

- 功能名描述用户或系统能力，不直接使用页面名或接口名。
- 测试状态只回答是否有基础自动化护栏，不替代测试报告。
- 执行计划应说明本次是否需要更新本表；收尾说明应记录实际变更项。

## 当前清单

starter 默认不预置功能项。复制模板后，请从第一个真实能力开始维护下表。

| 业务域 | 功能名称 | 状态 | 主要角色 | 规格来源 | 实现位置 | 测试状态 | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| AI 对话 / 记忆 | Harness 骨架开关与踩坑记录 | active | 终端用户 | `.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md`、`docs/LONG_TERM_MEMORY_DESIGN.md` | 工具设置、prompt 构建、当前工作区 `.ch/.agents` harness scaffold、`AGENTS.md`、`CLAUDE.md`、`.gitignore` 的 `.codegraph/` 忽略项、`ARCHITECTURE.md` AI 初始化任务、`.ch/docs/memory/`、`.ch/docs/runbooks/PITFALLS.md`、CodeGraph 终端初始化 | `npm run build`；`node --test dist/test/toolSettings.test.js dist/test/memoryRuntimeGate.test.js dist/test/longTermMemory.test.js` | 默认关闭；开启时先确认，确认后补齐工作区 harness scaffold、确保 `.codegraph/` 被 git 忽略，并启动 CodeGraph 设置；收尾阶段可二次确认并复用当前 AI 对话以 coding 模式初始化 `ARCHITECTURE.md`；`PITFALLS.md` 记录带根因/规避/验证线索的失败、阻塞、回滚或明确踩坑总结；关闭后只允许查看/导出/删除，不控制 Codex / Claude / Gemini 外部 CLI 自带记忆或历史 |
| AI 对话 / Codex | Codex 官方 multi_agent 开关 | active | 终端用户 | `.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md`、`.ch/docs/references/cli-runtime-reference.md` | 工具设置、Codex app-server 启动参数、Codex thread config、工作区设置 `codexMultiAgentEnabled` | `npm run build`；`node --test dist/test/codexRunnerRuntime.test.js` | 默认关闭；关闭时扩展显式禁用 Codex 官方 `multi_agent` 功能；开启时 Codex 可按自身运行时行为使用内置子智能体能力；该设置只影响 Codex |
| AI 对话 / 上下文 | 执行后自动压缩上下文 | active | 终端用户 | `.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md` | 工具设置、`src/contextCompactionRunner.ts`、`src/extension.ts`、Codex/Claude/Gemini interactive runner | `npm run build`；`node --test dist/test/contextCompactionRunner.test.js` | 默认开启；仅成功结束且执行超过 5 分钟的已有会话触发；自动压缩为静默后台任务，不追加普通任务完成耗时气泡、不覆盖刚完成任务的真实执行时间；手动压缩仍显示压缩运行状态 |
| 配置 / 配置中心 | CLI 配置档案管理与卡片级保存 | active | 终端用户 | `.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md` | 配置中心 webview、`media/config/assets/config-app-ui.js`、`src/config/configService.ts`、`src/webview/configPanel.ts` | `npm run build`；`node --check media/config/assets/config-app-ui.js` | 支持配置档案列表、排序、激活、删除、初始化、备份、导出、Skills 和 MCP 管理；配置编辑区取消顶部统一保存，改为 Claude settings、Gemini settings/.env、Codex config/auth 各卡片右上角独立保存 |
