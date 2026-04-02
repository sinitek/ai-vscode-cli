---
name: repo-indexer
description: Use when entering an unfamiliar or large repository and you need a generated, low-noise map of structure, commands, and fact-source entrypoints before planning or implementation.
---

# Repo Indexer

目标：把仓库中可机械提取的导航事实生成到 `.ch/docs/generated/repo-index/`，降低每次会话重复扫仓库的成本。

## 什么时候用

- 第一次进入陌生仓库，且需要快速建立低噪音导航层。
- 开始复杂任务前，需要确认关键目录、常用命令、事实来源入口。
- 仓库目录结构、命令体系、局部 `AGENTS.md` 或文档入口刚发生变化。
- `.ch/docs/generated/repo-index/` 不存在，或明显已经过期。

## 不该什么时候用

- 只改一个你已经熟悉的小文件。
- 已经拿到足够上下文，不需要再生成索引。
- 需要的是架构判断、实现策略或业务推理，而不是导航事实。

## 工作流

1. 先检查 `.ch/docs/generated/repo-index/manifest.json` 是否存在。
2. 如果缺失或明显过期，在仓库根目录运行：
   - `python3 .agents/skills/repo-indexer/scripts/generate_repo_index.py --mode quick`
3. 先读 `.ch/docs/generated/repo-index/index.md`。
4. 再按任务需要读取：
   - `repo-map.md`
   - `commands.md`
   - `context-entrypoints.md`
5. 如果本次任务改变了结构、命令或事实来源入口，收尾前刷新一次生成物。

## 产出要求

- 说明使用了哪个模式。
- 说明生成了哪些文件。
- 如果跳过生成，要说明理由。

## 不要这样做

- 不要把 generated 文档当作唯一事实来源；代码、规格、计划、设计文档仍然优先。
- 不要试图把它做成全仓库百科。
- 不要在很小的改动上触发高成本扫描。
