"""Generation pipeline for memory index artifacts."""

from __future__ import annotations

from pathlib import Path

from .claims import build_claim_stats, build_claims
from .collectors import collect_active_plans, collect_memory_docs
from .constants import GENERATOR_NAME, GENERATOR_VERSION, MEMORY_DIR, PRIVATE_TAG_NAMES
from .extractors import build_topic_summary, count_by_pyramid_level
from .io_utils import display_path, resolve_output_dir, write_json, write_text
from .observations import build_observations
from .renderers import (
    render_by_source,
    render_by_topic,
    render_claim_registry,
    render_claims_jsonl,
    render_freshness,
    render_index,
    render_observation_registry,
    render_observations_jsonl,
    render_open_loops,
    render_recall_index,
    render_timeline,
    render_topic_corpus,
)
from .tables import load_named_table
from .text_utils import dedupe_preserve_order, iso_now


def run_generation(*, root: Path, output_dir_arg: str, stale_days: int) -> Path:
    output_dir = resolve_output_dir(root, output_dir_arg)
    output_dir.mkdir(parents=True, exist_ok=True)
    display_output_dir = display_path(root, output_dir)

    memory_docs, privacy_skips, claim_source_docs = collect_memory_docs(root, stale_days)
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

    now = iso_now()
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
        "stale_days": stale_days,
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
            stale_days=stale_days,
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
    write_text(output_dir / "freshness-report.md", render_freshness(memory_docs, active_plans, stale_days))
    write_json(output_dir / "manifest.json", manifest)
    write_json(output_dir / "summary.json", summary)

    print(f"[{GENERATOR_NAME}] generated artifacts in {display_output_dir}")
    for filename in manifest["files"]:
        print(f"- {filename}")
    return output_dir
