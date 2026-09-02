#!/usr/bin/env bash
# sarc_ring_mutation.sh — PROOF THAT sarc_ring_gate CAN FAIL.
#
# A regression test that has never been shown to go red is a decoration. This
# script mutates each of the two fixes the gate exists to protect, ONE AT A TIME,
# rebuilds the gate against the mutant, runs it, and restores the file. It
# asserts the gate is GREEN unmutated and RED against BOTH mutants, and it fails
# if any part of that does not hold. One mutant is not enough here: the two fixes
# live in different files and are covered by different cases, so a single mutant
# would leave one of them unproven.
#
#   MUTANT A — src/Sketcher.cpp, extractWires: the consistent-circle recovery
#     if (!mk.IsDone()) {   ->   if (false && !mk.IsDone()) {
#   It deliberately leaves the loud `throw` in place, so the mutant does not
#   resurrect the old SILENT drop — it refuses instead. Either way the gate must
#   go red: case 1 (ABC 00001907) and case 2 (the 5e-7 mm perturbation) both need
#   that arc to BUILD.
#
#   MUTANT B — src/ft/FeatureTreeCompiler.cpp, the end of compile(): the gate
#     if (!out.valid) {     ->   if (false && !out.valid) {
#   which restores exactly the defect case 4 pins — a body the kernel has already
#   measured as invalid, and already named the op for, reported as ok=true.
#
# Usage:  bash forge-kernel/test/sarc_ring_mutation.sh [<build dir>]
# Default build dir: forge-kernel/build-sarc-mutation (created if absent).

set -u
here="$(cd "$(dirname "$0")" && pwd)"
kernel="$(cd "$here/.." && pwd)"
build="${1:-$kernel/build-sarc-mutation}"
backup=""
backup_of=""

# make compares mtimes at ONE-SECOND granularity, and a mutate-build-restore cycle
# finishes well inside one second: the restored source and the mutant object then
# carry the SAME timestamp, make calls the target up to date, and the next run
# tests the STALE MUTANT BINARY while calling it the baseline. Measured here, and
# it reported the unmutated gate as red. Deleting the object is mtime-independent,
# so it cannot come back.
drop_object() {
    local stem
    stem="$(basename "$1")"
    find "$build" -name "$stem.o" -delete 2>/dev/null
}

restore() {
    if [ -n "$backup" ] && [ -s "$backup" ]; then
        cp "$backup" "$backup_of"
        rm -f "$backup"
        drop_object "$backup_of"
        echo "  [restore] $backup_of restored"
        backup=""
    fi
}
trap restore EXIT INT TERM

configure_and_build() {
    cmake -S "$kernel" -B "$build" -DCMAKE_BUILD_TYPE=Release \
          -DFORGE_BUILD_DESKTOP_FOUNDATION=ON >/dev/null 2>&1 || return 1
    cmake --build "$build" --target forge_gate_sarc_ring_gate -j "${JOBS:-8}" >/dev/null 2>&1
}

# mutate <file> <from> <to> — exactly one occurrence, or the premise has moved.
mutate() {
    backup_of="$1"
    backup="$(mktemp -t sarc_ring_mutation)"
    cp "$1" "$backup"
    MUT_FILE="$1" MUT_FROM="$2" MUT_TO="$3" python3 - <<'PY'
import os, sys
p, frm, to = os.environ["MUT_FILE"], os.environ["MUT_FROM"], os.environ["MUT_TO"]
s = open(p).read()
if s.count(frm) != 1:
    sys.stderr.write("mutation site occurs %d times, expected 1\n" % s.count(frm))
    sys.exit(1)
open(p, "w").write(s.replace(frm, to))
PY
    local st=$?
    [ $st -eq 0 ] && drop_object "$1"
    return $st
}

rc=0

echo "== BASELINE: the gate against the unmutated tree"
drop_object "$kernel/src/Sketcher.cpp"
drop_object "$kernel/src/ft/FeatureTreeCompiler.cpp"
configure_and_build || { echo "  configure/build failed"; exit 3; }
"$build/forge_gate_sarc_ring_gate" > "$build/baseline.out" 2>&1
base_rc=$?
tail -2 "$build/baseline.out" | sed 's/^/  /'
echo "  exit=$base_rc"
if [ "$base_rc" -ne 0 ]; then
    echo "  [FAIL] the gate is RED on the unmutated tree — fix that before reading anything below"
    exit 1
fi
echo "  [ok  ] the gate is GREEN on the unmutated tree"

run_mutant() {
    local name="$1" file="$2" from="$3" to="$4"
    echo
    echo "== MUTANT $name: $(basename "$file")"
    if ! mutate "$file" "$from" "$to"; then
        echo "  [FAIL] the mutation site was not found — the gate's premise has moved"
        rc=1
        return
    fi
    echo "  mutation applied"
    if ! configure_and_build; then
        echo "  configure/build failed"
        restore
        rc=1
        return
    fi
    "$build/forge_gate_sarc_ring_gate" > "$build/mutant_$name.out" 2>&1
    local mrc=$?
    grep -E "^ *\[FAIL\]|RESULT:" "$build/mutant_$name.out" | sed 's/^/  /'
    echo "  exit=$mrc"
    restore
    if [ "$mrc" -eq 0 ]; then
        echo "  [FAIL] the gate is GREEN against mutant $name — it does not test this fix"
        rc=1
    else
        echo "  [ok  ] the gate is RED against mutant $name (exit $mrc) — it can fail"
    fi
}

run_mutant A "$kernel/src/Sketcher.cpp" \
  '        if (!mk.IsDone()) {
            const gp_Vec d(sp, ep);' \
  '        if (false && !mk.IsDone()) {   // MUTANT A: recovery disabled
            const gp_Vec d(sp, ep);'

run_mutant B "$kernel/src/ft/FeatureTreeCompiler.cpp" \
  '    if (!out.valid) {
        out.ok = false;' \
  '    if (false && !out.valid) {   // MUTANT B: the validity gate disabled
        out.ok = false;'

echo
echo "== REBUILD the unmutated gate (so the build tree is not left holding a mutant)"
configure_and_build || echo "  (rebuild failed — rerun cmake yourself)"

echo
echo "== VERDICT"
[ "$rc" -eq 0 ] && echo "  the gate is green unmutated and red against BOTH mutants" \
               || echo "  see the [FAIL] lines above"
exit $rc
