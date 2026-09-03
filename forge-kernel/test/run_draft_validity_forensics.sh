#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# run_draft_validity_forensics.sh — build and run test/draft_validity_forensics
# over the parts on which the general native draft RETURNS a solid BRepCheck
# rejects, and answer the only question that licenses that carry:
#
#   is the invalidity the ENGINE'S, or the DRAFT'S?
#
# Two measurements per part, neither of which is an inference:
#   * the BRepCheck STATUS MULTISET of both engines' answers. Identical multisets
#     mean the native answer carries the incumbent's own defect and nothing else.
#   * the VALIDITY THRESHOLD, bisected independently per arm. Two engines whose
#     thresholds are the same angle, on parts that each have their own threshold,
#     have agreed about the geometry rather than about one draft angle.
#
# THE PART LIST COMES FROM A COMPLETED PROBE RUN, never from a hand-written list:
# rows where the native arm BUILT and its solid is not BRepCheck-valid. If a
# future change stops carrying a part, this script stops examining it, and if it
# starts carrying a new one this script picks it up without being edited.
#
# usage: test/run_draft_validity_forensics.sh <run-dir-of-a-completed-probe>
#   env: CORPUS=<dir>  OCCT_ROOT=<dir>
#
# exit: 0 iff every examined part has IDENTICAL status multisets on both engines
#       AND the two thresholds agree to THRESH_TOL degrees. A carry that cannot
#       be justified part by part is a FAILURE here, not a footnote.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail
KERNEL="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$KERNEL" || exit 2

RUNDIR="${1:-}"
[ -n "$RUNDIR" ] && [ -f "$RUNDIR/results.jsonl" ] || {
  echo "usage: $0 <run-dir containing results.jsonl from run_draft_local_probe.sh>" >&2; exit 2; }
CORPUS="${CORPUS:-/Users/account_clawteam1/archdisc-Models/runs/composite_anchor/expert3d_v5cap_e600/gold_ref_steps}"
THRESH_TOL="${THRESH_TOL:-0.001}"
[ -d "$CORPUS" ] || { echo "FATAL: corpus dir not found: $CORPUS" >&2; exit 2; }

OCCT="${OCCT_ROOT:-/opt/homebrew/opt/opencascade}"
[ -e "$OCCT/include/opencascade/Standard_Version.hxx" ] || OCCT=/usr/local/opt/opencascade
[ -e "$OCCT/include/opencascade/Standard_Version.hxx" ] || {
  echo "FATAL: OCCT not found (set OCCT_ROOT)" >&2; exit 2; }

OBJ="${OBJDIR:-$KERNEL/.build-draft-forensics}"
mkdir -p "$OBJ" || exit 2
BIN="$OBJ/draft_validity_forensics"
FLAGS="-std=c++20 -O2 -DFORGE_NATIVE_BREP"
# shellcheck disable=SC2086
if ! clang++ $FLAGS -I include -I "$OCCT/include/opencascade" \
     src/native/brep/NativeDraftLocal.cpp src/native/geom/NativePCurveFit.cpp \
     test/draft_validity_forensics.cpp \
     -L "$OCCT/lib" -Wl,-rpath,"$OCCT/lib" \
     -lTKernel -lTKMath -lTKG2d -lTKG3d -lTKGeomBase -lTKBRep -lTKTopAlgo -lTKPrim \
     -lTKGeomAlgo -lTKBO -lTKBool -lTKShHealing -lTKFillet -lTKOffset -lTKDESTEP -lTKXSBase \
     -o "$BIN" 2> "$OBJ/build.err"; then
  echo "[draft-forensics] BUILD FAILED — a gate that cannot build cannot fail:" >&2
  tail -30 "$OBJ/build.err" >&2
  exit 1
fi

PARTS="$(python3 - "$RUNDIR/results.jsonl" <<'PY'
import json, sys
for line in open(sys.argv[1]):
    line = line.strip()
    if not line: continue
    try: r = json.loads(line)
    except Exception: continue
    if r.get('status') == 'OK' and r.get('nat_valid') is False:
        print(r['part'])
PY
)"
N="$(printf '%s\n' "$PARTS" | grep -c . )"
echo "[draft-forensics] $N part(s) where the engine RETURNED a BRepCheck-invalid solid"
if [ "$N" -eq 0 ]; then
  echo "[draft-forensics] nothing carried in this run — nothing to justify."
  exit 0
fi

OUT="$RUNDIR/validity_forensics.txt"
: > "$OUT"
for p in $PARTS; do
  [ -n "$p" ] || continue
  "$BIN" "$CORPUS/$p.step" "$p" >> "$OUT" 2>/dev/null \
    || printf '%s FORENSICS_FAILED\n' "$p" >> "$OUT"
done

python3 - "$OUT" "$THRESH_TOL" <<'PY'
import re, sys, collections
rows = [l.strip() for l in open(sys.argv[1]) if l.strip()]
tol = float(sys.argv[2])
bad = []
diffs = []
sigs = collections.Counter()
for l in rows:
    m = re.match(r'(\S+) native_threshold_deg=(\S+) occt_threshold_deg=(\S+) '
                 r'abs_diff_deg=(\S+) nat_status=(\S+) occt_status=(\S+) same_status=(\S+)', l)
    if not m:
        bad.append(('unreadable', l)); continue
    part, tn, to, d, sn, so, same = m.group(1), float(m.group(2)), float(m.group(3)), \
                                    float(m.group(4)), m.group(5), m.group(6), m.group(7)
    sigs[sn] += 1
    if same != 'yes':
        bad.append(('status multiset differs from OCCT', l))
    if tn <= 0 or to <= 0:
        bad.append(('no threshold on one arm', l))
    elif d > tol:
        bad.append(('thresholds disagree by %.3e deg' % d, l))
    else:
        diffs.append(d)
print('[draft-forensics] %d part(s) examined' % len(rows))
print('  identical native/OCCT status multiset : %d' % (len(rows) - len([b for b in bad if 'multiset' in b[0]])))
print('  max |native threshold - OCCT threshold| : %.3e deg (tolerance %.3e)'
      % (max(diffs) if diffs else -1.0, tol))
print('  distinct thresholds                     : %d of %d parts'
      % (len({round(float(re.search(r'native_threshold_deg=(\S+)', l).group(1)), 4)
              for l in rows if 'native_threshold_deg' in l}), len(rows)))
print('  signatures:')
for k, v in sigs.most_common():
    print('    %4d  %s' % (v, k))
if bad:
    print('[draft-forensics] FAIL — %d part(s) the carry cannot justify:' % len(bad))
    for why, l in bad[:20]:
        print('    %s | %s' % (why, l))
    sys.exit(1)
print('[draft-forensics] PASS — every carried part carries OCCT\'s own defect, at OCCT\'s own angle')
PY
