---
name: reference-pack-drift-auditor
description: Use when the repository has imported reference pack baseline manifests and you need to audit which files have drifted, gone missing, or remain aligned with their imported pack source.
---

# Reference Pack Drift Auditor

目标：对已经导入的 `reference pack` 做后续漂移审计，检查哪些文件已经本地偏离、缺失或仍与导入基线一致。

## 什么时候用

- 当前仓库已经导入过一个或多个 `reference pack`
- `.ch/docs/references/reference-pack-manifests/` 中已经存放 pack baseline manifest
- 想检查哪些本地改动已经偏离导入基线
- 想确认 `reference-packs.md` 与基线 manifest 是否仍一致

## 不该什么时候用

- 当前仓库还没有任何 imported pack baseline manifest
- 你要解决的是导入前差异，而不是导入后的本地漂移

## 工作流

1. 在仓库根目录运行：
   - `python3 .agents/skills/reference-pack-drift-auditor/scripts/audit_reference_pack_drift.py`
2. 先读：
   - `.ch/docs/generated/reference-pack-drifts/drift-report.md`
3. 再按需要查看：
   - `.ch/docs/generated/reference-pack-drifts/drift-summary.json`
4. 如果某个 pack 已大幅偏离基线，回写：
   - `.ch/docs/references/reference-packs.md`
   - 必要时更新或替换 `.ch/docs/references/reference-pack-manifests/<pack-name>.json`

## 产出要求

- 明确扫描了多少个 baseline manifest
- 区分 `missing`、`drifted`、`aligned`
- 检查 registry 中是否存在对应 pack 记录
- 如果没有任何 baseline manifest，也要明确说明

## 不要这样做

- 不要把 drift report 当成新的长期事实来源
- 不要在没有 baseline manifest 的情况下假装做出了准确 drift 审计
- 不要发现大幅偏离后却不更新 registry 或 baseline 说明
