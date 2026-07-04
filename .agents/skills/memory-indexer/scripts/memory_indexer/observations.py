"""Build structured memory observations."""

from __future__ import annotations

from .constants import (
    MEMORY_DIR,
    OBSERVATION_TYPE_BY_MEMORY_TYPE,
    OBSERVATION_TYPE_PRIORITY,
    STARTER_DOC_ALLOWLIST,
)
from .extractors import detect_concepts, choose_topic, extract_references
from .models import ActivePlan, MemoryDoc, MemoryObservation
from .text_utils import clean_inline, dedupe_preserve_order, estimate_tokens, stable_hash


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


def build_observation_lookup(
    observations: list[MemoryObservation],
) -> dict[tuple[str, str], MemoryObservation]:
    lookup: dict[tuple[str, str], MemoryObservation] = {}
    for item in observations:
        lookup[(item.source_path, item.source_anchor)] = item
    return lookup


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
