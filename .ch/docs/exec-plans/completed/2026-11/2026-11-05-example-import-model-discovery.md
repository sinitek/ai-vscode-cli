# 范例一键导入模型发现下拉

- 日期：2026-11-05
- 状态：completed
- 负责人：Codex
- owner：example-import-model-discovery
- claimed_at：2026-11-05
- claim_ttl：本轮修复验证结束
- handoff_to：无；需真实远端或图形界面验收时另行执行

## 背景

`查看范例 → 一键导入` 与配置目录的「添加」共用同一弹窗，模型名称此前只能手填，用户必须提前知道服务端模型 ID。配置页另一个「模型解析导入」入口已具备宿主侧供应商识别与模型发现能力，但依赖当前编辑器草稿，不能直接用于「先填地址和密钥再生成草稿」的范例导入场景。同时，上一轮模型导入策略重构被主审指出 Facade 重复定义 Claude 五字段白名单，需要先修复单一来源缺口再补功能。

## 目标

1. 修复主审发现：Facade 与策略共用同一份 `CLAUDE_FIELD_KEYS`，平台白名单由策略表键推导，补回归并同步架构说明。
2. 范例一键导入支持「先填 base_url / api_key / 协议 → 解析模型 → 下拉选择 → 提交」；解析失败才回退原文本输入。

## 范围

- `src/config/modelimport.ts`、`src/config/modelimportshared.ts`、`ARCHITECTURE.md`：单一来源修复与说明。
- `media/config/assets/config-app-ui.js`：范例入口平台映射、连接校验、内存临时草稿、发现桥接、模型候选清洗与弹窗分阶段状态机。
- `media/config/assets/config-source-editor.css`：仅新增 `cli-example-*` 状态行、下拉不被裁剪、窄屏不溢出的规则。
- `src/test/config/cliExampleImport.test.ts`、`src/test/config/newConfigFromExample.test.ts`：按阶段更新现有 VM/hook 断言。
- `src/test/config/cliexampleimportmodeldiscovery.test.ts`：新增真实宿主 API + 离线 fetch 夹具的分阶段回归。
- `.ch/docs/product-specs/FEATURE_INVENTORY.md`、`.ch/docs/ontology/domains/cli-plugin-runtime.json`。
- `.ch/docs/exec-plans/completed/2026-11/2026-11-05-model-import-platform-strategies.md`：补主审发现与修复证据。

## 非目标

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

- [x] Facade 与策略共用同一五字段白名单，平台白名单由策略表键推导，回归防止重复定义。
- [x] 初始与信息不全时既不发请求也不能提交。
- [x] 解析成功为可搜索单选下拉，改选后提交正确模型。
- [x] 八入口映射七平台，临时草稿与真实宿主 API 兼容，种子不污染结果且同名真实模型不被排除。
- [x] 网络失败、空结果、协议不支持、供应商禁用均回退手动输入，重试成功后恢复下拉。
- [x] 手动输入仍受最终校验约束。
- [x] 地址/密钥/协议变更清空旧结果并作废在途请求；乱序、关闭、卸载无副作用。
- [x] 保存失败可重试、双提交被阻止、跳过不保存。
- [x] `npm run build`、定向测试、全量 Node/Python 回归、ontology 校验与空白检查通过。
- [x] 浏览器离线验收覆盖成功下拉、失败回退与重试、加载态、长选项不溢出、取消/迟到响应、密钥遮蔽。

## 影响面

- 代码目录：`src/config/`、`media/config/assets/`、`src/test/config/`
- 文档目录：`.ch/docs/exec-plans/`、`.ch/docs/product-specs/`、`.ch/docs/ontology/`
- 配置与脚本：不变

## 风险与缓解

- 风险：临时草稿被误当成用户草稿写回或展示。
- 缓解：草稿只在解析调用内构建，提交始终使用 `buildCliExampleImport` 重新生成的正式草稿，回归断言种子不出现在草稿与提交负载。
- 风险：迟到响应覆盖新选择或重新打开已关闭弹窗。
- 缓解：单调 generation + 每次输入作废 + 关闭/卸载清理，回归覆盖乱序与关闭场景。
- 风险：密钥经错误文案或候选泄漏。
- 缓解：固定中文错误映射、候选仅取 id/label、断言状态/错误/候选不含密钥。

## 验证计划

- 最小相关验证：`npm run build` + `modelimport`、`modelimportplatformstrategies`、`modelimportui`、`cliExampleImport`、`newConfigFromExample`、`cliexampleimportmodeldiscovery` 六个套件。
- 单元自测命令：`npm run test:unit`。
- 扩展验证：`python3 -m unittest discover -s scripts/tests -p 'test_*.py'`、ontology `--validate`、空白检查、浏览器离线 Playwright。

## 测试与清单同步

- 单元测试新增/更新：`modelimportplatformstrategies.test.ts`（+3 单一来源回归）、`cliExampleImport.test.ts`（分阶段适配）、`cliexampleimportmodeldiscovery.test.ts`（新增 12 条）、`newConfigFromExample.test.ts`（调用点契约保持）。
- 单元自测结果：见「验证证据」。
- 失败处理记录：见「失败分类与处理」。
- 功能清单：`FEATURE_INVENTORY.md` 更新范例导入两段描述。
- 相关文档同步：`ARCHITECTURE.md`、`cli-plugin-runtime` ontology、本计划与上一轮计划补记。

## 任务列表

- [x] 修复 Facade 五字段/平台白名单单一来源并补回归
- [x] 同步 `ARCHITECTURE.md` 平台扩展说明
- [x] 新增发现复用的纯函数与桥接
- [x] 重写 `CliExampleImportModal` 分阶段状态机
- [x] 新增 `cli-example-*` 样式
- [x] 更新既有 VM 测试并新增发现测试套件
- [x] 浏览器离线验收与机械化设计检查
- [x] 同步功能清单与 ontology
- [x] 全量 Node/Python 回归与空白检查
- [x] 归档计划

## 决策记录

- 2026-11-05：不改造 `ModelImportModal`，在范例入口复用其宿主 API，用 `buildCliExampleImport` 生成临时草稿，避免复制七平台生成器。
- 2026-11-05：解析失败即回退文本输入，而不是保留空下拉，保证「解析不了才是输入框」的用户预期。
- 2026-11-05：模型候选不复用 `existingModelIds` 过滤，因为临时草稿的既有模型只是解析种子，不能代表用户草稿。

## 验证证据

- `npm run build`：退出码 0（本轮最终构建 `/tmp/r3-build-14.log`，其后仅测试与文档改动；`npm run test:unit` 内部再次构建）。
- `node --test dist/test/config/modelimport.test.js`：`# pass 28`、`# fail 0`。
- `node --test dist/test/config/modelimportplatformstrategies.test.js`：`# pass 12`、`# fail 0`。
- `node --test dist/test/config/modelimportui.test.js`：`# pass 28`、`# fail 0`。
- `node --test dist/test/config/cliExampleImport.test.js`：`# pass 14`、`# fail 0`。
- `node --test dist/test/config/newConfigFromExample.test.js`：`# pass 7`、`# fail 0`。
- `node --test dist/test/config/cliexampleimportmodeldiscovery.test.js`：`# pass 20`、`# fail 0`（较本轮修复前 +8）。
- `node --test dist/test/config/zcodeConfig.test.js`：`# pass 16`、`# fail 0`。
- 定向七套件合计 125 条，0 失败。
- 旧实现对照：把 7 条新增异步/目标身份用例跑在修复前的 `config-app-ui.js` 副本上，7 条全部失败（13 通过 / 7 失败），确认用例能真正捕获本次缺陷。
- `npm run test:unit`（含构建）：`# tests 2957`、`# pass 2954`、`# fail 0`、`# skipped 3`，退出码 0；日志 `/tmp/r3-unit-final.log`。较上一轮 `2949/2946/0/3` 净增 8 条，跳过项仍为依赖真实 DSH 环境的既有用例。
- `python3 -m unittest discover -s scripts/tests -p 'test_*.py'`：`Ran 44 tests`、`OK (skipped=1)`，退出码 0；日志 `/tmp/r3-python-final.log`。
- `npx tsc -p ./ --noEmit`：退出码 0（此前的并发报错已不再出现）。
- `git diff --check`（本次全部改动文件）：退出码 0。
- `npm run validate:whitespace`：退出码 1，唯一命中为修改前已存在的 `AGENTS.md:8: trailing whitespace`，按约束未修改。
- 浏览器离线 Playwright（1440×1000 与 390×844，9 个场景全部通过）：新增 `async-name`（解析中名称改为 B，成功后仍为 B）与 `target-switch-fresh`（重开新目标回到未解析态、地址未沿用）；成功下拉 2 个候选并可改选为 `got-6.1-pro`；失败回退文本输入 + 「重新解析」；加载态提示「正在解析模型，请稍候…」；长选项下拉 420px / 302px 未超出视口、`text-overflow: ellipsis`；取消后迟到响应未重开弹窗且请求数不增；密钥 `type=password` 且未出现在弹窗文本。
- 机械化设计检查：`grok-model-dialog-content` 6px、字段 5px、控件 432px 撑满、32px 高度、弹窗 480px、字段顺序 5 项一致、新增样式无硬编码颜色、失败态引用 `--error-color`，全部通过。
- `python3 .agents/skills/ontology/scripts/search_ontology.py --validate`：`validation passed: domains=2 concepts=16 relations=15 rules=105 workflows=2 documents=3`。

## 失败分类与处理

- 本轮新增用例首轮 1 条失败：断言把 AntD `Select` 的 mock 类型当成字符串 `"select"`，实际是 `$l` 占位对象；改为断言 `disabled` 与空 `options`，实现未改。
- 目标名称重建用例首轮失败：测试期望小写平台名，实际 `configPlatformLabel` 返回首字母大写；改为 `Codex 配置 n` / `Grok 配置 n`。
- 名称重建首轮实现漏渲染：`resetForTarget` 已更新 state，但同一帧仍读旧 `values.name`；补 `nameValue = targetReady ? values.name : ""` 门控，并把测试 harness 渲染改为「effect 后又更新 state 则再渲染一轮」以贴近真实 React。
- 测试 harness `render` 返回值类型推断为 `unknown` 触发 9 条 `TS2571`；显式标注 `AnyRecord`，非实现问题。
- 分阶段改造后 4 条既有 VM 用例失败（`fill()` 不再是同步单步、模型控件改为 Select）：属预期契约变化，按阶段重写断言，实现未回退。
- 新增套件首轮多处断言用跨 realm 的 `deepEqual` 比较 vm 内对象，被判「结构相同但引用不同」：改为 JSON 归一化后通过。
- 「地址变更后重发」用例最初在 `providers` 微任务完成前释放 promise，导致第二请求未登记：用例补 `setImmediate` 等待，实现不变。
- 修正实现层两处顺序问题：解析中 `inFlight` 守卫误用渲染期状态导致旧闭包漏判；未解析时提交把「未尝试」报成模型必填错误。均改为以 ref 判定并只提示「请先解析模型」。
- 无范围外业务修改。

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

**新增回归**（`src/test/config/cliexampleimportmodeldiscovery.test.ts`，20 条）：

- 解析中名称 A→B，成功保留 B，`onImport` 收到 B；失败与重试成功同样保留最新名称并提交最新值。
- 目标 platform 切换后旧成功不能建立 `success`，模型清空且不可提交；旧失败不能放开手填授权；已有成功态与手填态切目标后都回到 `idle` 禁用下拉。
- 新目标协议默认值正确（codex→grok `responses`，drawer codex→claude 无协议字段），新发现可提交。
- 目标切换时旧请求结束不清除新请求 `loading`，新结果胜出。
- 目标切换按新平台重建默认配置名称，用户自定义名称保留。
- 按身份 key 真实重挂载：新实例从空白未解析态开始，旧实例迟到响应无副作用，新实例未解析不可提交。
- 测试 harness 的 `useState` 支持函数式 setter、`useEffect` 按 deps 比较并执行 cleanup，新增 `remount`/`setProps` 模拟真实重挂载，未削弱既有断言。
- 两个调用点的身份 key 由静态断言覆盖（`newConfigFromExample.test.ts`、`cliExampleImport.test.ts`），重挂载生命周期由 `remount` 用例覆盖，浏览器 `target-switch-fresh` 场景做真实 DOM 补充。

**公开流程未变，功能清单与 ontology 无需再改**：本次只修正异步回写与生命周期隔离，用户可见的信息顺序、字段、状态文案、下拉/回退行为与宿主 API 契约均未变化，`FEATURE_INVENTORY.md` 与 `plugin.rule.cli_example_import_inputs` 已描述的「地址/密钥/协议变化作废旧请求」在本次补全为「目标变化同样作废」，属于既有规则的事实落地，不新增规则或流程节点。

**验证**：把这 7 条新用例跑在修复前的资产副本上，7 条全部失败；修复后 20/20 通过。`npm run test:unit` 2957 项 / 2954 通过 / 0 失败 / 3 跳过（日志 `/tmp/r3-unit-final.log`）。`npx tsc -p ./ --noEmit` 退出码 0。

## 未验证项

- 未启动 VS Code Extension Development Host；浏览器验收使用 `getConfigViewHtml` + VS Code 桥接 mock，不等同真实扩展宿主。
- 浏览器新增的 `async-name`（解析中改名为 B，成功后仍为 B）与 `target-switch-fresh`（关闭后重开新目标回到未解析态、地址未沿用）为 DOM 断言；整页截图仍受本机无头 Chromium 白帧限制，不能作为像素结论。
- 未调用真实供应商或真实 CLI；发现请求全部使用注入的离线 fetch 夹具。
- 截图在本机 headless Chromium 下整页渲染为白屏（连 200×100 纯色测试页同样全白），属环境的合成器/光栅化限制，因此未据此声称视觉结论，改用 DOM 几何与计算样式断言。
- 未运行严格 100% 覆盖率门禁，未执行发布脚本、未提交、未建分支、未升级依赖。

## 当前结论

单一来源缺口已修复并有回归保护；范例一键导入的分阶段模型发现、下拉选择与失败回退已实现。主审第二轮指出的异步回写旧快照与目标身份未隔离缺陷已修复：异步完成只做函数式合并，目标变化经身份重置与身份 key 双重隔离，新增 7 条在旧实现上必失败的回归。全量 2957 项 0 失败，文档与 ontology 无需因公开流程变化再改。计划归档到 `.ch/docs/exec-plans/completed/2026-11/2026-11-05-example-import-model-discovery.md`。
