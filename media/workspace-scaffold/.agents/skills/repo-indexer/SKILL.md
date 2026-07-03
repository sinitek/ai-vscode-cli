---
name: repo-indexer
description: Use when you need to generate or refresh mechanical repository navigation facts under .ch/docs/generated/repo-index/, or when starting work in an unfamiliar, very large, or cross-cutting repository and you need a task-specific map before implementation.
---

# Repo Indexer

目标：把仓库中可机械提取的导航事实生成到 `.ch/docs/generated/repo-index/`，并在需要时基于这些事实形成任务级仓库地图，避免在陌生或大型仓库里盲扫。

## 职责边界

- `repo-indexer` 只负责生成或刷新可复现的导航事实：顶层结构、入口文档、局部 `AGENTS.md`、常见工程命令。
- 任务级侦察只基于仓库事实形成“够用”的地图、必读清单和第一步行动建议，不替代设计判断、业务推理或实现方案。
- 机械索引和任务级地图属于同一工作流：先刷新事实层，再按当前任务收敛阅读范围。

## 什么时候用

- 第一次进入陌生仓库，且缺少 `.ch/docs/generated/repo-index/`。
- 开始复杂任务前，需要刷新关键目录、常用命令、事实来源入口的机械索引。
- 开始陌生、大型或跨模块任务前，需要判断相关技术层、事实来源、可能改动区域和验证命令。
- 仓库目录结构、命令体系、局部 `AGENTS.md` 或文档入口刚发生变化。
- `.ch/docs/generated/repo-index/` 不存在，或明显已经过期。

## 不该什么时候用

- 只改一个你已经熟悉的小文件。
- 已经有足够新鲜的 generated 索引，且当前任务不依赖新增结构或命令。
- 需要的是深入架构决策、实现策略或业务推理，而不是导航事实和初始侦察。

## 机械索引工作流

1. 先检查 `.ch/docs/generated/repo-index/manifest.json` 是否存在。
2. 如果缺失或明显过期，在仓库根目录运行：
   - `python3 .agents/skills/repo-indexer/scripts/generate_repo_index.py --mode quick`
3. 生成完成后先读 `.ch/docs/generated/repo-index/index.md`，确认模式、来源和建议阅读顺序。
4. 再按任务或调用方需要读取：
   - `repo-map.md`
   - `commands.md`
   - `context-entrypoints.md`
5. 如果本次任务改变了结构、命令或事实来源入口，收尾前刷新一次生成物。

## 任务级侦察工作流

当任务需要先建立仓库地图时，在机械索引工作流之后继续执行下面步骤：

1. 先读最近生效的 `AGENTS.md`，确认当前目录规则、授权范围和任务约束。
2. 按任务需要读取根目录 `README.md`、`ARCHITECTURE.md`、`.ch/docs/README.md`，以及 generated 索引中的 `repo-map.md`、`commands.md`、`context-entrypoints.md`。
3. 只打开与当前任务直接相关的设计文档、构建清单、入口文件、测试命令和局部规则。
4. 输出精简仓库地图，覆盖：
   - 当前任务对应哪个业务域或技术层
   - 相关事实来源文档在哪
   - 最可能改动哪些目录或文件
   - 有哪些边界、权限、接口、生成产物或验证命令不能忽略
5. 当仓库很大时，优先使用地图、索引、目录说明和局部规则，避免深挖无关代码。
6. 一旦获得足以行动的上下文，就停止继续扫描，进入计划或实现。

## 产出要求

- 说明使用了哪个模式。
- 说明生成了哪些文件。
- 如果做了任务级侦察，输出 5 到 10 条以内的仓库地图、最小必读清单和第一条建议动作。
- 如果跳过生成，要说明理由。

## 不要这样做

- 不要把 generated 文档当作唯一事实来源；代码、规格、计划、设计文档仍然优先。
- 不要试图把它做成全仓库百科。
- 不要在很小的改动上触发高成本扫描。
- 不要尝试“看完整个仓库”。
- 不要复述大段文档原文。
- 不要手写可由索引脚本机械生成的结构或命令清单。
- 不要在未被要求时推动技术栈变更。
