---
name: reference-pack
description: Use when you need to export a reusable cross-project pack of stable harness memory docs, runbooks, and skills so another repository can import the same memory or collaboration capabilities without copying the whole harness blindly.
---

# Reference Pack

目标：把稳定的记忆、协作和技能骨架打包成可重建的 `reference pack`，方便跨仓复制，而不是手工挑文件。

## 什么时候用

- 想把当前仓库里已经稳定的一组 skills + docs 导出给另一个项目复用
- 想把 memory / recall / frontier 这类骨架能力拆成独立可复制包
- 想给目标仓库一个明确的 pack 清单、安装说明和来源元数据

## 不该什么时候用

- 你只是要初始化整个 harness 仓库，此时应优先用初始化或更新脚本
- 你还没确定哪些文档和技能已经足够稳定，不适合跨仓复制

## 工作流

1. 在仓库根目录运行：
   - `python3 .agents/skills/reference-pack/scripts/build_reference_pack.py --preset memory-ops`
   - 如果要按 topic corpus 打包某类稳定经验：`python3 .agents/skills/reference-pack/scripts/build_reference_pack.py --preset memory-core --topic "<topic>"`
2. 打开生成结果：
   - `.ch/docs/generated/reference-packs/<pack-name>/manifest.json`
   - `.ch/docs/generated/reference-packs/<pack-name>/FILES.md`
   - `.ch/docs/generated/reference-packs/<pack-name>/INSTALL.md`
3. 将 `bundle/` 下的内容按需要复制到目标仓库。
4. 在目标仓库优先运行：
   - `python3 .agents/skills/reference-pack-importer/scripts/inspect_reference_pack_import.py --pack-dir /path/to/pack`
5. 导入完成后更新：
   - `.ch/docs/references/reference-packs.md`

## 当前预设

- `memory-core`：热区记忆、handoff、memory index / recall / consolidation / freshness 能力
- `frontier-collab`：plans、frontier、claim / release 协作能力
- `memory-ops`：上面两类能力的组合包

## 与 topic corpus 的关系

- `memory-indexer` 生成的 `topic-corpus.md` 用来发现哪些主题已经稳定，适合作为 reference pack 候选。
- 真正导出 reference pack 时，应导出原始事实来源、runbook、design docs 和 skills；`--topic` 只用 generated summary 选择这些原始来源。
- 不要把 generated `topic-corpus.md` 作为唯一事实来源导入其他仓库。
- `<private>`、`<no-memory>` 或 `memory_visibility: private` 标记的内容必须在 pack 中跳过或剥离。

## 产出要求

- 明确 pack 名称、preset、来源仓库和版本
- 明确包含哪些文件和目录
- 给出目标仓库的导入登记说明
- manifest、FILES/INSTALL 等持久化产物只能保留 `source_repo`、`source_ref`、相对路径、hash 和 pack 元数据，不能写入作者机器的绝对仓库路径或输出目录

## 不要这样做

- 不要把 reference pack 当成替代完整 harness 初始化的唯一方式
- 不要复制 pack 后忘记在目标仓库记录来源和版本
- 不要把当前仓库的 generated 结果、临时计划或真实 handoff 带进 pack
- 不要在 pack 或配套文档里传播 `/Users/...`、盘符路径或其他本机绝对路径
