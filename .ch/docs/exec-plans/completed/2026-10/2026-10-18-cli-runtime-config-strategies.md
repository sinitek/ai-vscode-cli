# CLI 运行配置策略化

- 日期：2026-10-18
- 状态：completed
- 负责人：协作
- owner：Loop attempt round-1-refactor-cli-runtime-config-strategies
- claimed_at：2026-10-18
- claim_ttl：本次尝试
- handoff_to：无

## 背景

`src/config/configService.ts` 同时负责档案存储、复制、校验和四个 CLI 的运行配置。`getCurrentConfig`、`applyConfig`、`backupConfig`、`initDefaultConfig` 里重复出现 Claude、Codex、OpenCode、Grok 分支。后续改一个平台时缺少单独入口。

## 目标

用策略注册表集中平台运行配置行为，`configService` 保留兼容外观。用户可见行为、磁盘 schema 和既有导出不变。

## 范围

- 新增 `src/config/cliRuntimeConfigStrategies.ts`。
- `configService` 在组合处注入原有低层读取、写入、备份函数，并把上述四个入口委托给策略。
- 为策略和外观补行为回归测试。
- 只更新 `ARCHITECTURE.md` 的配置服务小段。

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
- 文档目录：`ARCHITECTURE.md`、本计划。
- 配置与脚本：无。

## 风险与缓解

- 风险：策略模块被 Node 缓存后仍夹住旧路径。缓解：策略不读取路径；IO 由每次重新加载的 `configService` 注入。回归覆盖 HOME 变更后的重新加载。
- 风险：把 apply 的内容优先级误用到档案保存。缓解：`saveConfig` 仍使用 `configContent ?? content`，并保留原有 Codex 档案测试。
- 回滚：删除新策略模块，把四个入口的平台分支放回 `configService`。无数据迁移。

## 验证计划

- 最小相关验证：`npm run build`，再运行新增策略测试和原配置四文件。
- 扩展验证：路径、配置页服务调用、Grok `readGrokConfigText` mock。
- 不适用：真实 CLI、浏览器、全量 `npm run test:unit`。

## 测试与清单同步

- 单元测试新增：`src/test/config/cliruntimeconfigstrategies.test.ts`；`src/test/config/configService.test.ts` 增加外观集成。
- 单元自测结果：见下方最终验证。
- 失败处理记录：第一次相关测试 58 通过、1 失败。失败点是备份夹具在创建 `GROK_HOME` 目录前写 `config.toml`，错误为 `ENOENT`。分类为夹具问题。补 `mkdir` 后重跑，未放宽产品断言。
- 功能清单：已核对 `.ch/docs/product-specs/FEATURE_INVENTORY.md`。本次只重排内部入口，用户可见配置行为不变，不修改功能清单，也不修改 i18n。
- ontology：任务前 `search_ontology.py --status-report` 为 ready。`plugin.config_profile` 仍描述四个 CLI 的档案、路径和运行配置外观。实现没有改变概念、所有权、状态或跨域场景，外观事实来源仍然有效，因此不修改 ontology。未改 ontology 文件，所以没有重跑 ontology validate。
- 相关文档同步：只更新架构里的配置服务段。不修复 `.ch/docs/design-docs/` 历史失效链接，不扩写长期记忆。

## 任务列表

- [x] 抽出四个平台的运行配置策略和 IO 端口
- [x] 让外观委托策略并保留低层函数
- [x] 补行为测试、构建并记录结果

## 决策记录

- 2026-10-18：采用显式策略注册表，而不是继承或 DI 容器。备份文件名和字节仍由现有 `backupClaudeConfig`、`backupCodexConfig`、`backupOpenCodeConfig`、`backupGrokConfig` 实现，策略只接收这些函数作为端口，避免第二套备份实现。
- 2026-10-18：`getBackupList`、档案复制和档案字段归一继续留在 `configService`。它们不是这次要移走的四条运行配置链路。

## 当前结论

策略注册表已经承接四个平台的读取、应用、备份和默认档案字段。`configService` 仍是外部消费者使用的外观。指定测试已通过。全量单元、真实 CLI 和浏览器验收未执行。

## 最终验证

工作目录是 Loop 工作区。`src` 链到仓库源码。`npm run clean` 只删除工作区里的 `dist` 符号链接，没有删除 `/Users/fangjiawei/sinitek/sinitek-ai-vscode-cli/dist`。下面的通过结果针对工作区本地重新编译的 `dist`。仓库里原有的 `dist` 没有在本次刷新。

- `npm run build`：通过。tsc 无错误。
- `node --test dist/test/config/cliruntimeconfigstrategies.test.js dist/test/config/configService.test.js dist/test/config/opencodeConfigService.test.js dist/test/config/configApplyQueue.test.js dist/test/extensionHost/grokCliHostWire.test.js`：59/59 通过。重构前同一组四个旧文件为 42/42；新增策略测试 10 项，外观回归 7 项。
- `node --test dist/test/config/configPaths.test.js dist/test/config/cliPageConfigCoverage.test.js dist/test/extensionHost/grokConfigModels.test.js`：20/20 通过。其中 Grok 模型测试继续 mock `configService.readGrokConfigText`，调用次数断言仍为 8。
- 未运行：`npm run test:unit`、真实 CLI、浏览器或 Extension Development Host。本任务没有 UI 或独立应用产物，浏览器验收不适用。

## 未覆盖项

- 档案复制、顺序文件和 OpenCode 校验的全部历史分支没有在本次新用例里重写；原有 `configService` 与 OpenCode 测试仍覆盖其中一部分。
- Linux 与 Windows 没有在本次执行机上单独跑路径测试。路径仍复用 `configPaths` 和 `userHomePaths`，本次新增了 macOS 临时目录上的 HOME / `GROK_HOME` 重载用例。
- 仓库原 `dist` 与工作区 `dist` 现在是两份构建产物。下次在仓库目录执行测试前需要重新 `npm run build`。
