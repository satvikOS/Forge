#!/usr/bin/env bash
# forge-desktop/test/update_cli_gate.sh
#
# THE GATE ON `forge_update` ITSELF — the exit codes and the sentences a person
# or a script actually sees.
#
# ── WHY THIS EXISTS SEPARATELY FROM update_gate.cpp ──────────────────────────
# update_gate.cpp is thorough about the LIBRARY: version ordering, the digest,
# the staging, the atomic swap, 167 checks and eight negative controls. It links
# libforge_updater and it does not compile main_update_cli.cpp. So the one file
# standing between the update path and a human — the one that decides what is
# printed and what is returned — was the only file in the update path that no
# gate had ever built, let alone run.
#
# Everything found there on 2026-09-03 was found by hand, and every one of them
# was invisible to the C++ gate by construction:
#
#   * `forge_update --version` read `--version` as the SUBCOMMAND, made a
#     NETWORK REQUEST, and reported "could not fetch the appcast: download
#     failed: /usr/bin/curl exited 56: curl: (56) The requested URL returned
#     error: 404" with exit 1. A typo produced a release-shaped failure.
#   * `forge_update status --appcast f.json` printed a complete, correct-looking
#     verdict block and THEN the usage text. The top of the transcript of a
#     command that did nothing was byte-identical to one that worked.
#   * a fetch failure was reported to the user as curl's own exit code.
#   * exit 1 meant BOTH "this release is refused" and "I could not reach the
#     network", so a caller could not tell a bad release from bad wifi.
#   * `--running <garbage>` was accepted, and an unparseable running version
#     orders BELOW everything — i.e. the downgrade guard silently stopped
#     working and any published version, including an older one, was offered.
#
# ── HERMETIC. NO SOCKET IS OPENED BY THIS GATE ──────────────────────────────
# Every decision case is driven from a local --appcast fixture. The cases that
# must prove the program did NOT go near the network use a TRACER instead of a
# timeout: they pass `--url https://not-github.invalid/appcast.json`, which the
# host allow-list refuses locally, and assert that its refusal line is ABSENT
# from the output. Present means the fetch path was reached; absent means the
# command was settled first. Either way nothing resolves and nothing connects.
#
# ── PROVING IT CAN FAIL ──────────────────────────────────────────────────────
#   ./update_cli_gate.sh --mutations
# builds SIX mutated copies of the sources in a temp directory — the production
# tree is never edited, and contains no test hooks — each reintroducing one of
# the defects above, and requires every one of them to turn this gate red.
#
# Hash mismatch is deliberately NOT asserted here: `check` downloads nothing, so
# a digest mismatch is not observable from this command. It is asserted end to
# end, over a real tampered payload through the real applyUpdate(), by
# update_gate.cpp — where `--mutate 4` is its negative control. What this gate
# CAN see about the digest is that a manifest whose sha256 field is not 64 hex
# characters is refused before anything is fetched, and it asserts that.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DESKTOP="$(dirname "$HERE")"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/forge_update_cli_gate.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT

MUTATIONS=0
for a in "$@"; do
  case "$a" in
    --mutations) MUTATIONS=1 ;;
    *) echo "unknown argument: $a" >&2; exit 2 ;;
  esac
done

checks=0
failures=0
ok()  { checks=$((checks+1)); }
bad() { checks=$((checks+1)); failures=$((failures+1)); echo "  FAIL  $1"; [ -n "${2:-}" ] && echo "        $2"; }

# ── build the REAL binary from a source tree ────────────────────────────────
# Same five translation units CMake's forge_update target builds. No kernel, no
# OCCT, no GPU: one compiler invocation, seconds not minutes.
build_cli() {  # <srcdir> <out>
  local src="$1" out="$2"
  c++ -std=c++20 -O1 -g -Wall -Wextra -Werror -I "$src" -o "$out" \
      "$src/update/Version.cpp" "$src/update/Sha256.cpp" "$src/update/Manifest.cpp" \
      "$src/update/Updater.cpp" "$src/update/main_update_cli.cpp" 2>&1
}

# ── fixtures ────────────────────────────────────────────────────────────────
FIX="$WORK/fixtures"; mkdir -p "$FIX"
SHA64="$(printf 'a%.0s' $(seq 1 64))"
appcast() {  # <file> <version> [channel]
  local out="$1" ver="$2" chan="${3:-stable}"
  cat > "$out" <<JSON
{
  "schema": "forge-appcast/1",
  "channel": "$chan",
  "version": "$ver",
  "arch": "arm64",
  "min_macos": "26.0",
  "url": "https://github.com/satvikOS/Forge/releases/download/v$ver/Forge-macos-arm64-$ver.zip",
  "size": 41234567,
  "sha256": "$SHA64",
  "notes_url": "https://github.com/satvikOS/Forge/releases/tag/v$ver",
  "pub_date": "2026-09-03T00:00:00Z"
}
JSON
}
appcast "$FIX/newer.json" 0.2.0
appcast "$FIX/same.json"  0.1.0
appcast "$FIX/older.json" 0.0.9
# Truncated mid-document: the shape a half-written or half-transferred file has.
printf '{ "schema": "forge-appcast/1", "version": ' > "$FIX/truncated.json"
# 63 hex characters. One short is still not a digest.
sed "s/$SHA64/${SHA64:0:63}/" "$FIX/newer.json" > "$FIX/shortsha.json"
# A payload URL on a host that merely CONTAINS github.com.
sed 's#https://github.com/satvikOS#https://github.com.evil.tld/satvikOS#' "$FIX/newer.json" \
  > "$FIX/evilhost.json"
: > "$FIX/empty.json"

# The tracer. Not on the allow-list, so the fetch path refuses it WITHOUT a DNS
# lookup; .invalid is reserved by RFC 2606 and can never resolve either.
TRACER_URL="https://not-github.invalid/appcast.json"
TRACER_LINE="not https on an allowed host"

# ── the contract ────────────────────────────────────────────────────────────
# Runs the binary under test and asserts the exit code, that the output DOES
# contain what it must, and that it does NOT contain what it must not.
CLI=""
out=""; rc=0
run_cli() { out="$("$CLI" "$@" 2>&1)"; rc=$?; }

expect() {  # <label> <want_rc> <must_contain|-> <must_not_contain|-> <args...>
  local label="$1" want="$2" must="$3" mustnot="$4"; shift 4
  run_cli "$@"
  if [ "$rc" -ne "$want" ]; then
    bad "$label: exit $rc, wanted $want" "$(echo "$out" | head -3 | tr '\n' ' ')"
    return
  fi
  if [ "$must" != "-" ] && ! printf '%s' "$out" | LC_ALL=C grep -q -- "$must"; then
    bad "$label: output never said '$must'" "$(echo "$out" | head -3 | tr '\n' ' ')"
    return
  fi
  if [ "$mustnot" != "-" ] && printf '%s' "$out" | LC_ALL=C grep -q -- "$mustnot"; then
    bad "$label: output said '$mustnot' and must not" "$(echo "$out" | head -3 | tr '\n' ' ')"
    return
  fi
  ok
}

run_contract() {
  # ── the four verdicts, from a local file, no network ──────────────────────
  expect "a NEWER release is offered (exit 0)" 0 "update 0.1.0 -> 0.2.0" - \
    check --appcast "$FIX/newer.json" --running 0.1.0
  expect "the SAME version is 'already current' (exit 10)" 10 "already on 0.1.0" - \
    check --appcast "$FIX/same.json" --running 0.1.0
  # ★ THE ONE THAT PROTECTS A USER FROM A REPLAYED MANIFEST.
  expect "an OLDER release is REFUSED (exit 1)" 1 "refusing to move backwards" - \
    check --appcast "$FIX/older.json" --running 0.1.0
  expect "and the refusal says REFUSED in plain words" 1 "REFUSED" - \
    check --appcast "$FIX/older.json" --running 0.1.0
  # A downgrade must not be one flag away either.
  expect "--insecure-allow-downgrade alone is not enough" 2 "i-mean-it" - \
    check --appcast "$FIX/older.json" --running 0.1.0 --insecure-allow-downgrade
  expect "a downgrade needs BOTH flags, and then says DOWNGRADE" 0 "DOWNGRADE" - \
    check --appcast "$FIX/older.json" --running 0.1.0 --insecure-allow-downgrade --i-mean-it

  # ── malformed input is refused, never guessed at ──────────────────────────
  expect "a truncated appcast is refused (exit 1)" 1 "did not parse" "verdict" \
    check --appcast "$FIX/truncated.json" --running 0.1.0
  expect "a 63-character sha256 is refused before any download" 1 "64 hex" - \
    check --appcast "$FIX/shortsha.json" --running 0.1.0
  expect "a payload URL on github.com.evil.tld is refused" 1 "not https on an allowed host" - \
    check --appcast "$FIX/evilhost.json" --running 0.1.0

  # ── could-not-check is NOT the same answer as refused ─────────────────────
  expect "an unreadable appcast is 'could not check' (exit 3)" 3 "could not read" "verdict" \
    check --appcast "$FIX/does-not-exist.json" --running 0.1.0
  expect "an empty appcast file is 'could not check' (exit 3)" 3 "could not read" "verdict" \
    check --appcast "$FIX/empty.json" --running 0.1.0

  # ── the command line is settled BEFORE the network ────────────────────────
  # Each of these passes the tracer URL. If the program reaches the fetch path
  # it prints the allow-list refusal; asserting that line is ABSENT is what
  # proves the argument was handled first.
  expect "--version prints a version and never fetches" 0 "forge_update" "$TRACER_LINE" \
    --version --url "$TRACER_URL"
  expect "an unknown COMMAND exits 2, prints no verdict, never fetches" 2 "unknown command" "verdict" \
    status --url "$TRACER_URL"
  expect "...and an unknown command does not reach the fetch path" 2 "unknown command" "$TRACER_LINE" \
    status --url "$TRACER_URL"
  expect "an unknown FLAG exits 2 and never fetches" 2 "unknown argument" "$TRACER_LINE" \
    check --frobnicate --url "$TRACER_URL"
  expect "a flag missing its value says so" 2 "needs a value" - \
    check --appcast
  expect "--help exits 0 and prints the exit codes" 0 "exit codes" - --help
  expect "no arguments at all exits 2" 2 "forge_update" - 

  # ── a running version nobody can order turns the downgrade guard off ──────
  expect "--running <garbage> is refused (exit 2), not silently accepted" 2 "not a version" "verdict" \
    check --appcast "$FIX/newer.json" --running not-a-version
  expect "...and an OLDER release is not smuggled in behind a garbage --running" 2 "not a version" "verdict" \
    check --appcast "$FIX/older.json" --running "Forge 1.0"

  # ── nothing above ever printed curl's own words ───────────────────────────
  run_cli check --appcast "$FIX/newer.json" --running 0.1.0
  if printf '%s' "$out" | LC_ALL=C grep -q 'curl'; then
    bad "a successful check must not mention curl" "$out"
  else ok; fi
}

echo "── the forge_update CLI gate ──────────────────────────────────────────"
echo "compiling the real forge_update (no kernel, no OCCT, no GPU)"
CLI="$WORK/forge_update"
if ! berr="$(build_cli "$DESKTOP/src" "$CLI")"; then
  echo "COMPILE FAILED -- a gate that cannot build cannot fail." >&2
  echo "$berr" >&2
  exit 2
fi
run_contract
echo "$checks checks, $failures failures"
fail=0
[ "$failures" -eq 0 ] || fail=1

# ── negative controls ───────────────────────────────────────────────────────
# Each mutation copies the sources to a temp tree, reintroduces exactly one of
# the defects this gate was written for, and MUST make the run above go red. A
# mutation whose anchor no longer matches is a HARD ERROR, not a pass: a
# mutation that quietly stopped applying would report the unmutated binary as
# "not caught" and look like a different failure.
mutate() {  # <n> <srcdir>
  local n="$1" dir="$2"
  MUT_N="$n" python3 - "$dir" <<'PY'
import os, sys
d = sys.argv[1]
n = int(os.environ["MUT_N"])
def edit(rel, old, new):
    p = os.path.join(d, rel)
    s = open(p).read()
    if old not in s:
        sys.stderr.write("MUTATION ANCHOR NOT FOUND in %s: %r\n" % (rel, old[:60]))
        sys.exit(3)
    open(p, "w").write(s.replace(old, new, 1))

if n == 1:
    # `--version` is read as a subcommand and falls through to the network --
    # the shipped defect, exactly.
    edit("update/main_update_cli.cpp",
         'if (cmd == "--version" || cmd == "-V" || cmd == "version") {',
         'if (false) {')
    edit("update/main_update_cli.cpp",
         'if (cmd != "check" && cmd != "apply") {',
         'if (false) {')
elif n == 2:
    # An unknown command runs the whole check and prints a verdict for it.
    edit("update/main_update_cli.cpp",
         'if (cmd != "check" && cmd != "apply") {',
         'if (false) {')
elif n == 3:
    # "Be helpful about rollbacks": the shipping default allows a downgrade.
    edit("update/Updater.hpp", "bool allow_downgrade = false;", "bool allow_downgrade = true;")
elif n == 4:
    # A refusal is reported as a success. THE failure this whole task names.
    edit("update/main_update_cli.cpp",
         'std::fprintf(stderr, "REFUSED: %s\\n", plan.reason.c_str());\n    return 1;',
         'std::fprintf(stderr, "REFUSED: %s\\n", plan.reason.c_str());\n    return 0;')
elif n == 5:
    # "Could not check" is reported as "refused" again -- the conflation that
    # tells a user their release is bad when their wifi is off.
    edit("update/main_update_cli.cpp",
         'std::fprintf(stderr, "could not read the appcast file %s\\n", appcast_file.c_str());\n      return 3;',
         'std::fprintf(stderr, "could not read the appcast file %s\\n", appcast_file.c_str());\n      return 1;')
elif n == 6:
    # A running version nobody can parse is accepted, so ordering -- and with it
    # the downgrade guard -- silently stops working.
    edit("update/main_update_cli.cpp",
         "if (running_was_given && !parseVersion(running).valid) {",
         "if (running_was_given && false) {")  # keeps the variable used: -Werror
else:
    sys.stderr.write("no such mutation %d\n" % n); sys.exit(3)
PY
}

if [ "$MUTATIONS" -eq 1 ]; then
  echo
  echo "── negative controls: every mutation must make this gate go red ───────"
  for n in 1 2 3 4 5 6; do
    MDIR="$WORK/mut$n"
    rm -rf "$MDIR"; mkdir -p "$MDIR"
    cp -R "$DESKTOP/src/." "$MDIR/"
    if ! mutate "$n" "$MDIR"; then
      echo "MUTATION $n COULD NOT BE APPLIED -- its anchor has moved. Fix the mutation."
      fail=1
      continue
    fi
    CLI="$MDIR/forge_update_mut$n"
    if ! berr="$(build_cli "$MDIR" "$CLI")"; then
      echo "MUTATION $n DID NOT COMPILE -- fix the mutation, not the gate."
      echo "$berr" | head -5
      fail=1
      continue
    fi
    checks=0; failures=0
    run_contract > "$WORK/mut$n.out" 2>&1
    if [ "$failures" -eq 0 ]; then
      echo "MUTATION $n STAYED GREEN -- the check it targets is unfalsifiable."
      fail=1
    else
      echo "  mutation $n turned the gate RED, as it must ($failures of $checks checks)"
      sed 's/^/      /' "$WORK/mut$n.out" | head -4
    fi
  done
fi

echo
if [ "$fail" -ne 0 ]; then
  echo "RESULT: FAILED"
  exit 1
fi
echo "RESULT: PASSED"
