# Loop 独立切模型入口

- 日期：2026-11-11
- 类型：feature
- 状态：completed
- 负责人：Codex
- 历史回归验证摘要见[删除审计](../../migrations/test-plan-removals/2026-11-11-nov-active.json)（entries[80]：removed_path=.ch/docs/exec-plans/completed/2026-11/2026-11-11-test-loop-model-switch.md；reference_path=.ch/docs/exec-plans/completed/2026-11/2026-11-11-feature-loop-model-switch.md；source_old_path=null）。该记录无迁移原来源标识，审计摘要不是存活test计划或完整运行日志。

## 目标与范围

移除 Loop/Loop+ 继续弹窗的原/新模型选择，群聊按钮栏增加“切模型”。模型选项复用角色所在 CLI 当前配置的已有下拉数据；Loop+ 全栈显示主/全栈，分离模式显示主/后端/前端。提交只修改模型，不更换 CLI、模式或思考力度；当前调用不打断，下次调用读取新模型，已暂停的主子执行自动继续。

## 非目标

不发布扩展、不更换技术栈、不修改全局模型偏好，不处理工作区既有的无关文档迁移。

## 验收标准

- 继续弹窗只收集继续说明，不再提供模型来源选择。
- 切模型表单支持运行中和暂停态，按当前配置校验选项，错误不写入。
- 新模型持久化到任务路由，正在执行的调用保持原样，后续主子调用使用新模型。
- 非运行中的未完成任务与中断子任务继续执行，不重复启动运行中的调用。

## 风险与缓解

运行时缓存可能覆盖持久化路由：在每次调用边界读取最新路由；Loop+ 中断子任务复用原 attempt 和会话，避免额外完成事件。已有工作区包含文档改动，仅追加本任务相关段落。

## 文档同步

已同步功能清单、能力规格、运行时设计文档与 ontology。无需新增热区记忆或事件记忆，事实留在规格与计划。

## 最终验收

- `npm run build` 通过；相关 Node 单测 349/349 通过。
- Chromium 桌面和 390×820 窄屏交互通过：刷新保留选择与焦点、取消不写入、提交保存三个模型并仅续跑一次、Escape 恢复焦点；无浏览器或网络错误。结果与截图保存在 `.tmp/playwright-smoke/loop-model-switch/`。
- 全量 `TMPDIR=/tmp node scripts/run_unit_tests.js` 共 3796 项：3787 通过、6 失败、3 跳过。6 项均在 HEAD 基线复现，分类为 4 项 Loop+ 面板过期断言和 2 项 Webview VM harness 未注入 `retainChatBubbleEntries`；未修改无关失败。
- Ontology 校验仍因既有文档迁移缺失引用失败：本次更新后 13 项，HEAD 基线 19 项；本次规则及 `source_refs` 已核对有效。相关 ontology 测试 8/9 通过，剩余失败属于同一既有引用问题。
- `git diff --check` 通过。已知基线失败和 ontology 引用问题均已记录，不阻塞本功能验收。

## 归档结论

功能验收完成，未决项仅为上述既有基线问题；计划已归档至 `.ch/docs/exec-plans/completed/2026-11/2026-11-11-feature-loop-model-switch.md`。
