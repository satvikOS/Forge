#!/usr/bin/env bash
# occt_lib_path.sh — resolve an OCCT toolkit NAME to a real library FILE,
# version-agnostically, or FAIL.
#
# WHY THIS EXISTS
# ---------------
# Two gates hardcoded `libTK*.7.9.dylib`:
#   tools/occt_symbol_census.sh                    (per-toolkit symbol census)
#   forge-kernel/test/run_ab_native_offsetshape.sh (family-H A/B)
# On OCCT 7.10, on a relocated install, or on Linux (.so), that path does not
# exist — and BOTH scripts read a missing file as an EMPTY symbol table instead
# of as an error. The census printed `MISSING` for every toolkit and still exited
# 0 with an all-zero census; the A/B's central claim, "the engine imports ZERO
# TKOffset symbols", became VACUOUSLY TRUE, because `nm -gU <missing> 2>/dev/null`
# lists nothing and the intersection with the engine's undefined symbols is then
# necessarily empty. A claim proved against a file that is not there is not proved.
#
# usage (either form):
#   source occt_lib_path.sh ; occt_lib_path TKOffset [EXTRA_DIR]
#   bash   occt_lib_path.sh TKOffset [EXTRA_DIR]
# prints the absolute path on stdout and returns 0, or explains on stderr and
# returns 1. OCCT_LIB_DIR, when set, is searched first.

occt_lib_path() {
  local tk="${1:?occt_lib_path: toolkit name required (e.g. TKOffset)}"
  local extra="${2:-}"
  local d f
  local dirs=()
  [ -n "${OCCT_LIB_DIR:-}" ] && dirs+=("$OCCT_LIB_DIR")
  [ -n "$extra" ] && dirs+=("$extra")
  dirs+=(/opt/homebrew/opt/opencascade/lib /opt/homebrew/lib
         /usr/local/opt/opencascade/lib /usr/local/lib
         /usr/lib/x86_64-linux-gnu /usr/lib)
  for d in "${dirs[@]}"; do
    [ -d "$d" ] || continue
    # Unversioned development symlink first (stable across upgrades), then any
    # versioned file. An unmatched glob stays literal and fails the -e test.
    for f in "$d/lib${tk}.dylib" "$d/lib${tk}.so" \
             "$d"/lib${tk}.[0-9]*.dylib "$d"/lib${tk}.so.[0-9]* ; do
      if [ -e "$f" ]; then printf '%s\n' "$f"; return 0; fi
    done
  done
  {
    echo "FATAL: cannot locate OCCT toolkit lib${tk} (any version, .dylib or .so)."
    echo "  searched:"
    for d in "${dirs[@]}"; do printf '    %s\n' "$d"; done
    echo "  Set OCCT_LIB_DIR=/path/to/occt/lib. A symbol census or an A/B run"
    echo "  against a library that is not there measures nothing."
  } >&2
  return 1
}

# Runnable as well as sourceable.
if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  occt_lib_path "$@" || exit 1
fi
