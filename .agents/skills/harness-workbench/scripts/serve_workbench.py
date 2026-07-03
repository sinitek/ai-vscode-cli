#!/usr/bin/env python3
"""Serve a zero-dependency local harness workbench page."""

from __future__ import annotations

import argparse
import html
import json
import subprocess
from datetime import UTC, datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8765


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Serve the local harness workbench.")
    parser.add_argument("--host", default=DEFAULT_HOST, help="Bind host.")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT, help="Bind port.")
    parser.add_argument("--root", default=".", help="Repository root.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    root = Path(args.root).resolve()
    handler = build_handler(root)
    server = ThreadingHTTPServer((args.host, args.port), handler)
    url = f"http://{args.host}:{args.port}"
    print(f"[harness-workbench] serving {root}")
    print(f"[harness-workbench] open {url}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[harness-workbench] stopped")
    finally:
        server.server_close()
    return 0


def build_handler(root: Path) -> type[BaseHTTPRequestHandler]:
    class HarnessWorkbenchHandler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:
            parsed = urlparse(self.path)
            if parsed.path in {"/", "/index.html"}:
                self.send_html(render_page(root))
                return
            if parsed.path == "/api/status":
                self.send_json(build_status(root))
                return
            self.send_error(404, "Not found")

        def log_message(self, format: str, *args: object) -> None:
            print(f"[harness-workbench] {self.address_string()} - {format % args}")

        def send_html(self, body: str) -> None:
            encoded = body.encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(encoded)))
            self.end_headers()
            self.wfile.write(encoded)

        def send_json(self, payload: dict[str, object]) -> None:
            encoded = json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(encoded)))
            self.end_headers()
            self.wfile.write(encoded)

    return HarnessWorkbenchHandler


def build_status(root: Path) -> dict[str, object]:
    task_board = read_json(root / ".ch/docs/generated/task-board/task-board.json")
    frontier = read_json(root / ".ch/docs/generated/work-frontier-summary.json")
    active_plans = sorted(
        path.relative_to(root).as_posix()
        for path in (root / ".ch/docs/exec-plans/active").glob("*.md")
        if path.name not in {".gitkeep", ".keep"}
    )
    return {
        "generated_at": datetime.now(UTC).astimezone().isoformat(timespec="seconds"),
        "root": str(root),
        "git_changed_paths": git_changed_paths(root),
        "active_plans": active_plans,
        "task_board": task_board,
        "frontier": frontier,
        "entrypoints": [
            {
                "label": "Docs README",
                "path": ".ch/docs/README.md",
                "exists": (root / ".ch/docs/README.md").exists(),
            },
            {
                "label": "Task Board",
                "path": ".ch/docs/generated/task-board/task-board.md",
                "exists": (root / ".ch/docs/generated/task-board/task-board.md").exists(),
            },
            {
                "label": "Work Frontier",
                "path": ".ch/docs/generated/work-frontier.md",
                "exists": (root / ".ch/docs/generated/work-frontier.md").exists(),
            },
            {
                "label": "Tool Policy",
                "path": ".ch/docs/TOOL_POLICY.md",
                "exists": (root / ".ch/docs/TOOL_POLICY.md").exists(),
            },
            {
                "label": "Agent Profiles",
                "path": ".agents/profiles/README.md",
                "exists": (root / ".agents/profiles/README.md").exists(),
            },
        ],
    }


def render_page(root: Path) -> str:
    status = build_status(root)
    task_board = status.get("task_board") or {}
    summary = task_board.get("summary", {}) if isinstance(task_board, dict) else {}
    tasks = task_board.get("tasks", []) if isinstance(task_board, dict) else []
    changed_paths = status["git_changed_paths"]
    entrypoints = status["entrypoints"]
    active_plans = status["active_plans"]

    task_cards = "\n".join(render_task_card(task) for task in tasks) or (
        '<p class="muted">No task-board data found. Run '
        '<code>python3 .agents/skills/task-board/scripts/build_task_board.py</code>.</p>'
    )
    changed_list = render_list(changed_paths, "No git changes detected.")
    active_plan_list = render_list(active_plans, "No active execution plans found.")
    entrypoint_list = "\n".join(
        f"<li><code>{escape(item['path'])}</code> <span class=\"pill {'ok' if item['exists'] else 'warn'}\">"
        f"{'exists' if item['exists'] else 'missing'}</span></li>"
        for item in entrypoints
    )

    return f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Harness Workbench</title>
  <style>
    :root {{
      color-scheme: light;
      --bg: #f7f8fa;
      --panel: #ffffff;
      --text: #17202a;
      --muted: #65717e;
      --line: #d9dee5;
      --accent: #0f766e;
      --warn: #9a6700;
      --ok: #1f7a4d;
    }}
    * {{ box-sizing: border-box; }}
    body {{
      margin: 0;
      background: var(--bg);
      color: var(--text);
      font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }}
    header {{
      border-bottom: 1px solid var(--line);
      background: var(--panel);
      padding: 20px 28px;
    }}
    h1 {{ margin: 0 0 4px; font-size: 24px; }}
    h2 {{ margin: 0 0 12px; font-size: 16px; }}
    main {{
      display: grid;
      grid-template-columns: minmax(0, 1.4fr) minmax(320px, 0.8fr);
      gap: 16px;
      padding: 16px 28px 28px;
    }}
    section {{
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 16px;
      min-width: 0;
    }}
    code {{
      background: #eef1f4;
      border-radius: 4px;
      padding: 1px 4px;
      overflow-wrap: anywhere;
    }}
    ul {{ margin: 0; padding-left: 18px; }}
    .muted {{ color: var(--muted); }}
    .grid {{
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 8px;
      margin-top: 12px;
    }}
    .metric {{
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 10px;
      background: #fbfcfd;
    }}
    .metric strong {{ display: block; font-size: 22px; }}
    .task {{
      border-top: 1px solid var(--line);
      padding: 12px 0;
    }}
    .task:first-child {{ border-top: 0; padding-top: 0; }}
    .task-title {{ font-weight: 650; }}
    .pill {{
      display: inline-block;
      border: 1px solid var(--line);
      border-radius: 999px;
      padding: 1px 8px;
      font-size: 12px;
      color: var(--muted);
      background: #fbfcfd;
    }}
    .pill.ok {{ border-color: #b7dfc8; color: var(--ok); }}
    .pill.warn {{ border-color: #f1d18a; color: var(--warn); }}
    .stack {{ display: grid; gap: 16px; }}
    @media (max-width: 880px) {{
      main {{ grid-template-columns: 1fr; padding: 12px; }}
      header {{ padding: 16px 12px; }}
      .grid {{ grid-template-columns: repeat(2, minmax(0, 1fr)); }}
    }}
  </style>
</head>
<body>
  <header>
    <h1>Harness Workbench</h1>
    <div class="muted">Root: <code>{escape(str(root))}</code></div>
    <div class="muted">Generated: {escape(str(status["generated_at"]))}</div>
  </header>
  <main>
    <div class="stack">
      <section>
        <h2>Task Board</h2>
        <div class="grid">
          <div class="metric"><span class="muted">Tasks</span><strong>{summary.get("task_count", 0)}</strong></div>
          <div class="metric"><span class="muted">In Progress</span><strong>{summary.get("in_progress_count", 0)}</strong></div>
          <div class="metric"><span class="muted">Blocked</span><strong>{summary.get("blocked_count", 0)}</strong></div>
          <div class="metric"><span class="muted">Changed</span><strong>{len(changed_paths)}</strong></div>
        </div>
      </section>
      <section>
        <h2>Tasks</h2>
        {task_cards}
      </section>
    </div>
    <div class="stack">
      <section>
        <h2>Active Plans</h2>
        {active_plan_list}
      </section>
      <section>
        <h2>Changed Paths</h2>
        {changed_list}
      </section>
      <section>
        <h2>Entrypoints</h2>
        <ul>{entrypoint_list}</ul>
      </section>
    </div>
  </main>
</body>
</html>
"""


def render_task_card(task: dict[str, object]) -> str:
    next_steps = task.get("next_steps") or []
    next_text = "; ".join(str(item) for item in next_steps[:3]) if next_steps else "No next step recorded."
    blockers = task.get("blockers") or []
    blocker_text = (
        f"<div class=\"muted\">Blockers: {escape('; '.join(str(item) for item in blockers[:3]))}</div>"
        if blockers
        else ""
    )
    return (
        '<div class="task">'
        f'<div class="task-title">{escape(str(task.get("title", "Untitled")))}</div>'
        f'<div><span class="pill">{escape(str(task.get("status", "draft")))}</span> '
        f'<span class="muted">owner: {escape(str(task.get("owner", "未指定")))}</span></div>'
        f'<div class="muted">Next: {escape(next_text)}</div>'
        f'{blocker_text}'
        f'<div><code>{escape(str(task.get("source_path", "")))}</code></div>'
        '</div>'
    )


def render_list(values: list[str], empty_text: str) -> str:
    if not values:
        return f'<p class="muted">{escape(empty_text)}</p>'
    return "<ul>" + "".join(f"<li><code>{escape(value)}</code></li>" for value in values) + "</ul>"


def read_json(path: Path) -> dict[str, object]:
    if not path.exists():
        return {}
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}
    return value if isinstance(value, dict) else {}


def git_changed_paths(root: Path) -> list[str]:
    try:
        result = subprocess.run(
            ["git", "status", "--short"],
            cwd=root,
            check=False,
            capture_output=True,
            text=True,
        )
    except FileNotFoundError:
        return []
    if result.returncode != 0:
        return []
    paths: list[str] = []
    for line in result.stdout.splitlines():
        if line.strip():
            paths.append(line[3:].strip())
    return paths


def escape(value: str) -> str:
    return html.escape(value, quote=True)


if __name__ == "__main__":
    raise SystemExit(main())
