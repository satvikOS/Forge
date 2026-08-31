import json, collections, math
W = "/Users/account_clawteam1/archdisc-Mech/.claude/worktrees/wf_4ddb00d8-b61-2"
def load(p):
    return [json.loads(l) for l in open(p) if l.strip()]
before = load(W + "/forge-kernel/.build-corpus-ab/run-thicken-baseline/results.jsonl")
after  = load(W + "/forge-kernel/.build-corpus-ab/run-thicken-after/results.jsonl")

def fam(rows, f):
    return {r["part"]: r for r in rows if r.get("family") == f and r.get("applicable")}

def rate(d):
    n = len(d)
    nat = sum(1 for r in d.values() if r["native"]["status"] == "OK")
    occ = sum(1 for r in d.values() if r["occt"]["status"] == "OK")
    return n, nat, occ

def mcnemar(b, c):
    # exact two-sided binomial on the discordant pairs
    n = b + c
    if n == 0:
        return 1.0
    k = min(b, c)
    s = sum(math.comb(n, i) for i in range(0, k + 1))
    p = 2.0 * s / (2.0 ** n)
    return min(1.0, p)

print("=" * 78)
print("THICKEN  —  before vs after, SAME 600 parts, SAME derivation, paired")
print("=" * 78)
B = fam(before, "THICKEN")
A = fam(after, "THICKEN")
for tag, d in (("BEFORE", B), ("AFTER ", A)):
    n, nat, occ = rate(d)
    print("  %s  n=%d   native %3d = %5.1f%%   OCCT %3d = %5.1f%%   deletion bucket %d"
          % (tag, n, nat, 100.0 * nat / n, occ, 100.0 * occ / n,
             sum(1 for r in d.values() if r["bucket"] == "OCCT_ONLY")))
common = set(B) & set(A)
print("  parts common to both runs: %d" % len(common))
flip_gain = [p for p in common if B[p]["bucket"] == "OCCT_ONLY" and A[p]["bucket"] == "BOTH_OK"]
flip_loss = [p for p in common if B[p]["bucket"] == "BOTH_OK" and A[p]["bucket"] != "BOTH_OK"]
print("  parts that GAINED (OCCT_ONLY -> BOTH_OK): %d" % len(flip_gain))
print("  parts that LOST   (BOTH_OK -> anything else): %d   %s" % (len(flip_loss), flip_loss[:10]))
print("  McNemar exact two-sided p on the before/after flip: %.3g" % mcnemar(len(flip_gain), len(flip_loss)))

print()
print("  AFTER: native arm status census")
print("   ", dict(collections.Counter(r["native"]["status"] for r in A.values())))
print("  AFTER: remaining deletion bucket, by defer reason")
oo = [r for r in A.values() if r["bucket"] == "OCCT_ONLY"]
for k, v in collections.Counter((r["native"]["status"], r["native"].get("note", "")) for r in oo).most_common():
    print("    %4d  %s  %s" % (v, k[0], k[1]))

print()
print("  AGREEMENT inside BOTH_OK (the correctness question, kept separate)")
for tag, d in (("BEFORE", B), ("AFTER ", A)):
    ok = [r for r in d.values() if r["bucket"] == "BOTH_OK"]
    print("    %s  both_ok %3d   full-vector agree %3d   agree up to orientation %3d"
          % (tag, len(ok), sum(1 for r in ok if r["agree"]),
             sum(1 for r in ok if r["agree_upto_orientation"])))
newly = [A[p] for p in flip_gain]
print("    of the %d newly-built parts, %d agree with OCCT up to solid orientation"
      % (len(newly), sum(1 for r in newly if r["agree_upto_orientation"])))
dis = [r for r in newly if not r["agree_upto_orientation"]]
print("    the %d that do not, and on which observable:" % len(dis))
for r in dis[:8]:
    n, o = r["native"], r["occt"]
    print("      %-9s natF/E/V %d/%d/%d  occtF/E/V %d/%d/%d  |vol| %.10g vs %.10g  (rel %.2e)"
          % (r["part"], n["f"], n["e"], n["v"], o["f"], o["e"], o["v"],
             abs(n["vol"]), abs(o["vol"]),
             abs(abs(n["vol"]) - abs(o["vol"])) / max(1e-30, abs(o["vol"]))))
if dis:
    worst = max(abs(abs(r["native"]["vol"]) - abs(r["occt"]["vol"])) / max(1e-30, abs(r["occt"]["vol"])) for r in dis)
    print("    worst |volume| relative difference among them: %.3e" % worst)
allnew = newly
if allnew:
    worst = max(abs(abs(r["native"]["vol"]) - abs(r["occt"]["vol"])) / max(1e-30, abs(r["occt"]["vol"])) for r in allnew)
    print("    worst |volume| relative difference over ALL %d newly-built parts: %.3e" % (len(allnew), worst))
    print("    newly-built parts that are BRepCheck-VALID: %d of %d"
          % (sum(1 for r in allnew if r["native"]["valid"] == 1), len(allnew)))

print()
print("=" * 78)
print("UNTOUCHED CONTROL FAMILIES — these engines were not modified and must not move")
print("=" * 78)
for f in ("FILLING", "MAKEOFFSET"):
    d = fam(after, f)
    if not d:
        print("  %-11s NOT RUN" % f)
        continue
    n, nat, occ = rate(d)
    print("  %-11s n=%d   native %3d = %5.1f%%   OCCT %3d = %5.1f%%   deletion bucket %d"
          % (f, n, nat, 100.0 * nat / n, occ, 100.0 * occ / n,
             sum(1 for r in d.values() if r["bucket"] == "OCCT_ONLY")))
