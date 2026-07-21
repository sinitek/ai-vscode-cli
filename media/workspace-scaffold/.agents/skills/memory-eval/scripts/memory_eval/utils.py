"""Shared helpers for memory recall evaluation."""

from __future__ import annotations

import hashlib
import json
import subprocess
from datetime import UTC, datetime
from pathlib import Path
from typing import Any


def load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))

def path_for_report(path: Path, root: Path) -> str:
    try:
        return path.resolve().relative_to(root).as_posix()
    except ValueError:
        return path.name or "."

def path_for_command(path: Path, root: Path | None = None) -> str:
    if root is None:
        return path.name or "."
    try:
        return path.resolve().relative_to(root).as_posix()
    except ValueError:
        return path.name or "."

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
