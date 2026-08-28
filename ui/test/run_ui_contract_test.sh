#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# run_ui_contract_test.sh — gates the THREE self-protection contracts of
# run_ui.sh itself. run_ui.sh gates forge::ui; nothing gated run_ui.sh, and all
# three failures below are silent-green failures: the script keeps going, or
# reports success, while nothing it claims to have done actually happened.
#
# Cases A and B execute the REAL TEXT of run_ui.sh — extracted with sed and
# eval'd — rather than a paraphrase, so a rewrite that drops the guard is caught
# by the extraction returning nothing. Case C runs the whole script.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)" || {
  echo "[ui-contract] cannot resolve the repo root"; exit 1; }
[ -n "$ROOT" ] || { echo "[ui-contract] repo root resolved to the empty string"; exit 1; }
cd "$ROOT" || { echo "[ui-contract] cannot enter repo root $ROOT"; exit 1; }

TARGET="ui/test/run_ui.sh"
PASS=0
FAIL=0
T="$(mktemp -d "${TMPDIR:-/tmp}/forge_ui_contract.XXXXXX")"
cleanup() {
  rm -rf "$T"
  if [ -d "$T" ]; then echo "[ui-contract] WARNING: kept $T -- rm -rf did not remove it"; fi
}
trap cleanup EXIT

ok()  { PASS=$((PASS + 1)); echo "  PASS  $1"; }
bad() { FAIL=$((FAIL + 1)); echo "  FAIL  $1"; }

# ── A. an unresolvable repo root must STOP the script ────────────────────────
# `cd ""` succeeds in bash and changes nothing, so without the guard an empty
# ROOT is indistinguishable from a correct one until the globs come up empty.
# Extract the real lines and run them with `dirname` shadowed by a shell function
# that names a directory which does not exist, so the subshell's cd fails.
SNIPPET="$(sed -n '/^ROOT="\$(cd "\$(dirname/,/^cd "\$ROOT"/p' "$TARGET")"
if [ -z "$SNIPPET" ]; then
  bad "A: could not extract the root-resolution lines from $TARGET"
else
  aout="$(
    dirname() { printf '%s\n' "/forge/no/such/directory/anywhere"; }
    eval "$SNIPPET"
    echo "REACHED_END_WITH_ROOT=[$ROOT]"
  )" && arc=0 || arc=$?
  if [ "$arc" -ne 0 ] && ! printf '%s' "$aout" | grep -q REACHED_END; then
    ok "A: an unresolvable repo root exits nonzero instead of continuing (rc=$arc)"
  else
    bad "A: the script continued past an unresolvable repo root (rc=$arc): $aout"
  fi
fi

# ── B. the EXIT cleanup must report a delete it could not make ───────────────
# Extract run_ui.sh's own cleanup() and run it against an rm that does not
# delete. `rm` is shadowed rather than the directory made undeletable on purpose:
# a read-only-parent fixture proves nothing when the suite runs as root, and this
# case has to mean the same thing on every runner.
FN="$(sed -n '/^cleanup() {/,/^}/p' "$TARGET")"
if [ -z "$FN" ]; then
  bad "B: $TARGET has no cleanup() function to verify its own post-condition"
else
  mkdir -p "$T/objdir"
  : > "$T/objdir/some.o"
  bout="$(
    OBJDIR="$T/objdir"
    rm() { return 1; }        # the failed delete this case exists to detect
    eval "$FN"
    cleanup
  )"
  if [ -d "$T/objdir" ] && printf '%s' "$bout" | grep -q "kept $T/objdir"; then
    ok "B: cleanup reports the directory it failed to remove"
  else
    bad "B: cleanup left $T/objdir behind and said nothing (dir_exists=$([ -d "$T/objdir" ] && echo yes || echo no), out=[$bout])"
  fi
fi

# ── C. a filter that matches nothing must NOT report success ─────────────────
# ONLY=<typo> skips every gate; "0 of N gates ran and passed" plus exit 0 is a
# green a calling pipeline cannot tell from a real one.
cout="$(ONLY=__no_such_gate__ bash "$TARGET" 2>&1)" && crc=0 || crc=$?
if [ "$crc" -ne 0 ] && printf '%s' "$cout" | grep -q "matched no gate"; then
  ok "C: ONLY matching no gate exits $crc and refuses to report success"
else
  bad "C: ONLY matching no gate exited $crc — $(printf '%s' "$cout" | tail -1)"
fi

echo
echo "[ui-contract] $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
