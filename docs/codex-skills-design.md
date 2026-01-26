# Codex Skills 配置设计（草案）

## 目标
- 在现有“配置”页面为 Codex 增加 Skills 管理能力。
- 从指定的 skills 仓库导入技能列表，支持一键启用/禁用。
- 保持现有技术栈与配置体系不变，不做大改动。

## 官方配置要点（结论）
- `~/.codex/config.toml` 是 Codex 的统一配置文件，CLI 与 IDE 插件共用。
- Codex 会从多个 Team Config 位置加载 `skills/`，并按优先级覆盖（当前目录/父目录/仓库根/`$CODEX_HOME`/`/etc/codex`），用户级技能默认位于 `~/.codex/skills`。
- Skills 的启用/禁用可在 `~/.codex/config.toml` 里通过 `[[skills.config]]` + `path` + `enabled=false` 控制（实验特性），修改后需重启 Codex。
- `~/.codex/auth.json` 是可选的本地凭据缓存（可切换到 OS keyring）。

结论：就“官方配置文件”而言，目前的 `config.toml` + `auth.json` 足够承载 skills 的启用/禁用逻辑；但 skills 本体仍需落在 `skills/` 目录（不是新的配置文件）。

## 需求范围
- 仅 Codex 增加 Skills 配置（Claude/Gemini 不改）。
- 在“配置”页展示 Skills 列表，支持：
  - 单个 skill 启用/禁用
  - 一键启用/禁用全部 skills
- 不实现技能执行逻辑（由 Codex 自行加载）。

## 现状简述
- Codex 当前只管理两类文件：`~/.codex/config.toml` 与 `~/.codex/auth.json`。
- 配置页面通过 JSON 配置项（`~/.codex/__config/*.json`）生成“配置模板”，应用时写回上述两个文件。
- 目前没有 skills 相关数据结构与 UI。

## 技能来源与兼容性
- 需求指定的技能来源：`https://github.com/anthropics/skills/tree/main/skills`。
- Codex 官方 skills 仓库为 `https://github.com/openai/skills`，并支持通过 `$skill-installer` 安装 curated/experimental skills。

建议：在设计中保留“技能来源可切换”的机制；默认来源按需求使用 anthropics/skills，但需要验证其与 Codex skills 规范的兼容性（`SKILL.md` YAML front matter 与目录结构）。

## 设计方案

### 1) 技能存储与路径
- 将外部仓库技能同步到用户级目录：`~/.codex/skills/vendor/anthropics/<skill-name>/SKILL.md`。
- 避免污染已有本地/团队技能路径，且便于批量管理与清理。
- 保留 `~/.codex/skills` 作为最终生效路径，满足 Codex 读取规范。

### 2) 配置模型扩展（仅 Codex）
- 在配置模板（`ConfigItem`）中新增可选字段：
  - `skills?: Array<{ name: string; path: string; enabled: boolean; source: string }>`
- 该字段仅用于配置页的“技能选择”，不会写入 Codex 的官方配置文件以外的新文件。

### 3) 启用/禁用策略
- 启用：不写入 `[[skills.config]]` 项（或写 `enabled=true`，但默认建议省略）。
- 禁用：在 `config.toml` 写入 `[[skills.config]]` 条目：
  - `path = "<skill path>"`
  - `enabled = false`
- 应用配置时，生成或更新 `skills.config` 段落；仅管理“由本工具写入的 path”。

### 4) 一键开启/关闭
- “全部启用”：移除由本工具写入的所有 `enabled=false` 条目。
- “全部禁用”：为当前可见技能批量写入 `enabled=false` 条目。

### 5) 技能列表同步策略
- 在配置页打开 Codex 时执行同步：
  - 拉取仓库目录清单，识别包含 `SKILL.md` 的目录作为技能。
  - 生成本地 `~/.codex/skills/vendor/anthropics/...` 目录结构（仅设计，暂不实现）。
- 若无法访问网络，保持本地缓存（可选：在 `~/.codex/__config` 下记录上次同步元数据）。

### 6) 配置页面 UI（概念）
- 在 Codex 配置页新增 “Skills” 区域：
  - 列表项：名称、描述、路径、开关
  - 按钮：全部启用 / 全部禁用 / 重新同步
- 不新增颜色样式，复用现有 UI 语义样式。

### 7) 兼容与风险
- `skills.config` 属于实验特性，未来字段结构可能变化。
- 若用户使用 Team Config 中更高优先级的 `skills/`，需要提示“覆盖优先级”。
- 若用户将 `cli_auth_credentials_store` 设置为 keyring，`auth.json` 可能不是主存储，但与 skills 无直接冲突。

## 关键流程（伪流程）
1. 打开 Codex 配置页。
2. 同步技能列表（或读取缓存）。
3. 展示 skills 列表与当前启用状态。
4. 用户修改开关或点击“一键启用/禁用”。
5. 应用配置：更新 `config.toml` 的 `[[skills.config]]`（仅本工具写入的条目）。
6. 提示用户重启 Codex 生效。

## Tasklist
- [ ] 明确 skills 来源仓库（anthropics/skills 或 openai/skills）及兼容性取舍
- [ ] 设计并评审 ConfigItem 的 skills 扩展字段
- [ ] 设计 `config.toml` 里 `[[skills.config]]` 的写入/清理策略
- [ ] 设计 UI 交互（列表、开关、一键启用/禁用、同步按钮）
- [ ] 补充错误处理与离线缓存策略
- [ ] 更新文档与使用说明

## 参考
- https://developers.openai.com/codex/skills
- https://developers.openai.com/codex/team-config
- https://developers.openai.com/codex/local-config
- https://developers.openai.com/codex/auth/
- https://developers.openai.com/codex/config-reference/
- https://github.com/openai/skills
- https://github.com/anthropics/skills
