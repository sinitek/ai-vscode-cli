# 文档系统总览

这个目录是仓库内轻量 harness 知识系统。starter 只保留规则、测试、ontology、product specs、memory 和 exec-plans；其他主题等真实项目出现稳定事实后再增设。

## 快速入口

| 类别 | 入口 | 事实来源边界 |
| --- | --- | --- |
| 规则 | `AGENTS.md`、`ARCHITECTURE.md`、`.ch/docs/SECURITY.md`、`.ch/docs/TOOL_POLICY.md` | 仓库工作方式、分层边界、安全可靠性和工具风险 |
| 测试 | `.ch/docs/TESTING.md` | 单元测试默认要求、自测顺序、失败分流和例外记录 |
| Ontology | `.ch/docs/ontology/README.md`、`.agents/skills/ontology/SKILL.md` | AI 开发业务语义导航；不替代规格、架构、代码和测试 |
| Product Specs | `.ch/docs/product-specs/FEATURE_INVENTORY.md`、`.ch/docs/product-specs/TEMPLATE.md` | 能力范围、角色、规格来源、实现入口和最近验证链接 |
| Memory | `.ch/docs/MEMORY.md`、`.ch/docs/memory/README.md` | 跨会话优先召回信息、经验、风险和待办 |
| Exec Plans | `.ch/docs/exec-plans/README.md`、`.ch/docs/exec-plans/TEMPLATE.md` | 非平凡任务的范围、验收、验证和归档记录 |
| Skills | `.agents/skills/AGENTS.md`、`codegraph`、`execution-plan`、`ontology` | 必要的仓库级程序性流程 |

## 目录结构

- `.ch/docs/ontology/`：业务概念、关系、规则和跨域场景。
- `.ch/docs/product-specs/`：单项规格模板和能力索引。
- `.ch/docs/memory/`：L1-L4 热区记忆入口。
- `.ch/docs/exec-plans/`：活动计划、完成归档、技术债跟踪和计划模板。

## 合并后的薄入口

- 功能清单治理并入 `.ch/docs/product-specs/FEATURE_INVENTORY.md`。
- 产品视角、前端体验、安全可靠性和工具边界分别并入 `ARCHITECTURE.md`、`.ch/docs/SECURITY.md`、`.ch/docs/TOOL_POLICY.md`、`.ch/docs/TESTING.md`。
- 计划导航并入 `.ch/docs/exec-plans/README.md`。
- 额外专题目录不作为 starter 默认入口；确有长期事实时，先在本页登记入口、事实来源和维护边界。

## 维护原则

- 索引只负责定位事实来源，不承载长验证日志。
- `FEATURE_INVENTORY.md` 是能力索引；验证细节留在执行计划、测试报告或对应规格中。
- `memory/` 只保留跨会话优先需要知道的短信息；长过程回到执行计划或规格。
- ontology 只做语义压缩和事实来源导航，冲突时回到 source refs 核对。
- 新增目录前，优先判断是否能放进现有六类；确需新增时要说明为什么现有入口不足。
