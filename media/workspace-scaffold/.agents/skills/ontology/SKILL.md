---
name: ontology
description: Use before implementing or reviewing tasks that involve repository business concepts, ownership, permissions, lifecycle, cross-domain flows, or source-of-truth locations, and after such tasks to decide whether the AI development business ontology must be updated. Do not use it as a substitute for current code, product specs, CodeGraph, or the future product ontology module.
---

# Ontology

目标：让 AI 在改代码前先恢复相关业务语义，在改完后及时维护概念、关系、规则和跨域场景，减少“代码位置找到了但业务理解错了”的问题。

## 适用边界

使用本 skill：

- 任务涉及用户、租户、成员、权限、工作区、文件、助手、任务、工坊产物、Workflow、自动化、连接器、计费、审计或观测。
- 需要确认“谁拥有谁、谁能看/改/运行、什么状态可流转、一次请求跨哪些模块”。
- 需要从业务名词快速定位产品规格、架构、SQL 和实现路径。
- 完成业务变更后，需要判断 `.ch/docs/ontology/` 是否同步更新。

不使用本 skill：

- 纯样式、拼写、机械格式化或不改变业务语义的局部实现调整。
- 只需要查代码符号、调用者或影响面的任务；这类问题优先使用 CodeGraph。
- 设计或实现未来面向用户的 ontology 产品模块；本 skill 只服务仓库内 AI 开发知识。

## 任务前工作流

1. 先检查 ontology 是否可用：

   ```bash
   python3 .agents/skills/ontology/scripts/search_ontology.py --status-report
   ```

2. 如果 `needs_initialization=true`，或状态显示 ontology 为空、缺少业务 domain、只剩 scaffold `project.*` 占位，必须先按“空本体初始化流程”从项目已有事实源初始化 ontology；不要跳过 ontology 直接开始业务实现。
3. 从用户需求中提取 2-5 个业务名词、状态或动作。
4. 在仓库根目录查询：

   ```bash
   python3 .agents/skills/ontology/scripts/search_ontology.py "<业务名词 状态 动作>" --related 1
   ```

5. 已知稳定 ID 时精确展开：

   ```bash
   python3 .agents/skills/ontology/scripts/search_ontology.py --id <concept-id> --related 2
   ```

6. 查看命中的概念、关系、规则和跨域场景，并打开 `source_refs` 中最相关的原始事实来源。
7. 如果任务需要代码调用链或最新符号，再使用 CodeGraph；如果 ontology 与事实来源冲突，以当前产品规格、架构、SQL、代码和测试为准，并把漂移列入本次维护范围。

## 空本体初始化流程

当 `--status-report` 显示需要初始化时：

1. 先阅读项目已有事实源，优先顺序为 `README.md`、`ARCHITECTURE.md`、`.ch/docs/product-specs/`、`.ch/docs/TESTING.md`、`docs/`、核心源码目录和数据库/接口契约。
2. 提取 5-12 个稳定业务概念、3-10 条关键关系、2-6 条规则和 1-3 个跨域流程；只写已有事实能支撑的内容。
3. 替换 scaffold `project.*` 占位或新增最贴近业务边界的 `domains/<domain-id>.json`，并更新 `manifest.json` 的 `domain_files` / `workflow_files`。
4. 每条记录必须带可核对的 `source_refs`，避免复制长篇规格或写入密钥、客户数据、生产地址。
5. 初始化后运行：

   ```bash
   python3 .agents/skills/ontology/scripts/search_ontology.py --validate
   python3 -m unittest discover -s .agents/skills/ontology/tests -p 'test_*.py'
   ```

## 查询方式

```bash
# 中文/英文关键词
python3 .agents/skills/ontology/scripts/search_ontology.py "工作流 恢复"

# 默认 match=auto：先严格匹配所有词；0 命中时自动宽松回退，并标明 search_strategy
python3 .agents/skills/ontology/scripts/search_ontology.py "model link renderModel componentDefinition" --json

# 需要完全严格时显式指定 all
python3 .agents/skills/ontology/scripts/search_ontology.py "工作流 恢复" --match all

# 近似/错别字模糊匹配默认启用；需要严格子串匹配时关闭
python3 .agents/skills/ontology/scripts/search_ontology.py "工作流回复快照"
python3 .agents/skills/ontology/scripts/search_ontology.py "工作流回复快照" --no-fuzzy

# 精确 ID 与两跳关系
python3 .agents/skills/ontology/scripts/search_ontology.py --id workflow.run --related 2

# 限定业务域、记录类型或概念类型
python3 .agents/skills/ontology/scripts/search_ontology.py "权限" --domain identity-tenancy --type rule
python3 .agents/skills/ontology/scripts/search_ontology.py "文件" --kind entity

# 供其它脚本消费
python3 .agents/skills/ontology/scripts/search_ontology.py "连接器 会话" --json

# 查看域和完整性
python3 .agents/skills/ontology/scripts/search_ontology.py --list-domains
python3 .agents/skills/ontology/scripts/search_ontology.py --status-report
python3 .agents/skills/ontology/scripts/search_ontology.py --validate
```

完整数据契约、当前域地图和维护规则见 `.ch/docs/ontology/README.md` 与 `.ch/docs/ontology/manifest.json`。

## 任务后更新判断

完成实现、修复或评审后，逐项判断：

1. 是否新增、删除、改名或改变稳定业务概念。
2. 是否改变所有权、归属、绑定、触发、产出、计费、观测或权限关系。
3. 是否改变角色、可见范围、租户隔离、状态机、输入输出、重试/恢复或保留规则。
4. 是否新增或改变贯穿三个及以上概念的核心业务场景。
5. 是否有 `source_refs` 或 `implementation_paths` 因文件迁移而失效。

任一为“是”时，更新最接近的 `.ch/docs/ontology/domains/*.json` 或 `workflows/cross-domain-workflows.json`。只修改描述时保留稳定 ID；语义对象被替换时新增 ID，并把旧对象标记为 `historical` 或记录迁移说明。

更新后必须运行：

```bash
python3 .agents/skills/ontology/scripts/search_ontology.py --validate
python3 -m unittest discover -s .agents/skills/ontology/tests -p 'test_*.py'
```

## 事实来源边界

- ontology 是人工维护的语义导航层，不是应用数据库、生成索引或代码图。
- 不基于推测添加概念或关系；每条记录至少保留一个可核对的仓库内 `source_refs`。
- 不复制长篇产品规格；描述只保留足以判断边界和继续查证的稳定事实。
- 不把密钥、客户数据、生产地址或运行时实例数据写入 ontology。
- 如果变更只影响未来产品化 ontology 模块，不要把其设计态实体混入本 AI 开发 ontology，除非它已经成为当前系统真实业务。
