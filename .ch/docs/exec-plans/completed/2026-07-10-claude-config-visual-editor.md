# Claude 配置可视化编辑器

- 日期：2026-07-10
- 状态：completed
- 负责人：Codex
- owner：Codex
- claimed_at：2026-07-10
- claim_ttl：1d
- handoff_to：

## 背景

当前配置管理页已为 OpenCode 提供可视化与 JSON 双模式编辑，Claude 配置仍仅支持直接编辑 `~/.claude/settings.json`。需要复用现有交互模式，覆盖 Claude Code 官方配置文件中的主要核心配置，重点支持 Haiku、Sonnet、Opus 三档默认模型环境变量。

## 目标

为 Claude 配置页增加可视化与 JSON 双模式编辑，在不丢失未知官方字段的前提下编辑核心设置，并支持 `ANTHROPIC_DEFAULT_HAIKU_MODEL`、`ANTHROPIC_DEFAULT_SONNET_MODEL`、`ANTHROPIC_DEFAULT_OPUS_MODEL`。

## 范围

- Claude `settings.json` 可视化解析、编辑和序列化。
- Claude 可视化与 JSON 模式切换、错误保护和示例配置。
- 核心环境变量、默认模型、权限和常用运行设置。
- 中英文界面文本、自动化测试、产品能力与运行时文档同步。

## 非目标

- 不改变 Claude CLI 安装方式或交互 Runner 协议。
- 不替换现有配置存储目录、激活和备份机制。
- 不覆盖或删除无法识别的 Claude 官方/第三方扩展字段。

## 验收标准

- [x] Claude 配置页可在可视化和 JSON 模式间安全切换。
- [x] 三档默认模型名称可独立配置并写入 `env`。
- [x] 可视化编辑保留未知 JSON 字段和未展示的环境变量。
- [x] 无效 JSON 不覆盖最后一次有效可视化状态。
- [x] 相关单元测试、TypeScript 构建通过。
- [x] 产品能力、运行时参考和兼容入口文档已同步。

## 影响面

- 代码目录：`media/config/assets/`、`src/config/`、`src/test/`
- 文档目录：`.ch/docs/product-specs/`、`.ch/docs/references/`、`docs/`
- 配置与脚本：`package.json`（仅在测试入口确有需要时调整）

## 风险与缓解

- 风险：可视化序列化意外丢失未知字段。
- 缓解：以原始对象为基础做定向合并，只删除用户明确清空的受管字段。
- 风险：官方字段或枚举随 Claude Code 版本变化。
- 缓解：仅对稳定核心字段提供控件，保留 JSON 模式处理长尾配置。
- 风险：仓库存在同区域未提交改动。
- 缓解：先审阅目标文件 diff，再做最小增量补丁，不回退现有修改。

## 验证计划

- 最小相关验证：Claude 可视化解析/序列化、模式切换、三档模型字段测试。
- 单元自测命令：`node --test dist/test/claudeConfigVisualEditor.test.js`（构建后）
- 扩展验证：`npm run build` 与相关配置页测试集合。

## 测试与清单同步

- 单元测试新增/更新：新增 `src/test/claudeConfigVisualEditor.test.ts`；同步修正 OpenCode 紧凑布局已变为 `6px` 后的过期断言。
- 单元自测结果：`npm run build`、`node --check media/config/assets/config-app-ui.js`、配置中心相关 42 个 Node 测试全部通过。
- 失败处理记录：首次相关测试发现 `opencodeconfigvisualeditor.test.ts` 仍断言旧的 `12px` 间距；实现已是工作区现有的 `6px`，判定为断言过期并更新后重跑通过。
- 功能清单：已同步 `.ch/docs/product-specs/FEATURE_INVENTORY.md`。
- 相关文档同步：已同步产品能力、运行时参考、CLI 参考、开发入口和插件功能清单。

## 任务列表

- [x] 审查现有 OpenCode/Claude 配置实现。
- [x] 核对 Claude Code 官方配置格式。
- [x] 实现 Claude 可视化与 JSON 双模式。
- [x] 补齐国际化、测试和文档。
- [x] 构建验证并归档计划。

## 决策记录

- 2026-07-10：复用 OpenCode 双模式交互；Claude 可视化序列化必须基于原始 JSON 定向合并，确保未知字段无损保留。
- 2026-07-10：官方依据使用 `https://code.claude.com/docs/en/settings.md`、`model-config.md`、`env-vars.md` 和 `permissions.md`；可视化仅覆盖稳定核心字段，长尾和企业管理字段继续由 JSON 模式承载。
- 2026-07-10：新增文案按浏览器语言提供中英文；不扩大改造现有配置应用的历史中文文案。

## 当前结论

Claude 配置卡片已支持可视化与 JSON 双模式，可编辑官方常用模型、推理、行为、权限和 API/网关字段，重点支持 Haiku、Sonnet、Opus 三档默认模型名称；未知字段无损保留。构建、静态语法检查和配置中心相关 42 个测试均通过。稳定行为已进入产品规格、运行时参考与功能清单，无需额外上提到记忆热区。
