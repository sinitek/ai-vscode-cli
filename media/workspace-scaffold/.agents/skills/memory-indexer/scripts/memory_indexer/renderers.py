"""Render generated memory index artifacts."""

from __future__ import annotations

import json

from .extractors import count_by_pyramid_level
from .models import ActivePlan, MemoryClaimLite, MemoryDoc, MemoryObservation
from .text_utils import escape_pipes, shorten


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
