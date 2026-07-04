"""Isolated memory-recall runner used by memory eval."""

from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path
from types import ModuleType
from typing import Any

from .utils import load_json, path_for_report, slugify, summarize_exception
from .workspace import copy_artifact, copy_optional_artifact

_MEMORY_RECALL_MODULE: ModuleType | None = None


def prepare_recall_run_dir(recall_runs_dir: Path, index: int, question_id: str) -> Path:
    recall_run_dir = recall_runs_dir / f"{index:02d}-{slugify(question_id)}"
    recall_run_dir.mkdir(parents=True, exist_ok=True)
    return recall_run_dir

def run_memory_recall(
    root: Path,
    shared_index_dir: Path,
    output_dir: Path,
    focus: str,
) -> dict[str, Any]:
    stage_shared_memory_artifacts(shared_index_dir, output_dir)
    summary_path = output_dir / "recall-summary.json"
    try:
        build_isolated_recall_outputs(root, output_dir, focus)
    except Exception as exc:  # pragma: no cover - defensive fallback
        if summary_path.exists():
            summary = load_json(summary_path)
            summary["_recall_status"] = "reused_existing_summary_after_failure"
            summary["_recall_error"] = summarize_exception(exc)
            return summary
        return {
            "focus": focus,
            "selected_observations": [],
            "watch_items": [
                "memory-recall failed; no isolated recall-summary.json was available, so this eval run used an empty selection."
            ],
            "_recall_status": "failed_no_summary",
            "_recall_error": summarize_exception(exc),
        }
    if not summary_path.exists():
        return {
            "focus": focus,
            "selected_observations": [],
            "watch_items": [
                "memory-recall finished without isolated recall-summary.json; this eval run used an empty selection."
            ],
            "_recall_status": "missing_summary",
            "_recall_error": "",
        }
    summary = load_json(summary_path)
    summary["_recall_status"] = "generated"
    summary["_recall_error"] = ""
    return summary


def stage_shared_memory_artifacts(shared_index_dir: Path, output_dir: Path) -> None:
    copy_artifact(shared_index_dir / "summary.json", output_dir / "summary.json")
    copy_optional_artifact(shared_index_dir / "claims.jsonl", output_dir / "claims.jsonl")
    copy_optional_artifact(
        shared_index_dir / "consolidation-summary.json",
        output_dir / "consolidation-summary.json",
    )


def build_isolated_recall_outputs(root: Path, output_dir: Path, focus: str) -> None:
    recall_module = load_memory_recall_module()
    memory_summary = recall_module.load_json(output_dir / "summary.json")
    consolidation_summary = recall_module.load_optional_json(output_dir / "consolidation-summary.json")
    claims = recall_module.load_optional_claims(output_dir, memory_summary)
    claim_index = recall_module.build_claim_index(claims)
    focus_value = focus.strip()
    focus_terms = recall_module.tokenize_focus(focus_value)
    display_output_dir = path_for_report(output_dir, root)

    generated_docs = recall_module.build_generated_entries(
        display_output_dir,
        memory_summary,
        consolidation_summary,
    )
    observations, selection_debug = recall_module.select_observations(
        memory_summary,
        focus_terms,
        recall_module.DEFAULT_INDEX_LIMIT,
        claim_index,
    )
    expanded_observations = observations[: max(0, recall_module.DEFAULT_FULL_COUNT)]
    timeline_window = recall_module.build_timeline_window(
        memory_summary,
        "",
        recall_module.DEFAULT_TIMELINE_DEPTH,
    )
    hot_zone_docs = recall_module.select_hot_zone_docs(memory_summary, focus_terms)
    handoffs = recall_module.select_handoffs(root, focus_terms, recall_module.DEFAULT_HANDOFF_LIMIT)
    active_plans = recall_module.select_active_plans(
        memory_summary,
        focus_terms,
        recall_module.DEFAULT_RELATED_LIMIT,
    )
    design_docs = recall_module.collect_related_docs(
        root / recall_module.DESIGN_DOCS_DIR,
        root,
        focus_terms,
        recall_module.DEFAULT_RELATED_LIMIT,
        kind="design_doc",
        excluded=recall_module.EXCLUDED_FILES | {"index.md"},
    )
    runbooks = recall_module.collect_related_docs(
        root / recall_module.RUNBOOKS_DIR,
        root,
        focus_terms,
        recall_module.DEFAULT_RELATED_LIMIT,
        kind="runbook",
        excluded=recall_module.RUNBOOK_EXCLUDED_FILES,
    )
    selected_claims = recall_module.build_selected_claims(observations, claim_index)
    watch_items = recall_module.build_watch_items(memory_summary, consolidation_summary, selected_claims)
    selected_source_paths = recall_module.unique_selected_source_paths(observations)
    selected_source_kinds = recall_module.dedupe_preserve_order(
        item.source_kind for item in observations if item.source_kind
    )
    matched_terms = recall_module.collect_selected_matched_terms(observations)
    score_summary = recall_module.build_score_summary(observations)
    source_diversity = recall_module.build_source_diversity(observations)
    selected_tokens = sum(item.read_tokens for item in observations)
    expanded_tokens = sum(item.read_tokens for item in expanded_observations)
    total_available = int(memory_summary.get("observation_count", 0) or 0)
    total_available_tokens = int(memory_summary.get("total_read_tokens", 0) or 0)

    report_path = output_dir / "recall-pack.md"
    summary_path = output_dir / "recall-summary.json"
    debug_path = output_dir / "retrieval-debug.md"
    summary_payload = {
        "generator": recall_module.GENERATOR_NAME,
        "version": recall_module.GENERATOR_VERSION,
        "generated_at": recall_module.iso_now(),
        "focus": focus_value,
        "focus_terms": focus_terms,
        "anchor_id": "",
        "selection_mode": selection_debug["mode"],
        "available_observation_count": total_available,
        "selected_observation_count": len(observations),
        "selected_observation_ids": [item.id for item in observations],
        "generated_docs": [doc.to_dict() for doc in generated_docs],
        "selected_observations": [item.to_dict() for item in observations],
        "expanded_observation_ids": [item.id for item in expanded_observations],
        "selected_source_paths": selected_source_paths,
        "selected_source_kinds": selected_source_kinds,
        "matched_terms": matched_terms,
        "score": score_summary,
        "score_summary": score_summary,
        "source_diversity": source_diversity,
        "estimated_read_tokens": {
            "selected_total": selected_tokens,
            "expanded_total": expanded_tokens,
            "available_total": total_available_tokens,
        },
        "selected_claim_ids": [claim["claim_id"] for claim in selected_claims if claim.get("claim_id")],
        "selected_claims": selected_claims,
        "claim_status_summary": recall_module.build_claim_status_summary(selected_claims),
        "watch_items": watch_items,
        "watch_item_messages": [
            recall_module.watch_item_message(item)
            for item in watch_items
        ],
        "retrieval_debug": {
            "file": f"{display_output_dir}/retrieval-debug.md",
            "candidate_count": selection_debug["candidate_count"],
            "ranked_candidate_count": selection_debug["ranked_candidate_count"],
            "focus_match_count": selection_debug["focus_match_count"],
            "focus_excluded_count": selection_debug["focus_excluded_count"],
            "heuristics": selection_debug["heuristics"],
            "top_unselected": selection_debug["top_unselected"],
        },
        "timeline_window": [item.to_dict() for item in timeline_window],
        "hot_zone_docs": [doc.to_dict() for doc in hot_zone_docs],
        "handoffs": [doc.to_dict() for doc in handoffs],
        "active_plans": [doc.to_dict() for doc in active_plans],
        "design_docs": [doc.to_dict() for doc in design_docs],
        "runbooks": [doc.to_dict() for doc in runbooks],
        "output_dir": display_output_dir,
        "artifact_scope": "isolated-eval-question",
    }

    report_path.write_text(
        recall_module.render_report(
            focus=focus_value,
            anchor_id="",
            generated_docs=generated_docs,
            observations=observations,
            expanded_observations=expanded_observations,
            timeline_window=timeline_window,
            hot_zone_docs=hot_zone_docs,
            handoffs=handoffs,
            active_plans=active_plans,
            design_docs=design_docs,
            runbooks=runbooks,
            watch_items=watch_items,
            memory_summary=memory_summary,
            selection_mode=selection_debug["mode"],
            retrieval_debug_path=f"{display_output_dir}/retrieval-debug.md",
            source_diversity=source_diversity,
            matched_terms=matched_terms,
        ),
        encoding="utf-8",
    )
    summary_path.write_text(json.dumps(summary_payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    debug_path.write_text(
        recall_module.render_retrieval_debug(
            focus=focus_value,
            focus_terms=focus_terms,
            anchor_id="",
            observations=observations,
            selection_debug=selection_debug,
            source_diversity=source_diversity,
            selected_claims=selected_claims,
            watch_items=watch_items,
        ),
        encoding="utf-8",
    )

def load_memory_recall_module() -> ModuleType:
    global _MEMORY_RECALL_MODULE
    if _MEMORY_RECALL_MODULE is not None:
        return _MEMORY_RECALL_MODULE

    script_path = (
        Path(__file__).resolve().parents[3]
        / "memory-recall"
        / "scripts"
        / "build_recall_pack.py"
    )
    spec = importlib.util.spec_from_file_location("memory_recall_runtime", script_path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Failed to load memory-recall module from {script_path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    _MEMORY_RECALL_MODULE = module
    return module
