"""Data models and constants for memory recall evaluation."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

GENERATOR_NAME = "memory-eval"
GENERATOR_VERSION = "0.2.0"
DEFAULT_QUESTIONS_DIR = ".ch/docs/memory-evals"
DEFAULT_OUTPUT_DIR = ".ch/docs/generated/memory-index/eval-runs"
DEFAULT_RECALL_OUTPUT_DIR = ".ch/docs/generated/memory-index"
DEFAULT_TOP_K = 5
EVAL_WORKSPACE_DIRNAME = ".workspaces"
SUPPORTED_EXTENSIONS = {".md", ".markdown"}


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
