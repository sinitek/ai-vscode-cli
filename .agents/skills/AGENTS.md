# Skills 目录约定

- 这个目录只保留默认 core skills：`chromium-playwright-smoke`、`codegraph`、`execution-plan`、`memory-consolidator`、`memory-indexer`、`memory-recall`、`ontology`、`repo-indexer`。
- core skill 必须同时满足：默认必要、仓库级、高复用、低噪音。
- 治理报表、跨仓导入/导出、评测、工作台 UI、协作看板等能力不随 core skeleton 提供；如真实项目需要，应作为独立新增技能重新审查。
- 一个技能只解决一个问题，避免把多个流程塞进同一个 `SKILL.md`。
- 优先 instruction-only；只有确实需要稳定脚本时才加 `scripts/`。
- `skills` 允许调用 `python3` 脚本来程序化机械步骤，只要这样能明显提高效率、稳定性或准确率。
- 如果某个 skill 依赖第三方 Python 包，必须在该 skill 的 `SKILL.md` 中写清安装方式；如果它成为全仓前置条件，还要同步更新根级 `README.md`。
- 如果某个 skill 依赖外部 CLI 或 MCP，必须写清“已安装才触发”的边界，不能把可选工具变成默认前置条件。
- `description` 必须清楚写明触发边界和不该触发的场景。
- 技能应尽量引用仓库中的稳定文档，不复制长篇说明。
- 需要 MCP 的技能必须说明为什么需要；默认不新增 MCP。
- 新增 core skill 前必须确认它是默认必要、低噪音且跨任务高复用，避免把按需工具提升为默认入口。
