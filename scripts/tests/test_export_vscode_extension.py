from __future__ import annotations

import subprocess
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch


ROOT_DIR = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT_DIR))

import export_vscode_extension as export_script


class VsixAuditTests(unittest.TestCase):
    def create_vsix(self, root: Path, entries: list[str]) -> Path:
        package = root / "fixture.vsix"
        with zipfile.ZipFile(package, "w") as archive:
            for entry in entries:
                archive.writestr(f"extension/{entry}", "fixture")
        return package

    def audit(self, entries: list[str]) -> None:
        with tempfile.TemporaryDirectory(prefix="sinitek export test ") as temporary:
            package = self.create_vsix(Path(temporary), entries)
            with patch.object(export_script.subprocess, "run", return_value=subprocess.CompletedProcess([], 0, "通过\n", "")):
                export_script.audit_vsix(package, "universal")

    def test_package_moves_vsix_into_dist_after_prepublish_clean(self) -> None:
        with tempfile.TemporaryDirectory(prefix="sinitek export output ") as temporary:
            root = Path(temporary)
            output = root / "dist" / "fixture.vsix"

            def fake_run(argv: list[str], *, cwd: Path, stdout=None) -> None:
                staged = Path(argv[argv.index("--out") + 1])
                self.assertNotEqual(staged.parent, output.parent)
                output.parent.mkdir(parents=True, exist_ok=True)
                staged.write_bytes(b"fixture")
                output.parent.rmdir()

            with patch.object(export_script, "resolve_vsce", return_value="vsce"), \
                    patch.object(export_script, "workspace_has_pnpm_node_modules", return_value=False), \
                    patch.object(export_script, "run_process", side_effect=fake_run):
                export_script.package_vsix("universal", output, None)
            self.assertEqual(output.read_bytes(), b"fixture")

    def test_required_runtime_entries_pass_python_zip_audit(self) -> None:
        self.audit(list(export_script.REQUIRED_ENTRIES))

    def test_audit_rejects_developer_files_and_missing_runtime(self) -> None:
        with self.assertRaisesRegex(RuntimeError, "开发态文件"):
            self.audit([*export_script.REQUIRED_ENTRIES, "publish_vscode_extension.py"])
        with self.assertRaisesRegex(RuntimeError, "缺少必需运行时文件"):
            self.audit(list(export_script.REQUIRED_ENTRIES[:-1]))

    def test_invalid_archive_has_clear_error(self) -> None:
        with tempfile.TemporaryDirectory(prefix="sinitek export test ") as temporary:
            package = Path(temporary) / "broken.vsix"
            package.write_bytes(b"not a zip")
            with self.assertRaisesRegex(RuntimeError, "无法读取 VSIX"):
                export_script.audit_vsix(package, "universal")

    def test_audit_failure_includes_subprocess_diagnostics(self) -> None:
        with tempfile.TemporaryDirectory(prefix="sinitek export test ") as temporary:
            package = self.create_vsix(Path(temporary), list(export_script.REQUIRED_ENTRIES))
            result = subprocess.CompletedProcess([], 1, "", "缺少 cli.js")
            with patch.object(export_script.subprocess, "run", return_value=result):
                with self.assertRaisesRegex(RuntimeError, "缺少 cli.js"):
                    export_script.audit_vsix(package, "universal")


if __name__ == "__main__":
    unittest.main()
