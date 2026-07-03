# reference-pack-imports 目录说明

这个目录用于存放 `reference-pack-importer` skill 生成的导入前差异检查报告。

starter 默认只保留这个说明文件，不预置真实导入报告，避免把当前仓库自己的 import check 结果带进新项目。

## 生成方式

在目标项目仓库根目录运行：

```bash
python3 .agents/skills/reference-pack-importer/scripts/inspect_reference_pack_import.py --pack-dir /path/to/pack
```

默认会生成到：

- `.ch/docs/generated/reference-pack-imports/<pack-name>/import-report.md`
- `.ch/docs/generated/reference-pack-imports/<pack-name>/import-summary.json`
- `.ch/docs/generated/reference-pack-imports/<pack-name>/COPYLIST.md`
- `.ch/docs/generated/reference-pack-imports/<pack-name>/REFERENCE_MANIFEST.json`

## 使用原则

- importer 只做差异检查，不自动覆盖目标仓库文件。
- 导入前优先审查 `Different` 组，而不是默认覆盖。
- 导入完成后，应将 `REFERENCE_MANIFEST.json` 保存到 `.ch/docs/references/reference-pack-manifests/`，供 drift auditor 使用。
- 导入完成后要同步更新 `.ch/docs/references/reference-packs.md`。
