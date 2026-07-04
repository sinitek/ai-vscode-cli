"""Load generated memory-index artifacts and build generated doc entries."""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

from .models import SelectedDoc
from .text_utils import iso_now
from .watch_items import claim_sort_key

def resolve_output_dir(root: Path, output_dir_arg: str) -> Path:
    output_dir = Path(output_dir_arg)
    if output_dir.is_absolute():
        return output_dir
    return root / output_dir


def run_memory_indexer(root: Path, output_dir: Path, stale_days: int) -> None:
    script_path = (
        Path(__file__).resolve().parents[3]
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
