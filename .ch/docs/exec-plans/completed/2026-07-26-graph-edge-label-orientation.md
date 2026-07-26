# Graph 边标签方向修复

- 日期：2026-07-26
- 状态：completed
- 负责人：Codex
- owner：Codex
- claimed_at：2026-07-26
- claim_ttl：1d
- handoff_to：

## 背景

Graph DAG 图上的边标签跟随 SVG path 时，反向或路径方向变化会导致文字出现垂直镜像翻转，阅读方向不稳定。

## 目标

让 Graph DAG 边上的文字保持稳定正向显示，同时保留已实现的边去重、双向边连接点分离和单行标签行为。

## 范围

本次仅覆盖 Graph 运行面板的 DAG 边标签渲染和相关单元测试。

## 非目标

不重做 Graph 布局算法，不改变边数据模型，不处理非 DAG 面板样式。

## 验收标准

- [x] 反向边标签不会垂直镜像翻转。
- [x] 线上的文字仍保持单行显示。
- [x] 既有同向去重和双向连接点分离测试保持通过。

## 影响面

- 代码目录：`src/webview/graphRunPanel.ts`
- 文档目录：`.ch/docs/product-specs/FEATURE_INVENTORY.md` 等功能清单按需同步
- 配置与脚本：无

## 风险与缓解

- 风险：改变 SVG label 的绑定方式可能影响拖动后标签位置。
- 缓解：复用现有路径几何，补充快照/结构断言并运行相关测试。

## 验证计划

- 最小相关验证：`node --test dist/test/graphRunPanel.test.js`
- 单元自测命令：`npm run build`
- 扩展验证：`git diff --check`

## 测试与清单同步

- 单元测试新增/更新：`src/test/graphRunPanel.test.ts` 已更新，覆盖无 `<textPath>`、固定坐标标签、拖拽后标签坐标同步更新和双向边反向标签。
- 单元自测结果：`npm run build` 通过；`node --test dist/test/graphRunPanel.test.js` 13/13 通过；`git diff --check` 通过。
- 失败处理记录：无
- 功能清单：已同步 `.ch/docs/product-specs/FEATURE_INVENTORY.md`、`.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md`、`docs/插件功能清单.md`。
- 相关文档同步：已记录标签保持正向、单行和拖拽后标签坐标重算行为。

## 任务列表

- [x] 定位当前边标签渲染和拖动更新路径。
- [x] 修复标签方向，避免反向路径导致文字镜像。
- [x] 更新相关测试和文档记录。
- [x] 运行构建、相关测试和 diff 校验。

## 决策记录

- 2026-07-26：只在 DAG 可视层处理标签方向，不改变 Graph 边数据。
- 2026-07-26：边标签从 `textPath` 改为路径中点坐标定位的 SVG `text`，保持水平正向；拖拽节点时同步更新 `x/y`。

## 当前结论

已完成：Graph DAG 边标签保持正向单行显示，反向边不会随 path 镜像翻转；相关测试、文档和验证均已完成。
