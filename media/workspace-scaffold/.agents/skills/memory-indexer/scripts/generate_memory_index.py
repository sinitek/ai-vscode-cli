#!/usr/bin/env python3
"""Generate low-noise memory recall artifacts for the harness docs system."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path

GENERATOR_NAME = "memory-indexer"
GENERATOR_VERSION = "0.2.0"
DEFAULT_OUTPUT_DIR = ".ch/docs/generated/memory-index"
DEFAULT_STALE_DAYS = 30
MEMORY_DIR = ".ch/docs/memory"
MEMORY_RULES = ".ch/docs/MEMORY.md"
ACTIVE_PLANS_DIR = ".ch/docs/exec-plans/active"
CHARS_PER_TOKEN_ESTIMATE = 4
STARTER_HINTS = (
    "starter 默认",
    "starter 状态",
    "starter 默认留空",
    "starter 默认不预置",
)
PATH_PREFIXES = (
    ".ch/",
    "src/",
    "apps/",
    "packages/",
    "libs/",
    "scripts/",
    "infra/",
    "tests/",
    "app/",
)
PRIVATE_TAG_NAMES = (
    "private",
    "no-memory",
    "memory-private",
    "system_instruction",
    "system-instruction",
    "system-reminder",
    "persisted-output",
)
PRIVATE_TAG_RE = re.compile(
    rf"<({'|'.join(re.escape(name) for name in PRIVATE_TAG_NAMES)})\b[^>]*>[\s\S]*?</\1>",
    re.IGNORECASE,
)
PYRAMID_LEVEL_BY_MEMORY_TYPE = {
    "rolling_summary": "L1 rolling_summary",
    "event_memory": "L2 event_memory",
    "project_context": "L3 project_profile",
    "user_preferences": "L3 user_profile",
    "lesson": "L4 procedural_experience",
}
OBSERVATION_TYPE_BY_MEMORY_TYPE = {
    "rolling_summary": "summary",
    "event_memory": "event",
    "project_context": "context",
    "user_preferences": "preference",
    "pending_items": "pending",
    "active_risk": "risk",
    "lesson": "lesson",
    "memory_rules": "rule",
    "memory_index_rules": "rule",
}
STARTER_DOC_ALLOWLIST = {
    ".ch/docs/MEMORY.md",
    ".ch/docs/memory/README.md",
}
OBSERVATION_TYPE_PRIORITY = {
    "risk": 95,
    "pending": 90,
    "event": 85,
    "lesson": 80,
    "context": 75,
    "preference": 72,
    "plan": 68,
    "summary": 65,
    "rule": 45,
    "memory_doc": 40,
}
CLAIM_STATUS_BY_TYPE = {
    "risk": "active",
    "pending": "active",
    "lesson": "active",
    "plan": "active",
}
CLAIM_TYPE_BY_MEMORY_TYPE = {
    "user_preferences": "preference",
    "active_risk": "risk",
    "pending_items": "instruction",
    "lesson": "instruction",
    "memory_rules": "instruction",
}
REVIEW_AFTER_DAYS_BY_CLAIM_TYPE = {
    "decision": 90,
    "fact": 60,
    "hypothesis": 21,
    "instruction": 45,
    "preference": 120,
    "risk": 21,
}
SHORT_BULLET_MAX_LENGTH = 220


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


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate harness memory index artifacts.")
    parser.add_argument("--root", default=".", help="Repository root to scan.")
    parser.add_argument(
        "--output-dir",
        default=DEFAULT_OUTPUT_DIR,
        help="Output directory for generated artifacts. Relative paths resolve from --root.",
    )
    parser.add_argument(
        "--stale-days",
        type=int,
        default=DEFAULT_STALE_DAYS,
        help="Age threshold in days for freshness warnings.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    root = Path(args.root).resolve()
    output_dir = resolve_output_dir(root, args.output_dir)
    display_output_dir = display_path(root, output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    memory_docs, privacy_skips, claim_source_docs = collect_memory_docs(root, args.stale_days)
    active_plans, active_plan_privacy_skips = collect_active_plans(root)
    pending_items, pending_privacy_skip, pending_strip_count, pending_review_reference = load_named_table(
        root / MEMORY_DIR / "PENDING_ITEMS.md",
        ("事项", "状态", "Owner", "来源", "下一步"),
        f"{MEMORY_DIR}/PENDING_ITEMS.md",
    )
    active_risks, risk_privacy_skip, risk_strip_count, risk_review_reference = load_named_table(
        root / MEMORY_DIR / "ACTIVE_RISKS.md",
        ("风险", "影响", "当前缓解", "来源"),
        f"{MEMORY_DIR}/ACTIVE_RISKS.md",
    )
    lessons, lesson_privacy_skip, lesson_strip_count, lesson_review_reference = load_named_table(
        root / MEMORY_DIR / "LESSONS_LEARNED.md",
        ("场景", "推荐动作", "来源"),
        f"{MEMORY_DIR}/LESSONS_LEARNED.md",
    )
    privacy_skips = dedupe_preserve_order(
        privacy_skips
        + active_plan_privacy_skips
        + [path for path in (pending_privacy_skip, risk_privacy_skip, lesson_privacy_skip) if path]
    )
    observations = build_observations(memory_docs, active_plans, pending_items, active_risks, lessons)
    claims = build_claims(
        claim_source_docs=claim_source_docs,
        observations=observations,
        pending_items=pending_items,
        active_risks=active_risks,
        lessons=lessons,
        table_review_references={
            f"{MEMORY_DIR}/PENDING_ITEMS.md": pending_review_reference,
            f"{MEMORY_DIR}/ACTIVE_RISKS.md": risk_review_reference,
            f"{MEMORY_DIR}/LESSONS_LEARNED.md": lesson_review_reference,
        },
    )

    now = source_snapshot_timestamp(memory_docs, active_plans)
    pyramid_counts = count_by_pyramid_level(memory_docs)
    topic_summary = build_topic_summary(observations)
    total_read_tokens = sum(item.read_tokens for item in observations)
    private_blocks_stripped = (
        sum(doc.privacy_stripped_count for doc in memory_docs)
        + sum(plan.privacy_stripped_count for plan in active_plans)
        + pending_strip_count
        + risk_strip_count
        + lesson_strip_count
    )
    summary = {
        "generator": GENERATOR_NAME,
        "version": GENERATOR_VERSION,
        "generated_at": now,
        "repo_root": ".",
        "memory_docs": [doc.to_dict() for doc in memory_docs],
        "memory_pyramid": pyramid_counts,
        "active_plans": [plan.to_dict() for plan in active_plans],
        "open_loops": {
            "pending_items": pending_items,
            "active_risks": active_risks,
            "active_plan_count": len(active_plans),
        },
        "lessons": lessons,
        "observations": [item.to_dict() for item in observations],
        "observation_count": len(observations),
        "claims": [claim.to_dict() for claim in claims],
        "claim_count": len(claims),
        "claim_stats": build_claim_stats(claims),
        "total_read_tokens": total_read_tokens,
        "topics": topic_summary,
        "privacy": {
            "private_docs_skipped": privacy_skips,
            "private_doc_skip_count": len(privacy_skips),
            "private_blocks_stripped": private_blocks_stripped,
            "supported_tags": list(PRIVATE_TAG_NAMES),
        },
    }
    manifest = {
        "generator": GENERATOR_NAME,
        "version": GENERATOR_VERSION,
        "generated_at": now,
        "repo_root": ".",
        "output_dir": display_output_dir,
        "stale_days": args.stale_days,
        "files": [
            "index.md",
            "recall-index.md",
            "observation-registry.md",
            "observations.jsonl",
            "claims.jsonl",
            "claim-registry.md",
            "timeline.md",
            "topic-corpus.md",
            "by-topic.md",
            "by-source.md",
            "open-loops.md",
            "freshness-report.md",
            "manifest.json",
            "summary.json",
        ],
    }

    write_text(
        output_dir / "index.md",
        render_index(
            memory_docs=memory_docs,
            active_plans=active_plans,
            pending_items=pending_items,
            active_risks=active_risks,
            lessons=lessons,
            observations=observations,
            claims=claims,
            stale_days=args.stale_days,
        ),
    )
    write_text(output_dir / "recall-index.md", render_recall_index(observations))
    write_text(output_dir / "observation-registry.md", render_observation_registry(observations))
    write_text(output_dir / "observations.jsonl", render_observations_jsonl(observations))
    write_text(output_dir / "claims.jsonl", render_claims_jsonl(claims))
    write_text(output_dir / "claim-registry.md", render_claim_registry(claims))
    write_text(output_dir / "timeline.md", render_timeline(observations))
    write_text(output_dir / "topic-corpus.md", render_topic_corpus(observations))
    write_text(output_dir / "by-topic.md", render_by_topic(memory_docs, observations))
    write_text(output_dir / "by-source.md", render_by_source(memory_docs, observations))
    write_text(output_dir / "open-loops.md", render_open_loops(active_plans, pending_items, active_risks))
    write_text(output_dir / "freshness-report.md", render_freshness(memory_docs, active_plans, args.stale_days))
    write_json(output_dir / "manifest.json", manifest)
    write_json(output_dir / "summary.json", summary)

    print(f"[{GENERATOR_NAME}] generated artifacts in {output_dir}")
    for filename in manifest["files"]:
        print(f"- {filename}")
    return 0


def resolve_output_dir(root: Path, output_dir_arg: str) -> Path:
    output_dir = Path(output_dir_arg)
    if output_dir.is_absolute():
        return output_dir
    return root / output_dir


def display_path(root: Path, path: Path) -> str:
    try:
        return path.relative_to(root).as_posix()
    except ValueError:
        return str(path)


def collect_memory_docs(root: Path, stale_days: int) -> tuple[list[MemoryDoc], list[str], list[ClaimSourceDoc]]:
    docs: list[MemoryDoc] = []
    privacy_skips: list[str] = []
    claim_source_docs: list[ClaimSourceDoc] = []
    candidates = [root / MEMORY_RULES]
    memory_dir = root / MEMORY_DIR
    if memory_dir.exists():
        candidates.extend(sorted(memory_dir.glob("*.md")))

    for path in candidates:
        if not path.exists():
            continue
        text = path.read_text(encoding="utf-8")
        metadata, body = split_front_matter(text)
        rel_path = path.relative_to(root).as_posix()
        if is_private_document(metadata):
            privacy_skips.append(rel_path)
            continue
        stripped_body, strip_count = strip_private_blocks(body)
        modified_at = iso_from_timestamp(path.stat().st_mtime)
        last_verified = metadata.get("last_verified_at")
        status = metadata.get("status")
        source_of_truth = metadata.get("source_of_truth")
        memory_type = metadata.get("memory_type") or metadata.get("doc_type") or ""
        headings = extract_headings(stripped_body)
        summary = extract_summary(stripped_body)
        references = extract_references(stripped_body)
        starter = is_starter_text(text)
        freshness = classify_freshness(modified_at, last_verified, starter, stale_days)
        docs.append(
            MemoryDoc(
                path=rel_path,
                title=extract_title(stripped_body, path.stem),
                category=detect_category(path, memory_type),
                pyramid_level=detect_pyramid_level(memory_type),
                memory_type=memory_type,
                summary=summary,
                headings=headings[:8],
                references=references,
                modified_at=modified_at,
                last_verified_at=last_verified,
                status=status,
                source_of_truth=source_of_truth,
                starter=starter,
                freshness=freshness,
                read_tokens=estimate_tokens(summary, " ".join(headings[:4])),
                privacy_stripped_count=strip_count,
            )
        )
        claim_source_docs.append(
            ClaimSourceDoc(
                path=rel_path,
                title=extract_title(stripped_body, path.stem),
                memory_type=memory_type,
                status=status,
                source_of_truth=source_of_truth,
                modified_at=modified_at,
                last_verified_at=last_verified,
                starter=starter,
                metadata=metadata,
                stripped_body=stripped_body,
            )
        )
    return docs, privacy_skips, claim_source_docs


def collect_active_plans(root: Path) -> tuple[list[ActivePlan], list[str]]:
    plans_dir = root / ACTIVE_PLANS_DIR
    if not plans_dir.exists():
        return [], []

    plans: list[ActivePlan] = []
    privacy_skips: list[str] = []
    for path in sorted(plans_dir.glob("*.md")):
        if path.name.startswith("."):
            continue
        text = path.read_text(encoding="utf-8")
        metadata, body = split_front_matter(text)
        rel_path = path.relative_to(root).as_posix()
        if is_private_document(metadata):
            privacy_skips.append(rel_path)
            continue
        stripped, strip_count = strip_private_blocks(body)
        plans.append(
            ActivePlan(
                path=rel_path,
                title=extract_title(stripped, path.stem),
                modified_at=iso_from_timestamp(path.stat().st_mtime),
                summary=extract_summary(stripped),
                references=extract_references(stripped),
                read_tokens=estimate_tokens(stripped),
                privacy_stripped_count=strip_count,
            )
        )
    return plans, privacy_skips


def build_observations(
    memory_docs: list[MemoryDoc],
    active_plans: list[ActivePlan],
    pending_items: list[dict[str, str]],
    active_risks: list[dict[str, str]],
    lessons: list[dict[str, str]],
) -> list[MemoryObservation]:
    observations: list[MemoryObservation] = []

    for doc in memory_docs:
        if doc.starter and doc.path not in STARTER_DOC_ALLOWLIST:
            continue
        obs_type = OBSERVATION_TYPE_BY_MEMORY_TYPE.get(doc.memory_type, "memory_doc")
        facts = [doc.summary]
        if doc.source_of_truth:
            facts.append(f"Source of truth: {doc.source_of_truth}")
        observations.append(
            make_observation(
                obs_type=obs_type,
                title=doc.title,
                subtitle=f"{doc.pyramid_level} / {doc.category}",
                facts=facts,
                narrative=doc.summary,
                concepts=detect_concepts(" ".join([doc.title, doc.summary, doc.pyramid_level, doc.memory_type])),
                files=doc.references,
                source_path=doc.path,
                source_kind="memory_doc",
                source_anchor=doc.title,
                source_title=doc.title,
                modified_at=doc.modified_at,
                private_stripped=doc.privacy_stripped_count > 0,
            )
        )

    for plan in active_plans:
        observations.append(
            make_observation(
                obs_type="plan",
                title=plan.title,
                subtitle="Active execution plan",
                facts=[plan.summary, f"Modified at: {plan.modified_at}"],
                narrative=plan.summary,
                concepts=detect_concepts(" ".join([plan.title, plan.summary, "plan active next validation"])),
                files=plan.references,
                source_path=plan.path,
                source_kind="active_plan",
                source_anchor=plan.title,
                source_title=plan.title,
                modified_at=plan.modified_at,
                private_stripped=plan.privacy_stripped_count > 0,
            )
        )

    for item in pending_items:
        title = item.get("事项", "").strip()
        if not title:
            continue
        narrative = " | ".join(
            [
                f"状态={item.get('状态', '')}",
                f"Owner={item.get('Owner', '')}",
                f"下一步={item.get('下一步', '')}",
                f"来源={item.get('来源', '')}",
            ]
        )
        observations.append(
            make_observation(
                obs_type="pending",
                title=title,
                subtitle=item.get("下一步", ""),
                facts=[narrative],
                narrative=narrative,
                concepts=detect_concepts(f"{title} {narrative} pending next open loop"),
                files=extract_references(narrative),
                source_path=f"{MEMORY_DIR}/PENDING_ITEMS.md",
                source_kind="pending_item",
                source_anchor=title,
                source_title="未完成事项",
                modified_at="",
                private_stripped=False,
            )
        )

    for risk in active_risks:
        title = risk.get("风险", "").strip()
        if not title:
            continue
        narrative = " | ".join(
            [
                f"影响={risk.get('影响', '')}",
                f"当前缓解={risk.get('当前缓解', '')}",
                f"来源={risk.get('来源', '')}",
            ]
        )
        observations.append(
            make_observation(
                obs_type="risk",
                title=title,
                subtitle=risk.get("影响", ""),
                facts=[narrative],
                narrative=narrative,
                concepts=detect_concepts(f"{title} {narrative} risk gotcha blocker"),
                files=extract_references(narrative),
                source_path=f"{MEMORY_DIR}/ACTIVE_RISKS.md",
                source_kind="active_risk",
                source_anchor=title,
                source_title="活跃风险",
                modified_at="",
                private_stripped=False,
            )
        )

    for lesson in lessons:
        title = lesson.get("场景", "").strip()
        if not title:
            continue
        narrative = " | ".join(
            [
                f"推荐动作={lesson.get('推荐动作', '')}",
                f"来源={lesson.get('来源', '')}",
            ]
        )
        observations.append(
            make_observation(
                obs_type="lesson",
                title=title,
                subtitle=lesson.get("推荐动作", ""),
                facts=[narrative],
                narrative=narrative,
                concepts=detect_concepts(f"{title} {narrative} lesson pattern procedure"),
                files=extract_references(narrative),
                source_path=f"{MEMORY_DIR}/LESSONS_LEARNED.md",
                source_kind="lesson",
                source_anchor=title,
                source_title="经验教训",
                modified_at="",
                private_stripped=False,
            )
        )

    observations.sort(key=observation_sort_key)
    return observations


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


def build_observation_lookup(
    observations: list[MemoryObservation],
) -> dict[tuple[str, str], MemoryObservation]:
    lookup: dict[tuple[str, str], MemoryObservation] = {}
    for item in observations:
        lookup[(item.source_path, item.source_anchor)] = item
    return lookup


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


def make_observation(
    *,
    obs_type: str,
    title: str,
    subtitle: str,
    facts: list[str],
    narrative: str,
    concepts: list[str],
    files: list[str],
    source_path: str,
    source_kind: str,
    source_anchor: str,
    source_title: str,
    modified_at: str,
    private_stripped: bool,
) -> MemoryObservation:
    cleaned_title = clean_inline(title) or "Untitled memory observation"
    cleaned_facts = [clean_inline(fact) for fact in facts if clean_inline(fact)]
    cleaned_narrative = clean_inline(narrative)
    cleaned_files = dedupe_preserve_order([file for file in files if file])
    cleaned_concepts = dedupe_preserve_order(concepts or detect_concepts(" ".join([cleaned_title, cleaned_narrative])))
    content_hash = stable_hash(
        "\n".join(
            [
                obs_type,
                cleaned_title,
                cleaned_narrative,
                source_path,
                source_anchor,
            ]
        )
    )
    read_tokens = estimate_tokens(cleaned_title, subtitle, cleaned_narrative, " ".join(cleaned_facts))
    topic = choose_topic(obs_type, cleaned_concepts)
    return MemoryObservation(
        id=f"mem-{content_hash[:10]}",
        type=obs_type,
        title=cleaned_title,
        subtitle=clean_inline(subtitle),
        facts=cleaned_facts[:8],
        narrative=cleaned_narrative,
        concepts=cleaned_concepts[:8],
        files=cleaned_files[:12],
        source_path=source_path,
        source_kind=source_kind,
        source_anchor=clean_inline(source_anchor),
        source_title=clean_inline(source_title),
        modified_at=modified_at,
        read_tokens=read_tokens,
        content_hash=content_hash,
        private_stripped=private_stripped,
        topic=topic,
    )


def observation_sort_key(item: MemoryObservation) -> tuple[int, str, str]:
    priority = OBSERVATION_TYPE_PRIORITY.get(item.type, 50)
    modified = item.modified_at or "0000-00-00T00:00:00+00:00"
    return (-priority, modified, item.source_path)


def split_front_matter(text: str) -> tuple[dict[str, str], str]:
    if not text.startswith("---\n"):
        return {}, text
    parts = text.split("\n---\n", 1)
    if len(parts) != 2:
        return {}, text
    raw_meta = parts[0].splitlines()[1:]
    metadata: dict[str, str] = {}
    for line in raw_meta:
        if ":" not in line:
            continue
        key, value = line.split(":", 1)
        metadata[key.strip()] = value.strip()
    return metadata, parts[1]


def is_private_document(metadata: dict[str, str]) -> bool:
    visibility = metadata.get("memory_visibility", "").strip().lower()
    private = metadata.get("private", "").strip().lower()
    return visibility in {"private", "no-memory"} or private in {"true", "yes", "1"}


def strip_private_blocks(text: str) -> tuple[str, int]:
    count = 0

    def replace(_match: re.Match[str]) -> str:
        nonlocal count
        count += 1
        return ""

    parts = re.split(r"(```[\s\S]*?```)", text)
    stripped_parts: list[str] = []
    for part in parts:
        if part.startswith("```"):
            stripped_parts.append(part)
            continue
        inline_parts = re.split(r"(`[^`\n]*`)", part)
        for inline_part in inline_parts:
            if inline_part.startswith("`") and inline_part.endswith("`"):
                stripped_parts.append(inline_part)
            else:
                stripped_parts.append(PRIVATE_TAG_RE.sub(replace, inline_part))
    return "".join(stripped_parts), count


def extract_title(text: str, fallback: str) -> str:
    for line in text.splitlines():
        if line.startswith("# "):
            return line[2:].strip()
    return fallback


def extract_headings(text: str) -> list[str]:
    headings: list[str] = []
    for line in text.splitlines():
        stripped = line.strip()
        if stripped.startswith("#"):
            cleaned = stripped.lstrip("#").strip()
            if cleaned:
                headings.append(cleaned)
    return headings


def extract_summary(text: str) -> str:
    lines = []
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or line.startswith("|") or line.startswith("```"):
            if lines:
                break
            continue
        normalized = strip_list_prefix(line)
        if normalized:
            lines.append(normalized)
        if len(" ".join(lines)) >= 180:
            break
    summary = " ".join(lines).strip()
    return shorten(summary, 220) if summary else "暂无摘要。"


def extract_references(text: str) -> list[str]:
    found: set[str] = set()

    for match in re.findall(r"\[[^\]]+\]\(([^)]+)\)", text):
        candidate = match.strip()
        if candidate.startswith("http://") or candidate.startswith("https://"):
            continue
        found.add(normalize_reference_path(candidate))

    for match in re.findall(r"`([^`\n]+)`", text):
        candidate = match.strip()
        if candidate.startswith(PATH_PREFIXES):
            found.add(candidate)

    return sorted(found)


def normalize_reference_path(candidate: str) -> str:
    normalized = candidate.strip()
    if normalized.startswith("./"):
        return normalized.removeprefix("./")
    return normalized


def detect_category(path: Path, memory_type: str | None) -> str:
    if path.name == "MEMORY.md":
        return "memory-rules"
    if memory_type in {"rolling_summary", "event_memory"}:
        return "memory-pyramid"
    return "hot-memory"


def detect_pyramid_level(memory_type: str | None) -> str:
    if not memory_type:
        return "unclassified"
    return PYRAMID_LEVEL_BY_MEMORY_TYPE.get(memory_type, "operational_hot_zone")


def count_by_pyramid_level(memory_docs: list[MemoryDoc]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for doc in memory_docs:
        counts[doc.pyramid_level] = counts.get(doc.pyramid_level, 0) + 1
    return dict(sorted(counts.items()))


def build_topic_summary(observations: list[MemoryObservation]) -> dict[str, dict[str, object]]:
    summary: dict[str, dict[str, object]] = {}
    for observation in observations:
        bucket = summary.setdefault(observation.topic, {"count": 0, "read_tokens": 0, "ids": []})
        bucket["count"] = int(bucket["count"]) + 1
        bucket["read_tokens"] = int(bucket["read_tokens"]) + observation.read_tokens
        ids = bucket["ids"]
        if isinstance(ids, list):
            ids.append(observation.id)
    return dict(sorted(summary.items(), key=lambda item: (-int(item[1]["count"]), item[0])))


def is_starter_text(text: str) -> bool:
    lowered = text.lower()
    return any(hint in lowered for hint in STARTER_HINTS)


def classify_freshness(
    modified_at: str,
    last_verified_at: str | None,
    starter: bool,
    stale_days: int,
) -> str:
    if starter:
        return "starter"

    reference = last_verified_at or modified_at
    try:
        age_days = (datetime.now(UTC) - parse_iso(reference)).days
    except ValueError:
        return "unknown"
    return "stale" if age_days > stale_days else "fresh"


def load_named_table(
    path: Path,
    headers: tuple[str, ...],
    rel_path: str,
) -> tuple[list[dict[str, str]], str | None, int, str]:
    if not path.exists():
        return [], None, 0, ""
    modified_at = iso_from_timestamp(path.stat().st_mtime)
    text = path.read_text(encoding="utf-8")
    metadata, body = split_front_matter(text)
    if is_private_document(metadata):
        return [], rel_path, 0, metadata.get("last_verified_at", "").strip() or modified_at
    text, strip_count = strip_private_blocks(body)
    review_reference = metadata.get("last_verified_at", "").strip() or modified_at
    lines = text.splitlines()
    for index in range(len(lines) - 1):
        header = parse_table_row(lines[index])
        divider = parse_table_row(lines[index + 1])
        if not header or not divider:
            continue
        if tuple(header) != headers:
            continue
        rows: list[dict[str, str]] = []
        for row_index in range(index + 2, len(lines)):
            row = parse_table_row(lines[row_index])
            if not row:
                break
            if len(row) != len(header):
                continue
            mapped = {header[col]: row[col].strip() for col in range(len(header))}
            if is_placeholder_row(mapped):
                continue
            rows.append(mapped)
        return rows, None, strip_count, review_reference
    return [], None, strip_count, review_reference


def resolve_table_row_anchor(row: dict[str, str], source_kind: str) -> str:
    if source_kind == "pending_item":
        return clean_inline(row.get("事项", ""))
    if source_kind == "active_risk":
        return clean_inline(row.get("风险", ""))
    if source_kind == "lesson":
        return clean_inline(row.get("场景", ""))
    return clean_inline(next(iter(row.values()), ""))


def render_table_row_claim_text(row: dict[str, str], source_kind: str) -> str:
    if source_kind == "pending_item":
        title = clean_inline(row.get("事项", ""))
        next_step = clean_inline(row.get("下一步", ""))
        status = clean_inline(row.get("状态", ""))
        if not title:
            return ""
        parts = [title]
        if next_step:
            parts.append(f"下一步：{next_step}")
        if status:
            parts.append(f"状态：{status}")
        return "；".join(parts)
    if source_kind == "active_risk":
        title = clean_inline(row.get("风险", ""))
        impact = clean_inline(row.get("影响", ""))
        mitigation = clean_inline(row.get("当前缓解", ""))
        if not title:
            return ""
        parts = [title]
        if impact:
            parts.append(f"影响：{impact}")
        if mitigation:
            parts.append(f"缓解：{mitigation}")
        return "；".join(parts)
    if source_kind == "lesson":
        scenario = clean_inline(row.get("场景", ""))
        action = clean_inline(row.get("推荐动作", ""))
        if not scenario or not action:
            return ""
        return f"{scenario}：推荐动作是 {action}"
    return ""


def parse_table_row(line: str) -> list[str] | None:
    stripped = line.strip()
    if not stripped.startswith("|") or not stripped.endswith("|"):
        return None
    cells = [cell.strip() for cell in stripped.strip("|").split("|")]
    if not cells:
        return None
    if all(set(cell) <= {"-", ":"} for cell in cells):
        return cells
    return cells


def is_placeholder_row(row: dict[str, str]) -> bool:
    combined = " ".join(row.values())
    return not combined or "starter 默认" in combined or combined == "---"


def render_index(
    *,
    memory_docs: list[MemoryDoc],
    active_plans: list[ActivePlan],
    pending_items: list[dict[str, str]],
    active_risks: list[dict[str, str]],
    lessons: list[dict[str, str]],
    observations: list[MemoryObservation],
    claims: list[MemoryClaimLite],
    stale_days: int,
) -> str:
    fresh_count = sum(1 for doc in memory_docs if doc.freshness == "fresh")
    stale_count = sum(1 for doc in memory_docs if doc.freshness == "stale")
    starter_count = sum(1 for doc in memory_docs if doc.freshness == "starter")
    pyramid_counts = count_by_pyramid_level(memory_docs)
    total_read_tokens = sum(item.read_tokens for item in observations)
    lines = [
        "# Memory Index",
        "",
        "这个目录由 `memory-indexer` 生成，用于把热区记忆、开放事项和 freshness 压缩成默认优先召回面。",
        "",
        "## 当前概览",
        "",
        f"- 热区/规则文档：{len(memory_docs)}",
        f"- 活跃计划：{len(active_plans)}",
        f"- Pending items：{len(pending_items)}",
        f"- Active risks：{len(active_risks)}",
        f"- Lessons：{len(lessons)}",
        f"- Observation entries：{len(observations)}",
        f"- Claim entries：{len(claims)}",
        f"- Estimated read cost：~{total_read_tokens} tokens",
        f"- Fresh docs：{fresh_count}",
        f"- Stale docs：{stale_count}",
        f"- Starter docs：{starter_count}",
        "",
        "## 记忆金字塔",
        "",
    ]
    if pyramid_counts:
        lines.extend(f"- {level}：{count}" for level, count in pyramid_counts.items())
    else:
        lines.append("- 当前没有可归类的记忆文档")

    lines.extend(
        [
            "",
            "## Progressive Disclosure",
            "",
            "1. 先看 `recall-index.md`：只读 ID、类型、标题、来源和读取成本。",
            "2. 需要细节时再按 ID 展开 `observation-registry.md` 或 `observations.jsonl`。",
            "3. 需要 claim 级证据时看 `claim-registry.md` 或 `claims.jsonl`。",
            "4. 需要上下文顺序时看 `timeline.md`，需要专题复用时看 `topic-corpus.md`。",
            "",
            "## 推荐阅读顺序",
            "",
            "1. `recall-index.md`",
            "2. `claim-registry.md`",
            "3. `open-loops.md`",
            "4. `freshness-report.md`",
            "5. `timeline.md`",
            "6. `topic-corpus.md`",
            "7. `by-topic.md`",
            "8. `by-source.md`",
            "",
            "## 判定规则",
            "",
            f"- freshness 超过 `{stale_days}` 天未验证时标记为 `stale`",
            "- 带 starter 占位语义的热区文档不生成 observation entry，除非它是记忆规则或热区说明入口",
            "- `<private>` / `<no-memory>` 等隐私标签内的内容会从 generated 结果中剥离",
            "- claim 抽取只覆盖 front matter、表格行和标题下的短 bullet；内容不足以稳定抽取时宁可跳过",
            "- generated memory index 只做召回压缩，不替代原始事实来源",
            "",
        ]
    )
    if not active_plans and not pending_items and not active_risks:
        lines.extend(
            [
                "## 当前状态",
                "",
                "当前没有活跃计划、pending item 或 active risk。复杂任务开始前，如上下文不清晰，可先检查热区文档是否需要补充。",
                "",
            ]
        )
    return "\n".join(lines).rstrip() + "\n"


def render_recall_index(observations: list[MemoryObservation]) -> str:
    lines = [
        "# Recall Index",
        "",
        "轻量索引只显示“有什么、在哪里、读取成本是多少”。需要细节时再按 ID 读取 `observation-registry.md` 或 `observations.jsonl`。",
        "",
        "| ID | Type | Title | Read | Source | Concepts |",
        "| --- | --- | --- | --- | --- | --- |",
    ]
    if not observations:
        lines.append("| - | - | 当前没有 observation entries | - | - | - |")
        return "\n".join(lines).rstrip() + "\n"
    for item in observations:
        concepts = ", ".join(item.concepts[:4]) or "-"
        lines.append(
            f"| `{item.id}` | `{item.type}` | {escape_pipes(shorten(item.title, 96))} | "
            f"~{item.read_tokens} | `{item.source_path}` | {escape_pipes(concepts)} |"
        )
    lines.append("")
    return "\n".join(lines).rstrip() + "\n"


def render_observation_registry(observations: list[MemoryObservation]) -> str:
    lines = [
        "# Observation Registry",
        "",
        "这是 generated-only 的轻量 observation registry。它把热区、开放事项、风险、经验和 active plans 转成可按 ID 召回的结构化条目。",
        "",
    ]
    if not observations:
        lines.extend(["当前没有 observation entries。", ""])
        return "\n".join(lines).rstrip() + "\n"
    for item in observations:
        lines.extend(
            [
                f"## {item.id} - {item.title}",
                "",
                f"- Type: `{item.type}`",
                f"- Topic: `{item.topic}`",
                f"- Read: ~{item.read_tokens} tokens",
                f"- Source: `{item.source_path}`",
                f"- Source kind: `{item.source_kind}`",
                f"- Content hash: `{item.content_hash}`",
            ]
        )
        if item.concepts:
            lines.append(f"- Concepts: {', '.join(f'`{concept}`' for concept in item.concepts)}")
        if item.files:
            lines.append(f"- Files: {', '.join(f'`{file}`' for file in item.files)}")
        if item.private_stripped:
            lines.append("- Privacy: private blocks stripped before indexing")
        if item.subtitle:
            lines.extend(["", f"Subtitle: {item.subtitle}"])
        if item.facts:
            lines.extend(["", "Facts:"])
            lines.extend(f"- {fact}" for fact in item.facts)
        if item.narrative:
            lines.extend(["", "Narrative:", "", item.narrative])
        lines.append("")
    return "\n".join(lines).rstrip() + "\n"


def render_observations_jsonl(observations: list[MemoryObservation]) -> str:
    return "".join(json.dumps(item.to_dict(), ensure_ascii=False, sort_keys=True) + "\n" for item in observations)


def render_claims_jsonl(claims: list[MemoryClaimLite]) -> str:
    return "".join(json.dumps(item.to_dict(), ensure_ascii=False, sort_keys=True) + "\n" for item in claims)


def render_claim_registry(claims: list[MemoryClaimLite]) -> str:
    lines = [
        "# Claim Registry",
        "",
        "这是 generated-only 的 MemoryClaimLite 目录。它只提供最小 claim 级证据层：机器可读、可审阅、可重建，但不扩展成 graph 或 ontology。",
        "",
        "| Claim ID | Type | Status | Confidence | Observation | Source | Review After |",
        "| --- | --- | --- | --- | --- | --- | --- |",
    ]
    if not claims:
        lines.append("| - | - | - | - | 当前没有可稳定抽取的 claim | - | - |")
        lines.append("")
        return "\n".join(lines).rstrip() + "\n"

    for claim in claims:
        lines.append(
            f"| `{claim.claim_id}` | `{claim.claim_type}` | `{claim.status}` | `{claim.confidence}` | "
            f"`{claim.source_observation_id}` | `{claim.source_path}` | `{claim.review_after}` |"
        )

    lines.extend(["", "## Details", ""])
    for claim in claims:
        lines.extend(
            [
                f"### {claim.claim_id}",
                "",
                f"- Text: {claim.text}",
                f"- Type: `{claim.claim_type}`",
                f"- Status: `{claim.status}`",
                f"- Confidence: `{claim.confidence}`",
                f"- Source: `{claim.source_path}`",
                f"- Source anchor: `{claim.source_anchor}`",
                f"- Source span: `{claim.source_span}`",
                f"- Source observation: `{claim.source_observation_id}`",
                f"- Content hash: `{claim.content_hash}`",
                f"- Quote hash: `{claim.quote_hash}`",
                f"- Review after: `{claim.review_after}`",
                "",
            ]
        )
    return "\n".join(lines).rstrip() + "\n"


def render_timeline(observations: list[MemoryObservation]) -> str:
    lines = [
        "# Memory Timeline",
        "",
        "按 modified/source 顺序展示 observation entries。需要围绕某个 ID 展开前后文时，运行 `memory-recall --anchor-id <id>`。",
        "",
        "| ID | Modified | Type | Title | Source | Read |",
        "| --- | --- | --- | --- | --- | --- |",
    ]
    timeline_items = sorted(
        observations,
        key=lambda item: (item.modified_at or "0000-00-00T00:00:00+00:00", item.source_path, item.id),
    )
    if not timeline_items:
        lines.append("| - | - | - | 当前没有 timeline entries | - | - |")
        return "\n".join(lines).rstrip() + "\n"
    for item in timeline_items:
        modified = item.modified_at or "-"
        lines.append(
            f"| `{item.id}` | {modified} | `{item.type}` | {escape_pipes(shorten(item.title, 96))} | "
            f"`{item.source_path}` | ~{item.read_tokens} |"
        )
    lines.append("")
    return "\n".join(lines).rstrip() + "\n"


def render_topic_corpus(observations: list[MemoryObservation]) -> str:
    lines = [
        "# Topic Corpus",
        "",
        "这个文件把 observation entries 按 topic 分组，作为跨任务复用和 reference pack 导出的轻量 corpus 起点。",
        "",
    ]
    if not observations:
        lines.extend(["当前没有 topic corpus entries。", ""])
        return "\n".join(lines).rstrip() + "\n"

    grouped: dict[str, list[MemoryObservation]] = {}
    for item in observations:
        grouped.setdefault(item.topic, []).append(item)

    for topic, items in sorted(grouped.items(), key=lambda pair: (-len(pair[1]), pair[0])):
        read_tokens = sum(item.read_tokens for item in items)
        lines.extend(
            [
                f"## {topic}",
                "",
                f"- Entries: {len(items)}",
                f"- Estimated read cost: ~{read_tokens} tokens",
                "",
            ]
        )
        for item in items:
            lines.append(f"- `{item.id}` `{item.type}` {item.title} -> `{item.source_path}`")
        lines.append("")
    lines.extend(
        [
            "## Reference Pack Hint",
            "",
            "如果某个 topic 已经稳定，可以把对应原始事实来源、runbook、design docs 和 skills 纳入 `reference-pack` 的自定义 preset；不要导出 generated corpus 本身作为唯一事实来源。",
            "",
        ]
    )
    return "\n".join(lines).rstrip() + "\n"


def render_by_topic(memory_docs: list[MemoryDoc], observations: list[MemoryObservation]) -> str:
    lines = [
        "# By Topic",
        "",
        "按热区主题列出当前记忆入口、关键小节、直接引用路径和 observation ID。",
        "",
    ]
    observation_ids_by_source: dict[str, list[str]] = {}
    for item in observations:
        observation_ids_by_source.setdefault(item.source_path, []).append(item.id)

    for doc in memory_docs:
        lines.extend(
            [
                f"## {doc.title}",
                "",
                f"- 路径：`{doc.path}`",
                f"- 分类：`{doc.category}`",
                f"- 金字塔层级：`{doc.pyramid_level}`",
                f"- 状态：`{doc.status or 'unknown'}`",
                f"- Freshness：`{doc.freshness}`",
                f"- Read：~{doc.read_tokens} tokens",
                f"- 摘要：{doc.summary}",
            ]
        )
        ids = observation_ids_by_source.get(doc.path, [])
        if ids:
            lines.append(f"- Observation IDs：{', '.join(f'`{item_id}`' for item_id in ids)}")
        if doc.source_of_truth:
            lines.append(f"- Source of truth：`{doc.source_of_truth}`")
        if doc.headings:
            lines.append(f"- 小节：{', '.join(f'`{heading}`' for heading in doc.headings[:6])}")
        if doc.references:
            lines.append(f"- 直接引用：{', '.join(f'`{ref}`' for ref in doc.references[:8])}")
        lines.append("")
    return "\n".join(lines).rstrip() + "\n"


def render_by_source(memory_docs: list[MemoryDoc], observations: list[MemoryObservation]) -> str:
    grouped: dict[str, list[str]] = {}
    for doc in memory_docs:
        for reference in doc.references:
            grouped.setdefault(reference, []).append(doc.path)
    for item in observations:
        for file_path in item.files:
            grouped.setdefault(file_path, []).append(item.id)

    lines = [
        "# By Source",
        "",
        "列出热区文档或 observation entry 直接引用了哪些事实来源，帮助快速跳回原始文档。",
        "",
    ]
    if not grouped:
        lines.extend(
            [
                "当前热区文档没有提取到显式路径引用。",
                "",
                "建议在长期有效条目中尽量附上计划、设计、runbook、规格或代码路径，便于追溯。",
                "",
            ]
        )
        return "\n".join(lines).rstrip() + "\n"

    for source in sorted(grouped):
        consumers = ", ".join(f"`{path}`" for path in sorted(set(grouped[source])))
        lines.append(f"- `{source}` <- {consumers}")
    lines.append("")
    return "\n".join(lines).rstrip() + "\n"


def render_open_loops(
    active_plans: list[ActivePlan],
    pending_items: list[dict[str, str]],
    active_risks: list[dict[str, str]],
) -> str:
    lines = [
        "# Open Loops",
        "",
        "这里汇总当前仍开放的计划、待办和风险，优先用于恢复跨会话上下文。",
        "",
        "## Active Plans",
        "",
    ]
    if active_plans:
        for plan in active_plans:
            lines.append(f"- `{plan.path}`：{plan.title} (~{plan.read_tokens} tokens)")
    else:
        lines.append("- 当前无 active plan")

    lines.extend(["", "## Pending Items", ""])
    if pending_items:
        for item in pending_items:
            lines.append(
                "- "
                + " | ".join(
                    [
                        item["事项"],
                        f"状态={item['状态']}",
                        f"Owner={item['Owner']}",
                        f"下一步={item['下一步']}",
                    ]
                )
            )
    else:
        lines.append("- 当前无 pending item")

    lines.extend(["", "## Active Risks", ""])
    if active_risks:
        for risk in active_risks:
            lines.append(
                "- "
                + " | ".join(
                    [
                        risk["风险"],
                        f"影响={risk['影响']}",
                        f"缓解={risk['当前缓解']}",
                    ]
                )
            )
    else:
        lines.append("- 当前无 active risk")

    lines.append("")
    return "\n".join(lines).rstrip() + "\n"


def render_freshness(
    memory_docs: list[MemoryDoc],
    active_plans: list[ActivePlan],
    stale_days: int,
) -> str:
    lines = [
        "# Freshness Report",
        "",
        f"热区文档的 freshness 默认按 `{stale_days}` 天阈值检查；如果存在 `last_verified_at`，优先使用该字段，否则回退到文件修改时间。",
        "",
        "| 文档 | 状态 | Freshness | last_verified_at | modified_at | Read | 备注 |",
        "| --- | --- | --- | --- | --- | --- | --- |",
    ]
    for doc in memory_docs:
        note = "starter placeholder" if doc.starter else doc.summary
        if doc.privacy_stripped_count:
            note = f"{doc.privacy_stripped_count} private block(s) stripped. {note}"
        lines.append(
            f"| `{doc.path}` | `{doc.status or '-'}` | `{doc.freshness}` | "
            f"{doc.last_verified_at or '-'} | {doc.modified_at} | ~{doc.read_tokens} | {escape_pipes(note[:80])} |"
        )

    lines.extend(["", "## Active Plan Activity", ""])
    if active_plans:
        for plan in active_plans:
            lines.append(f"- `{plan.path}` 最后修改于 {plan.modified_at}，读取成本约 {plan.read_tokens} tokens")
    else:
        lines.append("- 当前无 active plan")
    lines.append("")
    return "\n".join(lines).rstrip() + "\n"


def detect_concepts(text: str) -> list[str]:
    lowered = text.lower()
    concepts: list[str] = []
    keyword_map = [
        ("active-risk", ("风险", "risk", "阻塞", "blocker", "blocked", "卡住")),
        ("open-loop", ("待", "未", "pending", "next", "下一步", "跟进", "继续")),
        ("decision", ("决策", "decision", "trade-off", "权衡", "策略")),
        ("problem-solution", ("失败", "修复", "解决", "bug", "报错", "方案")),
        ("gotcha", ("坑", "gotcha", "陷阱", "避免", "不要", "注意")),
        ("pattern", ("模式", "pattern", "复用", "经验", "lesson")),
        ("procedure", ("流程", "步骤", "procedure", "runbook", "skill", "脚本", "必须")),
        ("context", ("上下文", "context", "项目", "技术栈", "约束")),
        ("source-linked", (".ch/", "src/", "apps/", "packages/", "scripts/", "tests/")),
    ]
    for concept, keywords in keyword_map:
        if any(keyword in lowered for keyword in keywords):
            concepts.append(concept)
    return concepts or ["general"]


def infer_claim_type_for_front_matter(key: str, memory_type: str) -> str:
    if key in {"source_of_truth", "related_paths", "scope"}:
        return "fact"
    if key in {"supersedes", "derived_from", "status"}:
        return "decision"
    return CLAIM_TYPE_BY_MEMORY_TYPE.get(memory_type, "fact")


def infer_claim_type_from_text(text: str, memory_type: str) -> str:
    lowered = text.lower()
    if any(keyword in lowered for keyword in ("风险", "risk", "blocker", "阻塞")):
        return "risk"
    if any(keyword in lowered for keyword in ("必须", "should", "需要", "下一步", "建议", "推荐", "run", "执行")):
        return "instruction"
    if any(keyword in lowered for keyword in ("偏好", "preference", "prefer")):
        return "preference"
    if any(keyword in lowered for keyword in ("假设", "hypothesis", "待确认", "可能")):
        return "hypothesis"
    if any(keyword in lowered for keyword in ("决策", "decision", "采用", "固定为", "不应", "禁止")):
        return "decision"
    return CLAIM_TYPE_BY_MEMORY_TYPE.get(memory_type, "fact")


def normalize_claim_value(value: str) -> str:
    normalized = clean_inline(value.strip("[]"))
    if not normalized or normalized in {"[]", "-"}:
        return ""
    return normalized


def normalize_claim_status(value: str) -> str:
    lowered = clean_inline(value).lower()
    allowed = {"active", "superseded", "archived", "disputed", "needs_verification"}
    if lowered in allowed:
        return lowered
    if lowered in {"open", "todo", "pending", "in_progress"}:
        return "active"
    if lowered in {"stale", "unknown"}:
        return "needs_verification"
    return "active"


def compute_review_after(reference: str, claim_type: str) -> str:
    days = REVIEW_AFTER_DAYS_BY_CLAIM_TYPE.get(claim_type, 60)
    try:
        base = parse_iso(reference)
    except ValueError:
        base = datetime.now(UTC)
    return (base + timedelta(days=days)).date().isoformat()


def is_short_claim_bullet(line: str) -> bool:
    if not line:
        return False
    if not re.match(r"^([-*]|\d+\.)\s+", line):
        return False
    text = strip_list_prefix(line)
    if not text or len(text) > SHORT_BULLET_MAX_LENGTH:
        return False
    if line.startswith("- [") or line.startswith("* ["):
        return False
    return True


def should_skip_claim_text(text: str) -> bool:
    lowered = text.lower()
    if len(text) < 8:
        return True
    if "starter 默认" in text or "当前没有" in text:
        return True
    if text.startswith("`") and text.endswith("`"):
        return True
    if re.search(r"https?://", text):
        return True
    if lowered.startswith("例如") or lowered.startswith("example"):
        return True
    return False


def next_nonempty_line_is_table(lines: list[str], start_index: int) -> bool:
    for line in lines[start_index + 1 :]:
        stripped = line.strip()
        if not stripped:
            continue
        return stripped.startswith("|")
    return False


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


def choose_topic(obs_type: str, concepts: list[str]) -> str:
    if obs_type in {"risk", "pending", "event", "lesson", "plan"}:
        return obs_type
    for concept in concepts:
        if concept != "general":
            return concept
    return obs_type or "general"


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


def write_text(path: Path, content: str) -> None:
    path.write_text(content, encoding="utf-8")


def write_json(path: Path, payload: dict[str, object]) -> None:
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


def iso_now() -> str:
    return datetime.now(UTC).replace(microsecond=0).isoformat()


def source_snapshot_timestamp(memory_docs: list[MemoryDoc], active_plans: list[ActivePlan]) -> str:
    """Return a stable timestamp for the indexed source snapshot."""
    timestamps: list[datetime] = []
    for doc in memory_docs:
        if doc.modified_at:
            timestamps.append(parse_iso(doc.modified_at))
    for plan in active_plans:
        if plan.modified_at:
            timestamps.append(parse_iso(plan.modified_at))
    if not timestamps:
        return "1970-01-01T00:00:00+00:00"
    return max(timestamps).replace(microsecond=0).isoformat()


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


if __name__ == "__main__":
    raise SystemExit(main())
