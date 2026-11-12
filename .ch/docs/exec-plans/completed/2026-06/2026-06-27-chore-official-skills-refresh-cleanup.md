# 官方 skills 归档刷新与下架清理

- 日期：2026-06-27
- 状态：completed
- 负责人：Codex / 人类 / 协作
- 类型：chore
- 迁移来源：`.ch/docs/exec-plans/completed/2026-06/2026-06-27-official-skills-version-refresh.md`

## 关联计划

- [feature：官方 skills 逐条版本字段与展示](2026-06-27-feature-official-skills-version-records.md)
- [bugfix：官方 skills 最新状态判定修复](2026-06-27-bugfix-official-skills-latest-detection.md)
- 历史测试证据：[删除审计](../../migrations/test-plan-removals/2026-11-11-apr-jun.json)（entries[4]；test 类型计划已删除，独立测试开发不并入本计划交付范围）。
- [docs：官方 skills 版本刷新与最新判断修复——文档同步](2026-06-27-docs-official-skills-version-refresh-documentation.md)

## 迁移说明

2026-11-11 按实际工作类型拆分。日期、负责人及状态沿用原文；下列命令和结果均为历史记录，本次迁移不执行历史命令，也不新增验收结论。

## 独立目标与实施范围

承接上游核验、catalog/ZIP 快照刷新、Gemini 下架残留资源与不可用同步分支清理。

## 独立验收与证据边界

保留当前三平台口径及 OpenCode 空占位；历史抓取失败、复用 ZIP、缺少 sourceCommit 和初始探针失败如实记录。

实际结果以本文件下方分配的原始记录为准；未单独记录的结果仍未验证。整组构建/测试的历史证据见关联实现计划，不自动当作本工作包的独立验收。

## 背景

当前 VS Code 插件内置官方 skills/extensions 的当前支持口径已调整为 Claude、Codex、OpenCode：Claude / Codex 保留官方归档快照与 catalog，OpenCode 官方 catalog 暂无可靠上游来源时保持空平台占位。Gemini 已从当前支持平台移除；自 2026-07-14 起，历史审计只依赖 Git 与归档文档，不再保留可执行同步路径或内置 ZIP。用户要求：
1. 核验当前官方来源是否已有新版本或新条目需要纳入。
- 2026-06-01 仓库曾刷新过 Claude / Codex 内置 zip；Gemini 历史快照不再作为当前支持目标，并于 2026-07-14 从打包资源中删除。
- 2026-07-08 round-2 `official-skills-opencode` 已将当前 catalog 口径迁移为 Claude / Codex / OpenCode；OpenCode 官方 catalog 当前明确为空/待接入。

## 目标

1. 形成一套可落地的官方 skills/extensions 刷新方案，覆盖 Claude / Codex / OpenCode 当前支持口径。

## 范围

- 核验当前支持平台的官方上游来源、目录结构、版本字段、ref 粒度与本地快照差异。
- 刷新官方 catalog 与对应 zip 归档（仅在审计确认后实施）。

## 验收标准

- [x] 已完成 Claude / Codex / OpenCode 当前口径核验；OpenCode 官方 catalog 暂无可靠上游来源时保持空占位。
- [x] 官方 zip/catalog 刷新流程可重复执行，且对新增、删除、重命名条目有明确处理策略。

## 影响面

  - `scripts/`
  - `media/official-skills/`
- 配置与脚本：可能涉及同步脚本。

## 风险与缓解

- 风险：并行子任务结论可能晚到或互相冲突。
  - 缓解：本计划先锁定阶段与接口，待各审计报告回填后再做最终实现决策；若字段口径冲突，先补决策记录。
- 风险：刷新 zip 时新增或移除条目会影响 catalog 与 UI 文案。
- 缓解：把新增、删除、重命名作为显式清单处理，不做隐式覆盖。

## 验证计划

  - 审核当前支持平台的上游来源与本地 catalog/zip 是否一致。
  - 运行官方 skills 同步脚本或相关构建流程，确认刷新后产物完整。
  - 抽查新增/删除/重命名条目在 catalog、zip、配置页中的一致性。

## 测试与清单同步

- 2026-07-14 Gemini 残留清理验证：
  - `python3 -B` AST、catalog 与 CLI 参数探针通过；catalog 共 56 条，平台仅 Claude / Codex / OpenCode，磁盘归档 56 个且无缺失或孤儿文件。
  - `npm run build` 通过。
  - `node --test dist/test/officialSkillService.test.js dist/test/officialSkillsVersioning.test.js` 通过，11/11。
  - `vsce ls` 通过；1517 个打包文件中 `media/official-skills/gemini/` 命中为 0。
  - 两条初始 Python 单行探针因命令引号/换行转义错误失败；修正探针后通过，未发现实现缺陷。

## 任务列表

- [x] 阶段 2：上游核验与版本字段审计。
  - 覆盖 Claude / Codex / OpenCode 当前官方口径。
  - 明确本地条目数、上游条目数、差异清单、显式 version 字段可用性。
  - 给出“每个 skill 版本号”推荐来源与优先级。
- [x] 阶段 3：catalog / zip 刷新方案与产物更新。
  - 根据审计结果更新 catalog 条目、zip 快照、sourceRef 与来源路径。
  - 处理新增、删除、重命名、描述缺失和归档缺失问题。
- 运行必要构建。
- [x] 阶段 7：删除已下架 Gemini 官方 Skills 残留。
  - 删除 `media/official-skills/gemini/` 下 40 个无 catalog 引用的 ZIP。
  - 删除同步脚本中的 legacy Gemini 参数、manifest 解析与刷新分支。
- 验证 catalog、归档与打包清单一致性。

## 决策记录

- 2026-06-27：先创建执行计划，不直接改 catalog 或业务代码；等待并行审计子任务提供三组上游核验与状态判断审计结论。
- 2026-06-27：第一阶段必须先完成上游核验与版本字段审计，再进入 catalog/zip 刷新。
- 2026-06-27 历史 Gemini 记录（已移除）：当时优先使用 manifest `version`。
- 2026-06-27 历史 Gemini 记录（已移除）：当时 `gemini:firebase` 迁移到 `firebase/agent-skills`，并把 `gemini-cli-extensions/firebase`、`firebase/skills` 视为历史别名；该记录仅用于审计历史 catalog，不代表当前支持平台或当前 canonical 来源。
- 2026-07-14：当前 catalog 已无 Gemini platform/条目，配置页与安装服务也拒绝 Gemini；残留 40 个 ZIP 仅增加约 34 MB 打包体积。删除这些 ZIP 及已经无法从当前 seed catalog 重建条目的 legacy 同步分支，历史审计改由 Git 和归档计划承担。

## 当前结论

当前已完成本轮刷新。当前支持平台仅为 Claude / Codex / OpenCode；以下 Gemini 内容均为已移除历史 catalog 的审计记录，不代表当前支持目标，也不再对应仓库内置 ZIP 或同步入口。
1. `media/official_skills_catalog.json` 已刷新到 `2026-06-27T12:34:44Z`；当前支持口径覆盖 Claude 17、Codex 39，历史 Gemini 记录（已移除）当时计数为 40。
3. 代表性变化已落地：
   - Claude：`claude-api`、`frontend-design` 的 `sourceRef` 与 `contentHash` 已更新。
   - Codex：`openai-docs` 已刷新到新的 `sourceRef` / `contentHash`。
   - 历史 Gemini 记录（已移除）：当时至少 `alloydb`、`google-workspace` 等条目已升级 manifest `version`；历史 `gemini:firebase` 当时切换到 `firebase/agent-skills`，版本 `1.0.0`。
4. 历史 Gemini 记录（已移除）的当轮刷新摘要为 `tarball=38`、`git=1`、`reused=1`。其中 `gemini-cli-extensions/security` 因 tarball 与 shallow clone 都超时，暂时复用了仓库内既有 zip；16 个历史 Gemini 条目因 `git ls-remote` 超时缺少 `sourceCommit`，但 `version` / `contentHash` 已正常落库。该摘要仅用于历史审计。
6. 2026-07-14 已删除 40 个 Gemini ZIP（共 33.7 MiB）和不可用的 legacy 同步分支；catalog、磁盘归档及 VSIX 清单均不再包含 Gemini 官方 Skills。
历史 Gemini 记录中的 `sourceCommit` 缺失和上游抓取失败不再属于当前运行或发布风险；如需复盘，应读取删除前的 Git 版本，不应恢复为当前支持平台或打包资源。
- 不再保留当前支持平台之外的 Gemini 同步入口。
