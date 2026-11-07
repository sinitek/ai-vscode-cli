# 配置中心请求命令分发设计

- 日期：2026-11-07
- 状态：已实现并接线；完整构建、领域/集成回归与页面测试通过。
- 执行记录：[配置请求命令路由执行计划](../exec-plans/completed/2026-11/2026-11-07-config-request-command-routing.md)。

## 背景与选择

重构前，`src/webview/configPanel.ts` 的 `handleRequest` 通过 switch 分发 `src/webview/configProtocol.ts` 的 24 个动作，同时负责配置服务调用、Skills 交互、导出 IO、模型导入及统一异常应答。`src/test/config/cliPageConfigCoverage.test.ts` 按面板源码中的 `case` 文本检查动作覆盖，测试与实现结构耦合。当前已替换为实例级 typed registry，并以真实生产表的自有键集合和数量检查覆盖。

本次采用局部静态 Command 表与显式依赖注入，目标是隔离可独立测试的请求处理职责，保持现有可观察行为。不建立通用命令框架、基类、DI 容器、动态插件发现或第二套协议。`src/extension.ts` 虽更大，但跨域接线改造风险高；CLI 参数、模型选择、配置运行时和模型导入已有策略，不以文件大小为由重做这些边界。

本文记录当前生产依赖方向、动作边界与行为不变量。协议、配置服务及浏览器资产均未改变，不涉及 UI 设计或技术栈变更。

## 领域与事实来源

- ontology 概念：`.ch/docs/ontology/domains/cli-plugin-runtime.json` 中的 `plugin.config_profile`。配置档案是本地配置、全局 Skills 与模型设置的编辑/持久化边界；不是“配置文本推断出来的当前激活身份”。
- 产品承诺：`.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md` 的“3.8 配置中心”及 `.ch/docs/product-specs/FEATURE_INVENTORY.md`；保持激活档案写盘后等待模型刷新、Skills 安装/复制和路径边界等既有语义。
- 分层：`ARCHITECTURE.md`；面板承接 VS Code 宿主交互，配置服务承接业务与持久化，领域命令只编排既有服务。
- 协议和应答：`src/webview/configProtocol.ts`；既有业务实现：`src/config/configService.ts`、`src/config/configPaths.ts`、`src/config/cliGlobalSkills.ts`、`src/config/modelimport.ts`。
- 当前顺序和宿主细节：`src/webview/configPanel.ts`；现有回归入口：`src/test/config/cliPageConfigCoverage.test.ts`、`src/test/config/modelimport.test.ts`。

2026-11-07 按 ontology skill 查询配置档案并核对既有来源。业务概念、权限与状态语义不变；接线后在 `plugin.config_profile.source_refs` 补充本设计、router、两张领域表及生产表回归入口，作为实际实现导航，不增加新业务规则。

## 独立交付接口

两模块均已交付并由面板使用，位于扩展宿主侧而非浏览器端；只接受窄服务与交互端口，不运行时加载配置服务或 VS Code。

### 配置档案模块

- `src/webview/configRequestHandlers/profiles.ts` 导出 `createConfigProfileRequestHandlers(services, host = {})`，返回下表 12 个配置动作处理器。
- `services` 使用既有配置服务类型的窄 `Pick`，只含下表所需的 12 个服务函数；可用类型导入描述既有服务，不得运行时导入 `configService` 单例或 VS Code。平台归一复用既有 `normalizeConfigPlatform`，不复制归一规则。
- `host.onConfigChanged?: () => void | Promise<void>`；`host.getActiveConfigId?: (cli: CliName) => Promise<string | null>`。省略 host 时读写仍工作，缺省 active id 为 `null`。
- 每项 handler 的消息参数为 `Extract<ConfigRequestMessage, { action: 对应动作 }>`，第二参数为既有 `ConfigResponseMessage`，返回 `Promise<void>`。handler 按原顺序写入本次请求 response 的 `data`，不新建应答信封、不吞异常、不重建业务校验；不同请求不共享 response。

| 动作 | 既有服务与参数（按原样传入） | `response.data` | 写 data 后等待通知 |
| --- | --- | --- | --- |
| `getList` | `getConfigList(message.platform)` | 服务结果 | 否 |
| `getOrder` | `getConfigOrder(message.platform)` | 服务结果 | 否 |
| `setOrder` | `setConfigOrder(message.platform, message.order)` | `true` | 是 |
| `getById` | `getConfigById(message.platform, message.id)` | 服务结果 | 否 |
| `save` | `saveConfig(message.config)` | 原 `message.config` | 是 |
| `copy` | `copyConfig(message.payload)` | 服务结果 | 是 |
| `delete` | `deleteConfig(message.platform, message.id)` | `true` | 是 |
| `getCurrent` | `getCurrentConfig(message.platform)`，随后调用归一平台的 host | 展开 current 后追加 `activeConfigId` | 否 |
| `apply` | `applyConfig(message.platform, message.payload)` | 服务结果 | 是 |
| `backup` | `backupConfig(message.platform)` | 服务结果 | 否 |
| `getBackups` | `getBackupList(message.platform)` | 服务结果 | 否 |
| `initDefault` | `initDefaultConfig(message.platform)` | 服务结果，包括可能的 `null` | 是 |

### Skills 模块

- `src/webview/configRequestHandlers/skills.ts` 导出 `createConfigSkillRequestHandlers(services, interaction)`，返回下表 7 个 Skills 动作处理器。
- `services` 为既有服务类型的窄 `Pick`，含下表 7 个函数；不得运行时依赖 `configService` 或 VS Code，不在模块内访问网络/磁盘、不重建 ZIP、平台或路径安全校验。
- 必需交互端口固定为 `pickLocalSkillZip(): Promise<string | null>` 与 `pickSkillPlatforms(): Promise<string[] | null>`，不传 VS Code 对象。服务签名直接复用既有类型，不在此重定义载荷。
- handler 的两个参数、返回类型、原地写 data 和异常传播约定与配置档案模块相同。

| 动作 | 既有服务与参数 | `response.data` |
| --- | --- | --- |
| `getCliSkillsList` | `getCliSkillsList(message.platform)` | 服务结果 |
| `openCliSkillsDirectory` | `openCliSkillsDirectory(message.platform)` | 服务结果 |
| `deleteCliSkill` | `deleteCliSkill(message.platform, message.name)` | 服务结果 |
| `copyCliSkill` | `copyCliSkill(message.platform, message.name, message.targetPlatform)` | 服务结果 |
| `searchLobehubSkills` | `searchLobehubSkills(message.payload)` | 服务结果 |
| `installLobehubSkill` | `installLobehubSkill(message.payload)` | 服务结果 |
| `pickAndInstallLocalSkillZip` | 先选 ZIP，再选平台；`installLocalSkillZipFromPath({ platforms }, zipPath)` | 取消为 `null`，否则服务结果 |

ZIP 第一级取消时不得调用平台选择器；第二级返回 `null` 或空数组都视为取消，两级取消均不得安装。选择器拒绝或安装失败应原样向外抛出。宿主适配器保留原 ZIP 文件筛选、单文件限制、标题/提示，以及当前 ZIP 目标顺序 Claude、Codex、OpenCode、Grok、DSH、Kimi Code、ZCode；不借重构统一其它 Skills 界面的既有顺序。

## 生产面板与路由

`src/webview/configPanel.ts` 构造函数将两张领域表与五项宿主命令组合为私有 `requestHandlers: ConfigRequestHandlers`，每个面板实例只构造一次。真实服务 namespace、通知/active id host 与 VS Code 选择器以端口注入；服务和回调在调用时读取，不提前解构、不缓存结果。每次 `handleRequest` 新建独立 response，可并发执行，不全局排队。

```text
Webview bridge → ConfigManagerPanel.handleRequest（创建应答、catch、发送）
              → routeConfigRequest（安全查找、await、返回是否命中）
              → 实例 requestHandlers
                ├─ profiles / skills → 注入的 configService 方法
                └─ 五项宿主命令 → 设置读取 / 模型导入入口 / 导出 IO
```

`src/webview/configRequestRouter.ts` 的 `ConfigRequestHandlers` 将 `ConfigAction` 映射为对应 `Extract` 请求与既有 response，允许同步或异步 handler。联合索引的受限断言只存在于分发边界；生产表不使用 `any`。router 先检查 action 为字符串，再检查自有键，不对 action 对象做字符串强制转换，错误原样交给面板。

完整 registry 为 12 个配置动作 + 7 个 Skills 动作 + 以下 5 个宿主动作，正好覆盖 `CONFIG_ACTIONS` 的 24 键：

| 宿主动作 | 保持的处理边界 |
| --- | --- |
| `exportConfigs` | 既有文件名处理、文件系统写入和日志 |
| `getCliEnabled` | 请求时读取 `readToolSettings()`，按既有方式归一，缺省 `{}` |
| `getModelImportProviders` | 原样传 `message.payload`，使用既有同步服务结果 |
| `discoverImportModels` | 原样传 `message.payload`，等待既有服务 |
| `applyModelImport` | 原样传 `message.payload`，等待既有服务 |

registry 的类型按 `ConfigAction` 映射到各自消息的 `Extract` handler，构造处做编译期穷尽检查；新增/删除协议动作而不更新生产表应不能编译。运行时必须做自有键检查（或等价的无原型安全查找），未知动作、`toString`、`constructor`、`__proto__` 等继承键不得执行。静态类型不能替代这条运行时保护，也不扩展成新一套入参业务验证。

面板继续唯一负责 response 初始化、统一 catch、apply 专用错误提示，以及“当前 panel 存在才 postMessage”的发送行为。router 只选择并等待 handler，不接管服务、UI 或持久化。

## 行为不变量

1. **协议与异常**：保留 `config:request` / `config:response`、原 `requestId`、初始 `success: true`、可选 data/error 结构；服务参数、返回 data、`buildErrorDetail(error)` 的异常详情保持。未知动作仍返回 `success: false` 与 `t("config.unknownRequest")`，不执行任何命令。
2. **写操作顺序**：仅 `setOrder`、`save`、`copy`、`delete`、`apply`、`initDefault` 六种动作执行“await 服务成功 → 写 data → await 可选 onConfigChanged”。服务失败不写成功 data、不通知；通知失败交给统一 catch，已写 data 必须保留，不回滚、不删除，不能提前返回成功。`backup` 不新增通知。
3. **激活身份**：`getCurrentConfig` 先收原 platform；之后仅 host 收 `normalizeConfigPlatform(message.platform)`，将 host 结果或缺省 `null` 追加为 `activeConfigId`，覆盖 current 同名字段。不得从配置文本、文件路径或缓存猜测，也不得把归一后的值提前替换所有服务参数。
4. **Skills 取消与错误**：ZIP 两级选择顺序不变；取消写 `null` 且无安装；成功安装的参数顺序、平台数组与返回结果不变。错误只由既有异常边界处理。
5. **apply 提示**：任何 `apply` 异常（包括通知失败）仍由外层设置失败应答，并 `void showErrorWithActions(t("config.applyFailedTitle"), error, { detailTitle: t("config.applyFailedTitle") })`；其他动作不新增该专用提示。
6. **导出 IO**：保留现有 payload/content 类型检查，不额外禁止空字符串；文件名先 `path.basename` 再用既有规则替换非法字符，缺省时间戳文件名及大小写敏感的 `.json` 后缀处理不变。递归创建 Downloads 失败才回退 home；UTF-8 写入失败不新增回退或重试；成功后 data 仍为 `{ path, fileName, downloadsDir }`，随后保留 `void logEssential("config-export", { path })`。
7. **范围隔离**：不改 HTML、CSS、主题、文案、布局、交互、网络策略、路径安全、配置服务校验与持久化契约；不新增重复 IO，不引入用户可见能力或发布动作。

## 验证契约与交接

- 配置模块独立测试：覆盖全部 12 键、服务参数/结果、六种写操作时序、服务失败不通知、通知失败保留 data、可选 host、归一平台 active id 及 host 异常；不依赖真实用户配置或 VS Code。
- Skills 模块独立测试：覆盖全部 7 键、参数/结果、ZIP 两级取消与空平台、选择器/服务异常、正常安装调用顺序；不得访问真实网络或安装目录。
- 集成测试：执行真实生产 registry，与 `CONFIG_ACTIONS` 比较自有键集合和数量，替代要求面板 `case` 文本的正则断言；仍保留 Webview bridge/协议一致性断言。测试不能只比较另造的一份动作清单。
- 集成回归：24 动作分发、requestId/data/error、未知/原型键、apply 专用提示、导出清理/后缀/目录创建失败回退/UTF-8 写入/日志、panel 缺失、通知等待和 CLI enabled 动态读取。编译检查穷尽性和消息类型关联，不以运行时键数代替类型检查。
- 接线后实际串行执行 `npm run build`、六文件相关回归（213/213）与 `npm run test:page`（含再次 build，433/433）；具体命令、日志和未运行项见执行计划。不使用接线前基线替代验收；未运行发布脚本或浏览器 smoke，本次没有 UI 改动。

## 如何增加动作

1. 在既有 `configProtocol.ts` 的请求联合与 `CONFIG_ACTIONS` 增加动作，不创建另一张业务动作白名单。
2. 按职责在 profiles/skills 增加窄服务与对应 `Extract` handler，或在面板补充确属宿主的命令；保持错误交给面板、响应不跨请求共享。
3. 构建检查生产 registry 完整性；缺少动作、错误请求字段或不匹配的 handler 签名应报类型错误。
4. 增加内存领域测试和必要面板行为回归。真实 registry 自有键与 `CONFIG_ACTIONS` 的集合/数量断言会发现漏接或多接；bridge 一致性断言继续保留。
5. 串行执行 build、相关测试和按风险选择的页面测试，更新本设计及必要事实来源。

可验证收益：两领域模块可脱离 VS Code、真实文件和网络独立测试；router 可单测异步等待、错误传播、原型键和无强制转换；面板测试直接验证生产表而不依赖 switch 文本。无需增加框架或重复业务规则即可定位分发、领域编排和宿主边界的回归。

## 文档治理与回滚

此次是纯内部行为保持重构，未改变功能、权限、流程或用户承诺，因此 `FEATURE_INVENTORY.md` 无需修改。配置档案概念、关系与业务规则不变；`ARCHITECTURE.md` 增加简短导航，ontology 仅补实际来源路径，不改变语义。

回滚仅撤回本次命令抽取/接线与相应结构断言迁移，恢复原 switch 入口；不迁移数据、不回滚用户文件、不改协议。不覆盖其他并行任务修改，不写热区记忆或 `ROLLING_SUMMARY.md`；执行计划在全部验收和文档校验通过后归档。
