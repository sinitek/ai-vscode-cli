---
name: work-frontier
description: Use when you need a generated view of what should happen next across active exec plans, including blockers, dependencies, and lightweight claim/release ownership hints, without manually scanning every plan.
---

# Work Frontier

目标：把多个 active exec plans 里的“下一步、阻塞、依赖、占用关系”压缩成一组 generated frontier 视图，降低并发协作和跨会话续接时的漂移。

## 什么时候用

- 同时存在多份 active plans，需要判断现在最该做哪一项
- 想快速看到哪些计划被阻塞、依赖什么、由谁占用
- 需要为下一次会话或多个代理提供统一的 work queue 入口
- 收尾前，想确认是否有计划应该释放占用、交接或归档

## 不该什么时候用

- 当前只有一份小型 active plan，且上下文非常清晰
- 你要做的是修改计划内容本身，而不是生成全局视图

## 工作流

1. 在仓库根目录运行：
   - `python3 .agents/skills/work-frontier/scripts/build_work_frontier.py`
2. 先读：
   - `.ch/docs/generated/work-frontier.md`
3. 再按需要展开：
   - `.ch/docs/generated/open-blockers.md`
   - `.ch/docs/generated/ownership-map.md`
4. 如果 frontier 暴露出 claim、handoff 或计划状态不完整，回到相应 active plan 补齐字段和当前结论。
5. 如果已经进入多代理或多会话并发，可继续运行：
   - `python3 .agents/skills/claim-release-auditor/scripts/audit_plan_claims.py`

## 产出要求

- 明确当前扫描了多少 active plans
- 给出 now / next / blocked 三类视图，其中 now 只包含 `in-progress`，next 只包含待开始的 `draft`/归一化 `pending`
- 给出 blockers、dependencies、owner、handoff_to、claim_ttl 等可见性
- 如果没有 active plans，也要明确说明当前 frontier 为空
- 整篇 `private: true` / `memory_visibility: private` 的计划必须跳过，`<private>...</private>` 区块不得进入任何 generated 输出
- starter/template 过滤只针对显式模板文件或明确声明为 template/starter 的占位计划，不能因为正文提到“starter 默认”之类说明文字就丢掉真实计划

## 不要这样做

- 不要把 generated frontier 当成计划的唯一事实来源
- 不要只更新 frontier，不回写真实计划文档中的状态和结论
- 不要把所有 backlog 都塞进 active plans；frontier 只应该反映当前推进中的计划
