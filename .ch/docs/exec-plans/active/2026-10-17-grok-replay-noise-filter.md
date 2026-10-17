# Grok 回放降噪与分片合并

- 日期：2026-10-17
- 状态：in-progress
- 负责人：Codex

## 背景与目标

用户反馈 Grok 执行时回放 JSON 过多。当前 `GrokInteractiveRunner` 把每条 `session/update` 原样转发给回放；Webview 每次追加独立记录并刷新。本机真实 ACP 采样仅请求回复 OK，已有 6 条事件、23664 字节：3 条 `available_commands_update`、1 条 `session_info_update`、1 条正文和1条回合结果。元数据通知并非任务执行证据。

## 范围与非目标

- 在 Grok 回放出口过滤已确认的命令目录、会话标题通知及空文本，合并连续同源正文/思考分片，跳过连续完全相同的工具/计划快照。
- 保留工具状态/输入/输出、计划变化、未知/非文本事件、完成与失败结果，保持原有 ACP JSON 结构。
- 不改变正文、思考、工具气泡的实时处理，不修改其他 CLI、界面、用户配置或依赖。

## 验收标准

- 已确认的两类无关元数据不进入回放，连续文本内容和空白不丢失。
- 合并不跨会话、事件类型、内容元数据、工具和回合边界；限制等待时间与缓冲大小。仅传输级 `eventId`、`chunkId`、`agentTimestampMs` 不作为分片边界，合并后保留最后一片 `_meta`。
- 成功、错误、取消、进程失败都清理缓冲；复用 runner 不串回合。
- 相关单测、构建、ontology 和空白校验通过；完成最小真实 Grok 验证并记录降噪结果。

## 影响面与风险

- 代码：`src/interactive/grokReplayStream.ts`、`src/interactive/grokRunner.ts`、对应测试。
- 文档：CLI 运行时参考、能力清单、功能总表和现有 CLI 本体概念。
- 风险：过度过滤损失诊断信息、合并跨语义边界、定时器泄漏。仅过滤本机观察到的无关事件，未知事件保留；严格匹配非文本字段并在关键边界 flush。
- 回滚：移除 Grok 回放过滤器接线，恢复原始事件转发；不涉及数据或配置迁移。

## 验证计划与测试同步

- 新增过滤器单测，覆盖过滤、连续分片、空白、事件顺序、体积/时间上限、未知与非文本内容、重复与变化快照。
- 更新 runner 回归测试，覆盖正常结束、失败、取消、复用及气泡不变。
- 命令：`npm run build`；`node --test dist/test/interactive/grok*.test.js dist/test/extensionHost/grokCliHostWire.test.js`；按影响面补充回放与宿主测试。
- 本机验证：通过已有 Grok ACP runner 请求仅回复 OK、禁止调用工具；只记录类型、数量、字节与结果，不保存私有原始载荷。
- 文档校验：ontology `--validate`、相关 ontology 单测、`git diff --check` 与范围空白校验。
- 不改 UI 和用户文案，无需浏览器或新增 i18n；不修复既有缺失设计文档、过期 CodeGraph 索引等范围外问题。

## 当前进展

- 已完成 bounded memory recall、ontology 查询、CodeGraph 尝试和当前源码核对。CodeGraph 未索引 Grok 新文件，故直接检查当前实现。
- 已完成过滤器、runner 接线和回归测试，同步 CLI 运行时参考、功能总表、能力分册及已有面板本体概念。无新用户文案，不改 i18n。
- 首轮真实长回复暴露 `params._meta.eventId`、`chunkId` 每片变化，导致严格全字段匹配无法合并；进一步采样确认真实字段结构后，仅排除这两项及传输时间戳，补足真实格式回归，保留其他未知元数据边界。
- `npm run build`：通过。首次构建出现新测试调用 timer mock 的类型错误（项目是 Node 18 类型声明，本机是 Node 22 API），调整调用方式后重跑通过，属于本次测试实现兼容问题，未更新依赖。
- 相关 Grok、宿主、Webview 回放/导出测试：`node --test dist/test/interactive/grok*.test.js dist/test/extensionHost/grokCliHostWire.test.js dist/test/extensionHost/promptInteractiveRuntime.test.js dist/test/webview/panelFileActions.test.js dist/test/webview/clipagescriptruntimecoverage.test.js`，135/135 通过。
- ontology 校验失败 15 条；ontology 单测 8/9 通过，唯一失败是当前本体全量引用完整性。已通过相同 validator 在内存加载 `git show HEAD:<path>` 基线比较，基线与当前均为同样的 15 条既有缺失设计文档引用，没有新增问题；不扩范围修复。
- 最终真实 Grok 采样与空白检查完成后归档。
