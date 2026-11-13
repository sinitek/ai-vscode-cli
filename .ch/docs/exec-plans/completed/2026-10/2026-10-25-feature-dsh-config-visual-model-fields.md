# DSH 配置可视化公共参数与模型字段 — 新功能开发

- 日期：2026-10-25
- 状态：completed
- 负责人：Codex
- owner：Codex
- 类型：feature

- 迁移来源：`.ch/docs/exec-plans/completed/2026-10/2026-10-25-dsh-config-visual-model-fields.md`（历史标识，原文件已替换）
- 关联计划：原 docs companion `2026-10-25-docs-dsh-config-visual-model-fields.md` 已退役；仅留历史身份与分工，完整校验记录未恢复。[references 索引](../../../references/index.md)仅作导航。
- 测试计划删除审计：[十月历史证据](../../migrations/test-plan-removals/2026-11-11-oct.json)（按本页迁移来源查项；仅保留历史事实，不承担独立测试开发）。

## 历史归档范围

扩展 DSH 可视化模型字段并区分公共参数，保持完整 JSON 往返。 原始日期、状态和类型见头部；原文中的实现约束、验收、追加决策、历史验证、失败及未覆盖边界保留在下方。测试计划移除审计（如头部所列）仅记录历史测试职责与证据，不表示本类型重新执行。

## 原文归属记录

## 背景

- DSH 配置页目前把 provider、baseURL、apiKey 和默认模型等 profile 公共字段放在模型详情区域，模型详情只展示模型 id；这会让用户误以为公共字段属于单个模型，也无法配置官方模型 profile 的名称和上下文窗口。

## 目标

- 公共参数集中显示在可视化编辑器上方，模型列表和右侧详情只编辑 `models[]` 的模型字段；保存和回读继续使用同一份完整 JSON，并对必填模型 id 做校验。

## 范围

- 调整 `media/config/assets/config-app-ui.js` 的 DSH 可视化结构。

- 允许可视化编辑官方已确认且本插件当前支持的 `models[]` 字段：`id`、`name`、`contextWindow`。可选 `maxTokens` 仍只在 JSON 中兼容保留，不在可视化或新范例中生成。`input` 仍固定为当前已验证的 `[text]`；`reasoningEfforts` 与 `compat` 继续按既有兼容逻辑保留和归一化。

- 可选公共字段 `displayName`、`timeoutMs`、`streamIdleTimeoutMs`、`retryPolicy` 继续支持 JSON 兼容读取，但不在可视化或新范例中生成；已有配置显式包含时保存回读并按原契约输出。

- 保持 `apiKeyEnv` 不在可视化表单展示，缺失时规范化为 `SINITEK_DSH_API_KEY`。

## 非目标

- 不修改 DSH 运行时启动、ACP 模型切换或 Loop 路由逻辑。

- 不开放未被当前 DSH 契约验证的顶层字段（如 `headers`、`thinkingBudgets`、`transport`）。

- 不把真实密钥或用户端点写入仓库。

## 验收标准

- [x] 可视化模式上方显示公共参数，模型详情不再显示公共参数；可选公共字段不在表单生成。

- [x] 模型详情可配置模型 `id`、`name`、`contextWindow`；可选 `maxTokens` 仅兼容保留，新增模型只在详情填写必填 `id` 后才能保存。

- [ ] 编辑、保存、重新读取后模型字段不丢失，`acpModel` 仍只能选择已配置模型。

- [ ] 相关测试、构建、空白检查通过。

## 影响面

- 代码目录：`media/config/assets/config-app-ui.js`、`src/cli/dshConfigModels.ts`。

## 风险与缓解

- 风险：旧配置缺少新模型字段时被强制补写不兼容值。

- 缓解：仅对已存在字段保留用户值；新增模型使用官方安全默认值，保存前校验数值与数组格式。

- 风险：草稿模型 id 为空时实时编辑器无法通过严格解析。

- 缓解：保留现有草稿状态，只有保存或切回可视化时执行必填校验。

## 验证计划

- 最小相关验证：`node --test dist/test/config/dshconfigpage.test.js dist/test/cli/dshConfigModels.test.js`。

- 单元自测命令：`npm run build`、`npm run validate:whitespace`、`git diff --check`。

## 测试与清单同步

- 单元自测结果：`npm run build` 通过；可选字段后端 round-trip 脚本和前端 helper round-trip 脚本通过。完整 DSH 测试仍受工作区此前已有的 `DSH_VERIFIED_MODEL_ID` 与 `DSH_RESPONSE_MODEL_ALIAS` 相同导致的别名校验失败影响。

- 失败处理记录：本次未修改既有模型 id/响应别名契约；失败范围与可选公共字段改动无关。

## 任务列表

- [x] 分离 DSH 公共字段与模型字段布局

- [x] 放开并校验官方模型字段

- [x] 完成构建和回归验证

## 决策记录

- 2026-10-25：`apiKeyEnv` 继续作为固定运行时字段自动规范化，不在可视化表单展示；`acpModel` 属于 profile 公共参数，放在模型区上方。

## 验证结果

- `npm run build`：通过。

- `node --test dist/test/config/dshconfigpage.test.js dist/test/cli/dshConfigModels.test.js`：18 项通过。

- `npm run validate:whitespace`：通过。

- `git diff --check`：通过。

- 可选公共字段验证：通过。省略字段的新范例不生成 `displayName`、`timeoutMs`、`streamIdleTimeoutMs`、`retryPolicy`；显式存在的字段保存回读并按条件写入 patch。

- `node --check media/config/assets/config-app-ui.js`：通过。

- `node /Users/fangjiawei/.codex/skills/impeccable/scripts/detect.mjs --json media/config/assets/config-app-ui.js media/config/assets/index-Dl7d6WMN.css`：通过，检测结果为空数组。
