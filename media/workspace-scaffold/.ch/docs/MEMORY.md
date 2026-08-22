---
doc_type: memory_rules
scope: global
status: active
last_verified_at: template-fill-when-adopted
source_of_truth: .ch/docs/MEMORY.md
derived_from:
  - .ch/docs/memory/README.md
supersedes: []
related_paths:
  - .ch/docs/memory/
  - .ch/docs/exec-plans/
---

# 记忆流转规则

这个文件定义：信息第一次出现时写到哪里，什么时候上提，什么时候清理。

目标不是制造更多文档，而是让仓库里的知识能稳定流转，不长期卡在聊天、临时计划或零散笔记里。

## 1. 四层记忆

| 层级 | 含义 | 主要载体 |
| --- | --- | --- |
| Working | 当前任务正在使用的信息 | `exec-plans/active/`、当前 Tasklist、任务验证记录 |
| Episodic | 一个阶段发生了什么 | 已完成执行计划结论、`ROLLING_SUMMARY.md`、`EVENT_MEMORY.md` |
| Semantic | 稳定规则、长期事实、用户偏好 | `PROJECT_CONTEXT.md`、`USER_PREFERENCES.md`、`product-specs/FEATURE_INVENTORY.md` |
| Procedural | 可重复执行的方法和规避动作 | `LESSONS_LEARNED.md`、必要 `skills/`、规则文档 |

## 2. 记忆金字塔

| 层级 | 目标 | 主要载体 | 收尾判断 |
| --- | --- | --- | --- |
| L1 滚动摘要 | 压缩仍有跨会话价值的近期脉络 | `memory/ROLLING_SUMMARY.md` | 旧计划是否可以变成短摘要 |
| L2 事件记忆 | 记录失败原因、成功方案、关键决策 | `memory/EVENT_MEMORY.md` | 是否出现以后会影响判断的节点 |
| L3 项目画像 | 保留稳定项目事实和用户偏好 | `memory/PROJECT_CONTEXT.md`、`memory/USER_PREFERENCES.md` | 下次任务是否默认要先知道 |
| L4 程序性经验 | 保留可复用方法和长期规避动作 | `memory/LESSONS_LEARNED.md`、必要 `skills/` | 是否已经能转成“以后每次怎么做” |

越往上越稳定、越可复用；越往下越接近近期上下文。信息上提后，低层只保留短链接或清理重复内容。

## 3. 默认写入规则

### 3.1 当前任务事实

下面内容默认先进入 `exec-plans/active/`：

- 当前目标、范围和非目标
- 验收标准和验证计划
- 阶段进展、风险、失败处理
- 本轮未完成但确定要继续的事项

不要一开始就把这些内容写进长期热区。

### 3.2 跨会话优先信息

下面内容进入 `.ch/docs/memory/`：

- 较旧任务脉络的短摘要
- 会影响后续判断的重要事件
- 长期有效的项目上下文和用户偏好
- 当前仍开放的承诺、待办和风险
- 已验证、值得复用的经验与反模式结论

热区只保留短而关键的入口信息，不承载长过程、完整日志或大段背景。

### 3.3 用户可见能力

如果变化影响功能、行为、权限、流程、角色或验收，必须进入：

- `.ch/docs/product-specs/`
- `.ch/docs/product-specs/FEATURE_INVENTORY.md`

能力索引只放状态、角色、规格来源、实现入口和最近验证链接；验证细节留在计划或测试报告中。

### 3.4 稳定规则和架构结论

- 仓库工作方式进入 `AGENTS.md`。
- 分层边界、模块职责和扩展约定进入 `ARCHITECTURE.md`。
- 安全可靠性进入 `.ch/docs/SECURITY.md`。
- 工具风险进入 `.ch/docs/TOOL_POLICY.md`。
- 测试规则进入 `.ch/docs/TESTING.md`。
- 重复机械流程确实需要程序化时，再进入必要 `skills/`。

starter 默认不预置额外专题目录。真实项目需要时，先在 `.ch/docs/README.md` 登记入口、事实来源和维护边界。

## 4. 长期记忆 front matter

热区记忆文档默认应带统一 front matter：

```yaml
---
memory_type: rolling_summary | event_memory | project_context | user_preferences | pending_items | lesson | active_risk
scope: global | project | module
status: active | superseded | archived
last_verified_at: YYYY-MM-DD
source_of_truth: path-or-owner
derived_from:
  - .ch/docs/exec-plans/active/...
supersedes: []
related_paths: []
---
```

规则：

- `status` 不是装饰；失效或被替代时要改成 `superseded` 或 `archived`。
- `source_of_truth` 指向真正负责这类事实的文档或归属。
- `derived_from`、`supersedes`、`related_paths` 可以先为空，但字段应保留，便于后续机械检查。

## 5. 隐私与禁止入记忆

不允许进入长期记忆或跨仓材料的内容，用隐私标签包裹：

```xml
<private>
这里放只给当前会话看的内容。
</private>
```

同样适用的标签：

- `<private>...</private>`
- `<no-memory>...</no-memory>`
- `<memory-private>...</memory-private>`

密钥、令牌、生产地址、客户数据和运行时实例数据仍不应写入仓库；隐私标签不是密钥管理方案。

## 6. 清理与降级规则

- `exec-plans/active/` 完成后，应决定哪些内容上提，哪些只归档。
- `PENDING_ITEMS.md` 中完成的事项应及时删除，或迁到已完成计划中留痕。
- `ACTIVE_RISKS.md` 中已关闭的风险应移除；如果仍有长期价值，迁入 `EVENT_MEMORY.md` 或 `LESSONS_LEARNED.md`。
- `LESSONS_LEARNED.md` 中如果已经上提成稳定规则或 skill，应改成短链接或删除重复条目。
- 热区任何条目一旦失效，就不应继续占据优先召回面。

## 7. 收尾检查

每次完成非平凡任务，至少检查：

1. 当前计划是否应压缩进 L1 `ROLLING_SUMMARY.md`。
2. 是否出现新的失败原因、成功方案或关键决策，应抽取到 L2 `EVENT_MEMORY.md`。
3. 是否出现新的稳定项目事实或用户偏好，应上提到 L3。
4. 是否出现新的用户可见行为变化，应更新规格和能力索引。
5. 是否出现新的复发问题或固定规避动作，应进入 L4 `LESSONS_LEARNED.md` 或必要 skill。
6. 是否有内容应标记为 `<private>` 或 `<no-memory>`。
7. 执行计划是否记录了实际验证命令、结果和未覆盖风险。
