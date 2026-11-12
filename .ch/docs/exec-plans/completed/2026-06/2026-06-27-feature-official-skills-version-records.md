# 官方 skills 逐条版本字段与展示

- 日期：2026-06-27
- 状态：completed
- 负责人：Codex / 人类 / 协作
- 类型：feature
- 迁移来源：`.ch/docs/exec-plans/completed/2026-06/2026-06-27-official-skills-version-refresh.md`

## 关联计划

- [bugfix：官方 skills 最新状态判定修复](2026-06-27-bugfix-official-skills-latest-detection.md)
- [chore：官方 skills 归档刷新与下架清理](2026-06-27-chore-official-skills-refresh-cleanup.md)
- 历史测试证据：[删除审计](../../migrations/test-plan-removals/2026-11-11-apr-jun.json)（entries[4]；test 类型计划已删除，独立测试开发不并入本计划交付范围）。
- [docs：官方 skills 版本刷新与最新判断修复——文档同步](2026-06-27-docs-official-skills-version-refresh-documentation.md)

## 迁移说明

2026-11-11 按实际工作类型拆分。日期、负责人及状态沿用原文；下列命令和结果均为历史记录，本次迁移不执行历史命令，也不新增验收结论。

## 背景

2. 为每个 skill/extension 记录明确的版本号或可替代版本标识。
现有事实来源表明：
- 上游是否提供显式语义版本号，需要分别对 Claude、Codex、OpenCode 做事实核验与字段审计；OpenCode 无可靠上游来源时继续保持空占位，不编造官方条目。
本计划用于后续轮次协作，先固定范围、阶段、验收标准与风险，再由并行审计子任务回填事实。

## 目标

2. 为每个 skill/extension 建立可展示、可比较、可回溯的版本记录字段。

## 范围

- 设计并落地每个 skill/extension 的版本列表或版本字段方案。

## 非目标

- 本轮计划阶段不直接修改共享 catalog、zip 或业务代码。
- 不引入本计划以外的技能来源平台；当前仅处理 Claude / Codex / OpenCode 分组。
- 不做与官方 skills 管理无关的 UI 重构、插件架构调整或技术栈替换。
- 不在未核验前假设上游存在统一语义版本号。

## 验收标准

- [x] 已确认并实现每个 skill/extension 的版本记录方案，能够生成或维护可枚举的版本列表。
- [x] `media/official_skills_catalog.json` 及相关 schema 支持准确表达版本、来源与比较依据，且 description 保持中文。

## 影响面

- 代码目录：
  - `src/config/`
  - `src/webview/`
- 配置与脚本：
  - `media/official_skills_catalog.json`
- 可能涉及 catalog schema

## 风险与缓解

- 风险：上游无统一语义版本号，导致“版本号列表”目标无法直接映射到现有字段。
  - 缓解：优先审计上游显式 version 字段；若缺失，则明确采用 commit SHA、目录树 hash、内容 hash 等替代版本标识，并记录优先级。
- 风险：三组来源的版本模型不同，统一 schema 时容易过度抽象。
  - 缓解：先定义最小公共字段，再允许按平台保留补充字段，例如 `versionSource`、`sourceCommit`、`contentHash`。

## 验证计划

- 最小相关验证：
  - 核验 catalog schema 是否能表达每个条目的版本与来源比较依据。

## 任务列表

- [x] 阶段 1：建立执行计划，锁定背景、目标、范围、阶段和验收标准。
- [x] 阶段 4：版本列表与 schema 实现。
  - 为每个 skill/extension 增加版本字段或版本标识。
  - 设计 catalog、metadata、必要生成脚本之间的一致性方案。
  - 明确 UI 需要展示的版本信息及其来源。
  - 复核官方 skills 管理体验是否与计划一致。

## 决策记录

- 2026-06-27：计划默认把“每个 skill 版本号记录”解释为“优先语义版本号，缺失时使用可稳定比较的替代版本标识”，避免被单一字段模型卡住。
- 2026-06-27 历史口径：Claude / Codex 使用短 `contentHash` 作为可见版本。

## 当前结论

当前已完成版本字段落库。
2. 所有 catalog 条目都已落 `version`、`versionSource`、`contentHash`；`sourceCommit` 对多数条目已落库。
