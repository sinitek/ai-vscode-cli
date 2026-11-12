# 跳过一键导入进入空白配置

- 日期：2026-11-03
- 状态：completed
- 类型：feature
- 负责人：Codex

## 关联计划

- 共同背景与依赖（测试证据）：[测试计划删除审计](../../migrations/test-plan-removals/2026-11-11-nov-active.json)（source_old_path：`.ch/docs/exec-plans/completed/2026-11/2026-11-03-config-skip-import.md`）。
- 共同背景与依赖（docs）：[`2026-11-03-docs-config-skip-import.md`](2026-11-03-docs-config-skip-import.md)。

## 背景与目标

新增配置时允许用户跳过范例导入，直接编辑空白文档。

## 范围与非目标

- 七类 CLI 的新增弹窗支持跳过；范例抽屉导入不变。
- 不改变 CLI 配置保存校验或自动激活配置。

## 验收标准

- 创建按钮右侧显示跳过，无需填写导入字段即可进入空白源码编辑。
- 空白草稿不持久化，成功保存有效内容后成为普通档案；失败可重试。
- 草稿不能激活、复制或导出，删除草稿无需宿主操作。

## 影响面与风险

- 本计划范围为配置列表、弹窗和前端store；单测修改的历史职责见[测试计划删除审计](../../migrations/test-plan-removals/2026-11-11-nov-active.json)（`source_old_path`：`.ch/docs/exec-plans/completed/2026-11/2026-11-03-config-skip-import.md`），功能清单/规格维护归关联 `docs` 计划。
- 页面关闭会丢弃未保存草稿，需在产品规格中说明；各 CLI 保存校验保持不变。

## 验证计划

- 执行构建和配置页相关单测，检查七类 CLI、保存失败及删除。
- 可行时使用隔离宿主桥运行 Chromium 页面验证。
- 执行 ontology 校验；记录未覆盖环境。

## 验证与结论

- `npm run build` 通过；`node --test dist/test/config/*.test.js` 共 366 项通过。
- Chromium 以实际配置页面和内存宿主桥验证 1440×1000、390×844，跳过按钮位于创建按钮右侧，跳过后打开编辑器且不发送保存请求。未触碰用户配置；未验证真实 VS Code 宿主和 Windows。
- 测试开发/历史结果及失败分类见 [测试计划删除审计](../../migrations/test-plan-removals/2026-11-11-nov-active.json)（source_old_path：`.ch/docs/exec-plans/completed/2026-11/2026-11-03-config-skip-import.md`）。
- 草稿仅在当前页面内，需在切换配置或关闭页面前保存；不改变宿主对有效配置的校验。本次无需额外更新记忆热区。
