# 历史提示词全局收藏

- 日期：2026-11-03
- 状态：completed
- 类型：feature
- 负责人：Codex
- owner：Codex
- claimed_at：2026-11-03
- claim_ttl：本次会话
- handoff_to：-

## 关联计划

- 共同背景与依赖（测试证据）：[测试计划删除审计](../../migrations/test-plan-removals/2026-11-11-nov-active.json)（source_old_path：`.ch/docs/exec-plans/completed/2026-11/2026-11-03-global-prompt-history-favorites.md`）。
- 历史文档依赖：原 docs companion `2026-11-03-docs-global-prompt-history-favorites.md` 已退役；仅留历史身份与分工，完整校验记录未恢复。[references 索引](../../../references/index.md)仅作导航。

## 背景与目标

历史提示词及其收藏目前按工作区保存。为每条历史增加“全局”勾选，仅已收藏项可启用；启用后所有项目都能在收藏中查看、搜索和复用。

## 范围与非目标

- 覆盖提示词存储、Host消息路由和Webview控件；独立单测开发的历史职责见[测试计划删除审计](../../migrations/test-plan-removals/2026-11-11-nov-active.json)（`source_old_path`：`.ch/docs/exec-plans/completed/2026-11/2026-11-03-global-prompt-history-favorites.md`），产品/本体文档原由已退役 docs companion 承接（仅历史分工）。
- 不改变历史会话、当前会话提示词弹层、普通历史的项目隔离、保留期和数量上限。
- 不新增跨设备同步、配置项、语言包或依赖。

## 验收标准

- 未收藏项显示禁用的“全局”复选框，并提示先收藏；已收藏项可勾选和取消。
- 全局收藏持久化到独立共享文件，不污染其它工作区普通历史；各项目的“仅收藏”可见并可复用。
- 相同正文的项目项与全局项合并显示，复用保留全局与收藏状态。
- 取消全局只撤销共享，当前项目仍保留收藏；取消收藏同时撤销全局。
- 多个已打开项目重新打开历史弹窗时读取最新共享状态，旧面板不会在普通写入时复活已撤销共享。
- 旧数据兼容，清空与自动裁剪保留全局收藏。
- 相关单测、构建、本体校验及 Chromium 页面验证通过。

## 影响面

- `src/promptHistoryStore.ts`、`src/extensionHost/modelSettings.ts`、消息协议与会话消息处理器。
- `src/webview/viewContentScript/historyPanels.ts`、历史弹窗事件、现有主题样式与中文文案。
- session/webview回归开发的历史职责见[测试计划删除审计](../../migrations/test-plan-removals/2026-11-11-nov-active.json)（`source_old_path`：`.ch/docs/exec-plans/completed/2026-11/2026-11-03-global-prompt-history-favorites.md`）；原 docs companion（已退役）曾承担产品规格和本体事实维护。

## 风险与缓解

- 全局库采用独立文件，每次修改读取最新状态；普通历史写入只写项目数据，避免旧缓存覆盖共享数据。
- 全局项与本地项按完整修剪后正文合并；保留本地副本以免撤销共享时丢失项目收藏。
- 复选框采用原生控件和既有主题语义，覆盖禁用、键盘操作与窄面板布局。
- 回滚代码后全局文件可保留，现有工作区文件和原有收藏字段继续兼容。

## 验证计划

- 构建：`npm run build`。
- 测试开发/历史结果及失败分类见 [测试计划删除审计](../../migrations/test-plan-removals/2026-11-11-nov-active.json)（source_old_path：`.ch/docs/exec-plans/completed/2026-11/2026-11-03-global-prompt-history-favorites.md`）。
- 浏览器：使用现有 Chromium Playwright 方案验证禁用/启用、收藏过滤、复用与布局。
- 文档：`python3 .agents/skills/ontology/scripts/search_ontology.py --validate`，必要的文档结构检查。

## 测试与清单同步

- 测试开发/历史结果及失败分类见 [测试计划删除审计](../../migrations/test-plan-removals/2026-11-11-nov-active.json)（source_old_path：`.ch/docs/exec-plans/completed/2026-11/2026-11-03-global-prompt-history-favorites.md`）。
- 原 docs companion `2026-11-03-docs-global-prompt-history-favorites.md` 已退役；仅留历史身份与分工，完整校验记录未恢复。原文曾以该页为文档交付证据入口；此处无法复核其完整记录。[references 索引](../../../references/index.md)仅作导航。
- 记忆：稳定语义写入产品规格/本体；无须自动追加热区记忆。

## 任务列表

Tasklist:
- [completed] 梳理历史记录与收藏数据流
- [completed] 实现全局提示词的保存和展示
- [completed] 验证全局收藏功能；测试开发与文档编辑分别见关联计划

## 决策记录

- 2026-11-03：全局收藏单独保存，普通历史仍按项目隔离；全局切换只面向收藏项。保留项目副本，撤销共享不删除原有项目收藏。
- 2026-11-03：当前工作树初始干净，改动直接落在用户工作区；不创建未经请求的新分支。

## 当前结论

已完成实现、产品/本体文档同步、最终构建和 237 项相关单测。使用真实生成 Webview HTML、真实提示词存储函数和隔离临时数据，通过 Chromium smoke runner 的 1100×900、390×844 场景及双项目 8 项交互检查；控制台、页面和网络错误均为零。窄面板操作区自然换行，已查看桌面与窄面板截图。设计检测器输出空结果。未启动真实 VS Code Extension Development Host；浏览器消息桥使用合成夹具，不触碰用户历史文件。验证证据保留在 ignored 的 `.tmp/global-prompt-history-unit-final.log`、`.tmp/global-prompt-history-build.log` 和 `.tmp/global-prompt-history-smoke/`；场景和临时验证脚本收尾时删除。未修改并行任务的 Codex Runner、其测试与架构变更。稳定行为已进入产品规格与本体，无额外需要提升的事件或风险，不追加记忆热区。
