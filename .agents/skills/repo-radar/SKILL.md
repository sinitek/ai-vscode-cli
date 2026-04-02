---
name: repo-radar
description: Use when starting work in an unfamiliar, very large, or cross-cutting repository and you need a fast, low-noise map of architecture, docs, commands, and likely change areas before implementation.
---

# Repo Radar

目标：在不淹没上下文的前提下，为当前任务建立一张“够用”的仓库地图。

## 工作流

1. 先读最近生效的 `AGENTS.md`，再读根目录的 `README.md`、`ARCHITECTURE.md`、`.ch/docs/README.md`。
2. 只打开和当前任务直接相关的索引、设计文档、构建清单、入口文件、测试命令。
3. 输出一份精简地图，至少回答下面问题：
   - 当前任务对应哪个业务域或技术层？
   - 相关事实来源文档在哪？
   - 最可能改动哪些目录或文件？
   - 有哪些边界、权限、接口、生成产物或验证命令不能忽略？
4. 当仓库很大时，优先用地图、索引、目录说明，而不是深挖无关代码。
5. 一旦已经获得足以行动的上下文，就停止继续扫描。

## 产出格式

- 5 到 10 条以内的仓库地图
- 最小必读清单
- 第一条建议的实现或调查动作

## 不要这样做

- 不要尝试“看完整个仓库”
- 不要复述大段文档原文
- 不要在未被要求时推动技术栈变更
