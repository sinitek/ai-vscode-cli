# 历史提示词每页五十条分页

- 日期：2026-11-02
- 状态：completed
- 类型：feature
- 负责人：Codex

## 关联计划

- 原独立测试计划已按迁移要求删除；五项新增分页行为回归测试的开发及旧实现下失败情况，仅以摘要保留在[测试计划删除审计](../../migrations/test-plan-removals/2026-11-11-nov-active.json)（source_old_path：`.ch/docs/exec-plans/completed/2026-11/2026-11-02-prompt-history-pagination.md`）。该审计仅用于定位历史证据，不承接测试开发职责，也不包含原测试计划正文。
- 功能规格、清单及 ontology 的分页规则更新见 [`2026-11-02-docs-prompt-history-pagination.md`](2026-11-02-docs-prompt-history-pagination.md)；本计划只承接分页功能实现与 UI 验收。

## 背景与目标

历史提示词当前一次渲染全部记录。确认未收藏记录按全局 `historyRetentionDays` 清理，默认 30 天，并额外最多保留 200 条；收藏记录不受保留期和数量上限裁剪。为历史提示词列表增加每页 50 条的底部分页，避免长列表一次渲染。

## 范围与非目标

- 修改历史提示词列表渲染、分页状态、按钮事件及主题样式。
- 搜索和仅收藏过滤先作用于完整列表，再分页；切换过滤条件回到第一页。
- 保留上轮已实现的去重、复用置顶、收藏及持久化逻辑。
- 不修改保留天数、数量上限、历史会话列表或当前会话提示词弹层。
- 沿用现有工作区继续增量修改，不创建分支或工作树，避免遗漏上轮未提交改动。

## 验收标准

- 每页最多显示 50 条，底部显示上一页、下一页、当前页、总页数与过滤后的总条数。
- 首尾页正确禁用按钮，空列表显示既有空态且分页不可操作。
- 搜索和仅收藏过滤可找到其他页记录，条件变化重置到第一页。
- 数据更新或取消收藏导致页数减少时自动回到有效页；普通状态同步不重置当前页。
- 翻页后列表回到顶部，不携带上一页展开状态；窄屏分页无溢出且弹窗高度稳定。

## 影响面与风险

- 实现：`src/webview/viewContentHtml.ts`、`src/webview/viewContentScript/`、`src/webview/viewContentStyles/overlaysModals.ts`。
- 测试：回归开发的历史职责见[测试计划删除审计](../../migrations/test-plan-removals/2026-11-11-nov-active.json)（`source_old_path`：`.ch/docs/exec-plans/completed/2026-11/2026-11-02-prompt-history-pagination.md`）；本计划保留功能验证结果。
- 文档：规格、功能清单和 ontology 的实际编辑由关联 `docs` 计划承接。
- 风险：筛选与分页顺序错误、数据缩减后停留空页、底部控件被长列表挤出；分别以回归用例和桌面/窄屏 Chromium 验证覆盖。

## 验证计划

- `npm run build`
- `node --test dist/test/webview/clipagescriptruntimecoverage.test.js dist/test/webview/cliPageStaticRenderCoverage.test.js dist/test/webview/chatTranscriptSearch.test.js dist/test/session/promptHistoryStore.test.js dist/test/loop/loopPromptQueue.test.js`
- 按 `chromium-playwright-smoke` 运行真实生成页面的翻页、过滤、空态及桌面/窄屏场景。
- ontology 校验、改动范围空白校验及 `git diff --check`。

## 任务列表

- [completed] 核实保留规则、数量上限与现有列表结构
- [completed] 实现分页与边界功能；回归开发的历史记录见[测试计划删除审计](../../migrations/test-plan-removals/2026-11-11-nov-active.json)（`source_old_path`：`.ch/docs/exec-plans/completed/2026-11/2026-11-02-prompt-history-pagination.md`），文档同步见关联 `docs` 计划。
- [completed] 完成页面验证

## 验证记录与当前结论

- 已核对当前代码：保留期由 `src/historyRetention.ts` 动态读取全局设置，默认值及范围来自 `src/toolSettings.ts`；数量上限由 `src/extensionHost/modelSettings.ts` 的 `PROMPT_HISTORY_LIMIT = 200` 提供。
- `npm run build`：通过。新增的 5 项分页行为测试在旧实现下全部失败，属于预期需求缺口；实现后含 1 项静态可访问性测试共 6 项针对性测试全部通过。新增测试回调的 `FakeElement` 类型注解已补齐，最终构建无错误。
- 验证计划中的最小相关 Node 测试扩展加入 `sessionMessageHandlersCoreCoverage` 和 `sessionMessageActions`：237 项全部通过。日志：`/tmp/sinitek-prompt-pagination-related.log`。
- `npm run test:page`：重新构建并运行 384 项页面相关测试，全部通过。日志：`/tmp/sinitek-prompt-pagination-page-tests.log`。
- Chromium 真实页面验证使用 `getWebviewHtml` 生成的完整页面和明确标记的合成历史记录，VS Code 桥以非持久化 mock 提供，不访问用户真实历史。运行命令：先执行 `.tmp/prompt-history-pagination-smoke/generate.cjs` 和 `serve.cjs`，再以 `node .agents/skills/chromium-playwright-smoke/scripts/run_smoke.mjs --scenario <生成的场景文件>` 批量验证。
- 7 个 Chromium 场景全部通过：桌面首页、中间页、尾页、跨页搜索、无匹配空态、390px 收藏尾页、360px 首页；浏览器异常、HTTP 错误和请求失败均为 0。截图和 `result.json` 保留在 `.tmp/prompt-history-pagination-smoke/<场景名>/`，一次性场景 JSON 已清理。
- 1280px、390px、360px 的额外布局测量通过：分页和空态不改变弹窗高度或底部分页位置，列表可独立滚动，翻页回到顶部且无横向溢出。证据：`.tmp/prompt-history-pagination-smoke/layout-metrics.json`。
- 额外布局脚本首次直接启动 Playwright 时缺少该版本默认的 headless shell，属于工具缓存环境问题；按 smoke runner 已有逻辑显式复用缓存 Chromium 1228 后通过，未安装或修改项目依赖。
- Impeccable 对本次 5 个 UI 实现文件的机械检查通过，结果为空数组；ontology 校验、改动范围空白校验和 `git diff --check` 通过。
- 功能规格、功能清单和 ontology 分页规则已同步；架构边界、宿主协议、保留配置与存储格式未变，不需要调整架构文档。
- 未运行全量 `npm run test:unit` 或 Extension Development Host：本次仅调整 Webview 展示，已由页面分组、相关存储/队列/宿主测试与完整生成页面 Chromium 验证覆盖；真实 VS Code 窗口内的最终主题观感可按需人工复核。
- 本任务无额外长期记忆或 runbook 更新需求；稳定业务行为进入产品规格和 ontology，不向 `ROLLING_SUMMARY.md` 自动写入。
