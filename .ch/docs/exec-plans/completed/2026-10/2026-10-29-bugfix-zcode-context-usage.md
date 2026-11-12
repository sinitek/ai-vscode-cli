# ZCode 上下文用量与原生压缩修复 — 已发布行为修复

- 日期：2026-10-29
- 状态：completed
- 负责人：Codex
- 类型：bugfix

- 迁移来源：`.ch/docs/exec-plans/completed/2026-10/2026-10-29-zcode-context-compaction.md`（历史标识，原文件已替换）
- 关联计划：[新功能开发](2026-10-29-feature-zcode-native-context-compaction.md); [文档](2026-10-29-docs-zcode-context-compaction.md)
- 测试计划删除审计：[十月历史证据](../../migrations/test-plan-removals/2026-11-11-oct.json)（按本页迁移来源查项；仅保留历史事实，不承担独立测试开发）。

## 本子计划目标

修复 ZCode 初始化伪零用量和旧运行状态展示。仅承担已发布行为修复；独立文档与其他类型仍按关联计划分工；test 计划已删除，其历史证据见删除审计，不并回本计划。

## 本子计划实施范围

下列归属条目中的已发布行为修复；关联计划的交付不是本计划实施范围。

## 本子计划验收

遵守下列原文的行为/范围约束及验收标准；完成状态不等于所有历史风险、失败和待审事项已经消除。

## 依赖与背景

文档仍以关联实现、历史验证与追加决策的真实结果为依据。原 test companion 已于 2026-11-11 删除；测试开发不是本存活计划的现行职责。这里保留同一历史任务的依赖与边界，不声称重新执行。feature 原生压缩完成后发送的用量依赖 bugfix 的真实用量判定；accepted 不构成完成，原测试曾覆盖请求前监听和同会话终态，仅作历史说明。

共享背景和跨类型验收关系见[来源任务的归属记录](2026-10-29-bugfix-zcode-context-usage.md)；原始作者、日期和状态语义沿用头部记录。

## 历史验证与未决事项

本文件保留原任务共用的实际验证、失败/阻塞和未决事项。下面的历史命令与结果仅为当时证据，本次迁移未重新执行历史业务命令；其它子计划引用这里，不重复混合全文。

## 原文归属记录

## 背景与目标

- ZCode 分组持续显示初始化的 `0k`，真实最小对话后 `projection.contextUsed` 为 17956，窗口为 200000。不伪造统计或本地摘要。

## 范围与非目标

- 不修改用户配置、CLI 版本、其他 CLI 的能力边界或布局。

## 验收标准

- ZCode 初始化零值或缺失统计不展示标签；收到真实正数后显示，切换标签页不串值。

- 构建通过。

## 影响面与风险

- 不读取或记录凭据、原始对话与用户私有运行数据。

## 验证计划

- 构建：`npm run build`。

- 浏览器：使用实际 Webview 脚本进行 headless Chromium 场景验证。

## 任务列表

- Tasklist:

- [completed] 按支持情况修正实现。

- [completed] 完成验证。

## 实现结论

- 协议读取器排除初始化零值；Webview 同时防御旧运行状态中的零值，其他 CLI 的合法零值展示不变。

## 验证结果

- `npm run build`：通过。

- `node --test --test-skip-pattern='keeps the owning conversation tab errored' dist/test/webview/clipagescriptruntimecoverage.test.js`：其余 103 项全部通过；连同上一组共 188 项 TypeScript 回归通过。

- 页面全量中有 1 项既有失败：`keeps the owning conversation tab errored for error bubbles through append, update, collapse, and recovery`，断言 `undefined !== true`。使用 `git show HEAD:src/webview/<module>.ts` 将本次四个修改过的 Webview 模块恢复为内存中的原版导出，再以 `node --test-name-pattern='keeps the owning conversation tab errored'` 运行同一测试，仍以相同位置和断言失败，归类为历史／范围外失败，不扩大修复。

- 浏览器夹具校准：首次重叠检查错误选取空闲时隐藏的状态文本，改为真实可见的提示词按钮；失败场景应恢复上一条已知真实用量，而非清空，修正夹具断言后整组重跑通过。未改动生产布局。

- `python3 .agents/skills/ontology/scripts/search_ontology.py --validate`：通过；`python3 -m unittest discover -s .agents/skills/ontology/tests -p 'test_*.py'`：9 项通过。

- Impeccable 机械检测无告警，`git diff --check` 通过。

## 文档与记忆判断

- 稳定协议陷阱直接沉淀到 ZCode 指南，任务过程留在本计划；不新增重复热区记忆、事件记忆或 skill，不写入 `ROLLING_SUMMARY.md`。

- 未执行 Windows 真机及 Extension Development Host 端到端验证；本次未新增平台路径处理，已用真实 macOS CLI、实际 Webview HTML／脚本及宿主单测分层覆盖。

- 无未决功能问题；唯一范围外项为已基线复现的既有页面错误状态测试。
