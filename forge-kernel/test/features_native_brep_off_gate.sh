#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# features_native_brep_off_gate.sh — src/Features.cpp must COMPILE with
# FORGE_NATIVE_BREP undefined.
#
# WHY. TKOffset family G left part::shell and part::shellMultiThickness with ONE
# engine, forge::occtoffset::makeThickSolid, and NativeThickSolid.hpp declares it
# ONLY under #ifdef FORGE_NATIVE_BREP (Features.cpp includes that header only
# inside its own FORGE_NATIVE_BREP block). shell() guarded its call and refused by
# name in the #else. shellMultiThickness did NOT: three references
# (makeThickSolid twice, lastThickSolidDeferReason once) stood unguarded, and the
# OFF configuration failed with
#     error: no member named 'occtoffset' in namespace 'forge'   (x3)
# CMakeLists.txt keeps that configuration explicitly free of "undefined-symbol
# landmine[s]", and a native-only engine referenced unguarded is exactly one.
#
# It also caught an older break in the same file: the OCCT-fillet watchdog's
# <future>/<thread>/<mutex>/<chrono> were included only inside the
# FORGE_NATIVE_BREP block while the watchdog itself sits outside it — 11 more
# errors, so the OFF configuration had not compiled for some time and no check
# said so.
#
# WHAT IT MEASURES. -fsyntax-only on the one TU, in the OFF configuration: no
# object, no link, no OCCT library — only the OCCT HEADERS, which every job that
# builds the kernel installs. The status is read from the COMPILER'S EXIT CODE and
# cross-checked against the diagnostic text; a count of "error:" lines alone would
# read 0 if the compiler never ran.
#
# --mutations  proves the gate can fail, on a COPY of the TU in a temp dir (the
#              tree is never edited):
#   M1  re-expose the three unguarded occtoffset references  -> must go RED and
#       name 'occtoffset'
#   M2  drop the unconditional <future>/<thread> includes    -> must go RED and
#       name 'future'
#   Each mutation is asserted to have CHANGED the file first: a mutation that does
#   not apply is a no-op, and a no-op "RED" proves nothing.
#
# Hermetic: OCCT headers are located from $OCCT_ROOT, then the Homebrew prefixes,
# then the Debian path; nothing under $HOME is read.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail
KERNEL="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CXX="${CXX:-clang++}"
MUTATE=0
[ "${1:-}" = "--mutations" ] && MUTATE=1

OCCT_INC=""
for cand in "${OCCT_ROOT:-}/include/opencascade" \
            /opt/homebrew/opt/opencascade/include/opencascade \
            /usr/local/opt/opencascade/include/opencascade \
            /usr/include/opencascade; do
  if [ -e "$cand/Standard_Version.hxx" ]; then OCCT_INC="$cand"; break; fi
done
[ -n "$OCCT_INC" ] || { echo "[native-brep-off] FATAL: OCCT headers not found (brew install opencascade or set OCCT_ROOT)" >&2; exit 2; }
command -v "$CXX" >/dev/null 2>&1 || { echo "[native-brep-off] FATAL: no compiler '$CXX'" >&2; exit 2; }

WORK="$(mktemp -d "${TMPDIR:-/tmp}/features_nbo.XXXXXX")" || exit 2
trap 'rm -rf "$WORK"' EXIT

# $1 = source file, $2 = log ; echoes the compiler exit code
syntax() {
  "$CXX" -std=gnu++20 -fsyntax-only \
    -I "$KERNEL/include" -I "$OCCT_INC" \
    -I "$KERNEL/3rdParty/planegcs_eigen_shim" -I "$KERNEL/3rdParty/planegcs" \
    "$1" > "$2" 2>&1
  echo $?
}

pass=0; fail=0
ok()  { pass=$((pass+1)); echo "  ok   $1"; }
bad() { fail=$((fail+1)); echo "  FAIL $1"; }

echo "[native-brep-off] src/Features.cpp, FORGE_NATIVE_BREP undefined, -fsyntax-only"
rc="$(syntax "$KERNEL/src/Features.cpp" "$WORK/clean.log")"
nerr="$(grep -c 'error:' "$WORK/clean.log" || true)"
if [ "$rc" = "0" ] && [ "${nerr:-0}" = "0" ]; then
  ok "Features.cpp compiles with FORGE_NATIVE_BREP undefined (rc=0, 0 errors)"
else
  bad "Features.cpp does NOT compile with FORGE_NATIVE_BREP undefined (rc=$rc, ${nerr:-?} errors)"
  grep 'error:' "$WORK/clean.log" | head -20
fi

if [ "$MUTATE" = "1" ]; then
  # A copy of the TU compiles identically from a temp dir: every quoted include in
  # Features.cpp is "forge/...", resolved through -I include, never relative.
  mutant() {  # $1 = tag, $2 = python transform, $3 = diagnostic the RED must name
    local tag="$1" expr="$2" want="$3"
    local m="$WORK/Features_$tag.cpp"
    python3 - "$KERNEL/src/Features.cpp" "$m" "$expr" <<'PY' || { bad "$tag: mutation script failed"; return; }
import sys
src, dst, expr = sys.argv[1], sys.argv[2], sys.argv[3]
text = open(src).read()
out = eval(expr, {"t": text})
open(dst, "w").write(out)
PY
    if cmp -s "$KERNEL/src/Features.cpp" "$m"; then
      bad "$tag: MUTATION DID NOT APPLY (file unchanged) — a no-op cannot prove RED"
      return
    fi
    local mrc; mrc="$(syntax "$m" "$WORK/$tag.log")"
    if [ "$mrc" != "0" ] && grep -q "error:.*$want" "$WORK/$tag.log"; then
      ok "$tag: RED as required (rc=$mrc, names '$want')"
    else
      bad "$tag: stayed GREEN or failed for the wrong reason (rc=$mrc)"
      grep 'error:' "$WORK/$tag.log" | head -5
    fi
  }
  # M1: delete the OFF-configuration refusal AND its #endif, re-exposing the three
  # engine references exactly as the defect had them.
  mutant M1_unguard_shellMultiThickness \
    "__import__('re').sub(r'(requirePositive\(baseThickness, \"shell base thickness\"\);\n)#ifndef FORGE_NATIVE_BREP\n.*?\n#else\n', r'\1', t, count=1, flags=__import__('re').S).replace('    return ShapeRegistry::instance().add(acc);\n#endif  // FORGE_NATIVE_BREP\n', '    return ShapeRegistry::instance().add(acc);\n', 1)" \
    "occtoffset"
  # M2: remove the unconditional watchdog headers.
  mutant M2_watchdog_headers_native_only \
    "t.replace('#include <chrono>\n#include <future>\n#include <mutex>\n#include <thread>\n', '', 1)" \
    "future"
fi

echo "[native-brep-off] $pass passed, $fail failed"
[ "$fail" = "0" ] || exit 1
exit 0
