# 新增配置直接打开一键导入弹窗

- 日期：2026-11-03
- 状态：completed
- 类型：feature
- 负责人：Codex

## 关联计划

- 共同背景与依赖（测试证据）：[测试计划删除审计](../../migrations/test-plan-removals/2026-11-11-nov-active.json)（source_old_path：`.ch/docs/exec-plans/completed/2026-11/2026-11-03-new-config-import-dialog.md`）。
- 历史文档依赖：原 docs companion `2026-11-03-docs-new-config-import-dialog.md` 已退役；仅留历史身份与分工，完整校验记录未恢复。[references 索引](../../../references/index.md)仅作导航。

## 背景与目标

配置目录的“添加”目前只输入名称并复制静态范例。改为直接复用对应 CLI 的一键导入弹窗，填写名称、地址、密钥和模型后生成并保存档案。

## 范围与非目标

- 覆盖 Claude、Codex、OpenCode、Grok、DSH、Kimi Code、ZCode 的新增入口和共享导入弹窗。
- 保留已有范例导入仅修改草稿的行为、范例内容和配置持久化接口；不自动激活新档案。
- 不修改用户已有工作区改动、CLI 执行逻辑、依赖和主题。

## 验收标准

- 点击“添加”直接显示对应 CLI 导入弹窗，并允许编辑配置名称。
- 必填校验通过后，按对应范例替换地址、密钥及模型引用，再保存和选中新档案。
- Codex 两个文件及其他 CLI 的内容镜像保持一致。
- 取消或校验失败不创建档案；保存失败保留输入并可重试；保存中防止重复提交。
- 现有范例导入仍只改草稿，不自动保存或激活。

## 影响面与风险

- 实现：`media/config/assets/config-app-ui.js`。
- 回归：`src/test/config/newConfigFromExample.test.ts`、`src/test/config/cliExampleImport.test.ts`。
- 功能清单、配置中心能力规格和CLI业务本体维护原指向已退役 docs companion（完整记录未恢复）。
- 风险：共享弹窗异步提交改变旧测试时序；统一等待提交并覆盖保存失败与重复提交。

## 验证计划

- 执行 `npm run build`，然后运行新增配置、范例导入及关联配置页测试。
- 使用隔离配置数据进行 headless Chromium 点击新增、填写、取消和确认验证，不改真实用户配置。
- 执行 ontology 校验、界面机械检查和 `git diff --check`。

## 测试与清单同步

- 测试开发/历史结果及失败分类见 [测试计划删除审计](../../migrations/test-plan-removals/2026-11-11-nov-active.json)（source_old_path：`.ch/docs/exec-plans/completed/2026-11/2026-11-03-new-config-import-dialog.md`）。
- 浏览器验证：1440×1000 桌面环境完成七类 CLI 的真实页面新增操作，校验失败与取消不保存、确认后内容正确且不自动激活；390×844 窄屏验证四项输入、密钥遮蔽、视口与无重叠，并 hover 确认按钮检查实际可交互。浏览器错误、失败请求与 HTTP 错误均为 0。
- 浏览器边界：使用 `getConfigViewHtml` 的实际页面与全部静态资源，扩展宿主消息桥由内存配置夹具替代，不触碰本机 CLI 配置；未启动真实 VS Code Extension Development Host 或 Windows 系统。
- 浏览器证据：`.tmp/playwright-smoke/new-config-import-desktop/result.json`、`.tmp/playwright-smoke/new-config-import-mobile/result.json` 和窄屏 `success.png`；任务临时脚本和场景已清理，证据仅留在忽略目录。
- 测试开发/历史结果及失败分类见 [测试计划删除审计](../../migrations/test-plan-removals/2026-11-11-nov-active.json)（source_old_path：`.ch/docs/exec-plans/completed/2026-11/2026-11-03-new-config-import-dialog.md`）。
- 结构验证：ontology `--validate`、界面机械检测与 `git diff --check` 均通过。
- 原 docs companion `2026-11-03-docs-new-config-import-dialog.md` 已退役；仅留历史身份与分工，完整校验记录未恢复。原文曾以该页为文档交付证据入口；此处无法复核其完整记录。[references 索引](../../../references/index.md)仅作导航。
- 记忆维护：本次局部行为变更优先保留在能力规格和本计划，不自动写入热区记忆。

## 任务列表

- 已完成：定位配置新增与一键导入流程。
- [completed] 复用导入弹窗；回归开发的历史记录见[测试计划删除审计](../../migrations/test-plan-removals/2026-11-11-nov-active.json)（`source_old_path`：`.ch/docs/exec-plans/completed/2026-11/2026-11-03-new-config-import-dialog.md`）。
- [completed] 构建、浏览器验证及功能计划归档；文档编辑原指向已退役 docs companion（完整记录未恢复）。

## 当前结论

复用 `CliExampleImportModal`、`buildCliExampleImport` 和现有档案工厂；仅校验通过并确认后调用既有新增存储接口，保存失败保留输入，成功后选中但不激活。构建、357 项配置测试及桌面/窄屏 Chromium 验证全部通过，无待办。
