# 产研部本地三方整合候选（Round 416）

这是供后续审查的隔离本地整合树，不宣称最终同步、合理合并及合并树全量回归完成。

- 分支：`codex/department-local-integration-round416-20261116`。
- Worktree：`/Users/fangjiawei/.cache/codex-worktrees/sinitek-ai-vscode-cli/department-local-integration-round416-20261116`。
- 两父：候选 `c53f9defc811e5fddcf87e2d052ab0c6069c3087` 与本地 origin `8f396c1b809c43320aad9c4c43eb05c9cf2a3c58`；共同祖先 `f5b5ac57e4b9f956abdb29f82cf8e50d345c2b95`。
- 源码实现树（未加入本目录新证据）：`dc272bd0c3696b132712c8a91c6843da4df82df6`。最终 merge commit/tree 从分支读取；证据不包含自己的提交 SHA，避免自引用。

审查从 [语义解决依据](semantic-review.md) 和 [检查台账](checks.md) 开始。`overlap-review.json` 列出 44 重叠、11 真冲突、33 自动合并路径；`conflicts-initial.json` 保留初始 32 块冲突，`unmerged.txt` 保存三阶段对象标识。`source-manifest.json` 逐文件记录最终源码与两父/祖先 SHA-256、字节数及来源分类；它不包含本目录自引用。`relative-to-{candidate,origin}` 的 patch/stat/name-status 绑定同一实现树，可在两个父临时索引适用。`artifact-hashes.json` 单独绑定本目录其它证据。

平台三路径保持候选 round-403 接受字节，平台并发增量未读取。旧 `department-round414/` 11 份材料未变；其 round-410 构建对应继续有效但只属于原候选。三个安装/ZCode ontology 引用仍待归属确认，未纳入共享改动。共享原 HEAD、master、索引及混合文件不由本轮改变；共享仅更新 handoff 文档。

最终标准构建成功；483 项相关回归有效结果与所有首错日志均保留。没有全量、真实 CLI、EH、浏览器、平台运行或远端操作。根 feature 仍 active/in_progress；平台增量、最终远端同步/合理合并、真实合并树全量回归仍开放，冷安全拒绝不是恢复接管。
