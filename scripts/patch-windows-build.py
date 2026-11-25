#!/usr/bin/env python3
"""Build a Goatai Windows ZIP from the official FireDragon Windows package.

The native Windows binaries are kept from the official build; only the
platform-independent resources are replaced:

- chrome/firedragon/**
- chrome/browser/builtin-addons/firedragon-ai/**
- chrome/browser/builtin-addons/firedragon-settings/**
- chrome/browser/content/browser/built_in_addons.json
- defaults/preferences/firedragon.js

This is not a from-source Windows build. Use a Windows machine/CI for that.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import tarfile
import tempfile
import zipfile
from pathlib import Path

SETTINGS_PREFIX = "chrome/browser/builtin-addons/firedragon-settings/"
REPLACEMENT_TREES = (
    "chrome/firedragon",
    "chrome/browser/builtin-addons/firedragon-ai",
    "chrome/browser/builtin-addons/firedragon-settings",
)
REPLACEMENT_FILES = (
    "chrome/browser/content/browser/built_in_addons.json",
    "defaults/preferences/firedragon.js",
)


def extract_linux_omni(tar_path: Path, dest: Path) -> None:
    with tarfile.open(tar_path, "r:xz") as archive:
        members = [
            member
            for member in archive.getmembers()
            if member.isfile()
            and member.name.endswith("/browser/omni.ja")
            and "firedragon/" in member.name
        ]
        if len(members) != 1:
            raise SystemExit(
                f"expected one browser/omni.ja in {tar_path}, found {len(members)}"
            )
        source = archive.extractfile(members[0])
        if source is None:
            raise SystemExit("could not read browser/omni.ja from the Linux archive")
        dest.write_bytes(source.read())


def collect_replacements(linux_tree: Path) -> dict[str, Path]:
    replacements: dict[str, Path] = {}
    for prefix in REPLACEMENT_TREES:
        base = linux_tree / prefix
        if not base.is_dir():
            raise SystemExit(f"missing {prefix} in the Linux omni tree")
        for path in base.rglob("*"):
            if path.is_file():
                rel = path.relative_to(linux_tree).as_posix()
                replacements[rel] = path
    for rel in REPLACEMENT_FILES:
        path = linux_tree / rel
        if not path.is_file():
            raise SystemExit(f"missing {rel} in the Linux omni tree")
        replacements[rel] = path
    return replacements


def patch_omni(win_omni: Path, replacements: dict[str, Path]) -> None:
    patched = win_omni.with_suffix(".patched")
    with zipfile.ZipFile(win_omni) as source:
        infos = source.infolist()
        existing = {info.filename for info in infos}
        with zipfile.ZipFile(patched, "w", zipfile.ZIP_DEFLATED) as target:
            for info in infos:
                name = info.filename
                if name.startswith(SETTINGS_PREFIX) and name not in replacements:
                    continue
                if name in replacements:
                    data = replacements[name].read_bytes()
                else:
                    data = source.read(name)
                target.writestr(info, data)
            for name, path in sorted(replacements.items()):
                if name in existing:
                    continue
                info = zipfile.ZipInfo(name, date_time=(2026, 11, 25, 12, 0, 0))
                info.compress_type = zipfile.ZIP_DEFLATED
                info.external_attr = 0o644 << 16
                target.writestr(info, path.read_bytes())
    shutil.move(patched, win_omni)


def patch_outer_zip(source_zip: Path, win_omni: Path, output: Path) -> None:
    with (
        zipfile.ZipFile(source_zip) as source,
        zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as target,
    ):
        for info in source.infolist():
            data = (
                win_omni.read_bytes()
                if info.filename == "firedragon/browser/omni.ja"
                else source.read(info.filename)
            )
            target.writestr(info, data)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--windows-zip", default=".cache/firedragon-v13.13.2.win32-x64.zip"
    )
    parser.add_argument(
        "--linux-tar", default=".dist/firedragon-v13.13.2.linux-x64.tar.xz"
    )
    parser.add_argument("--output", default=".dist/firedragon-v13.13.2.win32-x64.zip")
    args = parser.parse_args()

    windows_zip = Path(args.windows_zip).resolve()
    linux_tar = Path(args.linux_tar).resolve()
    output = Path(args.output).resolve()
    for path in (windows_zip, linux_tar):
        if not path.is_file():
            raise SystemExit(f"missing input: {path}")

    with tempfile.TemporaryDirectory(prefix="goatai-win-") as tmp:
        tmp_path = Path(tmp)
        linux_omni = tmp_path / "linux-omni.ja"
        extract_linux_omni(linux_tar, linux_omni)

        linux_tree = tmp_path / "linux"
        win_tree = tmp_path / "win"
        with zipfile.ZipFile(linux_omni) as archive:
            archive.extractall(linux_tree)
        with zipfile.ZipFile(windows_zip) as archive:
            archive.extractall(win_tree)

        win_omni = win_tree / "firedragon/browser/omni.ja"
        if not win_omni.is_file():
            raise SystemExit(f"missing firedragon/browser/omni.ja in {windows_zip}")

        replacements = collect_replacements(linux_tree)
        patch_omni(win_omni, replacements)

        with zipfile.ZipFile(win_omni) as archive:
            addons = json.loads(
                archive.read("chrome/browser/content/browser/built_in_addons.json")
            )
            if not any(
                "firedragon-ai" in item["addon_id"] for item in addons["builtins"]
            ):
                raise SystemExit("firedragon-ai is missing from built_in_addons.json")
            if b"firedragon-ai-button" not in archive.read(
                "chrome/firedragon/content/browser.js"
            ):
                raise SystemExit("toolbar injection is missing from browser.js")

        output.parent.mkdir(parents=True, exist_ok=True)
        patch_outer_zip(windows_zip, win_omni, output)

    print(f"wrote {output} ({output.stat().st_size / 1024 / 1024:.1f} MB)")
    print("note: native binaries are from the official FireDragon Windows package")


if __name__ == "__main__":
    main()
