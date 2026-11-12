# Harness 骨架开关文档同步

- 日期：2026-07-03
- 状态：completed
- 负责人：Codex

## 背景与目标

Harness 骨架开关交付同时同步了功能清单及 CLI/runtime、CodeGraph 和长期记忆文档。功能范围见 [`2026-07-03-feature-harness-setting-init.md`](2026-07-03-feature-harness-setting-init.md)；原历史验证证据见 [测试计划删除审计](../../migrations/test-plan-removals/2026-11-11-jul-sep.json)。

## 范围与非目标

- 同步 `.ch/docs/product-specs/FEATURE_INVENTORY.md`、`.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md`、`.ch/docs/references/cli-runtime-reference.md`、`.ch/docs/references/codegraph.md`。
- 同步 `docs/cli-reference.md`、`docs/插件功能清单.md`、`docs/long_term_memory_design.md`。
- 记录默认关闭、显式确认后安装 scaffold 与 CodeGraph 初始化的历史说明。
- 不将文档同步本身当成功能或测试验证。

## 验收与验证

- [x] 原计划明确记录功能清单与列出的相关文档已同步。
- 验证状态：来源没有独立文档构建或链接检查结果；本计划不推断有此类检查。

## 当前结论

已完成（按原计划记录）。文档同步的历史完成事实予以保留，未新增独立自动化验证结论。

## 测试类型记录清理

2026-11-11 按用户明确授权删除本来源的 test 类型计划；历史验证命令、结果、失败、跳过与限制见 [测试计划删除审计](../../migrations/test-plan-removals/2026-11-11-jul-sep.json)（按原来源路径检索）。本记录的作者、日期、状态与历史结果不变，不接回独立测试开发，也不表示本轮重跑历史命令。
