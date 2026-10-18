# Grok 流式错误与多模型主从编辑器

- 日期：2026-10-18
- 状态：completed
- 负责人：Codex

## 目标与范围

- 排查 Grok 使用 GPT 模型时正文出现后仍报错的真实链路，修正实际模型配置并保留真实错误，不把部分回复伪装成成功。
- 配置可视化改为左侧模型列表、右侧当前模型参数；新增模型从当前模型复制所有参数，仅替换 `model` 与 `name`，没有当前模型时回退默认/首项，再回退空模板。
- 保留未知字段、主题语义色、现有模型刷新与档案隔离。不升级依赖，不改其他 CLI 的交互。

## 事实与决策

- 2026-10-18 00:12（北京时间）本机 GPT 会话的 `updates.jsonl` 记录 `serialization error: unknown variant response.metadata`，`events.jsonl` 为 `turn_ended/outcome=error`；插件消息存档已出现正文，随后显示笼统的 `Internal error` 并自动重试。
- 当前正式 `gpt-6.1-sol` 配置仍为 `api_backend=responses`。本次只在确认 Chat Completions 真实调用成功后修正该模型协议，并同步包含该模型的有效档案，保留原配置备份，不更改密钥或其他模型。
- 修复运行器丢弃错误细节的问题；确定性的流协议不兼容不应按中断反复重试。其余错误保持既有重试策略。

## 验收标准

- 重现/断言“正文后 RPC error”仍报告失败，展示明确的协议兼容原因而非 `Internal error`，且不触发无效重试。
- 使用真实 `gpt-6.1-sol` 完成两轮短回复并收到成功 stopReason，正式配置与档案修正一致；不记录凭据。
- 左右布局模型列表可选择，右侧参数随选择变化；新增复制连接、凭据、协议及隐藏嵌套参数且不与原模型共享对象；仅覆盖 `model/name`。
- 新增、删除、默认引用、非法输入、TOML 往返与桌面/窄屏浏览器验证通过。

## 验证计划与影响面

- `src/interactive/grokRunner.ts`、Grok 协议/相关单测与 `src/extensionHost/promptInteractiveRuntime.ts` 的重试分流。
- `media/config/assets/config-app-ui.js` 及已有样式文件、配置页单测。
- `npm run build`，相关单元、页面测试、真实 CLI/ACP、headless Chromium，ontology 校验。
- 更新功能清单、能力说明、CLI runtime reference、Grok runbook 与 ontology；既有四项单测失败、十五项 ontology 缺失引用按基线分类，不扩大修复。

## 风险与回滚

- 复制模型会复制用户明确要求的凭据参数，仅留在原有配置存储边界，不进入仓库/日志。
- 临时真实验证使用独立 `GROK_HOME` 并清理；正式配置修正前保存仓库外备份，失败可恢复。
- 保留上一任务所有未提交改动及并行 `package.json` 版本变更，不提交、不建分支。

## 进展与验证结果

- 已使用 memory-recall（focus 为 Grok ACP 与多模型、anchor 为空）和 ontology 核对当前来源；CodeGraph 未索引新增 Grok 文件，已回退直接读取。
- 根因复现：以当前正式配置的隔离副本调用真实 Grok，ACP 错误为 `-32603`、`message=Internal error`，`error.data` 明确为不支持 `response.metadata`。真实会话的失败通知也有同样错误，正文分片并不意味着完整成功。
- 运行修复：增加 `buildGrokRequestError` 与失败通知读取；仅对不支持的 Responses 事件生成 `GROK_RESPONSES_STREAM_INCOMPATIBLE`，提示模型名、事件与协议修复方式。宿主停止确定性协议错误的自动重试，runner 失败后不可复用。其他错误沿用原策略，不展示任意 RPC 私有数据、不吞错或伪造成功。
- 本机修复：先以 `chat_completions` 的临时副本验证两轮 `end_turn`，再仅将正式 `gpt-6.1-sol` 的 `api_backend` 改为 `chat_completions`，并同步对应档案 `configContent/content`。配置与档案原文备份在本机 `~/.grok/protocol-backup-2026-10-18/`，目录权限 0700、备份文件 0600。语义比较确认其他模型与所有其他字段不变，凭据未更改、未写入仓库。
- 修正后的实际配置隔离副本再次连续两轮返回 `GROK_FOLLOWUP_ONE_OK`、`GROK_FOLLOWUP_TWO_OK`，两次均为 `end_turn`。临时 `GROK_HOME` 在 CLI 退出后已清理，不触碰用户真实会话。
- UI 完成：左侧模型列表、右侧参数与全局默认；窄屏仍维持左右布局。新增深拷贝当前模型全部字段及嵌套参数，仅替换 `model/name`，支持默认/首项与空模板回退。选择、编辑、删除、默认引用、非法输入与隐藏字段保留遵循原有约束；新增说明明确复制来源。
- 新增回归涵盖：实际错误数据/失败通知、部分正文后失败不调用完成、故障 runner 淘汰、宿主仅一次尝试、其他网络错误维持可重试；模型深拷贝和凭据/未知嵌套字段复制、原项隔离、左右结构及无切换下拉。
- `npm run build`、`node --check media/config/assets/config-app-ui.js`、`git diff --check`：通过。
- 相关测试命令：`node --test dist/test/interactive/grokAppServerProtocol.test.js dist/test/interactive/grokRunner.test.js dist/test/interactive/grokReplayStream.test.js dist/test/core/panelDiagnostics.test.js dist/test/config/grokConfigPage.test.js dist/test/config/grokConfigMapping.test.js dist/test/extensionHost/grokConfigModels.test.js dist/test/extensionHost/grokCliHostWire.test.js dist/test/webview/grokmodelselection.test.js`，84/84 通过。
- `npm run test:page`：242/242 通过。首次发现已有页面测试把整个编辑器禁止 `aria-pressed` 当作模式切换约束；新模型列表合法使用该属性表达选中，已把断言缩小到原有模式切换区域，新模型列表状态另有回归覆盖。
- `node scripts/run_unit_tests.js`：1573 项，1569 通过、4 项历史失败；仍为上一任务经 HEAD 独立源码复现的 `cliCommandRepair.test.ts` 三项旧 CLI 数量断言和 `grokCliEnum.test.ts` 一项全页 option 数量断言，无新增失败。
- Chromium 使用真实配置页 HTML/资源与无密钥 IPC 夹具：新增、列表选中与参数修改、复制协议/连接/测试凭据/隐藏嵌套字段、设默认、删除确认、重复名称拒绝及保存 TOML 均通过。1440px 与 390px 几何断言和截图复核通过；结构化 smoke 无浏览器、HTTP 或请求错误。Impeccable detector 一次执行结果为 `[]`。
- `python3 .agents/skills/ontology/scripts/search_ontology.py --validate`：仍为原有 15 个缺失设计文档引用，无新增问题；`python3 -m unittest discover -s .agents/skills/ontology/tests -p 'test_*.py'` 为 8/9 通过，唯一失败即当前 ontology 完整性断言，根因同上，未扩大修复。
- 已同步功能清单、能力说明、CLI runtime reference、ontology 与 Grok runbook。无新架构边界，无需改 `ARCHITECTURE.md`；稳定经验已进入 runbook，不重复追加事件记忆或滚动摘要。

## 证据与收尾

- 本机日志证据：`/tmp/sinitek-grok-followup-responses.log`、`/tmp/sinitek-grok-followup-chat.log`、`/tmp/sinitek-grok-followup-fixed.log`、`/tmp/sinitek-grok-followup-build.log`、`/tmp/sinitek-grok-followup-focused.log`、`/tmp/sinitek-grok-followup-page.log`、`/tmp/sinitek-grok-followup-all-tests.log`、`/tmp/sinitek-grok-followup-ontology.log`、`/tmp/sinitek-grok-followup-ontology-tests.log`。
- 浏览器证据：`/tmp/sinitek-grok-followup-smoke/result.json`、`interaction-result.json` 与桌面/窄屏截图；均仅含本任务夹具，不含用户凭据，不纳入仓库。
- 未提交或创建分支；保留前次任务与并行版本变更。收尾停止预览服务、清理任务脚本与场景，保留无密钥日志和截图以及用户配置备份。
- 未打包安装新插件或操作用户 VS Code 窗口。代码加载后重载窗口并新建 Grok 会话，以避免旧进程/旧会话继续使用已缓存的协议。新增模型按用户要求原样继承协议，不会按名称强行改为其他协议。

## 追加验收：模型下拉显示字段（2026-10-18）

- 按用户补充要求，普通及 Loop/Loop+/Graph 主从下拉改为显示每项配置的 `model`，不使用 `name`；缺失、空白或非字符串时回退配置表键。内部选择值与 `--model` 保持配置表键，避免同名 API 模型的不同连接被合并或误选。
- 解析器输出独立标签映射，经宿主 `labelsByCli` 传给 Webview；刷新、档案隔离、空配置清理与暂态快照保留同步处理标签。不改运行器或用户配置，无新增文案，无需新增 i18n 键。
- `npm run build` 通过；首次新增测试的类型断言换行导致 TS1005，已修正并重跑通过。`node --test dist/test/cli/grokConfigModels.test.js dist/test/extensionHost/grokConfigModels.test.js dist/test/extensionHost/grokCliHostWire.test.js dist/test/webview/grokmodelselection.test.js dist/test/webview/codexdualmodelwebview.test.js` 为 29/29 通过；`npm run test:page` 为 242/242 通过；`git diff --check` 通过。
- Chromium 使用真实下拉渲染函数和状态处理函数的隔离夹具，验证普通/主/子显示、相同模型名保留独立配置键、选择与刷新；并只读解析本机实际配置，逐项校验 DOM 显示映射，未写配置、未发起付费模型调用。结构化 smoke 通过，无浏览器、HTTP 或请求错误；这不是完整 VS Code 宿主验收。
- 证据：`/tmp/sinitek-grok-model-label-{build,tests,page,ontology,ontology-tests,smoke}.log`、`/tmp/sinitek-grok-model-label-smoke/result.json` 与 `success.png`。临时预览端口 19389 已停止，任务脚本及场景已删除。
- 已同步功能清单、能力说明、runtime reference、runbook 与 ontology；ontology 验证仍为前述 15 处既有失效引用，ontology 测试仍为 8/9，未新增失败。未重跑全量运行时单测；本次未改变 CLI 调用协议或架构边界，不重复创建记忆记录。

## 追加验收：移除刷新图标并在保存后同步（2026-10-18）

- 用户要求替代前两轮的手动刷新交互：移除模型下拉左侧 SVG、元素绑定、点击监听、移动逻辑、专用布局样式和废弃文案；普通与主从下拉均不保留占位。
- CodeGraph 定位配置中心 `onConfigChanged` 与面板推送链路，当前文件 stale 后直接核对源码。根因是 `save` 仅保存档案并触发未等待的通知，激活配置随后 `apply` 写盘却未触发通知，模型候选可能仍来自旧文件。
- `ConfigManagerPanel` 的变更回调支持 `void | Promise<void>`，保存、应用及其他既有变更通知均等待完成；成功应用到磁盘后才通知，扩展回调返回 `postPanelState()` 的 Promise。继续保留未激活档案不自动应用、应用失败不伪造更新的语义，不修改用户实际配置。
- 新回归在临时 `GROK_HOME` 中执行真实档案保存和配置应用，以阻塞屏障验证模型同步结束前没有成功应答；同步后读取 `sol → gpt-6.1-sol`，失败应用不增加通知且不覆盖有效配置。普通/Loop/Loop+/Graph 原有行切换和标签显示回归保留，并断言刷新 DOM、脚本绑定和样式均已移除。
- `npm run build` 通过；新增测试最初的回调返回类型推断与消息 unknown 类型导致构建失败，已显式声明回调类型、收窄响应并重跑通过。相关测试命令 `node --test dist/test/cli/grokConfigModels.test.js dist/test/extensionHost/grokConfigModels.test.js dist/test/extensionHost/grokCliHostWire.test.js dist/test/webview/grokmodelselection.test.js dist/test/webview/codexdualmodelwebview.test.js dist/test/config/cliPageConfigCoverage.test.js` 为 47/47 通过，`npm run test:page` 为 243/243 通过，`git diff --check` 通过。
- Chromium 使用真实静态对话 HTML、样式、模型状态/渲染函数，以及真实 `ConfigManagerPanel` 保存/应用和隔离磁盘配置的 IPC 夹具：点击保存后无需刷新即可显示新模型，普通及主从候选更新、旧项清除、切换 Loop/Loop+/Graph 无刷新按钮，结构化 smoke 通过；无浏览器、HTTP 或请求错误，截图已复核。这不是完整 VS Code 宿主验收，没有发起真实付费模型调用。
- 证据：`/tmp/sinitek-grok-save-sync-{build,focused,related,page,ontology,ontology-tests,smoke}.log`、`/tmp/sinitek-grok-save-sync-smoke/result.json` 与 `success.png`。Impeccable detector 对本轮 UI 目标执行一次为 `[]`。预览端口 19390 已停止，临时 `GROK_HOME`、脚本和场景已清理。
- 已同步能力清单、runtime reference、runbook 与 ontology，前述手动刷新描述以本节为准。Ontology 仍为 15 处既有失效来源引用、测试 8/9，未扩大修复；本轮未重跑全量运行时测试。无新架构边界，无需改 `ARCHITECTURE.md`；保存时序经验归入 runbook，不新增重复热区记忆。未打包安装或重载用户窗口，保留全部既有修改与并行版本变更。

## 追加验收：单名称新增弹窗与列表行内删除（2026-10-18）

- 按用户最新要求，列表标题旁的“新增”只打开一个模型名称输入框；使用项目现有 Modal，自动聚焦，空值禁用确认，支持回车并保护中文输入法组词。重名或无效名称在弹窗内提示，取消或 Escape 不新增，切换档案时关闭并清空草稿。
- 确认后沿用原深拷贝逻辑，仅将 `model`、`name` 和配置表键设为输入名称（首尾去空白），选中新项并在右侧编辑。连接、协议、凭据、未知字段和嵌套参数全部保留，复制对象不与原项共享。
- 侧栏不再常驻新增输入区或“删除当前模型”按钮；每行名称右侧复用已有删除 SVG，以独立同级按钮呈现并提供中英文可访问名称。确认仅删除点击的该行，删除未选中项不切换当前模型，默认引用与最后一项删除沿用既有回退规则；桌面和窄屏均保留左右布局，无图标覆盖。
- 新增两个真实渲染函数回归用例，覆盖弹窗、聚焦、空值、重名、取消、IME、回车、深拷贝及行内删除目标。首次运行中最后项删除后的空表断言与旧按钮文案断言过期，已更新测试表达的新交互，未据此更改产品数据规则。
- `npm run build`、`node --check media/config/assets/config-app-ui.js`、`git diff --check` 通过；`node --test dist/test/config/grokConfigPage.test.js dist/test/config/grokConfigMapping.test.js dist/test/config/cliPageConfigCoverage.test.js dist/test/cli/grokConfigModels.test.js dist/test/extensionHost/grokConfigModels.test.js` 为 37/37；`npm run test:page` 为 243/243。未重跑全量运行时单测，本轮不改 CLI 调用协议与保存同步链路。
- Chromium 用真实配置页 HTML、静态资源和无密钥内存 IPC 夹具验收：结构化 smoke 通过；1440×1000 中文与 390×844 英文交互均通过。以 `gpt-6.1-sol` 验证新增后 `name/model` 一致、连接及隐藏嵌套字段复制和保存、取消不新增、行内删除确认与取消、删除非当前项及默认引用回退；浏览器、HTTP 和请求错误均为空，截图已复核。这不是完整 VS Code 宿主验收，未写真实用户配置或发起付费模型调用。
- 浏览器验证首次失败均为临时夹具/定位问题：缺少 `initDefault` 响应、将既有模式 tab 误作 button、未适配 AntD 中文按钮空格、误用 TOML 解析结果包装，以及保存后编辑模式重置；已修夹具与场景，不为测试改变产品逻辑。截图等待删除确认退场后再采集。
- 证据：`/tmp/sinitek-grok-model-dialog-{build,related,page,ontology,ontology-tests,design,smoke,interactions}.log`，`/tmp/sinitek-grok-model-dialog-smoke/result.json`、`success.png`，以及 `/tmp/sinitek-grok-model-dialog-interactions/result.json` 和中英文截图。Impeccable detector 对本轮 UI 目标执行一次为 `[]`；ontology 仍为 15 处既有失效引用、测试 8/9，无新增失败。
- 已同步功能清单、能力说明、runtime reference、runbook 与 ontology；本轮为现有组件内交互调整，无新增架构边界，不重复新增热区记忆或事故记录。临时预览端口 19391 和任务脚本在收尾清理，日志截图保留；未打包安装、未重载 VS Code，保留并行版本与既有改动。

## 追加验收：移除可选 name 字段（2026-10-18）

- 用户确认仅在 `name` 非必需时移除其可视化配置和范例。使用本机 Grok 1.0.62，在隔离 `GROK_HOME` 中配置只有 `model`、连接和协议的模型，`grok inspect --json` 与 `grok models` 均退出 0，后者正确列出 `optional-name-check` 为默认项，确认无需 `name`；没有发起模型推理或修改真实用户配置。联网资料检索未取得可用正文，以当前 CLI 实测和其内置模型文档为本轮事实依据。
- 移除前后端 `model.name` 可视化字段、读写映射和类型补丁入口；右侧不再显示“显示名称”。新增仍为单名称弹窗，`model` 和表键采用输入值，深拷贝其余参数但省略新项可选的 `name`。旧模型中的 `name` 作为未展示字段原样保留，包括首尾空白；未知嵌套参数中的同名字段不删除，仍可通过 TOML 源码管理。
- 内置“查看范例”、运行手册片段和新建 Kedaya 配置均不再生成模型 `name`；不删除旧配置已有字段，不改配置档案本身的名称，不影响其他 CLI 的名称配置。提示文案同步中英文，左右布局、行内删除与保存即时同步链路保持不变。本节替代前两节“新增同时生成 name/model”的规则。
- 增补前后端回归：无 `name` 配置可编辑和保存、旧值兼容保留、当前模型复制时仅省略顶层 `name`、嵌套同名字段保留、空模板不生成 `name`、可视化无此控件，以及内置范例 TOML 有效且无 `name`。初次构建发现宿主旧测试仍使用已移除的 `GrokVisualModelPatch.name`，已改为更新 `model` 并断言旧 `name` 保留，这是需求变更后的测试契约更新。
- `npm run build`、`node --check media/config/assets/config-app-ui.js`、`git diff --check` 通过。相关命令 `node --test dist/test/config/grokConfigPage.test.js dist/test/config/grokConfigMapping.test.js dist/test/config/cliPageConfigCoverage.test.js dist/test/cli/grokConfigModels.test.js dist/test/extensionHost/grokConfigModels.test.js dist/test/extensionHost/grokCliHostWire.test.js` 为 54/54；`npm run test:page` 为 243/243。本轮不改 CLI 协议、选择值或状态同步，不重跑全量运行时测试。
- Chromium 以真实配置页 HTML/资源和无密钥内存 IPC 夹具验收：结构化 smoke 通过；1440×1000 中文与 390×844 英文交互均确认无 `name` 控件，新增 `gpt-6.1-sol` 不生成 `name`、连接和隐藏参数复制保存、旧模型 `name` 原值保留，以及实际范例不含该字段且 TOML 可解析。浏览器、HTTP 和请求错误均为空；截图等待弹窗销毁及范例抽屉动画结束后复核。这不是完整 VS Code 宿主验收，未发起付费模型调用。
- 证据：`/tmp/sinitek-grok-optional-name-{cli-inspect,cli-models,build,related,page,ontology,ontology-tests,design,smoke,interactions}.log`，`/tmp/sinitek-grok-optional-name-smoke/result.json` 与 `success.png`，以及 `/tmp/sinitek-grok-optional-name-interactions/result.json` 和中英文截图。Impeccable detector 执行一次为 `[]`；ontology 仍为 15 处既有失效引用、测试 8/9，无新增失败。
- 已同步功能清单、能力说明、runtime reference、runbook 与 ontology；无新增架构边界、迁移或事故，不重复写入热区记忆。收尾清理隔离 CLI 目录、临时端口 19392 和任务脚本，仅保留日志截图；未打包安装或重载 VS Code，保留全部既有修改与并行版本变更。
