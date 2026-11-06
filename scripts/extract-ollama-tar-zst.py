#!/usr/bin/env python3
"""Safely stream-extract the official Ollama .tar.zst archive to a user prefix."""
from __future__ import annotations

import posixpath
import sys
import tarfile
from pathlib import Path, PurePosixPath

try:
    import zstandard
except ImportError as exc:
    raise SystemExit("Missing zstandard module; install it in the bootstrap virtualenv first") from exc

if len(sys.argv) != 2:
    raise SystemExit("Usage: extract-ollama-tar-zst.py DESTINATION_PREFIX")

root = Path(sys.argv[1]).resolve()
root.mkdir(parents=True, exist_ok=True)


def checked_path(name: str) -> Path:
    normalized = posixpath.normpath(name)
    pure = PurePosixPath(normalized)
    if normalized in ("", "."):
        return root
    if pure.is_absolute() or ".." in pure.parts:
        raise ValueError(f"Unsafe archive member path: {name!r}")
    target = (root / Path(*pure.parts)).resolve()
    if target != root and root not in target.parents:
        raise ValueError(f"Archive member escapes destination: {name!r}")
    return target


def check_link(member: tarfile.TarInfo, normalized_name: str) -> None:
    if member.issym():
        link = posixpath.normpath(posixpath.join(posixpath.dirname(normalized_name), member.linkname))
    elif member.islnk():
        link = posixpath.normpath(member.linkname)
    else:
        return
    pure = PurePosixPath(link)
    if pure.is_absolute():
        raise ValueError(f"Unsafe archive link: {member.name!r} -> {member.linkname!r}")
    target = (root / Path(*pure.parts)).resolve()
    if target != root and root not in target.parents:
        raise ValueError(f"Archive link escapes destination: {member.name!r} -> {member.linkname!r}")


stream = zstandard.ZstdDecompressor().stream_reader(sys.stdin.buffer, read_size=1024 * 1024)
count = 0
try:
    with stream, tarfile.open(fileobj=stream, mode="r|") as archive:
        for member in archive:
            normalized = posixpath.normpath(member.name)
            checked_path(member.name)
            if normalized in ("", "."):
                if member.isdir():
                    continue
                raise ValueError(f"Unexpected archive root entry: {member.name!r}")
            if member.issym() or member.islnk():
                check_link(member, normalized)
            elif not (member.isfile() or member.isdir()):
                raise ValueError(f"Unsupported archive entry type: {member.name!r}")
            archive.extract(member, path=root)
            count += 1
            if count % 500 == 0:
                print(f"[Ollama extractor] Extracted {count} entries...", file=sys.stderr)
finally:
    try:
        stream.close()
    except Exception:
        pass

print(f"[Ollama extractor] Extracted {count} entries into {root}", file=sys.stderr)
