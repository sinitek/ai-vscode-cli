"""Workspace staging and shared index preparation for memory recall evaluation."""

from __future__ import annotations

import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any

from .models import EVAL_WORKSPACE_DIRNAME, EvalWorkspace
from .utils import load_json, slugify


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
        Path(__file__).resolve().parents[3]
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
