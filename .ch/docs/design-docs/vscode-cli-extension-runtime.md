# VS Code CLI 运行时：配置模型数据访问边界

- 状态：已实施，行为保持不变
- 更新日期：2026-11-06
- 事实来源：`src/extensionHost/modelSettings.ts`、`src/config/configuredModelRepository.ts`、`src/extensionHost/cliModelSelectionStrategies.ts`

## 分工与设计选择

`ConfiguredModelRepository` 是小型、显式、实例级 Repository，不是新的选择策略框架。原宿主混合了配置 I/O、解析、五类缓存、异常降级和选择/角色编排；现在前四项归仓储，后者继续归宿主与已有策略。五个 Map 只有一份，按原来的 `string | null` 档案键分开存储，各宿主创建独立仓储。`undefined` 仍表示没有指定/未加载，不等价于合法的 `null` 原生配置缓存键。

仓储的 `ConfiguredModelReadPort` 从 ConfigService 的真实返回签名提炼 `content` / `configContent`，只暴露当前配置、DSH 档案和 Grok 原生 TOML 三个读取能力。`configService` 只作 type-only 引用；运行时读取函数和非等待式错误报告函数由宿主注入。不传全量宿主 deps，不引入配置单例、VS Code、Webview 或 extension 组合根。保存、路径规范化、互斥/租约、配置应用与凭据处理仍属于既有服务。

宿主保留 `loadedConfigStates`、`activeWorkspaceKey`、`resolveConfigModelId`、`getActiveConfigIdForCli` 和 `syncFromDeps` / `syncToDeps` / `wrap`。选择策略持有的 getter 每次读取仓储的最新值，不能在创建策略时捕获快照。原公开方法和签名不变；Grok/DSH/Kimi 显式缓存入口以及 Kimi 编辑后的解析都写入这一仓储。

## 刷新契约

`refreshConfigModels` 先记录全部 CLI 的配置身份与偏好，再以原有 `Promise.all` 顺序并发刷新 Codex、Grok、Kimi Code、ZCode、DSH。每个刷新入口在读取前确定 configId；已处理的单 CLI 读取失败不会阻止其它 CLI 更新。

| CLI | 读取源与字段顺序 | 读取失败缓存 |
| --- | --- | --- |
| Codex | `getCurrentConfig("codex")`，`configContent ?? content ?? ""` | `null` |
| Grok | `readGrokConfigText()`，不按档案内容替代 | 空 models/labels、defaultModel null、error |
| DSH | 有 configId 用 `getConfigById("dsh", id)`，否则当前配置；`content ?? configContent ?? ""` | 同上，另有空 `wireByModelId` / `reasoningOptionsByModelId` |
| Kimi Code | 当前配置的 `content ?? ""` | 同上，另有 `thinkingEffort: null` / `permissionMode: null` |
| ZCode | 当前配置的 `content ?? ""` | 空 models/labels、defaultModel null、error |

所有失败都替换旧缓存，不保留过期模型。DSH 缺失档案仍产生 `DSH profile was not found.` 的空模型状态，不回落当前配置。各 CLI 原错误事件名、Error 空消息格式化和不等待日志的语义保留；解析器返回错误状态不伪造读取失败日志。

## 运行前新鲜读取与时序

- DSH：宿主在读取前解析激活 configId，以值传入仓储。无激活档案、档案不存在、解析失败、无可执行选择仍失败，不回落其它 CLI 或缓存。解析后先写原 configId 缓存，再校验/resolve；wire 仍由 `readDshModelWireForRun` 验证并编码为原 provider tuple。
- Grok / Kimi Code：每次执行重新读取当前配置，解析错误先抛出，不修改旧缓存，也不获取缓存身份。成功解析后才调用宿主传入的最小 `getActiveConfigId` 回调并写缓存，然后校验是否有模型。Grok 使用原配置模型 ID；Kimi 的 ACP model 仍是别名，不是 provider model 名。
- ZCode：每次执行重新读取当前 `content`，读取后才调用身份回调；先将 `readZcodeConfigModels` 结果写缓存，再调用原生 wire resolver，因此解析错误也会更新错误缓存后再抛出。保留原有 wire/reasoning 编码。
- 所有运行读取异常原样传播，不增加刷新日志；不改变 Claude/OpenCode、模型显示名/选择键、Loop 回退、档案隔离或推理力度规则。

## 可维护性、安全与性能

配置数据契约集中在约 175 行无宿主副作用的模块，可直接用注入端口测试成功、错误和时序；宿主不再维护平行缓存。复用现有 parser/resolve，不复制模型规则，不使用 any 或通用注册框架。

仓储不解析路径、不开文件、不写配置、不读环境凭据；读取能力仍只由 ConfigService 承载。错误端口只接收既有事件与 `{ error }`，不新增配置内容或密钥日志。不新增网络、锁、定时器或额外缓存层，刷新及运行读取次数保持原样；Map 数量和键生命周期与原宿主相同，原缓存未设淘汰，本次不另增无界层。

无 UI、样式、交互或消息协议变更，FEATURE_INVENTORY 无需更新；浏览器/VS Code 可视化验证不适用。自动行为证据位于仓储测试和宿主选择策略测试；完整命令、结果和未验证项见 `.ch/docs/exec-plans/completed/2026-11/2026-11-06-configured-model-repository.md`。
