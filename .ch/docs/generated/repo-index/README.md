# repo-index 目录说明

这个目录用于存放 `repo-indexer` skill 生成的仓库导航索引。

starter 默认只保留这个说明文件，不预置真实生成结果，避免把模板仓库自己的扫描产物带进新项目。

## 生成方式

在真实项目仓库根目录运行：

```bash
python3 .agents/skills/repo-indexer/scripts/generate_repo_index.py --mode quick
```

默认会生成到：

- `.ch/docs/generated/repo-index/index.md`
- `.ch/docs/generated/repo-index/repo-map.md`
- `.ch/docs/generated/repo-index/commands.md`
- `.ch/docs/generated/repo-index/context-entrypoints.md`
- `.ch/docs/generated/repo-index/manifest.json`
- `.ch/docs/generated/repo-index/summary.json`

## 使用原则

- 它是导航层，不替代代码、规格、设计文档或执行计划。
- 当仓库结构、命令体系或入口文档发生变化时，应重新生成。
- 如果任务范围很小且上下文已足够，可以不生成，避免噪音。
