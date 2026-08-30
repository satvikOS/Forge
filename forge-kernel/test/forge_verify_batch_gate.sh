#!/usr/bin/env bash
# forge_verify_batch_gate.sh -- ONE MALFORMED RECORD MUST NOT DESTROY THE BATCH.
#
# forge_verify reads JSONL on stdin, one candidate per line. main() calls jsonString()
# SIX times (id, refStep, iouGrid, ir, inputStep, outStep) BEFORE it opens its first try
# block, and jsonString() -> jsonUnescape() used std::stoi to read a \uXXXX escape.
# std::stoi throws std::invalid_argument on "\uZZZZ", the throw escaped main, and the
# process died with SIGABRT -- taking every LATER record with it. A scoring run then
# looked like a verifier crash rather than like one bad input.
#
# MEASURED before the fix, on this exact 6-record batch:
#     unfixed  exit=134  2 of 6 records emitted   (4 lost, 3 of them WELL-FORMED)
#     fixed    exit=0    6 of 6 records emitted
#
# A quieter second defect the crash was hiding: std::stoi with base 16 STOPS at the first
# non-hex character, so "\u00ZZ" partially parsed to 0 and silently injected a NUL byte.
#     unfixed  X\u00ZZY  ->  X <NUL> Y   (invented from bad input, reported to nobody)
#     fixed    X\u00ZZY  ->  Xu00ZZY     (kept literal)
#
# This file is deliberately pure ASCII: expected multi-byte results are written as octal
# escapes, so no transport layer can silently rewrite the very bytes under test.
#
# Exit codes
#   0  GREEN
#   1  RED  -- a record was lost, an exit code was wrong, or a decode was wrong
#   3  RED  -- the binary or the fixture could not be established. A check that could not
#              run is not a check that passed, so this is red, never a skip.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"

BIN="${FORGE_VERIFY_BIN:-}"
if [ -z "$BIN" ]; then
  for cand in "$ROOT/forge-kernel/build/forge_verify" \
              "$ROOT/forge-kernel/build-app/forge_verify" \
              "$ROOT/forge-kernel/build/Release/forge_verify"; do
    [ -x "$cand" ] && { BIN="$cand"; break; }
  done
fi
if [ -z "$BIN" ] || [ ! -x "$BIN" ]; then
  echo "[fv-batch] forge_verify binary not found (set FORGE_VERIFY_BIN). Refusing to guess. RED."
  exit 3
fi
echo "[fv-batch] binary: $BIN"

TMP="$(mktemp -d "${TMPDIR:-/tmp}/fv_batch.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT
IN="$TMP/batch.jsonl"
OUT="$TMP/out.jsonl"

# \134 is an octal backslash. A literal backslash-u written in this source could be decoded
# by any layer that transports the file; an octal escape cannot be.
BS='\134'
{
  printf '%b\n' "{\"id\":\"A=${BS}u0041 z=${BS}u007A\",\"ir\":\"BOX(1,1,1)\"}"
  printf '%b\n' "{\"id\":\"euro=${BS}u20AC tilde=${BS}u00F1\",\"ir\":\"BOX(1,1,1)\"}"
  printf '%b\n' "{\"id\":\"badhex=${BS}uZZZZ\",\"ir\":\"BOX(1,1,1)\"}"
  printf '%b\n' "{\"id\":\"partial=${BS}u00ZZ\",\"ir\":\"BOX(1,1,1)\"}"
  printf '%b\n' "{\"id\":\"trunc=${BS}u00\",\"ir\":\"BOX(1,1,1)\"}"
  printf '%s\n'  '{"id":"plain","ir":"BOX(1,1,1)"}'
} > "$IN"

# A fixture that is not malformed cannot test malformed input.
got_escapes=$(grep -o '\\u' "$IN" | wc -l | tr -d ' ')
if [ "$got_escapes" -ne 7 ]; then
  echo "[fv-batch] the FIXTURE lost its escapes ($got_escapes of 7 survived). RED."
  exit 3
fi

"$BIN" < "$IN" > "$OUT" 2>"$TMP/err.log"; rc=$?
records=$(grep -c '^{' "$OUT" || true)
: "${records:=0}"

# Expected decodings, built here as bytes so the file stays ASCII.
EXP_MULTI="$(printf 'euro=\342\202\254 tilde=\303\261')"

fail=0
check() {
  if [ "$2" = "$3" ]; then printf '  PASS  %-44s %s\n' "$1" "$2"
  else printf '  FAIL  %-44s got=[%s] want=[%s]\n' "$1" "$2" "$3"; fail=$((fail+1)); fi
}
idof() { sed -n "${1}p" "$OUT" | sed -E 's/.*"id":"([^"]*)".*/\1/'; }

# THE PROPERTY: six in, six out, clean exit. A malformed escape costs its own record's
# fidelity and nothing else.
check "process exited cleanly"              "$rc"      "0"
check "every record produced a result"      "$records" "6"
# The fix must not buy robustness with correctness.
check "valid ASCII escapes decode"          "$(idof 1)" "A=A z=z"
check "valid multi-byte escapes decode"     "$(idof 2)" "$EXP_MULTI"
# Malformed escapes are kept LITERALLY, the same convention `default:` uses for any other
# unknown escape. Never a throw, and never an invented byte.
check "invalid hex kept literal (no throw)" "$(idof 3)" "badhex=uZZZZ"
check "partial hex kept literal (no NUL)"   "$(idof 4)" "partial=u00ZZ"
check "truncated escape kept literal"       "$(idof 5)" "trunc=u00"
check "an ordinary record is untouched"     "$(idof 6)" "plain"

if grep -q 'u0000' "$OUT"; then
  echo "  FAIL  a NUL byte was invented from a partial hex escape"
  fail=$((fail+1))
else
  echo "  PASS  no NUL invented from a partial hex escape"
fi

echo
if [ "$fail" -eq 0 ]; then
  echo "[fv-batch] GREEN -- 6/6 records survived a batch holding three malformed escapes."
  exit 0
fi
echo "[fv-batch] RED -- $fail check(s) failed. rc=$rc records=$records"
[ -s "$TMP/err.log" ] && sed 's/^/           stderr: /' "$TMP/err.log" | head -3
exit 1
