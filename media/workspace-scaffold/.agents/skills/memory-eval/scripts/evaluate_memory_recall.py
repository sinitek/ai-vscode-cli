#!/usr/bin/env python3
"""Evaluate memory recall outputs against hand-written golden questions."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from memory_eval.models import (
    DEFAULT_OUTPUT_DIR,
    DEFAULT_QUESTIONS_DIR,
    DEFAULT_RECALL_OUTPUT_DIR,
    DEFAULT_TOP_K,
    GENERATOR_NAME,
    GENERATOR_VERSION,
)
from memory_eval.questions import load_questions
from memory_eval.renderers import build_rebuild_command, render_report, write_empty_run
from memory_eval.runners import prepare_recall_run_dir, run_memory_recall
from memory_eval.scoring import evaluate_question
from memory_eval.utils import derive_suite_name, iso_now, path_for_command, path_for_report, slugify, stable_hash, timestamp_slug
from memory_eval.workspace import create_eval_workspace, ensure_memory_summary, load_claims_summary, resolve_path


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

    print(f"[{GENERATOR_NAME}] wrote {path_for_report(report_path, root)}")
    print(f"[{GENERATOR_NAME}] wrote {path_for_report(summary_path, root)}")
    print(f"- suite: {suite_name}")
    print(f"- questions: {len(results)}")
    print(f"- expected source hit rate: {summary_payload['metrics']['expected_source_hit_rate']}")
    print(f"- average source precision@{top_k}: {summary_payload['metrics']['average_source_precision_at_k']}")
    print(f"- average estimated read tokens: {summary_payload['metrics']['average_estimated_read_tokens']}")
    print(f"- privacy leak count: {summary_payload['metrics']['privacy_leak_count']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
