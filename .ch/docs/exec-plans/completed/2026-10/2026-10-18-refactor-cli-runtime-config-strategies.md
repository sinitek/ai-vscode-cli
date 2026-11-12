# CLI 运行配置策略化 — 行为保持重构

- 日期：2026-10-18
- 状态：completed
- 负责人：协作
- owner：Loop attempt round-1-refactor-cli-runtime-config-strategies
- claimed_at：2026-10-18
- claim_ttl：本次尝试
- handoff_to：无
- 类型：refactor

- 迁移来源：`.ch/docs/exec-plans/completed/2026-10/2026-10-18-cli-runtime-config-strategies.md`（历史标识，原文件已替换）
- 关联计划：[文档](2026-10-18-docs-cli-runtime-config-strategies.md)
- 测试计划删除审计：[十月历史证据](../../migrations/test-plan-removals/2026-11-11-oct.json)（按本页迁移来源查项；仅保留历史事实，不承担独立测试开发）。

## 本子计划目标

以策略表集中四平台运行配置，保持 IO、schema 和兼容外观。仅承担行为保持重构；独立文档与其他类型仍按关联计划分工；test 计划已删除，其历史证据见删除审计，不并回本计划。

## 本子计划实施范围

下列归属条目中的行为保持重构；关联计划的交付不是本计划实施范围。

## 本子计划验收

遵守下列原文的行为/范围约束及验收标准；完成状态不等于所有历史风险、失败和待审事项已经消除。

## 依赖与背景

文档仍以关联实现、历史验证与追加决策的真实结果为依据。原 test companion 已于 2026-11-11 删除；测试开发不是本存活计划的现行职责。这里保留同一历史任务的依赖与边界，不声称重新执行。

共享背景和跨类型验收关系见[来源任务的归属记录](2026-10-18-refactor-cli-runtime-config-strategies.md)；原始作者、日期和状态语义沿用头部记录。

## 历史验证与未决事项

本文件保留原任务共用的实际验证、失败/阻塞和未决事项。下面的历史命令与结果仅为当时证据，本次迁移未重新执行历史业务命令；其它子计划引用这里，不重复混合全文。

## 原文归属记录

## 背景

- `src/config/configService.ts` 同时负责档案存储、复制、校验和四个 CLI 的运行配置。`getCurrentConfig`、`applyConfig`、`backupConfig`、`initDefaultConfig` 里重复出现 Claude、Codex、OpenCode、Grok 分支。后续改一个平台时缺少单独入口。

## 目标

- 用策略注册表集中平台运行配置行为，`configService` 保留兼容外观。用户可见行为、磁盘 schema 和既有导出不变。

## 范围

- 新增 `src/config/cliRuntimeConfigStrategies.ts`。

- `configService` 在组合处注入原有低层读取、写入、备份函数，并把上述四个入口委托给策略。

## 非目标

- 不改配置档案 CRUD、复制、顺序、OpenCode 运行校验工具、Skills 外观导出和低层路径函数的签名。

- 不改 `ConfigItem`、`CurrentConfig`、`ApplyPayload` 或磁盘 schema。

- 不改功能清单、i18n、ontology、长期记忆，也不修复历史文档里的失效链接。

- 不提交、不更换依赖、不启动真实 CLI，也不做 UI 改动。

## 验收标准

- [x] 四个平台以完整 `Record<CurrentConfigPlatform, CliRuntimeConfigStrategy>` 注册，工厂使用显式 IO 端口。

- [x] 策略不导入 `configService` 或 VS Code，import 时不捕获 `HOME`、`CONFIG_PATHS` 或 `GROK_HOME`。

- [x] 外观导出、legacy `gemini` 归一、未知平台拒绝、档案保存优先级和 Grok mock 边界保持。

- [x] 读取失败回退与 `saveConfig` 失败传播分开。

- [x] 相关构建和指定单测通过。

## 影响面

- 代码目录：`src/config/`、`src/test/config/`。

- 配置与脚本：无。

## 风险与缓解

- 风险：把 apply 的内容优先级误用到档案保存。缓解：`saveConfig` 仍使用 `configContent ?? content`，并保留原有 Codex 档案测试。

- 回滚：删除新策略模块，把四个入口的平台分支放回 `configService`。无数据迁移。

## 验证计划

- 扩展验证：路径、配置页服务调用、Grok `readGrokConfigText` mock。

- 不适用：真实 CLI、浏览器、全量 `npm run test:unit`。

## 测试与清单同步

- 单元自测结果：见下方最终验证。

- 失败处理记录：第一次相关测试 58 通过、1 失败。失败点是备份夹具在创建 `GROK_HOME` 目录前写 `config.toml`，错误为 `ENOENT`。分类为夹具问题。补 `mkdir` 后重跑，未放宽产品断言。

- 本次只重排内部入口，用户可见配置行为不变，不修改功能清单，也不修改 i18n。

- `plugin.config_profile` 仍描述四个 CLI 的档案、路径和运行配置外观。实现没有改变概念、所有权、状态或跨域场景，外观事实来源仍然有效，因此不修改 ontology。

- 不修复 `.ch/docs/design-docs/` 历史失效链接，不扩写长期记忆。

## 任务列表

- [x] 抽出四个平台的运行配置策略和 IO 端口

- [x] 让外观委托策略并保留低层函数

## 决策记录

- 2026-10-18：采用显式策略注册表，而不是继承或 DI 容器。备份文件名和字节仍由现有 `backupClaudeConfig`、`backupCodexConfig`、`backupOpenCodeConfig`、`backupGrokConfig` 实现，策略只接收这些函数作为端口，避免第二套备份实现。

- 2026-10-18：`getBackupList`、档案复制和档案字段归一继续留在 `configService`。它们不是这次要移走的四条运行配置链路。

## 当前结论

- 策略注册表已经承接四个平台的读取、应用、备份和默认档案字段。`configService` 仍是外部消费者使用的外观。指定测试已通过。全量单元、真实 CLI 和浏览器验收未执行。

## 最终验证

- 工作目录是 Loop 工作区。`src` 链到仓库源码。`npm run clean` 只删除工作区里的 `dist` 符号链接，没有删除 `/Users/fangjiawei/sinitek/sinitek-ai-vscode-cli/dist`。下面的通过结果针对工作区本地重新编译的 `dist`。仓库里原有的 `dist` 没有在本次刷新。

- `npm run build`：通过。tsc 无错误。

- `node --test dist/test/config/cliruntimeconfigstrategies.test.js dist/test/config/configService.test.js dist/test/config/opencodeConfigService.test.js dist/test/config/configApplyQueue.test.js dist/test/extensionHost/grokCliHostWire.test.js`：59/59 通过。重构前同一组四个旧文件为 42/42；新增策略测试 10 项，外观回归 7 项。

- `node --test dist/test/config/configPaths.test.js dist/test/config/cliPageConfigCoverage.test.js dist/test/extensionHost/grokConfigModels.test.js`：20/20 通过。其中 Grok 模型测试继续 mock `configService.readGrokConfigText`，调用次数断言仍为 8。

- 未运行：`npm run test:unit`、真实 CLI、浏览器或 Extension Development Host。本任务没有 UI 或独立应用产物，浏览器验收不适用。

## 未覆盖项

- 档案复制、顺序文件和 OpenCode 校验的全部历史分支没有在本次新用例里重写。

- Linux 与 Windows 没有在本次执行机上单独跑路径测试。路径仍复用 `configPaths` 和 `userHomePaths`，本次新增了 macOS 临时目录上的 HOME / `GROK_HOME` 重载用例。

- 仓库原 `dist` 与工作区 `dist` 现在是两份构建产物。下次在仓库目录执行测试前需要重新 `npm run build`。
