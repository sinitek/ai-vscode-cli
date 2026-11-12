# 工具设置 Tab 重构 — 文档

- 日期：2026-09-13
- 状态：completed
- 负责人：Codex
- owner：
- claimed_at：
- claim_ttl：
- 类型：docs
- 原计划：`.ch/docs/exec-plans/completed/2026-09/2026-09-13-tool-settings-tabs.md`

## 本类型目标

同步 FEATURE_INVENTORY、capabilities、runtime reference、runtime design 与 docs/cli-reference 的三Tab归属。

## 范围与所有权

- 同步 FEATURE_INVENTORY、capabilities、runtime reference、runtime design 与 docs/cli-reference 的三Tab归属。
- 本记录只承担 文档；其它存活类型的交付归下列具体关联计划，不作为本计划的附带事项；原独立 test 记录已删除，本计划不接回测试开发。
- 保留原日期、负责人及 claim 元数据。状态继承原计划 `completed`，不是本轮重新完成或重新验证。

## 验收标准

- 同步 FEATURE_INVENTORY、capabilities、runtime reference、runtime design 与 docs/cli-reference 的三Tab归属。
- 本计划不承接其它类型范围；存在的失败、未执行与未发布结论继续有效。

## 验证计划与证据边界

按本计划列明的产品/规则/设计文件核对语义与链接；原文只记载已同步的事实，没有独立文档审校通过证据，不借用功能测试冒充文档专属验证。

## 关联计划

- [2026-09-13-feature-tool-settings-tabs.md](2026-09-13-feature-tool-settings-tabs.md)：实现/治理接口及共同背景；各自保持历史状态，不由关联关系推定通过。
- [测试计划删除审计](../../migrations/test-plan-removals/2026-11-11-jul-sep.json)：按用户授权删除 test 类型记录，仅留存历史验证证据；本计划不承接独立测试开发。

## 本类型历史记录

### 范围

- 产品规格、运行时参考和设计文档中对设置页归属的描述。

### 影响面

- 文档目录：`.ch/docs/product-specs/`、`.ch/docs/references/`、`.ch/docs/design-docs/`。

### 测试与清单同步

- 功能清单：已同步 `.ch/docs/product-specs/FEATURE_INVENTORY.md`，记录三 Tab 归属。
- 相关文档同步：已同步 `.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md`、`.ch/docs/references/cli-runtime-reference.md`、`.ch/docs/design-docs/vscode-cli-extension-runtime.md` 和 `docs/cli-reference.md`。

## 分类依据与真实状态

feature（原refactor改判）：用户可见Tab数量、名称与设置入口归属实际改变，不是仅代码行为保持重构；test：三组Tab覆盖实际更新；docs：五处事实描述实际更新。12/12与全量946/947、既有Tasklist解析失败保留。

当前记录继承 `completed`；本轮仅语义拆分/命名迁移，未执行上述历史业务命令，不改变失败、阻塞或未发布结论。

## 测试类型记录清理

2026-11-11 按用户明确授权删除本来源的 test 类型计划；历史验证命令、结果、失败、跳过与限制见 [测试计划删除审计](../../migrations/test-plan-removals/2026-11-11-jul-sep.json)（按原来源路径检索）。本记录的作者、日期、状态与历史结果不变，不接回独立测试开发，也不表示本轮重跑历史命令。
