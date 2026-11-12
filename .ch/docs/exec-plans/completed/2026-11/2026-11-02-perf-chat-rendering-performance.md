# 多标签聊天无损渲染优化

- 日期：2026-11-02
- 状态：completed
- 类型：perf
- 负责人：Codex

## 关联计划

- 本计划记录不改变展示行为的渲染优化；新增运行时回归及 VM 夹具由 [测试计划删除审计](../../migrations/test-plan-removals/2026-11-11-nov-active.json) 记录。测试是本优化的独立交付，不是单纯执行既有测试（source_old_path：`.ch/docs/exec-plans/completed/2026-11/2026-11-02-chat-rendering-performance.md`）。
- `ARCHITECTURE.md` 中缓存失效边界与实现踩坑的独立文档交付见 [`2026-11-02-docs-chat-rendering-cache-guidance.md`](2026-11-02-docs-chat-rendering-cache-guidance.md)。

## 背景与目标

用户反馈多开对话 Tab 后卡顿，要求优化性能但不得减少气泡或改变现有体验。当前流式路径已有后台 Tab 隔离、动画帧更新和 Markdown 延迟；消息追加及工具更新仍可能清空消息容器并重建全部 DOM，查找流式目标节点还会遍历整棵消息树。

## 范围

- 活跃消息节点建立索引，随完整重绘、Tab 切换和消息移除失效。
- 实时消息刷新复用内容与展示上下文未变的节点，只协调变化节点及指令组。
- 通过单测和真实 Chromium 对比验证消息内容、节点数量、分组、思考、滚动及标签隔离。

## 非目标

- 不减少、截断、隐藏、分页或虚拟化气泡；不改变已有折叠默认值、筛选与 Markdown 效果。
- 不限制或删除历史、回放记录，不修改导出协议与 CLI 执行。
- 不新增依赖、框架、配置或平台专用路径；不创建分支或改动其他任务的工作区修改。

## 验收标准

- [x] 相同事件序列下消息内容、顺序、数量、指令分组和最终答复与基线一致。
- [x] 追加消息及更新工具记录不重新创建无关历史气泡；流式目标通过索引定位。
- [x] 思考展开、分组展开、滚动位置、文本选择及历史回放保持可用。
- [x] 显示上下文改变、消息删除、过滤和切换 Tab 不复用过期节点。
- [x] 构建、相关单测和 Chromium 场景通过；记录前后对比与未覆盖风险。

## 影响面与风险

- 代码：`src/webview/viewContentScript/messageRendering.ts`、`traceRendering.ts`，及相应 Webview 测试。
- 独立ARCHITECTURE架构说明由关联 `docs` 计划维护；回归用例/VM夹具开发的历史职责见[测试计划删除审计](../../migrations/test-plan-removals/2026-11-11-nov-active.json)（`source_old_path`：`.ch/docs/exec-plans/completed/2026-11/2026-11-02-chat-rendering-performance.md`）。
- 风险：缓存遗漏展示依赖、重排影响焦点或分组、过期节点与 ResizeObserver 引用残留。
- 缓解：完整重绘保留原有路径；增量复用显式校验原文、元信息及 CLI/索引/流式/相邻工具展示上下文；清理不再可见的缓存和观察器。
- 回滚：仅撤销本计划渲染实现；关联测试和架构文档需按各自计划协调，不动其它任务既有修改。

## 验证计划

- 构建：`npm run build`。
- 最小单测：`node --test dist/test/webview/clipagescriptruntimecoverage.test.js`，随后扩大至 Webview 相关单测。
- 浏览器：使用仓库生成的真实 Webview HTML、现有 Playwright/Chromium，覆盖长历史增量、分组变化、思考滚动、Tab 切换、回放及窄屏。
- 性能：固定合成数据比较基线与优化版的消息 DOM 创建数、Markdown 调用数和刷新耗时；不得把合成基准当作用户机器实测结论。

## 历史验证与关联交付

- 新增回归及 VM 夹具是独立测试开发，范围、验收与验证结果的历史记录见[测试计划删除审计](../../migrations/test-plan-removals/2026-11-11-nov-active.json)（`source_old_path`：`.ch/docs/exec-plans/completed/2026-11/2026-11-02-chat-rendering-performance.md`）。
- 单元自测历史结果：基线构建和 141 条运行时测试通过；新增回归后的 146 条运行时测试通过；页面分组 389 条通过；扩大 Webview 与 Tab 分页范围后 352 条通过，详见[测试计划删除审计](../../migrations/test-plan-removals/2026-11-11-nov-active.json)（`source_old_path`：`.ch/docs/exec-plans/completed/2026-11/2026-11-02-chat-rendering-performance.md`）。
- 失败处理历史证据：首轮 6 条流式结束断言属于实现缺陷，原因是同步动画帧可能先于定时器标记，已显式记录实际纯文本状态并通过原有结束/出错/停止回归。扩大范围的 2 条 Loop+ 失败属于夹具依赖缺失，已补齐新缓存变量及函数，不降低断言。浏览器首次选择文本失败属于夹具选择器错误，已改为实际气泡节点；测试开发计划保留了完整上下文。
- 功能清单：无需新增条目；全部气泡、折叠规则、筛选、消息协议、回放与导出内容保持不变，仅优化内部节点更新，避免混入其他任务正在修改的功能清单。
- 文档交付：`ARCHITECTURE.md` 记录增量渲染与缓存失效边界，以及实际纯文本状态不能等同于定时器状态的踩坑；独立文档范围见关联 docs 计划。
- Ontology：已核对消息分组、思考气泡及任务操作入口规则；没有改变业务概念、生命周期或输入输出协议，无需变更本体。

## 任务列表

- [completed] 确认渲染边界与回归入口
- [completed] 实现不改变展示的性能优化
- [completed] 交付不改变行为的渲染优化
- [completed] 保持已记录的性能与视觉边界

## 决策记录

- 2026-11-02：不采用虚拟列表、缓存截断或减少气泡方案；优先在现有展示语义内复用节点。现有工作区包含其他任务未提交文档修改，保持原位增量修改，不创建分支。
- 2026-11-02：显式完整重绘继续重建节点，增量入口仅用于实时追加、合并、工具更新及流式收口；缓存不替代消息数据，不跨 Tab 保留 DOM。指令组无变化时不重写摘要，保护焦点、选区和已有 JSON 树状态。

## Chromium 验证结果

命令：`node .tmp/chat-rendering-performance/browser-smoke.cjs`。使用本机已有 Playwright / Chromium、真实 Webview HTML 和 Marked / JSONFormatter 资源，桥接层仅注入明确标记的合成数据，不读取用户真实会话或执行真实 CLI。

每组先装载完整历史，再同步追加 10 条不合并的工具指令，重复 3 次，记录同步刷新耗时中位数。前后消息正文逐条一致，最终气泡与原始状态数组数量一致，指令分组数量一致。

| 历史消息数 | 版本 | 耗时中位数 | 显式 createElement 调用 | Markdown 调用 | 最终气泡数 |
| --- | --- | --- | --- | --- | --- |
| 100 | 基线 | 40.1 ms | 2646 | 500 | 110 |
| 100 | 优化 | 4.0 ms | 24 | 0 | 110 |
| 600 | 基线 | 204.0 ms | 15146 | 3000 | 610 |
| 600 | 优化 | 12.4 ms | 24 | 0 | 610 |

这里的 createElement 仅统计 JavaScript 显式调用，不包含 innerHTML 内部创建的节点；Markdown 为本轮追加过程的调用数，新增工具记录无需 Markdown。该基准说明减少重复工作，不代表用户机器、真实 CLI 并发或端到端延迟承诺。

- 420 / 1280 像素宽度的真实浏览器交互通过，已查看两种截图，未改变项目样式。
- 原历史节点、展开的思考气泡和指令组保持同一 DOM；滚动位置、选中文字、未发送输入、JSON 树展开状态均保留。
- 搜索结果在追加前后保持，流式结束后为完整 Markdown 而非纯文本。
- 10 个合成 Tab 每个收到 100 条回放，导出载荷均完整保留 100 条；后台回放不重建前台消息，切换同 ID 消息的 Tab 后不复用过期节点。
- 两个结构化 smoke 场景均为 passed，浏览器错误、HTTP 错误和失败请求均为空。
- 本地证据：`.tmp/chat-rendering-performance/result.json`、`smoke-420/result.json`、`smoke-1280/result.json`，截图为对应目录的 `success.png`。
- 界面机械检查：本机 Impeccable 的 `scripts/detect.mjs --json src/webview/viewContentScript/messageRendering.ts src/webview/viewContentScript/traceRendering.ts` 返回空问题列表。
- 本体校验：`python3 .agents/skills/ontology/scripts/search_ontology.py --validate` 通过。
- 尚未覆盖：真实 VS Code Extension Development Host 中的多 CLI 同时执行及长时堆内存变化；本次不改变回放容量或持久化，因此未宣称修复 CLI 进程竞争或无限回放的内存增长。
- 记忆收口：不写入热区或 EVENT_MEMORY；实现边界与可复用踩坑已进入架构事实源，验证过程保留在本执行计划。

## 当前结论

不改变行为的渲染优化已交付，历史测试证据见[测试计划删除审计](../../migrations/test-plan-removals/2026-11-11-nov-active.json)（`source_old_path`：`.ch/docs/exec-plans/completed/2026-11/2026-11-02-chat-rendering-performance.md`）；历史构建、Chromium 与本体结果按各自范围分别记录在本计划及关联 docs 计划。本计划只记录优化交付及真实边界；全部气泡、消息内容、回放和既有操作语义保留，真实多 CLI 长时资源竞争仍为未覆盖事项。
