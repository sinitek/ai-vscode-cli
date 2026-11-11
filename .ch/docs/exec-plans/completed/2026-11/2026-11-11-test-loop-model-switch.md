# Loop 切模型回归验证

- 日期：2026-11-11
- 类型：test
- 状态：completed
- 负责人：Codex
- 关联计划：`.ch/docs/exec-plans/completed/2026-11/2026-11-11-feature-loop-model-switch.md`，实现本计划验证的功能与运行时接口。

## 目标与范围

更新继续交互断言，覆盖模型表单角色、选项校验、持久化、运行中延后生效、暂停自动继续和 Loop+ 中断 attempt 续跑。

## 非目标

不扩展无关覆盖率、不调用收费真实模型、不发布扩展。

## 验收标准

- 成功、空模型默认值、非法选项、重复提交与运行中不打断均有断言。
- 最新模型覆盖旧的 live prompt，分离模式前后端独立。
- Chromium 验证表单提交、取消与内容补丁保留输入，保存截图和运行结果。

## 风险与缓解

旧测试仍断言已经移除的模型来源选择，按新契约更新；其他失败先分类，不修改无关代码。

## 验证结果

- `npm run build` 通过；相关 Node 单测 349/349 通过，覆盖模型切换与 Loop/Loop+ 续跑。
- Chromium 桌面和 390×820 窄屏验证通过。交互断言包括刷新保留选择和焦点、取消不写入、弹窗不溢出视口、提交保存三个模型、暂停任务只恢复一次、Escape 恢复焦点；浏览器、网络和页面交互错误均为 0。记录位于 `.tmp/playwright-smoke/loop-model-switch/`。
- 全量命令 `TMPDIR=/tmp node scripts/run_unit_tests.js`：3796 项中 3787 通过、6 失败、3 跳过。6 项失败在 HEAD 基线均可复现：4 项 Loop+ 面板过期断言、2 项 Webview VM harness 缺少 `retainChatBubbleEntries` 注入；分类为既有测试断言/夹具问题，不属于本次实现缺陷。
- Ontology 校验更新后有 13 项既有迁移缺失引用（HEAD 基线 19 项）；相关 ontology 测试 8/9 通过，唯一失败与相同引用问题相关。本次修改的规则和 `source_refs` 已核对有效。
- `git diff --check` 通过。未调用真实模型，未更改无关失败或迁移文档。

## 归档结论

回归验证已完成。全量测试及 ontology 校验的已知基线问题已分类并记录，不阻塞相关单测和浏览器验收；计划已归档至 `.ch/docs/exec-plans/completed/2026-11/2026-11-11-test-loop-model-switch.md`。
