"""Golden-question loading for memory recall evaluation."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from .models import EvalQuestion, SUPPORTED_EXTENSIONS


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
