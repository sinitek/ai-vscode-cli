# 迁移审计

本目录保存历史路径、内容身份和删除证据；当前计划规则见[执行计划说明](../README.md)。映射不替代计划正文，也不代表当前验收或本轮重新执行了历史命令。

| 来源分区 | 规范映射（原来源数） | 测试计划删除证据（条数） |
| --- | --- | --- |
| 四至六月 | [apr-jun](2026-11-11-apr-jun.json)（25） | [apr-jun](test-plan-removals/2026-11-11-apr-jun.json)（5） |
| 七至九月 | [jul-sep](2026-11-11-jul-sep.json)（64） | [jul-sep](test-plan-removals/2026-11-11-jul-sep.json)（58） |
| 十月 | [oct](2026-11-11-oct.json)（69） | [oct](test-plan-removals/2026-11-11-oct.json)（66） |
| 十一月及当时活动来源 | [nov-active](2026-11-11-nov-active.json)（88） | [nov-active](test-plan-removals/2026-11-11-nov-active.json)（87） |

## 字段与证据边界

- 根级映射按 `old_path` 定位，保留 `old_sha256`、`old_status`、`new_paths`、`reference_path` 和逐源 `notes`。哈希标识迁移前内容，不用现有文件重算替换。
- 删除审计按 `source_old_path` 或 `removed_path` 定位，保留 `removed_sha256`、`removed_status`、`reference_path` 和完整 `retained_evidence`。`source_old_path: null` 表示没有迁移原来源。证据含历史命令、失败、跳过、未完成和未验证边界；摘要不能恢复原测试全文，也不能证明当前通过。
- `old_path`、`source_old_path`、`removed_path` 是历史身份。`new_paths`、`reference_path` 记录当时的目标/引用选择，后续清理可能再删除这些目标；字段中的路径不是现行链接承诺，不应仅因目标现已不存在就报作当前死链或改写历史事实。当前文档的实际链接与 ontology `source_refs` 仍须由其所有者核验。
- 删除证据仍被 ontology、references 等当前文档引用，继续从上表原路径查阅；真实 `blocked`、`in-progress` 和带限制的完成状态均保留。

## 已合并的复核分片

2026-11-13 逐份以 `old_path` 对照分片的 `canonical_mapping`：下表 219 条完整条目（含 `notes`）均与规范映射相等，版本和迁移日期一致，`deferred_removals` 全为空；分片间有重叠，规范映射共覆盖其中 152 个唯一来源。仓库引用搜索未发现分片的当前消费者，因此移除这些重复 JSON。下表文件名仅作历史删除记录。

| 原 `review-shards/` 文件 | 规范映射分区 | 相等条目数 |
| --- | --- | --- |
| `2026-11-11-aug-sep.json` | jul-sep | 31 |
| `2026-11-11-july-03-14.json` | jul-sep | 23 |
| `2026-11-11-july-15-31.json` | jul-sep | 10 |
| `2026-11-11-july.json` | jul-sep | 33 |
| `2026-11-11-nov-01-03.json` | nov-active | 20 |
| `2026-11-11-nov-04-06.json` | nov-active | 34 |
| `2026-11-11-nov-04.json` | nov-active | 15 |
| `2026-11-11-nov-05.json` | nov-active | 13 |
| `2026-11-11-nov-06.json` | nov-active | 6 |
| `2026-11-11-nov-07-11.json` | nov-active | 34 |

分片的 `scope` 是当时的分工范围与合并待办，不是新的验收结论。三份七月分片共有的 `integration_notes` 合并保留如下，所述“本轮”指原分片整理轮次：

> 本分片已按 old_path 合并到中央映射；2026-11-11 用户授权删除全部 test 类型计划后，本分片与中央对应条目同步移除 test 目标并选择现有非 test reference_path。
>
> 历史验证证据留存于 .ch/docs/exec-plans/migrations/test-plan-removals/2026-11-11-jul-sep.json；不删除实际测试代码，不将测试开发重新纳入其它类型。外部 Markdown、ontology、generated 与跨分区引用仍由后续集成处理，本轮不宣称全仓引用或门禁通过。

本次只删除已覆盖分片并增加此入口；4 份规范映射与 4 份删除审计原样保留，不以减量为由压缩 `retained_evidence` 或改写哈希、路径、状态。后续 completed 清理的有效引用整合仍由对应所有者处理。
