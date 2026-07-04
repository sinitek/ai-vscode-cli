"""Data models used by the memory consolidator."""

from __future__ import annotations

from dataclasses import asdict, dataclass

from .constants import PRIVATE_TAG_NAMES

@dataclass
class MarkdownDoc:
    path: str
    title: str
    modified_at: str
    sections: dict[str, list[str]]

    def to_dict(self) -> dict[str, object]:
        return {
            "path": self.path,
            "title": self.title,
            "modified_at": self.modified_at,
            "sections": sorted(self.sections.keys()),
        }


@dataclass
class PitfallEntry:
    path: str
    title: str
    status: str
    symptom: str
    long_term_avoidance: str
    verification: str
    modified_at: str

    def to_dict(self) -> dict[str, str]:
        return asdict(self)


@dataclass
class Suggestion:
    kind: str
    destination: str
    confidence: str
    source_path: str
    source_section: str
    text: str
    reason: str
    draft_fields: dict[str, str]

    def to_dict(self) -> dict[str, object]:
        return asdict(self)


@dataclass
class PrivacyStats:
    private_docs_skipped: list[str]
    private_blocks_stripped: int = 0

    def add_private_doc(self, path: str) -> None:
        if path not in self.private_docs_skipped:
            self.private_docs_skipped.append(path)

    def add_private_blocks(self, count: int) -> None:
        self.private_blocks_stripped += count

    def to_dict(self) -> dict[str, object]:
        return {
            "private_docs_skipped": list(self.private_docs_skipped),
            "private_doc_skip_count": len(self.private_docs_skipped),
            "private_blocks_stripped": self.private_blocks_stripped,
            "supported_tags": list(PRIVATE_TAG_NAMES),
        }


