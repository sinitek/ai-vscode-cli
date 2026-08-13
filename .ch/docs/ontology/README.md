# AI 开发业务本体

这里存放本仓库当前业务与工程语义的 AI 开发辅助 ontology。它把分散在产品规格、架构、代码和 harness 文档中的核心概念、关系、规则与跨域场景压缩成可检索的语义导航层。

## 边界

- 本目录服务于仓库内 AI 开发、代码探索、影响面判断和任务收尾维护。
- 本目录不是用户可见功能，不是应用运行时数据，也不是未来产品化 ontology 模块的设计或存储。
- ontology 不是最高事实来源。发生冲突时，按 `manifest.json` 的 `source_precedence` 回到 `source_refs` 指向的规格、架构、代码和测试核对。
- `.codegraph/` 负责代码符号与调用关系；本目录负责业务语义。两者互补，不能相互替代。

## 任务中的使用顺序

完整查询、初始化和维护流程以 `.agents/skills/ontology/SKILL.md` 为准；本页只记录不变量：

1. 先运行 `python3 .agents/skills/ontology/scripts/search_ontology.py --status-report`。如果输出 `needs_initialization=true`，AI 执行非机械任务前必须先按项目已有事实源初始化 ontology。
2. ontology ready 后，用任务中的业务名词或稳定 ID 查询，并打开结果中的 `source_refs` 核对最新事实来源。
3. 任务完成后判断概念、关系、规则、跨域场景或证据映射是否变化；发生变化时同步更新对应域文件并校验。

## 存储结构

| 路径 | 作用 |
| --- | --- |
| `manifest.json` | 本体身份、版本、文件清单、受控词表和事实来源优先级 |
| `ontology.schema.json` | 域文件与跨域场景文件的 JSON Schema 契约 |
| `domains/*.json` | 按 bounded context 拆分的概念、关系和业务规则 |
| `workflows/cross-domain-workflows.json` | 贯穿多个业务域的端到端场景 |
| `.agents/skills/ontology/` | 查询、关联展开、校验和维护流程 |

## 当前业务域

| Domain ID | 中文名称 | 主要内容 |
| --- | --- | --- |
| `cli-plugin-runtime` | VS Code CLI 插件运行时 | 扩展宿主、聊天面板、本地 CLI、会话、配置档案和 Loop/Graph 执行 |
| `harness-governance` | Harness 治理 | AGENTS 规则、skills、执行计划、记忆、ontology 和 workspace scaffold |

## 什么时候更新

满足任一条件时需要更新：

- 新增、删除、重命名或改变一个稳定业务概念。
- 改变概念间的所有权、归属、绑定、触发、产出、观测或权限关系。
- 改变角色、可见范围、状态机、输入输出、重试/恢复或数据保留规则。
- 新增或改变一个贯穿两个及以上概念的核心业务场景。
- 现有记录的事实来源迁移、路径失效或权威来源发生变化。

仅修改样式、局部文案、内部函数拆分或不改变业务语义的性能优化时通常无需更新。无法判断时，先查询受影响概念并比较其 `description`、关系和规则是否仍然成立。

## 校验

```bash
python3 .agents/skills/ontology/scripts/search_ontology.py --validate
python3 -m unittest discover -s .agents/skills/ontology/tests -p 'test_*.py'
```

校验覆盖 manifest 文件清单、JSON 结构、全局 ID 唯一性、关系端点、规则目标、受控词表和证据路径存在性。它不能替代产品评审、代码测试或对事实来源的人工核对。
