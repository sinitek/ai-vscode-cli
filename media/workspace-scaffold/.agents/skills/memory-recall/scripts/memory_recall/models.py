"""Data models for selected recall entries."""

from __future__ import annotations

from dataclasses import asdict, dataclass

@dataclass
class SelectedDoc:
    path: str
    title: str
    kind: str
    reason: str
    score: int
    modified_at: str
    matched_terms: list[str]
    summary: str

    def to_dict(self) -> dict[str, object]:
        return asdict(self)


@dataclass
class SelectedObservation:
    id: str
    type: str
    title: str
    reason: str
    score: int
    read_tokens: int
    source_path: str
    source_kind: str
    modified_at: str
    matched_terms: list[str]
    concepts: list[str]
    facts: list[str]
    narrative: str
    files: list[str]
    topic: str
    preliminary_score: int
    final_score: int
    score_breakdown: dict[str, int]
    selection_rank: int | None
    selected_claim_ids: list[str]

    def to_dict(self) -> dict[str, object]:
        return asdict(self)
