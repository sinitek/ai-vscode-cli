"""Dataclasses used by memory index generation."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass
class MemoryDoc:
    path: str
    title: str
    category: str
    pyramid_level: str
    memory_type: str
    summary: str
    headings: list[str]
    references: list[str]
    modified_at: str
    last_verified_at: str | None
    status: str | None
    source_of_truth: str | None
    starter: bool
    freshness: str
    read_tokens: int
    privacy_stripped_count: int

    def to_dict(self) -> dict[str, object]:
        return {
            "path": self.path,
            "title": self.title,
            "category": self.category,
            "pyramid_level": self.pyramid_level,
            "memory_type": self.memory_type,
            "summary": self.summary,
            "headings": self.headings,
            "references": self.references,
            "modified_at": self.modified_at,
            "last_verified_at": self.last_verified_at,
            "status": self.status,
            "source_of_truth": self.source_of_truth,
            "starter": self.starter,
            "freshness": self.freshness,
            "read_tokens": self.read_tokens,
            "privacy_stripped_count": self.privacy_stripped_count,
        }


@dataclass
class ActivePlan:
    path: str
    title: str
    modified_at: str
    summary: str
    references: list[str]
    read_tokens: int
    privacy_stripped_count: int

    def to_dict(self) -> dict[str, object]:
        return {
            "path": self.path,
            "title": self.title,
            "modified_at": self.modified_at,
            "summary": self.summary,
            "references": self.references,
            "read_tokens": self.read_tokens,
            "privacy_stripped_count": self.privacy_stripped_count,
        }


@dataclass
class MemoryObservation:
    id: str
    type: str
    title: str
    subtitle: str
    facts: list[str]
    narrative: str
    concepts: list[str]
    files: list[str]
    source_path: str
    source_kind: str
    source_anchor: str
    source_title: str
    modified_at: str
    read_tokens: int
    content_hash: str
    private_stripped: bool
    topic: str

    def to_dict(self) -> dict[str, object]:
        return {
            "id": self.id,
            "type": self.type,
            "title": self.title,
            "subtitle": self.subtitle,
            "facts": self.facts,
            "narrative": self.narrative,
            "concepts": self.concepts,
            "files": self.files,
            "source_path": self.source_path,
            "source_kind": self.source_kind,
            "source_anchor": self.source_anchor,
            "source_title": self.source_title,
            "modified_at": self.modified_at,
            "read_tokens": self.read_tokens,
            "content_hash": self.content_hash,
            "private_stripped": self.private_stripped,
            "topic": self.topic,
        }


@dataclass
class ClaimSourceDoc:
    path: str
    title: str
    memory_type: str
    status: str | None
    source_of_truth: str | None
    modified_at: str
    last_verified_at: str | None
    starter: bool
    metadata: dict[str, str]
    stripped_body: str


@dataclass
class MemoryClaimLite:
    claim_id: str
    text: str
    claim_type: str
    status: str
    source_path: str
    source_span: str
    source_anchor: str
    source_observation_id: str
    content_hash: str
    quote_hash: str
    confidence: str
    review_after: str

    def to_dict(self) -> dict[str, object]:
        return {
            "claim_id": self.claim_id,
            "text": self.text,
            "claim_type": self.claim_type,
            "status": self.status,
            "source_path": self.source_path,
            "source_span": self.source_span,
            "source_anchor": self.source_anchor,
            "source_observation_id": self.source_observation_id,
            "content_hash": self.content_hash,
            "quote_hash": self.quote_hash,
            "confidence": self.confidence,
            "review_after": self.review_after,
        }
