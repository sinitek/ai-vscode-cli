# 对话 Tab 任务摘要

- 日期：2026-11-07
- 状态：completed
- 负责人：运行时、前端、文档三个独立交付边界协作
- 当前阶段：运行时与浮层已通过主审，源码/原始材料复核后完成文档、本体与月份归档；验证限制保留如下

## 背景与目标

多 Tab 场景需要在不扩张标签尺寸的前提下识别任务。实施前基线中的 `renderConversationTabs` 负责标签渲染，`preparePendingLabel` 从首条提示词建立会话标签；这不是 AI 任务摘要。现已在首次提交时异步归纳任务意图，通过可选 `ConversationTabSummary.taskSummary?: string` 提供简短中文提示，原标签行为保留。

## 范围与非目标

- 范围：一次性 AI 归纳、任务/会话级持久化和身份校验、Tab 延迟提示、规格/设计/ontology 同步。
- 非目标：不改原 Tab 尺寸、分页、运行/错误状态、角色标记和关闭行为；不新增配置、语言包、用户开关；不追溯生成旧历史摘要，不替换原会话标签，不总结最终执行结果。
- 本文档交付不修改运行时代码、UI 或测试，不执行构建、发布、分支或提交操作，不触碰 Loop+ 调度状态及记忆热区。

## 三个独立交付边界

| 边界 | 主要范围 | 交接与验收证据 |
| --- | --- | --- |
| 运行时与数据 | 首次任务提交接入；复用已有 CLI/provider 配置的独立受限 session；`src/sessionTabs.ts`、`src/sessionStore.ts`、`src/sessionLifecycle.ts`、`src/extensionHost/sessionTabs.ts` 的摘要保存、映射及失效处理 | 输出可选 `taskSummary`；提供触发次数、失败不阻塞、迁移/恢复、迟到结果与协议隔离证据 |
| 前端与交互 | 消费可选字段；`src/webview/types.ts`、`src/webview/viewContentScript/messageRendering.ts` 及必要主题样式/事件处理 | 字段契约与运行时协调，不竞争重写；提供计时、隐藏、键盘、安全文本及窄屏证据 |
| 文档与本体 | 本计划、功能总表、能力分册、运行时设计、`cli-plugin-runtime` ontology | 只登记目标与验收，不将计划测试写成通过；文档检查通过不代表功能验收 |

## 验收标准

- [x] Tab 对应任务首次有效提交即异步发起一次 AI 文本归纳，不等任务完成，不阻塞原任务；空白新 Tab 不生成。（E1：首次提交/完成前接收/空输入用例；E3：真实 AI 输出）
- [x] 后续普通消息、hover、面板刷新、旧历史恢复均不重复生成；失败或超时不因这些动作重试。（E1：去重/失败/历史恢复；E2/E4：无 hover 请求）
- [x] 提示要求简体中文纯文本，最多 30 个 Unicode 码点；通过可选 `ConversationTabSummary.taskSummary` 传递，不把原提示词截断伪装成摘要。（E1：Unicode/结果校验；E3：22 码点简体中文；无确定性繁简转换，见限制）
- [x] 摘要按任务/会话保存，兼容旧记录缺失字段；local/native session 绑定、扩展重载与历史重开不丢失、不串 Tab。（E1：保存/读盘、绑定/迁移、已有目标 session 和多 Tab 用例；非完整扩展宿主端到端）
- [x] 关闭、重置或工作区切换使在途请求失效，迟到结果不能写入旧会话、新 Tab 或其它工作区。（E1：迟到结果、立即复用重置 Tab、资源释放用例）
- [x] AI 失败、超时或不可用仅使摘要缺失；不影响主任务、会话消息、运行/错误状态或 Loop 协议。（E1：失败/超时/容量溢出与独立调用；E2：状态/角色/关闭回归）
- [x] 鼠标连续停留 Tab 1000 毫秒才显示摘要；离开、切换、关闭、分页和 Escape 均隐藏并撤销未触发的显示。（E2：18 项专门用例；E4：999/1000ms、重绘与选择浏览器检查）
- [x] 键盘连续聚焦 1000 毫秒也能读取；无摘要、生成中和失败均不显示占位浮层。（E2/E4：焦点/重绘/失焦/无效字段与空态）
- [x] 浮层只有一段正文，使用既有主题语义、安全纯文本渲染；窄视口换行且不越界，既有 Tab 功能保持不变。（E2：纯文本/极窄视口/分页/状态；E4：宽窄×深浅四组合、8 张截图）
- [x] 摘要执行复用已有 CLI/provider 配置，但使用独立受限 session，不污染原对话或 Loop 协议；DSH/Kimi/ZCode 不绕过现有 one-shot prompt 参数禁令。（E1：七 CLI 配置/原生协议/权限测试；E3：真实 Codex；其余六 CLI 未做真实 provider 调用）

## 影响面与事实来源

- 现有入口：`src/webview/viewContentScript/messageRendering.ts`（`renderConversationTabs`）、`src/webview/types.ts`（`ConversationTabSummary`）。
- 实现入口：`src/extension.ts` 在 Loop 改写前捕获原始需求，在共同 `runPrompt` 取得配置执行租约后安排摘要；`src/conversationTaskSummary.ts` 的协调器并发 2、总容量 32、活动调用超时 20 秒，`taskSummaryAttempted` 使失败/超时/溢出也只尝试一次；`src/extensionHost/conversationTaskSummary.ts` 复用七种 CLI 现有 runner 独立受限调用。
- 现有数据/生命周期：`src/sessionTabs.ts`、`src/sessionStore.ts`、`src/sessionLifecycle.ts`、`src/extensionHost/sessionTabs.ts`。
- 原生协议限制：`src/cli/cliRunArgStrategies.ts`；不能将独立摘要 session 等同于所有 CLI 都能执行 one-shot 命令。
- 文档：`.ch/docs/product-specs/FEATURE_INVENTORY.md`、`.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md`、`.ch/docs/design-docs/vscode-cli-extension-runtime.md`、`.ch/docs/ontology/domains/cli-plugin-runtime.json`。
- 配置与脚本：无新增用户设置，无构建或发布脚本修改。

## 风险与缓解

- 重复生成/资源泄漏：以首次提交身份去重，失败也消费该次尝试；设置受限执行、超时和清理，不能依赖 hover 触发。
- session 接管与迟到写入：捕获工作区、Tab、任务/会话身份及有效代际，写回前重验；绑定迁移时保留摘要，关闭/重置/工作区切换立即失效。
- CLI 协议或主对话污染：独立摘要 session 不复用原 thread，不注入聊天气泡、工具操作或 Loop 汇报；不支持的调用安全缺失，不绕过参数守卫。
- 无效/危险文本：校验纯文本与码点长度，安全渲染，不执行 Markdown/HTML；失败不回落原提示截断。
- 回滚：移除摘要接入和浮层消费即可退回既有 Tab；可选字段缺失应天然兼容，既有会话/消息不需破坏性迁移。

## 验证结果与原始证据

下列实现验证由运行时/UI 交付者及主审执行；文档收口只读复核日志、代码和图片，没有重建 `dist` 或重新调用真实 CLI。E1/E2/E4 测试有重叠，不能相加为独立测试总数。

### E1 运行时与合并回归

运行时交付者执行 `npm run build` 与以下 15 个相关测试，281/281 通过，0 失败/跳过，日志 `/tmp/tab-summary-runtime-final-tests.log`；随后单独执行 tooltip 用例 18/18 通过。主审在当前合并代码上重建并运行相同组加 tooltip，299/299 通过，0 失败/跳过，日志 `/tmp/tab-summary-main-review.XXXXXX.log`（文件名中的 XXXXXX 是实际字面值）。复核命令为：

```sh
npm run build && node --test \
  dist/test/session/conversationTaskSummary.test.js \
  dist/test/session/sessionStoreCoreCoverage.test.js \
  dist/test/session/sessionLifecycleCoreCoverage.test.js \
  dist/test/session/sessionTabCliSwitch.test.js \
  dist/test/session/conversationTabLock.test.js \
  dist/test/interactive/manager.test.js \
  dist/test/interactive/codexRunnerRuntime.test.js \
  dist/test/interactive/dshRunner.test.js \
  dist/test/interactive/kimiRunner.test.js \
  dist/test/interactive/zcodeRunner.test.js \
  dist/test/interactive/grokRunner.test.js \
  dist/test/interactive/claudeRunner.test.js \
  dist/test/cli/commandRunnerCoreBranches.test.js \
  dist/test/cli/commandRunnerCoverage.test.js \
  dist/test/cli/cliRunArgStrategies.test.js \
  dist/test/webview/conversationtabsummarytooltip.test.js
```

新增 `src/test/session/conversationTaskSummary.test.ts` 及存储/生命周期/Kimi 权限回归已核对：覆盖首次可见需求跨 Loop 改写、完成前异步接收、去重、Unicode、异常输出、队列边界、超时释放、迟到结果、重置立即新任务、多 Tab、旧记录/重载、绑定/迁移、配置快照、权限拒绝和 final-only 输出。七 CLI 适配测试不等于七 CLI 真实 provider 联调。

### E2 UI 专门回归

`src/test/webview/conversationtabsummarytooltip.test.ts` 的 18 项测试执行生成脚本中的实际分页、控制器和完整 Tab 渲染；核对了 999/1000ms、快速切换、重绘续计时/焦点、监听器有界、关闭/分页/Escape/失焦、缺失字段、纯文本、窄屏/向上翻转/极矮钳制以及原 Tab 状态操作。主审 E1 已包含这 18 项，不再额外累加。

### E3 真实隔离 Codex 调用

`/tmp/tab-summary-runtime-real-call.log` 记录调用实际 `captureConversationTaskSummaryExecution` 编译产物，仅 VS Code API 为 mock，Codex binary/app-server/provider 为真实调用；独立 session、`model: null`、`thinkingMode: off`，外部安全取消上限 45 秒（不是协调器的 20 秒活动超时）。需求“请修复登录失败时丢失输入内容的问题，并保留用户填写的表单以便重新提交。”得到“修复登录失败后输入丢失问题，保留表单便于重试”，22 Unicode 码点，6348 毫秒，未取消；`isolatedRootRemoved: true` 且收口时目录已不存在。该 smoke 验证真实隔离归纳，不冒称完整扩展宿主/主任务/浮层端到端。

### E4 完整生成 Webview 的浏览器与邻近回归

UI 交付者用 `node_modules/.bin/tsc -p ./ --outDir /tmp/tab-summary-round3-U5mBKa-dist --pretty false` 严格编译到独立临时目录；以 `NODE_PATH="$PWD/node_modules" node --test` 运行该目录下 `test/webview/conversationtabsummarytooltip.test.js`、`test/session/conversationTabPagination.test.js`、`test/session/conversationTabLock.test.js`、`test/webview/codexLongConnectionTooltip.test.js`、`test/webview/looppluswebviewintegration.test.js`，41/41 通过。原始结果 `/tmp/tab-summary-round3-U5mBKa-evidence/node-tests.log` 已复核；这组与 E1/E2 重叠，不相加。

`NODE_PATH="$PWD/node_modules" node /tmp/tab-summary-round3-U5mBKa-evidence/browser-check.cjs` 生成实际 `getWebviewHtml` 的完整 HTML/CSS/脚本，mock VS Code bridge、宿主 state 和主题变量，以 headless Chromium 验证 960×720 / 280×640 × 深/浅主题四组合。`/tmp/tab-summary-round3-U5mBKa-evidence/browser-results.json` 及检查脚本已核对，覆盖 999/1000ms、布局不变、ARIA、Escape、重绘/焦点、Enter/选择、空摘要、安全文本、向上定位、resize、无 hover 请求/运行错误。该目录 `theme-viewport-contact-sheet.png` 已目视复核；8 张有效截图为 `dark-960.png`、`dark-960-above.png`、`light-960.png`、`light-960-above.png`、`dark-280.png`、`dark-280-above.png`、`light-280.png`、`light-280-above.png`。目录中的早期 `failure.png` 不属于最终四组合通过证据。

### 失败处理与验证限制

- 运行时早期测试的目标版本不兼容写法/夹具参数及真实 Codex final-marker 流式边界已由实现者修复，并进入最后 281/299 通过结果；没有把早期失败混写成最终失败或修改无关实现。
- 其他六种 CLI 没有真实 provider 调用，只有适配/协议/配置/权限测试；没有完整 VS Code 扩展宿主端到端联动。
- 简体中文依赖提示要求与真实样例；实现校验汉字/纯文本并按码点限长，没有确定性繁简转换，不声称任意 provider 的输出都能转换。
- 没有运行无关全量测试；临时日志和图片是本机收口时已核对的原始材料，未打包为长期仓库产物。

## 测试与清单同步

- 初始文档阶段：功能以 in-progress、5 条新 ontology 记录以 proposed 登记；当时只有文档检查通过，不能代表实现完成。
- 初始文档校验：ontology `--validate` 首次发现新增关系缺少 `cardinality`，补为 `1:0..1` 后通过（2 domains / 17 concepts / 16 relations / 111 rules / 2 workflows）；五份文档空白/diff/13 个新增引用检查通过。当时未运行功能测试/真实 CLI/浏览器，作为历史阶段保留，不是最终状态。
- 最终同步：功能清单与能力分册改为 active，设计改为实际实现，5 条对应 ontology 记录改为 schema 认可的 active 并补齐真实源码/测试 source_refs；本计划置 completed 并归档到月份目录，仓库内旧活动路径引用同步迁移。
- 收口文档检查（2026-11-07）：ontology `--validate` 通过（2 domains / 17 concepts / 16 relations / 111 rules / 2 workflows）；五份文档空白/diff 检查通过，18 个仓库路径引用和 5 条 active 记录的 31 个 source_refs/已有锚点检查通过，旧活动计划文件及路径引用均无残留。具体命令与最终结果写入本轮指定执行报告，不重跑 E1–E4。

## 任务列表

- [x] 核对文档规则、ontology status/query 和现有源码入口。
- [x] 交付执行计划、用户行为规格、运行时设计及 ontology 更新并验证。
- [x] 收集运行时实现与相关单元/真实 CLI 验证。（E1/E3，保留六 CLI 未真实联调限制）
- [x] 收集前端实现与自动/浏览器验收证据。（E2/E4，非完整 VS Code 端到端）
- [x] 依据主审及原始材料逐项回填验收，标记 completed 并按月份归档；保留未验证限制。

## 决策记录与当前结论

- 2026-11-07：沿用已确定的产品与数据契约，无新增用户开关；区分现有提示词标签与计划中的 AI 摘要。
- 2026-11-07 初始阶段：文档/本体交付完成，但实现与真实验证尚待收集，保持活动状态而不提前归档。
- 2026-11-07 最终阶段：读取父任务最新 communicationFile，复核运行时/UI/文档三份交付报告、当前源码、主审 299/299 日志、真实 Codex 与浏览器原始材料后完成收口。范围内功能已交付；六 CLI 真实 provider、完整扩展宿主端到端、确定性繁简转换和无关全量测试未验证，不列为已完成证据。
