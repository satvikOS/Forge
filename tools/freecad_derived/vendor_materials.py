#!/usr/bin/env python3
# ============================================================================
# vendor_materials.py -- (re)derive third_party/freecad-derived/materials from a
# FreeCAD checkout, and write the component record the compliance gate reads.
#
# This is FORGE'S OWN TOOL. It lives in Forge's tree, not in the LGPL directory,
# and it copies nothing of Forge's into that directory: it copies FreeCAD's own
# material cards and model definitions, byte for byte, and records what it took.
#
# WHAT IT TAKES, AND THE RULE THAT DECIDES IT
#   * Resources/Materials/Standard/**.FCMat whose own `General: License:` field
#     is an LGPL licence. The cards in that tree carry SIX different licences
#     (measured at 0a45a0a: LGPL-2.0-or-later 110, LGPL-2.1-or-later 5,
#     CC-BY-3.0 18, CC-BY-4.0 3, CC-BY-SA-4.0 4), and the owner's decision
#     covers LGPL code. A CC-BY-SA or GPL card is NOT taken on the strength of
#     living in an LGPL repository -- its own header says otherwise.
#   * every model definition (Resources/Models/**.yml) a taken card names by
#     UUID, and every model those inherit, so the Forge loader can check each
#     value's unit against the unit FreeCAD itself declares for that property.
#   * nothing else: no Appearance, Patterns, Machining, Fluid or Test cards, no
#     Qt/Python code, no rendering models.
#
# usage:
#   python3 tools/freecad_derived/vendor_materials.py --upstream <FreeCAD checkout>
#   python3 tools/freecad_derived/vendor_materials.py --check   # record == disk
# ============================================================================
import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys

REPO = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
COMPONENT = os.path.join(REPO, "third_party", "freecad-derived", "materials")
RECORD = os.path.join(COMPONENT, "component.json")
UPSTREAM_SUBTREE = "src/Mod/Material/Resources"
ALLOWED_CARD_LICENCES = ("LGPL-2.0-or-later", "LGPL-2.1-or-later")


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        h.update(fh.read())
    return h.hexdigest()


def card_field(text, key):
    m = re.search(r"^\s+%s:\s*[\"']?([^\"'\n]*)[\"']?\s*$" % re.escape(key), text, re.M)
    return m.group(1).strip() if m else None


def model_uuids_named_by(text, section):
    """UUIDs listed under a top-level section (Models / Inherits) of a card or model."""
    out = []
    in_section = False
    for line in text.splitlines():
        if re.match(r"^[A-Za-z]", line):
            in_section = line.startswith(section + ":")
            continue
        if in_section:
            m = re.match(r"^\s+UUID:\s*['\"]([0-9a-f-]{36})['\"]", line)
            if m:
                out.append(m.group(1))
    return out


def model_inherits(text):
    out = []
    in_inh = False
    for line in text.splitlines():
        if re.match(r"^  Inherits:\s*$", line):
            in_inh = True
            continue
        if in_inh:
            if re.match(r"^  [A-Za-z]", line):
                break
            m = re.search(r"UUID:\s*['\"]([0-9a-f-]{36})['\"]", line)
            if m:
                out.append(m.group(1))
    return out


def derive(upstream):
    res = os.path.join(upstream, UPSTREAM_SUBTREE)
    if not os.path.isdir(res):
        sys.exit("no %s under %s" % (UPSTREAM_SUBTREE, upstream))
    models = {}
    for dp, _, fn in os.walk(os.path.join(res, "Models")):
        for f in fn:
            if f.endswith(".yml"):
                p = os.path.join(dp, f)
                t = open(p, encoding="utf-8").read()
                m = re.search(r"^  UUID:\s*['\"]([0-9a-f-]{36})['\"]", t, re.M)
                if m:
                    models[m.group(1)] = (os.path.relpath(p, res), t)
    taken, skipped = [], {}
    for dp, _, fn in sorted(os.walk(os.path.join(res, "Materials", "Standard"))):
        for f in sorted(fn):
            if not f.endswith(".FCMat"):
                continue
            p = os.path.join(dp, f)
            t = open(p, encoding="utf-8-sig").read()
            lic = card_field(t, "License") or "(none)"
            if lic in ALLOWED_CARD_LICENCES:
                taken.append((os.path.relpath(p, res), t, lic))
            else:
                skipped[lic] = skipped.get(lic, 0) + 1
    need, stack = set(), []
    for _, t, _ in taken:
        stack.extend(model_uuids_named_by(t, "Models"))
    while stack:
        u = stack.pop()
        if u in need:
            continue
        if u not in models:
            sys.exit("a taken card names model %s, which the upstream tree does not define" % u)
        need.add(u)
        stack.extend(model_inherits(models[u][1]))
    return res, taken, skipped, sorted(models[u][0] for u in need)


def upstream_commit(upstream):
    try:
        return subprocess.check_output(["git", "-C", upstream, "rev-parse", "HEAD"],
                                       text=True).strip()
    except Exception:
        return None


def write(upstream):
    res, taken, skipped, model_paths = derive(upstream)
    commit = upstream_commit(upstream)
    if not commit or not re.fullmatch(r"[0-9a-f]{40}", commit):
        sys.exit("cannot read the upstream commit; refusing to record an unpinned import")
    dest_root = os.path.join(COMPONENT, "Resources")
    if os.path.isdir(dest_root):
        shutil.rmtree(dest_root)
    files = []
    for rel, _, lic in taken:
        src = os.path.join(res, rel)
        dst = os.path.join(dest_root, rel)
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        shutil.copyfile(src, dst)
        files.append({"path": "Resources/" + rel, "kind": "card", "license": lic,
                      "sha256": sha256(dst)})
    for rel in model_paths:
        src = os.path.join(res, rel)
        dst = os.path.join(dest_root, rel)
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        shutil.copyfile(src, dst)
        head = open(dst, encoding="utf-8").read(1500)
        m = re.search(r"SPDX-License-Identifier:\s*(\S+)", head)
        lic = m.group(1) if m else None
        # Four model files at 0a45a0a carry no SPDX line, only the long-form
        # header. Read what that header SAYS rather than assuming the repository's
        # licence: "GNU Lesser General Public License ... either version 2 of the
        # License, or (at your option) any later version" is LGPL-2.0-or-later.
        flat = re.sub(r"[#*\s]+", " ", head)
        if lic is None and re.search(r"GNU Lesser General Public License \(LGPL\) as published by "
                                     r"the Free Software Foundation; either version 2 of the "
                                     r"License, or \(at your option\) any later version", flat):
            lic = "LGPL-2.0-or-later"
        if lic not in ALLOWED_CARD_LICENCES:
            sys.exit("model %s states licence %r, which is not an accepted LGPL licence" % (rel, lic))
        files.append({"path": "Resources/" + rel, "kind": "model",
                      "license": lic, "sha256": sha256(dst)})
    record = load_record() if os.path.exists(RECORD) else {}
    record.update({
        "schema": "forge.freecad_derived.component/1",
        "component": "materials",
        "path": "third_party/freecad-derived/materials",
        "upstream": {
            "repository": "https://github.com/FreeCAD/FreeCAD",
            "commit": commit,
            "subtree": UPSTREAM_SUBTREE + "/",
        },
        "license": {
            "spdx": "LGPL-2.1-or-later",
            "card_licences_accepted": list(ALLOWED_CARD_LICENCES),
            "text": "COPYING.LGPL",
        },
        "linkage": {
            "kind": "shared",
            "cmake_target": "forge_fcmaterials",
            "library": "libforge_fcmaterials.dylib",
            "installed_to": "Forge.app/Contents/Frameworks",
        },
        "skipped_cards_by_licence": dict(sorted(skipped.items())),
        "files": files,
    })
    with open(RECORD, "w", encoding="utf-8") as fh:
        json.dump(record, fh, indent=2, ensure_ascii=False)
        fh.write("\n")
    print("took %d cards and %d model files from %s; skipped %s"
          % (len(taken), len(model_paths), commit[:12], skipped))


def load_record():
    with open(RECORD, encoding="utf-8") as fh:
        return json.load(fh)


def check():
    if not os.path.exists(RECORD):
        print("RED: %s is missing" % os.path.relpath(RECORD, REPO))
        return 1
    rec = load_record()
    bad = 0
    listed = set()
    for f in rec.get("files", []):
        p = os.path.join(COMPONENT, f["path"])
        listed.add(os.path.normpath(p))
        if not os.path.exists(p):
            print("RED: recorded file is missing: %s" % f["path"])
            bad += 1
        elif sha256(p) != f["sha256"]:
            print("RED: %s differs from the recorded import (sha256)" % f["path"])
            bad += 1
    for dp, _, fn in os.walk(os.path.join(COMPONENT, "Resources")):
        for f in fn:
            p = os.path.normpath(os.path.join(dp, f))
            if p not in listed:
                print("RED: %s is in the bundle but not in the record"
                      % os.path.relpath(p, COMPONENT))
                bad += 1
    print("%s: %d files, %d finding(s)" % ("GREEN" if bad == 0 else "RED",
                                           len(rec.get("files", [])), bad))
    return 1 if bad else 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--upstream")
    ap.add_argument("--check", action="store_true")
    a = ap.parse_args()
    if a.check:
        return check()
    if not a.upstream:
        ap.error("--upstream or --check is required")
    write(a.upstream)
    return check()


if __name__ == "__main__":
    sys.exit(main())
