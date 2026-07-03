# reference-packs 目录说明

这个目录用于存放 `reference-pack` skill 生成的跨仓复用导出包。

starter 默认只保留这个说明文件，不预置真实导出包，避免把模板仓库自己的 pack 结果带进新项目。

## 生成方式

在真实项目仓库根目录运行：

```bash
python3 .agents/skills/reference-pack/scripts/build_reference_pack.py --preset memory-ops
```

默认会生成到：

- `.ch/docs/generated/reference-packs/<pack-name>/manifest.json`
- `.ch/docs/generated/reference-packs/<pack-name>/FILES.md`
- `.ch/docs/generated/reference-packs/<pack-name>/INSTALL.md`
- `.ch/docs/generated/reference-packs/<pack-name>/REFERENCE_ENTRY.md`
- `.ch/docs/generated/reference-packs/<pack-name>/bundle/`

## 使用原则

- reference pack 用于跨仓复制稳定骨架，不替代完整 harness 初始化。
- 目标仓库在真正复制 `bundle/` 前，优先运行 `reference-pack-importer` 做差异检查。
- 复制到目标仓库后，应同步更新 `.ch/docs/references/reference-packs.md`。
- 不要把当前仓库的 generated 结果、真实 handoff 或进行中计划一起打包出去。
