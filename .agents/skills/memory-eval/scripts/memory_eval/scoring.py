"""Scoring and safety metrics for memory recall evaluation."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from .models import EvalQuestion
from .utils import dedupe_preserve_order, path_for_report


def evaluate_question(
    question: EvalQuestion,
    recall_summary: dict[str, Any],
    memory_summary: dict[str, Any],
    claims_summary: dict[str, Any],
    top_k: int,
    root: Path,
    recall_output_dir: Path,
) -> dict[str, Any]:
    selected_sources = extract_selected_sources(recall_summary)
    top_sources = selected_sources[:top_k]
    expected_sources = dedupe_preserve_order(question.expected_source_paths)
    expected_ids = dedupe_preserve_order(question.expected_observation_ids)
    selected_observation_ids = [
        str(item.get("id", "")).strip()
        for item in ensure_list_of_dicts(recall_summary.get("selected_observations"))
        if str(item.get("id", "")).strip()
    ]

    matched_expected_sources = [path for path in expected_sources if path in selected_sources]
    missed_expected_sources = [path for path in expected_sources if path not in selected_sources]
    expected_source_hit = bool(matched_expected_sources) if expected_sources else False
    precision = round(
        len([path for path in top_sources if path in expected_sources]) / max(1, top_k),
        4,
    )

    privacy_leak_count = estimate_privacy_leaks(
        selected_sources=selected_sources,
        selected_observation_ids=selected_observation_ids,
        recall_summary=recall_summary,
        memory_summary=memory_summary,
    )
    estimated_read_tokens = estimate_read_tokens(recall_summary)

    return {
        "suite": question.suite,
        "question_id": question.question_id,
        "question": question.question,
        "focus": recall_summary.get("focus", question.focus),
        "question_file": path_for_report(Path(question.file_path), root),
        "expected_source_paths": expected_sources,
        "matched_expected_source_paths": matched_expected_sources,
        "missed_expected_source_paths": missed_expected_sources,
        "expected_source_hit": expected_source_hit,
        "source_precision_at_k": precision,
        "evaluated_top_k": top_k,
        "estimated_read_tokens": estimated_read_tokens,
        "privacy_leak_count": privacy_leak_count,
        "claims_available": bool(claims_summary["claims_available"]),
        "selected_source_paths": selected_sources,
        "top_k_source_paths": top_sources,
        "selected_observation_ids": selected_observation_ids,
        "expected_observation_ids": expected_ids,
        "matched_expected_observation_ids": [item for item in expected_ids if item in selected_observation_ids],
        "watch_items": [str(item) for item in recall_summary.get("watch_items", []) if str(item).strip()],
        "notes": question.notes,
        "recall_status": str(recall_summary.get("_recall_status", "unknown")),
        "recall_error": str(recall_summary.get("_recall_error", "")).strip(),
        "recall_output_dir": path_for_report(recall_output_dir, root),
    }


def extract_selected_sources(recall_summary: dict[str, Any]) -> list[str]:
    sources: list[str] = []
    for raw in ensure_list_of_dicts(recall_summary.get("selected_observations")):
        source_path = str(raw.get("source_path", "")).strip()
        if source_path:
            sources.append(source_path)
    return dedupe_preserve_order(sources)


def ensure_list_of_dicts(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []
    return [item for item in value if isinstance(item, dict)]


def estimate_read_tokens(recall_summary: dict[str, Any]) -> int:
    selected_observations = ensure_list_of_dicts(recall_summary.get("selected_observations"))
    if selected_observations:
        return sum(int(item.get("read_tokens", 0) or 0) for item in selected_observations)

    generated_docs = ensure_list_of_dicts(recall_summary.get("generated_docs"))
    tokens = 0
    for item in generated_docs:
        summary = str(item.get("summary", ""))
        tokens += max(1, len(summary) // 4) if summary else 0
    return tokens


def estimate_privacy_leaks(
    selected_sources: list[str],
    selected_observation_ids: list[str],
    recall_summary: dict[str, Any],
    memory_summary: dict[str, Any],
) -> int:
    del selected_observation_ids
    leaks = 0
    privacy = memory_summary.get("privacy", {})
    private_skips: set[str] = set()
    if isinstance(privacy, dict):
        private_skips = {
            str(path).strip()
            for path in privacy.get("private_docs_skipped", [])
            if str(path).strip()
        }
    leaks += sum(1 for path in selected_sources if path in private_skips)

    watch_items = [str(item) for item in recall_summary.get("watch_items", []) if str(item).strip()]
    leaks += sum(1 for item in watch_items if "private" in item.lower() and "剥离" not in item)
    return leaks
