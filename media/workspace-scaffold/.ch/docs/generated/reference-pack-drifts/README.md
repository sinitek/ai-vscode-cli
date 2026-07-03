# reference-pack-drifts 目录说明

这个目录用于存放 `reference-pack-drift-auditor` skill 生成的导入后漂移审计报告。

starter 默认只保留这个说明文件，不预置真实 drift 报告，避免把当前仓库自己的审计结果带进新项目。

## 生成方式

在目标项目仓库根目录运行：

```bash
python3 .agents/skills/reference-pack-drift-auditor/scripts/audit_reference_pack_drift.py
```

默认会生成到：

- `.ch/docs/generated/reference-pack-drifts/drift-report.md`
- `.ch/docs/generated/reference-pack-drifts/drift-summary.json`

## 使用原则

- drift auditor 依赖 `.ch/docs/references/reference-pack-manifests/*.json` 作为导入基线。
- 如果没有 baseline manifest，审计结果只会提醒缺少基线，不会伪造 drift 结论。
- 发现大幅偏离后，应同步更新 `.ch/docs/references/reference-packs.md`。
