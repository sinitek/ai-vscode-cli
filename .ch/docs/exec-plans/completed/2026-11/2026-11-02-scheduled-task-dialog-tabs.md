# 定时任务弹窗页签拆分

- 日期：2026-11-02
- 状态：completed
- 负责人：Codex

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
- 测试：静态渲染和完整脚本运行时回归。
- 文档：功能清单。本次仅调整界面组织，不改变业务概念、状态机、权限或事实来源，因此无需更新 ontology。
- 风险：隐藏面板可能被 flex 样式覆盖；使用显式 `[hidden]` 样式并用浏览器核对。

## 验证计划

- `npm run build`
- `node --test dist/test/webview/cliPageStaticRenderCoverage.test.js dist/test/webview/clipagescriptruntimecoverage.test.js dist/test/webview/loopPlusModeEntry.test.js`
- Chromium Playwright：桌面和窄屏、表单/列表互斥、草稿保留、空态与保存反馈。
- `git diff --check` 与 UI 机械扫描。

## 验证结果与收尾

- `npm run build`：通过。
- `node --test dist/test/webview/cliPageStaticRenderCoverage.test.js dist/test/webview/clipagescriptruntimecoverage.test.js dist/test/webview/grokRulesFiles.test.js dist/test/scheduledTaskStore.test.js`：169/169 通过，包含 5 条新增页签回归。
- `node --test --test-name-pattern='scheduled' dist/test/webview/loopPlusModeEntry.test.js`：2/2 通过。
- 完整运行上述两个页面测试及 `loopPlusModeEntry.test.js` 时，158/159 通过；唯一失败为既有 Loop+ 静态文案断言 `/可见队列/`。独立取 `git show HEAD:src/webview/viewContentHtml.ts` 转译并渲染后确认 HEAD 同样没有该文案，分类为范围外既有断言失败，不修改相关产品文案或无关测试。
- Chromium Playwright 使用当前构建的完整 Webview 与隔离合成宿主数据验证，7/7 场景通过：桌面提交、桌面列表、390px 草稿保留与键盘导航、390px 列表、空列表、添加成功、添加失败。所有场景无浏览器错误、请求失败或 HTTP 错误，无横向溢出或页签重叠。
- 截图与结果：`.tmp/playwright-smoke/scheduled-task-tabs-*/`；已视觉检查桌面提交和窄屏列表，修正了页签与正文间距。任务专用页面、场景与服务在验证后清理。
- `git diff --check`、ontology `--validate` 通过；UI 机械扫描无发现。
- 已同步 `FEATURE_INVENTORY.md`。无架构、运行手册、权限、业务状态机或 ontology 变化。
- 任务级记忆保留在本计划；无新跨会话风险或可复用踩坑，不写入热区记忆。
