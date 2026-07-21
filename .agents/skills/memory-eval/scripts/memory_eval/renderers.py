"""Markdown, JSON, and command rendering for memory recall evaluation."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from .models import DEFAULT_TOP_K, GENERATOR_NAME, GENERATOR_VERSION
from .utils import iso_now, path_for_command, path_for_report, slugify, stable_hash, timestamp_slug


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

    print(f"[{GENERATOR_NAME}] wrote {path_for_report(report_path, root)}")
    print(f"[{GENERATOR_NAME}] wrote {path_for_report(summary_path, root)}")
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
