# VS Code CLI 运行时：配置模型与 Tab 任务摘要边界

- 状态：配置模型仓储已实施，行为保持不变；Tab 任务摘要已实现并经主审，验证边界见下文
- 更新日期：2026-11-07
- 事实来源：`src/extensionHost/modelSettings.ts`、`src/config/configuredModelRepository.ts`、`src/extensionHost/cliModelSelectionStrategies.ts`

## 对话 Markdown 链接边界

`chatMarkdown.ts` 用共享的 `normalizeChatLinkSource` 校验链接并渲染带 `data-chat-link` 的锚点；普通消息区与群聊点击委托发送 `openChatLink`，阻止 Webview 默认导航。图片按钮及下载已处理的点击不再触发外围链接。`viewProvider.ts` 和 `loopGroupChatPanel.ts` 在业务消息路由前调用 `chatLinkHost.ts`；打开操作只由点击触发，宿主重复校验来源。

本地路径复用现有图片资源路径解析（首个工作区、home、file URI、Windows/UNC），不复制另一套平台规则；允许 sandbox 绝对路径，但不为缺失文件猜测映射。宿主检查存在性后分流图片预览、Markdown 内置预览、目录定位和 `vscode.open` 默认/扩展编辑器；代码位置转换为零基 selection，其他片段保留。HTTP(S) 仅用 `env.openExternal`，禁止任意命令或脚本协议。PDF/Office 的可视化依赖已安装的预览扩展，无法打开时给出中文提示及需要用户显式选择的系统打开方式，不引入新依赖或在 Webview 执行文档脚本。

PDF/Office 在打开前检查已安装扩展的 `contributes.customEditors` 文件类型声明，命中后通过 `vscode.openWith` 打开对应预览器；没有预览器时直接显示选择打开方式、系统应用或查找预览扩展的中文恢复入口，避免默认二进制文本编辑器虽然返回成功却无法预览的假成功。

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

上述配置模型仓储变更无 UI、样式、交互或消息协议变更，无需更新 FEATURE_INVENTORY；该部分浏览器/VS Code 可视化验证不适用。自动行为证据位于仓储测试和宿主选择策略测试；完整命令、结果和未验证项见 `.ch/docs/exec-plans/completed/2026-11/2026-11-06-configured-model-repository.md`。

## Tab 任务摘要（已实现）

### 事实来源与边界

`src/extension.ts` 捕获首次提交并接入摘要协调器，`src/conversationTaskSummary.ts` 承载归纳提示、结果归一化和有界队列，`src/extensionHost/conversationTaskSummary.ts` 捕获配置快照并执行隔离调用。`src/webview/types.ts` 的 `ConversationTabSummary` 投影给 `src/webview/viewContentScript/messageRendering.ts` 的 `renderConversationTabs`；Tab、会话保存与绑定由 `src/sessionTabs.ts`、`src/sessionStore.ts`、`src/sessionLifecycle.ts`、`src/workspaceSettingsStore.ts` 及既有宿主 `src/extensionHost/sessionTabs.ts` 承接。原 `preparePendingLabel` 提示词标签行为保留，不等于 AI 摘要。用户行为见能力分册 §3.4；原先待实现阶段已在验收后收口，过程和证据见 `.ch/docs/exec-plans/completed/2026-11/2026-11-07-conversation-tab-summary.md`。

### 数据与首次触发

- 对外只增加可选 `ConversationTabSummary.taskSummary?: string`。归一化折叠空白，校验汉字与纯文本，拒绝空白、超限、思考/工具标记和无效输出；以 `Array.from` 限制最多 30 个 Unicode 码点，不破坏非 BMP 字符。提示要求简体中文，但未做确定性繁简转换。旧记录缺字段兼容，无生成中/失败占位。
- 首次用户可见需求在 Loop 协议改写和 local session 接管前通过 WeakMap 保存；共同 `runPrompt` 在取得实际配置执行租约后安排独立非阻塞调用，捕获实际模型、思考/variant、命令、参数、环境与 provider 配置快照。主任务不等待摘要结束。`taskSummaryAttempted` 随 Tab/草稿/会话保存，失败、超时和溢出也消费一次尝试；空白 Tab、后续消息、hover、刷新与旧历史恢复不补生成或重试。
- 摘要是任务/会话元信息，不写入用户消息、回放、任务记录或 Loop 协议。草稿、会话保存、状态投影和 local/native 绑定（包括目标 session 已存在时）保留摘要与尝试状态，重载/历史重开恢复元信息，不从当前活动 Tab 猜测归属。

### 生命周期与失败降级

- 请求捕获工作区、准确 Tab 对象、草稿对象与唯一请求代际；写回和执行前检查有效性，活动请求每 100 毫秒检查身份。关闭、重置、工作区切换后丢弃迟到结果，重置后立即提交的新请求不与旧请求冲突；原生绑定迁移仍写入同一任务当前绑定的 session。
- 队列并发 2、总容量 32（含活动与待执行），活动调用超时 20 秒；输入最多 6000 码点、助手输出最多 4096 个 UTF-16 单元，OpenCode 结构流另限 128 KiB。失败/超时/溢出不重试；取消、清理和扩展退出释放 runner/进程、计时器和隔离临时目录。
- 七种 CLI 复用现有 runner/配置助手，以独立 session 和受限权限执行，不续接原 thread、不执行原任务工具。Codex/Grok/DSH/Kimi/ZCode 使用原生 app-server/ACP，Claude 使用 SDK，OpenCode 使用已验证的 `run --format json`，不新增手写 HTTP 或服务。`src/cli/cliRunArgStrategies.ts` 对 DSH/Kimi/ZCode 的 one-shot prompt 禁令保持；不可用或无效结果仅摘要缺失，不影响主任务、不回落提示词截断。

### UI 消费与验证边界

前端只消费字段，不因 hover 或焦点发起 AI。鼠标连续停留或键盘聚焦 1000 毫秒后显示一段正文的轻量浮层；离开/失焦、选择/切换、关闭、分页和 Escape 均清理计时并隐藏。单一 body 级浮层以 `textContent`、`role="tooltip"` 和 `aria-describedby` 安全展示，沿用 `.header-hover-tooltip` 主题语义；重绘保留有效停留时间/焦点，窄视口换行、边界钳制及向上翻转不越界。无摘要、生成中、失败无占位；原 Tab 尺寸、分页、运行/错误状态、角色和关闭行为不变，无新增配置、语言包或开关。

运行时与 UI 护栏分别在 `src/test/session/conversationTaskSummary.test.ts`、会话存储/生命周期回归及 `src/test/webview/conversationtabsummarytooltip.test.ts`。主审合并代码构建与相关测试 299/299；真实隔离 Codex 调用生成 22 码点摘要，6348 毫秒并清除临时目录；完整生成 Webview 在 960×720、280×640 与深浅主题四组合通过 Chromium 验证，另有 UI 相关 41/41 回归（与主审测试重叠，不相加）。其余六种 CLI 未做真实 provider 调用，没有完整 VS Code 扩展宿主端到端、确定性繁简转换或无关全量测试。原始材料和具体命令见归档计划；本次收口只复核证据并做文档/本体检查，不重建 `dist` 或重新调用真实 CLI。
