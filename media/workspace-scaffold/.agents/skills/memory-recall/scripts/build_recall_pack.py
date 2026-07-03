#!/usr/bin/env python3
"""Build a bounded recall pack from harness memory artifacts."""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from pathlib import Path

GENERATOR_NAME = "memory-recall"
GENERATOR_VERSION = "0.3.0"
DEFAULT_OUTPUT_DIR = ".ch/docs/generated/memory-index"
DEFAULT_STALE_DAYS = 30
DEFAULT_RELATED_LIMIT = 4
DEFAULT_HANDOFF_LIMIT = 2
DEFAULT_INDEX_LIMIT = 12
DEFAULT_FULL_COUNT = 3
DEFAULT_TIMELINE_DEPTH = 3
HANDOFFS_DIR = ".ch/docs/handoffs"
DESIGN_DOCS_DIR = ".ch/docs/design-docs"
RUNBOOKS_DIR = ".ch/docs/runbooks"
STARTER_HINTS = (
    "starter 默认",
    "starter 状态",
    "starter 默认留空",
    "starter 默认不预置",
    "当前为模板初始状态",
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
HOT_ZONE_PRIORITY = {
    ".ch/docs/memory/ROLLING_SUMMARY.md": 0,
    ".ch/docs/memory/EVENT_MEMORY.md": 1,
    ".ch/docs/memory/PROJECT_CONTEXT.md": 2,
    ".ch/docs/memory/USER_PREFERENCES.md": 3,
    ".ch/docs/memory/ACTIVE_RISKS.md": 4,
    ".ch/docs/memory/PENDING_ITEMS.md": 5,
    ".ch/docs/memory/LESSONS_LEARNED.md": 6,
    ".ch/docs/memory/README.md": 7,
    ".ch/docs/MEMORY.md": 8,
}
HOT_ZONE_REASON = {
    ".ch/docs/memory/ROLLING_SUMMARY.md": "L1 滚动摘要入口，用于低成本恢复较旧阶段上下文。",
    ".ch/docs/memory/EVENT_MEMORY.md": "L2 事件记忆入口，用于召回失败原因、成功方案和关键决策。",
    ".ch/docs/memory/PROJECT_CONTEXT.md": "项目级长期上下文入口。",
    ".ch/docs/memory/USER_PREFERENCES.md": "长期协作和实现偏好入口。",
    ".ch/docs/memory/ACTIVE_RISKS.md": "当前仍有效的风险入口。",
    ".ch/docs/memory/PENDING_ITEMS.md": "跨会话未完成事项入口。",
    ".ch/docs/memory/LESSONS_LEARNED.md": "已验证经验入口。",
    ".ch/docs/memory/README.md": "热区边界和阅读顺序入口。",
    ".ch/docs/MEMORY.md": "记忆分层与流转规则入口。",
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
EXCLUDED_FILES = {"README.md", "TEMPLATE.md", ".keep"}
RUNBOOK_EXCLUDED_FILES = {"README.md", "PITFALLS_HISTORY.md"}
CJK_TOKEN_RE = re.compile(r"[\u3400-\u4dbf\u4e00-\u9fff]+")
CJK_BIGRAM_RE = re.compile(r"(?=([\u3400-\u4dbf\u4e00-\u9fff]{2}))")


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


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build a bounded recall pack from memory artifacts.")
    parser.add_argument("--root", default=".", help="Repository root.")
    parser.add_argument(
        "--output-dir",
        default=DEFAULT_OUTPUT_DIR,
        help="Output directory for generated recall files. Relative paths resolve from --root.",
    )
    parser.add_argument(
        "--focus",
        default="",
        help="Optional short focus phrase used to match observations, plans, design docs, and runbooks.",
    )
    parser.add_argument(
        "--related-limit",
        type=int,
        default=DEFAULT_RELATED_LIMIT,
        help="Maximum number of focus-matched design docs or runbooks to include per group.",
    )
    parser.add_argument(
        "--handoff-limit",
        type=int,
        default=DEFAULT_HANDOFF_LIMIT,
        help="Maximum number of recent handoffs to include.",
    )
    parser.add_argument(
        "--index-limit",
        type=int,
        default=DEFAULT_INDEX_LIMIT,
        help="Maximum observation index entries to include in recall-pack.md.",
    )
    parser.add_argument(
        "--full-count",
        type=int,
        default=DEFAULT_FULL_COUNT,
        help="How many selected observation entries to expand with details.",
    )
    parser.add_argument(
        "--anchor-id",
        default="",
        help="Optional observation ID such as mem-abc123. Adds a timeline window around that entry.",
    )
    parser.add_argument(
        "--timeline-depth",
        type=int,
        default=DEFAULT_TIMELINE_DEPTH,
        help="How many observations before and after --anchor-id to include.",
    )
    parser.add_argument(
        "--stale-days",
        type=int,
        default=DEFAULT_STALE_DAYS,
        help="Freshness threshold passed to memory-indexer.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    root = Path(args.root).resolve()
    output_dir = resolve_output_dir(root, args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    try:
        display_output_dir = output_dir.relative_to(root).as_posix()
    except ValueError:
        display_output_dir = str(output_dir)

    run_memory_indexer(root, output_dir, args.stale_days)
    memory_summary = load_json(output_dir / "summary.json")
    consolidation_summary = load_optional_json(output_dir / "consolidation-summary.json")
    claims = load_optional_claims(output_dir, memory_summary)
    claim_index = build_claim_index(claims)
    focus_terms = tokenize_focus(args.focus)

    generated_docs = build_generated_entries(display_output_dir, memory_summary, consolidation_summary)
    observations, selection_debug = select_observations(
        memory_summary,
        focus_terms,
        args.index_limit,
        claim_index,
    )
    expanded_observations = observations[: max(0, args.full_count)]
    timeline_window = build_timeline_window(memory_summary, args.anchor_id.strip(), args.timeline_depth)
    hot_zone_docs = select_hot_zone_docs(memory_summary, focus_terms)
    handoffs = select_handoffs(root, focus_terms, args.handoff_limit)
    active_plans = select_active_plans(memory_summary, focus_terms, args.related_limit)
    design_docs = collect_related_docs(
        root / DESIGN_DOCS_DIR,
        root,
        focus_terms,
        args.related_limit,
        kind="design_doc",
        excluded=EXCLUDED_FILES | {"index.md"},
    )
    runbooks = collect_related_docs(
        root / RUNBOOKS_DIR,
        root,
        focus_terms,
        args.related_limit,
        kind="runbook",
        excluded=RUNBOOK_EXCLUDED_FILES,
    )
    selected_claims = build_selected_claims(observations, claim_index)
    watch_items = build_watch_items(memory_summary, consolidation_summary, selected_claims)
    selected_source_paths = unique_selected_source_paths(observations)
    selected_source_kinds = dedupe_preserve_order(item.source_kind for item in observations if item.source_kind)
    matched_terms = collect_selected_matched_terms(observations)
    score_summary = build_score_summary(observations)
    source_diversity = build_source_diversity(observations)
    selected_tokens = sum(item.read_tokens for item in observations)
    expanded_tokens = sum(item.read_tokens for item in expanded_observations)
    total_available = int(memory_summary.get("observation_count", 0) or 0)
    total_available_tokens = int(memory_summary.get("total_read_tokens", 0) or 0)

    report_path = output_dir / "recall-pack.md"
    summary_path = output_dir / "recall-summary.json"
    debug_path = output_dir / "retrieval-debug.md"
    summary_payload = {
        "generator": GENERATOR_NAME,
        "version": GENERATOR_VERSION,
        "generated_at": iso_now(),
        "repo_root": str(root),
        "focus": args.focus.strip(),
        "focus_terms": focus_terms,
        "anchor_id": args.anchor_id.strip(),
        "selection_mode": selection_debug["mode"],
        "available_observation_count": total_available,
        "selected_observation_count": len(observations),
        "selected_observation_ids": [item.id for item in observations],
        "generated_docs": [doc.to_dict() for doc in generated_docs],
        "selected_observations": [item.to_dict() for item in observations],
        "expanded_observation_ids": [item.id for item in expanded_observations],
        "selected_source_paths": selected_source_paths,
        "selected_source_kinds": selected_source_kinds,
        "matched_terms": matched_terms,
        "score": score_summary,
        "score_summary": score_summary,
        "source_diversity": source_diversity,
        "estimated_read_tokens": {
            "selected_total": selected_tokens,
            "expanded_total": expanded_tokens,
            "available_total": total_available_tokens,
        },
        "selected_claim_ids": [claim["claim_id"] for claim in selected_claims if claim.get("claim_id")],
        "selected_claims": selected_claims,
        "claim_status_summary": build_claim_status_summary(selected_claims),
        "watch_items": watch_items,
        "watch_item_messages": [watch_item_message(item) for item in watch_items],
        "retrieval_debug": {
            "file": f"{display_output_dir}/retrieval-debug.md",
            "candidate_count": selection_debug["candidate_count"],
            "ranked_candidate_count": selection_debug["ranked_candidate_count"],
            "focus_match_count": selection_debug["focus_match_count"],
            "focus_excluded_count": selection_debug["focus_excluded_count"],
            "heuristics": selection_debug["heuristics"],
            "top_unselected": selection_debug["top_unselected"],
        },
        "timeline_window": [item.to_dict() for item in timeline_window],
        "hot_zone_docs": [doc.to_dict() for doc in hot_zone_docs],
        "handoffs": [doc.to_dict() for doc in handoffs],
        "active_plans": [doc.to_dict() for doc in active_plans],
        "design_docs": [doc.to_dict() for doc in design_docs],
        "runbooks": [doc.to_dict() for doc in runbooks],
    }

    report_path.write_text(
        render_report(
            focus=args.focus.strip(),
            anchor_id=args.anchor_id.strip(),
            generated_docs=generated_docs,
            observations=observations,
            expanded_observations=expanded_observations,
            timeline_window=timeline_window,
            hot_zone_docs=hot_zone_docs,
            handoffs=handoffs,
            active_plans=active_plans,
            design_docs=design_docs,
            runbooks=runbooks,
            watch_items=watch_items,
            memory_summary=memory_summary,
            selection_mode=selection_debug["mode"],
            retrieval_debug_path=f"{display_output_dir}/retrieval-debug.md",
            source_diversity=source_diversity,
            matched_terms=matched_terms,
        ),
        encoding="utf-8",
    )
    summary_path.write_text(json.dumps(summary_payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    debug_path.write_text(
        render_retrieval_debug(
            focus=args.focus.strip(),
            focus_terms=focus_terms,
            anchor_id=args.anchor_id.strip(),
            observations=observations,
            selection_debug=selection_debug,
            source_diversity=source_diversity,
            selected_claims=selected_claims,
            watch_items=watch_items,
        ),
        encoding="utf-8",
    )

    print(f"[{GENERATOR_NAME}] wrote {report_path}")
    print(f"[{GENERATOR_NAME}] wrote {summary_path}")
    print(f"[{GENERATOR_NAME}] wrote {debug_path}")
    print(f"- focus: {args.focus.strip() or '(baseline)'}")
    print(f"- generated docs: {len(generated_docs)}")
    print(f"- selected observations: {len(observations)}")
    print(f"- expanded observations: {len(expanded_observations)}")
    print(f"- timeline window: {len(timeline_window)}")
    print(f"- hot zone docs: {len(hot_zone_docs)}")
    print(f"- handoffs: {len(handoffs)}")
    print(f"- active plans: {len(active_plans)}")
    print(f"- design docs: {len(design_docs)}")
    print(f"- runbooks: {len(runbooks)}")
    return 0


def resolve_output_dir(root: Path, output_dir_arg: str) -> Path:
    output_dir = Path(output_dir_arg)
    if output_dir.is_absolute():
        return output_dir
    return root / output_dir


def run_memory_indexer(root: Path, output_dir: Path, stale_days: int) -> None:
    script_path = (
        Path(__file__).resolve().parents[2]
        / "memory-indexer"
        / "scripts"
        / "generate_memory_index.py"
    )
    command = [
        sys.executable,
        str(script_path),
        "--root",
        str(root),
        "--output-dir",
        str(output_dir),
        "--stale-days",
        str(stale_days),
    ]
    subprocess.run(command, check=True, capture_output=True, text=True)


def load_json(path: Path) -> dict[str, object]:
    return json.loads(path.read_text(encoding="utf-8"))


def load_optional_json(path: Path) -> dict[str, object] | None:
    if not path.exists():
        return None
    return load_json(path)


def load_optional_claims(output_dir: Path, memory_summary: dict[str, object]) -> list[dict[str, object]]:
    claims_path = output_dir / "claims.jsonl"
    if claims_path.exists():
        claims: list[dict[str, object]] = []
        for line in claims_path.read_text(encoding="utf-8").splitlines():
            stripped = line.strip()
            if not stripped:
                continue
            try:
                payload = json.loads(stripped)
            except json.JSONDecodeError:
                continue
            if isinstance(payload, dict):
                claims.append(payload)
        if claims:
            return claims
    raw_claims = memory_summary.get("claims", [])
    if not isinstance(raw_claims, list):
        return []
    return [claim for claim in raw_claims if isinstance(claim, dict)]


def build_claim_index(claims: list[dict[str, object]]) -> dict[str, list[dict[str, object]]]:
    claim_index: dict[str, list[dict[str, object]]] = {}
    for raw_claim in claims:
        observation_id = str(raw_claim.get("source_observation_id", "")).strip()
        if not observation_id:
            continue
        claim_index.setdefault(observation_id, []).append(raw_claim)
    for observation_id, claim_list in claim_index.items():
        claim_list.sort(key=claim_sort_key)
        claim_index[observation_id] = claim_list
    return claim_index


def tokenize_focus(text: str) -> list[str]:
    lowered = text.strip().lower()
    if not lowered:
        return []
    terms: list[str] = []
    for token in re.findall(r"[a-z0-9_.-]+|[\u4e00-\u9fff]{2,}", lowered):
        normalized = token.strip(" .-_")
        if len(normalized) < 2:
            continue
        append_term(terms, normalized)
        if contains_cjk(normalized):
            for expanded in expand_cjk_terms(normalized):
                append_term(terms, expanded)
    return terms[:8]


def build_generated_entries(
    display_output_dir: str,
    memory_summary: dict[str, object],
    consolidation_summary: dict[str, object] | None,
) -> list[SelectedDoc]:
    open_loops = memory_summary.get("open_loops", {})
    pending_items = open_loops.get("pending_items", []) if isinstance(open_loops, dict) else []
    active_risks = open_loops.get("active_risks", []) if isinstance(open_loops, dict) else []
    active_plan_count = open_loops.get("active_plan_count", 0) if isinstance(open_loops, dict) else 0

    docs: list[SelectedDoc] = [
        SelectedDoc(
            path=f"{display_output_dir}/recall-index.md",
            title="Recall Index",
            kind="generated",
            reason="ID 化 observation 索引，优先扫描标题、类型、来源和读取成本。",
            score=100,
            modified_at=iso_now(),
            matched_terms=[],
            summary="渐进披露第一层：只看有什么和读取成本。",
        ),
        SelectedDoc(
            path=f"{display_output_dir}/retrieval-debug.md",
            title="Retrieval Debug",
            kind="generated",
            reason="解释 lexical recall 的 matched terms、打分和多样性重排。",
            score=99,
            modified_at=iso_now(),
            matched_terms=[],
            summary="评测和审阅优先看这里，不替代原始事实来源。",
        ),
        SelectedDoc(
            path=f"{display_output_dir}/observation-registry.md",
            title="Observation Registry",
            kind="generated",
            reason="按 ID 展开 observation facts / narrative / source。",
            score=96,
            modified_at=iso_now(),
            matched_terms=[],
            summary="渐进披露第二层：只展开已经筛选过的 ID。",
        ),
        SelectedDoc(
            path=f"{display_output_dir}/timeline.md",
            title="Memory Timeline",
            kind="generated",
            reason="围绕 ID 或时间顺序恢复前后文。",
            score=92,
            modified_at=iso_now(),
            matched_terms=[],
            summary="按 modified/source 顺序排列 observation entries。",
        ),
        SelectedDoc(
            path=f"{display_output_dir}/topic-corpus.md",
            title="Topic Corpus",
            kind="generated",
            reason="按 topic 聚合可复用知识，便于后续 reference pack。",
            score=86,
            modified_at=iso_now(),
            matched_terms=[],
            summary="专题 corpus 起点，不替代原始事实来源。",
        ),
        SelectedDoc(
            path=f"{display_output_dir}/index.md",
            title="Memory Index",
            kind="generated",
            reason="热区记忆、开放事项和当前计划的低噪音总入口。",
            score=84,
            modified_at=iso_now(),
            matched_terms=[],
            summary="默认先读的 generated 记忆索引入口。",
        ),
    ]

    claim_count = int(memory_summary.get("claim_count", 0) or 0)
    if claim_count:
        docs.append(
            SelectedDoc(
                path=f"{display_output_dir}/claim-registry.md",
                title="Claim Registry",
                kind="generated",
                reason="当前 observation 已经可关联到 claim 级证据，可直接检查状态和来源。",
                score=93,
                modified_at=iso_now(),
                matched_terms=[],
                summary="claim-aware recall 的证据补充层，不替代原始事实来源。",
            )
        )

    if pending_items or active_risks or active_plan_count:
        docs.append(
            SelectedDoc(
                path=f"{display_output_dir}/open-loops.md",
                title="Open Loops",
                kind="generated",
                reason="当前存在开放事项、活跃风险或 active plans，需要先看 open loops。",
                score=95,
                modified_at=iso_now(),
                matched_terms=[],
                summary="集中看 pending items、active risks 和 active plan 计数。",
            )
        )

    if has_stale_memory(memory_summary):
        docs.append(
            SelectedDoc(
                path=f"{display_output_dir}/freshness-report.md",
                title="Freshness Report",
                kind="generated",
                reason="当前热区记忆存在 stale 项，需要先确认哪些内容仍可信。",
                score=90,
                modified_at=iso_now(),
                matched_terms=[],
                summary="检查哪些 memory docs 已过期或需要再核验。",
            )
        )

    if consolidation_summary and should_include_consolidation(consolidation_summary):
        docs.append(
            SelectedDoc(
                path=f"{display_output_dir}/consolidation-report.md",
                title="Consolidation Report",
                kind="generated",
                reason="当前存在上提候选或 coverage gaps，适合先看 consolidation backlog。",
                score=88,
                modified_at=iso_now(),
                matched_terms=[],
                summary="查看哪些 open loops、risks、lessons 或 design decisions 仍未上提。",
            )
        )

    docs.sort(key=lambda item: (-item.score, item.path))
    return docs


def has_stale_memory(memory_summary: dict[str, object]) -> bool:
    memory_docs = memory_summary.get("memory_docs", [])
    if not isinstance(memory_docs, list):
        return False
    return any(isinstance(doc, dict) and str(doc.get("freshness")) == "stale" for doc in memory_docs)


def should_include_consolidation(consolidation_summary: dict[str, object]) -> bool:
    suggestions = consolidation_summary.get("suggestions", [])
    coverage_gaps = consolidation_summary.get("coverage_gaps", [])
    return bool(suggestions or coverage_gaps)


def select_observations(
    memory_summary: dict[str, object],
    focus_terms: list[str],
    limit: int,
    claim_index: dict[str, list[dict[str, object]]],
) -> tuple[list[SelectedObservation], dict[str, object]]:
    raw_observations = memory_summary.get("observations", [])
    if not isinstance(raw_observations, list):
        return [], empty_selection_debug()

    selected: list[SelectedObservation] = []
    focus_excluded_count = 0
    for raw in raw_observations:
        if not isinstance(raw, dict):
            continue
        haystack = observation_haystack(raw)
        matched_terms = find_matched_terms(focus_terms, haystack)
        if focus_terms and not matched_terms:
            focus_excluded_count += 1
            continue
        obs_type = str(raw.get("type", "memory_doc"))
        breakdown = compute_observation_score(raw, matched_terms)
        preliminary_score = sum(breakdown.values())
        observation_id = str(raw.get("id", ""))
        selected_claim_ids = [
            str(claim.get("claim_id", ""))
            for claim in claim_index.get(observation_id, [])
            if str(claim.get("claim_id", "")).strip()
        ]
        selected.append(
            SelectedObservation(
                id=observation_id,
                type=obs_type,
                title=str(raw.get("title", "")),
                reason=observation_reason(obs_type, matched_terms),
                score=preliminary_score,
                read_tokens=int(raw.get("read_tokens", 0) or 0),
                source_path=str(raw.get("source_path", "")),
                source_kind=str(raw.get("source_kind", "")),
                modified_at=str(raw.get("modified_at", "")),
                matched_terms=matched_terms,
                concepts=[str(item) for item in raw.get("concepts", []) if item],
                facts=[str(item) for item in raw.get("facts", []) if item],
                narrative=str(raw.get("narrative", "")),
                files=[str(item) for item in raw.get("files", []) if item],
                topic=str(raw.get("topic", "")),
                preliminary_score=preliminary_score,
                final_score=preliminary_score,
                score_breakdown=breakdown,
                selection_rank=None,
                selected_claim_ids=selected_claim_ids,
            )
        )

    if selected:
        ranked, debug = rerank_selected_observations(selected, limit)
        debug["candidate_count"] = len(raw_observations)
        debug["focus_excluded_count"] = focus_excluded_count
        debug["focus_match_count"] = len(selected)
        return ranked, debug

    fallback = []
    for raw in raw_observations:
        if not isinstance(raw, dict):
            continue
        obs_type = str(raw.get("type", "memory_doc"))
        breakdown = compute_observation_score(raw, [])
        preliminary_score = sum(breakdown.values())
        observation_id = str(raw.get("id", ""))
        fallback.append(
            SelectedObservation(
                id=observation_id,
                type=obs_type,
                title=str(raw.get("title", "")),
                reason="baseline recall entry。",
                score=preliminary_score,
                read_tokens=int(raw.get("read_tokens", 0) or 0),
                source_path=str(raw.get("source_path", "")),
                source_kind=str(raw.get("source_kind", "")),
                modified_at=str(raw.get("modified_at", "")),
                matched_terms=[],
                concepts=[str(item) for item in raw.get("concepts", []) if item],
                facts=[str(item) for item in raw.get("facts", []) if item],
                narrative=str(raw.get("narrative", "")),
                files=[str(item) for item in raw.get("files", []) if item],
                topic=str(raw.get("topic", "")),
                preliminary_score=preliminary_score,
                final_score=preliminary_score,
                score_breakdown=breakdown,
                selection_rank=None,
                selected_claim_ids=[
                    str(claim.get("claim_id", ""))
                    for claim in claim_index.get(observation_id, [])
                    if str(claim.get("claim_id", "")).strip()
                ],
            )
        )
    ranked, debug = rerank_selected_observations(fallback, limit)
    debug["mode"] = "baseline-fallback"
    debug["candidate_count"] = len(raw_observations)
    debug["focus_excluded_count"] = 0
    debug["focus_match_count"] = 0
    return ranked, debug


def build_timeline_window(
    memory_summary: dict[str, object],
    anchor_id: str,
    depth: int,
) -> list[SelectedObservation]:
    if not anchor_id:
        return []
    raw_observations = memory_summary.get("observations", [])
    if not isinstance(raw_observations, list):
        return []
    timeline = [raw for raw in raw_observations if isinstance(raw, dict)]
    timeline.sort(key=lambda raw: (str(raw.get("modified_at", "")), str(raw.get("source_path", "")), str(raw.get("id", ""))))
    anchor_index = next((index for index, raw in enumerate(timeline) if str(raw.get("id", "")) == anchor_id), -1)
    if anchor_index < 0:
        return []
    start = max(0, anchor_index - max(0, depth))
    end = min(len(timeline), anchor_index + max(0, depth) + 1)
    return [
        SelectedObservation(
            id=str(raw.get("id", "")),
            type=str(raw.get("type", "memory_doc")),
            title=str(raw.get("title", "")),
            reason="timeline window entry。" if str(raw.get("id", "")) != anchor_id else "timeline anchor。",
            score=0,
            read_tokens=int(raw.get("read_tokens", 0) or 0),
            source_path=str(raw.get("source_path", "")),
            source_kind=str(raw.get("source_kind", "")),
            modified_at=str(raw.get("modified_at", "")),
            matched_terms=[],
            concepts=[str(item) for item in raw.get("concepts", []) if item],
            facts=[str(item) for item in raw.get("facts", []) if item],
            narrative=str(raw.get("narrative", "")),
            files=[str(item) for item in raw.get("files", []) if item],
            topic=str(raw.get("topic", "")),
            preliminary_score=0,
            final_score=0,
            score_breakdown={},
            selection_rank=None,
            selected_claim_ids=[],
        )
        for raw in timeline[start:end]
    ]


def observation_haystack(raw: dict[str, object]) -> str:
    values = [
        raw.get("id", ""),
        raw.get("type", ""),
        raw.get("title", ""),
        raw.get("subtitle", ""),
        raw.get("narrative", ""),
        raw.get("source_path", ""),
        raw.get("source_kind", ""),
        raw.get("topic", ""),
        " ".join(str(item) for item in raw.get("facts", []) if item),
        " ".join(str(item) for item in raw.get("concepts", []) if item),
        " ".join(str(item) for item in raw.get("files", []) if item),
    ]
    return " ".join(str(value) for value in values).lower()


def observation_reason(obs_type: str, matched_terms: list[str]) -> str:
    if matched_terms:
        return f"命中 focus：{', '.join(matched_terms)}。"
    reason_by_type = {
        "risk": "活跃风险优先召回。",
        "pending": "开放事项优先召回。",
        "event": "事件记忆可能影响后续判断。",
        "lesson": "已验证经验可复用。",
        "context": "项目上下文属于长期默认入口。",
        "preference": "用户偏好属于长期默认入口。",
        "plan": "active plan 是 working-layer 事实来源。",
    }
    return reason_by_type.get(obs_type, "默认优先召回 entry。")


def compute_observation_score(raw: dict[str, object], matched_terms: list[str]) -> dict[str, int]:
    obs_type = str(raw.get("type", "memory_doc"))
    source_kind = str(raw.get("source_kind", ""))
    read_tokens = int(raw.get("read_tokens", 0) or 0)
    topic = str(raw.get("topic", ""))
    facts = [str(item) for item in raw.get("facts", []) if item]
    files = [str(item) for item in raw.get("files", []) if item]
    concepts = [str(item) for item in raw.get("concepts", []) if item]

    breakdown = {
        "type_priority": OBSERVATION_TYPE_PRIORITY.get(obs_type, 50),
        "focus_terms": len(matched_terms) * 12,
        "open_loop_bonus": 5 if source_kind in {"pending_item", "active_risk"} else 0,
        "read_cost_adjustment": read_cost_adjustment(read_tokens),
        "evidence_bonus": min(6, len(facts)) + min(4, len(files)),
        "concept_bonus": min(3, len(concepts)),
        "topic_bonus": 2 if topic else 0,
    }
    return breakdown


def read_cost_adjustment(read_tokens: int) -> int:
    if read_tokens <= 0:
        return 0
    if read_tokens <= 80:
        return 4
    if read_tokens <= 160:
        return 2
    if read_tokens <= 320:
        return 0
    if read_tokens <= 520:
        return -2
    return -5


def rerank_selected_observations(
    candidates: list[SelectedObservation],
    limit: int,
) -> tuple[list[SelectedObservation], dict[str, object]]:
    sorted_candidates = sorted(
        candidates,
        key=lambda item: (-item.preliminary_score, item.read_tokens, item.id),
    )
    selected: list[SelectedObservation] = []
    selected_source_counts: dict[str, int] = {}
    ranked_debug: list[dict[str, object]] = []

    for index, item in enumerate(sorted_candidates):
        duplicate_count = selected_source_counts.get(item.source_path, 0)
        diversity_penalty = min(duplicate_count * 4, 8)
        diversity_bonus = 2 if item.source_path and duplicate_count == 0 else 0
        claim_bonus = min(4, len(item.selected_claim_ids))
        final_score = item.preliminary_score + diversity_bonus + claim_bonus - diversity_penalty
        item.score_breakdown["source_diversity_bonus"] = diversity_bonus
        item.score_breakdown["claim_bonus"] = claim_bonus
        item.score_breakdown["same_source_penalty"] = -diversity_penalty
        item.final_score = final_score
        item.score = final_score

        ranked_debug.append(
            {
                "id": item.id,
                "title": item.title,
                "source_path": item.source_path,
                "preliminary_score": item.preliminary_score,
                "final_score": final_score,
                "matched_terms": item.matched_terms,
                "selected_claim_ids": item.selected_claim_ids,
                "score_breakdown": item.score_breakdown.copy(),
                "selected": index < limit,
            }
        )

        if len(selected) >= limit:
            continue

        item.selection_rank = len(selected) + 1
        selected.append(item)
        selected_source_counts[item.source_path] = duplicate_count + 1

    selected.sort(
        key=lambda item: (
            -(item.final_score),
            item.selection_rank if item.selection_rank is not None else 9999,
            item.read_tokens,
            item.id,
        )
    )
    for rank, item in enumerate(selected, start=1):
        item.selection_rank = rank

    top_unselected = [
        entry
        for entry in ranked_debug
        if not entry["selected"]
    ][: min(5, max(0, len(ranked_debug) - limit))]
    return selected, {
        "mode": "focus-filtered" if any(item.matched_terms for item in selected) else "baseline",
        "heuristics": [
            "type_priority",
            "focus_terms",
            "open_loop_bonus",
            "read_cost_adjustment",
            "evidence_bonus",
            "concept_bonus",
            "topic_bonus",
            "source_diversity_bonus",
            "claim_bonus",
            "same_source_penalty",
        ],
        "ranked_candidate_count": len(sorted_candidates),
        "top_unselected": top_unselected,
        "ranked_candidates": ranked_debug[: min(len(ranked_debug), max(limit + 6, 12))],
    }


def empty_selection_debug() -> dict[str, object]:
    return {
        "mode": "empty",
        "candidate_count": 0,
        "ranked_candidate_count": 0,
        "focus_match_count": 0,
        "focus_excluded_count": 0,
        "heuristics": [],
        "top_unselected": [],
        "ranked_candidates": [],
    }


def select_hot_zone_docs(memory_summary: dict[str, object], focus_terms: list[str]) -> list[SelectedDoc]:
    memory_docs = memory_summary.get("memory_docs", [])
    if not isinstance(memory_docs, list):
        return []

    selected: list[SelectedDoc] = []
    fallback: list[SelectedDoc] = []

    for raw_doc in memory_docs:
        if not isinstance(raw_doc, dict):
            continue
        path = str(raw_doc.get("path", ""))
        title = str(raw_doc.get("title", path))
        summary = str(raw_doc.get("summary", ""))
        starter = bool(raw_doc.get("starter"))
        base_priority = HOT_ZONE_PRIORITY.get(path, 50)
        matched_terms = find_matched_terms(
            focus_terms,
            " ".join(
                [
                    path,
                    title,
                    summary,
                    " ".join(str(item) for item in raw_doc.get("headings", []) if item),
                    " ".join(str(item) for item in raw_doc.get("references", []) if item),
                ]
            ),
        )
        score = 50 - base_priority + (len(matched_terms) * 4)
        doc = SelectedDoc(
            path=path,
            title=title,
            kind="hot_zone",
            reason=HOT_ZONE_REASON.get(path, "默认优先召回的热区入口。"),
            score=score,
            modified_at=str(raw_doc.get("modified_at", "")),
            matched_terms=matched_terms,
            summary=summary,
        )

        if starter and path not in {".ch/docs/MEMORY.md", ".ch/docs/memory/README.md"}:
            continue
        if path in {".ch/docs/MEMORY.md", ".ch/docs/memory/README.md"}:
            fallback.append(doc)
        else:
            selected.append(doc)

    selected.sort(key=lambda item: (-item.score, item.path))
    if not selected:
        return sorted(fallback, key=lambda item: HOT_ZONE_PRIORITY.get(item.path, 99))

    combined = selected[:7]
    for doc in sorted(fallback, key=lambda item: HOT_ZONE_PRIORITY.get(item.path, 99)):
        if doc.path not in {item.path for item in combined}:
            combined.append(doc)
    return combined[:9]


def select_handoffs(root: Path, focus_terms: list[str], limit: int) -> list[SelectedDoc]:
    handoff_dir = root / HANDOFFS_DIR
    if not handoff_dir.exists():
        return []

    docs: list[SelectedDoc] = []
    for path in sorted(handoff_dir.glob("*.md"), key=lambda item: item.stat().st_mtime, reverse=True):
        if path.name in EXCLUDED_FILES:
            continue
        body = load_public_markdown_body(path)
        if body is None:
            continue
        if is_starter_text(body):
            continue
        title = extract_title(body, path.stem)
        summary = extract_summary(body)
        matched_terms = find_matched_terms(focus_terms, " ".join([path.as_posix(), title, summary, body[:1000]]))
        score = 30 + (len(matched_terms) * 5)
        docs.append(
            SelectedDoc(
                path=path.relative_to(root).as_posix(),
                title=title,
                kind="handoff",
                reason="最近一次跨会话收口入口，优先恢复当前停点和下一步。",
                score=score,
                modified_at=iso_from_timestamp(path.stat().st_mtime),
                matched_terms=matched_terms,
                summary=summary,
            )
        )

    docs.sort(key=lambda item: (item.score, item.modified_at), reverse=True)
    return docs[:limit]


def select_active_plans(memory_summary: dict[str, object], focus_terms: list[str], limit: int) -> list[SelectedDoc]:
    active_plans = memory_summary.get("active_plans", [])
    if not isinstance(active_plans, list):
        return []

    docs: list[SelectedDoc] = []
    for raw_plan in active_plans:
        if not isinstance(raw_plan, dict):
            continue
        path = str(raw_plan.get("path", ""))
        title = str(raw_plan.get("title", path))
        summary = str(raw_plan.get("summary", "查看当前目标、任务列表、验证计划和下一步。"))
        matched_terms = find_matched_terms(focus_terms, f"{path} {title} {summary}")
        score = 20 + (len(matched_terms) * 6)
        docs.append(
            SelectedDoc(
                path=path,
                title=title,
                kind="active_plan",
                reason="当前任务推进中的 working-layer 事实来源。",
                score=score,
                modified_at=str(raw_plan.get("modified_at", "")),
                matched_terms=matched_terms,
                summary=summary,
            )
        )

    docs.sort(key=lambda item: (item.score, item.modified_at), reverse=True)
    return docs[:limit]


def collect_related_docs(
    base_dir: Path,
    root: Path,
    focus_terms: list[str],
    limit: int,
    *,
    kind: str,
    excluded: set[str],
) -> list[SelectedDoc]:
    if not focus_terms or not base_dir.exists():
        return []

    docs: list[SelectedDoc] = []
    for path in sorted(base_dir.rglob("*.md")):
        if not path.is_file() or path.name in excluded:
            continue
        body = load_public_markdown_body(path)
        if body is None:
            continue
        if is_starter_text(body):
            continue
        title = extract_title(body, path.stem)
        summary = extract_summary(body)
        headings = extract_headings(body)
        matched_terms = find_matched_terms(
            focus_terms,
            " ".join([path.relative_to(root).as_posix(), title, summary, " ".join(headings), body[:1500]]),
        )
        if not matched_terms:
            continue
        score = compute_focus_score(path.relative_to(root).as_posix(), title, headings, summary, body, matched_terms)
        docs.append(
            SelectedDoc(
                path=path.relative_to(root).as_posix(),
                title=title,
                kind=kind,
                reason=related_reason(kind, matched_terms),
                score=score,
                modified_at=iso_from_timestamp(path.stat().st_mtime),
                matched_terms=matched_terms,
                summary=summary,
            )
        )

    docs.sort(key=lambda item: (-item.score, item.path))
    return docs[:limit]


def related_reason(kind: str, matched_terms: list[str]) -> str:
    joined = " / ".join(matched_terms)
    if kind == "design_doc":
        return f"与当前 focus 相关的设计决策入口，命中：{joined}。"
    return f"与当前 focus 相关的排障或规避动作入口，命中：{joined}。"


def compute_focus_score(
    path: str,
    title: str,
    headings: list[str],
    summary: str,
    body: str,
    matched_terms: list[str],
) -> int:
    score = 0
    title_lower = title.lower()
    path_lower = path.lower()
    headings_lower = " ".join(headings).lower()
    summary_lower = summary.lower()
    body_lower = body.lower()
    for term in matched_terms:
        if term in title_lower:
            score += 10
        if term in path_lower:
            score += 6
        if term in headings_lower:
            score += 5
        if term in summary_lower:
            score += 3
        if term in body_lower:
            score += 1
    return score


def build_watch_items(
    memory_summary: dict[str, object],
    consolidation_summary: dict[str, object] | None,
    selected_claims: list[dict[str, object]],
) -> list[dict[str, object]]:
    items: list[dict[str, object]] = []
    open_loops = memory_summary.get("open_loops", {})
    pending_count = 0
    risk_count = 0
    active_plan_count = 0
    if isinstance(open_loops, dict):
        pending_items = open_loops.get("pending_items", [])
        active_risks = open_loops.get("active_risks", [])
        active_plan_count = int(open_loops.get("active_plan_count", 0) or 0)
        if isinstance(pending_items, list):
            pending_count = len(pending_items)
        if isinstance(active_risks, list):
            risk_count = len(active_risks)

    if pending_count:
        items.append(
            {
                "kind": "pending_items",
                "severity": "medium",
                "count": pending_count,
                "message": f"当前有 {pending_count} 条 pending items。",
            }
        )
    if risk_count:
        items.append(
            {
                "kind": "active_risks",
                "severity": "high",
                "count": risk_count,
                "message": f"当前有 {risk_count} 条 active risks。",
            }
        )
    if active_plan_count:
        items.append(
            {
                "kind": "active_plans",
                "severity": "medium",
                "count": active_plan_count,
                "message": f"当前有 {active_plan_count} 份 active plans。",
            }
        )

    stale_paths = collect_stale_paths(memory_summary)
    if stale_paths:
        items.append(
            {
                "kind": "stale_memory_docs",
                "severity": "high",
                "paths": stale_paths,
                "message": "存在 stale memory docs：" + "、".join(f"`{path}`" for path in stale_paths[:5]) + "。",
            }
        )

    privacy = memory_summary.get("privacy", {})
    if isinstance(privacy, dict):
        skip_count = int(privacy.get("private_doc_skip_count", 0) or 0)
        stripped_count = int(privacy.get("private_blocks_stripped", 0) or 0)
        if skip_count or stripped_count:
            items.append(
                {
                    "kind": "privacy_filter",
                    "severity": "info",
                    "private_doc_skip_count": skip_count,
                    "private_blocks_stripped": stripped_count,
                    "message": f"隐私过滤已生效：跳过 {skip_count} 份 private doc，剥离 {stripped_count} 个 private block。",
                }
            )

    starter_hot_zone = collect_starter_hot_zone_paths(memory_summary)
    if starter_hot_zone:
        items.append(
            {
                "kind": "starter_hot_zone",
                "severity": "info",
                "paths": starter_hot_zone,
                "message": "这些热区文件仍是 starter 占位：" + "、".join(f"`{path}`" for path in starter_hot_zone[:5]) + "。",
            }
        )

    claim_status_counts = build_claim_status_summary(selected_claims)
    if claim_status_counts.get("unsupported"):
        items.append(
            {
                "kind": "unsupported_claims",
                "severity": "medium",
                "count": claim_status_counts["unsupported"],
                "message": f"选中 claim 中有 {claim_status_counts['unsupported']} 条标记为 unsupported。",
            }
        )
    if claim_status_counts.get("stale"):
        items.append(
            {
                "kind": "stale_claims",
                "severity": "medium",
                "count": claim_status_counts["stale"],
                "message": f"选中 claim 中有 {claim_status_counts['stale']} 条标记为 stale。",
            }
        )

    if consolidation_summary:
        coverage_gaps = consolidation_summary.get("coverage_gaps", [])
        if isinstance(coverage_gaps, list) and coverage_gaps:
            for gap in coverage_gaps[:5]:
                items.append(
                    {
                        "kind": "consolidation_gap",
                        "severity": "medium",
                        "message": f"Consolidation gap: {gap}",
                    }
                )

    if not items:
        items.append(
            {
                "kind": "clear",
                "severity": "info",
                "message": "当前没有明显的 open loops、stale docs 或 consolidation gaps。",
            }
        )
    return items


def collect_stale_paths(memory_summary: dict[str, object]) -> list[str]:
    memory_docs = memory_summary.get("memory_docs", [])
    if not isinstance(memory_docs, list):
        return []
    paths: list[str] = []
    for raw_doc in memory_docs:
        if not isinstance(raw_doc, dict):
            continue
        if str(raw_doc.get("freshness")) == "stale":
            paths.append(str(raw_doc.get("path", "")))
    return paths


def collect_starter_hot_zone_paths(memory_summary: dict[str, object]) -> list[str]:
    memory_docs = memory_summary.get("memory_docs", [])
    if not isinstance(memory_docs, list):
        return []
    paths: list[str] = []
    for raw_doc in memory_docs:
        if not isinstance(raw_doc, dict):
            continue
        path = str(raw_doc.get("path", ""))
        if path in HOT_ZONE_PRIORITY and bool(raw_doc.get("starter")):
            paths.append(path)
    return paths


def build_selected_claims(
    observations: list[SelectedObservation],
    claim_index: dict[str, list[dict[str, object]]],
) -> list[dict[str, object]]:
    selected: list[dict[str, object]] = []
    for item in observations:
        for claim in claim_index.get(item.id, []):
            claim_payload = {
                "claim_id": str(claim.get("claim_id", "")),
                "status": str(claim.get("status", "")),
                "claim_type": str(claim.get("claim_type", "")),
                "source_path": str(claim.get("source_path", item.source_path)),
                "source_observation_id": str(claim.get("source_observation_id", item.id)),
                "confidence": str(claim.get("confidence", "")),
                "review_after": str(claim.get("review_after", "")),
            }
            selected.append(claim_payload)
    selected.sort(key=claim_sort_key)
    return selected


def build_claim_status_summary(selected_claims: list[dict[str, object]]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for claim in selected_claims:
        status = str(claim.get("status", "")).strip().lower() or "unknown"
        counts[status] = counts.get(status, 0) + 1
    return dict(sorted(counts.items()))


def claim_sort_key(claim: dict[str, object]) -> tuple[str, str, str]:
    return (
        str(claim.get("source_path", "")),
        str(claim.get("source_observation_id", "")),
        str(claim.get("claim_id", "")),
    )


def unique_selected_source_paths(observations: list[SelectedObservation]) -> list[str]:
    return dedupe_preserve_order(item.source_path for item in observations if item.source_path)


def collect_selected_matched_terms(observations: list[SelectedObservation]) -> list[str]:
    matched: list[str] = []
    for item in observations:
        for term in item.matched_terms:
            if term not in matched:
                matched.append(term)
    return matched


def build_score_summary(observations: list[SelectedObservation]) -> dict[str, object]:
    if not observations:
        return {
            "max": 0,
            "min": 0,
            "average": 0,
            "by_observation": [],
        }
    final_scores = [item.final_score for item in observations]
    return {
        "max": max(final_scores),
        "min": min(final_scores),
        "average": round(sum(final_scores) / len(final_scores), 2),
        "by_observation": [
            {
                "id": item.id,
                "score": item.final_score,
                "preliminary_score": item.preliminary_score,
                "rank": item.selection_rank,
                "score_breakdown": item.score_breakdown,
            }
            for item in observations
        ],
    }


def build_source_diversity(observations: list[SelectedObservation]) -> dict[str, object]:
    unique_sources = unique_selected_source_paths(observations)
    per_source: dict[str, int] = {}
    per_kind: dict[str, int] = {}
    for item in observations:
        per_source[item.source_path] = per_source.get(item.source_path, 0) + 1
        kind = item.source_kind or "unknown"
        per_kind[kind] = per_kind.get(kind, 0) + 1
    return {
        "unique_source_count": len(unique_sources),
        "selected_observation_count": len(observations),
        "source_path_counts": dict(sorted(per_source.items())),
        "source_kind_counts": dict(sorted(per_kind.items())),
        "max_same_source_observations": max(per_source.values(), default=0),
    }


def watch_item_message(item: dict[str, object]) -> str:
    return str(item.get("message", "")).strip()


def dedupe_preserve_order(items) -> list[str]:
    seen: set[str] = set()
    ordered: list[str] = []
    for raw in items:
        item = str(raw)
        if not item or item in seen:
            continue
        seen.add(item)
        ordered.append(item)
    return ordered


def strip_front_matter(text: str) -> str:
    return split_front_matter(text)[1]


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


def load_public_markdown_body(path: Path) -> str | None:
    text = path.read_text(encoding="utf-8")
    metadata, body = split_front_matter(text)
    if is_private_document(metadata):
        return None
    stripped, _strip_count = strip_private_blocks(body)
    return stripped


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
    lines: list[str] = []
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or line.startswith("|") or line.startswith("```"):
            if lines:
                break
            continue
        normalized = strip_list_prefix(line)
        if normalized:
            lines.append(normalized)
        if len(" ".join(lines)) >= 160:
            break
    return " ".join(lines).strip() or "暂无摘要。"


def strip_list_prefix(text: str) -> str:
    cleaned = re.sub(r"^[-*]\s+", "", text)
    cleaned = re.sub(r"^\d+\.\s+", "", cleaned)
    cleaned = re.sub(r"^\[[ xX]\]\s+", "", cleaned)
    return cleaned.strip()


def find_matched_terms(terms: list[str], haystack: str) -> list[str]:
    lowered = haystack.lower()
    matched: list[str] = []
    haystack_terms = build_haystack_terms(lowered)
    for term in terms:
        if term in haystack_terms and term not in matched:
            matched.append(term)
    return matched


def append_term(terms: list[str], term: str) -> None:
    if term and term not in terms:
        terms.append(term)


def contains_cjk(text: str) -> bool:
    return bool(CJK_TOKEN_RE.search(text))


def expand_cjk_terms(token: str) -> list[str]:
    expanded: list[str] = []
    normalized = token.strip()
    if len(normalized) < 2:
        return expanded
    append_term(expanded, normalized)
    if len(normalized) <= 4:
        return expanded
    for match in CJK_BIGRAM_RE.finditer(normalized):
        append_term(expanded, match.group(1))
    return expanded


def build_haystack_terms(text: str) -> set[str]:
    terms: set[str] = set()
    for token in re.findall(r"[a-z0-9_.-]+|[\u3400-\u4dbf\u4e00-\u9fff]{2,}", text):
        normalized = token.strip(" .-_")
        if len(normalized) < 2:
            continue
        terms.add(normalized)
        if contains_cjk(normalized):
            terms.update(expand_cjk_terms(normalized))
    return terms


def is_starter_text(text: str) -> bool:
    lowered = text.lower()
    return any(hint in lowered for hint in STARTER_HINTS)


def iso_now() -> str:
    return datetime.now(UTC).replace(microsecond=0).strftime("%Y-%m-%dT%H:%M:%SZ")


def iso_from_timestamp(timestamp: float) -> str:
    return datetime.fromtimestamp(timestamp, tz=UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def render_report(
    *,
    focus: str,
    anchor_id: str,
    generated_docs: list[SelectedDoc],
    observations: list[SelectedObservation],
    expanded_observations: list[SelectedObservation],
    timeline_window: list[SelectedObservation],
    hot_zone_docs: list[SelectedDoc],
    handoffs: list[SelectedDoc],
    active_plans: list[SelectedDoc],
    design_docs: list[SelectedDoc],
    runbooks: list[SelectedDoc],
    watch_items: list[dict[str, object]],
    memory_summary: dict[str, object],
    selection_mode: str,
    retrieval_debug_path: str,
    source_diversity: dict[str, object],
    matched_terms: list[str],
) -> str:
    total_available = int(memory_summary.get("observation_count", 0) or 0)
    total_read_tokens = int(memory_summary.get("total_read_tokens", 0) or 0)
    selected_tokens = sum(item.read_tokens for item in observations)
    expanded_tokens = sum(item.read_tokens for item in expanded_observations)
    lines = [
        "# Memory Recall Pack",
        "",
        "## Summary",
        "",
        f"- Generated at: {iso_now()}",
        f"- Focus: {focus or 'baseline / no explicit focus'}",
        f"- Anchor ID: {anchor_id or '-'}",
        f"- Selection mode: {selection_mode}",
        f"- Available observation entries: {total_available}",
        f"- Available read cost: ~{total_read_tokens} tokens",
        f"- Selected index entries: {len(observations)} (~{selected_tokens} tokens if fully expanded)",
        f"- Expanded entries in this pack: {len(expanded_observations)} (~{expanded_tokens} tokens)",
        f"- Generated recall surfaces: {len(generated_docs)}",
        f"- Hot-zone docs: {len(hot_zone_docs)}",
        f"- Recent handoffs: {len(handoffs)}",
        f"- Active plans: {len(active_plans)}",
        f"- Related design docs: {len(design_docs)}",
        f"- Related runbooks: {len(runbooks)}",
        f"- Source diversity: {source_diversity.get('unique_source_count', 0)} unique sources / {source_diversity.get('selected_observation_count', 0)} selected observations",
        f"- Retrieval debug: `{retrieval_debug_path}`",
        "",
        "## Progressive Disclosure",
        "",
        "1. 先扫下面的 Observation Index，确认哪些 ID 值得展开。",
        "2. 只读取 Expanded Observation Details 中少量最高优先级条目。",
        "3. 如果需要更多细节，再按 ID 打开 `observation-registry.md` 或 `observations.jsonl`。",
        "4. 如果需要上下文顺序，用 `timeline.md` 或重新运行 `--anchor-id <id>`。",
        "",
    ]

    if matched_terms:
        lines.extend(
            [
                "## Focus Match Summary",
                "",
                f"- Matched terms: {', '.join(f'`{term}`' for term in matched_terms)}",
                "",
            ]
        )

    lines.extend(render_observation_index(observations))
    lines.extend(render_expanded_observations(expanded_observations))
    if anchor_id:
        lines.extend(render_timeline_window(anchor_id, timeline_window))

    lines.extend(
        [
            "## Recommended Reading Order",
            "",
            "1. `recall-index.md` / 本文件的 Observation Index。",
            "2. 本文件的 Expanded Observation Details。",
            "3. `open-loops.md` 和 `freshness-report.md`。",
            "4. 如果任务是跨会话续接，再看最近 handoff。",
            "5. 再看相关 active plans，确认 working-layer 目标、任务列表和验证计划。",
            "6. 如果提供了 focus，再展开匹配到的 design docs 和 runbooks。",
            "",
        ]
    )

    lines.extend(render_section("Generated Recall Surfaces", generated_docs))
    lines.extend(render_section("Hot-Zone Docs", hot_zone_docs))
    lines.extend(render_section("Recent Handoffs", handoffs))
    lines.extend(render_section("Active Plans", active_plans))
    lines.extend(render_section("Related Design Docs", design_docs))
    lines.extend(render_section("Related Runbooks", runbooks))

    lines.extend(["## Watch Items", ""])
    lines.extend(f"- {watch_item_message(item)}" for item in watch_items)
    lines.append("")

    lines.extend(
        [
            "## Suggested Next Commands",
            "",
            "- `python3 .agents/skills/memory-indexer/scripts/generate_memory_index.py`：当热区或开放事项变化后刷新基础 recall 面。",
            "- `python3 .agents/skills/memory-recall/scripts/build_recall_pack.py --anchor-id <mem-id>`：围绕某个 observation ID 生成 timeline window。",
            "- `python3 .agents/skills/memory-consolidator/scripts/consolidate_memory.py`：当 recall 暴露出 promotion backlog 时继续做 consolidation。",
            "- `python3 .agents/skills/memory-freshness-auditor/scripts/audit_memory_freshness.py`：当 recall 暴露 stale docs 或 attribution 缺口时继续做 freshness audit。",
            "",
        ]
    )
    return "\n".join(lines)


def render_observation_index(observations: list[SelectedObservation]) -> list[str]:
    lines = [
        "## Observation Index",
        "",
        "| ID | Type | Title | Read | Source | Why |",
        "| --- | --- | --- | --- | --- | --- |",
    ]
    if not observations:
        lines.append("| - | - | 当前没有 selected observation entries | - | - | - |")
        lines.append("")
        return lines
    for item in observations:
        lines.append(
            f"| `{item.id}` | `{item.type}` | {escape_pipes(shorten(item.title, 96))} | "
            f"~{item.read_tokens} | `{item.source_path}` | {escape_pipes(item.reason)} |"
        )
    lines.append("")
    return lines


def render_expanded_observations(observations: list[SelectedObservation]) -> list[str]:
    lines = ["## Expanded Observation Details", ""]
    if not observations:
        lines.append("- None")
        lines.append("")
        return lines
    for item in observations:
        lines.extend(
            [
                f"### {item.id} - {item.title}",
                "",
                f"- Type: `{item.type}`",
                f"- Topic: `{item.topic or '-'}`",
                f"- Read: ~{item.read_tokens} tokens",
                f"- Source: `{item.source_path}`",
                f"- Score: `{item.final_score}` (base `{item.preliminary_score}`)",
            ]
        )
        if item.matched_terms:
            lines.append(f"- Matches: {', '.join(f'`{term}`' for term in item.matched_terms)}")
        if item.selected_claim_ids:
            lines.append(f"- Selected claims: {format_claim_id_list(item.selected_claim_ids)}")
        if item.score_breakdown:
            breakdown = ", ".join(
                f"{name}={value}"
                for name, value in item.score_breakdown.items()
            )
            lines.append(f"- Score breakdown: {breakdown}")
        if item.concepts:
            lines.append(f"- Concepts: {', '.join(f'`{concept}`' for concept in item.concepts[:6])}")
        if item.files:
            lines.append(f"- Files: {', '.join(f'`{file}`' for file in item.files[:8])}")
        if item.facts:
            lines.extend(["", "Facts:"])
            lines.extend(f"- {fact}" for fact in item.facts[:5])
        if item.narrative:
            lines.extend(["", "Narrative:", "", item.narrative])
        lines.append("")
    return lines


def render_timeline_window(anchor_id: str, observations: list[SelectedObservation]) -> list[str]:
    lines = [
        "## Timeline Window",
        "",
        f"- Anchor: `{anchor_id}`",
        "",
        "| ID | Modified | Type | Title | Source |",
        "| --- | --- | --- | --- | --- |",
    ]
    if not observations:
        lines.append("| - | - | - | Anchor not found in generated observation registry | - |")
        lines.append("")
        return lines
    for item in observations:
        marker = " (anchor)" if item.id == anchor_id else ""
        lines.append(
            f"| `{item.id}`{marker} | {item.modified_at or '-'} | `{item.type}` | "
            f"{escape_pipes(shorten(item.title, 96))} | `{item.source_path}` |"
        )
    lines.append("")
    return lines


def render_retrieval_debug(
    *,
    focus: str,
    focus_terms: list[str],
    anchor_id: str,
    observations: list[SelectedObservation],
    selection_debug: dict[str, object],
    source_diversity: dict[str, object],
    selected_claims: list[dict[str, object]],
    watch_items: list[dict[str, object]],
) -> str:
    ranked_candidates = selection_debug.get("ranked_candidates", [])
    top_unselected = selection_debug.get("top_unselected", [])
    heuristics = selection_debug.get("heuristics", [])
    lines = [
        "# Retrieval Debug",
        "",
        "这个文件只解释本次 recall 为什么选中了这些 observation，以及有哪些轻量词法启发式参与排序。",
        "它是 generated-only 的 debug / eval 辅助层，不是新的长期事实来源。",
        "",
        "## Run Context",
        "",
        f"- Generated at: {iso_now()}",
        f"- Focus: {focus or 'baseline / no explicit focus'}",
        f"- Focus terms: {', '.join(f'`{term}`' for term in focus_terms) if focus_terms else '-'}",
        f"- Anchor ID: {anchor_id or '-'}",
        f"- Selection mode: {selection_debug.get('mode', 'unknown')}",
        f"- Candidate count: {selection_debug.get('candidate_count', 0)}",
        f"- Ranked candidate count: {selection_debug.get('ranked_candidate_count', 0)}",
        f"- Focus match count: {selection_debug.get('focus_match_count', 0)}",
        f"- Focus excluded count: {selection_debug.get('focus_excluded_count', 0)}",
        "",
        "## Heuristics",
        "",
    ]
    if heuristics:
        lines.extend(f"- `{name}`" for name in heuristics)
    else:
        lines.append("- None")
    lines.extend(
        [
            "",
            "## Selected Observations",
            "",
            "| Rank | ID | Final | Base | Matched Terms | Source | Claims |",
            "| --- | --- | --- | --- | --- | --- | --- |",
        ]
    )
    if not observations:
        lines.append("| - | - | - | - | 当前没有选中的 observation | - | - |")
    else:
        for item in observations:
            lines.append(
                f"| {item.selection_rank or '-'} | `{item.id}` | `{item.final_score}` | `{item.preliminary_score}` | "
                f"{escape_pipes(', '.join(item.matched_terms) or '-')} | `{item.source_path}` | `{len(item.selected_claim_ids)}` |"
            )
    lines.extend(["", "## Score Breakdown", ""])
    if not observations:
        lines.append("- None")
    else:
        for item in observations:
            lines.extend(
                [
                    f"### {item.id} - {item.title}",
                    "",
                    f"- Final score: `{item.final_score}`",
                    f"- Base score: `{item.preliminary_score}`",
                    f"- Matched terms: {', '.join(f'`{term}`' for term in item.matched_terms) if item.matched_terms else '-'}",
                    f"- Source: `{item.source_path}`",
                    f"- Selected claim IDs: {format_claim_id_list(item.selected_claim_ids)}",
                    "",
                    "| Heuristic | Contribution |",
                    "| --- | --- |",
                ]
            )
            for name, value in item.score_breakdown.items():
                lines.append(f"| `{name}` | `{value}` |")
            lines.append("")

    lines.extend(["## Top Unselected Candidates", ""])
    if not isinstance(top_unselected, list) or not top_unselected:
        lines.append("- None")
        lines.append("")
    else:
        lines.extend(
            [
                "| ID | Final | Base | Matched Terms | Source |",
                "| --- | --- | --- | --- | --- |",
            ]
        )
        for entry in top_unselected:
            if not isinstance(entry, dict):
                continue
            lines.append(
                f"| `{entry.get('id', '-')}` | `{entry.get('final_score', '-')}` | `{entry.get('preliminary_score', '-')}` | "
                f"{escape_pipes(', '.join(str(term) for term in entry.get('matched_terms', [])) or '-')} | "
                f"`{entry.get('source_path', '-')}` |"
            )
        lines.append("")

    lines.extend(
        [
            "## Source Diversity",
            "",
            f"- Unique source count: {source_diversity.get('unique_source_count', 0)}",
            f"- Selected observation count: {source_diversity.get('selected_observation_count', 0)}",
            f"- Max same-source observations: {source_diversity.get('max_same_source_observations', 0)}",
            "",
            "### Source Path Counts",
            "",
        ]
    )
    source_path_counts = source_diversity.get("source_path_counts", {})
    if isinstance(source_path_counts, dict) and source_path_counts:
        lines.extend(f"- `{path}`: {count}" for path, count in source_path_counts.items())
    else:
        lines.append("- None")
    lines.extend(["", "### Source Kind Counts", ""])
    source_kind_counts = source_diversity.get("source_kind_counts", {})
    if isinstance(source_kind_counts, dict) and source_kind_counts:
        lines.extend(f"- `{kind}`: {count}" for kind, count in source_kind_counts.items())
    else:
        lines.append("- None")

    lines.extend(["", "## Claim Status Snapshot", ""])
    claim_status_summary = build_claim_status_summary(selected_claims)
    if claim_status_summary:
        lines.extend(f"- `{status}`: {count}" for status, count in claim_status_summary.items())
    else:
        lines.append("- No selected claims")

    lines.extend(["", "## Watch Items", ""])
    lines.extend(f"- {watch_item_message(item)}" for item in watch_items)
    lines.append("")
    return "\n".join(lines)


def render_section(title: str, docs: list[SelectedDoc]) -> list[str]:
    lines = [f"## {title}", ""]
    if not docs:
        lines.append("- None")
        lines.append("")
        return lines

    for doc in docs:
        matched = f" | matches={', '.join(doc.matched_terms)}" if doc.matched_terms else ""
        lines.extend(
            [
                f"- `{doc.path}` | {doc.title}{matched}",
                f"  Why: {doc.reason}",
                f"  Summary: {doc.summary}",
                "",
            ]
        )
    return lines


def shorten(text: str, max_length: int) -> str:
    cleaned = re.sub(r"\s+", " ", text or "").strip()
    if len(cleaned) <= max_length:
        return cleaned
    return cleaned[: max_length - 3].rstrip() + "..."


def escape_pipes(text: str) -> str:
    return text.replace("|", "\\|")


def format_claim_id_list(claim_ids: list[str], preview: int = 6) -> str:
    if not claim_ids:
        return "-"
    shown = ", ".join(f"`{claim_id}`" for claim_id in claim_ids[:preview])
    remaining = len(claim_ids) - min(len(claim_ids), preview)
    if remaining > 0:
        return f"{shown} ... (+{remaining} more)"
    return shown


if __name__ == "__main__":
    raise SystemExit(main())
