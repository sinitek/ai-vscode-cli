# reference-pack-manifests 目录说明

这个目录用于存放**已导入 reference pack 的 baseline manifest 副本**。

这些 JSON 文件应来自导入时使用过的 pack manifest，或 `reference-pack-importer` 产出的 `REFERENCE_MANIFEST.json`。

## 什么时候写入

- 某个 pack 已完成导入，并准备后续做 drift 审计
- 某个 pack 升级版本，需要替换旧 baseline

## 维护规则

- 文件命名建议：`<pack-name>.json`
- 只保存用于 drift 审计的稳定 baseline，不保存导入前临时 diff 结果
- 如果 pack 已 superseded，可保留旧 manifest，但应在 `reference-packs.md` 中说明状态

starter 默认只保留这个说明文件，不预置真实 baseline manifest。
