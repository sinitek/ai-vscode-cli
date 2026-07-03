# Tool Policy

这个文档把工具使用边界写成可审查规则，用来吸收 CodeBuddy 式“按任务和角色开放工具”的优点。

它是静态策略，不是运行时拦截器。真正执行时仍必须遵守根级 `AGENTS.md`、局部 `AGENTS.md` 和用户最新指令。

## 默认原则

- 先读事实来源，再做修改。
- 优先使用项目已有脚本、测试命令和局部约定。
- 只在当前任务范围内读写文件。
- 不执行破坏性命令，除非用户明确要求并确认影响。
- 不把密钥、令牌、客户数据或生产地址写入仓库。

## 角色边界

角色契约以 `.agents/profiles/` 中的 profile 文件为准。本页只定义跨角色通用的工具风险分级，避免同一权限表在多处手工同步。

## 工具风险分级

| 等级 | 例子 | 要求 |
| --- | --- | --- |
| low | read, search, status, syntax check | 可直接使用 |
| medium | edit, generate docs, run focused tests | 需要范围明确 |
| high | install dependency, migration, broad format, external write | 需要用户确认或明确计划 |
| forbidden | destructive reset, secret exfiltration, unrelated deletion | 不执行 |

## 记录要求

- 非平凡任务要把关键命令和验证结果写回执行计划、handoff 或最终结论。
- 测试失败的分流标准以 `.ch/docs/TESTING.md` 为准；这里仅要求记录工具失败的关键证据和影响范围。
- 如果跳过应有验证，要说明原因和后续动作。
