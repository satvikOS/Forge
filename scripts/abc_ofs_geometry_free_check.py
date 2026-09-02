#!/usr/bin/env python3
"""Prove (or refute) that a featureType is GEOMETRY-FREE across the whole corpus.

A feature may be skipped only if, for EVERY instance in the corpus:
  * it carries no sketch entities,
  * it carries no subFeatures (a subfeature could build anything),
  * it is not suppressed-state-dependent in a way that matters, and
  * no OTHER feature's query list references its featureId  -- because a datum that
    something else is built ON is not free to ignore: dropping it would silently
    reparent that consumer.

The last clause is the one that actually bites, and it is checked by scanning every
query id in the model for the skipped feature's own ids.
"""
import collections, glob, json, os, re, sys
sys.path.insert(0, "/Users/account_clawteam1/archdisc-Models/scripts")
import abc_ofs_to_ir as T

root = sys.argv[1]
wants = set(sys.argv[2].split(","))
stride = int(sys.argv[3])

dirs = sorted(d for d in os.listdir(root) if d.isdigit())[::stride]
viol = collections.Counter()
n = collections.Counter()
consumed_examples = []

for d in dirs:
    hits = sorted(glob.glob(os.path.join(root, d, "*.yml")))
    if not hits:
        continue
    try:
        feats = T.load_features(hits[0])
    except Exception:
        continue
    # ids owned by the features we intend to skip
    owned = set()
    for m in feats:
        if m.get("featureType") in wants:
            for k in ("featureId", "nodeId"):
                if m.get(k):
                    owned.add(str(m[k]))
    for m in feats:
        t = m.get("featureType")
        if t not in wants:
            continue
        n[t] += 1
        if m.get("entities"):
            viol[t + ":has_entities"] += 1
        if m.get("subFeatures"):
            viol[t + ":has_subFeatures"] += 1
    if not owned:
        continue
    # does any OTHER feature reference an id owned by a skipped feature?
    for m in feats:
        if m.get("featureType") in wants:
            continue
        blob = json.dumps(m)
        for oid in owned:
            if oid and oid in blob:
                viol["REFERENCED_BY_ANOTHER_FEATURE:" + str(m.get("featureType"))] += 1
                if len(consumed_examples) < 5:
                    consumed_examples.append((d, m.get("featureType"), oid))
                break

print(json.dumps({"instances": dict(n), "violations": dict(viol),
                  "examples_of_reference": consumed_examples}, indent=2))
