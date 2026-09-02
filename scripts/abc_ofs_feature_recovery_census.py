#!/usr/bin/env python3
"""Which unsupported feature, if implemented, unlocks the most ABC models?

PAIRED and MODEL-LEVEL: a model blocked by three things is not unlocked by fixing
one of them, so instance counts are worthless here. For every model we take the SET
of gate violations, and ask -- per candidate feature F -- how many models would clear
EVERY gate if F (and nothing else) became supported. That is the recovery.
"""
import collections, glob, json, os, sys
sys.path.insert(0, "/Users/account_clawteam1/archdisc-Models/scripts")
import abc_ofs_to_ir as T

root = sys.argv[1]
stride = int(sys.argv[2]) if len(sys.argv) > 2 else 1

dirs = sorted(d for d in os.listdir(root) if d.isdigit())[::stride]
per_model = []       # (set of non-feature refusal reasons, set of unsupported feature names)
n_read = 0
crash = collections.Counter()
for d in dirs:
    hits = sorted(glob.glob(os.path.join(root, d, "*.yml")))
    if not hits:
        crash["no_yml"] += 1; continue
    try:
        feats = T.load_features(hits[0])
        viol = T.gate_violations(feats)
    except Exception as e:
        crash["parse:" + type(e).__name__] += 1; continue
    n_read += 1
    other, unsup = set(), set()
    for reason, detail in viol:
        if reason == "unsupported_feature":
            unsup.add(detail)
        else:
            other.add(reason)
    per_model.append((other, unsup))

clean_now = sum(1 for o, u in per_model if not o and not u)
only_feats = [u for o, u in per_model if not o and u]
print(json.dumps({
    "models_read": n_read,
    "crash": dict(crash),
    "clear_every_gate_today": clean_now,
    "blocked_ONLY_by_unsupported_features": len(only_feats),
    "feature_instances_among_those": dict(collections.Counter(
        f for u in only_feats for f in u).most_common(25)),
    "recovery_if_this_ONE_feature_supported": dict(collections.Counter(
        next(iter(u)) for u in only_feats if len(u) == 1).most_common(25)),
}, indent=2))

have = set()
rows = []
for _ in range(12):
    best, bestn = None, -1
    cand = set(f for u in only_feats for f in u) - have
    for f in cand:
        n = sum(1 for u in only_feats if u <= (have | {f}))
        if n > bestn:
            best, bestn = f, n
    if best is None:
        break
    have.add(best)
    rows.append({"add": best, "cumulative_models_unlocked": bestn,
                 "total_translatable": clean_now + bestn})
print(json.dumps({"greedy_cumulative": rows}, indent=2))
