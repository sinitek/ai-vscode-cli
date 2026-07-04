"""Extract conservative MemoryClaimLite records."""

from __future__ import annotations

from .constants import (
    CLAIM_STATUS_BY_TYPE,
    MEMORY_DIR,
    SHORT_BULLET_MAX_LENGTH,
    STARTER_DOC_ALLOWLIST,
)
from .extractors import (
    compute_review_after,
    infer_claim_type_for_front_matter,
    infer_claim_type_from_text,
    normalize_claim_status,
    normalize_claim_value,
    is_short_claim_bullet,
    next_nonempty_line_is_table,
    should_skip_claim_text,
)
from .models import ClaimSourceDoc, MemoryClaimLite, MemoryObservation
from .observations import build_observation_lookup
from .tables import render_table_row_claim_text, resolve_table_row_anchor
from .text_utils import clean_inline, shorten, stable_hash, strip_list_prefix


def build_claims(
    *,
    claim_source_docs: list[ClaimSourceDoc],
    observations: list[MemoryObservation],
    pending_items: list[dict[str, str]],
    active_risks: list[dict[str, str]],
    lessons: list[dict[str, str]],
    table_review_references: dict[str, str],
) -> list[MemoryClaimLite]:
    claims: list[MemoryClaimLite] = []
    observation_by_source = build_observation_lookup(observations)

    for doc in sorted(claim_source_docs, key=lambda item: item.path):
        if doc.starter and doc.path not in STARTER_DOC_ALLOWLIST:
            continue
        observation = observation_by_source.get((doc.path, doc.title))
        if not observation:
            continue
        claims.extend(extract_claims_from_memory_doc(doc, observation))

    table_sources = [
        (
            pending_items,
            f"{MEMORY_DIR}/PENDING_ITEMS.md",
            "未完成事项",
            "pending_item",
            "instruction",
            "high",
        ),
        (
            active_risks,
            f"{MEMORY_DIR}/ACTIVE_RISKS.md",
            "活跃风险",
            "active_risk",
            "risk",
            "high",
        ),
        (
            lessons,
            f"{MEMORY_DIR}/LESSONS_LEARNED.md",
            "经验教训",
            "lesson",
            "instruction",
            "high",
        ),
    ]
    for rows, source_path, source_title, source_kind, claim_type, confidence in table_sources:
        for row in rows:
            observation = observation_by_source.get((source_path, resolve_table_row_anchor(row, source_kind)))
            if not observation:
                continue
            claim = make_claim_from_table_row(
                row=row,
                source_path=source_path,
                source_title=source_title,
                source_kind=source_kind,
                observation=observation,
                claim_type=claim_type,
                confidence=confidence,
                review_reference=table_review_references.get(source_path, ""),
            )
            if claim:
                claims.append(claim)

    claims.sort(key=claim_sort_key)
    return claims


def extract_claims_from_memory_doc(
    doc: ClaimSourceDoc,
    observation: MemoryObservation,
) -> list[MemoryClaimLite]:
    claims: list[MemoryClaimLite] = []
    claims.extend(extract_front_matter_claims(doc, observation))
    claims.extend(extract_short_bullet_claims(doc, observation))
    return claims


def extract_front_matter_claims(
    doc: ClaimSourceDoc,
    observation: MemoryObservation,
) -> list[MemoryClaimLite]:
    claims: list[MemoryClaimLite] = []
    allowed_keys = (
        "scope",
        "status",
        "source_of_truth",
        "derived_from",
        "supersedes",
        "related_paths",
        "memory_type",
        "doc_type",
    )
    for key in allowed_keys:
        raw_value = doc.metadata.get(key, "").strip()
        if not raw_value:
            continue
        normalized_value = normalize_claim_value(raw_value)
        if not normalized_value:
            continue
        text = f"{doc.title}: {key} = {normalized_value}"
        claims.append(
            make_claim(
                text=text,
                claim_type=infer_claim_type_for_front_matter(key, doc.memory_type),
                status=doc.status or "active",
                source_path=doc.path,
                source_span=f"front matter:{key}",
                source_anchor=doc.title,
                observation=observation,
                evidence=f"{key}: {normalized_value}",
                confidence="high",
                review_reference=doc.last_verified_at or doc.modified_at,
            )
        )
    return claims


def extract_short_bullet_claims(
    doc: ClaimSourceDoc,
    observation: MemoryObservation,
) -> list[MemoryClaimLite]:
    claims: list[MemoryClaimLite] = []
    lines = doc.stripped_body.splitlines()
    current_heading = doc.title
    in_code_block = False
    for index, raw_line in enumerate(lines):
        stripped = raw_line.strip()
        if stripped.startswith("```"):
            in_code_block = not in_code_block
            continue
        if in_code_block:
            continue
        if stripped.startswith("#"):
            heading = stripped.lstrip("#").strip()
            if heading:
                current_heading = heading
            continue
        if not is_short_claim_bullet(stripped):
            continue
        text = strip_list_prefix(stripped)
        if should_skip_claim_text(text):
            continue
        if next_nonempty_line_is_table(lines, index):
            continue
        claim_type = infer_claim_type_from_text(text, doc.memory_type)
        claims.append(
            make_claim(
                text=text,
                claim_type=claim_type,
                status=doc.status or "active",
                source_path=doc.path,
                source_span=f"heading:{current_heading}",
                source_anchor=current_heading,
                observation=observation,
                evidence=text,
                confidence="medium",
                review_reference=doc.last_verified_at or doc.modified_at,
            )
        )
    return dedupe_claims(claims)


def make_claim_from_table_row(
    *,
    row: dict[str, str],
    source_path: str,
    source_title: str,
    source_kind: str,
    observation: MemoryObservation,
    claim_type: str,
    confidence: str,
    review_reference: str,
) -> MemoryClaimLite | None:
    anchor = resolve_table_row_anchor(row, source_kind)
    text = render_table_row_claim_text(row, source_kind)
    if not text:
        return None
    status = row.get("状态", "").strip() or CLAIM_STATUS_BY_TYPE.get(observation.type, "active")
    evidence = " | ".join(f"{key}={value}" for key, value in sorted(row.items()) if clean_inline(value))
    return make_claim(
        text=text,
        claim_type=claim_type,
        status=status,
        source_path=source_path,
        source_span=f"table-row:{anchor}",
        source_anchor=anchor,
        observation=observation,
        evidence=evidence,
        confidence=confidence,
        review_reference=review_reference or observation.modified_at,
    )


def make_claim(
    *,
    text: str,
    claim_type: str,
    status: str,
    source_path: str,
    source_span: str,
    source_anchor: str,
    observation: MemoryObservation,
    evidence: str,
    confidence: str,
    review_reference: str,
) -> MemoryClaimLite:
    cleaned_text = shorten(clean_inline(text), SHORT_BULLET_MAX_LENGTH)
    normalized_status = normalize_claim_status(status)
    content_hash = stable_hash(
        "\n".join(
            [
                cleaned_text,
                source_path,
                source_span,
                observation.content_hash,
            ]
        )
    )
    claim_id = f"claim-{content_hash[:12]}"
    review_after = compute_review_after(review_reference, claim_type)
    return MemoryClaimLite(
        claim_id=claim_id,
        text=cleaned_text,
        claim_type=claim_type,
        status=normalized_status,
        source_path=source_path,
        source_span=source_span,
        source_anchor=clean_inline(source_anchor),
        source_observation_id=observation.id,
        content_hash=f"sha256:{observation.content_hash}",
        quote_hash=f"sha256:{stable_hash(clean_inline(evidence) or cleaned_text)}",
        confidence=confidence,
        review_after=review_after,
    )


def build_claim_stats(claims: list[MemoryClaimLite]) -> dict[str, object]:
    by_type: dict[str, int] = {}
    by_status: dict[str, int] = {}
    by_confidence: dict[str, int] = {}
    for claim in claims:
        by_type[claim.claim_type] = by_type.get(claim.claim_type, 0) + 1
        by_status[claim.status] = by_status.get(claim.status, 0) + 1
        by_confidence[claim.confidence] = by_confidence.get(claim.confidence, 0) + 1
    return {
        "by_type": dict(sorted(by_type.items())),
        "by_status": dict(sorted(by_status.items())),
        "by_confidence": dict(sorted(by_confidence.items())),
    }


def claim_sort_key(item: MemoryClaimLite) -> tuple[str, str, str]:
    return (item.source_path, item.source_span, item.claim_id)


def dedupe_claims(claims: list[MemoryClaimLite]) -> list[MemoryClaimLite]:
    seen: set[tuple[str, str, str]] = set()
    result: list[MemoryClaimLite] = []
    for claim in claims:
        key = (claim.source_path, claim.source_span, claim.text)
        if key in seen:
            continue
        seen.add(key)
        result.append(claim)
    return result
