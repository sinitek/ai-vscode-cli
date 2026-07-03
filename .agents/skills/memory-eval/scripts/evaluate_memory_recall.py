#!/usr/bin/env python3
"""Evaluate memory recall outputs against hand-written golden questions."""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import shutil
import subprocess
import sys
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from types import ModuleType
from typing import Any

GENERATOR_NAME = "memory-eval"
GENERATOR_VERSION = "0.2.0"
DEFAULT_QUESTIONS_DIR = ".ch/docs/memory-evals"
DEFAULT_OUTPUT_DIR = ".ch/docs/generated/memory-index/eval-runs"
DEFAULT_RECALL_OUTPUT_DIR = ".ch/docs/generated/memory-index"
DEFAULT_TOP_K = 5
EVAL_WORKSPACE_DIRNAME = ".workspaces"
SUPPORTED_EXTENSIONS = {".md", ".markdown"}

_MEMORY_RECALL_MODULE: ModuleType | None = None


@dataclass
class EvalQuestion:
    suite: str
    question_id: str
    question: str
    focus: str
    expected_source_paths: list[str]
    expected_observation_ids: list[str]
    notes: str
    file_path: str


@dataclass
class EvalWorkspace:
    base_dir: Path
    shared_index_dir: Path
    recall_runs_dir: Path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Evaluate memory recall against golden questions.")
    parser.add_argument("--root", default=".", help="Repository root.")
    parser.add_argument(
        "--questions",
        default=DEFAULT_QUESTIONS_DIR,
        help="Question suite file or directory. Relative paths resolve from --root.",
    )
    parser.add_argument(
        "--suite",
        default="",
        help="Only evaluate suites whose front matter suite or filename matches this value.",
    )
    parser.add_argument(
        "--focus",
        default="",
        help="Override focus used for every question in this run.",
    )
    parser.add_argument(
        "--output-dir",
        default=DEFAULT_OUTPUT_DIR,
        help="Directory for Markdown report and summary JSON. Relative paths resolve from --root.",
    )
    parser.add_argument(
        "--recall-output-dir",
        default=DEFAULT_RECALL_OUTPUT_DIR,
        help="Directory whose memory index artifacts are reused or rebuilt for this eval run.",
    )
    parser.add_argument(
        "--top-k",
        type=int,
        default=DEFAULT_TOP_K,
        help="Top-K selected sources used for precision calculation.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    root = Path(args.root).resolve()
    questions_path = resolve_path(root, args.questions)
    output_dir = resolve_path(root, args.output_dir)
    requested_recall_output_dir = resolve_path(root, args.recall_output_dir)
    top_k = max(1, args.top_k)
    output_dir.mkdir(parents=True, exist_ok=True)

    questions = load_questions(questions_path, suite_filter=args.suite.strip())
    if not questions:
        return write_empty_run(
            root=root,
            output_dir=output_dir,
            questions_path=questions_path,
            requested_recall_output_dir=requested_recall_output_dir,
            suite=args.suite.strip(),
            focus_override=args.focus.strip(),
            top_k=top_k,
        )

    suite_name = args.suite.strip() or derive_suite_name(questions)
    focus_override = args.focus.strip()
    generated_at = iso_now()
    run_hash = stable_hash(
        {
            "suite": suite_name,
            "generated_at": generated_at[:16],
            "questions": [item.question_id for item in questions],
            "focus_override": focus_override,
            "top_k": top_k,
        }
    )[:8]
    timestamp = timestamp_slug()
    report_path = output_dir / f"{timestamp}-{slugify(suite_name)}-{run_hash}-report.md"
    summary_path = output_dir / f"{timestamp}-{slugify(suite_name)}-{run_hash}-summary.json"
    workspace = create_eval_workspace(output_dir, timestamp, suite_name, run_hash)

    memory_summary, memory_summary_source = ensure_memory_summary(
        root=root,
        requested_recall_output_dir=requested_recall_output_dir,
        shared_index_dir=workspace.shared_index_dir,
    )
    claims_summary = load_claims_summary(workspace.shared_index_dir)

    results: list[dict[str, Any]] = []
    total_hits = 0
    total_precision = 0.0
    total_tokens = 0
    total_privacy_leaks = 0

    for index, question in enumerate(questions, start=1):
        effective_focus = focus_override or question.focus or question.question
        recall_run_dir = prepare_recall_run_dir(workspace.recall_runs_dir, index, question.question_id)
        recall_summary = run_memory_recall(
            root=root,
            shared_index_dir=workspace.shared_index_dir,
            output_dir=recall_run_dir,
            focus=effective_focus,
        )
        result = evaluate_question(
            question=question,
            recall_summary=recall_summary,
            memory_summary=memory_summary,
            claims_summary=claims_summary,
            top_k=top_k,
            root=root,
            recall_output_dir=recall_run_dir,
        )
        results.append(result)
        total_hits += int(result["expected_source_hit"])
        total_precision += float(result["source_precision_at_k"])
        total_tokens += int(result["estimated_read_tokens"])
        total_privacy_leaks += int(result["privacy_leak_count"])

    average_precision = total_precision / len(results) if results else 0.0
    summary_payload = {
        "generator": GENERATOR_NAME,
        "version": GENERATOR_VERSION,
        "generated_at": generated_at,
        "suite": suite_name,
        "focus_override": focus_override,
        "questions_path": path_for_report(questions_path, root),
        "requested_recall_output_dir": path_for_report(requested_recall_output_dir, root),
        "recall_output_dir": path_for_report(workspace.base_dir, root),
        "recall_artifact_scope": "isolated-eval-workspace",
        "memory_summary_source": memory_summary_source,
        "top_k": top_k,
        "question_count": len(results),
        "metrics": {
            "expected_source_hit_rate": round(total_hits / len(results), 4),
            "average_source_precision_at_k": round(average_precision, 4),
            "average_estimated_read_tokens": round(total_tokens / len(results), 2),
            "privacy_leak_count": total_privacy_leaks,
            "claims_available": claims_summary["claims_available"],
        },
        "questions": results,
        "rebuild_command": build_rebuild_command(
            path_for_command(root, root),
            path_for_command(questions_path, root),
            suite_name if args.suite.strip() else "",
            focus_override,
            top_k,
            path_for_command(output_dir, root),
            path_for_command(requested_recall_output_dir, root),
        ),
    }

    report_path.write_text(render_report(summary_payload), encoding="utf-8")
    summary_path.write_text(json.dumps(summary_payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    print(f"[{GENERATOR_NAME}] wrote {report_path}")
    print(f"[{GENERATOR_NAME}] wrote {summary_path}")
    print(f"- suite: {suite_name}")
    print(f"- questions: {len(results)}")
    print(f"- expected source hit rate: {summary_payload['metrics']['expected_source_hit_rate']}")
    print(f"- average source precision@{top_k}: {summary_payload['metrics']['average_source_precision_at_k']}")
    print(f"- average estimated read tokens: {summary_payload['metrics']['average_estimated_read_tokens']}")
    print(f"- privacy leak count: {summary_payload['metrics']['privacy_leak_count']}")
    return 0


def resolve_path(root: Path, path_arg: str) -> Path:
    path = Path(path_arg)
    if path.is_absolute():
        return path.resolve()
    return (root / path).resolve()


def create_eval_workspace(output_dir: Path, timestamp: str, suite_name: str, run_hash: str) -> EvalWorkspace:
    base_dir = output_dir / EVAL_WORKSPACE_DIRNAME / f"{timestamp}-{slugify(suite_name)}-{run_hash}"
    shared_index_dir = base_dir / "shared-index"
    recall_runs_dir = base_dir / "recall-runs"
    shared_index_dir.mkdir(parents=True, exist_ok=True)
    recall_runs_dir.mkdir(parents=True, exist_ok=True)
    return EvalWorkspace(
        base_dir=base_dir,
        shared_index_dir=shared_index_dir,
        recall_runs_dir=recall_runs_dir,
    )


def load_questions(path: Path, suite_filter: str) -> list[EvalQuestion]:
    files: list[Path] = []
    if path.is_file():
        files = [path]
    elif path.is_dir():
        files = sorted(
            candidate
            for candidate in path.iterdir()
            if candidate.is_file() and candidate.suffix.lower() in SUPPORTED_EXTENSIONS
        )
    else:
        return []

    questions: list[EvalQuestion] = []
    for file_path in files:
        parsed = parse_question_file(file_path)
        if not parsed:
            continue
        suite_name = parsed["suite"]
        if suite_filter and suite_filter not in {suite_name, file_path.stem}:
            continue
        questions.extend(parsed["questions"])

    questions.sort(key=lambda item: (item.suite, item.question_id, item.file_path))
    return questions


def parse_question_file(path: Path) -> dict[str, Any] | None:
    text = path.read_text(encoding="utf-8")
    front_matter, body = split_front_matter(text)
    suite_name = str(front_matter.get("suite") or path.stem).strip() or path.stem

    current_id = ""
    current_fields: dict[str, Any] = {}
    current_list_key = ""
    questions: list[EvalQuestion] = []

    for raw_line in body.splitlines():
        line = raw_line.rstrip()
        stripped = line.strip()
        if stripped.startswith("### "):
            maybe_id = stripped[4:].strip()
            if maybe_id:
                flush_question(
                    suite_name=suite_name,
                    current_id=current_id,
                    current_fields=current_fields,
                    file_path=path,
                    destination=questions,
                )
                current_id = maybe_id
                current_fields = {}
                current_list_key = ""
            continue
        if not current_id:
            continue
        if current_list_key and stripped.startswith("- ") and ":" not in stripped[2:]:
            existing = current_fields.get(current_list_key, [])
            if not isinstance(existing, list):
                existing = []
            existing.append(stripped[2:].strip())
            current_fields[current_list_key] = existing
            continue
        if not stripped.startswith("- "):
            continue
        key, value = parse_bullet_field(stripped[2:])
        if key is None:
            continue
        if value == "":
            current_fields[key] = []
            current_list_key = key
            continue
        current_fields[key] = value
        current_list_key = ""

    flush_question(
        suite_name=suite_name,
        current_id=current_id,
        current_fields=current_fields,
        file_path=path,
        destination=questions,
    )

    if not questions:
        return None
    return {"suite": suite_name, "questions": questions}


def flush_question(
    suite_name: str,
    current_id: str,
    current_fields: dict[str, Any],
    file_path: Path,
    destination: list[EvalQuestion],
) -> None:
    if not current_id:
        return

    normalized_fields = normalize_question_fields(current_fields)
    question_text = str(normalized_fields.get("question", "")).strip()
    if not question_text:
        return

    destination.append(
        EvalQuestion(
            suite=suite_name,
            question_id=current_id,
            question=question_text,
            focus=str(normalized_fields.get("focus", "")).strip(),
            expected_source_paths=to_string_list(normalized_fields.get("expected_source_paths")),
            expected_observation_ids=to_string_list(normalized_fields.get("expected_observation_ids")),
            notes=str(normalized_fields.get("notes", "")).strip(),
            file_path=str(file_path),
        )
    )


def normalize_question_fields(fields: dict[str, Any]) -> dict[str, Any]:
    normalized: dict[str, Any] = {}
    for key, value in fields.items():
        if isinstance(value, list):
            normalized[key] = list(value)
            continue
        normalized[key] = value
    return normalized


def parse_bullet_field(field_text: str) -> tuple[str | None, Any]:
    if ":" not in field_text:
        return None, None
    key, raw_value = field_text.split(":", 1)
    normalized_key = key.strip().replace(" ", "_")
    return normalized_key, raw_value.strip()


def split_front_matter(text: str) -> tuple[dict[str, Any], str]:
    lines = text.splitlines()
    if not lines or lines[0].strip() != "---":
        return {}, text
    front_matter_lines: list[str] = []
    end_index = -1
    for index in range(1, len(lines)):
        if lines[index].strip() == "---":
            end_index = index
            break
        front_matter_lines.append(lines[index])
    if end_index < 0:
        return {}, text

    front_matter: dict[str, Any] = {}
    for line in front_matter_lines:
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or ":" not in stripped:
            continue
        key, value = stripped.split(":", 1)
        front_matter[key.strip()] = value.strip()
    body = "\n".join(lines[end_index + 1 :])
    return front_matter, body


def to_string_list(value: Any) -> list[str]:
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    if isinstance(value, str):
        stripped = value.strip()
        if stripped in {"", "[]"}:
            return []
        return [stripped]
    return []


def ensure_memory_summary(
    root: Path,
    requested_recall_output_dir: Path,
    shared_index_dir: Path,
) -> tuple[dict[str, Any], str]:
    source_mode = stage_existing_memory_artifacts(requested_recall_output_dir, shared_index_dir)
    summary_path = shared_index_dir / "summary.json"
    if not summary_path.exists():
        run_memory_indexer(root, shared_index_dir)
        source_mode = "rebuilt-for-eval"
    if not summary_path.exists():
        return {}, source_mode
    return load_json(summary_path), source_mode


def stage_existing_memory_artifacts(source_dir: Path, target_dir: Path) -> str:
    summary_source = source_dir / "summary.json"
    if not summary_source.exists():
        return "rebuilt-for-eval"

    copy_artifact(summary_source, target_dir / "summary.json")
    copy_optional_artifact(source_dir / "claims.jsonl", target_dir / "claims.jsonl")
    copy_optional_artifact(
        source_dir / "consolidation-summary.json",
        target_dir / "consolidation-summary.json",
    )
    return "copied-existing-artifacts"


def copy_artifact(source: Path, target: Path) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, target)


def copy_optional_artifact(source: Path, target: Path) -> None:
    if source.exists():
        copy_artifact(source, target)


def run_memory_indexer(root: Path, output_dir: Path) -> None:
    script_path = (
        Path(__file__).resolve().parents[2]
        / "memory-indexer"
        / "scripts"
        / "generate_memory_index.py"
    )
    command = [
        sys.executable,
        str(script_path),
        "--root",
        str(root),
        "--output-dir",
        str(output_dir),
    ]
    subprocess.run(command, check=True, capture_output=True, text=True)


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
        Path(__file__).resolve().parents[2]
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


def load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def load_claims_summary(output_dir: Path) -> dict[str, Any]:
    claims_path = output_dir / "claims.jsonl"
    if not claims_path.exists():
        return {"claims_available": False, "claim_count": 0}
    count = 0
    with claims_path.open("r", encoding="utf-8") as handle:
        for line in handle:
            if line.strip():
                count += 1
    return {"claims_available": True, "claim_count": count}


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


def write_empty_run(
    root: Path,
    output_dir: Path,
    questions_path: Path,
    requested_recall_output_dir: Path,
    suite: str,
    focus_override: str,
    top_k: int,
) -> int:
    timestamp = timestamp_slug()
    suite_name = suite or "no-questions"
    summary_payload = {
        "generator": GENERATOR_NAME,
        "version": GENERATOR_VERSION,
        "generated_at": iso_now(),
        "suite": suite_name,
        "focus_override": focus_override,
        "questions_path": path_for_report(questions_path, root),
        "requested_recall_output_dir": path_for_report(requested_recall_output_dir, root),
        "recall_artifact_scope": "not-created",
        "top_k": top_k,
        "question_count": 0,
        "metrics": {
            "expected_source_hit_rate": 0.0,
            "average_source_precision_at_k": 0.0,
            "average_estimated_read_tokens": 0.0,
            "privacy_leak_count": 0,
            "claims_available": False,
        },
        "questions": [],
        "rebuild_command": build_rebuild_command(
            ".",
            path_for_command(questions_path, root),
            suite,
            focus_override,
            top_k,
            path_for_command(output_dir, root),
            path_for_command(requested_recall_output_dir, root),
        ),
        "notes": [
            "未发现可评测的 golden questions。",
            "请先在 .ch/docs/memory-evals/ 下基于 TEMPLATE.md 创建问题集。",
        ],
    }
    run_hash = stable_hash(summary_payload)[:8]
    report_path = output_dir / f"{timestamp}-{slugify(suite_name)}-{run_hash}-report.md"
    summary_path = output_dir / f"{timestamp}-{slugify(suite_name)}-{run_hash}-summary.json"
    report_path.write_text(render_report(summary_payload), encoding="utf-8")
    summary_path.write_text(json.dumps(summary_payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    print(f"[{GENERATOR_NAME}] wrote {report_path}")
    print(f"[{GENERATOR_NAME}] wrote {summary_path}")
    print("- no golden questions found")
    return 0


def render_report(summary_payload: dict[str, Any]) -> str:
    metrics = summary_payload["metrics"]
    top_k = int(summary_payload.get("top_k", DEFAULT_TOP_K) or DEFAULT_TOP_K)
    lines = [
        "# Memory Eval Report",
        "",
        "这个报告是一次独立、可重建、可审阅的 recall 评测结果，不是新的事实来源。",
        "",
        "## Run Summary",
        "",
        f"- Generator: `{summary_payload['generator']}` `{summary_payload['version']}`",
        f"- Generated at: `{summary_payload['generated_at']}`",
        f"- Suite: `{summary_payload['suite']}`",
        f"- Questions path: `{summary_payload['questions_path']}`",
        f"- Requested recall source dir: `{summary_payload['requested_recall_output_dir']}`",
        f"- Recall artifact scope: `{summary_payload['recall_artifact_scope']}`",
        f"- Recall workspace: `{summary_payload.get('recall_output_dir', '(not created)')}`",
        f"- Memory summary source: `{summary_payload.get('memory_summary_source', 'not-created')}`",
        f"- Top-K: `{summary_payload['top_k']}`",
        f"- Question count: `{summary_payload['question_count']}`",
        f"- Expected source hit rate: `{metrics['expected_source_hit_rate']}`",
        f"- Average source precision@{top_k}: `{metrics['average_source_precision_at_k']}`",
        f"- Average estimated read tokens: `{metrics['average_estimated_read_tokens']}`",
        f"- Privacy leak count: `{metrics['privacy_leak_count']}`",
        f"- Claims available: `{metrics['claims_available']}`",
        "",
        "## Rebuild",
        "",
        "```bash",
        summary_payload["rebuild_command"],
        "```",
        "",
    ]

    notes = summary_payload.get("notes", [])
    if notes:
        lines.append("## Notes")
        lines.append("")
        for item in notes:
            lines.append(f"- {item}")
        lines.append("")

    lines.append("## Question Results")
    lines.append("")
    questions = summary_payload.get("questions", [])
    if not questions:
        lines.append("- 当前没有可评测问题。")
        lines.append("")
        return "\n".join(lines) + "\n"

    for item in questions:
        lines.extend(
            [
                f"### {item['question_id']}",
                "",
                f"- Question: {item['question']}",
                f"- Focus: `{item['focus']}`",
                f"- Question file: `{item['question_file']}`",
                f"- Recall output dir: `{item['recall_output_dir']}`",
                f"- Expected source hit: `{item['expected_source_hit']}`",
                f"- Source precision@{item['evaluated_top_k']}: `{item['source_precision_at_k']}`",
                f"- Estimated read tokens: `{item['estimated_read_tokens']}`",
                f"- Privacy leak count: `{item['privacy_leak_count']}`",
                f"- Recall status: `{item['recall_status']}`",
                "",
                "**Expected sources**",
                "",
            ]
        )
        expected_sources = item.get("expected_source_paths", [])
        if expected_sources:
            for path in expected_sources:
                lines.append(f"- `{path}`")
        else:
            lines.append("- none")
        lines.extend(["", "**Matched expected sources**", ""])
        matched_sources = item.get("matched_expected_source_paths", [])
        if matched_sources:
            for path in matched_sources:
                lines.append(f"- `{path}`")
        else:
            lines.append("- none")
        missed_sources = item.get("missed_expected_source_paths", [])
        lines.extend(["", "**Missed expected sources**", ""])
        if missed_sources:
            for path in missed_sources:
                lines.append(f"- `{path}`")
        else:
            lines.append("- none")
        top_sources = item.get("top_k_source_paths", [])
        lines.extend(["", "**Top-K selected sources**", ""])
        if top_sources:
            for path in top_sources:
                lines.append(f"- `{path}`")
        else:
            lines.append("- none")
        watch_items = item.get("watch_items", [])
        if watch_items:
            lines.extend(["", "**Watch items**", ""])
            for watch in watch_items[:8]:
                lines.append(f"- {watch}")
        if item.get("recall_error"):
            lines.extend(["", "**Recall error**", "", f"- `{item['recall_error']}`"])
        if item.get("notes"):
            lines.extend(["", "**Notes**", "", f"- {item['notes']}"])
        lines.append("")

    return "\n".join(lines) + "\n"


def build_rebuild_command(
    root_path: str,
    questions_path: str,
    suite: str,
    focus_override: str,
    top_k: int,
    output_dir: str,
    recall_output_dir: str,
) -> str:
    command = [
        "python3",
        ".agents/skills/memory-eval/scripts/evaluate_memory_recall.py",
        "--root",
        root_path,
        "--questions",
        questions_path,
        "--top-k",
        str(top_k),
        "--output-dir",
        output_dir,
        "--recall-output-dir",
        recall_output_dir,
    ]
    if suite:
        command.extend(["--suite", suite])
    if focus_override:
        command.extend(["--focus", focus_override])
    return " ".join(command)


def path_for_report(path: Path, root: Path) -> str:
    try:
        return path.relative_to(root).as_posix()
    except ValueError:
        return str(path)


def path_for_command(path: Path, root: Path | None = None) -> str:
    if root is None:
        return str(path)
    try:
        return path.relative_to(root).as_posix()
    except ValueError:
        return str(path)


def derive_suite_name(questions: list[EvalQuestion]) -> str:
    suites = {item.suite for item in questions if item.suite}
    if len(suites) == 1:
        return next(iter(suites))
    if suites:
        return "mixed-suites"
    return "default"


def timestamp_slug() -> str:
    return datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")


def iso_now() -> str:
    return datetime.now(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def stable_hash(payload: Any) -> str:
    serialized = json.dumps(payload, ensure_ascii=False, sort_keys=True)
    return hashlib.sha256(serialized.encode("utf-8")).hexdigest()


def slugify(value: str) -> str:
    chars = []
    for char in value.strip().lower():
        if char.isalnum():
            chars.append(char)
        elif char in {"-", "_"}:
            chars.append("-")
        else:
            chars.append("-")
    slug = "".join(chars).strip("-")
    while "--" in slug:
        slug = slug.replace("--", "-")
    return slug or "eval"


def dedupe_preserve_order(items: list[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for item in items:
        normalized = item.strip()
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        result.append(normalized)
    return result


def summarize_exception(exc: Exception) -> str:
    if isinstance(exc, subprocess.CalledProcessError):
        stderr = (exc.stderr or "").strip().splitlines()
        stdout = (exc.stdout or "").strip().splitlines()
        tail = stderr[-1] if stderr else (stdout[-1] if stdout else "")
        if tail:
            return f"exit={exc.returncode}: {tail}"
        return f"exit={exc.returncode}"
    return f"{exc.__class__.__name__}: {exc}"


if __name__ == "__main__":
    raise SystemExit(main())
