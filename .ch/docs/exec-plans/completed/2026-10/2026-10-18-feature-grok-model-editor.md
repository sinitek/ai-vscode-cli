# Grok 流式错误与多模型主从编辑器 — 新功能开发

- 日期：2026-10-18
- 状态：completed
- 负责人：Codex
- 类型：feature

- 迁移来源：`.ch/docs/exec-plans/completed/2026-10/2026-10-18-grok-stream-error-and-model-editor.md`（历史标识，原文件已替换）
- 关联计划：[已发布行为修复](2026-10-18-bugfix-grok-stream-errors.md); 原 docs companion `2026-10-18-docs-grok-stream-error-and-model-editor.md` 已退役；仅留历史身份与分工，完整校验记录未恢复。[references 索引](../../../references/index.md)仅作导航。
- 测试计划删除审计：[十月历史证据](../../migrations/test-plan-removals/2026-11-11-oct.json)（按本页迁移来源查项；仅保留历史事实，不承担独立测试开发）。

## 本子计划目标

新增 Grok 左右模型编辑器、深拷贝与名称弹窗，保留后续可选 name 字段裁定。

## 本子计划实施范围

仅承担下列归属条目的新功能开发；其它类型交付见关联计划。

## 本子计划验收

遵守下列原文相应契约和验收条件，保留追加决策的优先级；不扩大历史验证结论。

## 依赖与背景

文档仍以关联实现、历史验证与追加决策的真实结果为依据。原 test companion 已于 2026-11-11 删除；测试开发不是本存活计划的现行职责。这里保留同一历史任务的依赖与边界，不声称重新执行。feature 编辑器与流协议 bugfix 独立；保存后候选即时同步依赖 bugfix 的保存/应用通知修正。历史文档分工依赖两者及后续可选 name 裁定；原测试依赖仅作历史说明。

共享背景和跨类型验收关系见[来源任务的归属记录](2026-10-18-bugfix-grok-stream-errors.md)；原始作者、日期和状态语义沿用头部记录。

## 历史验证与未决事项

本类型交付的实际验证以[同源原任务验证与边界](2026-10-18-bugfix-grok-stream-errors.md#历史验证与未决事项)及下列原文局部记录为准。此引用复用当时构建/定向测试/文档校验等证据，不表示单独重跑或新增通过结论；未覆盖和历史失败同样适用。

## 原文归属记录

## 目标与范围

- 配置可视化改为左侧模型列表、右侧当前模型参数；新增模型从当前模型复制所有参数。

## 验收标准

- 左右布局模型列表可选择，右侧参数随选择变化；新增复制连接、凭据、协议及隐藏嵌套参数且不与原模型共享对象；仅覆盖 `model/name`。

- 新增、删除、默认引用、非法输入、TOML 往返与桌面/窄屏浏览器验证通过。

## 进展与验证结果

- UI 完成：左侧模型列表、右侧参数与全局默认；窄屏仍维持左右布局。新增深拷贝当前模型全部字段及嵌套参数，仅替换 `model/name`，支持默认/首项与空模板回退。选择、编辑、删除、默认引用、非法输入与隐藏字段保留遵循原有约束；新增说明明确复制来源。

- `npm run test:page`：242/242 通过。首次发现已有页面测试把整个编辑器禁止 `aria-pressed` 当作模式切换约束；新模型列表合法使用该属性表达选中，已把断言缩小到原有模式切换区域，新模型列表状态另有回归覆盖。

## 证据与收尾

- 未打包安装新插件或操作用户 VS Code 窗口。代码加载后重载窗口并新建 Grok 会话，以避免旧进程/旧会话继续使用已缓存的协议。新增模型按用户要求原样继承协议，不会按名称强行改为其他协议。

## 追加验收：模型下拉显示字段（2026-10-18）

- 按用户补充要求，普通及 Loop/Loop+ 主从下拉改为显示每项配置的 `model`，不使用 `name`；缺失、空白或非字符串时回退配置表键。内部选择值与 `--model` 保持配置表键，避免同名 API 模型的不同连接被合并或误选。

- 解析器输出独立标签映射，经宿主 `labelsByCli` 传给 Webview；刷新、档案隔离、空配置清理与暂态快照保留同步处理标签。不改运行器或用户配置，无新增文案，无需新增 i18n 键。

- `npm run build` 通过；已修正并重跑通过。`node --test dist/test/cli/grokConfigModels.test.js dist/test/extensionHost/grokConfigModels.test.js dist/test/extensionHost/grokCliHostWire.test.js dist/test/webview/grokmodelselection.test.js dist/test/webview/codexdualmodelwebview.test.js` 为 29/29 通过；`npm run test:page` 为 242/242 通过；`git diff --check` 通过。

- Chromium 使用真实下拉渲染函数和状态处理函数的隔离夹具，验证普通/主/子显示、相同模型名保留独立配置键、选择与刷新；并只读解析本机实际配置，逐项校验 DOM 显示映射，未写配置、未发起付费模型调用。结构化 smoke 通过，无浏览器、HTTP 或请求错误；这不是完整 VS Code 宿主验收。

- 证据：`/tmp/sinitek-grok-model-label-{build,tests,page,ontology,ontology-tests,smoke}.log`、`/tmp/sinitek-grok-model-label-smoke/result.json` 与 `success.png`。临时预览端口 19389 已停止，任务脚本及场景已删除。

- ontology 测试仍为 8/9，未新增失败。未重跑全量运行时单测；不重复创建记忆记录。

## 追加验收：移除刷新图标并在保存后同步（2026-10-18）

- 用户要求替代前两轮的手动刷新交互：移除模型下拉左侧 SVG、元素绑定、点击监听、移动逻辑、专用布局样式和废弃文案；普通与主从下拉均不保留占位。

- 新回归在临时 `GROK_HOME` 中执行真实档案保存和配置应用，以阻塞屏障验证模型同步结束前没有成功应答；同步后读取 `sol → gpt-6.1-sol`，失败应用不增加通知且不覆盖有效配置。普通/Loop/Loop+ 原有行切换和标签显示回归保留，并断言刷新 DOM、脚本绑定和样式均已移除。

- `npm run build` 通过；已显式声明回调类型、收窄响应并重跑通过。相关测试命令 `node --test dist/test/cli/grokConfigModels.test.js dist/test/extensionHost/grokConfigModels.test.js dist/test/extensionHost/grokCliHostWire.test.js dist/test/webview/grokmodelselection.test.js dist/test/webview/codexdualmodelwebview.test.js dist/test/config/cliPageConfigCoverage.test.js` 为 47/47 通过，`npm run test:page` 为 243/243 通过，`git diff --check` 通过。

- Chromium 使用真实静态对话 HTML、样式、模型状态/渲染函数，以及真实 `ConfigManagerPanel` 保存/应用和隔离磁盘配置的 IPC 夹具：点击保存后无需刷新即可显示新模型，普通及主从候选更新、旧项清除、切换 Loop/Loop+ 无刷新按钮，结构化 smoke 通过；无浏览器、HTTP 或请求错误，截图已复核。这不是完整 VS Code 宿主验收，没有发起真实付费模型调用。

- 证据：`/tmp/sinitek-grok-save-sync-{build,focused,related,page,ontology,ontology-tests,smoke}.log`、`/tmp/sinitek-grok-save-sync-smoke/result.json` 与 `success.png`。Impeccable detector 对本轮 UI 目标执行一次为 `[]`。预览端口 19390 已停止，临时 `GROK_HOME`、脚本和场景已清理。

- 前述手动刷新描述以本节为准。测试 8/9，未扩大修复；本轮未重跑全量运行时测试。无需改 `ARCHITECTURE.md`；不新增重复热区记忆。未打包安装或重载用户窗口，保留全部既有修改与并行版本变更。

## 追加验收：单名称新增弹窗与列表行内删除（2026-10-18）

- 按用户最新要求，列表标题旁的“新增”只打开一个模型名称输入框；使用项目现有 Modal，自动聚焦，空值禁用确认，支持回车并保护中文输入法组词。重名或无效名称在弹窗内提示，取消或 Escape 不新增，切换档案时关闭并清空草稿。

- 确认后沿用原深拷贝逻辑，仅将 `model`、`name` 和配置表键设为输入名称（首尾去空白），选中新项并在右侧编辑。连接、协议、凭据、未知字段和嵌套参数全部保留，复制对象不与原项共享。

- 侧栏不再常驻新增输入区或“删除当前模型”按钮；每行名称右侧复用已有删除 SVG，以独立同级按钮呈现并提供中英文可访问名称。确认仅删除点击的该行，删除未选中项不切换当前模型，默认引用与最后一项删除沿用既有回退规则；桌面和窄屏均保留左右布局，无图标覆盖。

- 覆盖弹窗、聚焦、空值、重名、取消、IME、回车、深拷贝及行内删除目标。首次运行中最后项删除后的空表断言与旧按钮文案断言过期，未据此更改产品数据规则。

- `npm run build`、`node --check media/config/assets/config-app-ui.js`、`git diff --check` 通过；`node --test dist/test/config/grokConfigPage.test.js dist/test/config/grokConfigMapping.test.js dist/test/config/cliPageConfigCoverage.test.js dist/test/cli/grokConfigModels.test.js dist/test/extensionHost/grokConfigModels.test.js` 为 37/37；`npm run test:page` 为 243/243。未重跑全量运行时单测，本轮不改 CLI 调用协议与保存同步链路。

- Chromium 用真实配置页 HTML、静态资源和无密钥内存 IPC 夹具验收：结构化 smoke 通过；1440×1000 中文与 390×844 英文交互均通过。以 `gpt-6.1-sol` 验证新增后 `name/model` 一致、连接及隐藏嵌套字段复制和保存、取消不新增、行内删除确认与取消、删除非当前项及默认引用回退；浏览器、HTTP 和请求错误均为空，截图已复核。这不是完整 VS Code 宿主验收，未写真实用户配置或发起付费模型调用。

- 浏览器验证首次失败均为临时夹具/定位问题：缺少 `initDefault` 响应、将既有模式 tab 误作 button、未适配 AntD 中文按钮空格、误用 TOML 解析结果包装，以及保存后编辑模式重置；已修夹具与场景，不为测试改变产品逻辑。截图等待删除确认退场后再采集。

- 证据：`/tmp/sinitek-grok-model-dialog-{build,related,page,ontology,ontology-tests,design,smoke,interactions}.log`，`/tmp/sinitek-grok-model-dialog-smoke/result.json`、`success.png`，以及 `/tmp/sinitek-grok-model-dialog-interactions/result.json` 和中英文截图。Impeccable detector 对本轮 UI 目标执行一次为 `[]`；测试 8/9，无新增失败。

- 本轮为现有组件内交互调整，无新增架构边界，不重复新增热区记忆或事故记录。临时预览端口 19391 和任务脚本在收尾清理，日志截图保留；未打包安装、未重载 VS Code，保留并行版本与既有改动。

## 追加验收：移除可选 name 字段（2026-10-18）

- 用户确认仅在 `name` 非必需时移除其可视化配置和范例。使用本机 Grok 1.0.62，在隔离 `GROK_HOME` 中配置只有 `model`、连接和协议的模型，`grok inspect --json` 与 `grok models` 均退出 0，后者正确列出 `optional-name-check` 为默认项，确认无需 `name`；没有发起模型推理或修改真实用户配置。联网资料检索未取得可用正文，以当前 CLI 实测和其内置模型文档为本轮事实依据。

- 移除前后端 `model.name` 可视化字段、读写映射和类型补丁入口；右侧不再显示“显示名称”。新增仍为单名称弹窗，`model` 和表键采用输入值，深拷贝其余参数但省略新项可选的 `name`。旧模型中的 `name` 作为未展示字段原样保留，包括首尾空白；未知嵌套参数中的同名字段不删除，仍可通过 TOML 源码管理。

- 内置“查看范例”、运行手册片段和新建 Kedaya 配置均不再生成模型 `name`；不删除旧配置已有字段，不改配置档案本身的名称，不影响其他 CLI 的名称配置。提示文案同步中英文，左右布局、行内删除与保存即时同步链路保持不变。本节替代前两节“新增同时生成 name/model”的规则。

- 以及内置范例 TOML 有效且无 `name`。初次构建发现宿主旧测试仍使用已移除的 `GrokVisualModelPatch.name`，这是需求变更后的测试契约更新。

- `npm run build`、`node --check media/config/assets/config-app-ui.js`、`git diff --check` 通过。相关命令 `node --test dist/test/config/grokConfigPage.test.js dist/test/config/grokConfigMapping.test.js dist/test/config/cliPageConfigCoverage.test.js dist/test/cli/grokConfigModels.test.js dist/test/extensionHost/grokConfigModels.test.js dist/test/extensionHost/grokCliHostWire.test.js` 为 54/54；`npm run test:page` 为 243/243。本轮不改 CLI 协议、选择值或状态同步，不重跑全量运行时测试。

- Chromium 以真实配置页 HTML/资源和无密钥内存 IPC 夹具验收：结构化 smoke 通过；1440×1000 中文与 390×844 英文交互均确认无 `name` 控件，新增 `gpt-6.1-sol` 不生成 `name`、连接和隐藏参数复制保存、旧模型 `name` 原值保留，以及实际范例不含该字段且 TOML 可解析。浏览器、HTTP 和请求错误均为空；截图等待弹窗销毁及范例抽屉动画结束后复核。这不是完整 VS Code 宿主验收，未发起付费模型调用。

- 证据：`/tmp/sinitek-grok-optional-name-{cli-inspect,cli-models,build,related,page,ontology,ontology-tests,design,smoke,interactions}.log`，`/tmp/sinitek-grok-optional-name-smoke/result.json` 与 `success.png`，以及 `/tmp/sinitek-grok-optional-name-interactions/result.json` 和中英文截图。Impeccable detector 执行一次为 `[]`；测试 8/9，无新增失败。

- 无新增架构边界、迁移或事故，不重复写入热区记忆。收尾清理隔离 CLI 目录、临时端口 19392 和任务脚本，仅保留日志截图；未打包安装或重载 VS Code，保留全部既有修改与并行版本变更。
