# 工具设置人工交互配置与 Vibe 询问弹窗 — 文档

- 日期：2026-08-08
- 状态：completed
- 负责人：Codex
- owner：Codex
- claimed_at：2026-08-08
- claim_ttl：本轮任务
- handoff_to：无
- 类型：docs
- 原计划：`.ch/docs/exec-plans/completed/2026-08/2026-08-08-human-interaction-vibe.md`

## 本类型目标

同步 FEATURE_INVENTORY、capabilities、vscode-cli-extension-runtime、cli-reference 和 vscode_cli_plugin_dev_guide，说明人工交互开关和继续/拒绝语义。

## 范围与所有权

- 同步 FEATURE_INVENTORY、capabilities、vscode-cli-extension-runtime、cli-reference 和 vscode_cli_plugin_dev_guide，说明人工交互开关和继续/拒绝语义。
- 本记录只承担 文档；其它存活类型的交付归下列具体关联计划，不作为本计划的附带事项；原独立 test 记录已删除，本计划不接回测试开发。
- 保留原日期、负责人及 claim 元数据。状态继承原计划 `completed`，不是本轮重新完成或重新验证。

## 验收标准

- 同步 FEATURE_INVENTORY、capabilities、vscode-cli-extension-runtime、cli-reference 和 vscode_cli_plugin_dev_guide，说明人工交互开关和继续/拒绝语义。
- 本计划不承接其它类型范围；存在的失败、未执行与未发布结论继续有效。

## 验证计划与证据边界

按本计划列明的产品/规则/设计文件核对语义与链接；原文只记载已同步的事实，没有独立文档审校通过证据，不借用功能测试冒充文档专属验证。

## 关联计划

- [2026-08-08-feature-human-interaction-vibe.md](2026-08-08-feature-human-interaction-vibe.md)：实现/治理接口及共同背景；各自保持历史状态，不由关联关系推定通过。
- [测试计划删除审计](../../migrations/test-plan-removals/2026-11-11-jul-sep.json)：按用户授权删除 test 类型记录，仅留存历史验证证据；本计划不承接独立测试开发。

## 本类型历史记录

### 影响面

- 文档目录：`.ch/docs/product-specs/`、`.ch/docs/design-docs/`、`docs/`。

### 验证计划

- 扩展验证：检查配置 schema、nls、文档和功能清单同步。

### 测试与清单同步

- 功能清单：已同步 `.ch/docs/product-specs/FEATURE_INVENTORY.md`。
- 相关文档同步：已同步 `.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md`、`.ch/docs/design-docs/vscode-cli-extension-runtime.md`、`docs/cli-reference.md`、`docs/vscode_cli_plugin_dev_guide.md`。

## 分类依据与真实状态

feature：新增设置和 Vibe 人工澄清链路；test：源文列出新增 humanInteraction 与五类更新；docs：源文明确完成产品清单、规格、设计与 CLI 指南。78/78 为原聚合结果，不是迁移时新通过。

当前记录继承 `completed`；本轮仅语义拆分/命名迁移，未执行上述历史业务命令，不改变失败、阻塞或未发布结论。

## 测试类型记录清理

2026-11-11 按用户明确授权删除本来源的 test 类型计划；历史验证命令、结果、失败、跳过与限制见 [测试计划删除审计](../../migrations/test-plan-removals/2026-11-11-jul-sep.json)（按原来源路径检索）。本记录的作者、日期、状态与历史结果不变，不接回独立测试开发，也不表示本轮重跑历史命令。
