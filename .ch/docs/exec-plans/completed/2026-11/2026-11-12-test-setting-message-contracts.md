# 设置消息公开行为契约回归

- 日期：2026-11-12
- 类型：test
- 状态：completed
- 负责人：Loop+ 独立测试执行
- 关联计划：同目录 `2026-11-12-refactor-setting-message-commands.md`、`2026-11-12-docs-setting-message-commands.md`。共同背景为设置消息无行为变化重构；测试只依赖公开入口，不编辑关联计划。

## 背景与目标

设置消息重构将拆分静态命令表、领域处理器与兼容 Facade。本任务通过既有 `handleUpdateSettingMessage` 和 `handlePanelMessageWithDeps` 锁定行为，不依赖内部模块结构。

## 范围与非目标

- 只扩展两个现有 CoreCoverage 测试套件，复用隔离 fixture，不安装框架。
- 覆盖分派键、归一化、刷新边界、动态依赖、错误传播、CLI 可用性提交顺序。
- 不改生产源码、实现/docs 计划、UI、调度状态、任务记录、ROLLING_SUMMARY；不负责旧 Loop 路由真实验收。

## 验收标准

- [x] 对真实覆盖缺口增加最少且有判别力的公开入口断言。
- [x] 私有 outDir 使用本地 TypeScript 与原 tsconfig 编译，两个相关套件通过；失败按类型记录。
- [x] 报告记录覆盖矩阵、源码/测试摘要、执行命令、结果及证据适用快照。
- [x] 归档本 test 计划，不把单元结果声明为最终集成或真实 CLI 验收。

## 影响面

- 测试：`src/test/session/sessionMessageActionsCoreCoverage.test.ts`、`src/test/session/sessionMessageHandlersCoreCoverage.test.ts`（按当前磁盘大小写，不新增小写副本）。
- 文档：本 test 计划与指定 attempt report。
- 生产源码、依赖与 tsconfig：不修改。

## 风险与缓解

- 共享目录会并发变更：修改前重读目标，小范围补丁；编译前后记录相关文件 SHA-256。
- 共享 dist 只由生产任务构建：禁止 build/test:unit，私有产物仅放 ignored `node_modules/.cache/loop-settings-contracts-round2-ezu3vN`。
- 保持旧兼容语义：不扩展 CLI，不将 split 改成 suffix parser；不统一 finally 或回调缺失行为。

## 验证计划

- 使用 `node node_modules/typescript/bin/tsc --project tsconfig.json --outDir node_modules/.cache/loop-settings-contracts-round2-ezu3vN`。
- 使用 `node --test` 显式运行私有产物两个 CoreCoverage 套件，不读写共享 dist。
- 记录编译前后快照与重构是否已接入；检查改动空白及计划引用。
- 不需要浏览器、真实 CLI、通知系统或用户设置；不运行发布脚本。

## 测试与清单同步

- 复用：已有精确/前缀普通成功及非法值、autoCompact 全局保存成功清旧键/失败保留、strict-true、保存错误路径。
- 新增：Actions 10 条、Handlers 1 条；原型键、角色 payload 刷新分界、点号 ID/split、动态状态、通知拒绝、依赖异常及 cliEnabled 等待顺序。
- 强化既有 autoCompact 别名用例，输入由 true 改为字符串 `"false"`，仍期待 Boolean 转换后的 true，与 strict-true 设置区别开。
- 功能清单、ontology、热区记忆：行为不变、公开路径未迁移，无新增产品承诺，无需同步。

## 覆盖矩阵

| 契约 | 证据 |
| --- | --- |
| 精确/前缀有效及非法值刷新 | 复用 `normalizes OpenCode variants...`；新增 near misses、constructor/toString/__proto__、退役键均无副作用 |
| 角色 object 分支 | 非 object 不刷新，非法 object（含数组）刷新；模型保留原值、thinking 模型 trim/空转 null，失败中文错误 |
| 配置 ID 与角色 split | 5 个配置前缀保留完整点号 ID；角色只取 split 的 CLI/role，忽略后续段；不 trim CLI key、不扩展 CLI |
| 可选回调缺失 | 分别锁定只刷新、仍 reload 的旧差异；通知无回调也刷新 |
| 动态依赖与接线 | `handlePanelMessageWithDeps` 连续 5 次调用，CLI/工作区替换，同一 codex 的活动配置 first→second，不缓存 |
| 通知失败与异常 | 4 个通知键的 Error/非 Error 拒绝捕获、非法值跳过保存仍刷新；6 类其他依赖失败按同一异常传播且不刷新 |
| cliEnabled 提交 | 过滤非 boolean/未知 map 条目；保存失败/非法值不切换、不重定向、不发布；可控 Promise 验证切换完成之后才 retarget→publish→refresh |
| autoCompact/strict true/失败 | 复用已有清旧键与失败保留、hideInstructionBubbles strict-true、保存失败错误路径；只强化别名 Boolean 用例 |

## 实际验证

- 编译命令执行 3 次均 exit 0（TypeScript 5.9.3，同一 tsconfig、只覆盖 outDir）；第 1 次之后别名测试改动使该次测试证据不足；第 2 次后运行两套件 59/59；第 3 次仅因加强同一 CLI 配置切换断言。
- 两套件有效命令：在私有 outDir 用 `child_process.spawnSync(process.execPath, ['--test', 'test/session/sessionMessageActionsCoreCoverage.test.js', 'test/session/sessionMessageHandlersCoreCoverage.test.js'], { cwd: path.resolve('node_modules', '.cache', 'loop-settings-contracts-round2-ezu3vN'), encoding: 'utf8' })` 执行，59 pass / 0 fail / 0 skipped。
- 第 3 次编译后仅重跑变动的 Handlers：相同 spawnSync，将参数缩为该套件，26 pass / 0 fail / 0 skipped；Actions 原有 33 条仍由前次通过结果覆盖，未无意义重跑。
- 首次直接从根目录传入 `node_modules/.cache/...` 两测试路径，Node 返回 Could not find；属于 Node 测试发现路径/环境问题，未执行用例。改用跨平台 path.resolve + spawnSync 的 cwd，不改业务或测试断言。
- 最后一次编译前后 613 个 TypeScript 输入摘要一致；11 个相关源码/测试的私有 JS 与同配置 transpile 结果逐字一致。执行时公开 Facade 已导入 settingMessageRouter，不是旧内联分支。
- 快照文件位于私有 outDir `compile-inputs-*.json`。详见指定 attempt report 的完整 SHA-256、命令与检查范围。
- 未运行共享 dist/build/test:unit、全量测试、覆盖率门禁、浏览器、真实 CLI/通知或真实 Loop 门禁；生产构建及最终验收属于主任务。

## 当前进展

- 测试开发与私有验证完成，归档到 2026-11；未发现需提交生产任务修复的行为差异。
- 之后只补计划/报告与静态检查，不变更测试；后续生产变更须按摘要判断这些结果是否仍可复用，不能当作最终集成验收。
