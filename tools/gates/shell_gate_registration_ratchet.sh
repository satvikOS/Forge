#!/usr/bin/env bash
# shell_gate_registration_ratchet.sh — is every SHELL gate, anywhere, wired in?
#
# ── WHY A THIRD ONE ──────────────────────────────────────────────────────────
# Two registration checks already exist and BOTH are scoped, in ways that are
# correct for them and leave a hole between them:
#
#   forge-kernel/test/gate_registration_ratchet.sh enumerates
#     `forge-kernel/test/run_*.sh` and `build_*.sh`  — one tree, two prefixes.
#   forge-desktop/test/gate_registration_check.sh enumerates
#     `*_gate.cpp` CMake targets                     — one tree, C++ only.
#
# So a *_gate.sh outside forge-kernel/test, or inside it under a name that is
# neither run_* nor build_*, is invisible to every check in the repository and
# stays green for ever. MEASURED when this was written — three such gates had
# never executed once:
#
#   tools/guardian/test/guardian_single_instance_gate.sh  33 checks, 11 mutations
#   archie/test/run_archie_gate.sh                        32 checks (T-080, T-083)
#   forge-desktop/test/update_apply_refuses_gate.sh        8 checks, SECURITY
#
# The last is the one that should sting: the shipped updater's refusal to install
# an update it cannot attribute was asserted by a gate nothing ran. The first was
# found only because a mutant daemon it leaked was still alive after 10h13m.
#
# ── SCOPE, AND WHY IT IS NOT A DUPLICATE ─────────────────────────────────────
# This DEFERS to the kernel ratchet on the territory that ratchet already owns —
# forge-kernel/test/{run_,build_}*_gate.sh — because two ratchets pinning the
# same gate means every future wiring has to be recorded twice and one of them
# will be forgotten. What is left is exactly the ground no check could see.
#
# ── RATCHET, NOT HARD FAIL ───────────────────────────────────────────────────
# ALLOW pins what was already unwired when this was written, each with a reason.
# The count may FALL, never RISE. Wire one up and this goes red until it is
# removed from ALLOW, because a ratchet that cannot notice progress is not
# evidence. THE COUNT IS DERIVED FROM ALLOW, never typed beside it.
#
# ══════════════════════════════════════════════════════════════════════════════
# ROUND 2 (T-185). "NAMED BY SOME FILE" IS NOT "RUN BY CI", AND A COMMENT IS NOT
# AN INVOCATION.
# ══════════════════════════════════════════════════════════════════════════════
# The first version asked one question: does ANY .sh or .yml in the tree contain
# the gate's basename? Two different defects hid inside that one grep, and both
# make the ratchet report GREEN for a gate nothing runs.
#
# ★ (1) A COMMENT WAS COUNTED AS WIRING. MEASURED on b609b41d with a phantom
#   tools/gates/negctl_probe_gate.sh:
#       no mention anywhere                                          -> rc=1 RED
#       + "# TODO: wire negctl_probe_gate into CI one day" in a .sh  -> rc=0 GREEN
#       + "# negctl_probe_gate is NOT wired yet" in kernel-tests.yml -> rc=0 GREEN
#   The sentence saying the gate is NOT wired turned the check green. The kernel
#   ratchet (T-107) and the JS gate checker had both already learned this; this
#   file had not. Comments are now stripped before anything is matched.
#   MEASURED the same way after that fix, two more non-invocations still read
#   as wiring: a workflow STEP NAME (`- name: x_gate (to be wired)` over
#   `run: echo nothing`) and an ECHO (`run: echo "TODO wire x_gate.sh"`), both
#   rc=0. A step's/job's `name:` and any echo/printf line are now stripped too;
#   the real tree measures the same 5 with or without them, so nothing that
#   genuinely runs was relying on either.
#
# ★ (2) ONE HOP, FROM ANYWHERE. A gate named only by a script that is itself run
#   by nothing read as WIRED. Reachability is now the same transitive closure the
#   kernel ratchet and tools/kernel/js_gate_registration_gate.py compute, with the
#   JS checker's two rules, because conflating them broke that checker twice:
#
#     ADMITTING a file into the CI-reachable set needs an INVOCATION:
#       bash|sh|zsh|node|python3|source|. <path>, or <path> as a command word
#       (./x.sh, dir/x.sh, "$HERE/x.sh"), or `npm run <script>` for a script in
#       package.json. A report that merely LISTS names cannot pull them in.
#     DECIDING a gate is reachable accepts any NON-COMMENT mention of its name
#       inside that set, because real invocations are often indirect
#       (GATE="$HERE/x_gate.sh"; bash "$GATE").
#   Seed: every workflow file -- INCLUDING gate-registration.yml, which is the
#   only consumer of tools/gates/*_gate.sh. Its comment-stripped text names only
#   the gates it actually runs plus kernel-scope phantoms this file defers on.
#
# ★ THE CHECKERS ARE NEVER ADMITTED. They name gates in order to judge them, so
#   admitting one makes every gate it judges look wired -- the collapse recorded
#   above for the self-exclusion. The list is EXCLUDED below and the selftest
#   proves removing this script from it is load-bearing.
#
# COST: text processing only (bash, grep, sed, perl, awk, find, jq). No compiler.
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.." || exit 2
SELF="tools/gates/shell_gate_registration_ratchet.sh"

# Unwired when written. Each line is a path, and each needs a reason below it.
ALLOW="forge-desktop/test/run_file_dialog_gate.sh
forge-kernel/scripts/ft_relational_gate.sh
forge-kernel/scripts/occt_drop_gate.sh
forge-kernel/scripts/storage_governor_git_gate.sh
forge-kernel/scripts/storage_governor_mutation_gate.sh"
#   run_file_dialog_gate.sh   — drives a native file dialog; needs a headed
#                               session, which no runner has.
#   occt_drop_gate.sh         — PINNED BY T-185, found by the comment fix: its
#                               only "wiring" was a COMMENT in
#                               run_callsite_concave_fillet.sh. It is a local,
#                               PARAMETRIC measurement (`occt_drop_gate.sh <TKX>`
#                               against a built .node) answering "is toolkit X
#                               drop-safe" for one toolkit at a time -- there is
#                               no argument-free pass/fail for CI to run.
#   update_signature_gate.sh, run_file_exchange_gate.sh -- found by the same fix
#                               (each "wired" only by a comment: a kernel-tests.yml
#                               comment and a run_file_dialog_gate.sh comment) and
#                               WIRED in the same change rather than pinned.
#   ft_relational_gate.sh     — investigation from the relational-corpus work.
#   storage_governor_*_gate   — operate on the real working copy and the real
#                               disk; running them on a runner measures the
#                               runner, not this workstation.
#   occt_lib_resolution_gate  — REMOVED from this list: it is now wired into
#                               kernel-tests.yml, and the kernel ratchet can see
#                               it too (that ratchet used to glob run_*/build_*
#                               and now globs *_gate.sh, so a name carrying
#                               neither prefix is no longer invisible).

# Files that NAME gates in order to judge them. Never admitted to the CI set.
EXCLUDED="$SELF
tools/gates/shell_gate_registration_selftest.sh
forge-kernel/test/gate_registration_ratchet.sh
forge-desktop/test/gate_registration_check.sh
forge-desktop/test/gate_registration_selftest.sh
tools/kernel/js_gate_registration_gate.py"

owned_by_kernel_ratchet() {     # the territory we deliberately do not touch
  # DELIBERATELY NARROWER than what that ratchet now covers. It used to glob
  # run_*.sh and build_*.sh; it now globs forge-kernel/test/*_gate.sh, so gates
  # such as selector_kind_gate.sh are checked by BOTH. That is double coverage,
  # not a hole, and double coverage is the safe direction -- widening this case
  # to match would REMOVE this ratchet's check on those files for no gain.
  case "$1" in
    forge-kernel/test/run_*_gate.sh|forge-kernel/test/build_*_gate.sh) return 0 ;;
    *) return 1 ;;
  esac
}

TMP=$(mktemp -d "${TMPDIR:-/tmp}/shellgate.XXXXXX") || exit 2
trap 'rm -rf "$TMP"' EXIT
BLOB="$TMP/corpus"; REACH="$TMP/reach"; INDEX="$TMP/index"; EXCL="$TMP/excl"
: > "$BLOB"; : > "$REACH"
printf '%s\n' "$EXCLUDED" > "$EXCL"

# strip <path> — the file's text with comments, echo/printf lines and workflow
# `name:` values removed (none of them runs anything). Stripping can only make
# a gate look LESS reachable (a `#` inside a quoted string is lost too), which is
# the safe direction for a ratchet: it errs toward flagging work, never hiding it.
strip() {
  case "$1" in
    *.js|*.mjs|*.cjs|*.json)
      perl -0pe 's{/\*.*?\*/}{}gs; s{(^|[ \t])//[^\n]*}{$1}gm' "$1" 2>/dev/null ;;
    *.yml|*.yaml)
      perl -pe 's/(^|[ \t])#.*$/$1/; s/^(\s*(?:-\s*)?(?:run:\s*)?)(echo|printf)\b.*$/$1/; s/^(\s*-?\s*)name:\s.*$/$1/' "$1" 2>/dev/null ;;
    *)
      perl -pe 's/(^|[ \t])#.*$/$1/; s/^(\s*(?:-\s*)?(?:run:\s*)?)(echo|printf)\b.*$/$1/' "$1" 2>/dev/null ;;
  esac
}
admit() { printf '%s\n' "$1" >> "$REACH"; strip "$1" >> "$BLOB"; printf '\n' >> "$BLOB"; }

# Basenames the corpus INVOKES: after an interpreter, or as a command word.
invoked() {
  {
    grep -oE "(^|[[:space:];&|(\`\"'])(bash|sh|zsh|node|python3|python|source|\\.)[[:space:]]+(-[A-Za-z]+[[:space:]]+)*[\"']?[^[:space:];&|\`\"')]+" "$BLOB"
    grep -oE "(^|[;&|(]|then|do|run:)[[:space:]]*[\"']?[^[:space:];&|\`\"'()=]*/[^[:space:];&|\`\"'()=/]+\\.(sh|bash|zsh|py|mjs|js)" "$BLOB"
  } 2>/dev/null | sed -E "s/.*[[:space:]\"'(]//; s#.*/##" | sort -u
}

# Candidate files that can run something: basename <TAB> path.
find . \( -name .git -o -name .claude -o -name node_modules -o -name third_party \) -prune \
       -o -type f \( -name '*.sh' -o -name '*.bash' -o -name '*.zsh' -o -name '*.py' \
                     -o -name '*.mjs' -o -name '*.js' -o -name '*.cjs' \) -print 2>/dev/null \
  | sed 's#^\./##' | awk -F/ '{print $NF "\t" $0}' | sort > "$INDEX"

for wf in .github/workflows/*.yml .github/workflows/*.yaml; do
  [ -e "$wf" ] && admit "$wf"
done

# npm scripts are bodies too, but only those the corpus actually runs.
NPMDONE="$TMP/npmdone"; : > "$NPMDONE"
admit_npm() {
  [ -f package.json ] || return 1
  local name body added=1
  while IFS="$(printf '\t')" read -r name body; do
    [ -n "$name" ] || continue
    grep -qxF -- "$name" "$NPMDONE" && continue
    if grep -qE "npm run $(printf '%s' "$name" | sed 's/[.[\*^$()+?{|]/\\&/g')([[:space:];&|\"]|$)" "$BLOB"; then
      printf '%s\n' "$name" >> "$NPMDONE"
      printf '%s\n' "$body" >> "$BLOB"
      added=0
    fi
  done < <(jq -r '.scripts // {} | to_entries[] | "\(.key)\t\(.value)"' package.json 2>/dev/null)
  return $added
}

while : ; do
  added=0
  admit_npm && added=1
  NEW=$(invoked | awk -F'\t' 'NR==FNR{inv[$0]=1; next} ($1 in inv){print $2}' - "$INDEX" \
        | grep -vxF -f "$REACH" | grep -vxF -f "$EXCL" || true)
  if [ -n "$NEW" ]; then
    while IFS= read -r f; do [ -n "$f" ] && admit "$f"; done <<EOF
$NEW
EOF
    added=1
  fi
  [ "$added" -eq 0 ] && break
done

# reachable <path> — admitted, or its name appears (not as a longer identifier)
# in comment-stripped text that CI actually runs.
reachable() {
  local f="$1" b
  grep -qxF -- "$f" "$REACH" && return 0
  b=$(basename "$f" .sh)
  grep -qE -- "(^|[^A-Za-z0-9_])${b}([^A-Za-z0-9_]|$)" "$BLOB"
}

UNREG=""
TOTAL=0
while IFS= read -r f; do
  owned_by_kernel_ratchet "$f" && continue
  TOTAL=$((TOTAL + 1))
  reachable "$f" || UNREG="${UNREG}${f}
"
done < <(find . \( -name .git -o -name .claude -o -name node_modules \) -prune \
              -o -name '*_gate.sh' -print | sed 's#^\./##' | sort)

MEASURED=$(printf '%s' "$UNREG" | grep -c . || true)
PINNED=$(printf '%s\n' "$ALLOW" | grep -c . || true)

echo "[shell-gate-registration] CI-reachable file set: $(grep -c . "$REACH") files (comments stripped)"
echo "[shell-gate-registration] shell gates outside the kernel ratchet's scope: $TOTAL"
echo "[shell-gate-registration] of those, not executed by anything:"
printf '%s' "$UNREG" | sed 's/^/    /'
echo "[shell-gate-registration] measured=$MEASURED  pinned=$PINNED"

NEW=$(printf '%s' "$UNREG" | grep -vxF "$ALLOW" || true)
GONE=$(printf '%s\n' "$ALLOW" | grep -vxF "$(printf '%s' "$UNREG")" || true)

rc=0
if [ -n "$NEW" ]; then
  echo "[shell-gate-registration] RED — a shell gate is not wired into CI:"
  printf '%s\n' "$NEW" | sed 's/^/    /'
  echo "[shell-gate-registration] It will commit, stay green, and never run once."
  echo "[shell-gate-registration] Wire it into .github/workflows/, or pin it in ALLOW with a reason."
  echo "[shell-gate-registration] A COMMENT naming it is not wiring; neither is a script nothing runs."
  rc=1
fi
if [ -n "$GONE" ]; then
  echo "[shell-gate-registration] RED ON AN IMPROVEMENT — these now run:"
  printf '%s\n' "$GONE" | sed 's/^/    /'
  echo "[shell-gate-registration] Remove them from ALLOW."
  rc=1
fi
[ $rc -eq 0 ] && echo "[shell-gate-registration] GREEN — no unwired shell gate beyond the $PINNED pinned."
exit $rc
