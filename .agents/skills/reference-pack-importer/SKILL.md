---
name: reference-pack-importer
description: Use when you have a generated reference pack from another repository and need a low-risk import-side diff report before copying files into the current repository.
---

# Reference Pack Importer

目标：在目标仓库导入 `reference pack` 之前，先生成一个低风险差异检查报告，而不是直接覆盖文件。

## 什么时候用

- 你已经拿到一个 `reference pack` 目录，准备导入当前仓库
- 想先确认哪些文件缺失、哪些完全一致、哪些存在差异
- 想检查 `.ch/docs/references/reference-packs.md` 是否已经登记该 pack

## 不该什么时候用

- 你还没有生成 pack，此时应先运行 `reference-pack`
- 你要的是自动覆盖文件，而不是人工审查后导入

## 工作流

1. 在目标仓库根目录运行：
   - `python3 .agents/skills/reference-pack-importer/scripts/inspect_reference_pack_import.py --pack-dir /path/to/pack`
2. 先读：
   - `.ch/docs/generated/reference-pack-imports/<pack-name>/import-report.md`
3. 再按需要查看：
   - `COPYLIST.md`
   - `import-summary.json`
   - `REFERENCE_MANIFEST.json`
4. 审查完成后，再手工复制或局部吸收 `bundle/` 中需要的文件。
5. 导入完成后，把 `REFERENCE_MANIFEST.json` 保存到：
   - `.ch/docs/references/reference-pack-manifests/<pack-name>.json`
6. 最后更新：
   - `.ch/docs/references/reference-packs.md`

## 产出要求

- 明确 pack 名称、版本、来源和目标仓库
- 区分 `missing`、`different`、`identical`
- 检查 `reference-packs.md` 是否已有导入登记
- 如果没有差异，也要明确说明 pack 已完全对齐
- importer 生成的 `import-summary.json`、`REFERENCE_MANIFEST.json`、`import-report.md` 只能保留可共享元数据，不能把打包端或当前机器的绝对路径继续写入目标仓库

## 不要这样做

- 不要跳过差异审查直接覆盖目标仓库已有事实来源
- 不要导入后忘记登记来源和版本
- 不要把 importer 报告当成新的长期事实来源
- 不要原样传播旧 manifest 里的 `repo_root`、`source_root`、`pack_dir`、`/Users/...` 等绝对路径字段
