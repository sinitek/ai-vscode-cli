# Reference Packs Registry

这个文件用于记录**从其他仓库导入**或**导出给其他仓库**的稳定 `reference pack`。

目标不是追踪所有零散复制，而是给跨仓复用的稳定骨架留下一份可审计来源。

## 什么时候更新

- 从其他仓库导入一组稳定 skills / docs / runbooks
- 将当前仓库的一组稳定骨架导出给其他仓库复用
- 某个 pack 升级了版本、来源或本地改动状态

## 记录规则

- 每个 pack 至少记录：名称、来源仓库、来源版本或 ref、导入日期、作用域、本地改动情况。
- 如果导入后做了本地修改，`本地改动` 不能继续写 `no`。
- 如果 pack 已被完全替代，不要直接删行，改在备注中说明 superseded 关系。
- 导入前建议先运行 `reference-pack-importer`，确认 `missing / different / identical` 清单。
- 如果希望持续审计导入后的本地偏离，应把 baseline manifest 保存到 `.ch/docs/references/reference-pack-manifests/`。

## 当前登记

starter 默认不预置导入记录。真实项目可从第一条跨仓 pack 复用开始维护下表。

| Pack 名称 | 来源仓库 | 来源版本/Ref | 导入日期 | 作用域 | 本地改动 | 备注 |
| --- | --- | --- | --- | --- | --- | --- |
