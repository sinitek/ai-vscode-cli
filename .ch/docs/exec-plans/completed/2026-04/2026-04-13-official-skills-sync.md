# 官方 Skills 目录同步与配置页更新

- 日期：2026-04-13
- 状态：completed
- 负责人：Codex

## 背景

`media/official-skills/` 与 `media/official_skills_catalog.json` 承担 CLI 配置页“官方 Skills”数据源。当前快照落后于官方上游，导致配置页无法展示最新补充的官方 Skills/Extensions。

## 目标

- 同步 OpenAI / Anthropic / Gemini 官方 Skills/Extensions 到仓库内置目录。
- 让 CLI 配置页继续基于最新 catalog 正常展示、安装、更新这些官方 Skills。
- 留下可复用的同步脚本与文档，降低后续人工维护成本。

## 范围

- `media/official-skills/` 下官方压缩包更新。
- `media/official_skills_catalog.json` 快照与元数据更新。
- 必要的配置服务兼容调整、同步脚本与文档更新。

## 非目标

- 不改动插件技术栈。
- 不新增在线市场接口或远程动态更新能力。
- 不改写现有 Skills 安装交互流程。

## 验收标准

- [x] 配置页官方 Skills 列表能读到最新 catalog，已覆盖 OpenAI 新增的 `cli-creator`，并保留现有 Gemini repo 命名映射。
- [x] `media/official-skills/` 与 `media/official_skills_catalog.json` 同步一致，安装归档校验文件仍满足现有逻辑。
- [x] 提供后续可复用的同步方式说明，并完成 `npm run build` 验证。

## 影响面

- 代码目录：`src/config/`, `scripts/`（如新增）
- 文档目录：`.ch/docs/exec-plans/`, `.ch/docs/references/`, `.ch/docs/product-specs/`
- 配置与脚本：`media/official-skills/`, `media/official_skills_catalog.json`

## 风险与缓解

- 风险：官方仓库列表变化导致 catalog 与归档不一致。
- 缓解：引入同步脚本，直接基于官方仓库快照生成归档与 catalog。
- 风险：Gemini 官方 repo 命名调整，历史中文描述映射丢失。
- 缓解：保留旧名称到新名称的映射，手工补齐新增项中文描述。

## 验证计划

- 最小相关验证：校验 catalog 数量、关键新增项、归档存在性与验证文件。
- 扩展验证：执行 `npm run build`，确保扩展编译通过。

## 测试与清单同步

- 单元测试：仓库当前无现成测试框架，本次以脚本校验 + build 验证替代，并在收尾说明原因。
- 功能清单：如用户可见能力说明发生变化则更新 `FEATURE_INVENTORY.md`。
- 相关文档同步：更新权威来源文档与本计划。

## 任务列表

- [x] 确认官方上游最新清单与当前仓库差异。
- [x] 实现/补充同步脚本并刷新内置 Skills 资源。
- [x] 校验配置页数据读取与构建结果，回写文档。

## 决策记录

- 2026-04-13：先以官方仓库/组织快照刷新内置归档，再决定是否需要额外改动配置页逻辑。

## 当前结论

已补齐 Codex 官方 skill `cli-creator`，并刷新 Claude / Codex 内置 zip 与 catalog。配置页继续复用现有 `getOfficialSkillsCatalog` 链路，无需额外 UI/协议改动即可展示最新官方条目并判断更新状态。

Gemini 官方 extensions 维持现有 40 项已验证快照；同步脚本默认保留该快照，如需强制重抓可使用 `--refresh-gemini`。本次已完成 `python3 scripts/sync_official_skills.py` 与 `npm run build` 验证。
