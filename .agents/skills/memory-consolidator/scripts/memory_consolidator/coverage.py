"""Coverage gap analysis for memory consolidation."""

from __future__ import annotations

from .models import MarkdownDoc, Suggestion
from .utils import count_suggestions

def build_coverage_gaps(
    *,
    handoffs: list[MarkdownDoc],
    active_plans: list[MarkdownDoc],
    rolling_summaries: list[dict[str, str]],
    event_memories: list[dict[str, str]],
    pending_items: list[dict[str, str]],
    active_risks: list[dict[str, str]],
    lessons: list[dict[str, str]],
    suggestions: list[Suggestion],
) -> list[str]:
    gaps: list[str] = []
    rolling_candidates = count_suggestions(suggestions, "rolling_summary")
    event_candidates = count_suggestions(suggestions, "event_memory")
    profile_candidates = count_suggestions(suggestions, "profile_memory")
    procedural_candidates = count_suggestions(suggestions, "procedural_experience")
    pending_candidates = count_suggestions(suggestions, "pending_item")
    risk_candidates = count_suggestions(suggestions, "active_risk")
    lesson_candidates = count_suggestions(suggestions, "lesson")
    pitfall_candidates = count_suggestions(suggestions, "pitfall")
    design_candidates = count_suggestions(suggestions, "design_doc")

    if active_plans and not handoffs:
        gaps.append("存在 active plans，但未扫描到最近 handoff；如果任务会跨会话继续，暂停前应补 handoff。")
    if rolling_candidates:
        gaps.append(
            f"发现 {rolling_candidates} 条 L1 滚动摘要候选；可压缩旧 handoff/active plan，降低后续 recall 成本。"
        )
    if event_candidates:
        gaps.append(
            f"发现 {event_candidates} 条 L2 事件记忆候选；可抽取失败原因、成功方案或关键决策。"
        )
    if profile_candidates:
        gaps.append(
            f"发现 {profile_candidates} 条 L3 用户/项目画像候选；确认是否应进入 `PROJECT_CONTEXT.md` 或 `USER_PREFERENCES.md`。"
        )
    if procedural_candidates:
        gaps.append(
            f"发现 {procedural_candidates} 条 L4 程序性经验候选；确认是否应进入 runbook、checklist、skill 或脚本。"
        )
    if pending_candidates:
        gaps.append(
            f"发现 {pending_candidates} 条 open-loop 候选尚未进入 `.ch/docs/memory/PENDING_ITEMS.md`。"
        )
    if risk_candidates:
        gaps.append(
            f"发现 {risk_candidates} 条风险候选尚未进入 `.ch/docs/memory/ACTIVE_RISKS.md`。"
        )
    if lesson_candidates:
        gaps.append(
            f"发现 {lesson_candidates} 条经验候选可从 pitfalls 上提到 `.ch/docs/memory/LESSONS_LEARNED.md`。"
        )
    if pitfall_candidates:
        gaps.append(
            f"发现 {pitfall_candidates} 条 handoff/plan 语义看起来像可复发坑点，值得考虑补入 `.ch/docs/runbooks/PITFALLS.md`。"
        )
    if design_candidates:
        gaps.append(
            f"发现 {design_candidates} 条稳定决策候选可能需要进入 `.ch/docs/design-docs/`，避免长期停留在计划或 handoff。"
        )
    if not pending_items and (handoffs or active_plans):
        gaps.append("当前已有 handoff 或 active plan，但 `PENDING_ITEMS.md` 仍为空；确认是否真的没有跨会话开放事项。")
    if not active_risks and risk_candidates:
        gaps.append("当前存在风险候选，但 `ACTIVE_RISKS.md` 为空；确认是否漏了热区风险跟踪。")
    if not lessons and lesson_candidates:
        gaps.append("当前已有 pitfall 的长期规避动作，但 `LESSONS_LEARNED.md` 为空；确认是否需要压缩成热区经验入口。")
    if not rolling_summaries and (handoffs or active_plans) and rolling_candidates:
        gaps.append("当前已有 handoff 或 active plan，但 `ROLLING_SUMMARY.md` 仍为空；确认是否需要建立第一条 L1 摘要。")
    if not event_memories and event_candidates:
        gaps.append("当前已有重要事件候选，但 `EVENT_MEMORY.md` 仍为空；确认是否需要建立第一条 L2 事件记忆。")
    return gaps


def build_pyramid_review(
    rolling_summaries: list[dict[str, str]],
    event_memories: list[dict[str, str]],
    suggestions: list[Suggestion],
) -> dict[str, object]:
    return {
        "l1_rolling_summary": {
            "tracked": len(rolling_summaries),
            "candidates": [item.to_dict() for item in suggestions if item.kind == "rolling_summary"],
        },
        "l2_event_memory": {
            "tracked": len(event_memories),
            "candidates": [item.to_dict() for item in suggestions if item.kind == "event_memory"],
        },
        "l3_user_project_profile": {
            "candidates": [item.to_dict() for item in suggestions if item.kind == "profile_memory"],
        },
        "l4_procedural_experience": {
            "candidates": [item.to_dict() for item in suggestions if item.kind == "procedural_experience"],
        },
    }
