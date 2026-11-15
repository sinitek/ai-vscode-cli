# Round 419：已接受平台增量后继候选

本目录只属于 round-419 后继树。父提交为 `51a5e7b15c54921611721fe14863e60361d64e72`，父树 `7e91cfbcff24d0e1eb436374c832b791af3e70d2`。新分支为 `codex/department-platform-delta-round419-20261116`，外置 worktree 为 `/Users/fangjiawei/.cache/codex-worktrees/sinitek-ai-vscode-cli/department-platform-delta-round419-20261116`，初始干净。

仅将 round-403 冻结的以下三路径替换为已接受 round-414/416 增量的稳定字节；没有冲突修复或额外行为改写：

- `scripts/verify_department_platform.js`：公开 spawn/fork 与继承 NODE_OPTIONS 的追踪、唯一 tracker-ready、逐文件与汇总事实、直接 PID 的受限 POSIX 收尾快照。
- `scripts/verify_department_platform.test.js`：报告描述的真实临时 spawn/fork、sidecar 拒绝、直接集合与整树区分等 24 项入口行为测试。
- `.ch/docs/runbooks/department-platform-verification.md`：对应追踪合同、round-414 首次失败与 round-416 首文件定向补验记录。

完整旧/新字节哈希、大小、来源、Git blob 和报告哈希见 `sources.json`。JS 明确匹配任务与报告的已接受 SHA。旧报告未记测试及 runbook 的完整 SHA；本次按报告描述逐项核对其 diff/章节，并对当前稳定来源作前后读与候选对应散列，不把新记录的 SHA 追认为历史执行哈希。历史物理产品里的测试文件仍是 round-403 版本，不能拿它作为 round-414 最终 24 项文件的哈希锚。此来源边界供主审继续复核。

`relative-to-51a.patch.gz` 无损保留全部三路径差异；摘要和完整路径清单在同名前缀的文件中。新证据目录不混入实现 patch，避免自引用。`write-paths.json` 列出提交中全部路径和另外的共享/报告/scratch 写域；`artifact-hashes.json` 绑定本目录其余文件。新证据不能把 round-414/416 的旧报告改写成当前整树运行证据。`preserved-materials.json` 核对原两批共 49 份材料保持父树字节。

本轮没有运行平台入口、行为测试、Owner 套件、build、EH、CLI、浏览器或全量回归，也没有清理任何 dist。复用 51a 最终标准 build 和 483 项相关回归；TS、产品逻辑及测试夹具均未改。平台 24 项行为检查按已接受报告复用；round-416 首文件 26/26 与 round-414 后两文件 12/12、20/20 保持各自快照范围。六个 Owner 源码与历史机器报告 SHA 一致，旧物理产品源/编译对应也相符，见 `reused-evidence.json`。

round-414 首次入口依然失败：PID 9357 无 close，不能用后来的缺席补写。round-416 只有首文件的新运行：29 个直接子进程中 28 个 close，PID 64303 由最终 POSIX 快照确认缺席；直接集合满足合同，整树仍 `unconfirmed`。TAP、driver exit/close、直接集合、整树、Owner receipt/CLOSED 与容量归还分别保留；不新增强制回收，不放宽 required 资源、生产 Owner 或 public-codex 整树门禁。不能宣称本轮执行过完整 58 项，不能宣称 Windows/Linux 通过。

根 feature 仍 active/in_progress。round-410 冷安全拒绝不是恢复接管。最终远端同步、合理合并、真实最终合并树全量回归、必要平台与冷恢复接管门禁均开放。三个未定 ontology 引用、并发 UI/EH 与其它共享字节均未纳入。未执行 fetch/pull/push、发布、reset/stash/clean/prune，未修改父任务记录、调度状态或历史报告。产品合同未变，无需另改功能清单或 ontology。
