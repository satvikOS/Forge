#!/usr/bin/env bash
# gate_registration_ratchet.sh — is every forge-kernel GATE actually wired in?
#
# WHY THIS EXISTS. forge-desktop already has this check
# (.github/workflows/gate-registration.yml, "every forge-desktop gate is executed,
# not merely built"). The kernel had none, and the cost was concrete: answering
# "did my gate run?" for PR #210 required hand-tracing job logs, because a green
# check tally proves jobs passed and says NOTHING about whether a given gate was
# among them.
#
# ── THE ASYMMETRY IT CLOSES ──────────────────────────────────────────────────
# REMOVING a wired gate is already caught: its job stops running and something
# goes red. ADDING a gate and forgetting to wire it is caught by NOTHING — it
# compiles, it is committed, every check stays green, and it never executes once.
# ui/test is immune because run_ui.sh globs (TESTS=(ui/test/*_test.cpp)); a glob
# is reachable BY CONSTRUCTION, a hardcoded list only by discipline.
#
# ── WHY A RATCHET AND NOT A HARD FAIL ────────────────────────────────────────
# MEASURED before this was written: of 59 run_*/build_* scripts in
# forge-kernel/test, THIRTY are unreachable from CI. Failing on all of them would
# be noise, not a gate. But most are investigations — *_census, *_probe, *_diag —
# written to answer one question, and an investigation that answered its question
# need not run for ever. The class that matters is the one whose own NAME claims
# it guards something: *_gate. Of 13 such scripts, NINE did not run when this was
# written; the ALLOW lists below are the live count and this sentence is history.
#
# So this pins whatever is in ALLOW. The count may FALL (wire one up) but never
# RISE. One more unwired gate turns this red on the PR that introduces it — which
# is precisely the case nothing in this repository caught before. THE COUNTS ARE
# NOT TYPED ANYWHERE: each PINNED is derived from its ALLOW list, because a number
# written beside a list is only true on the day it is written.
#
# ★ IT HAS ALREADY FALLEN ONCE, which is the point: build_thicken_orientation_gate
#   was wired into .github/workflows/kernel-tests.yml (the OCCT kernel smoke job,
#   beside the native gate guard, reusing build-verify) and removed from this list
#   in the same change. Nine became eight.
#
# ★ IT IS RED IN BOTH DIRECTIONS. If an allowlisted gate becomes reachable, that
#   is PROGRESS and this still goes red, telling you to remove it from the list.
#   A ratchet that cannot notice improvement stops being evidence.
#
# ══════════════════════════════════════════════════════════════════════════════
# ROUND 2 (T-137 defect C). TWO THINGS THIS COULD NOT SEE, AND ONE IT GOT WRONG.
# ══════════════════════════════════════════════════════════════════════════════
#
# ★ (1) IT ENUMERATED ONLY *_gate.sh, SO EVERY GATE WRITTEN IN C++ WAS INVISIBLE.
#   This is the same class of hole the file's own comment below warns about —
#   "a check whose enumeration cannot see a thing cannot report on it" — one
#   level up. forge-kernel/test holds EIGHTEEN *_gate.cpp files. Four of them
#   were reachable from no CI job at all, and one, heal_destruction_refusal_gate,
#   carried the only assertion in the repository that stops a native heal from
#   silently emptying a user's imported part. It was committed, it compiled, it
#   was registered in CMake, every check stayed green, and it had run zero times.
#   The check built to catch exactly that could not see the file.
#
# ★ (2) CMake `add_test()` REGISTRATION IS NOT EXECUTION, AND NOTHING SAID SO.
#   forge-kernel/CMakeLists.txt registers 47 test executables with
#   add_executable() + add_test(NAME kernel.ab.<g>). `ctest` is invoked by NO
#   workflow, NO script and NO npm target in this repository — three grep hits,
#   every one a comment — and every forge-kernel CI build names an explicit
#   `--target`. MEASURED when this section was written: 45 of those 47 gates were
#   reachable from no CI job. Registration looks like wiring in a diff and is not,
#   which is why the third enumeration below reads CMakeLists.txt directly.
#
# ★ (3) "REACHABLE" MEANT "NAMED BY SOME FILE", NOT "REACHABLE FROM A CI JOB".
#   The old search asked whether ANY .sh or .yml in the tree mentioned the gate.
#   That makes a gate invoked only by a second script which is itself invoked by
#   nothing read as WIRED. It is a one-hop answer to a transitive question.
#   Phase 1 below now computes the actual closure: seed with the workflow files,
#   then repeatedly admit any script a file already in the set names. A gate is
#   reachable iff some file IN THAT SET names it.
#   VERIFIED before and after: the closure reproduces the ten-entry *_gate.sh
#   ALLOW list exactly, so this is a strictly sharper question with the same
#   answer on the shell half — and a different, correct answer on the C++ half.
#
# COST. MEASURED on a workstation: ~5 s, dominated by the closure's greps (the
# one-hop version was 0.22 s). It remains text processing only — bash, grep, sed,
# find, basename. No compiler, no SDK, no network. An unaffordable gate gets
# disabled, and five seconds per pull request is not that.
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.." || exit 2

# ── THE KNOWN-UNREGISTERED GATES ──────────────────────────────────────────────
# Each list is the live measurement. REMOVE an entry when you wire the gate up.
# Do NOT add one without a reason.
#
# ★★ build_hlr_import_gate AND build_import_surfaces_gate LEFT THIS LIST on
#   2026-09-18 (T-154), and they are the sharpest illustration yet of what a
#   "merely unwired" pin can hide. Both were pinned as UNWIRED. Both were also
#   UNBUILDABLE — they exited 1 at their first step, along with four sibling
#   builders, and had done since 2026-07-21. The pin recorded the lesser fault and
#   made the greater one invisible: a gate nobody runs looks exactly like a gate
#   nobody CAN run, and this list could not tell the two apart. They are now built,
#   run and proved red-able (two mutations, both measured) by kernel-tests.yml.
#   ★ The lesson for the next entry added here: a pin says "not reached yet". It
#     does NOT say the thing still works, and nothing on this list has been asked.

# ★ run_pcurve_fit_gate LEFT THIS LIST on 2026-09-03 and the ratchet is what said
#   so — it went RED ON THE IMPROVEMENT, which is the half of a ratchet nobody
#   writes and this one has. It is now run by kernel-tests.yml beside
#   run_ab_all.sh, and it in turn runs test/pcurve_geometry_gate.cpp, which no
#   script, no CMake target and no workflow named AT ALL. The count is lowered in
#   the same commit that wires it, which is this file's own rule.
ALLOW_SH="\
run_ft_edge_selector_gate
run_pipe_drop_gate
run_pipeshell_guided_gate
run_thicksolid_nesting_gate
run_thrusections_quadrature_gate
run_thrusections_xlate_label_gate
build_aabb_bridge_gate
build_kernel_correctness_gate"

# forge-kernel/test/*_gate.cpp that no CI job reaches. Each of these is built only
# by a build_*_gate.sh wrapper that is ITSELF on the list above, so wiring the
# wrapper clears both entries at once — which is why the two lists move together.
#
# ★ heal_destruction_refusal_gate LEFT THIS LIST on the commit that created the
#   list, and that is the whole point of the enumeration existing: it is the gate
#   whose absence from CI this section was written about. It is now compiled and
#   run — with four source mutations that must turn it red — by the `native` job
#   in kernel-tests.yml, which needs no OCCT for it.
#
# MEASURED SHAPE OF THIS LIST, so nobody has to re-derive it: SIX of the eight are
# the C++ body of a shell gate already pinned in ALLOW_SH above — wiring that
# wrapper clears both entries at once, which is why the two lists move together.
# The remaining TWO, sarc_ring_gate and step_read_occt_projection_gate, are
# reachable through CMake registration ONLY and so are pinned in ALLOW_CMAKE too;
# they are the gates for which "registered" and "run" are furthest apart.
# ★ step_rational_roundtrip_gate JOINED BOTH LISTS ON 2026-09-18 (T-158), and the
#   ratchet is what forced the entry to be written instead of the hole being
#   discovered later. It is the SAME structural reason as every other entry -- an
#   OCCT A/B oracle registered in FORGE_AB_GATES, reachable only through ctest,
#   which no workflow invokes. It is NOT an uncovered fix: the T-158 weight defect
#   is ALSO gated by forge-kernel/test/native/brep/step_rational_weights_test.cpp,
#   which test/native/run_native.sh picks up BY CONSTRUCTION (it globs that
#   directory) and which the `native C++ kernel gate` job runs on every PR. That
#   test asserts the emitted bytes and re-reads them with readForeignStep -- a
#   different translation unit -- against the CLOSED FORM |P| == R, and it is
#   mutation-proved RED on both "weights forced to 1.0" and "silent revert to the
#   non-rational entity". What the ALLOW-listed gate adds, and the reason it must
#   eventually be wired rather than left here, is the INDEPENDENT ORACLE: it reads
#   the file back with OCCT 7.9.3's STEPControl_Reader, and only a second
#   implementation can catch a misunderstanding both Forge modules share.
ALLOW_CPP="\
kernel_correctness_gate
native_aabb_bridge_gate
native_thicksolid_nesting_gate
pipeshell_guided_gate
sarc_ring_gate
step_rational_roundtrip_gate
step_read_occt_projection_gate
thrusections_quadrature_gate
thrusections_xlate_label_gate"

# CMake-REGISTERED test executables (FORGE_AB_GATES: add_executable + add_test)
# that no CI job reaches. THE REASON IS THE SAME FOR EVERY ENTRY and it is
# structural, not per-gate: they are registered with add_test() and nothing in
# this repository invokes ctest, so the registration reaches no runner. They are
# pinned rather than failed because wiring 40-odd OCCT A/B oracles into a macOS
# job is a scheduling decision with a real minute cost, not a one-line fix — but
# the list must never GROW, and today it is the honest size of the hole.
#
# ★ FOUR ENTRIES ARE ABSENT THAT A ONE-HOP SEARCH WOULD HAVE LISTED:
#   ab_native_{draft,filling,sweep,thicken}_occt. They are reachable, but only
#   through run_ab_all.sh, which builds `run_ab_native_<t>.sh` from a HARNESSES
#   string — a name that appears literally nowhere. Phase 1 honours that
#   construction, and only once run_ab_all.sh is itself CI-reachable. If this
#   list ever grows those four back, the thing that broke is the ab-all wiring,
#   not the gates.
# ★★ THREE ENTRIES LEFT THIS LIST ON 2026-09-18 (T-154), and the ratchet is what
#   said so — it went RED ON THE IMPROVEMENT, which is the half nobody writes.
#   native_vs_occt_hlr_import, native_vs_occt_import_surfaces and
#   native_vs_occt_interference are the A/B oracles that build_hlr_import_gate.sh,
#   build_import_surfaces_gate.sh and build_interference_ab_test.sh COMPILE AND
#   RUN, and those three builders are now wired into kernel-tests.yml. They were
#   never reachable through ctest and still are not; they are reachable because a
#   shell gate builds them directly, which is the distinction this list exists to
#   make.
#   ★ native_vs_occt_hlr STAYED, and that took a fix to the matcher above rather
#     than a judgement call: a bare substring search called it reachable purely
#     because "native_vs_occt_hlr_import" contains it. Nothing builds it.

ALLOW_CMAKE="\
io_stl_binary_solid_header
matelib_quat_ab
sarc_ring_gate
native_vs_occt_allbox
native_vs_occt_chamfer
native_vs_occt_chamfer_asym
native_vs_occt_convexhull
native_vs_occt_dataexchange_write
native_vs_occt_draft
native_vs_occt_exact_boolean
native_vs_occt_fillet
native_vs_occt_fillet_curved
native_vs_occt_fillet_ext
native_vs_occt_fuzzy_boolean
native_vs_occt_gear
native_vs_occt_gregory_nsided
native_vs_occt_helical
native_vs_occt_hlr
native_vs_occt_hlr_persp
native_vs_occt_loftsweep
native_vs_occt_nurbs_ssi
native_vs_occt_offset_shape
native_vs_occt_pattern
native_vs_occt_query
native_vs_occt_section
native_vs_occt_sew
native_vs_occt_shell
native_vs_occt_step_read
native_vs_occt_stl
native_vs_occt_surfacefill
native_vs_occt_surfacefill_g2
native_vs_occt_trimmed_face
native_vs_occt_validator
native_vs_occt_validator_ext
step_rational_roundtrip_gate
step_read_occt_projection_gate"

# ══════════════════════════════════════════════════════════════════════════════
# PHASE 1 — THE CI-REACHABLE FILE SET.
# ══════════════════════════════════════════════════════════════════════════════
# Seed: every workflow EXCEPT gate-registration.yml.
#
# ★ EXCLUDE gate-registration.yml. It is the CHECKER, not a consumer -- no gate
#   is ever RUN from it -- and its own mutation-proof step necessarily NAMES
#   gates (it creates run_phantom_ci_gate and mentions run_pipe_drop_gate). Left
#   in, the search finds those names THERE, calls them reachable, and every
#   proof case silently no-ops. That is exactly what happened: all three cases
#   reported failure in CI while passing locally, because locally the mutations
#   came from the shell and not from a file the search reads.
#
# ★ A COMMENT IS NOT AN INVOCATION. The search matched the basename as a
#   SUBSTRING ANYWHERE, so `# TODO: wire probe_todo_gate into CI one day` -- a
#   line whose plain meaning is "this gate is NOT wired" -- turned the ratchet
#   GREEN for that gate. MEASURED: phantom gate with no mention = RED; add only
#   that comment = GREEN. The sentence stating the problem silenced the check.
#   Comments are stripped before searching. `#` inside a quoted string would be
#   stripped too, which can only make a gate look LESS reachable -- the safe
#   direction for a ratchet, because it errs toward flagging work, never toward
#   hiding it.
#
# ★ THIS SCRIPT IS NEVER IN THE SET, and now by construction rather than by a
#   special case. Its ALLOW lists name every pinned gate, so if it were admitted
#   each gate would find its own name HERE and report itself wired -- measured on
#   the one-hop version, which collapsed to 0 against pinned=9 until it was
#   excluded. Nothing in the seed names it except gate-registration.yml, which is
#   not in the seed, so the closure cannot reach it.
TMP=$(mktemp -d) || exit 2
trap 'rm -rf "$TMP"' EXIT
BLOB="$TMP/ci.txt"; : > "$BLOB"
REACH=""

admit() {   # admit <path> — add a file to the CI-reachable set and its text to the blob
  REACH="$REACH$1
"
  sed 's/#.*$//' "$1" >> "$BLOB" 2>/dev/null
}
in_reach() { printf '%s' "$REACH" | grep -qxF -- "$1"; }

for wf in .github/workflows/*.yml .github/workflows/*.yaml; do
  [ -e "$wf" ] || continue
  case "$wf" in */gate-registration.yml) continue ;; esac
  admit "$wf"
done

CANDIDATES=$(find . -path ./.git -prune -o \( -name '*.sh' -o -name '*.py' \) -print \
             | sed 's|^\./||')

# Iterate to a fixed point: a script named by anything already in the set joins it.
# ★ run_ab_all.sh CONSTRUCTS run_ab_native_<t>.sh from its HARNESSES list, so those
#   names never appear literally anywhere. This is the only dynamic construction in
#   the tree -- verified by grepping for any other interpolated gate name -- and it
#   is honoured only once run_ab_all.sh is ITSELF reachable, which is the whole
#   difference between this and the one-hop search it replaces.
while : ; do
  added=0
  for f in $CANDIDATES; do
    in_reach "$f" && continue
    hit=0
    grep -qF -- "$(basename "$f")" "$BLOB" && hit=1
    if [ "$hit" -eq 0 ]; then
      case "$(basename "$f" .sh)" in
        run_ab_native_*)
          t=$(basename "$f" .sh); t=${t#run_ab_native_}
          if in_reach "forge-kernel/test/run_ab_all.sh"; then
            grep -qE "HARNESSES=.*[\" ]$t[\" ]" forge-kernel/test/run_ab_all.sh 2>/dev/null && hit=1
          fi ;;
      esac
    fi
    [ "$hit" -eq 1 ] && { admit "$f"; added=1; }
  done
  [ "$added" -eq 0 ] && break
done

# named_by_ci <name> — does any file in the CI-reachable set mention this name?
#
# ★ THE MATCH MUST NOT BE A BARE SUBSTRING, and T-154 measured why. A plain
#   `grep -F <name>` calls a gate reachable when its name is merely a PREFIX of a
#   different gate's name. Wiring build_hlr_import_gate.sh into CI put the string
#   "native_vs_occt_hlr_import" into the reachable blob, and this function then
#   reported `native_vs_occt_hlr` — a SEPARATE add_test target that nothing builds
#   — as newly reachable, asking for it to be unpinned. Unpinning it would have
#   recorded a gate as wired on the strength of four characters of another gate's
#   name. (`native_vs_occt_hlr_persp` was unaffected: it is not a prefix.)
#
#   So the name must not be followed by an identifier character. The three
#   spellings this test exists to cover all still match, because each EXTENDS the
#   name on the LEFT or ends it with punctuation: `forge_gate_<b>`, `forge_<b>`,
#   and `<b>.cpp`. Every gate name in this tree is [A-Za-z0-9_] only, so there is
#   nothing here for a regex metacharacter to do.
named_by_ci() { grep -qE -- "$1([^A-Za-z0-9_]|$)" "$BLOB"; }

# ══════════════════════════════════════════════════════════════════════════════
# PHASE 2 — THE THREE ENUMERATIONS.
# ══════════════════════════════════════════════════════════════════════════════
# ★ ENUMERATE ON THE NAME THIS CHECK IS ABOUT, NOT ON A PREFIX.
#   This globbed run_*.sh and build_*.sh and THEN filtered to the *_gate suffix, so
#   a gate carrying neither prefix was never even considered. SIX were invisible --
#   forge_verify_batch_gate, forge_verify_instrument_gate, occt_lib_resolution_gate,
#   selector_kind_gate, sketch_plane_gate, occt_ledger_gate_fires -- and the ratchet
#   printed "measured=10 pinned=10 GREEN" over them. Five turned out to be wired;
#   ONE, occt_lib_resolution_gate, was genuinely unregistered and had been hidden by
#   the glob for as long as it existed.
#   A check whose enumeration cannot see a thing cannot report on it. A gate that
#   passes because it never looked is not evidence.

UNREG_SH=""
for f in forge-kernel/test/*_gate.sh; do
  [ -e "$f" ] || continue
  b=$(basename "$f" .sh)
  in_reach "$f" || UNREG_SH="$UNREG_SH$b
"
done

# A C++ gate reaches CI under any of three spellings -- its own basename (a
# hand-written compile naming <b>.cpp), the CMake target forge_gate_<b>, or the
# older forge_<b> -- so the substring test covers all of them at once.
UNREG_CPP=""
for f in forge-kernel/test/*_gate.cpp; do
  [ -e "$f" ] || continue
  b=$(basename "$f" .cpp)
  named_by_ci "$b" || UNREG_CPP="$UNREG_CPP$b
"
done

# The CMake-registered set, read out of CMakeLists.txt rather than typed here, so
# adding a target to FORGE_AB_GATES without wiring it turns this red on that PR.
UNREG_CMAKE=""
CMAKE_GATES=$(sed -n '/set(FORGE_AB_GATES/,/^    )$/p' forge-kernel/CMakeLists.txt 2>/dev/null \
              | sed 's/#.*$//' | grep -oE '^ *[a-z0-9_]+ *$' | tr -d ' ')
for g in $CMAKE_GATES; do
  named_by_ci "$g" || UNREG_CMAKE="$UNREG_CMAKE$g
"
done

rc=0
verdict() {   # verdict <label> <unreg-text> <allow-text>
  local label="$1" unreg="$2" allow="$3"
  local measured pinned new gone
  measured=$(printf '%b' "$unreg" | grep -c . || true)
  pinned=$(printf '%s\n' "$allow" | grep -c . || true)
  echo "[gate-registration] $label — not reachable from any CI job:"
  printf '%b' "$unreg" | sed 's/^/    /'
  echo "[gate-registration] $label measured=$measured  pinned=$pinned"
  new=$(printf '%b' "$unreg" | grep -vxF "$allow" || true)
  gone=$(printf '%s\n' "$allow" | grep -vxF "$(printf '%b' "$unreg")" || true)
  if [ -n "$new" ]; then
    echo "[gate-registration] RED — a NEW $label gate is not wired into CI:"
    printf '%s\n' "$new" | sed 's/^/    /'
    echo "[gate-registration] It will compile, commit, and stay green while never running once."
    echo "[gate-registration] Wire it into .github/workflows/, or add it to ALLOW with a reason."
    rc=1
  fi
  if [ -n "$gone" ]; then
    echo "[gate-registration] RED ON AN IMPROVEMENT — these $label gates are now reachable:"
    printf '%s\n' "$gone" | sed 's/^/    /'
    echo "[gate-registration] Remove them from ALLOW. A ratchet that cannot notice"
    echo "[gate-registration] progress is not evidence."
    rc=1
  fi
}

echo "[gate-registration] CI-reachable file set: $(printf '%s' "$REACH" | grep -c .) files"
verdict "shell gates (*_gate.sh)"        "$UNREG_SH"    "$ALLOW_SH"
verdict "C++ gates (*_gate.cpp)"         "$UNREG_CPP"   "$ALLOW_CPP"
verdict "CMake-registered (add_test)"    "$UNREG_CMAKE" "$ALLOW_CMAKE"

[ $rc -eq 0 ] && echo "[gate-registration] GREEN — no unwired gate beyond those pinned."
exit $rc
