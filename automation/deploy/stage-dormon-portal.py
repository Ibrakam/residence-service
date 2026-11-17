#!/usr/bin/env python3
"""Stage the portal's Dormon map entry without changing its current symlink.

Run on the portal host with Python 3 and Node.js. Pass --map-json when the
script and the map manifest are uploaded independently. Reuse --release-id to
verify an already staged release. The JSON result identifies the source release,
new release, hashes and original files retained for review or rollback.
"""

import argparse
import fcntl
import hashlib
import json
import math
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import sys
import tempfile
from datetime import datetime, timezone


FILES = ("assets/projects-map.js", "assets/projects-map-loader.js", "index.html")
STATE = ".dormon-portal-stages"
COORDINATES = (41.3753333333, 69.4316388889)
TOKEN = re.compile(r"[A-Za-z0-9][A-Za-z0-9_-]{0,99}\Z")


def digest(data):
    return hashlib.sha256(data).hexdigest()


def require(condition, message):
    if not condition:
        raise ValueError(message)


def template(value):
    require(isinstance(value, str) and bool(value.strip()), "Map text must be nonempty")
    return "`" + value.replace("\\", "\\\\").replace("`", "\\`").replace("${", "\\${").replace("\r", "\\r").replace("\n", "\\n") + "`"


def project_entry(manifest):
    require(manifest.get("slug") == "dormon-hills", "Unexpected project slug")
    require(manifest.get("url") == "/dormon-hills", "Unexpected project URL")
    coordinates = manifest.get("coordinates")
    require(isinstance(coordinates, list) and len(coordinates) == 2, "Expected latitude and longitude")
    require(all(type(value) in (int, float) and math.isfinite(value) for value in coordinates), "Invalid coordinates")
    require(all(abs(a - b) < 1e-8 for a, b in zip(coordinates, COORDINATES)), "Dormon coordinates differ from approved location")
    name = template(manifest.get("name"))
    location = template(manifest.get("district"))
    address = template(manifest.get("address"))
    return ("{ slug: `dormon-hills`, name: " + name + ", location: " + location
            + ", address: " + address + ", coordinates: [41.3753333333, 69.4316388889], href: e(`/dormon-hills`) }")


def update_map(source, entry):
    lists = list(re.finditer(r"(?<=, t = \[)(.*?)(?=\], n = \[)", source, re.S))
    require(len(lists) == 1, "Cannot identify a unique portal project list")
    match = lists[0]
    body = match.group(0)
    entries = list(re.finditer(r"\{\s*slug:\s*`([a-z0-9-]+)`.*?href:\s*e\(`[^`]*`\)\s*\}", body, re.S))
    require(entries and ", ".join(item.group(0) for item in entries) == body, "Unexpected project-list formatting or ambiguous entries")
    slugs = [item.group(1) for item in entries]
    require(len(set(slugs)) == len(slugs), "Duplicate existing project slugs")
    require("avalon-residence" in slugs and "pushkin" in slugs, "Portal project list is incomplete")
    if "dormon-hills" in slugs:
        require(entries[slugs.index("dormon-hills")].group(0) == entry, "Existing Dormon entry differs from the requested manifest")
        return source, slugs, slugs
    # Keep every existing entry byte-for-byte and insert in slug order.
    next_entry = next((item for item in entries if item.group(1) > "dormon-hills"), None)
    offset = next_entry.start() if next_entry else len(body)
    updated = body[:offset] + ((entry + ", ") if next_entry else (", " + entry)) + body[offset:]
    require(updated.count(entry) == 1, "Dormon entry was inserted more than once")
    result = source[:match.start()] + updated + source[match.end():]
    new_slugs = slugs.copy()
    new_slugs.insert(slugs.index(next_entry.group(1)) if next_entry else len(slugs), "dormon-hills")
    return result, slugs, new_slugs


def version_reference(source, asset, version):
    pattern = re.compile(r"(/tencorp/assets/" + re.escape(asset) + r"\?v=)([A-Za-z0-9._-]+)")
    require(len(list(pattern.finditer(source))) == 1, "Expected one versioned reference to " + asset)
    return pattern.sub(lambda match: match.group(1) + version, source)


def atomic_replace(path, content):
    original = path.stat()
    descriptor, temporary = tempfile.mkstemp(prefix="." + path.name + ".", dir=path.parent)
    try:
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(content)
            handle.flush()
            os.fchmod(handle.fileno(), stat.S_IMODE(original.st_mode))
            if os.geteuid() == 0:
                os.fchown(handle.fileno(), original.st_uid, original.st_gid)
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def verify_stage(target, manifest_hash, version):
    artifacts = target.parent.parent / STATE / target.name
    evidence_path = artifacts / "evidence.json"
    require(target.is_dir() and not target.is_symlink() and evidence_path.is_file(), "Target exists without completed stage evidence")
    evidence = json.loads(evidence_path.read_text())
    require(evidence.get("manifest_sha256") == manifest_hash and evidence.get("version") == version, "Target belongs to different stage inputs")
    require(evidence.get("target_release") == str(target), "Stage evidence has a different target")
    for name in FILES:
        require(not (target / name).is_symlink(), "Staged asset is a symlink")
        require(digest((target / name).read_bytes()) == evidence["after_sha256"][name], "Staged file changed: " + name)
        require(digest((artifacts / "original" / name).read_bytes()) == evidence["before_sha256"][name], "Original file changed: " + name)
    return evidence


def stage(args):
    require(TOKEN.fullmatch(args.release_id) is not None, "Unsafe release ID")
    require(TOKEN.fullmatch(args.version) is not None, "Unsafe asset version")
    node = shutil.which("node")
    require(node is not None, "Node.js is required for JavaScript syntax validation")
    manifest = json.loads(args.map_json.read_text())
    entry = project_entry(manifest)
    manifest_hash = digest(json.dumps(manifest, ensure_ascii=False, sort_keys=True).encode())
    service_root = args.root.resolve(strict=True)
    releases = service_root / "releases"
    current = service_root / "current"
    require(releases.is_dir() and not releases.is_symlink(), "Expected a real releases directory")
    require(current.is_symlink(), "Expected current to be a symlink")
    target = releases / args.release_id
    incoming = releases / (".incoming-" + args.release_id)
    with (service_root / ".stage-dormon-portal.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        if target.exists() or target.is_symlink():
            return {**verify_stage(target, manifest_hash, args.version), "already_staged": True, "current_release": str(current.resolve(strict=True))}
        require(not incoming.exists() and not incoming.is_symlink(), "Incoming stage exists; inspect it before retrying")
        source = current.resolve(strict=True)
        require(source.parent == releases and source.is_dir(), "Current points outside the portal releases")
        require(not (source / "assets").is_symlink(), "Source assets directory must be real")
        original = {}
        for name in FILES:
            path = source / name
            require(path.is_file() and not path.is_symlink(), "Source asset is missing or unsafe: " + name)
            original[name] = path.read_bytes()
        mapped, previous_slugs, new_slugs = update_map(original[FILES[0]].decode(), entry)
        loader = version_reference(original[FILES[1]].decode(), "projects-map.js", args.version)
        index = version_reference(original[FILES[2]].decode(), "projects-map-loader.js", args.version)
        index = version_reference(index, "projects-map.css", args.version)
        changed = dict(zip(FILES, [mapped.encode(), loader.encode(), index.encode()]))
        artifact_root = service_root / STATE
        require(not artifact_root.is_symlink(), "Unsafe artifact directory")
        artifact_root.mkdir(exist_ok=True, mode=0o700)
        artifacts = artifact_root / args.release_id
        require(not artifacts.exists() and not artifacts.is_symlink(), "Stage artifacts exist; inspect before retrying")
        artifacts.mkdir(mode=0o700)
        shutil.copytree(source, incoming, copy_function=os.link, symlinks=True)
        # Evidence stays outside the publicly served release.
        backup = artifacts / "original"
        backup.mkdir()
        for name, content in original.items():
            saved = backup / name
            saved.parent.mkdir(parents=True, exist_ok=True)
            saved.write_bytes(content)
        (artifacts / "map.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")
        for name, content in changed.items():
            atomic_replace(incoming / name, content)
        for name in FILES[:2]:
            subprocess.run([node, "--check", str(incoming / name)], check=True, capture_output=True)
        require(current.resolve(strict=True) == source, "Current release changed while staging")
        for name in FILES:
            require((source / name).read_bytes() == original[name], "Source changed while staging: " + name)
            require((incoming / name).stat().st_ino != (source / name).stat().st_ino, "Patched asset still shares its source inode")
        evidence = {
            "staged_at": datetime.now(timezone.utc).isoformat(),
            "source_release": str(source), "target_release": str(target),
            "current_switched": False, "version": args.version,
            "manifest_sha256": manifest_hash,
            "before_sha256": {name: digest(data) for name, data in original.items()},
            "after_sha256": {name: digest(data) for name, data in changed.items()},
            "previous_project_slugs": previous_slugs, "project_slugs": new_slugs,
            "coordinates": list(COORDINATES),
            "original_files": str(artifacts / "original"),
        }
        (artifacts / "evidence.json").write_text(json.dumps(evidence, ensure_ascii=False, indent=2) + "\n")
        incoming.rename(target)
        return verify_stage(target, manifest_hash, args.version)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path("/var/www/tencorp-preview"))
    parser.add_argument("--map-json", type=Path, required=True)
    parser.add_argument("--release-id", default=datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ") + "-dormon-map")
    parser.add_argument("--version", help="Asset query version; defaults to release ID")
    args = parser.parse_args()
    args.version = args.version or args.release_id
    try:
        print(json.dumps(stage(args), ensure_ascii=False, indent=2))
    except (ValueError, OSError, subprocess.CalledProcessError) as error:
        print("Dormon portal staging failed: " + str(error), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
