"""Suggestion generation for memory consolidation candidates."""

from __future__ import annotations

from .models import MarkdownDoc, PitfallEntry, Suggestion
from .utils import (
    add_suggestion,
    build_doc_summary,
    classify_event_type,
    extract_checklist_items,
    extract_list_items,
    extract_prefixed_items,
    extract_risk_pairs,
    is_placeholder_text,
    iso_now,
    looks_like_design,
    looks_like_event,
    looks_like_open_loop,
    looks_like_pitfall,
    looks_like_procedural,
    looks_like_profile,
    looks_like_risk,
    make_design_title,
    normalize_key,
    normalize_sentence,
    profile_destination,
)

def collect_rolling_summary_suggestions(
    suggestions: list[Suggestion],
    seen_keys: set[str],
    handoffs: list[MarkdownDoc],
    active_plans: list[MarkdownDoc],
    existing_rollups: set[str],
) -> None:
    for doc in handoffs:
        summary = build_doc_summary(doc, ("本轮摘要", "已完成", "未完成 / 下一步"))
        add_rolling_summary_suggestion(
            suggestions,
            seen_keys,
            existing_rollups,
            source_path=doc.path,
            source_section="本轮摘要",
            text=summary,
            confidence="high",
            reason="最近 handoff 中存在跨会话上下文，适合压缩成 L1 滚动摘要以减少后续读取原文成本。",
        )

    for doc in active_plans:
        summary = build_doc_summary(doc, ("当前结论", "任务列表", "决策记录"))
        add_rolling_summary_suggestion(
            suggestions,
            seen_keys,
            existing_rollups,
            source_path=doc.path,
            source_section="当前结论",
            text=summary,
            confidence="medium",
            reason="active plan 中存在阶段性上下文；如果任务跨会话延续，适合收尾时压缩到 L1。",
        )


def add_rolling_summary_suggestion(
    suggestions: list[Suggestion],
    seen_keys: set[str],
    existing_rollups: set[str],
    *,
    source_path: str,
    source_section: str,
    text: str,
    confidence: str,
    reason: str,
) -> None:
    candidate = normalize_sentence(text)
    key = normalize_key(candidate)
    if not key or key in existing_rollups or is_placeholder_text(candidate):
        return
    add_suggestion(
        suggestions,
        seen_keys,
        Suggestion(
            kind="rolling_summary",
            destination=".ch/docs/memory/ROLLING_SUMMARY.md",
            confidence=confidence,
            source_path=source_path,
            source_section=source_section,
            text=candidate,
            reason=reason,
            draft_fields={
                "时间窗口": iso_now()[:10],
                "摘要": candidate,
                "覆盖来源": source_path,
                "保留原因": "跨会话上下文压缩",
                "下一次复核": "下次非平凡任务收尾",
            },
        ),
    )


def collect_event_memory_suggestions(
    suggestions: list[Suggestion],
    seen_keys: set[str],
    handoffs: list[MarkdownDoc],
    active_plans: list[MarkdownDoc],
    pitfall_entries: list[PitfallEntry],
    existing_events: set[str],
) -> None:
    source_sections = ("本轮摘要", "已完成", "未完成 / 下一步", "当前结论", "决策记录", "风险与缓解")
    for doc in [*handoffs, *active_plans]:
        for section_name in source_sections:
            for text in extract_list_items(doc.sections.get(section_name, [])):
                if looks_like_event(text):
                    add_event_memory_suggestion(
                        suggestions,
                        seen_keys,
                        existing_events,
                        source_path=doc.path,
                        source_section=section_name,
                        text=text,
                        confidence="medium",
                        reason="来源中出现失败原因、成功方案、回滚、迁移或关键决策语义，适合抽取为 L2 事件记忆。",
                    )

    for entry in pitfall_entries:
        event_text = entry.title
        if entry.symptom:
            event_text = f"{entry.title}：{entry.symptom}"
        add_event_memory_suggestion(
            suggestions,
            seen_keys,
            existing_events,
            source_path=entry.path,
            source_section=entry.title,
            text=event_text,
            confidence="high",
            reason="pitfall 已经记录可复发问题，适合保留为 L2 事件索引，后续再上提到 L4 runbook 或 skill。",
        )


def add_event_memory_suggestion(
    suggestions: list[Suggestion],
    seen_keys: set[str],
    existing_events: set[str],
    *,
    source_path: str,
    source_section: str,
    text: str,
    confidence: str,
    reason: str,
) -> None:
    candidate = normalize_sentence(text)
    key = normalize_key(candidate)
    if not key or key in existing_events or is_placeholder_text(candidate):
        return
    event_type = classify_event_type(candidate)
    add_suggestion(
        suggestions,
        seen_keys,
        Suggestion(
            kind="event_memory",
            destination=".ch/docs/memory/EVENT_MEMORY.md",
            confidence=confidence,
            source_path=source_path,
            source_section=source_section,
            text=candidate,
            reason=reason,
            draft_fields={
                "日期": iso_now()[:10],
                "类型": event_type,
                "事件": candidate,
                "结果/原因": "待确认",
                "可复用结论": "待提炼",
                "来源": source_path,
            },
        ),
    )


def collect_profile_suggestions(
    suggestions: list[Suggestion],
    seen_keys: set[str],
    handoffs: list[MarkdownDoc],
    active_plans: list[MarkdownDoc],
) -> None:
    for doc in [*handoffs, *active_plans]:
        for section_name in ("本轮摘要", "当前结论", "决策记录", "已完成"):
            for text in extract_list_items(doc.sections.get(section_name, [])):
                if looks_like_profile(text):
                    destination = profile_destination(text)
                    add_suggestion(
                        suggestions,
                        seen_keys,
                        Suggestion(
                            kind="profile_memory",
                            destination=destination,
                            confidence="medium",
                            source_path=doc.path,
                            source_section=section_name,
                            text=normalize_sentence(text),
                            reason="来源中出现长期用户偏好、项目约束或技术栈画像语义，可能应上提到 L3。",
                            draft_fields={
                                "建议位置": destination,
                                "建议条目": normalize_sentence(text),
                                "来源": doc.path,
                            },
                        ),
                    )


def collect_procedural_suggestions(
    suggestions: list[Suggestion],
    seen_keys: set[str],
    handoffs: list[MarkdownDoc],
    active_plans: list[MarkdownDoc],
    pitfall_entries: list[PitfallEntry],
    existing_pitfalls: set[str],
) -> None:
    for doc in [*handoffs, *active_plans]:
        for section_name in ("当前结论", "决策记录", "风险与缓解", "已完成"):
            for text in extract_list_items(doc.sections.get(section_name, [])):
                candidate = normalize_sentence(text)
                key = normalize_key(candidate)
                if not looks_like_procedural(candidate) or key in existing_pitfalls:
                    continue
                add_suggestion(
                    suggestions,
                    seen_keys,
                    Suggestion(
                        kind="procedural_experience",
                        destination=".ch/docs/runbooks/ or .agents/skills/",
                        confidence="medium",
                        source_path=doc.path,
                        source_section=section_name,
                        text=candidate,
                        reason="来源中出现可复用操作规则语义，可能应沉淀到 L4 runbook、checklist、skill 或脚本。",
                        draft_fields={
                            "建议容器": "先判断 runbook；如果可机械化再进入 skill/script",
                            "建议规则": candidate,
                            "来源": doc.path,
                        },
                    ),
                )

    for entry in pitfall_entries:
        if is_placeholder_text(entry.long_term_avoidance):
            continue
        add_suggestion(
            suggestions,
            seen_keys,
            Suggestion(
                kind="procedural_experience",
                destination=".ch/docs/runbooks/",
                confidence="high",
                source_path=entry.path,
                source_section=entry.title,
                text=entry.long_term_avoidance,
                reason="pitfall 已经有长期规避动作，适合进入 L4 程序性经验。",
                draft_fields={
                    "建议容器": ".ch/docs/runbooks/",
                    "建议规则": entry.long_term_avoidance,
                    "来源": entry.path,
                },
            ),
        )


def collect_pending_item_suggestions(
    suggestions: list[Suggestion],
    seen_keys: set[str],
    handoffs: list[MarkdownDoc],
    active_plans: list[MarkdownDoc],
    existing_pending: set[str],
) -> None:
    for doc in handoffs:
        for text in extract_list_items(doc.sections.get("未完成 / 下一步", [])):
            add_pending_item_suggestion(suggestions, seen_keys, existing_pending, doc.path, "未完成 / 下一步", text, "high")
        for text in extract_prefixed_items(
            doc.sections.get("本轮摘要", []),
            ("当前停在", "下一次接手时最先要知道"),
        ):
            add_pending_item_suggestion(suggestions, seen_keys, existing_pending, doc.path, "本轮摘要", text, "medium")

    for doc in active_plans:
        for task in extract_checklist_items(doc.sections.get("任务列表", []), checked=False):
            add_pending_item_suggestion(suggestions, seen_keys, existing_pending, doc.path, "任务列表", task, "high")
        for text in extract_list_items(doc.sections.get("当前结论", [])):
            if looks_like_open_loop(text):
                add_pending_item_suggestion(suggestions, seen_keys, existing_pending, doc.path, "当前结论", text, "medium")


def add_pending_item_suggestion(
    suggestions: list[Suggestion],
    seen_keys: set[str],
    existing_pending: set[str],
    source_path: str,
    source_section: str,
    text: str,
    confidence: str,
) -> None:
    candidate = normalize_sentence(text)
    if is_placeholder_text(candidate):
        return
    key = normalize_key(candidate)
    if not key or key in existing_pending:
        return
    add_suggestion(
        suggestions,
        seen_keys,
        Suggestion(
            kind="pending_item",
            destination=".ch/docs/memory/PENDING_ITEMS.md",
            confidence=confidence,
            source_path=source_path,
            source_section=source_section,
            text=candidate,
            reason="最近 handoff 或 active plan 中仍有开放动作，但当前未进入 pending items 热区。",
            draft_fields={
                "事项": candidate,
                "状态": "open",
                "Owner": "待定",
                "来源": source_path,
                "下一步": candidate,
            },
        ),
    )


def collect_active_risk_suggestions(
    suggestions: list[Suggestion],
    seen_keys: set[str],
    handoffs: list[MarkdownDoc],
    active_plans: list[MarkdownDoc],
    pitfall_entries: list[PitfallEntry],
    existing_risks: set[str],
) -> None:
    for doc in active_plans:
        for risk, mitigation in extract_risk_pairs(doc.sections.get("风险与缓解", [])):
            add_active_risk_suggestion(
                suggestions,
                seen_keys,
                existing_risks,
                source_path=doc.path,
                source_section="风险与缓解",
                risk=risk,
                mitigation=mitigation,
                confidence="high",
                reason="active plan 已经明确记录风险，但当前热区没有对应 active risk。",
            )
        for text in extract_list_items(doc.sections.get("当前结论", [])):
            if looks_like_risk(text):
                add_active_risk_suggestion(
                    suggestions,
                    seen_keys,
                    existing_risks,
                    source_path=doc.path,
                    source_section="当前结论",
                    risk=text,
                    mitigation="待补充",
                    confidence="medium",
                    reason="当前结论里出现了风险或不确定项，适合进入 active risks 热区跟踪。",
                )

    for doc in handoffs:
        for text in extract_list_items(doc.sections.get("未完成 / 下一步", [])):
            if looks_like_risk(text):
                add_active_risk_suggestion(
                    suggestions,
                    seen_keys,
                    existing_risks,
                    source_path=doc.path,
                    source_section="未完成 / 下一步",
                    risk=text,
                    mitigation="待补充",
                    confidence="medium",
                    reason="handoff 中存在待持续关注的风险，但当前热区未显式跟踪。",
                )

    for entry in pitfall_entries:
        if "有效" not in entry.status and "观察" not in entry.status:
            continue
        add_active_risk_suggestion(
            suggestions,
            seen_keys,
            existing_risks,
            source_path=entry.path,
            source_section=entry.title,
            risk=entry.title,
            mitigation=entry.long_term_avoidance or entry.verification or "待补充",
            confidence="medium",
            reason="pitfall 条目仍处于有效或需观察状态，说明它可能也应进入 active risks 热区。",
        )


def add_active_risk_suggestion(
    suggestions: list[Suggestion],
    seen_keys: set[str],
    existing_risks: set[str],
    *,
    source_path: str,
    source_section: str,
    risk: str,
    mitigation: str,
    confidence: str,
    reason: str,
) -> None:
    candidate = normalize_sentence(risk)
    if is_placeholder_text(candidate):
        return
    key = normalize_key(candidate)
    if not key or key in existing_risks:
        return
    add_suggestion(
        suggestions,
        seen_keys,
        Suggestion(
            kind="active_risk",
            destination=".ch/docs/memory/ACTIVE_RISKS.md",
            confidence=confidence,
            source_path=source_path,
            source_section=source_section,
            text=candidate,
            reason=reason,
            draft_fields={
                "风险": candidate,
                "影响": "待补充",
                "当前缓解": mitigation if not is_placeholder_text(mitigation) else "待补充",
                "来源": source_path,
            },
        ),
    )


def collect_lesson_suggestions(
    suggestions: list[Suggestion],
    seen_keys: set[str],
    pitfall_entries: list[PitfallEntry],
    existing_lessons: set[str],
) -> None:
    for entry in pitfall_entries:
        if is_placeholder_text(entry.long_term_avoidance):
            continue
        key = normalize_key(entry.title)
        if not key or key in existing_lessons:
            continue
        add_suggestion(
            suggestions,
            seen_keys,
            Suggestion(
                kind="lesson",
                destination=".ch/docs/memory/LESSONS_LEARNED.md",
                confidence="high",
                source_path=entry.path,
                source_section=entry.title,
                text=entry.title,
                reason="pitfall 已经沉淀出长期规避动作，适合压缩成热区 lesson 入口。",
                draft_fields={
                    "场景": entry.title,
                    "推荐动作": entry.long_term_avoidance,
                    "来源": entry.path,
                },
            ),
        )


def collect_pitfall_suggestions(
    suggestions: list[Suggestion],
    seen_keys: set[str],
    handoffs: list[MarkdownDoc],
    active_plans: list[MarkdownDoc],
    existing_pitfalls: set[str],
) -> None:
    source_sections = ("本轮摘要", "已完成", "未完成 / 下一步", "风险与缓解", "当前结论")
    for doc in [*handoffs, *active_plans]:
        for section_name in source_sections:
            for text in extract_list_items(doc.sections.get(section_name, [])):
                if looks_like_pitfall(text):
                    add_pitfall_suggestion(suggestions, seen_keys, existing_pitfalls, doc.path, section_name, text)


def add_pitfall_suggestion(
    suggestions: list[Suggestion],
    seen_keys: set[str],
    existing_pitfalls: set[str],
    source_path: str,
    source_section: str,
    text: str,
) -> None:
    candidate = normalize_sentence(text)
    key = normalize_key(candidate)
    if not key or key in existing_pitfalls or is_placeholder_text(candidate):
        return
    add_suggestion(
        suggestions,
        seen_keys,
        Suggestion(
            kind="pitfall",
            destination=".ch/docs/runbooks/PITFALLS.md",
            confidence="medium",
            source_path=source_path,
            source_section=source_section,
            text=candidate,
            reason="handoff 或 plan 中出现了可复发的坑点语义，可能值得上提到 runbook / pitfalls。",
            draft_fields={
                "建议模块": "待判断",
                "建议条目": candidate,
                "来源": source_path,
            },
        ),
    )


def collect_design_suggestions(
    suggestions: list[Suggestion],
    seen_keys: set[str],
    handoffs: list[MarkdownDoc],
    active_plans: list[MarkdownDoc],
    design_titles: set[str],
) -> None:
    for doc in active_plans:
        for text in extract_list_items(doc.sections.get("决策记录", [])):
            add_design_suggestion(suggestions, seen_keys, design_titles, doc.path, "决策记录", text, "high")
        for text in extract_list_items(doc.sections.get("当前结论", [])):
            if looks_like_design(text):
                add_design_suggestion(suggestions, seen_keys, design_titles, doc.path, "当前结论", text, "medium")

    for doc in handoffs:
        for section_name in ("本轮摘要", "已完成"):
            for text in extract_list_items(doc.sections.get(section_name, [])):
                if looks_like_design(text):
                    add_design_suggestion(suggestions, seen_keys, design_titles, doc.path, section_name, text, "medium")


def add_design_suggestion(
    suggestions: list[Suggestion],
    seen_keys: set[str],
    design_titles: set[str],
    source_path: str,
    source_section: str,
    text: str,
    confidence: str,
) -> None:
    candidate = normalize_sentence(text)
    key = normalize_key(candidate)
    if not key or key in design_titles or is_placeholder_text(candidate):
        return
    add_suggestion(
        suggestions,
        seen_keys,
        Suggestion(
            kind="design_doc",
            destination=".ch/docs/design-docs/",
            confidence=confidence,
            source_path=source_path,
            source_section=source_section,
            text=candidate,
            reason="计划或 handoff 中已经出现稳定决策语义，可能值得提升为设计文档事实来源。",
            draft_fields={
                "建议标题": make_design_title(candidate),
                "相关来源": source_path,
            },
        ),
    )
