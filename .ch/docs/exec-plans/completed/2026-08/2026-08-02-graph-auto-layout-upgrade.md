# Graph 模式自动布局升级

- 日期：2026-08-02
- 状态：completed
- 负责人：Codex
- owner：Codex
- claimed_at：2026-08-02
- claim_ttl：本轮任务
- handoff_to：无

## 背景

当前 VS Code 插件 graph 模式的可视化图在 `src/webview/graphRunPanel.ts` 内使用本地 DAG 布局算法。用户要求参考目标系统 `/Users/fangjiawei/sinitek/sinitek-zhiqiu-workspace` 的工作流自动布局能力，把目标系统的工作流自动布局行为迁移过来，并根据本插件 graph 展示场景合理调整参数。

## 目标

升级 graph 模式可视化图的自动布局算法，使节点分层、同层排序、边路由和画布留白尽量对齐目标系统工作流画布的自动布局体验，同时保持 VS Code webview 内的无外部运行时依赖实现。

## 范围

- 当前仓库 graph 模式布局实现与渲染参数。
- 目标系统工作流画布自动布局算法、参数默认值与节点/边坐标处理方式。
- 与布局直接相关的测试、类型检查和功能清单文档同步。

## 非目标

- 不改 graph 运行时调度、状态机、CLI 执行链路。
- 不引入新的前端框架或替换当前 SVG 渲染方案。
- 不迁移目标系统完整工作流编辑器 UI。

## 验收标准

- [x] graph 模式自动布局算法对齐目标系统工作流自动布局核心能力。
- [x] 默认间距、边距和多父节点排序参数适配当前 graph 节点尺寸。
- [x] 关键布局函数有相关单元测试或现有测试覆盖被更新。
- [x] `npm run build` 或项目认可的最小相关构建/测试命令通过，若失败则记录原因。
- [x] 用户可见能力文档按需同步，若无需同步则记录原因。

## 影响面

- 代码目录：`src/webview/`
- 文档目录：`.ch/docs/exec-plans/active/`、`.ch/docs/product-specs/`
- 配置与脚本：未新增依赖；`package.json` 仅存在本轮开始前已在工作区中的版本号改动。

## 风险与缓解

- 风险：目标系统使用 React Flow / dagre 运行时，本插件 webview 是字符串模板与 SVG，不能直接复制 UI 依赖。
- 缓解：迁移目标系统的布局策略与参数语义，在当前无依赖 DAG 布局内实现等价行为。
- 风险：布局变化影响已有 graph 状态面板可读性。
- 缓解：保留现有节点尺寸与语义样式，只调整坐标生成、层内排序、边路由和画布尺寸。

## 验证计划

- 最小相关验证：新增/更新布局纯函数单元测试，覆盖串行、分支汇聚、孤立/循环兜底场景。
- 单元自测命令：`node --test dist/test/graphRunPanel.test.js`。
- 扩展验证：`npm run build`。

## 测试与清单同步

- 单元测试新增/更新：已更新 `src/test/graphRunPanel.test.ts`，覆盖工作流式布局间距、碰撞消解和动态节点高度。
- 单元自测结果：`npm run build` 通过；`node --test dist/test/graphRunPanel.test.js` 15/15 通过；`git diff --check` 通过。
- 失败处理记录：无失败。
- 功能清单：已更新 `.ch/docs/product-specs/FEATURE_INVENTORY.md`。
- 相关文档同步：已更新 `.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md`、`.ch/docs/design-docs/graph-orchestration-mode.md` 和 `docs/插件功能清单.md`。

## 任务列表

- [x] 阅读仓库规则、执行计划规则与 CodeGraph 规则。
- [x] 定位当前 graph 模式可视化入口。
- [x] 对比目标系统工作流自动布局算法与参数。
- [x] 迁移并调整布局算法。
- [x] 增加或更新测试。
- [x] 执行构建/测试并同步必要文档。

## 决策记录

- 2026-08-02：使用 CodeGraph 定位当前 graph 模式入口，确认主实现位于 `src/webview/graphRunPanel.ts`。
- 2026-08-02：默认不新增运行时依赖，优先把目标系统布局策略迁移为当前 webview 可直接执行的 TypeScript 纯逻辑。

## 当前结论

已完成。GraphRunPanel 自动布局已迁移目标系统工作流画布的 dagre 配置、碰撞消解、动态节点高度和拓扑兜底策略，并按当前紧凑节点尺寸调参。构建、相关单测和空白检查均通过。
