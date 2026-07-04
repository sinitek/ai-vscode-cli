"""Markdown and debug renderers for recall packs."""

from __future__ import annotations

import re

from .models import SelectedDoc, SelectedObservation
from .text_utils import iso_now
from .watch_items import build_claim_status_summary, watch_item_message

def render_report(
    *,
    focus: str,
    anchor_id: str,
    generated_docs: list[SelectedDoc],
    observations: list[SelectedObservation],
    expanded_observations: list[SelectedObservation],
    timeline_window: list[SelectedObservation],
    hot_zone_docs: list[SelectedDoc],
    handoffs: list[SelectedDoc],
    active_plans: list[SelectedDoc],
    design_docs: list[SelectedDoc],
    runbooks: list[SelectedDoc],
    watch_items: list[dict[str, object]],
    memory_summary: dict[str, object],
    selection_mode: str,
    retrieval_debug_path: str,
    source_diversity: dict[str, object],
    matched_terms: list[str],
) -> str:
    total_available = int(memory_summary.get("observation_count", 0) or 0)
    total_read_tokens = int(memory_summary.get("total_read_tokens", 0) or 0)
    selected_tokens = sum(item.read_tokens for item in observations)
    expanded_tokens = sum(item.read_tokens for item in expanded_observations)
    lines = [
        "# Memory Recall Pack",
        "",
        "## Summary",
        "",
        f"- Generated at: {iso_now()}",
        f"- Focus: {focus or 'baseline / no explicit focus'}",
        f"- Anchor ID: {anchor_id or '-'}",
        f"- Selection mode: {selection_mode}",
        f"- Available observation entries: {total_available}",
        f"- Available read cost: ~{total_read_tokens} tokens",
        f"- Selected index entries: {len(observations)} (~{selected_tokens} tokens if fully expanded)",
        f"- Expanded entries in this pack: {len(expanded_observations)} (~{expanded_tokens} tokens)",
        f"- Generated recall surfaces: {len(generated_docs)}",
        f"- Hot-zone docs: {len(hot_zone_docs)}",
        f"- Recent handoffs: {len(handoffs)}",
        f"- Active plans: {len(active_plans)}",
        f"- Related design docs: {len(design_docs)}",
        f"- Related runbooks: {len(runbooks)}",
        f"- Source diversity: {source_diversity.get('unique_source_count', 0)} unique sources / {source_diversity.get('selected_observation_count', 0)} selected observations",
        f"- Retrieval debug: `{retrieval_debug_path}`",
        "",
        "## Progressive Disclosure",
        "",
        "1. 先扫下面的 Observation Index，确认哪些 ID 值得展开。",
        "2. 只读取 Expanded Observation Details 中少量最高优先级条目。",
        "3. 如果需要更多细节，再按 ID 打开 `observation-registry.md` 或 `observations.jsonl`。",
        "4. 如果需要上下文顺序，用 `timeline.md` 或重新运行 `--anchor-id <id>`。",
        "",
    ]

    if matched_terms:
        lines.extend(
            [
                "## Focus Match Summary",
                "",
                f"- Matched terms: {', '.join(f'`{term}`' for term in matched_terms)}",
                "",
            ]
        )

    lines.extend(render_observation_index(observations))
    lines.extend(render_expanded_observations(expanded_observations))
    if anchor_id:
        lines.extend(render_timeline_window(anchor_id, timeline_window))

    lines.extend(
        [
            "## Recommended Reading Order",
            "",
            "1. `recall-index.md` / 本文件的 Observation Index。",
            "2. 本文件的 Expanded Observation Details。",
            "3. `open-loops.md` 和 `freshness-report.md`。",
            "4. 如果任务是跨会话续接，再看最近 handoff。",
            "5. 再看相关 active plans，确认 working-layer 目标、任务列表和验证计划。",
            "6. 如果提供了 focus，再展开匹配到的 design docs 和 runbooks。",
            "",
        ]
    )

    lines.extend(render_section("Generated Recall Surfaces", generated_docs))
    lines.extend(render_section("Hot-Zone Docs", hot_zone_docs))
    lines.extend(render_section("Recent Handoffs", handoffs))
    lines.extend(render_section("Active Plans", active_plans))
    lines.extend(render_section("Related Design Docs", design_docs))
    lines.extend(render_section("Related Runbooks", runbooks))

    lines.extend(["## Watch Items", ""])
    lines.extend(f"- {watch_item_message(item)}" for item in watch_items)
    lines.append("")

    lines.extend(
        [
            "## Suggested Next Commands",
            "",
            "- `python3 .agents/skills/memory-indexer/scripts/generate_memory_index.py`：当热区或开放事项变化后刷新基础 recall 面。",
            "- `python3 .agents/skills/memory-recall/scripts/build_recall_pack.py --anchor-id <mem-id>`：围绕某个 observation ID 生成 timeline window。",
            "- `python3 .agents/skills/memory-consolidator/scripts/consolidate_memory.py`：当 recall 暴露出 promotion backlog 时继续做 consolidation。",
            "- `python3 .agents/skills/memory-freshness-auditor/scripts/audit_memory_freshness.py`：当 recall 暴露 stale docs 或 attribution 缺口时继续做 freshness audit。",
            "",
        ]
    )
    return "\n".join(lines)


def render_observation_index(observations: list[SelectedObservation]) -> list[str]:
    lines = [
        "## Observation Index",
        "",
        "| ID | Type | Title | Read | Source | Why |",
        "| --- | --- | --- | --- | --- | --- |",
    ]
    if not observations:
        lines.append("| - | - | 当前没有 selected observation entries | - | - | - |")
        lines.append("")
        return lines
    for item in observations:
        lines.append(
            f"| `{item.id}` | `{item.type}` | {escape_pipes(shorten(item.title, 96))} | "
            f"~{item.read_tokens} | `{item.source_path}` | {escape_pipes(item.reason)} |"
        )
    lines.append("")
    return lines


def render_expanded_observations(observations: list[SelectedObservation]) -> list[str]:
    lines = ["## Expanded Observation Details", ""]
    if not observations:
        lines.append("- None")
        lines.append("")
        return lines
    for item in observations:
        lines.extend(
            [
                f"### {item.id} - {item.title}",
                "",
                f"- Type: `{item.type}`",
                f"- Topic: `{item.topic or '-'}`",
                f"- Read: ~{item.read_tokens} tokens",
                f"- Source: `{item.source_path}`",
                f"- Score: `{item.final_score}` (base `{item.preliminary_score}`)",
            ]
        )
        if item.matched_terms:
            lines.append(f"- Matches: {', '.join(f'`{term}`' for term in item.matched_terms)}")
        if item.selected_claim_ids:
            lines.append(f"- Selected claims: {format_claim_id_list(item.selected_claim_ids)}")
        if item.score_breakdown:
            breakdown = ", ".join(
                f"{name}={value}"
                for name, value in item.score_breakdown.items()
            )
            lines.append(f"- Score breakdown: {breakdown}")
        if item.concepts:
            lines.append(f"- Concepts: {', '.join(f'`{concept}`' for concept in item.concepts[:6])}")
        if item.files:
            lines.append(f"- Files: {', '.join(f'`{file}`' for file in item.files[:8])}")
        if item.facts:
            lines.extend(["", "Facts:"])
            lines.extend(f"- {fact}" for fact in item.facts[:5])
        if item.narrative:
            lines.extend(["", "Narrative:", "", item.narrative])
        lines.append("")
    return lines


def render_timeline_window(anchor_id: str, observations: list[SelectedObservation]) -> list[str]:
    lines = [
        "## Timeline Window",
        "",
        f"- Anchor: `{anchor_id}`",
        "",
        "| ID | Modified | Type | Title | Source |",
        "| --- | --- | --- | --- | --- |",
    ]
    if not observations:
        lines.append("| - | - | - | Anchor not found in generated observation registry | - |")
        lines.append("")
        return lines
    for item in observations:
        marker = " (anchor)" if item.id == anchor_id else ""
        lines.append(
            f"| `{item.id}`{marker} | {item.modified_at or '-'} | `{item.type}` | "
            f"{escape_pipes(shorten(item.title, 96))} | `{item.source_path}` |"
        )
    lines.append("")
    return lines


def render_retrieval_debug(
    *,
    focus: str,
    focus_terms: list[str],
    anchor_id: str,
    observations: list[SelectedObservation],
    selection_debug: dict[str, object],
    source_diversity: dict[str, object],
    selected_claims: list[dict[str, object]],
    watch_items: list[dict[str, object]],
) -> str:
    ranked_candidates = selection_debug.get("ranked_candidates", [])
    top_unselected = selection_debug.get("top_unselected", [])
    heuristics = selection_debug.get("heuristics", [])
    lines = [
        "# Retrieval Debug",
        "",
        "这个文件只解释本次 recall 为什么选中了这些 observation，以及有哪些轻量词法启发式参与排序。",
        "它是 generated-only 的 debug / eval 辅助层，不是新的长期事实来源。",
        "",
        "## Run Context",
        "",
        f"- Generated at: {iso_now()}",
        f"- Focus: {focus or 'baseline / no explicit focus'}",
        f"- Focus terms: {', '.join(f'`{term}`' for term in focus_terms) if focus_terms else '-'}",
        f"- Anchor ID: {anchor_id or '-'}",
        f"- Selection mode: {selection_debug.get('mode', 'unknown')}",
        f"- Candidate count: {selection_debug.get('candidate_count', 0)}",
        f"- Ranked candidate count: {selection_debug.get('ranked_candidate_count', 0)}",
        f"- Focus match count: {selection_debug.get('focus_match_count', 0)}",
        f"- Focus excluded count: {selection_debug.get('focus_excluded_count', 0)}",
        "",
        "## Heuristics",
        "",
    ]
    if heuristics:
        lines.extend(f"- `{name}`" for name in heuristics)
    else:
        lines.append("- None")
    lines.extend(
        [
            "",
            "## Selected Observations",
            "",
            "| Rank | ID | Final | Base | Matched Terms | Source | Claims |",
            "| --- | --- | --- | --- | --- | --- | --- |",
        ]
    )
    if not observations:
        lines.append("| - | - | - | - | 当前没有选中的 observation | - | - |")
    else:
        for item in observations:
            lines.append(
                f"| {item.selection_rank or '-'} | `{item.id}` | `{item.final_score}` | `{item.preliminary_score}` | "
                f"{escape_pipes(', '.join(item.matched_terms) or '-')} | `{item.source_path}` | `{len(item.selected_claim_ids)}` |"
            )
    lines.extend(["", "## Score Breakdown", ""])
    if not observations:
        lines.append("- None")
    else:
        for item in observations:
            lines.extend(
                [
                    f"### {item.id} - {item.title}",
                    "",
                    f"- Final score: `{item.final_score}`",
                    f"- Base score: `{item.preliminary_score}`",
                    f"- Matched terms: {', '.join(f'`{term}`' for term in item.matched_terms) if item.matched_terms else '-'}",
                    f"- Source: `{item.source_path}`",
                    f"- Selected claim IDs: {format_claim_id_list(item.selected_claim_ids)}",
                    "",
                    "| Heuristic | Contribution |",
                    "| --- | --- |",
                ]
            )
            for name, value in item.score_breakdown.items():
                lines.append(f"| `{name}` | `{value}` |")
            lines.append("")

    lines.extend(["## Top Unselected Candidates", ""])
    if not isinstance(top_unselected, list) or not top_unselected:
        lines.append("- None")
        lines.append("")
    else:
        lines.extend(
            [
                "| ID | Final | Base | Matched Terms | Source |",
                "| --- | --- | --- | --- | --- |",
            ]
        )
        for entry in top_unselected:
            if not isinstance(entry, dict):
                continue
            lines.append(
                f"| `{entry.get('id', '-')}` | `{entry.get('final_score', '-')}` | `{entry.get('preliminary_score', '-')}` | "
                f"{escape_pipes(', '.join(str(term) for term in entry.get('matched_terms', [])) or '-')} | "
                f"`{entry.get('source_path', '-')}` |"
            )
        lines.append("")

    lines.extend(
        [
            "## Source Diversity",
            "",
            f"- Unique source count: {source_diversity.get('unique_source_count', 0)}",
            f"- Selected observation count: {source_diversity.get('selected_observation_count', 0)}",
            f"- Max same-source observations: {source_diversity.get('max_same_source_observations', 0)}",
            "",
            "### Source Path Counts",
            "",
        ]
    )
    source_path_counts = source_diversity.get("source_path_counts", {})
    if isinstance(source_path_counts, dict) and source_path_counts:
        lines.extend(f"- `{path}`: {count}" for path, count in source_path_counts.items())
    else:
        lines.append("- None")
    lines.extend(["", "### Source Kind Counts", ""])
    source_kind_counts = source_diversity.get("source_kind_counts", {})
    if isinstance(source_kind_counts, dict) and source_kind_counts:
        lines.extend(f"- `{kind}`: {count}" for kind, count in source_kind_counts.items())
    else:
        lines.append("- None")

    lines.extend(["", "## Claim Status Snapshot", ""])
    claim_status_summary = build_claim_status_summary(selected_claims)
    if claim_status_summary:
        lines.extend(f"- `{status}`: {count}" for status, count in claim_status_summary.items())
    else:
        lines.append("- No selected claims")

    lines.extend(["", "## Watch Items", ""])
    lines.extend(f"- {watch_item_message(item)}" for item in watch_items)
    lines.append("")
    return "\n".join(lines)


def render_section(title: str, docs: list[SelectedDoc]) -> list[str]:
    lines = [f"## {title}", ""]
    if not docs:
        lines.append("- None")
        lines.append("")
        return lines

    for doc in docs:
        matched = f" | matches={', '.join(doc.matched_terms)}" if doc.matched_terms else ""
        lines.extend(
            [
                f"- `{doc.path}` | {doc.title}{matched}",
                f"  Why: {doc.reason}",
                f"  Summary: {doc.summary}",
                "",
            ]
        )
    return lines


def shorten(text: str, max_length: int) -> str:
    cleaned = re.sub(r"\s+", " ", text or "").strip()
    if len(cleaned) <= max_length:
        return cleaned
    return cleaned[: max_length - 3].rstrip() + "..."


def escape_pipes(text: str) -> str:
    return text.replace("|", "\\|")


def format_claim_id_list(claim_ids: list[str], preview: int = 6) -> str:
    if not claim_ids:
        return "-"
    shown = ", ".join(f"`{claim_id}`" for claim_id in claim_ids[:preview])
    remaining = len(claim_ids) - min(len(claim_ids), preview)
    if remaining > 0:
        return f"{shown} ... (+{remaining} more)"
    return shown
