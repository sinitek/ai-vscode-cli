from __future__ import annotations

import io
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


ROOT_DIR = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT_DIR))

import vscode_extension_process as process


class PosixProcessTests(unittest.TestCase):
    def test_posix_command_arguments_and_output_capture(self) -> None:
        with tempfile.TemporaryDirectory(prefix="sinitek process test ") as temporary:
            output = io.StringIO()
            with patch.object(process.os, "name", "posix"):
                process.run_process(
                    [sys.executable, "-c", "import sys; print(repr(sys.argv[1:]))", "路径 with spaces", "a&b"],
                    cwd=Path(temporary),
                    stdout=output,
                )
            self.assertEqual(output.getvalue().strip(), repr(["路径 with spaces", "a&b"]))

    def test_posix_nonzero_status_preserves_exit_code(self) -> None:
        with tempfile.TemporaryDirectory(prefix="sinitek process test ") as temporary, \
                patch.object(process.os, "name", "posix"):
            with self.assertRaises(subprocess.CalledProcessError) as result:
                process.run_process([sys.executable, "-c", "raise SystemExit(7)"], cwd=Path(temporary))
        self.assertEqual(result.exception.returncode, 7)

    def test_process_module_does_not_depend_on_windows_helpers(self) -> None:
        source = (ROOT_DIR / "vscode_extension_process.py").read_text(encoding="utf-8")
        self.assertNotIn("vscode_extension_win", source)
        self.assertNotIn("code.cmd", source)


if __name__ == "__main__":
    unittest.main()
