# Grok Loop+ 旧任务升级续跑兼容

- 日期：2026-11-23
- 类型：bugfix
- 关联计划：无
- 状态：completed
- 负责人：Codex

## 背景与目标

1.9.x 在 attempt 收尾拆链并删除空临时根，原生 Grok 会话仍在；升级后新校验要求稳定目录标识，旧绑定启动前即被拒绝。让旧 Loop+ 任务可继续，保持原子任务身份、沟通文件、调度及验收。

## 范围与验收

- [x] Grok 原生索引唯一匹配受支持旧版隔离根，且原根缺失或为空时，按原 cwd 和 session ID 严格续接，并持久化 cwd。
- [x] 找不到、安全校验不通过或匹配有歧义时，以明确提示的新会话继续当前子任务；不删除旧会话，只有捕获新 session ID 后才更新兼容绑定并记录来源。
- [x] 后续重试复用替代会话；不修改来源子任务的独立绑定。已有稳定根、非旧 Grok 绑定、原生 Owner 及其他 CLI 的严格行为保持不变。

## 影响面与风险

- 代码：Loop+ adapter、执行根、子任务 session 绑定、部门 Owner 兼容路径。
- 文档：功能清单、会话复用设计、CLI 运行参考、部门模式、排障手册和 CLI runtime ontology。
- 风险：无法可信恢复旧 cwd 时，新会话不会继承 Grok 原生上下文；通过明确提示保留用户预期，旧会话文件不清理，当前子任务可继续派发。
- 防护：目录发现要求 session ID、原生索引元数据、历史根格式和候选唯一性匹配；拒绝非空根；已有根标识的恢复失败不静默降级。

## 验证与结论

- `npm run build`：通过。
- `node --test dist/test/loop/legacyGrokLoopSession.test.js dist/test/loop/loopSubtaskSession.test.js dist/test/extensionHost/loopPlusRuntimeIntegration.test.js dist/test/extensionHost/departmentinteractiveruntime.test.js`：107 项通过，0 失败。
- `python3 .agents/skills/ontology/scripts/search_ontology.py --validate`：通过。
- `git diff --check`：通过。
- 此前本机隔离 Grok 1.0.62 ACP 探针确认恢复要求 session ID 与 cwd 一致，原 cwd 可加载而错误 cwd 返回 `Path not found.`；本次未重放用户任务，也未在真实 Windows 环境验证。
- 功能清单、设计文档、运行参考、排障手册及 ontology 已同步。未修改原生 Grok 历史文件；无法安全恢复时明确转入新会话，不再因缺失旧临时目录阻断当前子任务。
