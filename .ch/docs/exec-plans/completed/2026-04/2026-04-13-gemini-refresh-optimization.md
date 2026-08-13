# Gemini 官方 Extensions 强制刷新优化

- 日期：2026-04-13
- 状态：completed
- 负责人：Codex

## 背景

上一轮已完成 Claude / Codex 官方 Skills 快照刷新，但 Gemini 官方 extensions 在强制全量重抓时，部分 repo tarball 下载会超时，导致 `--refresh-gemini` 稳定性不足。

## 目标

- 提升 `scripts/sync_official_skills.py --refresh-gemini` 的成功率。
- 保持默认同步策略不变，继续优先保证配置页可稳定使用。
- 增强日志与参数，方便后续定位具体失败仓库。

## 范围

- `scripts/sync_official_skills.py`
- 必要的 runbook / 计划文档

## 非目标

- 不改配置页协议。
- 不切换官方来源或技术栈。
- 不引入远程在线 catalog。

## 验收标准

- [x] Gemini 强制刷新在当前网络环境下具备更高成功率，至少不再因单次超时直接整体失败。
- [x] 脚本能输出更清晰的 repo 级进度与失败信息。
- [x] 保持 `npm run build` 通过。

## 影响面

- 代码目录：`scripts/`
- 文档目录：`.ch/docs/exec-plans/active/`, `.ch/docs/runbooks/`
- 配置与脚本：无新增外部依赖

## 风险与缓解

- 风险：GitHub codeload 在当前网络环境下持续慢速。
- 缓解：增加断点续传 / 重试 / 更清晰的失败回退策略，尽量把失败限制在单个 repo。

## 验证计划

- 最小相关验证：对失败过的 Gemini repo 做强制刷新测试。
- 扩展验证：执行 `npm run build`。

## 测试与清单同步

- 单元测试：无现成测试框架，采用脚本实跑验证。
- 功能清单：如用户可见行为未变，可不更新功能清单。
- 相关文档同步：更新本计划与必要 runbook。

## 任务列表

- [x] 复盘失败仓库与现有下载逻辑。
- [x] 实现更稳的 Gemini 下载与强刷策略。
- [x] 完成验证并回写结论。

## 决策记录

- 2026-04-13：优先增强现有同步脚本，不改默认策略；只有显式 `--refresh-gemini` 时才执行 Gemini 全量重抓。

## 当前结论

已为 Gemini 强刷补充 3 类优化：

1. `--only gemini --refresh-gemini` 目标化执行，避免每次重抓都重复刷新 Claude / Codex。
2. `curl` 断点续传 + 多次重试，降低单次网络抖动导致的失败概率。
3. tarball 下载失败时回退 shallow git clone，并输出 repo 级进度日志与刷新摘要。

实测在当前环境中，`python3 scripts/sync_official_skills.py --only gemini --refresh-gemini` 已完整刷新 40 个 Gemini repos，结果为 tarball=40、git=0、reused=0；随后 `npm run build` 通过。
