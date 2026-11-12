# Git 同步回归夹具文档同步

- 日期：2026-11-04
- 类型：docs
- 状态：completed
- 负责人：Codex

## 关联计划

- 共同背景：本记录承接 [`2026-11-04-chore-git-sync-integration.md`](2026-11-04-chore-git-sync-integration.md) 的独立文档交付。
- 历史测试摘要：[删除审计](../../migrations/test-plan-removals/2026-11-11-nov-active.json)，在 JSON 中以完整 `source_old_path` 值 `.ch/docs/exec-plans/completed/2026-11/2026-11-04-git-sync-full-regression.md` 定位历史记录；原 test 计划已删除，本计划不承接测试开发，审计不提供原计划完整正文。

## 背景与目标

记录已验证的 Webview 测试夹具依赖问题，并在 Git 同步期间保留远端 README 发布说明，不把测试修复或 README 更新误认为运行时代码变化。

## 范围与非目标

- 范围：将 Webview 抽取夹具依赖踩坑写入 `runbooks/PITFALLS.md`；合并时保留并行更新的 README 1.8.0 发布说明。
- 非目标：不重写 README 的发布事实，不运行发布/安装流程，不把自动任务流水写入记忆热区。

## 验收标准

- [x] PITFALLS 记录由测试实际复现的问题与夹具层修复边界。
- [x] 远端 README 发布说明保留；文档校验通过。
- [x] 记忆维护不重复抄录临时流水。

## 验证与真实结果

- 文档 whitespace 与 `git diff --check` 通过。
- 测试夹具实际分流：首轮缺少 `initDefault` 与配置排序桥接，未处理多个导入入口和 Ant Design 双字按钮空格；补齐真实契约后验证通过，没有修改产品实现迎合夹具。
- README 1.8.0 发布说明属于同步中保留的并行改动；本计划不据此宣称本轮执行了发布。
- 不追加 `ROLLING_SUMMARY.md` 或 `EVENT_MEMORY.md`，因复用事实已经进入 PITFALLS 和本记录。

## 当前结论

独立文档更新和保留并行 README 内容完成；本记录仅证明文档范围，不替代 Git 同步的验收。历史测试摘要按上列删除审计的完整来源值查阅，不恢复已删除测试计划，也不把夹具开发转入本 docs 计划。
