"""Markdown renderers for memory consolidation reports."""

from __future__ import annotations

from .models import MarkdownDoc, PitfallEntry, PrivacyStats, Suggestion
from .utils import count_suggestions, iso_now

def render_report(
    *,
    handoffs: list[MarkdownDoc],
    active_plans: list[MarkdownDoc],
    pitfall_entries: list[PitfallEntry],
    rolling_summaries: list[dict[str, str]],
    event_memories: list[dict[str, str]],
    pending_items: list[dict[str, str]],
    active_risks: list[dict[str, str]],
    lessons: list[dict[str, str]],
    suggestions: list[Suggestion],
    coverage_gaps: list[str],
    privacy: PrivacyStats,
) -> str:
    lines = [
        "# Memory Consolidation Report",
        "",
        "## Summary",
        "",
        f"- Generated at: {iso_now()}",
        f"- Handoffs scanned: {len(handoffs)}",
        f"- Active plans scanned: {len(active_plans)}",
        f"- Pitfall entries scanned: {len(pitfall_entries)}",
        f"- Rolling summaries tracked: {len(rolling_summaries)}",
        f"- Event memories tracked: {len(event_memories)}",
        f"- Pending items tracked: {len(pending_items)}",
        f"- Active risks tracked: {len(active_risks)}",
        f"- Lessons tracked: {len(lessons)}",
        f"- Suggestions: {len(suggestions)}",
        f"- Coverage gaps: {len(coverage_gaps)}",
        f"- Private docs skipped: {len(privacy.private_docs_skipped)}",
        f"- Private blocks stripped: {privacy.private_blocks_stripped}",
        "",
        "## Sources Scanned",
        "",
    ]

    lines.extend(render_source_list("Recent handoffs", handoffs))
    lines.extend(render_source_list("Active plans", active_plans))
    lines.extend(render_pitfall_list(pitfall_entries))

    lines.extend(["## Memory Pyramid Review", ""])
    lines.extend(
        [
            f"- L1 rolling summaries tracked: {len(rolling_summaries)}; candidates: {count_suggestions(suggestions, 'rolling_summary')}",
            f"- L2 event memories tracked: {len(event_memories)}; candidates: {count_suggestions(suggestions, 'event_memory')}",
            f"- L3 user/project profile candidates: {count_suggestions(suggestions, 'profile_memory')}",
            f"- L4 procedural experience candidates: {count_suggestions(suggestions, 'procedural_experience')}",
            "",
        ]
    )

    lines.extend(render_suggestion_section("L1 Rolling Summary Candidates", suggestions, "rolling_summary"))
    lines.extend(render_suggestion_section("L2 Event Memory Candidates", suggestions, "event_memory"))
    lines.extend(render_suggestion_section("L3 User / Project Profile Candidates", suggestions, "profile_memory"))
    lines.extend(render_suggestion_section("L4 Procedural Experience Candidates", suggestions, "procedural_experience"))
    lines.extend(render_suggestion_section("Pending Item Candidates", suggestions, "pending_item"))
    lines.extend(render_suggestion_section("Active Risk Candidates", suggestions, "active_risk"))
    lines.extend(render_suggestion_section("Lesson Candidates", suggestions, "lesson"))
    lines.extend(render_suggestion_section("Pitfall Candidates", suggestions, "pitfall"))
    lines.extend(render_suggestion_section("Design Doc Candidates", suggestions, "design_doc"))

    lines.extend(["## Coverage Gaps", ""])
    if coverage_gaps:
        lines.extend(f"- {gap}" for gap in coverage_gaps)
    else:
        lines.append("- No obvious consolidation gaps found.")

    lines.extend(
        [
            "",
            "## Next Actions",
            "",
            "1. 先处理 `high` 置信度的 L1/L2、pending item、active risk、lesson 候选。",
            "2. 再判断 L3/L4、pitfall 和 design-doc 候选是否足够稳定，避免把临时信息过早上提。",
            "3. 完成压缩、抽取或上提后，重新运行 `memory-indexer`，必要时再跑 `memory-freshness-auditor`。",
            "",
        ]
    )
    return "\n".join(lines)


def render_source_list(title: str, docs: list[MarkdownDoc]) -> list[str]:
    lines = [f"### {title}", ""]
    if docs:
        lines.extend(f"- `{doc.path}` | updated={doc.modified_at}" for doc in docs)
    else:
        lines.append("- None")
    lines.append("")
    return lines


def render_pitfall_list(entries: list[PitfallEntry]) -> list[str]:
    lines = ["### Pitfall entries", ""]
    if entries:
        lines.extend(f"- `{entry.path}` | {entry.title} | 状态={entry.status}" for entry in entries)
    else:
        lines.append("- None")
    lines.append("")
    return lines


def render_suggestion_section(title: str, suggestions: list[Suggestion], kind: str) -> list[str]:
    lines = [f"## {title}", ""]
    filtered = [item for item in suggestions if item.kind == kind]
    if not filtered:
        lines.append("- No candidates.")
        lines.append("")
        return lines

    for item in filtered:
        draft = ", ".join(f"{key}={value}" for key, value in item.draft_fields.items())
        lines.extend(
            [
                (
                    f"- [{item.confidence}] `{item.source_path}` / `{item.source_section}`"
                    f" -> `{item.destination}`"
                ),
                f"  Candidate: {item.text}",
                f"  Why: {item.reason}",
                f"  Draft: `{draft}`",
                "",
            ]
        )
    return lines
