# 测试目录模块化重构

- 日期：2026-08-30
- 状态：completed
- 负责人：Codex
- owner：Codex
- claimed_at：2026-08-30
- claim_ttl：本次会话

## 背景

`src/test` 当前约有一百个测试文件平铺在同一层，测试定位、按模块运行和后续维护成本较高。项目编译器会保留 `src` 下的相对目录结构，单测脚本也已经递归发现 `dist/test/**/*.test.js`，因此可以在不改变测试执行模型的前提下增加模块目录层级。

## 目标

按被测代码模块为 `src/test` 增加一层目录划分，保持所有测试行为、测试名称和构建产物可发现性不变；同步修正测试内相对导入、定向测试脚本、失败分类路径映射及必要文档。

## 范围

- 将现有测试按 `cli`、`config`、`core`、`extensionHost`、`graph`、`interactive`、`loop`、`memory`、`session`、`shared`、`webview` 等模块归档。
- 移动共享的 `vscodeMock.ts` 到测试根目录并修正引用。
- 修正 `package.json` 中 `test:core`、`test:page` 及覆盖率脚本使用的新 `dist/test/<module>/...` 路径。
- 修正测试路径解析/失败分类中对 `src/test/*.test.ts` 的假设。
- 同步受影响的运行手册与测试事实来源文档；不改变生产功能契约。

## 非目标

- 不重命名测试文件，不改测试断言或生产逻辑行为。
- 不引入新的测试框架、测试聚合入口或额外依赖。
- 不全面改写历史文档中与本次迁移无关的旧测试记录。

## 验收标准

- [x] 每个现有 `.test.ts` 恰好移动到一个模块子目录，`src/test` 不再平铺测试文件（共享夹具除外）。
- [x] `npm run build` 通过，编译产物按新目录生成。
- [x] `node scripts/run_unit_tests.js --list` 递归列出全部 122 个新路径，且全量单测 924/924 通过。
- [x] `test:core`（217/217）、`test:page`（177/177）和覆盖率脚本中的定向路径均可解析。
- [x] 失败分类和相关路径契约测试覆盖新目录格式。

## 影响面

- 代码目录：`src/test/**`、`src/graph/graphFailureClassification.ts`、相关测试路径契约。
- 文档目录：`.ch/docs/runbooks/local-development.md`、必要的事实来源说明。
- 配置与脚本：`package.json` 中定向测试/覆盖率命令。

## 风险与缓解

- 风险：移动后相对导入层级改变，或定向命令仍引用旧路径。
- 缓解：按目录映射批量修正导入；构建后检查新旧产物；执行全量发现、核心/页面分组和路径分类测试。
- 风险：历史文档中的旧路径造成检索混淆。
- 缓解：更新稳定运行手册与事实来源；历史故障记录仅在与当前入口直接冲突时调整。

## 验证计划

- 最小相关验证：`npm run build`、`node scripts/run_unit_tests.js --list`、路径分类相关测试。
- 单元自测命令：`npm run test:unit`、`npm run test:core`、`npm run test:page`；覆盖率脚本也已执行以确认定向路径可解析。
- 扩展验证：本次仅调整测试组织，不涉及 Webview/Extension Host 运行行为；不需要启动 Extension Development Host。

## 测试与清单同步

- 单元测试新增/更新：更新测试相对导入和新目录路径断言；不新增业务用例。
- 单元自测结果：`npm run build` 通过；`node scripts/run_unit_tests.js --list` 列出 122 个测试且根目录无平铺测试；`node scripts/run_unit_tests.js` 通过 924/924；`npm run test:core` 通过 217/217；`npm run test:page` 通过 177/177；源码测试路径与编译产物路径一一对应。
- 失败处理记录：核心覆盖率为 98.8% statements / 98.76% branches，页面覆盖率为 99.96% statements / 99.12% branches；覆盖率脚本中的测试用例通过，但既有 100% 阈值因业务分支未覆盖而失败。本次仅重构测试目录，不扩大范围修改业务分支。
- 功能清单：无用户可见功能或行为变化，无需更新 `FEATURE_INVENTORY.md`。
- 相关文档同步：已更新 `.ch/docs/TESTING.md`、`.ch/docs/runbooks/local-development.md` 及受影响的路径事实来源。

## 任务列表

- [x] 建立模块映射并移动测试文件
- [x] 修正导入、脚本和路径映射
- [x] 更新文档并运行构建、单测和分组验证
- [x] 归档已完成执行计划

## 决策记录

- 2026-08-30：保留原测试文件名，仅增加一层与被测模块对应的目录；保留 `src/test/vscodeMock.ts` 作为共享夹具。

## 当前结论

已确认 TypeScript `rootDir=src` 会保留测试子目录，`run_unit_tests.js` 已递归发现编译测试，因此目录模块化不需要改变编译器或全量测试发现器。122 个测试文件已按 11 个模块目录完成迁移，导入、脚本、路径分类和稳定文档已同步；构建、全量单测和核心/页面分组验证均通过。覆盖率阈值失败属于迁移前已存在的业务分支覆盖不足，未因本次目录重构引入。
