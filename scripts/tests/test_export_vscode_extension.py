from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import unittest
import xml.etree.ElementTree as ElementTree
import zipfile
from pathlib import Path
from unittest.mock import patch


ROOT_DIR = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT_DIR))
sys.path.insert(0, str(ROOT_DIR / "scripts"))

import export_vscode_extension as export_script


class ScriptLocationTests(unittest.TestCase):
    def test_absolute_entrypoint_imports_run_dev_outside_repository(self) -> None:
        result = subprocess.run(
            [sys.executable, str(ROOT_DIR / "scripts" / "export_vscode_extension.py"), "--help"],
            cwd=tempfile.gettempdir(),
            capture_output=True,
            text=True,
            encoding="utf-8",
        )
        self.assertEqual(result.returncode, 0, result.stderr)


class PackageOptionsTests(unittest.TestCase):
    def test_universal_package_disables_repository_url_guessing(self) -> None:
        output = Path("dist") / "fixture.vsix"
        self.assertEqual(
            export_script.package_options("universal", output, None),
            ["package", "--no-rewrite-relative-links", "--out", str(output)],
        )

    def test_targeted_package_disables_rewriting_and_keeps_target_options(self) -> None:
        output = Path("output directory") / "fixture.vsix"
        ignore = Path("ignore directory") / "target.ignore"
        self.assertEqual(
            export_script.package_options("win32-x64", output, ignore),
            [
                "package", "--no-rewrite-relative-links", "--out", str(output),
                "--target", "win32-x64", "--ignoreFile", str(ignore),
            ],
        )

    def test_targeted_package_still_requires_ignore_file(self) -> None:
        with self.assertRaisesRegex(ValueError, "定向打包缺少 ignore 文件"):
            export_script.package_options("win32-x64", Path("fixture.vsix"), None)


class ExportWorkflowTests(unittest.TestCase):
    def test_export_registers_readme_assets_before_auditing_each_target(self) -> None:
        for target in ("universal", "win32-x64"):
            with self.subTest(target=target):
                events: list[str] = []
                output = Path("dist") / "fixture.vsix"
                with patch.object(export_script, "require_tool", return_value="fixture"), \
                        patch.object(export_script, "resolve_target", return_value=target), \
                        patch.object(export_script, "output_file", return_value=output), \
                        patch.object(export_script, "run_process"), \
                        patch.object(export_script, "package_vsix", side_effect=lambda *args: events.append("package")), \
                        patch.object(export_script, "prepare_marketplace_readme", side_effect=lambda *args: events.append("readme")), \
                        patch.object(export_script, "audit_vsix", side_effect=lambda *args: events.append("audit")):
                    self.assertEqual(export_script.export_extension(target), output)
                self.assertEqual(events, ["package", "readme", "audit"])


class VsixAuditTests(unittest.TestCase):
    def create_vsix(self, root: Path, entries: list[str], *, readme: str = "# fixture", assets: str = "") -> Path:
        package = root / "fixture.vsix"
        metadata = {
            "package.json": json.dumps({"publisher": "sinitek", "name": "fixture-extension", "version": "2.0.0"}),
            "readme.md": readme,
        }
        with zipfile.ZipFile(package, "w") as archive:
            for entry in entries:
                archive.writestr(f"extension/{entry}", metadata.get(entry, "fixture"))
            archive.writestr(
                "extension.vsixmanifest",
                f'<PackageManifest xmlns="{export_script.VSIX_NAMESPACE}" Version="2.0.0">'
                '<Metadata><Identity TargetPlatform="win32-x64" /></Metadata>'
                f'<Assets>{assets}</Assets></PackageManifest>',
            )
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

    def test_repository_readme_keeps_intro_image_for_marketplace_export(self) -> None:
        readme = (ROOT_DIR / "README.md").read_text(encoding="utf-8")
        image_path = "media/loop-plus-intro.jpg"
        self.assertTrue((ROOT_DIR / image_path).is_file())
        with tempfile.TemporaryDirectory(prefix="sinitek repository readme ") as temporary:
            package = self.create_vsix(Path(temporary), list(export_script.REQUIRED_ENTRIES), readme=readme)
            export_script.prepare_marketplace_readme(package)
            with zipfile.ZipFile(package) as archive:
                manifest = json.loads(archive.read("extension/package.json"))
                expected_url = export_script.marketplace_asset_url(
                    manifest, export_script.README_IMAGE_ASSETS[image_path],
                )
                self.assertIn(expected_url, archive.read("extension/readme.md").decode("utf-8"))

    def test_readme_image_becomes_versioned_addressable_marketplace_asset(self) -> None:
        with tempfile.TemporaryDirectory(prefix="sinitek readme assets ") as temporary:
            readme = (
                '# 介绍\n![图片](media/loop-plus-intro.jpg)\n'
                '![同一图片](./media/loop-plus-intro.jpg "介绍图")\n'
                '[本地文档](docs/guide.md)\n![外部图](https://example.com/image.png)\n'
            )
            package = self.create_vsix(Path(temporary), list(export_script.REQUIRED_ENTRIES), readme=readme)
            export_script.prepare_marketplace_readme(package)
            with zipfile.ZipFile(package) as archive:
                result = archive.read("extension/readme.md").decode("utf-8")
                expected_url = (
                    "https://sinitek.gallery.vsassets.io/_apis/public/gallery/publisher/sinitek"
                    "/extension/fixture-extension/2.0.0/assetbyname/Microsoft.VisualStudio.Services.Screenshots.1"
                )
                self.assertEqual(result.count(expected_url), 2)
                self.assertIn(f'![同一图片]({expected_url} "介绍图")', result)
                self.assertIn("[本地文档](docs/guide.md)", result)
                self.assertIn("![外部图](https://example.com/image.png)", result)
                self.assertEqual(archive.read("extension/media/loop-plus-intro.jpg"), b"fixture")
                manifest = ElementTree.fromstring(archive.read("extension.vsixmanifest"))
                namespace = {"vsix": export_script.VSIX_NAMESPACE}
                assets = manifest.findall("vsix:Assets/vsix:Asset", namespace)
                self.assertEqual([asset.attrib for asset in assets], [{
                    "Type": "Microsoft.VisualStudio.Services.Screenshots.1",
                    "Path": "extension/media/loop-plus-intro.jpg",
                    "Addressable": "true",
                }])
                self.assertEqual(manifest.find("vsix:Metadata/vsix:Identity", namespace).get("TargetPlatform"), "win32-x64")
                export_script.validate_readme_assets(
                    result, json.loads(archive.read("extension/package.json")), manifest, set(archive.namelist()),
                )

    def test_readme_asset_preparation_is_idempotent(self) -> None:
        with tempfile.TemporaryDirectory(prefix="sinitek readme repeat ") as temporary:
            package = self.create_vsix(
                Path(temporary), list(export_script.REQUIRED_ENTRIES), readme="![图片](media/loop-plus-intro.jpg)",
            )
            export_script.prepare_marketplace_readme(package)
            original = package.read_bytes()
            export_script.prepare_marketplace_readme(package)
            self.assertEqual(package.read_bytes(), original)

    def test_missing_image_does_not_modify_original_package(self) -> None:
        with tempfile.TemporaryDirectory(prefix="sinitek missing readme image ") as temporary:
            entries = [entry for entry in export_script.REQUIRED_ENTRIES if entry != "media/loop-plus-intro.jpg"]
            package = self.create_vsix(Path(temporary), entries, readme="![图片](media/loop-plus-intro.jpg)")
            original = package.read_bytes()
            with self.assertRaisesRegex(RuntimeError, "缺少 README 图片"):
                export_script.prepare_marketplace_readme(package)
            self.assertEqual(package.read_bytes(), original)

    def test_unknown_local_image_blocks_export(self) -> None:
        with tempfile.TemporaryDirectory(prefix="sinitek unknown readme image ") as temporary:
            package = self.create_vsix(
                Path(temporary), list(export_script.REQUIRED_ENTRIES), readme="![新图](media/unknown.png)",
            )
            with self.assertRaisesRegex(RuntimeError, "README_IMAGE_ASSETS"):
                export_script.prepare_marketplace_readme(package)

    def test_audit_rejects_unconverted_or_insecure_image_urls(self) -> None:
        for image_url in ("media/loop-plus-intro.jpg", "http://example.com/image.jpg"):
            with self.subTest(image_url=image_url), tempfile.TemporaryDirectory(prefix="sinitek relative readme ") as temporary:
                package = self.create_vsix(
                    Path(temporary), list(export_script.REQUIRED_ENTRIES), readme=f"![图片]({image_url})",
                )
                with self.assertRaisesRegex(RuntimeError, "README 图片必须使用市场可访问的 HTTPS 地址"):
                    export_script.audit_vsix(package, "universal")

    def test_audit_rejects_missing_or_incorrect_marketplace_asset(self) -> None:
        image_url = export_script.marketplace_asset_url(
            {"publisher": "sinitek", "name": "fixture-extension", "version": "2.0.0"},
            "Microsoft.VisualStudio.Services.Screenshots.1",
        )
        for attributes in (None, 'Path="extension/media/other.jpg" Addressable="true"',
                           'Path="extension/media/loop-plus-intro.jpg" Addressable="false"'):
            with self.subTest(attributes=attributes), tempfile.TemporaryDirectory(prefix="sinitek asset audit ") as temporary:
                assets = (
                    f'<Asset Type="Microsoft.VisualStudio.Services.Screenshots.1" {attributes} />'
                    if attributes is not None else ""
                )
                package = self.create_vsix(
                    Path(temporary), list(export_script.REQUIRED_ENTRIES), readme=f"![图片]({image_url})", assets=assets,
                )
                with self.assertRaisesRegex(RuntimeError, "未登记为可寻址市场资产"):
                    export_script.audit_vsix(package, "universal")

    def test_audit_rejects_developer_files_and_missing_runtime(self) -> None:
        with self.assertRaisesRegex(RuntimeError, "开发态文件"):
            self.audit([*export_script.REQUIRED_ENTRIES, "scripts/publish_vscode_extension.py"])
        with self.assertRaisesRegex(RuntimeError, "缺少必需运行时文件"):
            self.audit(list(export_script.REQUIRED_ENTRIES[:-1]))

    def test_audit_rejects_missing_readme_image(self) -> None:
        entries = [entry for entry in export_script.REQUIRED_ENTRIES if entry != "media/loop-plus-intro.jpg"]
        with self.assertRaisesRegex(RuntimeError, r"media/loop-plus-intro\.jpg"):
            self.audit(entries)

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
