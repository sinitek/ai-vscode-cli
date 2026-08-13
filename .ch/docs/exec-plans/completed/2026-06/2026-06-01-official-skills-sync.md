# 官方 Skills 快照同步

- 日期：2026-06-01
- 状态：completed
- 负责人：Codex

## 背景

用户要求检查当前 3 个分组的 skills 文件日期，并在存在新版官方 skills 时全量更新与补充。仓库内置快照由 `media/official-skills/` 与 `media/official_skills_catalog.json` 提供，分组为 Claude、Codex、Gemini。

## 目标

刷新仓库内置官方 skills 快照，使配置页可获取最新官方 Claude / Codex skills，并保留当前默认策略下的 Gemini 已验证快照。

## 范围

- 刷新 `media/official-skills/claude/` 与 `media/official-skills/codex/` 的 zip 快照。
- 更新 `media/official_skills_catalog.json` 的条目、sourceRef 和生成时间。
- 为新增 Codex 官方 skills 补充中文 description。
- 同步权威 skills 文档中的核验日期、数量和变更说明。

## 非目标

- 不强制刷新 Gemini extensions，除非后续明确要求。
- 不修改配置页 UI 或安装逻辑。
- 不删除用户本机 `~/.codex/skills` 中已安装的本地 skills。

## 验收标准

- [x] `npm run sync:official-skills` 成功完成。
- [x] Codex catalog 反映上游新增 `define-goal`、`hatch-pet`、`migrate-to-codex`。
- [x] Codex catalog 不再保留上游已移除的陈旧 Codex 条目。
- [x] `media/official_skills_catalog.json` 中 description 保持中文。
- [x] `npm run build` 成功。

## 影响面

- 代码目录：`scripts/sync_official_skills.py`
- 文档目录：`.ch/docs/references/authoritative-skills.md`
- 配置与脚本：`media/official-skills/`、`media/official_skills_catalog.json`

## 风险与缓解

- 风险：上游新增条目缺少中文描述导致同步脚本失败。
- 缓解：将新增 Codex 官方 skills 写入 `MANUAL_ITEM_OVERRIDES`。
- 风险：上游移除旧 skills 后 catalog 条目减少，影响配置页展示。
- 缓解：按官方当前 `.curated` 列表同步，并在文档记录新增/移除情况。

## 验证计划

- 最小相关验证：运行 `npm run sync:official-skills` 并检查 catalog 计数和新增/移除条目。
- 扩展验证：运行 `npm run build` 验证插件编译。

## 测试与清单同步

- 单元测试：本次只更新打包快照和 catalog，不新增运行时代码单元测试。
- 功能清单：官方 skills 来源数据更新，能力入口未变化，预计无需更新功能清单。
- 相关文档同步：更新 `.ch/docs/references/authoritative-skills.md`。

## 任务列表

- [x] 盘点本机和仓库内 skills 文件日期。
- [x] 核对 OpenAI 官方 `openai/skills` 当前 `.curated` 与 `.system` 列表。
- [x] 识别 Codex 新增与移除条目。
- [x] 补充新增 Codex 条目的中文 description。
- [x] 重跑官方 skills 同步脚本。
- [x] 更新事实来源文档。
- [x] 执行构建验证并归档计划。

## 决策记录

- 2026-06-01：官方 `openai/skills` 当前只有 `.system` 和 `.curated`，`skills/.experimental` 返回 404；仓库默认同步仍按 Claude / Codex 刷新、Gemini 保留已验证快照。
- 2026-06-01：Codex 上游新增 `define-goal`、`hatch-pet`、`migrate-to-codex`；上游已不再包含 `develop-web-game`、`doc`、`frontend-skill`、`imagegen`、`slides`、`sora`、`spreadsheet`。

## 当前结论

已完成官方 Claude / Codex 快照同步，Codex catalog 已对齐 OpenAI 官方当前 `.curated` 39 项；`npm run build` 已通过。
