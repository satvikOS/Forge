#!/usr/bin/env python3
"""PAIRED kernel A/B on the REAL corpus: what did the SARC fix change?

The full differential gate is OCP-bound (an exact IoU by two OCCT booleans per model)
and takes hours. But the question "does the FIXED kernel build a different solid from
the OLD one, on the trees this corpus is made of" needs no OCP at all: it needs the same
emitted IR through both binaries, compared observable by observable.

PAIRED PER MODEL, because an aggregate that improves is compatible with a change that
fixes twelve models and breaks two. The transition table is the claim.
"""
import collections, json, subprocess, sys

NEW = "/Users/account_clawteam1/archdisc-Mech/.claude/worktrees/wf_70fa45d9-6be-1/forge-kernel/build-sarc/forge_verify"
OLD = "/private/tmp/claude-501/-Users-account-clawteam1/8e894a02-52d3-4e26-a3a3-5c26cd2b228c/scratchpad/oldtree/forge-kernel/build-old/forge_verify"
EMITTED = "/private/tmp/claude-501/-Users-account-clawteam1/8e894a02-52d3-4e26-a3a3-5c26cd2b228c/scratchpad/v_new_full/emitted.jsonl"

rows = [json.loads(l) for l in open(EMITTED)]
print(f"emitted trees: {len(rows)}")
has_arc = {r["id"]: ("SARC(" in r["ir"]) for r in rows}
print(f"  of which contain >=1 SARC: {sum(has_arc.values())}")


def run(binpath, recs):
    """One subprocess per model, so one pathological model cannot hang the batch."""
    out = {}
    for i, r in enumerate(recs, 1):
        if i % 100 == 0:
            print(f"    {i}/{len(recs)}", file=sys.stderr, flush=True)
        line = json.dumps({"id": r["id"], "ir": r["ir"]}) + "\n"
        try:
            pr = subprocess.run([binpath], input=line, capture_output=True,
                                text=True, timeout=120)
        except subprocess.TimeoutExpired:
            out[r["id"]] = {"ok": False, "error": "TIMEOUT"}
            continue
        for ln in pr.stdout.splitlines():
            ln = ln.strip()
            if ln.startswith("{"):
                try:
                    j = json.loads(ln)
                    if j.get("id") == r["id"]:
                        out[r["id"]] = j
                except Exception:
                    pass
        out.setdefault(r["id"], {"ok": False, "error": "NO RECORD"})
    return out


print("running OLD kernel ...", file=sys.stderr)
old = run(OLD, rows)
print("running NEW kernel ...", file=sys.stderr)
new = run(NEW, rows)

OBS = ("valid", "volume", "faceCount", "edgeCount", "vertexCount", "genus", "shellCount")


def close(a, b):
    if isinstance(a, float) or isinstance(b, float):
        if a is None or b is None:
            return a == b
        d = abs(a - b)
        return d <= 1e-6 * max(1.0, abs(a), abs(b))
    return a == b


trans = collections.Counter()
diff_obs = collections.Counter()
differing = []
for r in rows:
    i = r["id"]
    o, n = old.get(i, {}), new.get(i, {})
    ook, nok = bool(o.get("ok")), bool(n.get("ok"))
    # "built something" = ok AND a non-zero volume. The old kernel's failure mode was
    # ok:true with volume 0, so ok alone does not describe it.
    obuilt = ook and bool(o.get("valid")) and (o.get("volume") or 0) > 0
    nbuilt = nok and bool(n.get("valid")) and (n.get("volume") or 0) > 0
    trans[f"{'built' if obuilt else 'NOT'} -> {'built' if nbuilt else 'NOT'}"] += 1
    if obuilt and nbuilt:
        ds = [k for k in OBS if not close(o.get(k), n.get(k))]
        if ds:
            diff_obs["+".join(ds)] += 1
            differing.append((i, {k: (o.get(k), n.get(k)) for k in ds}))

print()
print("=== PAIRED TRANSITION (old kernel -> new kernel), n=%d ===" % len(rows))
for k, v in sorted(trans.items()):
    print(f"  {k:20s} {v}")
print()
print("=== among trees BOTH built: observables that disagree ===")
if not diff_obs:
    print("  none")
for k, v in diff_obs.most_common():
    print(f"  {k:45s} {v}")
print()
gained = [r["id"] for r in rows
          if not (old.get(r["id"], {}).get("ok") and old.get(r["id"], {}).get("valid") and (old.get(r["id"], {}).get("volume") or 0) > 0)
          and (new.get(r["id"], {}).get("ok") and new.get(r["id"], {}).get("valid") and (new.get(r["id"], {}).get("volume") or 0) > 0)]
lost = [r["id"] for r in rows
        if (old.get(r["id"], {}).get("ok") and old.get(r["id"], {}).get("valid") and (old.get(r["id"], {}).get("volume") or 0) > 0)
        and not (new.get(r["id"], {}).get("ok") and new.get(r["id"], {}).get("valid") and (new.get(r["id"], {}).get("volume") or 0) > 0)]
print(f"GAINED (old failed -> new builds): {len(gained)}   of which contain an arc: "
      f"{sum(1 for i in gained if has_arc.get(i))}")
print(f"LOST   (old built  -> new fails ): {len(lost)}    of which contain an arc: "
      f"{sum(1 for i in lost if has_arc.get(i))}")
print()
print("first 8 gained:", gained[:8])
if lost:
    print("LOST ids:", lost)
print()
print("first 5 solids that differ while both built:")
for i, d in differing[:5]:
    print(" ", i, d)
