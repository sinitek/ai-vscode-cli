# 范例一键导入模型发现下拉

- 日期：2026-11-05
- 状态：completed
- 负责人：Codex
- owner：example-import-model-discovery
- claimed_at：2026-11-05
- claim_ttl：本轮修复验证结束
- handoff_to：无；需真实远端或图形界面验收时另行执行
- 类型：feature

## 背景与目标

`查看范例 → 一键导入` 与配置目录的「添加」共用同一弹窗，模型名称此前只能手填，用户必须提前知道服务端模型 ID。配置页另一个「模型解析导入」入口已具备宿主侧供应商识别与模型发现能力，但依赖当前编辑器草稿，不能直接用于「先填地址和密钥再生成草稿」的范例导入场景。同时，上一轮模型导入策略重构被主审指出 Facade 重复定义 Claude 五字段白名单，需要先修复单一来源缺口再补功能。

本计划只交付先填 base_url / api_key / 协议、解析模型、下拉选择与提交；失败才回退原文本输入。Facade 单一来源重构见关联 refactor；回归开发为历史工作，按 `source_old_path=.ch/docs/exec-plans/completed/2026-11/2026-11-05-example-import-model-discovery.md` 定位于[测试计划移除审计](../../migrations/test-plan-removals/2026-11-11-nov-active.json)。不将主审阶段修复补造为已发布版本 bugfix。

## 范围与非目标

- `media/config/assets/config-app-ui.js`：八入口映射七平台、连接校验、内存临时草稿、宿主发现桥接、候选清洗及分阶段状态机。
- `media/config/assets/config-source-editor.css`：仅 `cli-example-*` 状态行、下拉不裁剪、窄屏不溢出规则；不承担测试/文档交付。

- 不重新设计弹窗：保留 AntD Modal、`Input`、`Select`、`Button`、主题、标题、480px 宽度、footer 与 `config-visual-field` 结构。
- 不复制七平台配置生成器，不新增第二套供应商/协议映射。
- 不保存、激活、写盘解析用临时草稿；不把临时种子模型展示、提交或写入用户草稿。
- 不发起真实供应商请求、不读取真实用户配置、不执行漏洞扫描。
- 不改动其他并发会话的『已配置』标签、Loop 群聊与诊断改动，不动调度状态、活动 ID、Loop+ 快照与任务记录。

## 设计

信息顺序固定为：现有顶部提示 → 添加模式的「配置名称」 → 「API 协议类型」（Claude 无此字段）→ `base_url` → `api_key` → 新增「解析模型」动作与一行状态 → 原位置的模型名称控件 → 原有导入错误 → 原 footer。`config-visual-field` 标签与控件间距 5px，容器沿用 `grok-model-dialog-content` 的 6px 纵向间距，控件宽度 100%、`min-width:0`、基础高度 32px。

状态机：

- `idle`：模型控件为禁用的可搜索 `Select`，占位「填写地址和密钥后解析模型」；不出现自由文本框。
- 地址/密钥/协议合法后「解析模型」才可用；输入不自动发请求。
- `loading`：按钮 loading、忽略重复触发，模型控件与确认禁用，状态行 `role=status` / `aria-live=polite`；地址、密钥、协议仍可编辑，编辑即作废旧请求与结果。
- `success`：同一位置切换为可搜索、可清空、不可自由输入的单选下拉，`value` 为模型 ID、展示为 label，可自动选首项但允许改选。
- `failure`/empty/unsupported/disabled：同一行回退原文本 `Input`，提示「未能解析模型，可手动填写模型名称」（空结果用对应文案），保留输入并提供「重新解析」；手动输入仍走既有最终校验。
- 取消、关闭、跳过、卸载均作废在途请求，迟到响应不得重新打开或覆盖新状态。

复用：用 `buildCliExampleImport` 以当前地址/密钥/协议 + 临时种子 `sinitek-discovery-probe` 生成内存草稿，再调用宿主 `getModelImportProviders` → `discoverImportModels`；八个 `exampleKey` 显式映射七平台，不使用 `split('-')[0]`；临时草稿的 `existingModelIds` 不作为最终候选过滤条件。

## 关键不变量

- 临时种子只存在于解析草稿，不进入用户草稿、候选列表、提交负载或任何持久化。
- 密钥不出现在状态、候选、错误或日志；失败展示固定中文文案，不透传 `err.message`。
- 每次解析带单调 generation，旧 `finally` 不得清除新请求的 loading。
- 保留 `submittingRef` 双提交保护，保存失败保留模型选择。

## 验收标准

- [x] 初始与信息不全时既不发请求也不能提交。
- [x] 解析成功为可搜索单选下拉，改选后提交正确模型。
- [x] 八入口映射七平台，临时草稿与真实宿主 API 兼容，种子不污染结果且同名真实模型不被排除。
- [x] 网络失败、空结果、协议不支持、供应商禁用均回退手动输入，重试成功后恢复下拉。
- [x] 手动输入仍受最终校验约束。
- [x] 地址/密钥/协议变更清空旧结果并作废在途请求；乱序、关闭、卸载无副作用。
- [x] 保存失败可重试、双提交被阻止、跳过不保存。
- [x] 浏览器离线验收覆盖成功下拉、失败回退与重试、加载态、长选项不溢出、取消/迟到响应、密钥遮蔽。

## 影响面

生产代码在 `media/config/assets/`，复用 `src/config/` 现有发现契约；组件为 `CliExampleImportModal`，不改配置/脚本。Facade 重构及历史架构补记见关联计划；测试开发证据按上述来源审计定位，不把已删除 test 计划当作现行互链目标。

## 风险与缓解

- 风险：临时草稿被误当成用户草稿写回或展示。
- 缓解：草稿只在解析调用内构建，提交始终使用 `buildCliExampleImport` 重新生成的正式草稿，回归断言种子不出现在草稿与提交负载。
- 风险：迟到响应覆盖新选择或重新打开已关闭弹窗。
- 缓解：单调 generation + 每次输入作废 + 关闭/卸载清理，回归覆盖乱序与关闭场景。
- 风险：密钥经错误文案或候选泄漏。
- 缓解：固定中文错误映射、候选仅取 id/label、断言状态/错误/候选不含密钥。

## 任务列表

- [x] 新增发现复用的纯函数与桥接，分阶段状态机与 `cli-example-*` 样式。
- [x] 主审异步状态缺陷修正，保留手填、双提交和临时种子隔离。
- [x] 浏览器离线验收与机械化设计检查；这些浏览器执行结果记于本计划历史正文，来源审计条目只列扩展验证方法，没有保留浏览器执行结果或命令。

## 决策记录

- 2026-11-05：不改造 `ModelImportModal`，在范例入口复用其宿主 API，用 `buildCliExampleImport` 生成临时草稿，避免复制七平台生成器。
- 2026-11-05：解析失败即回退文本输入，而不是保留空下拉，保证「解析不了才是输入框」的用户预期。
- 2026-11-05：模型候选不复用 `existingModelIds` 过滤，因为临时草稿的既有模型只是解析种子，不能代表用户草稿。

## 主审第二轮发现与修复证据（异步状态）

主审复用 `dist/test/config/cliexampleimportmodeldiscovery.test.js` 的 `loadHarness` 做离线验证，发现两处与「目标变化清空候选/选择/手填授权并作废请求」承诺不符的缺陷。此前的「已实现目标切换隔离」表述不成立，以本节为准。

**缺陷 1：异步完成回写旧闭包**。解析成功分支执行 `setValues({ ...values, model })` 与 `setErrors({ ...errors, ... })`，`values`/`errors` 是发请求时的渲染快照；解析期间把配置名称由 A 改为 B，成功后名称被回滚成 A。失败与重试路径同样受影响。

**缺陷 2：目标身份未纳入生命周期**。失效只在连接字段 `onChange` 和卸载时发生，`platform`/`exampleKey` 变化既不失效在途请求，也不清理 `discovery`，导致切换目标后仍显示旧目标的 `success` 与旧模型；两个真实调用点也没有身份 key。

**修复**：

- 所有异步完成改为函数式更新，只合并本次拥有的字段：`setValues((previous) => ({ ...previous, model: ... }))` 用最新值判断模型保留，`setErrors((previous) => ...)` 仅清 `model`/`import`；`updateValue`、提交提示、保存失败提示同样改为函数式，不再整包写回快照。
- 新增目标身份 `targetIdentity = currentExampleKey|platform`，由 `identityRef` 跟踪；`useEffect([targetIdentity])` 在变化时执行 `resetForTarget()`：递增 generation 作废旧请求、清空 `model`/候选/手填授权、按新目标重置协议默认值、重建默认配置名称（用户自定义名保留），并清空导入错误。
- `discoveryRef` 记录 `identity`，`stillCurrent()` 同时校验 `identityRef` 当前身份、请求身份、generation 与连接签名，因此身份变化与旧响应交错时旧响应必被拒绝；旧 `finally`/清理只更新自己的 generation 记录，不会清除新请求的 loading。
- 渲染层用 `targetReady` 门控：身份尚未切换完成时，模型值、协议值与状态按新目标初始态展示，避免一帧内暴露旧目标结果；`resolveBlocked` 在身份未就绪时禁用。
- 两个真实调用点补身份 key：配置目录添加为 `key: cli-example-import-${newConfigPlatform}`，范例抽屉为 `key: cli-example-import-${S}`。组件内身份重置与 key 边界同时存在，任一失效路径都能隔离。

## 功能清单与文档边界

**公开流程未变，功能清单与 ontology 无需再改**：本次只修正异步回写与生命周期隔离，用户可见的信息顺序、字段、状态文案、下拉/回退行为与宿主 API 契约均未变化，`FEATURE_INVENTORY.md` 与 `plugin.rule.cli_example_import_inputs` 已描述的「地址/密钥/协议变化作废旧请求」在本次补全为「目标变化同样作废」，属于既有规则的事实落地，不新增规则或流程节点。

原文早期任务曾记录 FEATURE_INVENTORY 两段描述、ARCHITECTURE、ontology、本计划和上一轮计划补记；历史涉及 `.ch/docs/exec-plans/`、`.ch/docs/product-specs/`、`.ch/docs/ontology/`，其中 `cli-plugin-runtime` 路径为 `.ch/docs/ontology/domains/cli-plugin-runtime.json`。后续主审明确上述既有产品/ontology 已覆盖，无需因异步修复再改。本轮不据这些早期清单强造新 docs 交付；平台策略架构说明的实际独立范围由同日 [model-import-platform-strategies docs](2026-11-05-docs-model-import-platform-strategies.md#背景与目标)承接。

## 验证计划与真实结果

历史验证包括构建、六个最小相关套件、全量 Node/Python、离线 Playwright 与空白校验；本计划正文此前写有2957项全量结果。来源审计条目列出七套件的准确命令及各自结果，合计125项，但未收录2957项全量结果、浏览器执行结果、旧实现失败对照或完整证据。2957项数字及浏览器执行记录沿用本计划原文，不作为审计留存或本轮执行结果；来源为 `source_old_path=.ch/docs/exec-plans/completed/2026-11/2026-11-05-example-import-model-discovery.md`；本轮未执行这些检查。

## 未验证项

- 未启动 VS Code Extension Development Host；浏览器验收使用 `getConfigViewHtml` + VS Code 桥接 mock，不等同真实扩展宿主。
- 浏览器新增的 `async-name`（解析中改名为 B，成功后仍为 B）与 `target-switch-fresh`（关闭后重开新目标回到未解析态、地址未沿用）为 DOM 断言；整页截图仍受本机无头 Chromium 白帧限制，不能作为像素结论。
- 未调用真实供应商或真实 CLI；发现请求全部使用注入的离线 fetch 夹具。
- 截图在本机 headless Chromium 下整页渲染为白屏（连 200×100 纯色测试页同样全白），属环境的合成器/光栅化限制，因此未据此声称视觉结论，改用 DOM 几何与计算样式断言。
- 未运行严格 100% 覆盖率门禁，未执行发布脚本、未提交、未建分支、未升级依赖。

## 当前结论

分阶段发现、下拉与失败回退已完成；此前“已实现目标切换隔离”被第二轮主审否定，修复后由函数式合并、身份重置与 key 双重隔离达成。无新增公开流程或规则，原 completed 保留且不消除宿主/像素未验边界。

## 关联计划

- [refactor：范例导入五字段与平台白名单单一来源](2026-11-05-refactor-example-import-model-discovery.md#背景与目标)：分别承接范例导入五字段与平台白名单单一来源，共享本来源的历史背景与接口。
- [测试计划移除审计](../../migrations/test-plan-removals/2026-11-11-nov-active.json)：保留范例模型发现阶段与异步身份回归开发的历史证据，来源为 `source_old_path=.ch/docs/exec-plans/completed/2026-11/2026-11-05-example-import-model-discovery.md`；不再作为现行测试责任。

## 迁移说明

本文件承接 2026-11-05 原计划中的本类型工作。验证命令及结果均为原文历史记录，本轮仅整理计划，未重新执行；原状态 completed 不代表平台/真实宿主限制已消除。
