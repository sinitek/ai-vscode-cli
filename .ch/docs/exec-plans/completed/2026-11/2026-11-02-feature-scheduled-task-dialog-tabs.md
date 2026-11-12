# 定时任务弹窗页签拆分

- 日期：2026-11-02
- 状态：completed
- 类型：feature
- 负责人：Codex

## 关联计划

- 五条新增页签行为回归和既有断言基线核验见 [测试计划删除审计](../../migrations/test-plan-removals/2026-11-11-nov-active.json)（source_old_path：`.ch/docs/exec-plans/completed/2026-11/2026-11-02-scheduled-task-dialog-tabs.md`）。
- FEATURE_INVENTORY 界面组织说明更新见 [`2026-11-02-docs-scheduled-task-dialog-tabs.md`](2026-11-02-docs-scheduled-task-dialog-tabs.md)。

## 背景与目标

定时执行 AI 任务弹窗原先同时展示提交表单和任务列表。按用户要求拆成两个页签：第一个“提交”，第二个“列表”。

## 范围与非目标

- 复用现有页签与主题样式，默认展示提交页签。
- 表单和列表互斥展示；切换页签不重建表单、不清空草稿。
- 保留原有添加、清空表单、查看状态和删除流程，不修改宿主协议、执行模式、存储或调度。
- 保留工作区原有未提交改动。

## 验收标准

- 两个页签顺序和中文名称符合要求，列表不出现在提交面板。
- 点击、方向键、Home/End 切换正确同步显示、ARIA 与焦点。
- 空列表、保存成功、保存失败和重新打开行为正确。
- 构建、相关单测和桌面/窄屏 Chromium 冒烟通过。

## 影响面与风险

- 代码：Webview HTML、中文文案、元素绑定、弹窗事件与样式。
- 独立测试开发的历史职责见[测试计划删除审计](../../migrations/test-plan-removals/2026-11-11-nov-active.json)（`source_old_path`：`.ch/docs/exec-plans/completed/2026-11/2026-11-02-scheduled-task-dialog-tabs.md`）；本计划保留交互及布局验收。功能清单更新见关联 `docs` 计划。本次不改变业务概念、状态机、权限或事实来源，因此无需更新 ontology。
- 风险：隐藏面板可能被 flex 样式覆盖；使用显式 `[hidden]` 样式并用浏览器核对。

## 验证计划

- `npm run build`
- 测试开发/历史结果及失败分类见 [测试计划删除审计](../../migrations/test-plan-removals/2026-11-11-nov-active.json)（source_old_path：`.ch/docs/exec-plans/completed/2026-11/2026-11-02-scheduled-task-dialog-tabs.md`）。
- Chromium Playwright：桌面和窄屏、表单/列表互斥、草稿保留、空态与保存反馈。
- `git diff --check` 与 UI 机械扫描。

## 验证结果与收尾

- `npm run build`：通过。
- 测试开发/历史结果及失败分类见 [测试计划删除审计](../../migrations/test-plan-removals/2026-11-11-nov-active.json)（source_old_path：`.ch/docs/exec-plans/completed/2026-11/2026-11-02-scheduled-task-dialog-tabs.md`）。
- Chromium Playwright 使用当前构建的完整 Webview 与隔离合成宿主数据验证，7/7 场景通过：桌面提交、桌面列表、390px 草稿保留与键盘导航、390px 列表、空列表、添加成功、添加失败。所有场景无浏览器错误、请求失败或 HTTP 错误，无横向溢出或页签重叠。
- 截图与结果：`.tmp/playwright-smoke/scheduled-task-tabs-*/`；已视觉检查桌面提交和窄屏列表，修正了页签与正文间距。任务专用页面、场景与服务在验证后清理。
- `git diff --check`、ontology `--validate` 通过；UI 机械扫描无发现。
- 文档交付证据见 [`2026-11-02-docs-scheduled-task-dialog-tabs.md`](2026-11-02-docs-scheduled-task-dialog-tabs.md)。
- 任务级记忆保留在本计划；无新跨会话风险或可复用踩坑，不写入热区记忆。
