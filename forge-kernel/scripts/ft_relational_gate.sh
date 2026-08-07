#!/usr/bin/env bash
# ft_relational_gate.sh — the correctness gate for the RELATIONAL placement additions
# to the Unified Feature-Tree IR: EXTRUDE(..., CENTERED) and ALIGN(...).
#
#   usage: scripts/ft_relational_gate.sh [<build-dir>]     (default: ./build)
#
# Runs against forge_verify, which compiles the IR in-process through the same
# forge::ft::compileText the trainer and the harvester use. Exits non-zero on any
# failure and says which check failed.
#
# THE FACE-COUNT RULE. l_bracket_000146 has two readings — an L-angle (the truth)
# and a channel (the model's error) — whose volumes agree to eight significant
# figures. Volume cannot tell them apart; only the face count can (8 vs 10). Every
# assertion below therefore checks faces and edges, never volume alone.
set -euo pipefail

BUILD="${1:-$(cd "$(dirname "$0")/.." && pwd)/build}"
VB="$BUILD/forge_verify"
[ -x "$VB" ] || { echo "FAIL: no forge_verify at $VB (build it first)"; exit 2; }
export DYLD_LIBRARY_PATH="$BUILD/Release:${DYLD_LIBRARY_PATH:-}"

req() { printf '{"id":"%s","ir":"%s","census":"none"}\n' "$1" "$2"; }

# ---- the l_bracket_000146 ground-truth tree, and its relational rewrite ------
GT='%1 = BOX(29.95,29.95,137.97,0,0,-68.985)\n%2 = RECT(26.74,26.74,0,0)\n%3 = EXTRUDE(%2,1303.76)\n%4 = TRANSLATE(%3,0,0,-651.88)\n%5 = TRANSLATE(%4,1.605,1.605,68.985)\n%6 = CUT(%1,%5)\nRESULT(%6)'
REL='%1 = BOX(29.95,29.95,137.97,0,0,-68.985)\n%2 = RECT(26.74,26.74,0,0)\n%3 = EXTRUDE(%2,1303.76,CENTERED)\n%4 = ALIGN(%3,%1,MAX_X,MAX_Y)\n%5 = CUT(%1,%4)\nRESULT(%5)'
# the misreading the relational form must NOT produce: a channel, same volume, 10 faces
CHAN='%1 = BOX(29.95,29.95,137.97,0,0,-68.985)\n%2 = RECT(26.74,26.74,0,0)\n%3 = EXTRUDE(%2,1303.76,CENTERED)\n%4 = ALIGN(%3,%1,MAX_X,MID_Y)\n%5 = CUT(%1,%4)\nRESULT(%5)'
# EXTRUDE CENTERED vs the two-op pair it collapses, on a curved profile
C2A='%1 = CIRCLE(17.25,3,-2)\n%2 = EXTRUDE(%1,88.4)\n%3 = TRANSLATE(%2,0,0,-44.2)\nRESULT(%3)'
C2B='%1 = CIRCLE(17.25,3,-2)\n%2 = EXTRUDE(%1,88.4,CENTERED)\nRESULT(%2)'
# ALIGN must use the ANALYTIC extent of a cylinder, not a facet chord
CYL='%1 = BOX(100,60,20,0,0,0)\n%2 = CYL(17.253171,9,0,0,0)\n%3 = ALIGN(%2,%1,MAX_X,MIN_Y,ABUT_MAX_Z)\nRESULT(%3)'
# a relation that constrains nothing, or an axis twice, must fail LOUDLY
BAD1='%1 = BOX(10,10,10,0,0,0)\n%2 = BOX(4,4,4,0,0,0)\n%3 = ALIGN(%2,%1)\nRESULT(%3)'
BAD2='%1 = BOX(10,10,10,0,0,0)\n%2 = BOX(4,4,4,0,0,0)\n%3 = ALIGN(%2,%1,MIN_X,MAX_X)\nRESULT(%3)'

OUT=$( { req gt "$GT"; req rel "$REL"; req chan "$CHAN"; req c2a "$C2A"; req c2b "$C2B";
         req cyl "$CYL"; req bad1 "$BAD1"; req bad2 "$BAD2"; } | "$VB" 2>/dev/null )

python3 - "$OUT" <<'PY'
import json, sys
R = {}
for line in sys.argv[1].splitlines():
    if line.strip():
        j = json.loads(line); R[j['id']] = j
fail = []
def census(k):
    j = R[k]
    return (j['ok'], j.get('volume'), j.get('faceCount'), j.get('edgeCount'), j.get('bbox'))

# 1. the relational rewrite reproduces ground truth EXACTLY
if census('rel') != census('gt'):
    fail.append("ALIGN+CENTERED != ground truth: %s vs %s" % (census('rel'), census('gt')))
# 2. and it is the L-ANGLE, named absolutely
g = R['rel']
if not (g['ok'] and g.get('faceCount') == 8 and g.get('edgeCount') == 18
        and abs(g.get('volume', 0) - 25107.0766) < 1e-3):
    fail.append("l_bracket_000146 is not the L-angle: %s %s" % (census('rel'), g.get('error', '')))
# 3. the channel misreading has the SAME VOLUME and a different face count — the
#    reason this gate never trusts volume
c = R['chan']
if not (c['ok'] and abs(c.get('volume', 0) - g.get('volume', -1)) < 1e-3
        and c.get('faceCount') == 10):
    fail.append("channel control did not behave as recorded: %s %s"
                % (census('chan'), c.get('error', '')))
# 4. CENTERED == the two-op pair, to the bit
if census('c2a')[1:] != census('c2b')[1:]:
    fail.append("EXTRUDE CENTERED != EXTRUDE+TRANSLATE: %s vs %s"
                % (census('c2a'), census('c2b')))
# 5. ALIGN bounds a cylinder analytically: 50 - 2*17.253171 = 15.493658 exactly
bb = R['cyl'].get('bbox') or {'min': [1e30] * 3, 'max': [1e30] * 3}
if not (R['cyl']['ok'] and abs(bb['min'][0] - 15.493658) < 5e-7 and abs(bb['max'][0] - 50) < 5e-7
        and abs(bb['min'][1] + 30) < 5e-7 and abs(bb['min'][2] - 20) < 5e-7):
    fail.append("ALIGN did not use the analytic cylinder extent: %s" % bb)
# 6. loud failure, not a silent no-op
for k, want in (('bad1', 'no axis relation'), ('bad2', 'constrained twice')):
    if R[k]['ok'] or want not in R[k]['error']:
        fail.append("%s should have failed loudly with %r, got %r" % (k, want, R[k]['error']))

if fail:
    print("FT RELATIONAL GATE: FAIL")
    for f in fail: print("  -", f)
    sys.exit(1)
print("FT RELATIONAL GATE: PASS  (6 checks)")
PY
