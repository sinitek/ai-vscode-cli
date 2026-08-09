# 历史提示词收藏与过滤

- 日期：2026-08-09
- 状态：completed
- 负责人：Codex
- owner：Codex
- claimed_at：2026-08-09
- claim_ttl：1d
- handoff_to：

## 背景

历史记录弹窗已经包含“历史提示词”页签，但提示词只能查看、展开和复用，缺少固定常用提示词的能力。

## 目标

为历史提示词增加收藏能力，并在弹窗内提供“仅收藏”过滤，让用户能快速复用高频提示词。

## 范围

- 历史提示词存储结构新增可兼容的收藏字段。
- Webview 历史提示词列表增加收藏切换、收藏状态展示和仅收藏过滤。
- Extension Host 增加收藏切换消息处理并刷新面板状态。
- 同步 i18n、样式、功能清单和最小相关测试。

## 非目标

- 不改变会话历史列表。
- 不新增跨设备同步、搜索、标签或排序配置。
- 不改变提示词历史的记录入口和保留周期。

## 验收标准

- [x] 历史提示词每条记录可切换收藏状态，刷新后仍保留。
- [x] “仅收藏”过滤开启后只展示收藏提示词，且空态文案准确。
- [x] 清空提示词按确认流程只清空未收藏项，收藏提示词会保留。
- [x] 新旧历史提示词文件可正常归一化读取，缺失收藏字段默认为未收藏。
- [x] 最小相关测试和构建通过。

## 影响面

- 代码目录：`src/promptHistoryStore.ts`、`src/extensionHost/modelSettings.ts`、`src/sessionMessageHandlers.ts`、`src/webview/`
- 文档目录：`.ch/docs/product-specs/FEATURE_INVENTORY.md`
- 配置与脚本：无预期变更

## 风险与缓解

- 风险：新增存储字段影响历史文件读取。
- 缓解：归一化时默认 `favorite:false`，写回当前结构。
- 风险：Webview 状态更新后过滤和展开状态不一致。
- 缓解：渲染时基于过滤后列表校正展开 ID，并补充运行时覆盖测试。

## 验证计划

- 最小相关验证：`npm run build`
- 单元自测命令：`node --test dist/test/promptHistoryStore.test.js dist/test/sessionMessageHandlersCoreCoverage.test.js dist/test/clipagescriptruntimecoverage.test.js`
- 扩展验证：`npm run build`

## 测试与清单同步

- 单元测试新增/更新：新增 `src/test/promptHistoryStore.test.ts`；更新 `src/test/sessionMessageHandlersCoreCoverage.test.ts`、`src/test/clipagescriptruntimecoverage.test.ts`
- 单元自测结果：`npm run build` 通过；`node --test dist/test/promptHistoryStore.test.js dist/test/sessionMessageHandlersCoreCoverage.test.js dist/test/clipagescriptruntimecoverage.test.js` 33/33 通过
- 失败处理记录：无
- 功能清单：已同步 `.ch/docs/product-specs/FEATURE_INVENTORY.md`
- 相关文档同步：已同步 `.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md`

## 任务列表

- [x] 确认历史提示词数据流和 UI 入口
- [x] 实现收藏字段、切换消息和仅收藏过滤
- [x] 补充测试、功能清单并执行验证

## 决策记录

- 2026-08-09：收藏状态作为提示词历史记录字段持久化；“仅收藏”过滤作为 Webview 本地视图状态，不写入设置。

## 当前结论

已完成历史提示词收藏与仅收藏过滤：存储层新增兼容 `favorite` 字段，Host 新增收藏切换消息，Webview 增加星标按钮、仅收藏过滤、收藏计数和空态文案；后续补充要求已将手动清空、30 天 retention 和数量上限裁剪改为保留收藏项；构建和最小相关测试均通过。
