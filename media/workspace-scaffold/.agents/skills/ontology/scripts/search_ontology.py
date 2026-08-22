#!/usr/bin/env python3
"""Search and validate the repository's AI development business ontology."""

from __future__ import annotations

import argparse
import json
import re
import sys
import unicodedata
from dataclasses import dataclass, field
from difflib import SequenceMatcher
from pathlib import Path
from typing import Any, Iterable

GENERATOR_NAME = "ontology-search"
GENERATOR_VERSION = "1.3.0"
DEFAULT_ONTOLOGY_DIR = ".ch/docs/ontology"
DEFAULT_LIMIT = 20
DEFAULT_FUZZY_THRESHOLD = 0.80
MIN_FUZZY_TERM_LENGTH = 3
MIN_FUZZY_CANDIDATE_LENGTH = 2
RELAXED_MULTI_TERM_MIN_MATCHES = 2
VALID_RECORD_TYPES = ("domain", "concept", "relation", "rule", "workflow")
VALID_MATCH_MODES = ("auto", "all", "any")
HARNESS_DOMAIN_ID = "harness-governance"
SCAFFOLD_PLACEHOLDER_DOMAIN_ID = "project-system"
SCAFFOLD_PLACEHOLDER_PREFIX = "project."
DOMAIN_ID_RE = re.compile(r"^[a-z][a-z0-9-]*$")
RECORD_ID_RE = re.compile(r"^[a-z][a-z0-9_-]*(?:\.[a-z][a-z0-9_-]*)+$")
QUERY_SPLIT_RE = re.compile(r"[\s,，、;；:：/\\|]+")
CODE_IDENTIFIER_SPLIT_RE = re.compile(r"[\s,，、;；:：/\\|._\-()（）\[\]{}<>《》\"'`]+")
CAMEL_BOUNDARY_RE = re.compile(r"(?<=[a-z0-9])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])")
FUZZY_SEGMENT_SPLIT_RE = re.compile(r"[\s,，、;；:：/\\|._\-()（）\[\]{}<>《》\"'`]+")
FUZZY_COMPACT_RE = re.compile(r"[\s,，、;；:：/\\|._\-()（）\[\]{}<>《》\"'`]+")
CJK_RUN_RE = re.compile(r"[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]+")
CJK_NGRAM_SIZES = (2, 3, 4)
FUZZY_ID_SCORE = 120
FUZZY_NAME_SCORE = 110
FUZZY_ALIAS_SCORE = 90
FUZZY_DESCRIPTION_SCORE = 55
FUZZY_PAYLOAD_SCORE = 24


class OntologyError(RuntimeError):
    """Raised when ontology files cannot be loaded."""


@dataclass(frozen=True)
class OntologyDocument:
    path: str
    document_type: str
    payload: dict[str, Any]


@dataclass(frozen=True)
class OntologyRecord:
    id: str
    name: str
    record_type: str
    domains: tuple[str, ...]
    source_file: str
    payload: dict[str, Any]

    @property
    def description(self) -> str:
        return normalize_display_text(self.payload.get("description"))

    @property
    def kind(self) -> str:
        if self.record_type == "concept":
            return normalize_display_text(self.payload.get("kind"))
        return self.record_type

    @property
    def status(self) -> str:
        return normalize_display_text(self.payload.get("status"))

    @property
    def aliases(self) -> list[str]:
        aliases = self.payload.get("aliases", [])
        if not isinstance(aliases, list):
            return []
        return [normalize_display_text(alias) for alias in aliases if normalize_display_text(alias)]

    @property
    def source_refs(self) -> list[dict[str, str]]:
        return normalize_source_refs(self.payload.get("source_refs"))


@dataclass
class OntologyIndex:
    root: Path
    ontology_dir: Path
    manifest: dict[str, Any]
    documents: list[OntologyDocument] = field(default_factory=list)
    records: list[OntologyRecord] = field(default_factory=list)

    @property
    def domain_ids(self) -> list[str]:
        return sorted(record.id for record in self.records if record.record_type == "domain")

    @property
    def concepts(self) -> list[OntologyRecord]:
        return [record for record in self.records if record.record_type == "concept"]

    @property
    def relations(self) -> list[OntologyRecord]:
        return [record for record in self.records if record.record_type == "relation"]

    def records_by_id(self) -> dict[str, OntologyRecord]:
        result: dict[str, OntologyRecord] = {}
        for record in self.records:
            result.setdefault(record.id, record)
        return result


@dataclass(frozen=True)
class SearchStrategy:
    requested_match: str
    effective_match: str
    relaxed: bool
    query_terms: list[str]
    relaxed_terms: list[str]
    minimum_matched_terms: int
    reason: str = ""

    def to_dict(self) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "requested_match": self.requested_match,
            "effective_match": self.effective_match,
            "relaxed": self.relaxed,
            "query_terms": self.query_terms,
            "minimum_matched_terms": self.minimum_matched_terms,
        }
        if self.relaxed_terms != self.query_terms:
            payload["relaxed_terms"] = self.relaxed_terms
        if self.reason:
            payload["reason"] = self.reason
        return payload


def default_repo_root() -> Path:
    return Path(__file__).resolve().parents[4]


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Search and validate the repository AI development business ontology."
    )
    parser.add_argument("query", nargs="*", help="Keyword query. Multiple terms are space separated.")
    parser.add_argument("--query", dest="query_option", help="Keyword query alternative to positional terms.")
    parser.add_argument("--id", dest="record_id", help="Find one exact ontology record ID.")
    parser.add_argument(
        "--domain",
        action="append",
        default=[],
        help="Limit results to a domain ID. Can be repeated.",
    )
    parser.add_argument(
        "--type",
        dest="record_types",
        action="append",
        choices=VALID_RECORD_TYPES,
        default=[],
        help="Limit results to a record type. Can be repeated.",
    )
    parser.add_argument(
        "--kind",
        action="append",
        default=[],
        help="Limit concepts to a kind such as aggregate, entity, policy, or event.",
    )
    parser.add_argument(
        "--status",
        action="append",
        default=[],
        help="Limit results to a status such as active or historical.",
    )
    parser.add_argument(
        "--match",
        choices=VALID_MATCH_MODES,
        default="auto",
        help=(
            "Search mode. auto tries all terms first, then a guarded any-term "
            "fallback when strict search returns no results. Default: auto."
        ),
    )
    parser.add_argument(
        "--fuzzy",
        dest="fuzzy",
        action="store_true",
        default=True,
        help="Enable fuzzy matching for near-miss query terms. Default: enabled.",
    )
    parser.add_argument(
        "--no-fuzzy",
        dest="fuzzy",
        action="store_false",
        help="Disable fuzzy matching and require exact substring matches.",
    )
    parser.add_argument(
        "--fuzzy-threshold",
        type=float,
        default=DEFAULT_FUZZY_THRESHOLD,
        help=f"Minimum fuzzy similarity from 0 to 1. Default: {DEFAULT_FUZZY_THRESHOLD}.",
    )
    parser.add_argument(
        "--related",
        nargs="?",
        const=1,
        default=0,
        type=int,
        metavar="DEPTH",
        help="Expand concept relations to DEPTH hops. Default when present: 1.",
    )
    parser.add_argument("--limit", type=int, default=DEFAULT_LIMIT, help="Maximum search results.")
    parser.add_argument("--show-record", action="store_true", help="Include the complete record payload.")
    parser.add_argument("--json", action="store_true", help="Print machine-readable JSON.")
    parser.add_argument("--validate", action="store_true", help="Validate all ontology data and references.")
    parser.add_argument("--list-domains", action="store_true", help="List registered business domains.")
    parser.add_argument("--list-types", action="store_true", help="List record and concept kinds.")
    parser.add_argument(
        "--status-report",
        action="store_true",
        help="Report whether ontology is empty or still scaffold-placeholder-only.",
    )
    parser.add_argument("--root", default=str(default_repo_root()), help="Repository root.")
    parser.add_argument(
        "--ontology-dir",
        default=DEFAULT_ONTOLOGY_DIR,
        help="Ontology directory, relative to --root unless absolute.",
    )
    return parser.parse_args(argv)


def load_ontology(root: Path, ontology_dir: str | Path = DEFAULT_ONTOLOGY_DIR) -> OntologyIndex:
    resolved_root = root.resolve()
    resolved_ontology_dir = resolve_path(resolved_root, ontology_dir)
    manifest_path = resolved_ontology_dir / "manifest.json"
    manifest = load_json_object(manifest_path)
    index = OntologyIndex(
        root=resolved_root,
        ontology_dir=resolved_ontology_dir,
        manifest=manifest,
    )

    for relative_path in manifest.get("domain_files", []):
        document_path = resolve_manifest_path(index, relative_path)
        payload = load_json_object(document_path)
        source_file = relative_repo_path(index.root, document_path)
        index.documents.append(OntologyDocument(source_file, "domain", payload))
        domain_payload = payload.get("domain")
        if not isinstance(domain_payload, dict):
            continue
        domain_id = normalize_display_text(domain_payload.get("id"))
        index.records.append(
            build_record(domain_payload, "domain", (domain_id,) if domain_id else (), source_file)
        )
        for key, record_type in (
            ("concepts", "concept"),
            ("relations", "relation"),
            ("rules", "rule"),
        ):
            values = payload.get(key, [])
            if not isinstance(values, list):
                continue
            for value in values:
                if isinstance(value, dict):
                    index.records.append(build_record(value, record_type, (domain_id,), source_file))

    for relative_path in manifest.get("workflow_files", []):
        document_path = resolve_manifest_path(index, relative_path)
        payload = load_json_object(document_path)
        source_file = relative_repo_path(index.root, document_path)
        index.documents.append(OntologyDocument(source_file, "workflow", payload))
        workflows = payload.get("workflows", [])
        if not isinstance(workflows, list):
            continue
        for workflow in workflows:
            if not isinstance(workflow, dict):
                continue
            domains = workflow.get("domains", [])
            normalized_domains = tuple(
                normalize_display_text(domain)
                for domain in domains
                if normalize_display_text(domain)
            ) if isinstance(domains, list) else ()
            index.records.append(build_record(workflow, "workflow", normalized_domains, source_file))

    return index


def build_record(
    payload: dict[str, Any],
    record_type: str,
    domains: tuple[str, ...],
    source_file: str,
) -> OntologyRecord:
    return OntologyRecord(
        id=normalize_display_text(payload.get("id")),
        name=normalize_display_text(payload.get("name")),
        record_type=record_type,
        domains=domains,
        source_file=source_file,
        payload=payload,
    )


def load_json_object(path: Path) -> dict[str, Any]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as error:
        raise OntologyError(f"Ontology file does not exist: {path}") from error
    except json.JSONDecodeError as error:
        raise OntologyError(f"Invalid JSON in {path}: {error}") from error
    if not isinstance(payload, dict):
        raise OntologyError(f"Ontology document must be a JSON object: {path}")
    return payload


def resolve_path(root: Path, value: str | Path) -> Path:
    path = Path(value)
    return path.resolve() if path.is_absolute() else (root / path).resolve()


def resolve_manifest_path(index: OntologyIndex, value: Any) -> Path:
    if not isinstance(value, str) or not value.strip():
        raise OntologyError("Manifest file entries must be non-empty strings.")
    path = resolve_path(index.root, value)
    ensure_within_root(index.root, path, f"Manifest path escapes repository root: {value}")
    return path


def ensure_within_root(root: Path, path: Path, message: str) -> None:
    try:
        path.relative_to(root)
    except ValueError as error:
        raise OntologyError(message) from error


def relative_repo_path(root: Path, path: Path) -> str:
    try:
        return path.relative_to(root).as_posix()
    except ValueError:
        return path.as_posix()


def normalize_display_text(value: Any) -> str:
    return str(value or "").strip()


def normalize_search_text(value: Any) -> str:
    text = unicodedata.normalize("NFKC", normalize_display_text(value)).lower()
    return re.sub(r"\s+", " ", text).strip()


def compact_search_text(value: Any) -> str:
    return FUZZY_COMPACT_RE.sub("", normalize_search_text(value))


def normalize_source_refs(value: Any) -> list[dict[str, str]]:
    if not isinstance(value, list):
        return []
    result: list[dict[str, str]] = []
    for item in value:
        if not isinstance(item, dict):
            continue
        path = normalize_display_text(item.get("path"))
        if not path:
            continue
        normalized = {"path": path}
        for key in ("anchor", "note"):
            text = normalize_display_text(item.get(key))
            if text:
                normalized[key] = text
        result.append(normalized)
    return result


def flatten_strings(value: Any) -> Iterable[str]:
    if isinstance(value, str):
        yield value
    elif isinstance(value, dict):
        for nested_key, nested_value in value.items():
            yield from flatten_strings(nested_key)
            yield from flatten_strings(nested_value)
    elif isinstance(value, list):
        for item in value:
            yield from flatten_strings(item)


def query_terms(query: str) -> list[str]:
    normalized = normalize_search_text(query)
    if not normalized:
        return []
    terms = [term for term in QUERY_SPLIT_RE.split(normalized) if term]
    return list(dict.fromkeys(terms))


def raw_query_terms(query: str) -> list[str]:
    normalized = unicodedata.normalize("NFKC", normalize_display_text(query))
    if not normalized:
        return []
    result: list[str] = []
    seen: set[str] = set()
    for term in QUERY_SPLIT_RE.split(normalized):
        normalized_term = normalize_search_text(term)
        if not normalized_term or normalized_term in seen:
            continue
        seen.add(normalized_term)
        result.append(term)
    return result


def relaxed_query_terms(query: str) -> list[str]:
    terms = query_terms(query)
    if len(terms) < 2:
        return terms
    expanded: list[str] = []
    for raw_term in raw_query_terms(query):
        expanded.append(normalize_search_text(raw_term))
        expanded.extend(code_identifier_terms(raw_term))
    return list(dict.fromkeys(expanded))


def code_identifier_terms(term: str) -> list[str]:
    raw = normalize_display_text(term)
    if not raw or CJK_RUN_RE.search(raw):
        return []
    has_separator = bool(re.search(r"[_\-.]", raw))
    has_camel_boundary = bool(re.search(r"[a-z0-9][A-Z]", raw))
    has_acronym_boundary = bool(re.search(r"[A-Z]{2,}[A-Z][a-z]", raw))
    if not has_separator and not has_camel_boundary and not has_acronym_boundary:
        return []

    parts: list[str] = []
    normalized_term = normalize_search_text(raw)
    for chunk in CODE_IDENTIFIER_SPLIT_RE.split(raw):
        if not chunk:
            continue
        for part in CAMEL_BOUNDARY_RE.sub(" ", chunk).split():
            normalized_part = normalize_search_text(part)
            if len(normalized_part) >= MIN_FUZZY_TERM_LENGTH and normalized_part != normalized_term:
                parts.append(normalized_part)
    unique_parts = list(dict.fromkeys(parts))
    return unique_parts if len(unique_parts) >= 2 else []


def relaxed_minimum_matched_terms(strict_term_count: int, relaxed_term_count: int) -> int:
    if strict_term_count <= 1:
        return 1
    if strict_term_count == 2:
        return 1
    return min(RELAXED_MULTI_TERM_MIN_MATCHES, relaxed_term_count)


def search_records(
    index: OntologyIndex,
    query: str,
    *,
    record_id: str = "",
    domains: Iterable[str] = (),
    record_types: Iterable[str] = (),
    kinds: Iterable[str] = (),
    statuses: Iterable[str] = (),
    match: str = "all",
    fuzzy: bool = True,
    fuzzy_threshold: float = DEFAULT_FUZZY_THRESHOLD,
    limit: int = DEFAULT_LIMIT,
    terms_override: list[str] | None = None,
) -> list[tuple[OntologyRecord, int, list[str]]]:
    domain_filter = {normalize_search_text(value) for value in domains if normalize_search_text(value)}
    type_filter = {normalize_search_text(value) for value in record_types if normalize_search_text(value)}
    kind_filter = {normalize_search_text(value) for value in kinds if normalize_search_text(value)}
    status_filter = {normalize_search_text(value) for value in statuses if normalize_search_text(value)}
    normalized_record_id = normalize_search_text(record_id)
    terms = terms_override if terms_override is not None else query_terms(query)
    normalized_full_query = normalize_search_text(query)
    results: list[tuple[OntologyRecord, int, list[str]]] = []

    for record in index.records:
        if domain_filter and not domain_filter.intersection(normalize_search_text(value) for value in record.domains):
            continue
        if type_filter and normalize_search_text(record.record_type) not in type_filter:
            continue
        if kind_filter and normalize_search_text(record.kind) not in kind_filter:
            continue
        if status_filter and normalize_search_text(record.status) not in status_filter:
            continue
        if normalized_record_id and normalize_search_text(record.id) != normalized_record_id:
            continue

        if normalized_record_id:
            results.append((record, 10_000, [record_id]))
            continue
        if not terms:
            results.append((record, 0, []))
            continue

        score, matched_terms = score_record(
            record,
            terms,
            normalized_full_query,
            fuzzy=fuzzy,
            fuzzy_threshold=fuzzy_threshold,
        )
        if match == "all" and len(matched_terms) != len(terms):
            continue
        if match == "any" and not matched_terms:
            continue
        results.append((record, score, matched_terms))

    results.sort(key=lambda item: (-item[1], item[0].record_type, item[0].id))
    return results[: max(1, limit)]


def search_records_with_strategy(
    index: OntologyIndex,
    query: str,
    *,
    record_id: str = "",
    domains: Iterable[str] = (),
    record_types: Iterable[str] = (),
    kinds: Iterable[str] = (),
    statuses: Iterable[str] = (),
    match: str = "auto",
    fuzzy: bool = True,
    fuzzy_threshold: float = DEFAULT_FUZZY_THRESHOLD,
    limit: int = DEFAULT_LIMIT,
) -> tuple[list[tuple[OntologyRecord, int, list[str]]], SearchStrategy]:
    strict_terms = query_terms(query)
    if record_id or match in {"all", "any"}:
        results = search_records(
            index,
            query,
            record_id=record_id,
            domains=domains,
            record_types=record_types,
            kinds=kinds,
            statuses=statuses,
            match="all" if match == "auto" else match,
            fuzzy=fuzzy,
            fuzzy_threshold=fuzzy_threshold,
            limit=limit,
            terms_override=strict_terms,
        )
        strategy = SearchStrategy(
            requested_match=match,
            effective_match="all" if match == "auto" else match,
            relaxed=False,
            query_terms=strict_terms,
            relaxed_terms=strict_terms,
            minimum_matched_terms=len(strict_terms) if (match in {"auto", "all"}) else 1,
        )
        return results, strategy

    strict_results = search_records(
        index,
        query,
        domains=domains,
        record_types=record_types,
        kinds=kinds,
        statuses=statuses,
        match="all",
        fuzzy=fuzzy,
        fuzzy_threshold=fuzzy_threshold,
        limit=limit,
        terms_override=strict_terms,
    )
    if strict_results or len(strict_terms) <= 1:
        strategy = SearchStrategy(
            requested_match=match,
            effective_match="all",
            relaxed=False,
            query_terms=strict_terms,
            relaxed_terms=strict_terms,
            minimum_matched_terms=len(strict_terms),
        )
        return strict_results, strategy

    relaxed_terms = relaxed_query_terms(query)
    minimum_matched_terms = relaxed_minimum_matched_terms(len(strict_terms), len(relaxed_terms))
    relaxed_results = search_records(
        index,
        query,
        domains=domains,
        record_types=record_types,
        kinds=kinds,
        statuses=statuses,
        match="any",
        fuzzy=fuzzy,
        fuzzy_threshold=fuzzy_threshold,
        limit=max(limit * 3, limit),
        terms_override=relaxed_terms,
    )
    filtered_results = [
        item for item in relaxed_results if len(item[2]) >= minimum_matched_terms
    ][:limit]
    strategy = SearchStrategy(
        requested_match=match,
        effective_match="any" if filtered_results else "all",
        relaxed=bool(filtered_results),
        query_terms=strict_terms,
        relaxed_terms=relaxed_terms,
        minimum_matched_terms=minimum_matched_terms,
        reason="strict all-term search returned no results" if filtered_results else "",
    )
    return filtered_results, strategy


def score_record(
    record: OntologyRecord,
    terms: list[str],
    normalized_full_query: str,
    *,
    fuzzy: bool = True,
    fuzzy_threshold: float = DEFAULT_FUZZY_THRESHOLD,
) -> tuple[int, list[str]]:
    normalized_id = normalize_search_text(record.id)
    normalized_name = normalize_search_text(record.name)
    normalized_aliases = [normalize_search_text(alias) for alias in record.aliases]
    normalized_description = normalize_search_text(record.description)
    searchable_text = normalize_search_text(" ".join(flatten_strings(record.payload)))
    matched_terms: list[str] = []
    score = 0

    if normalized_full_query and normalized_full_query == normalized_id:
        score += 1_000
    if normalized_full_query and normalized_full_query == normalized_name:
        score += 900

    for term in terms:
        term_score = literal_term_score(
            term,
            normalized_id=normalized_id,
            normalized_name=normalized_name,
            normalized_aliases=normalized_aliases,
            normalized_description=normalized_description,
            searchable_text=searchable_text,
        )
        if not term_score and fuzzy:
            term_score += fuzzy_term_score(record, term, fuzzy_threshold)
        if not term_score:
            term_score += code_identifier_term_score(
                record,
                term,
                normalized_id=normalized_id,
                normalized_name=normalized_name,
                normalized_aliases=normalized_aliases,
                normalized_description=normalized_description,
                searchable_text=searchable_text,
                fuzzy=fuzzy,
                fuzzy_threshold=fuzzy_threshold,
            )
        if term_score:
            matched_terms.append(term)
            score += term_score

    if len(matched_terms) == len(terms):
        score += 80
    if record.status == "active":
        score += 5
    return score, matched_terms


def literal_term_score(
    term: str,
    *,
    normalized_id: str,
    normalized_name: str,
    normalized_aliases: list[str],
    normalized_description: str,
    searchable_text: str,
) -> int:
    term_score = 0
    if term == normalized_id:
        term_score += 300
    elif term in normalized_id:
        term_score += 150
    if term == normalized_name:
        term_score += 260
    elif term in normalized_name:
        term_score += 130
    for alias in normalized_aliases:
        if term == alias:
            term_score += 180
        elif term in alias:
            term_score += 90
    if term in normalized_description:
        term_score += 45
    occurrence_count = searchable_text.count(term)
    term_score += min(occurrence_count * 6, 36)
    return term_score


def code_identifier_term_score(
    record: OntologyRecord,
    term: str,
    *,
    normalized_id: str,
    normalized_name: str,
    normalized_aliases: list[str],
    normalized_description: str,
    searchable_text: str,
    fuzzy: bool,
    fuzzy_threshold: float,
) -> int:
    parts = code_identifier_terms(term)
    if not parts:
        return 0

    part_scores: list[int] = []
    for part in parts:
        part_score = literal_term_score(
            part,
            normalized_id=normalized_id,
            normalized_name=normalized_name,
            normalized_aliases=normalized_aliases,
            normalized_description=normalized_description,
            searchable_text=searchable_text,
        )
        if not part_score and fuzzy:
            part_score += fuzzy_term_score(record, part, fuzzy_threshold)
        if not part_score:
            return 0
        part_scores.append(min(part_score, 160))
    return max(20, round(sum(part_scores) / len(part_scores) * 0.8))


def fuzzy_term_score(
    record: OntologyRecord,
    term: str,
    threshold: float,
) -> int:
    compact_term = compact_search_text(term)
    if len(compact_term) < MIN_FUZZY_TERM_LENGTH:
        return 0

    best_score = 0
    for candidate, weight in fuzzy_candidates(record):
        similarity = fuzzy_similarity(compact_term, candidate)
        if similarity >= threshold:
            best_score = max(best_score, round(weight * similarity))
    return best_score


def fuzzy_candidates(record: OntologyRecord) -> list[tuple[str, int]]:
    candidates: dict[str, int] = {}

    def add(value: Any, weight: int, *, cjk_ngram_weight: int = 0) -> None:
        for segment in fuzzy_segments(value):
            candidates[segment] = max(candidates.get(segment, 0), weight)
        if cjk_ngram_weight:
            for segment in cjk_ngram_segments(value):
                candidates[segment] = max(candidates.get(segment, 0), cjk_ngram_weight)

    add(record.id, FUZZY_ID_SCORE)
    add(record.name, FUZZY_NAME_SCORE, cjk_ngram_weight=28)
    for alias in record.aliases:
        add(alias, FUZZY_ALIAS_SCORE, cjk_ngram_weight=24)
    add(record.description, FUZZY_DESCRIPTION_SCORE, cjk_ngram_weight=20)
    for value in flatten_strings(record.payload):
        add(value, FUZZY_PAYLOAD_SCORE, cjk_ngram_weight=12)

    return sorted(candidates.items(), key=lambda item: (-item[1], item[0]))


def fuzzy_segments(value: Any) -> Iterable[str]:
    normalized = normalize_search_text(value)
    if not normalized:
        return

    compact = compact_search_text(normalized)
    for candidate in (normalized, compact):
        if len(candidate) >= MIN_FUZZY_CANDIDATE_LENGTH:
            yield candidate

    for token in FUZZY_SEGMENT_SPLIT_RE.split(normalized):
        compact_token = compact_search_text(token)
        if len(compact_token) >= MIN_FUZZY_CANDIDATE_LENGTH:
            yield compact_token


def cjk_ngram_segments(value: Any) -> Iterable[str]:
    normalized = normalize_search_text(value)
    if not normalized:
        return
    for cjk_run in CJK_RUN_RE.findall(normalized):
        yield from cjk_ngrams(cjk_run)


def cjk_ngrams(value: str) -> Iterable[str]:
    compact = compact_search_text(value)
    for size in CJK_NGRAM_SIZES:
        if len(compact) < size:
            continue
        for start in range(0, len(compact) - size + 1):
            yield compact[start : start + size]


def fuzzy_similarity(compact_term: str, candidate: str) -> float:
    compact_candidate = compact_search_text(candidate)
    if not compact_candidate:
        return 0.0
    if compact_term == compact_candidate:
        return 1.0
    if compact_term in compact_candidate:
        return 1.0
    reverse_similarity = reverse_containment_similarity(compact_term, compact_candidate)
    if reverse_similarity:
        return reverse_similarity
    return max(
        SequenceMatcher(None, compact_term, compact_candidate).ratio(),
        fuzzy_window_similarity(compact_term, compact_candidate),
    )


def reverse_containment_similarity(compact_term: str, compact_candidate: str) -> float:
    if compact_candidate not in compact_term:
        return 0.0
    has_cjk = bool(CJK_RUN_RE.search(compact_candidate))
    if not has_cjk or len(compact_candidate) < 3:
        return 0.0
    coverage = len(compact_candidate) / max(1, len(compact_term))
    return min(0.96, 0.80 + (coverage * 0.16))


def fuzzy_window_similarity(compact_term: str, compact_candidate: str) -> float:
    term_length = len(compact_term)
    candidate_length = len(compact_candidate)
    if candidate_length <= term_length:
        return 0.0

    best = 0.0
    for start in range(0, candidate_length - term_length + 1):
        window = compact_candidate[start : start + term_length]
        best = max(best, SequenceMatcher(None, compact_term, window).ratio())
    return best


def expand_related(
    index: OntologyIndex,
    record: OntologyRecord,
    depth: int,
) -> list[dict[str, Any]]:
    if depth <= 0:
        return []
    concepts_by_id = {concept.id: concept for concept in index.concepts}
    seed_ids = record_concept_ids(record, concepts_by_id)
    if not seed_ids:
        return []

    adjacency: dict[str, list[tuple[str, OntologyRecord, str]]] = {}
    for relation in index.relations:
        source_id = normalize_display_text(relation.payload.get("from"))
        target_id = normalize_display_text(relation.payload.get("to"))
        if source_id not in concepts_by_id or target_id not in concepts_by_id:
            continue
        adjacency.setdefault(source_id, []).append((target_id, relation, "outgoing"))
        adjacency.setdefault(target_id, []).append((source_id, relation, "incoming"))

    queue: list[tuple[str, int]] = [(seed_id, 0) for seed_id in sorted(seed_ids)]
    # Cyclic graphs are finite here: each node is only revisited at a lower depth,
    # and each directed traversal edge is emitted once.
    visited_depth = {seed_id: 0 for seed_id in seed_ids}
    expanded: list[dict[str, Any]] = []
    seen_edges: set[tuple[str, str, str]] = set()

    while queue:
        current_id, current_depth = queue.pop(0)
        if current_depth >= depth:
            continue
        for neighbor_id, relation, direction in sorted(
            adjacency.get(current_id, []), key=lambda item: (item[1].id, item[0], item[2])
        ):
            edge_key = (current_id, relation.id, neighbor_id)
            if edge_key not in seen_edges:
                seen_edges.add(edge_key)
                neighbor = concepts_by_id[neighbor_id]
                expanded.append(
                    {
                        "depth": current_depth + 1,
                        "from": current_id,
                        "direction": direction,
                        "relation_id": relation.id,
                        "relation_type": normalize_display_text(relation.payload.get("type")),
                        "relation_name": relation.name,
                        "to": neighbor_id,
                        "to_name": neighbor.name,
                        "to_domain": list(neighbor.domains),
                    }
                )
            next_depth = current_depth + 1
            if next_depth < visited_depth.get(neighbor_id, depth + 1):
                visited_depth[neighbor_id] = next_depth
                queue.append((neighbor_id, next_depth))

    expanded.sort(key=lambda item: (item["depth"], item["from"], item["relation_id"], item["to"]))
    return expanded


def record_concept_ids(
    record: OntologyRecord,
    concepts_by_id: dict[str, OntologyRecord],
) -> set[str]:
    if record.record_type == "concept":
        return {record.id}
    if record.record_type == "relation":
        return {
            concept_id
            for concept_id in (
                normalize_display_text(record.payload.get("from")),
                normalize_display_text(record.payload.get("to")),
            )
            if concept_id in concepts_by_id
        }
    if record.record_type == "rule":
        values = record.payload.get("applies_to", [])
        return {value for value in values if isinstance(value, str) and value in concepts_by_id}
    if record.record_type == "workflow":
        result: set[str] = set()
        for step in record.payload.get("steps", []):
            if not isinstance(step, dict):
                continue
            for key in ("actor", "object", "result"):
                value = normalize_display_text(step.get(key))
                if value in concepts_by_id:
                    result.add(value)
        return result
    return set()


def validate_ontology(index: OntologyIndex) -> list[str]:
    issues: list[str] = []
    manifest = index.manifest
    required_manifest_fields = (
        "ontology_id",
        "name",
        "purpose",
        "version",
        "as_of",
        "format",
        "schema_file",
        "domain_files",
        "workflow_files",
        "concept_kinds",
        "relation_types",
        "record_statuses",
        "maintenance",
    )
    for field_name in required_manifest_fields:
        if field_name not in manifest:
            issues.append(f"manifest.json: missing required field '{field_name}'")

    validate_manifest_paths(index, issues)
    validate_documents(index, issues)

    seen_ids: dict[str, str] = {}
    concept_ids = {record.id for record in index.concepts if record.id}
    domain_ids = set(index.domain_ids)
    allowed_kinds = string_set(manifest.get("concept_kinds"))
    allowed_relation_types = string_set(manifest.get("relation_types"))
    allowed_statuses = string_set(manifest.get("record_statuses"))

    for record in index.records:
        location = f"{record.source_file}:{record.id or '<missing-id>'}"
        if not record.id:
            issues.append(f"{record.source_file}: {record.record_type} is missing id")
        elif record.id in seen_ids:
            issues.append(f"{location}: duplicate id; first declared in {seen_ids[record.id]}")
        else:
            seen_ids[record.id] = record.source_file

        id_pattern = DOMAIN_ID_RE if record.record_type == "domain" else RECORD_ID_RE
        if record.id and not id_pattern.fullmatch(record.id):
            issues.append(f"{location}: invalid {record.record_type} id format")
        if not record.name:
            issues.append(f"{location}: missing name")
        if not record.description:
            issues.append(f"{location}: missing description")
        if not record.status:
            issues.append(f"{location}: missing status")
        elif allowed_statuses and record.status not in allowed_statuses:
            issues.append(f"{location}: unsupported status '{record.status}'")
        validate_source_refs(index, record, issues)
        validate_implementation_paths(index, record, issues)

        if record.record_type == "concept":
            if not record.kind:
                issues.append(f"{location}: missing concept kind")
            elif allowed_kinds and record.kind not in allowed_kinds:
                issues.append(f"{location}: unsupported concept kind '{record.kind}'")
        elif record.record_type == "relation":
            validate_relation(record, concept_ids, allowed_relation_types, issues)
        elif record.record_type == "rule":
            validate_rule(record, concept_ids, issues)
        elif record.record_type == "workflow":
            validate_workflow(record, concept_ids, domain_ids, issues)

    return sorted(dict.fromkeys(issues))


def validate_manifest_paths(index: OntologyIndex, issues: list[str]) -> None:
    schema_file = index.manifest.get("schema_file")
    manifest_paths = [schema_file] if isinstance(schema_file, str) else []
    for key in ("domain_files", "workflow_files"):
        values = index.manifest.get(key)
        if not isinstance(values, list) or not values:
            issues.append(f"manifest.json: '{key}' must be a non-empty list")
            continue
        manifest_paths.extend(value for value in values if isinstance(value, str))
    for value in manifest_paths:
        try:
            path = resolve_path(index.root, value)
            ensure_within_root(index.root, path, f"manifest.json: path escapes repository root: {value}")
        except OntologyError as error:
            issues.append(str(error))
            continue
        if not path.exists():
            issues.append(f"manifest.json: referenced file does not exist: {value}")


def validate_documents(index: OntologyIndex, issues: list[str]) -> None:
    manifest_version = normalize_display_text(index.manifest.get("version"))
    for document in index.documents:
        payload = document.payload
        if normalize_display_text(payload.get("version")) != manifest_version:
            issues.append(f"{document.path}: version must match manifest version {manifest_version}")
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", normalize_display_text(payload.get("as_of"))):
            issues.append(f"{document.path}: as_of must use YYYY-MM-DD")
        schema_ref = normalize_display_text(payload.get("$schema"))
        if not schema_ref:
            issues.append(f"{document.path}: missing $schema")
            continue
        document_path = index.root / document.path
        schema_path = (document_path.parent / schema_ref).resolve()
        try:
            ensure_within_root(index.root, schema_path, f"{document.path}: $schema escapes repository root")
        except OntologyError as error:
            issues.append(str(error))
            continue
        if not schema_path.exists():
            issues.append(f"{document.path}: $schema target does not exist: {schema_ref}")


def validate_source_refs(
    index: OntologyIndex,
    record: OntologyRecord,
    issues: list[str],
) -> None:
    raw_refs = record.payload.get("source_refs")
    location = f"{record.source_file}:{record.id or '<missing-id>'}"
    if not isinstance(raw_refs, list) or not raw_refs:
        issues.append(f"{location}: source_refs must be a non-empty list")
        return
    for position, raw_ref in enumerate(raw_refs, start=1):
        if not isinstance(raw_ref, dict):
            issues.append(f"{location}: source_refs[{position}] must be an object")
            continue
        path_value = normalize_display_text(raw_ref.get("path"))
        if not path_value:
            issues.append(f"{location}: source_refs[{position}] is missing path")
            continue
        validate_repo_path(index.root, path_value, f"{location}: source_refs[{position}]", issues)


def validate_implementation_paths(
    index: OntologyIndex,
    record: OntologyRecord,
    issues: list[str],
) -> None:
    values = record.payload.get("implementation_paths", [])
    if not isinstance(values, list):
        issues.append(f"{record.source_file}:{record.id}: implementation_paths must be a list")
        return
    for position, value in enumerate(values, start=1):
        path_value = normalize_display_text(value)
        if not path_value:
            issues.append(f"{record.source_file}:{record.id}: implementation_paths[{position}] is empty")
            continue
        validate_repo_path(
            index.root,
            path_value,
            f"{record.source_file}:{record.id}: implementation_paths[{position}]",
            issues,
        )


def validate_repo_path(root: Path, value: str, label: str, issues: list[str]) -> None:
    path = resolve_path(root, value)
    try:
        ensure_within_root(root, path, f"{label} escapes repository root: {value}")
    except OntologyError as error:
        issues.append(str(error))
        return
    if not path.exists():
        issues.append(f"{label} does not exist: {value}")


def validate_relation(
    record: OntologyRecord,
    concept_ids: set[str],
    allowed_relation_types: set[str],
    issues: list[str],
) -> None:
    location = f"{record.source_file}:{record.id}"
    source_id = normalize_display_text(record.payload.get("from"))
    target_id = normalize_display_text(record.payload.get("to"))
    relation_type = normalize_display_text(record.payload.get("type"))
    cardinality = normalize_display_text(record.payload.get("cardinality"))
    if source_id not in concept_ids:
        issues.append(f"{location}: relation from references unknown concept '{source_id}'")
    if target_id not in concept_ids:
        issues.append(f"{location}: relation to references unknown concept '{target_id}'")
    if relation_type not in allowed_relation_types:
        issues.append(f"{location}: unsupported relation type '{relation_type}'")
    if not cardinality:
        issues.append(f"{location}: missing cardinality")


def validate_rule(record: OntologyRecord, concept_ids: set[str], issues: list[str]) -> None:
    location = f"{record.source_file}:{record.id}"
    targets = record.payload.get("applies_to")
    if not isinstance(targets, list) or not targets:
        issues.append(f"{location}: applies_to must be a non-empty list")
        return
    for target in targets:
        if not isinstance(target, str) or target not in concept_ids:
            issues.append(f"{location}: applies_to references unknown concept '{target}'")


def validate_workflow(
    record: OntologyRecord,
    concept_ids: set[str],
    domain_ids: set[str],
    issues: list[str],
) -> None:
    location = f"{record.source_file}:{record.id}"
    domains = record.payload.get("domains")
    if not isinstance(domains, list) or len(domains) < 2:
        issues.append(f"{location}: domains must contain at least two domain IDs")
    else:
        for domain in domains:
            if not isinstance(domain, str) or domain not in domain_ids:
                issues.append(f"{location}: unknown workflow domain '{domain}'")
    steps = record.payload.get("steps")
    if not isinstance(steps, list) or len(steps) < 2:
        issues.append(f"{location}: steps must contain at least two entries")
        return
    expected_orders = list(range(1, len(steps) + 1))
    actual_orders = [step.get("order") if isinstance(step, dict) else None for step in steps]
    if actual_orders != expected_orders:
        issues.append(f"{location}: step order must be contiguous starting at 1")
    for position, step in enumerate(steps, start=1):
        if not isinstance(step, dict):
            issues.append(f"{location}: steps[{position}] must be an object")
            continue
        if not normalize_display_text(step.get("action")):
            issues.append(f"{location}: steps[{position}] is missing action")
        for key in ("actor", "object", "result"):
            value = normalize_display_text(step.get(key))
            if value not in concept_ids:
                issues.append(f"{location}: steps[{position}].{key} references unknown concept '{value}'")


def string_set(value: Any) -> set[str]:
    if not isinstance(value, list):
        return set()
    return {normalize_display_text(item) for item in value if normalize_display_text(item)}


def record_to_dict(
    record: OntologyRecord,
    score: int,
    matched_terms: list[str],
    related: list[dict[str, Any]],
    show_record: bool,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "id": record.id,
        "name": record.name,
        "record_type": record.record_type,
        "kind": record.kind,
        "status": record.status,
        "domains": list(record.domains),
        "description": record.description,
        "aliases": record.aliases,
        "score": score,
        "matched_terms": matched_terms,
        "source_file": record.source_file,
        "source_refs": record.source_refs,
        "related": related,
    }
    if show_record:
        payload["record"] = record.payload
    return payload


def render_source_ref(source_ref: dict[str, str]) -> str:
    result = source_ref["path"]
    if source_ref.get("anchor"):
        result += f"#{source_ref['anchor']}"
    if source_ref.get("note"):
        result += f" ({source_ref['note']})"
    return result


def print_human_results(
    results: list[dict[str, Any]],
    *,
    query: str,
    record_id: str,
    strategy: SearchStrategy,
) -> None:
    label = f"id={record_id}" if record_id else f"query={query!r}"
    print(f"[ontology] {label}; results={len(results)}")
    if strategy.relaxed:
        print(
            "[ontology] strict all-term search returned no results; "
            f"relaxed to any-term search with at least {strategy.minimum_matched_terms} matched terms."
        )
    if not results:
        print("No matching ontology records.")
        return
    for position, result in enumerate(results, start=1):
        domains = ", ".join(result["domains"]) or "-"
        print(
            f"{position}. [{result['record_type']}/{result['kind']}] "
            f"{result['id']} | {result['name']} | domain={domains} | score={result['score']}"
        )
        print(f"   {result['description']}")
        if result["aliases"]:
            print(f"   aliases: {', '.join(result['aliases'])}")
        if result["source_refs"]:
            print(f"   sources: {'; '.join(render_source_ref(ref) for ref in result['source_refs'])}")
        if result["related"]:
            print("   related:")
            for related in result["related"][:20]:
                arrow = "->" if related["direction"] == "outgoing" else "<-"
                print(
                    f"   - d{related['depth']} {related['from']} {arrow} "
                    f"[{related['relation_type']}] {related['to']} ({related['to_name']})"
                )
            if len(result["related"]) > 20:
                print(f"   - ... {len(result['related']) - 20} more related edges")
        if "record" in result:
            print(json.dumps(result["record"], ensure_ascii=False, indent=2, sort_keys=True))


def validation_summary(index: OntologyIndex, issues: list[str]) -> dict[str, Any]:
    counts = {record_type: 0 for record_type in VALID_RECORD_TYPES}
    for record in index.records:
        counts[record.record_type] = counts.get(record.record_type, 0) + 1
    return {
        "valid": not issues,
        "issue_count": len(issues),
        "issues": issues,
        "counts": counts,
        "document_count": len(index.documents),
    }


def ontology_status_report(index: OntologyIndex) -> dict[str, Any]:
    counts = {record_type: 0 for record_type in VALID_RECORD_TYPES}
    for record in index.records:
        counts[record.record_type] = counts.get(record.record_type, 0) + 1

    domain_ids = set(index.domain_ids)
    non_harness_domain_ids = sorted(domain_id for domain_id in domain_ids if domain_id != HARNESS_DOMAIN_ID)
    non_harness_records = [
        record
        for record in index.records
        if record.record_type != "domain" and HARNESS_DOMAIN_ID not in set(record.domains)
    ]
    business_concepts = [
        record
        for record in index.concepts
        if HARNESS_DOMAIN_ID not in set(record.domains)
    ]
    placeholder_records = [
        record
        for record in non_harness_records
        if record.id.startswith(SCAFFOLD_PLACEHOLDER_PREFIX)
        or SCAFFOLD_PLACEHOLDER_DOMAIN_ID in set(record.domains)
    ]
    missing_domain_files = not isinstance(index.manifest.get("domain_files"), list) or not index.manifest.get("domain_files")
    missing_workflow_files = (
        not isinstance(index.manifest.get("workflow_files"), list) or not index.manifest.get("workflow_files")
    )
    empty = missing_domain_files or counts["domain"] == 0 or counts["concept"] == 0
    placeholder_only = bool(non_harness_records) and len(placeholder_records) == len(non_harness_records)
    no_project_business = not business_concepts
    needs_initialization = empty or placeholder_only or no_project_business

    reasons: list[str] = []
    if missing_domain_files:
        reasons.append("manifest.json 缺少有效 domain_files")
    if missing_workflow_files:
        reasons.append("manifest.json 缺少有效 workflow_files")
    if counts["domain"] == 0:
        reasons.append("没有 domain 记录")
    if counts["concept"] == 0:
        reasons.append("没有 concept 记录")
    if placeholder_only:
        reasons.append("非 harness 记录仍是 scaffold `project.*` 占位")
    if no_project_business and not empty and not placeholder_only:
        reasons.append("没有非 harness 业务概念")
    if not reasons:
        reasons.append("已存在项目业务 ontology")

    return {
        "needs_initialization": needs_initialization,
        "empty": empty,
        "placeholder_only": placeholder_only,
        "business_domain_ids": non_harness_domain_ids,
        "counts": counts,
        "reasons": reasons,
        "recommended_source_paths": [
            "README.md",
            "ARCHITECTURE.md",
            ".ch/docs/product-specs/",
            ".ch/docs/TESTING.md",
            "docs/",
            "src/",
        ],
        "next_steps": [
            "先阅读 existing source paths，提取 5-12 个稳定业务概念、关键关系、规则和核心流程。",
            "替换 scaffold `project.*` 占位或新增最贴近业务边界的 domains/*.json。",
            "更新 manifest.json 的 domain_files / workflow_files，并为每条记录保留可核对 source_refs。",
            "运行 `python3 .agents/skills/ontology/scripts/search_ontology.py --validate`。",
        ],
    }


def print_status_report(index: OntologyIndex, as_json: bool) -> None:
    report = ontology_status_report(index)
    if as_json:
        print(json.dumps({"status": report}, ensure_ascii=False, indent=2, sort_keys=True))
        return
    status = "needs-initialization" if report["needs_initialization"] else "ready"
    print(f"[ontology] status={status}")
    print(f"- empty: {str(report['empty']).lower()}")
    print(f"- placeholder_only: {str(report['placeholder_only']).lower()}")
    print(f"- business_domain_ids: {', '.join(report['business_domain_ids']) or '-'}")
    print(f"- counts: {report['counts']}")
    print("- reasons:")
    for reason in report["reasons"]:
        print(f"  - {reason}")
    if report["needs_initialization"]:
        print("- next_steps:")
        for step in report["next_steps"]:
            print(f"  - {step}")


def print_domain_list(index: OntologyIndex, as_json: bool) -> None:
    domains = []
    for record in sorted(
        (record for record in index.records if record.record_type == "domain"),
        key=lambda item: item.id,
    ):
        domains.append(
            {
                "id": record.id,
                "name": record.name,
                "description": record.description,
                "source_file": record.source_file,
            }
        )
    if as_json:
        print(json.dumps({"domains": domains}, ensure_ascii=False, indent=2, sort_keys=True))
        return
    print(f"[ontology] domains={len(domains)}")
    for domain in domains:
        print(f"- {domain['id']}: {domain['name']} | {domain['description']}")


def print_type_list(index: OntologyIndex, as_json: bool) -> None:
    payload = {
        "record_types": list(VALID_RECORD_TYPES),
        "concept_kinds": sorted(string_set(index.manifest.get("concept_kinds"))),
        "relation_types": sorted(string_set(index.manifest.get("relation_types"))),
        "record_statuses": sorted(string_set(index.manifest.get("record_statuses"))),
    }
    if as_json:
        print(json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True))
        return
    for key, values in payload.items():
        print(f"{key}: {', '.join(values)}")


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    if args.related < 0:
        print("--related must be >= 0", file=sys.stderr)
        return 2
    if args.limit <= 0:
        print("--limit must be > 0", file=sys.stderr)
        return 2
    if not 0 < args.fuzzy_threshold <= 1:
        print("--fuzzy-threshold must be > 0 and <= 1", file=sys.stderr)
        return 2

    try:
        index = load_ontology(Path(args.root), args.ontology_dir)
    except OntologyError as error:
        print(f"[{GENERATOR_NAME}] {error}", file=sys.stderr)
        return 2

    if args.list_domains:
        print_domain_list(index, args.json)
        return 0
    if args.list_types:
        print_type_list(index, args.json)
        return 0
    if args.status_report:
        print_status_report(index, args.json)
        return 0

    issues = validate_ontology(index) if args.validate else []
    query = normalize_display_text(args.query_option) or " ".join(args.query).strip()
    has_search = bool(query or args.record_id)

    if args.validate and not has_search:
        summary = validation_summary(index, issues)
        if args.json:
            print(json.dumps({"validation": summary}, ensure_ascii=False, indent=2, sort_keys=True))
        elif issues:
            print(f"[ontology] validation failed: {len(issues)} issue(s)")
            for issue in issues:
                print(f"- {issue}")
        else:
            counts = summary["counts"]
            print(
                "[ontology] validation passed: "
                f"domains={counts['domain']} concepts={counts['concept']} "
                f"relations={counts['relation']} rules={counts['rule']} "
                f"workflows={counts['workflow']} documents={summary['document_count']}"
            )
        return 1 if issues else 0

    if not has_search:
        print(
            "Provide a query, --id, --validate, --list-domains, --list-types, or --status-report.",
            file=sys.stderr,
        )
        return 2

    raw_results, strategy = search_records_with_strategy(
        index,
        query,
        record_id=args.record_id or "",
        domains=args.domain,
        record_types=args.record_types,
        kinds=args.kind,
        statuses=args.status,
        match=args.match,
        fuzzy=args.fuzzy,
        fuzzy_threshold=args.fuzzy_threshold,
        limit=args.limit,
    )
    results = [
        record_to_dict(
            record,
            score,
            matched_terms,
            expand_related(index, record, args.related),
            args.show_record,
        )
        for record, score, matched_terms in raw_results
    ]

    if args.json:
        payload: dict[str, Any] = {
            "generator": GENERATOR_NAME,
            "version": GENERATOR_VERSION,
            "ontology_id": index.manifest.get("ontology_id"),
            "ontology_version": index.manifest.get("version"),
            "query": query,
            "record_id": args.record_id or "",
            "filters": {
                "domains": args.domain,
                "record_types": args.record_types,
                "kinds": args.kind,
                "statuses": args.status,
                "match": args.match,
                "fuzzy": args.fuzzy,
                "fuzzy_threshold": args.fuzzy_threshold,
            },
            "search_strategy": strategy.to_dict(),
            "count": len(results),
            "results": results,
        }
        if args.validate:
            payload["validation"] = validation_summary(index, issues)
        print(json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True))
    else:
        if args.validate:
            if issues:
                print(f"[ontology] validation failed before search: {len(issues)} issue(s)")
                for issue in issues:
                    print(f"- {issue}")
            else:
                print("[ontology] validation passed")
        print_human_results(results, query=query, record_id=args.record_id or "", strategy=strategy)
    return 1 if issues else 0


if __name__ == "__main__":
    raise SystemExit(main())
