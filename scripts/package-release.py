# scripts/package-release.py
# Copyright (C) 2026 Stefano Natangelo
# SPDX-License-Identifier: AGPL-3.0-only

"""Build and verify an installable Mobile Dashboard archive from tracked files."""

import gzip
import hashlib
import io
import re
import subprocess
import tarfile
import xml.etree.ElementTree as ET
from datetime import date, datetime, time, timezone
from pathlib import Path, PurePosixPath

ROOT = Path(__file__).resolve().parents[1]
PRODUCT = "mobileDashboard"
TOP_LEVEL = {
    "MobileDashboardPlugin.php", "index.php", "version.xml",
    "LICENSE", "README.md", "CHANGELOG.md", "SECURITY.md",
}
SUFFIXES = {"styles": {".css", ".js"}, "locale": {".po"}}
REQUIRED_RUNTIME = {
    "styles/mobile.css", "styles/mobile.js",
    "locale/en/locale.po", "locale/it/locale.po",
}


def fail(message):
    raise SystemExit(message)


def build():
    xml = ET.parse(ROOT / "version.xml").getroot()
    version = xml.findtext("release") or ""
    if xml.findtext("application") != PRODUCT:
        fail("Unexpected product in version.xml")
    if not re.fullmatch(r"[0-9]+(?:\.[0-9]+){3}", version):
        fail("Release version must contain four numeric components")

    # Smarty uses file modification times; a zero timestamp can make
    # an extracted template appear not to exist. Use the release date
    # at midnight UTC for reproducible, nonzero archive metadata.
    release_date = xml.findtext("date") or ""
    try:
        if not re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", release_date):
            raise ValueError("Expected YYYY-MM-DD")
        timestamp = int(datetime.combine(
            date.fromisoformat(release_date), time.min, tzinfo=timezone.utc
        ).timestamp())
    except (ValueError, OverflowError):
        fail("Invalid release date in version.xml")
    if not 0 < timestamp <= 0xFFFFFFFF:
        fail("Release date is outside the nonzero gzip timestamp range")

    tracked = subprocess.check_output(
        ["git", "ls-files", "-z"], cwd=ROOT
    ).decode("utf-8").split("\0")
    files = {}
    for name in sorted(filter(None, tracked)):
        path = PurePosixPath(name)
        if name not in TOP_LEVEL:
            if path.parts[0] not in SUFFIXES:
                continue
            if (len(path.parts) < 2 or
                    path.suffix not in SUFFIXES[path.parts[0]] or
                    any(part.startswith(".") or part in
                        {"tests", "demos", "node_modules"}
                        for part in path.parts)):
                fail(f"Unexpected runtime path: {name}")
        source = ROOT / name
        if (not source.is_file() or source.is_symlink() or
                not source.resolve().is_relative_to(ROOT)):
            fail(f"Not a regular tracked file: {name}")
        files[f"{PRODUCT}/{name}"] = source.read_bytes()

    if any(f"{PRODUCT}/{name}" not in files for name in TOP_LEVEL | REQUIRED_RUNTIME):
        fail("Missing required release file")
    for directory in SUFFIXES:
        if not any(name.startswith(f"{PRODUCT}/{directory}/") for name in files):
            fail(f"Missing runtime directory: {directory}")

    dist = ROOT / "dist"
    dist.mkdir(exist_ok=True)
    archive = dist / f"{PRODUCT}-{version}.tar.gz"

    # Stable metadata makes identical inputs produce identical archives.
    directories = {PRODUCT}
    for name in files:
        directories.update(str(p) for p in PurePosixPath(name).parents if str(p) != ".")
    with archive.open("wb") as raw:
        with gzip.GzipFile(filename="", mode="wb", fileobj=raw, mtime=timestamp) as compressed:
            with tarfile.open(fileobj=compressed, mode="w", format=tarfile.USTAR_FORMAT) as tar:
                for name in sorted(directories):
                    member = tarfile.TarInfo(name)
                    member.mtime = timestamp
                    member.type = tarfile.DIRTYPE
                    member.mode = 0o755
                    tar.addfile(member)
                for name, data in sorted(files.items()):
                    member = tarfile.TarInfo(name)
                    member.mtime = timestamp
                    member.size = len(data)
                    member.mode = 0o644
                    tar.addfile(member, io.BytesIO(data))

    # Verify the actual artifact, not just the staging selection.
    with tarfile.open(archive, "r:gz") as tar:
        members = tar.getmembers()
        names = [member.name for member in members]
        if len(names) != len(set(names)) or set(names) != directories | set(files):
            fail("Archive contents do not match the allowlist")
        for member in members:
            if member.mtime != timestamp or member.mtime <= 0:
                fail(f"Invalid archive timestamp: {member.name}")
            if member.name in directories:
                if not member.isdir():
                    fail(f"Unexpected directory type: {member.name}")
            elif (not member.isfile() or
                  tar.extractfile(member).read() != files[member.name]):
                fail(f"Unexpected archive file: {member.name}")
        packaged = ET.fromstring(tar.extractfile(f"{PRODUCT}/version.xml").read())
        if packaged.findtext("release") != version:
            fail("Packaged version mismatch")

    data = archive.read_bytes()
    if int.from_bytes(data[4:8], 'little') != timestamp:
        fail("Invalid gzip header timestamp")
    for algorithm in ("md5", "sha256"):
        digest = hashlib.new(algorithm, data, usedforsecurity=(algorithm != "md5")).hexdigest()
        (dist / f"{archive.name}.{algorithm}").write_text(
            f"{digest}  {archive.name}\n", encoding="ascii")
        print(f"{algorithm}: {digest}")
    print(f"Verified {archive.name}: {len(files)} files")


if __name__ == "__main__":
    build()
