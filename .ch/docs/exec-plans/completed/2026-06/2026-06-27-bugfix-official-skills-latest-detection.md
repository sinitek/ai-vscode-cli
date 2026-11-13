# 官方 skills 最新状态判定修复

- 日期：2026-06-27
- 状态：completed
- 负责人：Codex / 人类 / 协作
- 类型：bugfix

## 关联计划

- [feature：官方 skills 逐条版本字段与展示](2026-06-27-feature-official-skills-version-records.md)
- 历史测试证据：[删除审计](../../migrations/test-plan-removals/2026-11-11-apr-jun.json)（entries[4]；test 类型计划已删除，独立测试开发不并入本计划交付范围）。

## 独立目标与实施范围

修复 catalog 与 installed metadata、配置页之间的版本比较和旧数据兼容；版本字段新增见 feature。

## 独立验收与证据边界

优先 per-item contentHash，缺失时回退 sourceRef；installed/update-available/unknown-source 按真实依据区分。

实际结果以本文件下方分配的原始记录为准；未单独记录的结果仍未验证。整组构建/测试的历史证据见关联实现计划，不自动当作本工作包的独立验收。

## 背景

3. 修复当前“是否最新”判断疑似不准确的问题。
- `media/official_skills_catalog.json` 当前依赖 `sourceRef` 判断上游变化，但该字段可能只有仓库级粒度，未必能可靠表达每个 skill 的具体版本。

## 目标

3. 修复内置 catalog、已安装 metadata、配置页状态判断之间的“是否最新”判定链路，使结果准确且可解释。

## 范围

- 修复“是否最新”判断逻辑，包括 catalog schema、安装 metadata、UI 展示与状态计算。

## 验收标准

- [x] 配置页或相关状态展示能准确判断 installed / update-available / unknown-source，不再仅依赖不可靠的粗粒度 ref。

## 影响面

- 配置与脚本：可能涉及 metadata 写入逻辑。

## 风险与缓解

- 风险：当前 installed metadata 与 catalog 比较逻辑可能存在历史兼容包袱。
  - 缓解：审计现有 metadata 结构，设计兼容读取与迁移策略，避免已安装官方 skill 状态全部退化为未知。

## 验证计划

  - 验证 installed metadata 与 catalog 之间的状态计算样例。

## 任务列表

- [x] 阶段 5：最新判断修复。
  - 调整 installed metadata 写入与读取。
  - 修复配置页或状态计算中的 update 判断逻辑。
  - 保证旧数据兼容或可迁移。

## 决策记录

- 2026-06-27：先完成上游核验与版本字段审计，再进入状态判断修复；并列的 catalog/zip 刷新工作见关联 chore，不另设两者的先后依赖。
- 2026-06-27 历史 Gemini 记录（已移除）：当时的官方最新判断口径固定为“优先比较 per-item `contentHash`，缺失时才回退 `sourceRef`”；
