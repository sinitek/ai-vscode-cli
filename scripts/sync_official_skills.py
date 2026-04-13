#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
import zipfile
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

ROOT = Path(__file__).resolve().parents[1]
MEDIA_DIR = ROOT / "media"
OFFICIAL_SKILLS_DIR = MEDIA_DIR / "official-skills"
CATALOG_PATH = MEDIA_DIR / "official_skills_catalog.json"

PLATFORMS = ("claude", "codex", "gemini")
PLATFORM_DEFAULTS: Dict[str, Dict[str, str]] = {
    "claude": {
        "group": "example-skills",
        "groupDescription": "示例技能集合，展示技能创建、MCP 构建、视觉设计、算法艺术、内部沟通、Web 测试、制品构建、Slack GIF 和主题样式等多种能力",
    },
    "codex": {
        "group": "curated",
        "groupDescription": "可通过官方 `$skill-installer` 工作流安装的 OpenAI curated skills。",
    },
    "gemini": {
        "group": "extensions",
        "groupDescription": "Google Gemini CLI 官方 Extensions，可直接安装到 `~/.gemini/extensions`。",
    },
}
MANUAL_ITEM_OVERRIDES: Dict[Tuple[str, str], Dict[str, str]] = {
    (
        "codex",
        "cli-creator",
    ): {
        "name": "cli-creator",
        "description": "基于 API 文档、OpenAPI 规范、现有 curl 示例、SDK、Web 应用、管理工具或本地脚本，为 Codex 构建可组合的 CLI。适用于希望 Codex 创建可在任意仓库通过命令名运行、提供可组合读写命令、返回稳定 JSON、管理鉴权，并可配套 companion skill 的命令行工具场景。",
        "group": "curated",
        "groupDescription": "可通过官方 `$skill-installer` 工作流安装的 OpenAI curated skills。",
        "installFolderName": "cli-creator",
        "sourceRepo": "openai/skills",
        "sourcePath": "skills/.curated/cli-creator",
    },
}
PLATFORM_NOTES_SUFFIX = "sourceRef 使用上游 codeload tarball 的 ETag，便于配置页识别内置官方包是否可更新。"
VALIDATION_FILE_BY_PLATFORM = {
    "claude": "SKILL.md",
    "codex": "SKILL.md",
    "gemini": "gemini-extension.json",
}
DOWNLOAD_HEAD_TIMEOUT_SECONDS = 30
DOWNLOAD_MAX_TIME_SECONDS = 90
DOWNLOAD_ATTEMPTS = 4
GIT_CLONE_TIMEOUT_SECONDS = 300


class SyncError(RuntimeError):
    pass


class SeedLookup:
    def __init__(
        self,
        *,
        by_platform_name: Dict[Tuple[str, str], Dict[str, Any]],
        by_platform_repo_path: Dict[Tuple[str, str, str], Dict[str, Any]],
        by_platform_install_dir: Dict[Tuple[str, str], Dict[str, Any]],
        platform_meta: Dict[str, Dict[str, Any]],
    ) -> None:
        self.by_platform_name = by_platform_name
        self.by_platform_repo_path = by_platform_repo_path
        self.by_platform_install_dir = by_platform_install_dir
        self.platform_meta = platform_meta


def parse_args(argv: Sequence[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Sync bundled official skills/extensions snapshots.")
    parser.add_argument(
        "--refresh-gemini",
        action="store_true",
        help="强制尝试重新抓取 Gemini 官方 extensions；失败时会尽量回退到仓库内现有快照。",
    )
    parser.add_argument(
        "--only",
        nargs="+",
        choices=PLATFORMS,
        help="只刷新指定平台；未指定的平台沿用当前 catalog 快照。",
    )
    return parser.parse_args(list(argv))


def run_command(
    args: List[str],
    *,
    cwd: Optional[Path] = None,
    timeout_seconds: Optional[int] = None,
) -> str:
    try:
        result = subprocess.run(
            args,
            cwd=str(cwd) if cwd else None,
            capture_output=True,
            text=True,
            timeout=timeout_seconds,
        )
    except subprocess.TimeoutExpired as error:
        raise SyncError(f"Command timed out after {timeout_seconds}s: {' '.join(args)}") from error
    if result.returncode != 0:
        raise SyncError(
            f"Command failed ({result.returncode}): {' '.join(args)}\n{result.stdout}\n{result.stderr}".strip()
        )
    return result.stdout


def run_command_result(
    args: List[str],
    *,
    cwd: Optional[Path] = None,
    timeout_seconds: Optional[int] = None,
) -> subprocess.CompletedProcess[str]:
    try:
        return subprocess.run(
            args,
            cwd=str(cwd) if cwd else None,
            capture_output=True,
            text=True,
            timeout=timeout_seconds,
        )
    except subprocess.TimeoutExpired as error:
        raise SyncError(f"Command timed out after {timeout_seconds}s: {' '.join(args)}") from error


def http_head(url: str) -> Optional[Dict[str, str]]:
    result = subprocess.run(
        ["curl", "-sSIL", "--max-time", str(DOWNLOAD_HEAD_TIMEOUT_SECONDS), url],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        return None
    header_blocks = [block for block in result.stdout.split("\r\n\r\n") if block.strip()]
    if not header_blocks:
        return None
    lines = [line for line in header_blocks[-1].splitlines() if line.strip()]
    if not lines:
        return None
    status_line = lines[0]
    match = re.search(r"\s(\d{3})\s", status_line + " ")
    if not match:
        return None
    status = int(match.group(1))
    headers: Dict[str, str] = {":status": str(status)}
    for line in lines[1:]:
        if ":" not in line:
            continue
        key, value = line.split(":", 1)
        headers[key.strip().lower()] = value.strip()
    return headers


def format_command_error(args: List[str], result: subprocess.CompletedProcess[str]) -> str:
    return f"Command failed ({result.returncode}): {' '.join(args)}\n{result.stdout}\n{result.stderr}".strip()


def download_file(url: str, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.exists() and destination.stat().st_size == 0:
        destination.unlink()

    last_error: Optional[str] = None
    for attempt in range(1, DOWNLOAD_ATTEMPTS + 1):
        args = [
            "curl",
            "-sSL",
            "--fail",
            "--show-error",
            "--retry",
            "2",
            "--retry-delay",
            "2",
            "--retry-all-errors",
            "--max-time",
            str(DOWNLOAD_MAX_TIME_SECONDS),
        ]
        if destination.exists() and destination.stat().st_size > 0:
            args.extend(["-C", "-"])
        args.extend(["-o", str(destination), url])
        result = run_command_result(args)
        if result.returncode == 0:
            return
        size = destination.stat().st_size if destination.exists() else 0
        last_error = format_command_error(args, result)
        if attempt < DOWNLOAD_ATTEMPTS:
            print(
                f"[warn] Download attempt {attempt}/{DOWNLOAD_ATTEMPTS} failed for {url}; partial_size={size} bytes. Retrying...",
                file=sys.stderr,
                flush=True,
            )
            continue
    raise SyncError(last_error or f"Failed to download {url}")


def normalize_ref(value: str) -> str:
    cleaned = value.strip().strip('"')
    if not cleaned:
        raise SyncError("Missing source ref/etag from upstream archive.")
    return f"etag:{cleaned}"


def resolve_repo_tarball(repo: str) -> Tuple[str, str, str]:
    for branch in ("main", "master"):
        url = f"https://codeload.github.com/{repo}/tar.gz/refs/heads/{branch}"
        headers = http_head(url)
        if not headers or headers.get(":status") != "200":
            continue
        etag = headers.get("etag")
        if not etag:
            raise SyncError(f"Upstream archive missing etag header: {url}")
        return branch, url, normalize_ref(etag)
    raise SyncError(f"Unable to resolve codeload tarball for {repo} (tried main/master).")


def extract_tarball(tarball_path: Path, destination: Path) -> Path:
    destination.mkdir(parents=True, exist_ok=True)
    with tarfile.open(tarball_path, "r:gz") as archive:
        archive.extractall(destination)
    entries = [path for path in destination.iterdir() if path.is_dir()]
    if len(entries) != 1:
        raise SyncError(f"Expected one extracted root in {destination}, found {len(entries)}")
    return entries[0]


def clone_repo_snapshot(repo: str, branch: str, destination: Path) -> Path:
    parent = destination.parent
    parent.mkdir(parents=True, exist_ok=True)
    clone_url = f"https://github.com/{repo}.git"
    run_command(
        ["git", "clone", "--depth", "1", "--single-branch", "--branch", branch, clone_url, str(destination)],
        timeout_seconds=GIT_CLONE_TIMEOUT_SECONDS,
    )
    git_dir = destination / ".git"
    if git_dir.exists():
        shutil.rmtree(git_dir)
    return destination


def fetch_repo_snapshot(repo: str, branch: str, archive_url: str, temp_path: Path, *, allow_git_fallback: bool) -> Tuple[Path, str]:
    try:
        tarball_path = temp_path / "repo.tar.gz"
        extracted_dir = temp_path / "extract"
        download_file(archive_url, tarball_path)
        return extract_tarball(tarball_path, extracted_dir), "tarball"
    except SyncError as archive_error:
        if not allow_git_fallback:
            raise
        print(
            f"[warn] Tarball download failed for {repo}, falling back to shallow git clone: {archive_error}",
            file=sys.stderr,
            flush=True,
        )
        clone_root = temp_path / "clone"
        return clone_repo_snapshot(repo, branch, clone_root), "git"


def zip_directory(source_dir: Path, zip_path: Path) -> None:
    zip_path.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for current_root, dir_names, file_names in os.walk(source_dir):
            current_path = Path(current_root)
            dir_names.sort()
            file_names.sort()
            relative_root = current_path.relative_to(source_dir.parent)
            if not file_names and not dir_names:
                archive.writestr(str(relative_root).replace(os.sep, "/") + "/", "")
                continue
            for file_name in file_names:
                file_path = current_path / file_name
                arc_name = str(relative_root / file_name).replace(os.sep, "/")
                archive.write(file_path, arc_name)


def ensure_validation_file(platform: str, skill_root: Path) -> None:
    validation = skill_root / VALIDATION_FILE_BY_PLATFORM[platform]
    if not validation.exists():
        raise SyncError(f"Missing validation file for {platform}: {validation}")


def load_existing_catalog() -> Dict[str, Any]:
    if not CATALOG_PATH.exists():
        raise SyncError(f"Missing current catalog: {CATALOG_PATH}")
    return json.loads(CATALOG_PATH.read_text(encoding="utf-8"))


def build_seed_lookup(catalog: Dict[str, Any]) -> SeedLookup:
    by_platform_name: Dict[Tuple[str, str], Dict[str, Any]] = {}
    by_platform_repo_path: Dict[Tuple[str, str, str], Dict[str, Any]] = {}
    by_platform_install_dir: Dict[Tuple[str, str], Dict[str, Any]] = {}
    for item in catalog.get("skills", []):
        platform = str(item["platform"])
        by_platform_name[(platform, str(item["name"]))] = item
        by_platform_repo_path[(platform, str(item["sourceRepo"]), str(item["sourcePath"]))] = item
        by_platform_install_dir[(platform, str(item["installFolderName"]))] = item
    return SeedLookup(
        by_platform_name=by_platform_name,
        by_platform_repo_path=by_platform_repo_path,
        by_platform_install_dir=by_platform_install_dir,
        platform_meta=dict(catalog.get("platforms", {})),
    )


def seed_for_item(
    lookup: SeedLookup,
    platform: str,
    source_repo: str,
    source_path: str,
    install_folder_name: str,
    item_name: str,
) -> Optional[Dict[str, Any]]:
    return (
        lookup.by_platform_repo_path.get((platform, source_repo, source_path))
        or lookup.by_platform_install_dir.get((platform, install_folder_name))
        or lookup.by_platform_name.get((platform, item_name))
    )


def get_item_metadata(
    lookup: SeedLookup,
    *,
    platform: str,
    source_repo: str,
    source_path: str,
    install_folder_name: str,
    item_name: str,
) -> Dict[str, str]:
    seed = seed_for_item(lookup, platform, source_repo, source_path, install_folder_name, item_name)
    override = MANUAL_ITEM_OVERRIDES.get((platform, item_name), {})
    group = str(override.get("group") or (seed or {}).get("group") or PLATFORM_DEFAULTS[platform]["group"])
    group_description = str(
        override.get("groupDescription")
        or (seed or {}).get("groupDescription")
        or PLATFORM_DEFAULTS[platform]["groupDescription"]
    )
    display_name = str(override.get("name") or (seed or {}).get("name") or item_name)
    install_dir = str(override.get("installFolderName") or (seed or {}).get("installFolderName") or install_folder_name)
    description = override.get("description") or (seed or {}).get("description")
    if not description:
        raise SyncError(
            f"Missing Chinese description for {platform}:{item_name}. Add it to MANUAL_ITEM_OVERRIDES or seed catalog first."
        )
    return {
        "group": group,
        "groupDescription": group_description,
        "name": display_name,
        "description": str(description),
        "installFolderName": install_dir,
    }


def build_platform_meta(seed_meta: Dict[str, Any], ref: str, *, notes_suffix: str = PLATFORM_NOTES_SUFFIX) -> Dict[str, str]:
    notes = str(seed_meta.get("notes") or "")
    if notes_suffix not in notes:
        notes = f"{notes} {notes_suffix}".strip()
    return {
        "repo": str(seed_meta.get("repo") or ""),
        "ref": ref,
        "sourceUrl": str(seed_meta.get("sourceUrl") or ""),
        "installRootHint": str(seed_meta.get("installRootHint") or ""),
        "notes": notes,
    }


def remove_stale_archives(platform_root: Path, expected_files: Iterable[Path]) -> None:
    expected_names = {path.name for path in expected_files}
    if not platform_root.exists():
        return
    for existing in platform_root.glob("*.zip"):
        if existing.name not in expected_names:
            existing.unlink()


def sha256_of_refs(pairs: Iterable[Tuple[str, str]]) -> str:
    payload = "\n".join(f"{repo}={ref}" for repo, ref in sorted(pairs))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()[:16]


def clone_seed_platform_items(seed_catalog: Dict[str, Any], platform: str) -> Tuple[List[Dict[str, Any]], str]:
    items = [dict(item) for item in seed_catalog.get("skills", []) if item.get("platform") == platform]
    if not items:
        raise SyncError(f"Seed catalog does not contain {platform} items to reuse.")
    for item in items:
        archive_path = MEDIA_DIR / str(item["archivePath"])
        if not archive_path.exists():
            raise SyncError(f"Missing seeded archive: {archive_path}")
    platform_meta = seed_catalog.get("platforms", {}).get(platform) or {}
    fallback_ref = f"snapshot:{sha256_of_refs((str(item['sourceRepo']), str(item['sourceRef'])) for item in items)}"
    return sorted(items, key=lambda item: str(item["name"]).lower()), str(platform_meta.get("ref") or fallback_ref)


def sync_codex_or_claude(platform: str, repo: str, source_root: str, lookup: SeedLookup, output_root: Path) -> Tuple[List[Dict[str, Any]], str]:
    branch, archive_url, ref = resolve_repo_tarball(repo)
    with tempfile.TemporaryDirectory(prefix=f"sinitek-{platform}-") as temp_dir:
        temp_path = Path(temp_dir)
        extracted_root, fetch_method = fetch_repo_snapshot(repo, branch, archive_url, temp_path, allow_git_fallback=False)
        print(f"[{platform}] source snapshot fetched via {fetch_method}", flush=True)
        entry_root = extracted_root / source_root
        if not entry_root.exists():
            raise SyncError(f"Missing upstream source directory: {entry_root}")
        items: List[Dict[str, Any]] = []
        written_archives: List[Path] = []
        platform_output = output_root / platform
        platform_output.mkdir(parents=True, exist_ok=True)
        for entry in sorted(path for path in entry_root.iterdir() if path.is_dir()):
            item_name = entry.name
            source_path = f"{source_root}/{item_name}"
            metadata = get_item_metadata(
                lookup,
                platform=platform,
                source_repo=repo,
                source_path=source_path,
                install_folder_name=item_name,
                item_name=item_name,
            )
            ensure_validation_file(platform, entry)
            archive_path = platform_output / f"{metadata['installFolderName']}.zip"
            zip_directory(entry, archive_path)
            written_archives.append(archive_path)
            items.append(
                {
                    "id": f"{platform}:{metadata['name']}",
                    "platform": platform,
                    "group": metadata["group"],
                    "groupDescription": metadata["groupDescription"],
                    "name": metadata["name"],
                    "description": metadata["description"],
                    "archivePath": f"official-skills/{platform}/{archive_path.name}",
                    "installFolderName": metadata["installFolderName"],
                    "sourceRepo": repo,
                    "sourceRef": ref,
                    "sourcePath": source_path,
                    "sourceUrl": f"https://github.com/{repo}/tree/{branch}/{source_path}",
                }
            )
        remove_stale_archives(OFFICIAL_SKILLS_DIR / platform, written_archives)
        return items, ref


def collect_gemini_repos(catalog: Dict[str, Any]) -> List[str]:
    repos = {str(item["sourceRepo"]) for item in catalog.get("skills", []) if item.get("platform") == "gemini"}
    override_repos = {
        value["sourceRepo"]
        for (platform, _), value in MANUAL_ITEM_OVERRIDES.items()
        if platform == "gemini" and value.get("sourceRepo")
    }
    return sorted(repos | override_repos)


def sync_gemini(lookup: SeedLookup, seed_catalog: Dict[str, Any], output_root: Path) -> Tuple[List[Dict[str, Any]], str]:
    items: List[Dict[str, Any]] = []
    written_archives: List[Path] = []
    resolved_refs: List[Tuple[str, str]] = []
    platform_output = output_root / "gemini"
    platform_output.mkdir(parents=True, exist_ok=True)
    repos = collect_gemini_repos(seed_catalog)
    stats = {"tarball": 0, "git": 0, "reused": 0}

    for index, repo in enumerate(repos, start=1):
        print(f"[gemini {index}/{len(repos)}] refreshing {repo}...", flush=True)
        branch, archive_url, latest_ref = resolve_repo_tarball(repo)
        repo_name = repo.split("/", 1)[1]
        seed = seed_for_item(lookup, "gemini", repo, ".", repo_name, repo_name)
        display_name = str(seed.get("name") if seed else repo_name)
        install_folder_name = str(seed.get("installFolderName") if seed else repo_name)
        metadata = get_item_metadata(
            lookup,
            platform="gemini",
            source_repo=repo,
            source_path=".",
            install_folder_name=install_folder_name,
            item_name=display_name,
        )
        archive_path = platform_output / f"{metadata['installFolderName']}.zip"
        existing_archive = MEDIA_DIR / (
            str(seed.get("archivePath")) if seed and seed.get("archivePath") else f"official-skills/gemini/{archive_path.name}"
        )
        item_ref = latest_ref
        item_source_url = f"https://github.com/{repo}/tree/{branch}"

        try:
            with tempfile.TemporaryDirectory(prefix="sinitek-gemini-") as temp_dir:
                temp_path = Path(temp_dir)
                extracted_root, fetch_method = fetch_repo_snapshot(
                    repo,
                    branch,
                    archive_url,
                    temp_path,
                    allow_git_fallback=True,
                )
                ensure_validation_file("gemini", extracted_root)
                renamed_root = temp_path / metadata["installFolderName"]
                if renamed_root.exists():
                    shutil.rmtree(renamed_root)
                shutil.copytree(extracted_root, renamed_root)
                zip_directory(renamed_root, archive_path)
                stats[fetch_method] += 1
                print(f"[gemini {index}/{len(repos)}] {repo} refreshed via {fetch_method}", flush=True)
        except SyncError as error:
            if not seed or not existing_archive.exists():
                raise
            if existing_archive.resolve() != archive_path.resolve():
                shutil.copy2(existing_archive, archive_path)
            item_ref = str(seed.get("sourceRef") or latest_ref)
            item_source_url = str(seed.get("sourceUrl") or item_source_url)
            stats["reused"] += 1
            print(f"[warn] Reusing existing Gemini archive for {repo}: {error}", file=sys.stderr, flush=True)

        resolved_refs.append((repo, item_ref))
        written_archives.append(archive_path)
        items.append(
            {
                "id": f"gemini:{metadata['name']}",
                "platform": "gemini",
                "group": metadata["group"],
                "groupDescription": metadata["groupDescription"],
                "name": metadata["name"],
                "description": metadata["description"],
                "archivePath": f"official-skills/gemini/{archive_path.name}",
                "installFolderName": metadata["installFolderName"],
                "sourceRepo": repo,
                "sourceRef": item_ref,
                "sourcePath": ".",
                "sourceUrl": item_source_url,
            }
        )

    remove_stale_archives(OFFICIAL_SKILLS_DIR / "gemini", written_archives)
    snapshot_ref = f"snapshot:{sha256_of_refs(resolved_refs)}"
    print(f"[gemini] refresh summary: tarball={stats['tarball']}, git={stats['git']}, reused={stats['reused']}", flush=True)
    return sorted(items, key=lambda item: str(item["name"]).lower()), snapshot_ref


def validate_catalog(catalog: Dict[str, Any]) -> None:
    skills = catalog.get("skills")
    if not isinstance(skills, list) or not skills:
        raise SyncError("Generated catalog has no skills.")
    seen_ids = set()
    for item in skills:
        item_id = str(item["id"])
        if item_id in seen_ids:
            raise SyncError(f"Duplicate catalog id: {item_id}")
        seen_ids.add(item_id)
        archive_path = MEDIA_DIR / str(item["archivePath"])
        if not archive_path.exists():
            raise SyncError(f"Missing generated archive: {archive_path}")
        validation_name = VALIDATION_FILE_BY_PLATFORM[str(item["platform"])]
        with zipfile.ZipFile(archive_path, "r") as archive:
            names = archive.namelist()
            if not any(name.endswith(f"/{validation_name}") for name in names):
                raise SyncError(f"Archive missing validation entry */{validation_name}: {archive_path}")


def main(argv: Sequence[str]) -> int:
    args = parse_args(argv)
    selected_platforms = tuple(args.only) if args.only else PLATFORMS
    seed_catalog = load_existing_catalog()
    lookup = build_seed_lookup(seed_catalog)
    output_root = OFFICIAL_SKILLS_DIR
    output_root.mkdir(parents=True, exist_ok=True)

    platform_results: Dict[str, Tuple[List[Dict[str, Any]], str]] = {}

    for platform in PLATFORMS:
        if platform not in selected_platforms:
            platform_results[platform] = clone_seed_platform_items(seed_catalog, platform)
            continue
        if platform == "claude":
            print("[1/4] Syncing Claude official skills...", flush=True)
            platform_results[platform] = sync_codex_or_claude("claude", "anthropics/skills", "skills", lookup, output_root)
            continue
        if platform == "codex":
            print("[2/4] Syncing Codex official skills...", flush=True)
            platform_results[platform] = sync_codex_or_claude("codex", "openai/skills", "skills/.curated", lookup, output_root)
            continue
        print("[3/4] Syncing Gemini official extensions...", flush=True)
        if args.refresh_gemini:
            platform_results[platform] = sync_gemini(lookup, seed_catalog, output_root)
        else:
            platform_results[platform] = clone_seed_platform_items(seed_catalog, platform)

    generated_at = run_command(["date", "-u", "+%Y-%m-%dT%H:%M:%SZ"]).strip()
    catalog = {
        "generatedAt": generated_at,
        "platforms": {
            platform: build_platform_meta(
                lookup.platform_meta.get(platform, {}),
                platform_results[platform][1],
                notes_suffix=(
                    "每个 extension 条目分别记录对应 repo 的 tarball ETag，供配置页判断是否可更新。"
                    if platform == "gemini"
                    else PLATFORM_NOTES_SUFFIX
                ),
            )
            for platform in PLATFORMS
        },
        "skills": sorted(
            [item for platform in PLATFORMS for item in platform_results[platform][0]],
            key=lambda item: (item["platform"], item["name"].lower()),
        ),
    }
    validate_catalog(catalog)
    CATALOG_PATH.write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    counts = {platform: len(platform_results[platform][0]) for platform in PLATFORMS}
    print("[4/4] Done", flush=True)
    print(json.dumps({"generatedAt": generated_at, "counts": counts, "selected": list(selected_platforms)}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main(sys.argv[1:]))
    except SyncError as error:
        print(f"sync_official_skills.py failed: {error}", file=sys.stderr)
        raise SystemExit(1)
