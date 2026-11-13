# Loop+ 项目方案记忆与默认方案保护

- 日期：2026-11-02
- 状态：completed
- 类型：feature
- 负责人：Codex

## 关联计划

- 最近方案、默认保护及旧默认无损迁移的测试开发见 [测试计划删除审计](../../migrations/test-plan-removals/2026-11-11-nov-active.json)（source_old_path：`.ch/docs/exec-plans/completed/2026-11/2026-11-02-loop-plus-plan-selection.md`）。
- 原文记录的历史文档分工：FEATURE_INVENTORY、能力规格、Loop+调度设计和ontology历史同步原归 `2026-11-02-docs-loop-plus-plan-selection.md`。 该 companion 已退役；完整写作及校验记录无法由索引复核。[references 索引](../../../references/index.md)仅作导航。

## 背景与目标

Loop+ 已按工作区持久化最近选择，但前端会用已保存的「默认方案」覆盖内置默认选择。此次保留项目最近选择，禁止保存内置默认方案，新建草稿预填「新建方案」，兼容迁移旧默认方案。

## 范围与非目标

- 范围：共享方案规范化、工作区设置和弹窗交互；独立测试开发的历史职责见[测试计划删除审计](../../migrations/test-plan-removals/2026-11-11-nov-active.json)（`source_old_path`：`.ch/docs/exec-plans/completed/2026-11/2026-11-02-loop-plus-plan-selection.md`）；产品/本体文档同步原指向已退役 docs companion（完整记录未恢复）。
- 非目标：不修改任务调度、已有任务快照、CLI 调用或其他未提交改动；不新增依赖或配置项。

## 验收标准

- 弹窗默认使用当前项目最近一次有效选择，包括明确选择内置默认；不同项目互不影响。
- 内置「默认方案」始终可选，不能保存或改名；新建及已保存的自定义方案仍可保存。
- 新建名称预填「新建方案」，草稿未保存时不覆盖项目最近有效选择。
- 旧的已保存「默认方案」自动改名为「新建方案」，保留 ID、检查项、其它文本、时间戳与选中关系；重名时使用数字后缀，禁止覆盖既有方案。
- 无效/已删除选择回退内置默认，现有任务快照不变。

## 影响面与风险

- 代码：`src/loopPlusAcceptancePlan.ts`、`src/workspaceSettingsStore.ts`、`src/webview/`；宿主设置逻辑按需补测。
- 功能清单、能力规格、调度设计和本体规则编辑原由已退役 docs companion 承接（仅历史分工）。
- 风险：重名迁移造成覆盖、默认误保存、项目串选；通过稳定 ID、幂等迁移、前后端双重校验与工作区隔离测试缓解。

## 验证计划

- `npm run build`
- `node --test dist/test/core/loopPlusAcceptancePlan.test.js dist/test/core/workspaceSettingsStore.test.js dist/test/extensionHost/loopPlusAcceptancePlanHost.test.js dist/test/webview/loopPlusAcceptancePlanDialog.test.js`
- 使用 headless Chromium 验证真实弹窗脚本的默认保护、新建命名和最近选择。
- 本体校验与改动范围空白检查。

## 任务列表

Tasklist:
- [completed] 确认方案选择与保存逻辑
- [completed] 实现项目记忆与新建规则
- [completed] 完成方案选择功能；测试开发历史记录见[测试计划删除审计](../../migrations/test-plan-removals/2026-11-11-nov-active.json)（`source_old_path`：`.ch/docs/exec-plans/completed/2026-11/2026-11-02-loop-plus-plan-selection.md`），文档维护原指向已退役 docs companion（完整记录未恢复）。
- [completed] 执行构建与相关验证

## 决策记录

- 2026-11-02：复用现有工作区设置，不另建存储。旧默认方案仅改模板名称，保留稳定 ID，不改任务快照。迁移重名时使用中文括号数字后缀。
- 2026-11-02：迁移在共享模板列表规范化时幂等完成，读入即生效；后续既有工作区设置写入持久化新名称，不增加加载配置时的隐式磁盘写入。

## 测试与清单同步

- 测试开发/历史结果及失败分类见 [测试计划删除审计](../../migrations/test-plan-removals/2026-11-11-nov-active.json)（source_old_path：`.ch/docs/exec-plans/completed/2026-11/2026-11-02-loop-plus-plan-selection.md`）。
- 浏览器验证：通过仓库 Chromium smoke runner 验证编译后完整 Webview（模拟 VS Code 消息桥），旧默认迁移及恢复、选回内置默认后重开、新建预填名称及保存后重开三个场景通过，桌面 1280×900 和窄屏 390×844 均检查控件不重叠；浏览器、网络错误均为空。未启动真实 Extension Development Host。
- 浏览器证据：`.tmp/playwright-smoke/loop-plus-plan-selection-migrated/result.json`、`.tmp/playwright-smoke/loop-plus-plan-selection-default/result.json`、`.tmp/playwright-smoke/loop-plus-plan-selection-create/result.json`，各目录保留成功截图。
- 静态验证：`python3 .agents/skills/ontology/scripts/search_ontology.py --validate` 通过；界面机械检测无发现；改动范围 `node scripts/check_trailing_whitespace.js ...` 和 `git diff --check` 通过。
- 原 docs companion `2026-11-02-docs-loop-plus-plan-selection.md` 已退役；仅留历史身份与分工，完整校验记录未恢复。原文曾以该页为文档交付证据入口；此处无法复核其完整记录。[references 索引](../../../references/index.md)仅作导航。
- 测试开发/历史结果及失败分类见 [测试计划删除审计](../../migrations/test-plan-removals/2026-11-11-nov-active.json)（source_old_path：`.ch/docs/exec-plans/completed/2026-11/2026-11-02-loop-plus-plan-selection.md`）。

## 当前结论

实现、回归测试、浏览器交互和文档/本体同步均完成。最近选择按现有工作区键隔离，默认保存由界面及宿主双重拒绝，旧默认方案无损且幂等迁移。任务已归档，无未决实现事项。
