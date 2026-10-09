#!/bin/bash
# T-236: `claim` must refuse a task that is already IN_PROGRESS under ANOTHER owner.
# MEASURED 2026-10-09 on the live ledger: wf3-occtio claimed T-272 at 23:31:44Z although
# wf3-stepread had held it since 23:25:54Z, and nothing refused -- two agents owned one task.
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FP="${FORGE_PROGRAM_BIN:-$HERE/../bin/forge-program}"
export FORGE_PROGRAM_DIR="$(mktemp -d "${TMPDIR:-/tmp}/fp_claim.XXXXXX")"
trap 'rm -rf "$FORGE_PROGRAM_DIR"' EXIT
P=0; F=0
ck() { if [ "$2" = 0 ]; then P=$((P+1)); echo "  ok   $1"; else F=$((F+1)); echo "  FAIL $1"; fi; }
"$FP" add T-900 --title "a task" --write-set "x/a.cpp" --acceptance "a" >/dev/null || { echo "add failed"; exit 2; }
"$FP" claim T-900 --owner alice >/dev/null 2>&1; ck "alice claims a TODO task" $?
out=$("$FP" claim T-900 --owner bob 2>&1); rc=$?
[ $rc -ne 0 ] && echo "$out" | grep -q "already IN_PROGRESS under owner alice"; ck "bob is REFUSED while alice holds it (rc=$rc)" $?
owner=$(python3 -c "import json,os; print(json.load(open(os.path.join(os.environ['FORGE_PROGRAM_DIR'],'tasks.json')))['tasks']['T-900'].get('owner'))")
[ "$owner" = alice ]; ck "the owner is still alice (got $owner)" $?
"$FP" claim T-900 --owner alice >/dev/null 2>&1; ck "alice re-claiming her own task is harmless" $?
"$FP" reset T-900 >/dev/null 2>&1 && "$FP" claim T-900 --owner bob >/dev/null 2>&1; ck "after an explicit reset, bob can claim" $?
# Write-set overlap: a DIFFERENT owner is refused; the SAME owner's stacked task is not
# (MESHER2 2026-10-09: T-255 refused 4x for FeaTet.cpp overlapping its own T-253/T-256).
"$FP" add T-901 --title "stacked base" --write-set "y/FeaTet.cpp" --acceptance "a" >/dev/null
"$FP" add T-902 --title "stacked next" --write-set "y/FeaTet.cpp,y/gate.cpp" --acceptance "a" >/dev/null
"$FP" claim T-901 --owner carol >/dev/null 2>&1; ck "carol claims the base task" $?
out=$("$FP" claim T-902 --owner dave 2>&1); rc=$?
[ $rc -ne 0 ] && echo "$out" | grep -q "overlaps IN_PROGRESS task T-901"; ck "dave is REFUSED on the overlapping file (rc=$rc)" $?
"$FP" claim T-902 --owner carol >/dev/null 2>&1; ck "carol may claim her own stacked task on the same file" $?
echo "[claim-owner] $P passed, $F failed"; [ $F -eq 0 ]
