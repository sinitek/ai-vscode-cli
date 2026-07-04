"""Text, date, hashing, and path helpers."""

from __future__ import annotations

import hashlib
import re
from datetime import UTC, datetime

from .constants import CHARS_PER_TOKEN_ESTIMATE


def estimate_tokens(*parts: str) -> int:
    length = len(" ".join(part for part in parts if part))
    return max(1, (length + CHARS_PER_TOKEN_ESTIMATE - 1) // CHARS_PER_TOKEN_ESTIMATE)


def stable_hash(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def clean_inline(text: str) -> str:
    return re.sub(r"\s+", " ", text or "").strip()


def shorten(text: str, max_length: int) -> str:
    cleaned = clean_inline(text)
    if len(cleaned) <= max_length:
        return cleaned
    return cleaned[: max_length - 3].rstrip() + "..."


def strip_list_prefix(text: str) -> str:
    cleaned = re.sub(r"^[-*]\s+", "", text)
    cleaned = re.sub(r"^\d+\.\s+", "", cleaned)
    cleaned = re.sub(r"^\[[ xX]\]\s+", "", cleaned)
    return cleaned.strip()


def dedupe_preserve_order(items: list[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for item in items:
        if item not in seen:
            seen.add(item)
            result.append(item)
    return result


def iso_now() -> str:
    return datetime.now(UTC).replace(microsecond=0).isoformat()


def iso_from_timestamp(timestamp: float) -> str:
    return datetime.fromtimestamp(timestamp, UTC).replace(microsecond=0).isoformat()


def parse_iso(value: str) -> datetime:
    normalized = value.replace("Z", "+00:00")
    parsed = datetime.fromisoformat(normalized)
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC)


def escape_pipes(text: str) -> str:
    return text.replace("|", "\\|")
