#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# occt_lib_resolution_gate.sh — the ledger number cannot be fabricated by a
# MISSING library.
#
# Three scripts read OCCT libraries off disk and, until this gate, all three
# treated "not there" as "nothing to report" instead of as an error:
#
#   scripts/occt_closure_count.sh  OCCT_CLOSURE — declared "THE LEDGER NUMBER",
#       "monotone: it cannot fall unless a library genuinely stops loading".
#       Its BFS expands a dependency only if the dependency resolves to a real
#       file, so ONE unresolvable libTK* truncates the search at the binary and
#       the closure silently collapses onto the (gameable) direct count.
#       MEASURED on this machine: 14 -> 8, exit 0, no warning. A Homebrew
#       upgrade, a relocated OCCT, or a host with no OCCT would each have
#       "improved" the one number this programme measures progress by.
#
#   tools/occt_symbol_census.sh                    hardcoded libTK*.7.9.dylib
#   forge-kernel/test/run_ab_native_offsetshape.sh hardcoded libTKOffset.7.9.dylib
#       On any other OCCT version, or on Linux, the census printed MISSING for
#       every toolkit and still exited 0 with an all-zero census, and the A/B's
#       central claim — "the engine imports ZERO TKOffset symbols" — became
#       VACUOUSLY TRUE, because the intersection with an empty symbol table is
#       empty whatever the engine imports.
#
# Every assertion below is a VALUE against a REFERENCE, and the failure modes are
# reproduced physically: a copy of the real binary whose OCCT install-names are
# rewritten to a directory that does not exist (a relocated OCCT), and a lib
# directory holding the real toolkits under a DIFFERENT version suffix (an
# upgrade).
#
# usage: bash forge-kernel/test/occt_lib_resolution_gate.sh [BINARY]
#   BINARY            defaults to forge-kernel/build/Release/forge-kernel.node
#   EXPECT_CLOSURE    the measured ledger number for that binary (default 14)
#   OCCT_GATE_ROOT    repo root holding the scripts under test (default: this
#                     checkout) — lets the gate be pointed at the pre-fix tree to
#                     demonstrate that it is able to fail.
# exit 0 iff every assertion holds.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="${OCCT_GATE_ROOT:-$(cd "$HERE/../.." && pwd)}"
CLOSURE_SH="$ROOT/forge-kernel/scripts/occt_closure_count.sh"
CENSUS_SH="$ROOT/tools/occt_symbol_census.sh"
AB_SH="$ROOT/forge-kernel/test/run_ab_native_offsetshape.sh"

BIN="${1:-}"
if [ -z "$BIN" ]; then
  for c in "$ROOT/forge-kernel/build/Release/forge-kernel.node" \
           "${FORGE_KERNEL:-}" ; do
    [ -n "$c" ] && [ -f "$c" ] && { BIN="$c"; break; }
  done
fi
[ -n "$BIN" ] && [ -f "$BIN" ] || { echo "FATAL: no binary to measure (pass one)"; exit 2; }
EXPECT_CLOSURE="${EXPECT_CLOSURE:-14}"

TMP="$(mktemp -d "${TMPDIR:-/tmp}/occt_res_gate.XXXXXX")"; trap 'rm -rf "$TMP"' EXIT
PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); printf '  PASS  %s\n' "$1"; }
bad()  { FAIL=$((FAIL+1)); printf '  FAIL  %s\n' "$1"; [ $# -gt 1 ] && printf '        %s\n' "$2"; }

echo "== OCCT library-resolution gate =="
echo "   root   : $ROOT"
echo "   binary : $BIN"
echo

# ── T1 — the real number, against the reference ──────────────────────────────
out="$(bash "$CLOSURE_SH" "$BIN" --json 2>"$TMP/t1.err")"; rc=$?
got="$(printf '%s' "$out" | sed -n 's/.*"closure":\([0-9]*\).*/\1/p')"
if [ "$rc" -eq 0 ] && [ "$got" = "$EXPECT_CLOSURE" ]; then
  ok "T1 OCCT_CLOSURE = $got (reference $EXPECT_CLOSURE), exit 0"
else
  bad "T1 OCCT_CLOSURE = '${got:-<none>}' exit $rc, expected $EXPECT_CLOSURE exit 0" \
      "$(head -3 "$TMP/t1.err")"
fi

# ── T2 — a RELOCATED OCCT must be fatal, not a smaller ledger number ─────────
# Physical reproduction: copy the binary and rewrite every OCCT install-name to
# a directory that does not exist. Nothing else changes; the recorded toolkit
# NAMES are identical, so OCCT_DIRECT is unchanged and only the closure BFS is
# starved. Pre-fix this printed OCCT_CLOSURE = OCCT_DIRECT and exited 0.
if command -v install_name_tool >/dev/null && [ "$(uname -s)" = "Darwin" ]; then
  cp "$BIN" "$TMP/relocated.node"
  chmod u+w "$TMP/relocated.node"
  nrw=0
  while IFS= read -r dep; do
    case "$(basename "$dep")" in
      libTK*) install_name_tool -change "$dep" "/nonexistent-occt/lib/$(basename "$dep")" \
                 "$TMP/relocated.node" 2>/dev/null && nrw=$((nrw+1)) ;;
    esac
  done < <(otool -L "$BIN" | awk 'NR>1{print $1}')
  if [ "$nrw" -lt 1 ]; then
    bad "T2 could not rewrite any OCCT install-name — test not run"
  else
    out2="$(bash "$CLOSURE_SH" "$TMP/relocated.node" 2>"$TMP/t2.err")"; rc2=$?
    if [ "$rc2" -eq 0 ]; then
      bad "T2 relocated OCCT ($nrw names) exited 0 and reported: $(printf '%s' "$out2" | sed -n 's/.*OCCT_CLOSURE *= *\([0-9]*\).*/closure=\1/p' | head -1)" \
          "a missing library must never be reported as a smaller ledger number"
    elif printf '%s' "$out2" | grep -q 'OCCT_CLOSURE'; then
      bad "T2 exited $rc2 but still printed an OCCT_CLOSURE number"
    else
      ok "T2 relocated OCCT ($nrw names) -> exit $rc2, no closure number printed"
      grep -q 'unresolved' "$TMP/t2.err" \
        && ok "T2b the error names the unresolved libraries" \
        || bad "T2b the error does not list what could not be resolved"
    fi
  fi
else
  echo "  SKIP  T2 (needs Darwin install_name_tool)"
fi

# ── T3 — helper resolves any version, and fails when there is nothing ────────
. "$ROOT/forge-kernel/scripts/occt_lib_path.sh" 2>/dev/null || true
if ! command -v occt_lib_path >/dev/null 2>&1 && ! type occt_lib_path >/dev/null 2>&1; then
  bad "T3 occt_lib_path helper not found under $ROOT"
else
  REAL="$(OCCT_LIB_DIR= occt_lib_path TKOffset 2>/dev/null)"
  if [ -z "$REAL" ]; then
    bad "T3 helper cannot find libTKOffset on this machine"
  else
    # An UPGRADED OCCT: the same file under a version suffix nothing hardcodes.
    mkdir -p "$TMP/occt-9.9/lib" "$TMP/occt-empty/lib"
    for tk in TKBRep TKernel TKFillet TKG3d TKMath TKOffset TKShHealing TKTopAlgo \
              TKBO TKG2d TKBool TKPrim TKGeomAlgo TKGeomBase ; do
      r="$(OCCT_LIB_DIR= occt_lib_path "$tk" 2>/dev/null)" || continue
      ln -sf "$(readlink -f "$r" 2>/dev/null || python3 -c 'import os,sys;print(os.path.realpath(sys.argv[1]))' "$r")" \
             "$TMP/occt-9.9/lib/lib${tk}.9.9.dylib"
    done
    v="$(OCCT_LIB_DIR="$TMP/occt-9.9/lib" occt_lib_path TKOffset 2>/dev/null)"
    [ "$v" = "$TMP/occt-9.9/lib/libTKOffset.9.9.dylib" ] \
      && ok "T3 helper resolves an unhardcoded version: $(basename "$v")" \
      || bad "T3 helper returned '${v:-<none>}' for the 9.9 tree"
    # The failure path itself: a toolkit that exists in NO searched directory.
    # (Pointing OCCT_LIB_DIR at an empty dir is not enough — the helper falls
    # back to the standard prefixes by design, and would find the real one.)
    if OCCT_LIB_DIR="$TMP/occt-empty/lib" occt_lib_path TKNoSuchToolkit >/dev/null 2>&1; then
      bad "T3b helper reported success for a toolkit that does not exist"
    else
      ok "T3b helper fails (non-zero) when the toolkit is absent everywhere"
    fi
  fi
fi

# ── T4 — the census must not report an all-zero result off missing files ─────
if [ -f "$CENSUS_SH" ]; then
  # NB: `$?` after a pipeline is the LAST command's status, so the census exit
  # code is captured BEFORE anything is piped to tail.
  bash "$CENSUS_SH" "$BIN" "$TMP/cen_real" >"$TMP/t4r.out" 2>"$TMP/t4r.err"; rcr=$?
  OCCT_LIB_DIR="$TMP/occt-9.9/lib" bash "$CENSUS_SH" "$BIN" "$TMP/cen_fake" \
      >"$TMP/t4f.out" 2>"$TMP/t4f.err"; rcf=$?
  real_out="$(grep 'needed=' "$TMP/t4r.out" || true)"
  fake_out="$(grep 'needed=' "$TMP/t4f.out" || true)"
  if [ "$rcr" -ne 0 ]; then
    bad "T4 census failed on the real lib dir (exit $rcr)" "$(head -3 "$TMP/t4r.err")"
  elif grep -q MISSING "$TMP/t4r.out"; then
    bad "T4 census printed MISSING against the real lib dir"
  elif [ "$rcf" -ne 0 ] || [ "$fake_out" != "$real_out" ]; then
    bad "T4 census on a version-bumped lib dir (exit $rcf) disagreed with the real one" \
        "$(printf '%s' "$fake_out" | head -3)"
  else
    n="$(printf '%s\n' "$real_out" | grep -c 'needed=')"
    ok "T4 census: $n toolkits, identical counts on 7.9.x and on a 9.9 tree"
  fi
else
  bad "T4 census script not found at $CENSUS_SH"
fi

# ── T5 — no script may hardcode an OCCT version in a library path ────────────
# Comments are stripped first: the two scripts now DOCUMENT the old hardcoded
# spelling in the note explaining why it was wrong, and that prose is not code.
hits="$(for f in "$CENSUS_SH" "$AB_SH"; do
          [ -f "$f" ] || continue
          sed 's/#.*//' "$f" | grep -n 'libTK[A-Za-z0-9]*\.[0-9][0-9]*\.[0-9][0-9]*\.dylib' \
            | sed "s|^|$(basename "$f"):|"
        done)"
if [ -n "$hits" ]; then
  bad "T5 hardcoded versioned OCCT library path(s) remain" "$(printf '%s' "$hits" | head -3)"
else
  ok "T5 neither the census nor the family-H A/B hardcodes libTK*.<ver>.dylib"
fi

echo
echo "  $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
