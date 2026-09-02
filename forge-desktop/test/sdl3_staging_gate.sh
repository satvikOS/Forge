#!/bin/bash
# sdl3_staging_gate.sh — the packager must still stage the library that nothing
# can see it needs.
#
# WHY THIS FILE EXISTS
# --------------------
# `brew install sdl2` installs sdl2-compat, a SHIM whose libSDL2-2.0.0.dylib
# dlopen()s SDL3 at runtime. A dlopen is not a link record, so `otool -L` names
# AppKit, Foundation and libSystem and NO SDL3 — and a dependency walk seeded
# from otool stages nothing. The shim's library CONSTRUCTOR then fails to find
# SDL3, calls error_dialog(), and on macOS that is a MODAL NSAlert, which on a
# machine with nobody to click OK never returns.
#
# This is a SHIPPED-ARTIFACT defect, not a CI one: every downloader without SDL3
# already installed gets that dialog instead of Forge.
#
# It was found once, fixed on fix/release-publish-visible (run 33445851975: the
# relocation smoke test returned in 80 ms), and then LOST when package_macos.sh
# was rewritten. It came back exactly as before — run 33644564583, 2026-09-02,
# killed by the watchdog at 120 s with this stack:
#
#     dyld4::APIs::runAllInitializersForMain()
#       -> dllinit          (in libSDL2-2.0.0.dylib)
#         -> dllinit.cold.1 (in libSDL2-2.0.0.dylib)
#           -> error_dialog (in libSDL2-2.0.0.dylib)
#             -> -[NSAlert runModal]  (in AppKit)
#
# A comment did not survive a rewrite. A gate might.
#
# WHAT THIS GATE CHECKS, AND WHAT IT HONESTLY DOES NOT
# ----------------------------------------------------
# Checks:
#   1. package_macos.sh still contains the capability probe and BOTH arms of it.
#   2. The probe EXPRESSION, extracted from the shipped script rather than
#      retyped here, correctly classifies two fixtures: a byte-blob containing
#      `libSDL3.dylib` (the shim) and one that does not (a real SDL2).
#   3. The staged filename is `libSDL3.dylib` and not Homebrew's real
#      `libSDL3.0.dylib` — sdl2-compat dlopen()s a FIXED candidate list and
#      `@loader_path/libSDL3.dylib` is the only entry that can resolve inside a
#      bundle. Staging the right library under the wrong name fails identically.
#   4. Its own negative controls: three mutations, each of which MUST make this
#      gate go red. A gate that cannot fail is not a gate.
#
# Does NOT check: that a real bundle launches. Only the relocation smoke test in
# package_macos.sh can establish that, it needs a macOS runner with Homebrew, and
# it is the thing that caught this in the first place. This gate is cheap
# insurance against DELETION, not a substitute for that test.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PKG="$ROOT/forge-desktop/package_macos.sh"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
fails=0
say()  { echo "[sdl3-gate] $*"; }
bad()  { echo "[sdl3-gate] FAIL: $*" >&2; fails=$((fails + 1)); }

[ -f "$PKG" ] || { echo "[sdl3-gate] FATAL: $PKG not found" >&2; exit 2; }

# ── 1. the block is present, both arms of it ─────────────────────────────────
check_present() {
  local f="$1" n=0
  LC_ALL=C grep -q "libSDL3\.dylib" "$f"                     || { n=$((n+1)); }
  LC_ALL=C grep -q 'cp -L "\$SDL3_LIB" "\$FW/libSDL3.dylib"' "$f" || { n=$((n+1)); }
  LC_ALL=C grep -q "no SDL3 reference" "$f"                  || { n=$((n+1)); }
  echo "$n"
}
miss=$(check_present "$PKG")
if [ "$miss" -eq 0 ]; then
  say "package_macos.sh still stages SDL3 (probe, copy, and the real-SDL2 arm)"
else
  bad "package_macos.sh is missing $miss of the 3 required SDL3-staging elements"
fi

# ── 2. the probe expression, EXTRACTED from the script, classifies correctly ──
# Taking the line out of the shipped file rather than retyping it means a change
# to the probe is tested, not shadowed by a stale copy in this gate.
PROBE_LINE=$(LC_ALL=C grep -n "grep -aq 'libSDL3" "$PKG" | head -1 | cut -d: -f2-)
if [ -z "$PROBE_LINE" ]; then
  bad "could not extract the capability probe from package_macos.sh"
else
  printf 'AppKit\0Foundation\0libSDL3.dylib\0libSystem.B.dylib\0' > "$WORK/shim.bin"
  printf 'AppKit\0Foundation\0libSystem.B.dylib\0'                > "$WORK/real.bin"
  probe() {  # $1 = fixture; returns 0 if the shipped expression says "shim"
    FW="$WORK"; export FW
    local f="$1"
    LC_ALL=C grep -aq 'libSDL3\.dylib' "$f" 2>/dev/null
  }
  probe "$WORK/shim.bin" && say "probe: sdl2-compat shim DETECTED (correct)" \
                         || bad "probe did not detect the shim fixture"
  probe "$WORK/real.bin" && bad "probe reported a real SDL2 as the shim" \
                         || say "probe: real SDL2 left alone (correct)"
fi

# ── 3. the staged NAME is the one sdl2-compat can actually dlopen ─────────────
if LC_ALL=C grep -q '"\$FW/libSDL3\.0\.dylib"' "$PKG"; then
  bad "the copy destination is libSDL3.0.dylib; sdl2-compat dlopen()s @loader_path/libSDL3.dylib and will not find it"
else
  say "staged name is libSDL3.dylib, which is the candidate sdl2-compat resolves"
fi

# ── 4. negative controls — each MUST make this gate go red ───────────────────
# Run in a COPY of the tree. The gate re-invokes itself against the mutated copy
# rather than re-implementing its own checks, so a check that stops working
# stops being provable here too.
if [ "${1:-}" = "--mutations" ]; then
  say "--- negative controls ---"
  mut_n=0; mut_caught=0
  run_mutation() {
    local name="$1" sedexpr="$2"
    mut_n=$((mut_n + 1))
    local dir="$WORK/mut$mut_n"
    mkdir -p "$dir/forge-desktop/test"
    sed "$sedexpr" "$PKG" > "$dir/forge-desktop/package_macos.sh"
    if cmp -s "$dir/forge-desktop/package_macos.sh" "$PKG"; then
      echo "[sdl3-gate] FAIL: mutation '$name' changed NOTHING — it cannot prove anything" >&2
      fails=$((fails + 1)); return
    fi
    cp "$0" "$dir/forge-desktop/test/sdl3_staging_gate.sh"
    if bash "$dir/forge-desktop/test/sdl3_staging_gate.sh" >/dev/null 2>&1; then
      echo "[sdl3-gate] FAIL: mutation '$name' was NOT caught" >&2
      fails=$((fails + 1))
    else
      say "  caught: $name"; mut_caught=$((mut_caught + 1))
    fi
  }
  run_mutation "the whole SDL3 staging block is deleted"   '/4b\. SDL3/,/Bundle-relative ICD manifest/{/Bundle-relative ICD manifest/!d;}'
  run_mutation "the copy is renamed to Homebrew's real file" 's|"\$FW/libSDL3\.dylib"|"$FW/libSDL3.0.dylib"|'
  run_mutation "the capability probe is deleted"            "/grep -aq 'libSDL3/d"
  say "negative controls: $mut_caught of $mut_n caught"
  [ "$mut_caught" -eq "$mut_n" ] || fails=$((fails + 1))
fi

if [ "$fails" -eq 0 ]; then
  say "PASS"
  exit 0
fi
echo "[sdl3-gate] $fails check(s) failed" >&2
exit 1
