"""Observation scoring and selection."""

from __future__ import annotations

from .constants import OBSERVATION_TYPE_PRIORITY
from .models import SelectedObservation
from .text_utils import build_haystack_terms, dedupe_preserve_order, find_matched_terms


def empty_selection_debug() -> dict[str, object]:
    return {
        "mode": "empty",
        "candidate_count": 0,
        "ranked_candidate_count": 0,
        "focus_match_count": 0,
        "focus_excluded_count": 0,
        "heuristics": [],
        "top_unselected": [],
        "ranked_candidates": [],
    }


def select_observations(
    memory_summary: dict[str, object],
    focus_terms: list[str],
    limit: int,
    claim_index: dict[str, list[dict[str, object]]],
) -> tuple[list[SelectedObservation], dict[str, object]]:
    raw_observations = memory_summary.get("observations", [])
    if not isinstance(raw_observations, list):
        return [], empty_selection_debug()

    selected: list[SelectedObservation] = []
    focus_excluded_count = 0
    for raw in raw_observations:
        if not isinstance(raw, dict):
            continue
        haystack = observation_haystack(raw)
        matched_terms = find_matched_terms(focus_terms, haystack)
        if focus_terms and not matched_terms:
            focus_excluded_count += 1
            continue
        obs_type = str(raw.get("type", "memory_doc"))
        breakdown = compute_observation_score(raw, matched_terms)
        preliminary_score = sum(breakdown.values())
        observation_id = str(raw.get("id", ""))
        selected_claim_ids = [
            str(claim.get("claim_id", ""))
            for claim in claim_index.get(observation_id, [])
            if str(claim.get("claim_id", "")).strip()
        ]
        selected.append(
            SelectedObservation(
                id=observation_id,
                type=obs_type,
                title=str(raw.get("title", "")),
                reason=observation_reason(obs_type, matched_terms),
                score=preliminary_score,
                read_tokens=int(raw.get("read_tokens", 0) or 0),
                source_path=str(raw.get("source_path", "")),
                source_kind=str(raw.get("source_kind", "")),
                modified_at=str(raw.get("modified_at", "")),
                matched_terms=matched_terms,
                concepts=[str(item) for item in raw.get("concepts", []) if item],
                facts=[str(item) for item in raw.get("facts", []) if item],
                narrative=str(raw.get("narrative", "")),
                files=[str(item) for item in raw.get("files", []) if item],
                topic=str(raw.get("topic", "")),
                preliminary_score=preliminary_score,
                final_score=preliminary_score,
                score_breakdown=breakdown,
                selection_rank=None,
                selected_claim_ids=selected_claim_ids,
            )
        )

    if selected:
        ranked, debug = rerank_selected_observations(selected, limit)
        debug["candidate_count"] = len(raw_observations)
        debug["focus_excluded_count"] = focus_excluded_count
        debug["focus_match_count"] = len(selected)
        return ranked, debug

    fallback = []
    for raw in raw_observations:
        if not isinstance(raw, dict):
            continue
        obs_type = str(raw.get("type", "memory_doc"))
        breakdown = compute_observation_score(raw, [])
        preliminary_score = sum(breakdown.values())
        observation_id = str(raw.get("id", ""))
        fallback.append(
            SelectedObservation(
                id=observation_id,
                type=obs_type,
                title=str(raw.get("title", "")),
                reason="baseline recall entry。",
                score=preliminary_score,
                read_tokens=int(raw.get("read_tokens", 0) or 0),
                source_path=str(raw.get("source_path", "")),
                source_kind=str(raw.get("source_kind", "")),
                modified_at=str(raw.get("modified_at", "")),
                matched_terms=[],
                concepts=[str(item) for item in raw.get("concepts", []) if item],
                facts=[str(item) for item in raw.get("facts", []) if item],
                narrative=str(raw.get("narrative", "")),
                files=[str(item) for item in raw.get("files", []) if item],
                topic=str(raw.get("topic", "")),
                preliminary_score=preliminary_score,
                final_score=preliminary_score,
                score_breakdown=breakdown,
                selection_rank=None,
                selected_claim_ids=[
                    str(claim.get("claim_id", ""))
                    for claim in claim_index.get(observation_id, [])
                    if str(claim.get("claim_id", "")).strip()
                ],
            )
        )
    ranked, debug = rerank_selected_observations(fallback, limit)
    debug["mode"] = "baseline-fallback"
    debug["candidate_count"] = len(raw_observations)
    debug["focus_excluded_count"] = 0
    debug["focus_match_count"] = 0
    return ranked, debug


def build_timeline_window(
    memory_summary: dict[str, object],
    anchor_id: str,
    depth: int,
) -> list[SelectedObservation]:
    if not anchor_id:
        return []
    raw_observations = memory_summary.get("observations", [])
    if not isinstance(raw_observations, list):
        return []
    timeline = [raw for raw in raw_observations if isinstance(raw, dict)]
    timeline.sort(key=lambda raw: (str(raw.get("modified_at", "")), str(raw.get("source_path", "")), str(raw.get("id", ""))))
    anchor_index = next((index for index, raw in enumerate(timeline) if str(raw.get("id", "")) == anchor_id), -1)
    if anchor_index < 0:
        return []
    start = max(0, anchor_index - max(0, depth))
    end = min(len(timeline), anchor_index + max(0, depth) + 1)
    return [
        SelectedObservation(
            id=str(raw.get("id", "")),
            type=str(raw.get("type", "memory_doc")),
            title=str(raw.get("title", "")),
            reason="timeline window entry。" if str(raw.get("id", "")) != anchor_id else "timeline anchor。",
            score=0,
            read_tokens=int(raw.get("read_tokens", 0) or 0),
            source_path=str(raw.get("source_path", "")),
            source_kind=str(raw.get("source_kind", "")),
            modified_at=str(raw.get("modified_at", "")),
            matched_terms=[],
            concepts=[str(item) for item in raw.get("concepts", []) if item],
            facts=[str(item) for item in raw.get("facts", []) if item],
            narrative=str(raw.get("narrative", "")),
            files=[str(item) for item in raw.get("files", []) if item],
            topic=str(raw.get("topic", "")),
            preliminary_score=0,
            final_score=0,
            score_breakdown={},
            selection_rank=None,
            selected_claim_ids=[],
        )
        for raw in timeline[start:end]
    ]


def observation_haystack(raw: dict[str, object]) -> str:
    values = [
        raw.get("id", ""),
        raw.get("type", ""),
        raw.get("title", ""),
        raw.get("subtitle", ""),
        raw.get("narrative", ""),
        raw.get("source_path", ""),
        raw.get("source_kind", ""),
        raw.get("topic", ""),
        " ".join(str(item) for item in raw.get("facts", []) if item),
        " ".join(str(item) for item in raw.get("concepts", []) if item),
        " ".join(str(item) for item in raw.get("files", []) if item),
    ]
    return " ".join(str(value) for value in values).lower()


def observation_reason(obs_type: str, matched_terms: list[str]) -> str:
    if matched_terms:
        return f"命中 focus：{', '.join(matched_terms)}。"
    reason_by_type = {
        "risk": "活跃风险优先召回。",
        "pending": "开放事项优先召回。",
        "event": "事件记忆可能影响后续判断。",
        "lesson": "已验证经验可复用。",
        "context": "项目上下文属于长期默认入口。",
        "preference": "用户偏好属于长期默认入口。",
        "plan": "active plan 是 working-layer 事实来源。",
    }
    return reason_by_type.get(obs_type, "默认优先召回 entry。")


def compute_observation_score(raw: dict[str, object], matched_terms: list[str]) -> dict[str, int]:
    obs_type = str(raw.get("type", "memory_doc"))
    source_kind = str(raw.get("source_kind", ""))
    read_tokens = int(raw.get("read_tokens", 0) or 0)
    topic = str(raw.get("topic", ""))
    facts = [str(item) for item in raw.get("facts", []) if item]
    files = [str(item) for item in raw.get("files", []) if item]
    concepts = [str(item) for item in raw.get("concepts", []) if item]

    breakdown = {
        "type_priority": OBSERVATION_TYPE_PRIORITY.get(obs_type, 50),
        "focus_terms": len(matched_terms) * 12,
        "open_loop_bonus": 5 if source_kind in {"pending_item", "active_risk"} else 0,
        "read_cost_adjustment": read_cost_adjustment(read_tokens),
        "evidence_bonus": min(6, len(facts)) + min(4, len(files)),
        "concept_bonus": min(3, len(concepts)),
        "topic_bonus": 2 if topic else 0,
    }
    return breakdown


def read_cost_adjustment(read_tokens: int) -> int:
    if read_tokens <= 0:
        return 0
    if read_tokens <= 80:
        return 4
    if read_tokens <= 160:
        return 2
    if read_tokens <= 320:
        return 0
    if read_tokens <= 520:
        return -2
    return -5


def rerank_selected_observations(
    candidates: list[SelectedObservation],
    limit: int,
) -> tuple[list[SelectedObservation], dict[str, object]]:
    sorted_candidates = sorted(
        candidates,
        key=lambda item: (-item.preliminary_score, item.read_tokens, item.id),
    )
    selected: list[SelectedObservation] = []
    selected_source_counts: dict[str, int] = {}
    ranked_debug: list[dict[str, object]] = []

    for index, item in enumerate(sorted_candidates):
        duplicate_count = selected_source_counts.get(item.source_path, 0)
        diversity_penalty = min(duplicate_count * 4, 8)
        diversity_bonus = 2 if item.source_path and duplicate_count == 0 else 0
        claim_bonus = min(4, len(item.selected_claim_ids))
        final_score = item.preliminary_score + diversity_bonus + claim_bonus - diversity_penalty
        item.score_breakdown["source_diversity_bonus"] = diversity_bonus
        item.score_breakdown["claim_bonus"] = claim_bonus
        item.score_breakdown["same_source_penalty"] = -diversity_penalty
        item.final_score = final_score
        item.score = final_score

        ranked_debug.append(
            {
                "id": item.id,
                "title": item.title,
                "source_path": item.source_path,
                "preliminary_score": item.preliminary_score,
                "final_score": final_score,
                "matched_terms": item.matched_terms,
                "selected_claim_ids": item.selected_claim_ids,
                "score_breakdown": item.score_breakdown.copy(),
                "selected": index < limit,
            }
        )

        if len(selected) >= limit:
            continue

        item.selection_rank = len(selected) + 1
        selected.append(item)
        selected_source_counts[item.source_path] = duplicate_count + 1

    selected.sort(
        key=lambda item: (
            -(item.final_score),
            item.selection_rank if item.selection_rank is not None else 9999,
            item.read_tokens,
            item.id,
        )
    )
    for rank, item in enumerate(selected, start=1):
        item.selection_rank = rank

    top_unselected = [
        entry
        for entry in ranked_debug
        if not entry["selected"]
    ][: min(5, max(0, len(ranked_debug) - limit))]
    return selected, {
        "mode": "focus-filtered" if any(item.matched_terms for item in selected) else "baseline",
        "heuristics": [
            "type_priority",
            "focus_terms",
            "open_loop_bonus",
            "read_cost_adjustment",
            "evidence_bonus",
            "concept_bonus",
            "topic_bonus",
            "source_diversity_bonus",
            "claim_bonus",
            "same_source_penalty",
        ],
        "ranked_candidate_count": len(sorted_candidates),
        "top_unselected": top_unselected,
        "ranked_candidates": ranked_debug[: min(len(ranked_debug), max(limit + 6, 12))],
    }
