# 历史会话模式筛选标签

- 日期：2026-11-27
- 类型：feature
- 关联计划：无
- 状态：completed
- 负责人：Codex
- owner：
- claimed_at：
- claim_ttl：
- handoff_to：

## 背景

历史会话目前只有过滤子任务复选框，无法按 Vibe、Loop、Loop+ 和产研部查看。任务归属需使用宿主读取的 Loop 任务记录准确投影，产研部标签仅展示总监主会话。

## 目标

新增“全部、Vibe、Loop、Loop+、产研部”标签筛选。全部保留 Vibe 和各模式的主任务；Loop、Loop+ 仅显示各自主任务；产研部仅显示总监主会话。所有筛选继续叠加关键词搜索。

## 范围

- 宿主按 CLI、会话 ID 和任务记录为历史会话投影模式与主/子任务身份。
- 历史会话弹窗提供五个可访问标签，默认选择“全部”。
- 更新相关回归测试、功能清单和本体规则。

## 非目标

- 不更改历史会话数据、会话角色标记、任务生命周期或子任务执行逻辑。
- 不调整提示词历史页或搜索行为。

## 验收标准

- [x] 标签顺序为全部、Vibe、Loop、Loop+、产研部。
- [x] 全部隐藏 Loop/Loop+ 子任务及产研部非总监任务，同时保留 Vibe 和主任务。
- [x] Loop、Loop+ 仅显示各自主任务；产研部仅显示总监主任务。
- [x] 模式筛选可与关键词搜索叠加，切换弹窗页签不丢失选择。
- [x] 新增模式映射和界面筛选回归测试通过。

## 影响面

- 代码目录：`src/extensionHost/`、`src/webview/`
- 测试目录：`src/test/session/`、`src/test/webview/`
- 文档目录：`.ch/docs/product-specs/`、`.ch/docs/ontology/`

## 风险与缓解

- 历史记录可能没有可信任务绑定；保守归入 Vibe，不凭标题或提示词猜测任务类型。
- 部门组长/员工不能显示为总监；对有部门元数据的非 director 任务归为内部任务并在全部中隐藏。

## 验证计划

- 最小相关验证：历史会话投影与 Webview 运行时测试。
- 单元自测命令：`npm run build`；`node --test dist/test/session/historySessionMode.test.js dist/test/session/historySessionProjection.test.js dist/test/session/historySessionLoop.test.js dist/test/webview/cliPageStaticRenderCoverage.test.js dist/test/webview/clipagescriptruntimecoverage.test.js`
- 扩展验证：运行 Impeccable detector；检查工作区无关差异不被覆盖。

## 测试与清单同步

- 单元测试新增/更新：新增 `src/test/session/historySessionMode.test.ts`；更新 `src/test/session/historySessionProjection.test.ts`、`src/test/session/historySessionLoop.test.ts`、`src/test/webview/clipagescriptruntimecoverage.test.ts`、`src/test/webview/cliPageStaticRenderCoverage.test.ts`。
- 单元自测结果：`npm run build` 通过；定向运行 337 项测试，337 通过、0 失败；ontology 校验通过，ontology skill 9 项单测通过。
- 失败处理记录：首次定向测试识别出辅助 DOM 夹具缺少模式身份和部门子任务绑定需要排除；已修正实现/夹具并重跑，最终全部通过。一次 shell 测试包装使用了 zsh 保留变量名，导致包装命令报错；测试本身完成且后续重新运行全套命令通过。
- 功能清单：已更新 `.ch/docs/product-specs/FEATURE_INVENTORY.md` 中的历史会话模式筛选说明。
- 相关文档同步：已更新 ontology 历史会话规则；未读取 `~/.sinitek_cli` 中用户运行数据，现有任务绑定测试已覆盖所需模式。

## 任务列表

- [x] 实现宿主历史会话模式映射。
- [x] 实现标签筛选和相关回归测试。
- [x] 更新功能清单与 ontology，完成构建和测试。

## 决策记录

- 2026-11-27：全部标签保留 Vibe 与 Loop/Loop+ 主任务，隐藏子任务和产研部非总监任务；不根据会话标题猜测分类。

## 当前结论

已完成基于 CLI 和会话绑定的模式分类；Loop+ 子任务采用执行会话的实际 CLI 匹配，部门仅根 director 可进入“产研部”，不确定和冲突绑定保守隐藏。全部保留 Vibe 和各模式主任务，隐藏子任务与部门内部任务。`npm run build`、337 项定向测试、ontology 校验及 9 项 ontology 单测通过；Impeccable detector 返回空发现。未读取 `~/.sinitek_cli` 用户数据，未进行 VS Code Extension Host 或 Chromium smoke；本次以现有 Webview 运行时测试和静态 DOM 断言验证界面行为。
