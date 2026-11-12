# VSIX jsonc-parser 打包事实来源同步

- 日期：2026-11-04
- 状态：completed
- 类型：docs
- 负责人：Codex

## 背景与目标

为 [jsonc-parser 运行时依赖修复](2026-11-04-bugfix-jsonc-runtime-dependency.md) 同步打包运行手册、功能清单和已有 VSIX ontology 规则。

## 范围与非目标

- 范围：记录生产依赖显式声明、最终 ZIP 审计和隔离加载保证。
- 非目标：不发布扩展、不改用户 README/版本号、不把一次导出写成市场可用性保证。

## 验收与结果

- 文档说明通用/平台包均需包含解析器资源，并保留 Windows 宿主未验证边界；原计划记录 ontology 校验和定向空白检查通过。

## 关联计划

- 实现来源：[2026-11-04-bugfix-jsonc-runtime-dependency.md](2026-11-04-bugfix-jsonc-runtime-dependency.md)
- 历史测试摘要：[删除审计](../../migrations/test-plan-removals/2026-11-11-nov-active.json)，在 JSON 中以完整 `source_old_path` 值 `.ch/docs/exec-plans/completed/2026-11/2026-11-04-jsonc-runtime-dependency.md` 定位历史记录；原 test 计划已删除，本计划不承接测试开发，审计不提供原计划完整正文。
