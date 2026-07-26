# Graph DAG 边去重与标签单行显示

- 日期：2026-07-25
- 状态：completed
- 负责人：Codex
- owner：Codex
- claimed_at：2026-07-25
- claim_ttl：1d
- handoff_to：

## 背景

Graph 图当前允许同一方向的重复连线，正反向边也可能复用同一组连接点，边标签会被拆成多行显示，导致画布可读性下降。

## 目标

让 Graph DAG 视图在任意两个节点之间每个方向最多渲染一条线；当正反向都存在时，两条线必须使用不同连接点；边上文字保持单行显示。

## 范围

本次只覆盖 Graph run Webview DAG 的视觉渲染、拖拽后连线路径重算和相关单元测试。

## 非目标

- 不改变 Graph 运行、调度、存储 schema。
- 不删除原始 Graph edge 数据。
- 不重做整体 Graph UI 布局。

## 验收标准

- [x] 同一 `from -> to` 方向的重复边在 Graph 图中只渲染一条。
- [x] 同一节点对若同时存在 `A -> B` 和 `B -> A`，两条边在 A、B 两侧均使用不同端口。
- [x] SVG 边标签只输出单个 `<textPath>`，不拆成上下两行。
- [x] 相关单元测试和 Node build 通过。

## 影响面

- 代码目录：`src/webview/graphRunPanel.ts`
- 测试目录：`src/test/graphRunPanel.test.ts`
- 文档目录：`.ch/docs/product-specs/FEATURE_INVENTORY.md`

## 风险与缓解

- 风险：服务端初始布局与 Webview 拖拽后的客户端重算端口规则不一致。
- 缓解：两边使用同样的 port hint 数据属性，并在测试中断言 HTML 输出。

## 验证计划

- 最小相关验证：`node --test dist/test/graphRunPanel.test.js`
- 单元自测命令：`npm run build`
- 扩展验证：`git diff --check`

## 测试与清单同步

- 单元测试新增/更新：已更新 `src/test/graphRunPanel.test.ts`，覆盖同向边去重、双向端口分离和单行标签。
- 单元自测结果：`npm run build` 通过；`node --test dist/test/graphRunPanel.test.js` 13/13 通过；`git diff --check` 通过。
- 失败处理记录：无
- 功能清单：已更新 `.ch/docs/product-specs/FEATURE_INVENTORY.md`、`.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md` 和 `docs/插件功能清单.md`。
- 相关文档同步：已同步 Graph DAG 可视化边去重、双向端口和单行标签口径。

## 任务列表

- [x] 定位并修改 Graph DAG 边渲染、端口选择和标签格式逻辑。
- [x] 更新 Graph Run Panel 单元测试覆盖重复边、正反向端口和单行标签。
- [x] 同步功能清单/事实来源文档并执行 build、相关测试、diff 检查。
- [x] 将执行计划归档到 completed。

## 决策记录

- 2026-07-25：只对 DAG 可视化边做方向去重，保留原始 run edge 数据，避免影响调度和历史记录。

## 当前结论

已完成：Graph DAG 视觉层每个方向只渲染一条代表边；双向边通过 `data-edge-port-hint` 使用不同端口；边标签只输出单行 `<textPath>`。验证命令均通过。
