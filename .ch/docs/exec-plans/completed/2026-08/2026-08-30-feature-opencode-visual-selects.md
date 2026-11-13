# OpenCode 可视化下拉组件统一 — 新功能开发

- 日期：2026-08-30
- 状态：completed
- 负责人：Codex
- owner：Codex
- claimed_at：2026-08-30
- claim_ttl：已完成
- 类型：feature


### 背景

OpenCode 配置可视化编辑器中的 Provider `npm` 使用原生 `input + datalist`，在 VS Code Webview 中无法稳定展示建议；Claude 和 Codex 可视化编辑器仍使用原生 `<select>`，与 OpenCode 主模型使用的可搜索单选控件不一致。

### 目标

- 为 OpenCode Provider `npm` 提供官方内置 npm loader 建议，并保留任意自定义 npm 包输入值。
- 将可视化配置中的单值下拉统一为现有 Ant Design `Select` 组件；多值思考力度继续使用同一组件的 tags 模式。
- 保持未知/历史值可回显、可保存，且不改变配置字段语义。

### 范围

- `media/config/assets/config-app-ui.js` 中 Claude、OpenCode、Codex 可视化编辑器及配置复制弹窗的选择控件。

### 非目标

- 不改变 OpenCode CLI 版本、运行时 provider 加载逻辑或配置字段结构。
- 不把 `provider.npm` 限制为封闭枚举；用户仍可输入官方列表之外的包名。
- 不改造模型文本字段、复选框、标签页或 MCP/Skills 交互。

### 验收标准

- [x] npm 字段使用与主模型相同的可搜索、可清除单选 `Select`，打开时能看到官方建议。
- [x] Claude、OpenCode、Codex 可视化单值下拉和配置复制目标下拉不再渲染原生 `<select>`。
- [x] 当前值不在建议列表时仍作为兼容选项回显并可保存；自定义 npm 值不丢失。

### 影响面

- 代码目录：`media/config/assets/`。

### 风险与缓解

- 风险：Select 的选项列表若不包含旧值，切换配置时会清空值。
  - 缓解：统一适配器在渲染前追加当前值兼容选项，并保持序列化原样合并。
- 风险：官方 loader 列表持续变化。
  - 缓解：将列表定义为建议而非校验枚举，保留任意 npm；在测试中锁定当前官方建议的关键集合。
- 风险：原生 `<select>` 依赖 DOM `value` 读取（复制弹窗）。
  - 缓解：改用受控 Select，并通过显式状态读取目标平台。

### 决策记录

- 2026-08-30：官方 `provider.npm` 类型为字符串，列表仅作为建议；采用 `anomalyco/opencode` `dev` 分支 `packages/opencode/src/provider/provider.ts`（SHA `b5980f15873b22647b03aa75fe450e2344aed5b9`，2026-08-30）中的 `BUNDLED_PROVIDERS` loader 名称作为建议集合。
- 2026-08-30：复用已有 `renderOpenCodeSelect` 的 Ant Design `Select` 语义，单值字段统一到同一适配器；思考力度保留 tags 多选能力，并通过可编辑 Select 模式保留任意自定义 npm 值。

### 当前结论

已完成。OpenCode Provider `npm` 现在使用与主模型 `model` 相同的 Ant Design 可搜索单值 Select，展示官方 24 个 bundled loader 建议，同时接受并保存任意自定义 npm 包。Claude、OpenCode、Codex 可视化单值下拉及配置复制入口均复用统一 Select 适配器；旧值和未知值会以兼容选项回显，思考力度 tags 多选行为保持不变。

## 分类依据与真实状态

feature（替换原 refactor 判定）：原文目标和当前结论明确新增24个loader建议、可搜索/可清除和自定义npm输入，原原生下拉/不稳定datalist的外部交互改变；字段/未知值兼容不等于外部行为完全不变。同一Select适配是该功能的实现，不另造独立refactor。既有 test/docs 拆分与37/37、28/28、177/177、Chromium未执行事实沿用。

当前记录继承 `completed`；本轮仅语义拆分/命名迁移，未执行上述历史业务命令，不改变失败、阻塞或未发布结论。

## 测试类型记录清理

2026-11-11 按用户明确授权删除本来源的 test 类型计划；历史验证命令、结果、失败、跳过与限制见 [测试计划删除审计](../../migrations/test-plan-removals/2026-11-11-jul-sep.json)（按原来源路径检索）。本记录的作者、日期、状态与历史结果不变，不接回独立测试开发，也不表示本轮重跑历史命令。
