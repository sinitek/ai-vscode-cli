# 全量回归测试与缺陷处理

- 日期：2026-10-07
- 状态：completed
- 负责人：Codex
- owner：
- claimed_at：2026-10-07
- claim_ttl：本次会话
- handoff_to：

## 背景

当前工作区包含 Loop 状态机、Prompt 运行时和 Graph 面板相关的未提交改动，需要按仓库测试基线完成全量回归，并对可归因的失败做最小修复。

## 目标

确认构建、核心单元测试、页面相关单元测试和全量单元测试结果；对本次改动导致的缺陷补充修复与回归验证，并记录无法归因或环境阻塞。

## 范围

- `npm run build`
- `npm run test:unit`
- `npm run test:core`
- `npm run test:page`
- `npm run validate:whitespace`
- 与失败直接相关的 TypeScript、测试、文档和功能清单同步

## 非目标

- 不回滚或重写工作区已有的用户改动
- 不修复与本次改动无关的历史失败
- 不执行需要真实外部 CLI、VS Code Extension Development Host 或生产配置的高成本验证，除非单测证据要求

## 验收标准

- [x] `npm run build` 通过
- [x] `npm run test:unit` 通过，或对每个失败完成分类并记录证据
- [x] `npm run test:core` 与 `npm run test:page` 通过，或记录合理失败原因
- [x] 失败修复后重跑最小相关测试与受影响的全量入口
- [x] 工作区改动、功能清单和执行计划状态保持一致

## 影响面

- 代码目录：`src/extensionHost`、`src/test`、`src/webview`
- 文档目录：`.ch/docs/design-docs`、`.ch/docs/product-specs`
- 配置与脚本：`package.json` 测试入口、`dist/` 构建产物

## 风险与缓解

- 风险：工作区存在未提交改动，无法直接以干净基线区分历史失败。
- 缓解：先记录当前状态，按失败用例、变更路径和基线证据分类，不覆盖现有改动。
- 风险：全量测试可能触发覆盖率、平台或资源限制。
- 缓解：遵循 `.ch/docs/TESTING.md`，先构建和最小相关测试，再扩大到分组及全量入口。

## 验证计划

- 最小相关验证：先执行 `npm run build`，失败后定位编译错误；构建通过后执行变更相关测试。
- 单元自测命令：`npm run test:unit`、`npm run test:core`、`npm run test:page`。
- 扩展验证：执行 `npm run validate:whitespace`，必要时执行覆盖率入口并记录环境限制。

## 测试与清单同步

- 单元测试新增/更新：以当前工作区测试文件为准；发现稳定逻辑缺陷时补回归用例。
- 单元自测结果：`npm run test:unit` 通过，1476/1476；`npm run test:core` 通过，238/238；`npm run test:page` 通过，242/242。
- 失败处理记录：恢复 `.vscodeignore` 中缺失的扩展宿主运行时依赖放行规则；将 OpenCode 共享模板重构后的静态契约测试改为检查 `openCodePromptRunTemplate.ts`；补齐 VS Code 配置 `inspect` mock；同步中文 Webview 文案和 Loop+ 测试抽取夹具；将高并发下真实 CLI mock 的异步等待上限从 2 秒提高到 10 秒。全量入口首次失败均已分类并在修复后复测通过。
- 功能清单：本次主要验证已有工作区改动；如修复改变用户可见行为，核对 `FEATURE_INVENTORY.md`。
- 相关文档同步：本次为测试、打包和夹具修复，不改变用户可见能力或业务状态机；未更新 `FEATURE_INVENTORY.md` 与 ontology。空白校验仍命中 `HEAD` 已存在且未触及的 `src/webview/viewContentStrings.ts:65`。

## 任务列表

- [x] 记录基线并完成构建
- [x] 执行相关分组和全量单元测试
- [x] 分类失败并修复可归因缺陷
- [x] 重跑受影响测试并完成收尾记录

## 决策记录

- 2026-10-07：保留工作区既有未提交改动，以当前磁盘状态作为回归对象。
- 2026-10-07：按 `.ch/docs/TESTING.md` 从构建和最小范围逐步扩大测试范围。

## 当前结论

2026-10-07 完成全量回归。构建、全量单元、核心分组、页面分组和本次相关定向测试均通过；本次触及文件的空白校验与 `git diff --check` 通过。仓库全量空白校验仅剩 `src/webview/viewContentStrings.ts:65` 的既有尾随空格，未纳入本次范围。
