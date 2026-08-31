#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# release_visibility_check_selftest.sh — prove release_visibility_check.sh fires
# in BOTH directions.
#
# release_visibility_check.sh is the only thing standing between a published
# release and a release that no installed copy of Forge can see. The desktop
# release workflow now runs it after publishing and fails the build on its
# verdict, which makes its verdict load-bearing — and a check whose red path has
# never been exercised is decorative regardless of how it reads.
#
# ★ A CHECK THAT ONLY EVER SAYS "FAIL" IS NOT A CHECK EITHER. Today the live
# repository has exactly one release and it is DRAFT+PRERELEASE, so the check
# returns 1 — which means every observation of it so far is consistent with a
# script that unconditionally exits 1. Case A below is the positive control that
# rules that out, and it is the case to read first.
#
# HOW: release_visibility_check.sh reaches the outside world through exactly two
# calls, `gh api repos/<repo>/releases` and `gh api repos/<repo>/releases/latest`
# (lines 44 and 68). This puts a STUB `gh` first on PATH that answers both from a
# fixture, so every arm is driven against known state. Nothing is published,
# nothing is deleted, and no network or GitHub authentication is required.
#
# Seven cases:
#   A  published, not draft, not prerelease, appcast.json + zip   -> exit 0  GREEN
#   B  the only release is a DRAFT           (latest 404s)        -> exit 1  RED
#   C  the only release is a PRERELEASE      (latest 404s)        -> exit 1  RED
#   D  published, but NO appcast.json asset                       -> exit 1  RED
#   E  published, but NO .zip asset                               -> exit 1  RED
#   F  published and complete, but the WRONG version              -> exit 1  RED
#   G  `gh api .../releases` fails outright (no auth, no network) -> exit 1  RED
#
# B and C are the two states GitHub's `releases/latest` skips, and they are the
# ones that produced the 404 measured on this repository on 2026-08-31. D and E
# are the states where `latest` resolves but the updater still finds nothing to
# read or nothing to download — a release that is visible and useless. F proves
# --expect-version is not ignored, which matters because the workflow passes the
# version it just built and would otherwise accept a stale release as proof.
#
# Needs nothing: no OCCT, no SDL2, no compiler, no kernel build, no network.
# Runs in about a second.
#
# Exit codes: 0 all seven behaved as documented, 1 otherwise.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CHECK="$HERE/release_visibility_check.sh"

if [ ! -f "$CHECK" ]; then
  echo "[selftest] release_visibility_check.sh is missing at $CHECK. RED."; exit 1
fi

WORK="$(mktemp -d "${TMPDIR:-/tmp}/release_vis_selftest.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$WORK/bin"

# ── the stub `gh` ────────────────────────────────────────────────────────────
# Answers the two calls the check makes, from files this script writes per case.
# `releases/latest` is served ONLY if $WORK/latest.json exists — its ABSENCE is
# how GitHub's 404 for a draft-or-prerelease-only repository is modelled, which
# is the behaviour under test, not an approximation of it.
cat > "$WORK/bin/gh" <<'STUB'
#!/usr/bin/env bash
# stub gh — release_visibility_check_selftest.sh
[ "${1:-}" = "api" ] || { echo "stub gh: unexpected argv: $*" >&2; exit 2; }
case "${2:-}" in
  */releases/latest)
    [ -f "$FIXTURE_DIR/latest.json" ] || exit 1
    cat "$FIXTURE_DIR/latest.json" ;;
  */releases)
    [ -f "$FIXTURE_DIR/all.json" ] || exit 1
    cat "$FIXTURE_DIR/all.json" ;;
  *) echo "stub gh: unexpected api path: ${2:-}" >&2; exit 2 ;;
esac
STUB
chmod +x "$WORK/bin/gh"

export FIXTURE_DIR="$WORK"
PATH="$WORK/bin:$PATH"; export PATH

# Guard against testing the real gh by accident: if the stub is not the one that
# would run, every arm below is meaningless.
RESOLVED="$(command -v gh)"
if [ "$RESOLVED" != "$WORK/bin/gh" ]; then
  echo "[selftest] PATH shim did not take: gh resolves to $RESOLVED. RED."; exit 1
fi

BAD=0

# published(tag, assets...) -> writes all.json and latest.json
publish() {
  local tag="$1"; shift
  local assets="" sep=""
  for a in "$@"; do assets="$assets$sep{\"name\":\"$a\"}"; sep=","; done
  cat > "$WORK/latest.json" <<EOF
{"tag_name":"$tag","draft":false,"prerelease":false,"assets":[$assets]}
EOF
  cat > "$WORK/all.json" <<EOF
[{"tag_name":"$tag","draft":false,"prerelease":false,"assets":[$assets]}]
EOF
}

# invisible(tag, draft, prerelease) -> all.json only; NO latest.json, i.e. 404
invisible() {
  cat > "$WORK/all.json" <<EOF
[{"tag_name":"$1","draft":$2,"prerelease":$3,"assets":[]}]
EOF
  rm -f "$WORK/latest.json"
}

# run <case> <expected-rc> <label> [extra args to the check]
run() {
  local name="$1" want="$2" label="$3"; shift 3
  local out rc
  out="$("$CHECK" "$@" 2>&1)"; rc=$?
  if [ "$rc" -eq "$want" ]; then
    printf '  ok    %s  rc=%d  %s\n' "$name" "$rc" "$label"
  else
    printf '  FAIL  %s  rc=%d (wanted %d)  %s\n' "$name" "$rc" "$want" "$label"
    printf '%s\n' "$out" | sed 's/^/          /'
    BAD=$((BAD+1))
  fi
}

echo "[selftest] release_visibility_check.sh — does it fire in both directions?"

# ── A. THE POSITIVE CONTROL ──────────────────────────────────────────────────
# Without this the whole suite would pass against `exit 1`.
publish "v0.1.0" "Forge-macos-arm64-0.1.0.zip" "Forge-macos-arm64-0.1.0.zip.sha256" "appcast.json"
run A 0 "published + appcast + zip -> an installed Forge WOULD find it"
run A2 0 "same, and --expect-version is satisfied" --expect-version 0.1.0

# ── B/C. the two states GitHub's `latest` skips ──────────────────────────────
invisible "v0.1.0-alpha.0" true false
run B 1 "DRAFT only -> releases/latest 404s"

invisible "v0.1.0-alpha.0" false true
run C 1 "PRERELEASE only -> releases/latest 404s"

# ── D/E. visible, and still useless ──────────────────────────────────────────
publish "v0.1.0" "Forge-macos-arm64-0.1.0.zip"
run D 1 "published but NO appcast.json -> nothing for the updater to read"

publish "v0.1.0" "appcast.json"
run E 1 "published but NO zip -> an appcast pointing at nothing"

# ── F. --expect-version is not decorative either ─────────────────────────────
publish "v0.0.9" "Forge-macos-arm64-0.0.9.zip" "appcast.json"
run F 1 "complete, but the WRONG version" --expect-version 0.1.0

# ── G. the instrument itself unavailable ─────────────────────────────────────
rm -f "$WORK/all.json" "$WORK/latest.json"
run G 1 "cannot list releases at all (no auth / no network)"

echo
if [ "$BAD" -ne 0 ]; then
  echo "[selftest] $BAD case(s) did not behave as documented. RED."
  exit 1
fi
echo "[selftest] all 8 arms behaved as documented — the check is falsifiable in"
echo "[selftest] both directions and is not a constant."
