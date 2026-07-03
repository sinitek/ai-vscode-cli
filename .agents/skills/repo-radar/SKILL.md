---
name: repo-radar
description: Compatibility alias for older prompts. Prefer repo-indexer for repository indexing and task-level reconnaissance.
---

# Repo Radar

`repo-radar` 已收敛为兼容入口。新任务优先使用 `repo-indexer`，它同时覆盖：

- 生成或刷新 `.ch/docs/generated/repo-index/` 下的机械导航事实
- 在陌生、大型或跨模块仓库中形成任务级仓库地图
- 输出最小必读清单、可能改动区域和第一条建议动作

保留这个目录只是为了兼容旧提示词、旧文档或外部引用；不要在这里继续维护一份独立的长流程说明。

## 迁移指引

- 遇到“使用 repo-radar”“建立仓库地图”“先侦察仓库”这类请求时，改用 `repo-indexer`。
- 如 generated repo index 缺失或过期，先运行 `repo-indexer` 的生成脚本。
- 如 generated repo index 已新鲜，直接按 `repo-indexer` 的任务级侦察工作流读取索引和少量相关事实来源。

## 不要这样做

- 不要把 `repo-radar` 恢复成与 `repo-indexer` 并行维护的完整说明书。
- 不要在这里复制 `repo-indexer` 的工作流细节。
