# OpenCode 可视化下拉组件统一

- 日期：2026-08-30
- 状态：completed
- 负责人：Codex
- owner：Codex
- claimed_at：2026-08-30
- claim_ttl：已完成

## 背景

OpenCode 配置可视化编辑器中的 Provider `npm` 使用原生 `input + datalist`，在 VS Code Webview 中无法稳定展示建议；Claude 和 Codex 可视化编辑器仍使用原生 `<select>`，与 OpenCode 主模型使用的可搜索单选控件不一致。

## 目标

- 为 OpenCode Provider `npm` 提供官方内置 npm loader 建议，并保留任意自定义 npm 包输入值。
- 将可视化配置中的单值下拉统一为现有 Ant Design `Select` 组件；多值思考力度继续使用同一组件的 tags 模式。
- 保持未知/历史值可回显、可保存，且不改变配置字段语义。

## 范围

- `media/config/assets/config-app-ui.js` 中 Claude、OpenCode、Codex 可视化编辑器及配置复制弹窗的选择控件。
- `src/test/config/opencodeconfigvisualeditor.test.ts`、相关视觉编辑器静态契约测试。
- OpenCode 配置产品规格、功能清单与本执行计划。

## 非目标

- 不改变 OpenCode CLI 版本、运行时 provider 加载逻辑或配置字段结构。
- 不把 `provider.npm` 限制为封闭枚举；用户仍可输入官方列表之外的包名。
- 不改造模型文本字段、复选框、标签页或 MCP/Skills 交互。

## 验收标准

- [x] npm 字段使用与主模型相同的可搜索、可清除单选 `Select`，打开时能看到官方建议。
- [x] Claude、OpenCode、Codex 可视化单值下拉和配置复制目标下拉不再渲染原生 `<select>`。
- [x] 当前值不在建议列表时仍作为兼容选项回显并可保存；自定义 npm 值不丢失。
- [x] 相关单测、`npm run build`、静态语法检查和差异检查通过。

## 影响面

- 代码目录：`media/config/assets/`。
- 测试目录：`src/test/config/`。
- 文档目录：`.ch/docs/product-specs/FEATURE_INVENTORY.md`、`.ch/docs/product-specs/sinitek-cli-plugin-capabilities.md`。

## 风险与缓解

- 风险：Select 的选项列表若不包含旧值，切换配置时会清空值。
  - 缓解：统一适配器在渲染前追加当前值兼容选项，并保持序列化原样合并。
- 风险：官方 loader 列表持续变化。
  - 缓解：将列表定义为建议而非校验枚举，保留任意 npm；在测试中锁定当前官方建议的关键集合。
- 风险：原生 `<select>` 依赖 DOM `value` 读取（复制弹窗）。
  - 缓解：改用受控 Select，并通过显式状态读取目标平台。

## 验证计划

- 最小相关验证：`node --test dist/test/config/opencodeconfigvisualeditor.test.js dist/test/config/claudeConfigVisualEditor.test.js dist/test/config/codexConfigVisualEditor.test.js`。
- 单元自测命令：`npm run build`。
- 扩展验证：`node --check media/config/assets/config-app-ui.js`、`git diff --check`、Ontology 校验。

## 测试与清单同步

- 单元测试新增/更新：更新 npm 建议和统一 Select 静态契约，覆盖 Claude/Codex/OpenCode 下拉不再使用原生 `<select>`。
- 单元自测结果：`npm run build` 通过；定向视觉编辑器测试 `37/37` 通过；配置页面覆盖测试 `28/28` 通过；`npm run test:page` `177/177` 通过；`node --check media/config/assets/config-app-ui.js`、`git diff --check` 和 `npm run validate:whitespace` 均通过。
- 失败处理记录：无失败。Chromium smoke 不适用：本配置页运行在 VS Code Webview，没有可直接启动的 HTTP 前后端入口；已由静态契约、构建和页面测试覆盖。
- 功能清单：同步三组 CLI 可视化配置描述。
- 相关文档同步：同步 OpenCode 官方 npm loader 建议和“可扩展输入”边界。

## 任务列表

- [x] 更新官方 npm 建议与统一 Select 适配器。
- [x] 替换三组可视化编辑器及复制弹窗的原生下拉并更新测试。
- [x] 同步产品文档、运行验证并归档计划。

## 决策记录

- 2026-08-30：官方 `provider.npm` 类型为字符串，列表仅作为建议；采用 `anomalyco/opencode` `dev` 分支 `packages/opencode/src/provider/provider.ts`（SHA `b5980f15873b22647b03aa75fe450e2344aed5b9`，2026-08-30）中的 `BUNDLED_PROVIDERS` loader 名称作为建议集合。
- 2026-08-30：复用已有 `renderOpenCodeSelect` 的 Ant Design `Select` 语义，单值字段统一到同一适配器；思考力度保留 tags 多选能力，并通过可编辑 Select 模式保留任意自定义 npm 值。

## 当前结论

已完成。OpenCode Provider `npm` 现在使用与主模型 `model` 相同的 Ant Design 可搜索单值 Select，展示官方 24 个 bundled loader 建议，同时接受并保存任意自定义 npm 包。Claude、OpenCode、Codex 可视化单值下拉及配置复制入口均复用统一 Select 适配器；旧值和未知值会以兼容选项回显，思考力度 tags 多选行为保持不变。

产品规格、功能清单和测试契约已同步。验证结论：`npm run build`、定向视觉编辑器测试（37/37）、配置页面覆盖测试（28/28）、`npm run test:page`（177/177）、`node --check media/config/assets/config-app-ui.js`、`git diff --check`、`npm run validate:whitespace` 均通过。Chromium smoke 因配置页仅运行于 VS Code Webview 且无独立 HTTP 服务未执行，已记录为不适用。
