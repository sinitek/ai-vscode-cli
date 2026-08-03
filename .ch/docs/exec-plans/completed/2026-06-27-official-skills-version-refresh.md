# 官方 skills 版本刷新与最新判断修复

- 日期：2026-06-27
- 状态：completed
- 负责人：Codex / 人类 / 协作

## 背景

当前 VS Code 插件内置官方 skills/extensions 的当前支持口径已调整为 Claude、Codex、OpenCode：Claude / Codex 保留官方归档快照与 catalog，OpenCode 官方 catalog 暂无可靠上游来源时保持空平台占位。Gemini 已从当前支持平台移除；自 2026-07-14 起，历史审计只依赖 Git 与归档文档，不再保留可执行同步路径或内置 ZIP。用户要求：

1. 核验当前官方来源是否已有新版本或新条目需要纳入。
2. 为每个 skill/extension 记录明确的版本号或可替代版本标识。
3. 修复当前“是否最新”判断疑似不准确的问题。

现有事实来源表明：

- 2026-06-01 仓库曾刷新过 Claude / Codex 内置 zip；Gemini 历史快照不再作为当前支持目标，并于 2026-07-14 从打包资源中删除。
- 2026-07-08 round-2 `official-skills-opencode` 已将当前 catalog 口径迁移为 Claude / Codex / OpenCode；OpenCode 官方 catalog 当前明确为空/待接入。
- `media/official_skills_catalog.json` 当前依赖 `sourceRef` 判断上游变化，但该字段可能只有仓库级粒度，未必能可靠表达每个 skill 的具体版本。
- 上游是否提供显式语义版本号，需要分别对 Claude、Codex、OpenCode 做事实核验与字段审计；OpenCode 无可靠上游来源时继续保持空占位，不编造官方条目。

本计划用于后续轮次协作，先固定范围、阶段、验收标准与风险，再由并行审计子任务回填事实。

## 目标

1. 形成一套可落地的官方 skills/extensions 刷新方案，覆盖 Claude / Codex / OpenCode 当前支持口径。
2. 为每个 skill/extension 建立可展示、可比较、可回溯的版本记录字段。
3. 修复内置 catalog、已安装 metadata、配置页状态判断之间的“是否最新”判定链路，使结果准确且可解释。
4. 完成必要的测试与文档同步，确保后续维护者可以重复执行同一刷新流程。

## 范围

- 核验当前支持平台的官方上游来源、目录结构、版本字段、ref 粒度与本地快照差异。
- 刷新官方 catalog 与对应 zip 归档（仅在审计确认后实施）。
- 设计并落地每个 skill/extension 的版本列表或版本字段方案。
- 修复“是否最新”判断逻辑，包括 catalog schema、安装 metadata、UI 展示与状态计算。
- 补充最小必要测试与相关事实来源文档同步。

## 非目标

- 本轮计划阶段不直接修改共享 catalog、zip 或业务代码。
- 不引入本计划以外的技能来源平台；当前仅处理 Claude / Codex / OpenCode 分组。
- 不做与官方 skills 管理无关的 UI 重构、插件架构调整或技术栈替换。
- 不在未核验前假设上游存在统一语义版本号。

## 验收标准

- [x] 已完成 Claude / Codex / OpenCode 当前口径核验；OpenCode 官方 catalog 暂无可靠上游来源时保持空占位。
- [x] 已确认并实现每个 skill/extension 的版本记录方案，能够生成或维护可枚举的版本列表。
- [x] `media/official_skills_catalog.json` 及相关 schema 支持准确表达版本、来源与比较依据，且 description 保持中文。
- [x] 配置页或相关状态展示能准确判断 installed / update-available / unknown-source，不再仅依赖不可靠的粗粒度 ref。
- [x] 官方 zip/catalog 刷新流程可重复执行，且对新增、删除、重命名条目有明确处理策略。
- [x] 相关测试、功能清单与事实来源文档已同步，验证结果可复核。

## 影响面

- 代码目录：
  - `src/config/`
  - `src/webview/`
  - `scripts/`
  - `media/official-skills/`
- 文档目录：
  - `.ch/docs/exec-plans/`
  - `.ch/docs/references/`
  - `.ch/docs/product-specs/`
  - `docs/`
- 配置与脚本：
  - `media/official_skills_catalog.json`
  - 可能涉及 catalog schema / metadata 写入逻辑 / 同步脚本

## 风险与缓解

- 风险：上游无统一语义版本号，导致“版本号列表”目标无法直接映射到现有字段。
  - 缓解：优先审计上游显式 version 字段；若缺失，则明确采用 commit SHA、目录树 hash、内容 hash 等替代版本标识，并记录优先级。
- 风险：三组来源的版本模型不同，统一 schema 时容易过度抽象。
  - 缓解：先定义最小公共字段，再允许按平台保留补充字段，例如 `versionSource`、`sourceCommit`、`contentHash`。
- 风险：当前 installed metadata 与 catalog 比较逻辑可能存在历史兼容包袱。
  - 缓解：审计现有 metadata 结构，设计兼容读取与迁移策略，避免已安装官方 skill 状态全部退化为未知。
- 风险：并行子任务结论可能晚到或互相冲突。
  - 缓解：本计划先锁定阶段与接口，待各审计报告回填后再做最终实现决策；若字段口径冲突，先补决策记录。
- 风险：刷新 zip 时新增或移除条目会影响 catalog 与 UI 文案。
  - 缓解：把新增、删除、重命名作为显式清单处理，并同步测试与文档，不做隐式覆盖。

## 验证计划

- 最小相关验证：
  - 审核当前支持平台的上游来源与本地 catalog/zip 是否一致。
  - 核验 catalog schema 是否能表达每个条目的版本与来源比较依据。
  - 验证 installed metadata 与 catalog 之间的状态计算样例。
- 扩展验证：
  - 运行官方 skills 同步脚本或相关构建流程，确认刷新后产物完整。
  - 执行插件测试或最小 UI 状态验证，覆盖安装、更新可用、未知来源、版本显示。
  - 抽查新增/删除/重命名条目在 catalog、zip、配置页中的一致性。

## 测试与清单同步

- 单元测试：
  - 默认补充或更新 catalog 解析、版本比较、installed metadata 兼容与 UI 状态判断相关测试。
- 2026-07-14 Gemini 残留清理验证：
  - `python3 -B` AST、catalog 与 CLI 参数探针通过；catalog 共 56 条，平台仅 Claude / Codex / OpenCode，磁盘归档 56 个且无缺失或孤儿文件。
  - `npm run build` 通过。
  - `node --test dist/test/officialSkillService.test.js dist/test/officialSkillsVersioning.test.js` 通过，11/11。
  - `vsce ls` 通过；1517 个打包文件中 `media/official-skills/gemini/` 命中为 0。
  - 两条初始 Python 单行探针因命令引号/换行转义错误失败；修正探针后通过，未发现实现缺陷。
- 功能清单：
  - 若官方 skills 管理行为、版本展示或更新判断发生变化，同步 `.ch/docs/product-specs/FEATURE_INVENTORY.md` 与相关能力规格。
- 相关文档同步：
  - `.ch/docs/references/authoritative-skills.md`
  - 相关 CLI / 插件能力文档入口
  - 必要时补充 runbook 或 PITFALLS，记录版本字段与上游核验注意事项

## 任务列表

- [x] 阶段 1：建立执行计划，锁定背景、目标、范围、阶段和验收标准。
- [x] 阶段 2：上游核验与版本字段审计。
  - 覆盖 Claude / Codex / OpenCode 当前官方口径。
  - 明确本地条目数、上游条目数、差异清单、显式 version 字段可用性。
  - 给出“每个 skill 版本号”推荐来源与优先级。
- [x] 阶段 3：catalog / zip 刷新方案与产物更新。
  - 根据审计结果更新 catalog 条目、zip 快照、sourceRef 与来源路径。
  - 处理新增、删除、重命名、描述缺失和归档缺失问题。
- [x] 阶段 4：版本列表与 schema 实现。
  - 为每个 skill/extension 增加版本字段或版本标识。
  - 设计 catalog、metadata、必要生成脚本之间的一致性方案。
  - 明确 UI 需要展示的版本信息及其来源。
- [x] 阶段 5：最新判断修复。
  - 调整 installed metadata 写入与读取。
  - 修复配置页或状态计算中的 update 判断逻辑。
  - 保证旧数据兼容或可迁移。
- [x] 阶段 6：测试、文档与清单同步。
  - 运行最小相关测试与必要构建。
  - 同步功能清单、事实来源文档与相关说明。
  - 复核官方 skills 管理体验是否与计划一致。
- [x] 阶段 7：删除已下架 Gemini 官方 Skills 残留。
  - 删除 `media/official-skills/gemini/` 下 40 个无 catalog 引用的 ZIP。
  - 删除同步脚本中的 legacy Gemini 参数、manifest 解析与刷新分支。
  - 同步 runbook、能力规格和功能清单，并验证 catalog、归档与打包清单一致性。

## 决策记录

- 2026-06-27：先创建执行计划，不直接改 catalog 或业务代码；等待并行审计子任务提供三组上游核验与状态判断审计结论。
- 2026-06-27：计划默认把“每个 skill 版本号记录”解释为“优先语义版本号，缺失时使用可稳定比较的替代版本标识”，避免被单一字段模型卡住。
- 2026-06-27：第一阶段必须先完成上游核验与版本字段审计，再进入 catalog/zip 刷新与状态判断修复。
- 2026-06-27 历史 Gemini 记录（已移除）：当时的官方最新判断口径固定为“优先比较 per-item `contentHash`，缺失时才回退 `sourceRef`”；Claude / Codex 使用短 `contentHash` 作为可见版本，已移除的历史 Gemini catalog 当时优先使用 manifest `version`。
- 2026-06-27 历史 Gemini 记录（已移除）：当时 `gemini:firebase` 迁移到 `firebase/agent-skills`，并把 `gemini-cli-extensions/firebase`、`firebase/skills` 视为历史别名；该记录仅用于审计历史 catalog，不代表当前支持平台或当前 canonical 来源。
- 2026-07-14：当前 catalog 已无 Gemini platform/条目，配置页与安装服务也拒绝 Gemini；残留 40 个 ZIP 仅增加约 34 MB 打包体积。删除这些 ZIP 及已经无法从当前 seed catalog 重建条目的 legacy 同步分支，历史审计改由 Git 和归档计划承担。

## 当前结论

当前已完成本轮刷新、版本字段落库与文档同步。当前支持平台仅为 Claude / Codex / OpenCode；以下 Gemini 内容均为已移除历史 catalog 的审计记录，不代表当前支持目标，也不再对应仓库内置 ZIP 或同步入口。

1. `media/official_skills_catalog.json` 已刷新到 `2026-06-27T12:34:44Z`；当前支持口径覆盖 Claude 17、Codex 39，历史 Gemini 记录（已移除）当时计数为 40。
2. 所有 catalog 条目都已落 `version`、`versionSource`、`contentHash`；`sourceCommit` 对多数条目已落库。
3. 代表性变化已落地：
   - Claude：`claude-api`、`frontend-design` 的 `sourceRef` 与 `contentHash` 已更新。
   - Codex：`openai-docs` 已刷新到新的 `sourceRef` / `contentHash`。
   - 历史 Gemini 记录（已移除）：当时至少 `alloydb`、`google-workspace` 等条目已升级 manifest `version`；历史 `gemini:firebase` 当时切换到 `firebase/agent-skills`，版本 `1.0.0`。
4. 历史 Gemini 记录（已移除）的当轮刷新摘要为 `tarball=38`、`git=1`、`reused=1`。其中 `gemini-cli-extensions/security` 因 tarball 与 shallow clone 都超时，暂时复用了仓库内既有 zip；16 个历史 Gemini 条目因 `git ls-remote` 超时缺少 `sourceCommit`，但 `version` / `contentHash` 已正常落库。该摘要仅用于历史审计。
5. 事实来源文档与功能清单已同步，明确记录版本展示、`contentHash` 判断规则和 `firebase` canonical 来源。
6. 2026-07-14 已删除 40 个 Gemini ZIP（共 33.7 MiB）和不可用的 legacy 同步分支；catalog、磁盘归档及 VSIX 清单均不再包含 Gemini 官方 Skills。

历史 Gemini 记录中的 `sourceCommit` 缺失和上游抓取失败不再属于当前运行或发布风险；如需复盘，应读取删除前的 Git 版本，不应恢复为当前支持平台或打包资源。

2026-08-03 收尾归档：本计划已有实现、验证和文档同步记录；按 active plan 清理要求归档到 `completed/`，不再保留当前支持平台之外的 Gemini 同步入口。
