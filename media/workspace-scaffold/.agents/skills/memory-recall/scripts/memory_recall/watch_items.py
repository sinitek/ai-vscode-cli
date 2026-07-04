"""Watch item, claim, and summary helpers."""

from __future__ import annotations

from .constants import HOT_ZONE_PRIORITY
from .models import SelectedObservation
from .text_utils import dedupe_preserve_order

def build_watch_items(
    memory_summary: dict[str, object],
    consolidation_summary: dict[str, object] | None,
    selected_claims: list[dict[str, object]],
) -> list[dict[str, object]]:
    items: list[dict[str, object]] = []
    open_loops = memory_summary.get("open_loops", {})
    pending_count = 0
    risk_count = 0
    active_plan_count = 0
    if isinstance(open_loops, dict):
        pending_items = open_loops.get("pending_items", [])
        active_risks = open_loops.get("active_risks", [])
        active_plan_count = int(open_loops.get("active_plan_count", 0) or 0)
        if isinstance(pending_items, list):
            pending_count = len(pending_items)
        if isinstance(active_risks, list):
            risk_count = len(active_risks)

    if pending_count:
        items.append(
            {
                "kind": "pending_items",
                "severity": "medium",
                "count": pending_count,
                "message": f"当前有 {pending_count} 条 pending items。",
            }
        )
    if risk_count:
        items.append(
            {
                "kind": "active_risks",
                "severity": "high",
                "count": risk_count,
                "message": f"当前有 {risk_count} 条 active risks。",
            }
        )
    if active_plan_count:
        items.append(
            {
                "kind": "active_plans",
                "severity": "medium",
                "count": active_plan_count,
                "message": f"当前有 {active_plan_count} 份 active plans。",
            }
        )

    stale_paths = collect_stale_paths(memory_summary)
    if stale_paths:
        items.append(
            {
                "kind": "stale_memory_docs",
                "severity": "high",
                "paths": stale_paths,
                "message": "存在 stale memory docs：" + "、".join(f"`{path}`" for path in stale_paths[:5]) + "。",
            }
        )

    privacy = memory_summary.get("privacy", {})
    if isinstance(privacy, dict):
        skip_count = int(privacy.get("private_doc_skip_count", 0) or 0)
        stripped_count = int(privacy.get("private_blocks_stripped", 0) or 0)
        if skip_count or stripped_count:
            items.append(
                {
                    "kind": "privacy_filter",
                    "severity": "info",
                    "private_doc_skip_count": skip_count,
                    "private_blocks_stripped": stripped_count,
                    "message": f"隐私过滤已生效：跳过 {skip_count} 份 private doc，剥离 {stripped_count} 个 private block。",
                }
            )

    starter_hot_zone = collect_starter_hot_zone_paths(memory_summary)
    if starter_hot_zone:
        items.append(
            {
                "kind": "starter_hot_zone",
                "severity": "info",
                "paths": starter_hot_zone,
                "message": "这些热区文件仍是 starter 占位：" + "、".join(f"`{path}`" for path in starter_hot_zone[:5]) + "。",
            }
        )

    claim_status_counts = build_claim_status_summary(selected_claims)
    if claim_status_counts.get("unsupported"):
        items.append(
            {
                "kind": "unsupported_claims",
                "severity": "medium",
                "count": claim_status_counts["unsupported"],
                "message": f"选中 claim 中有 {claim_status_counts['unsupported']} 条标记为 unsupported。",
            }
        )
    if claim_status_counts.get("stale"):
        items.append(
            {
                "kind": "stale_claims",
                "severity": "medium",
                "count": claim_status_counts["stale"],
                "message": f"选中 claim 中有 {claim_status_counts['stale']} 条标记为 stale。",
            }
        )

    if consolidation_summary:
        coverage_gaps = consolidation_summary.get("coverage_gaps", [])
        if isinstance(coverage_gaps, list) and coverage_gaps:
            for gap in coverage_gaps[:5]:
                items.append(
                    {
                        "kind": "consolidation_gap",
                        "severity": "medium",
                        "message": f"Consolidation gap: {gap}",
                    }
                )

    if not items:
        items.append(
            {
                "kind": "clear",
                "severity": "info",
                "message": "当前没有明显的 open loops、stale docs 或 consolidation gaps。",
            }
        )
    return items


def collect_stale_paths(memory_summary: dict[str, object]) -> list[str]:
    memory_docs = memory_summary.get("memory_docs", [])
    if not isinstance(memory_docs, list):
        return []
    paths: list[str] = []
    for raw_doc in memory_docs:
        if not isinstance(raw_doc, dict):
            continue
        if str(raw_doc.get("freshness")) == "stale":
            paths.append(str(raw_doc.get("path", "")))
    return paths


def collect_starter_hot_zone_paths(memory_summary: dict[str, object]) -> list[str]:
    memory_docs = memory_summary.get("memory_docs", [])
    if not isinstance(memory_docs, list):
        return []
    paths: list[str] = []
    for raw_doc in memory_docs:
        if not isinstance(raw_doc, dict):
            continue
        path = str(raw_doc.get("path", ""))
        if path in HOT_ZONE_PRIORITY and bool(raw_doc.get("starter")):
            paths.append(path)
    return paths


def build_selected_claims(
    observations: list[SelectedObservation],
    claim_index: dict[str, list[dict[str, object]]],
) -> list[dict[str, object]]:
    selected: list[dict[str, object]] = []
    for item in observations:
        for claim in claim_index.get(item.id, []):
            claim_payload = {
                "claim_id": str(claim.get("claim_id", "")),
                "status": str(claim.get("status", "")),
                "claim_type": str(claim.get("claim_type", "")),
                "source_path": str(claim.get("source_path", item.source_path)),
                "source_observation_id": str(claim.get("source_observation_id", item.id)),
                "confidence": str(claim.get("confidence", "")),
                "review_after": str(claim.get("review_after", "")),
            }
            selected.append(claim_payload)
    selected.sort(key=claim_sort_key)
    return selected


def build_claim_status_summary(selected_claims: list[dict[str, object]]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for claim in selected_claims:
        status = str(claim.get("status", "")).strip().lower() or "unknown"
        counts[status] = counts.get(status, 0) + 1
    return dict(sorted(counts.items()))


def claim_sort_key(claim: dict[str, object]) -> tuple[str, str, str]:
    return (
        str(claim.get("source_path", "")),
        str(claim.get("source_observation_id", "")),
        str(claim.get("claim_id", "")),
    )


def unique_selected_source_paths(observations: list[SelectedObservation]) -> list[str]:
    return dedupe_preserve_order(item.source_path for item in observations if item.source_path)


def collect_selected_matched_terms(observations: list[SelectedObservation]) -> list[str]:
    matched: list[str] = []
    for item in observations:
        for term in item.matched_terms:
            if term not in matched:
                matched.append(term)
    return matched


def build_score_summary(observations: list[SelectedObservation]) -> dict[str, object]:
    if not observations:
        return {
            "max": 0,
            "min": 0,
            "average": 0,
            "by_observation": [],
        }
    final_scores = [item.final_score for item in observations]
    return {
        "max": max(final_scores),
        "min": min(final_scores),
        "average": round(sum(final_scores) / len(final_scores), 2),
        "by_observation": [
            {
                "id": item.id,
                "score": item.final_score,
                "preliminary_score": item.preliminary_score,
                "rank": item.selection_rank,
                "score_breakdown": item.score_breakdown,
            }
            for item in observations
        ],
    }


def build_source_diversity(observations: list[SelectedObservation]) -> dict[str, object]:
    unique_sources = unique_selected_source_paths(observations)
    per_source: dict[str, int] = {}
    per_kind: dict[str, int] = {}
    for item in observations:
        per_source[item.source_path] = per_source.get(item.source_path, 0) + 1
        kind = item.source_kind or "unknown"
        per_kind[kind] = per_kind.get(kind, 0) + 1
    return {
        "unique_source_count": len(unique_sources),
        "selected_observation_count": len(observations),
        "source_path_counts": dict(sorted(per_source.items())),
        "source_kind_counts": dict(sorted(per_kind.items())),
        "max_same_source_observations": max(per_source.values(), default=0),
    }


def watch_item_message(item: dict[str, object]) -> str:
    return str(item.get("message", "")).strip()
