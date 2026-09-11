#!/bin/bash
# ============================================================================
# GATE: the release job's "what is already published" lookup
#
# Extracts the block from the SHIPPED desktop-release.yml -- not a copy -- and
# drives it with a stub `gh` reproducing the MEASURED behaviour of the real one:
#   404      -> exit 1, "gh: Not Found (HTTP 404)" on stderr, 130-byte JSON body
#               on STDOUT. It was that stdout body, captured by `|| true`, that
#               made PREV non-empty and failed 11 of 14 runs.
#   success  -> tag on stdout, exit 0
#   other    -> exit 1 with a NON-404 message (rate limit, outage)
# ============================================================================
set -uo pipefail
SRC="${1:-$(dirname "$0")/../desktop-release.yml}"
YML="$SRC"
[ -f "$YML" ] || { echo "no workflow at $YML" >&2; exit 1; }

PASS=0; FAIL=0
ck() { if [ "$2" = "$3" ]; then PASS=$((PASS+1)); echo "  ok   $1"; else FAIL=$((FAIL+1)); echo "  FAIL $1 -> got '$2' want '$3'"; fi; }

WORK=$(mktemp -d); trap 'rm -rf "$WORK"' EXIT

extract() {   # the self-contained published-release block from the shipped yaml
  python3 - "$YML" "$WORK/block.sh" <<'PY'
import sys
s=open(sys.argv[1]).read()
a=s.index("# ── WHAT IS ALREADY PUBLISHED")
b=s.index("# ── DOES THE TAG ALREADY POINT SOMEWHERE ELSE?", a)
out=[]
for ln in s[a:b].splitlines():
    out.append(ln[10:] if ln.startswith(" "*10) else ln)
open(sys.argv[2],"w").write("\n".join(out)+'\necho "REACHED_END"\n')
PY
}

mkgh() {  # $1 = mode
  cat > "$WORK/bin/gh" <<EOF
#!/bin/bash
case "\$1" in
  api)
    case "$1" in
      notfound)
        printf '{"message":"Not Found","documentation_url":"https://docs.github.com/rest/releases/releases#get-the-latest-release","status":"404"}'
        echo "gh: Not Found (HTTP 404)" >&2
        exit 1 ;;
      ok)        printf 'v0.1.5'; exit 0 ;;
      garbage)   printf 'not-a-version-at-all'; exit 0 ;;
      ratelimit)
        printf '{"message":"API rate limit exceeded"}'
        echo "gh: API rate limit exceeded (HTTP 403)" >&2
        exit 1 ;;
    esac ;;
esac
exit 0
EOF
  chmod +x "$WORK/bin/gh"
}

run_case() {  # $1 = gh mode, $2 = approved  -> prints "rc|stdout"
  rm -rf "$WORK/bin"; mkdir -p "$WORK/bin"; mkgh "$1"
  local out rc
  out=$(cd "$WORK" && PATH="$WORK/bin:$PATH" \
        GITHUB_REPOSITORY="acme/forge" RUNNER_TEMP="$WORK" TAG="v0.1.9" \
        GITHUB_OUTPUT="$WORK/out.txt" FORGE_FIRST_RELEASE_APPROVED="$2" \
        bash "$WORK/block.sh" 2>&1); rc=$?
  printf '%s|%s' "$rc" "$out"
}

gate() {
  PASS=0; FAIL=0
  extract
  local r

  r=$(run_case notfound "");        rc=${r%%|*}; out=${r#*|}
  ck "C1a 404 + not approved: exits 0"          "$rc" "0"
  ck "C1b 404: takes the FIRST-release path"    "$(echo "$out" | grep -c 'FIRST one')" "1"
  ck "C1c 404: does NOT echo the error body"    "$(echo "$out" | grep -c 'Not Found')" "0"
  ck "C1d 404: continues into the publish path"  "$(echo "$out" | grep -c 'REACHED_END')" "1"

  r=$(run_case ok "");              rc=${r%%|*}; out=${r#*|}
  ck "C3a published tag: exits 0"               "$rc" "0"
  ck "C3b published tag: reports it"            "$(echo "$out" | grep -c 'currently published latest: v0.1.5')" "1"
  ck "C3c published tag: reaches the rest"      "$(echo "$out" | grep -c 'REACHED_END')" "1"

  r=$(run_case ratelimit "");       rc=${r%%|*}; out=${r#*|}
  ck "C4a NON-404 error: REFUSES (exit 1)"      "$rc" "1"
  ck "C4b NON-404 error: says it is not a 404"  "$(echo "$out" | grep -c 'not a 404')" "1"
  ck "C4c NON-404 error: does not continue"     "$(echo "$out" | grep -c 'REACHED_END')" "0"

  r=$(run_case garbage "");         rc=${r%%|*}; out=${r#*|}
  ck "C5a non-version reply: REFUSES"           "$rc" "1"
  ck "C5b non-version reply: names the value"   "$(echo "$out" | grep -c 'not-a-version-at-all')" "1"
  ck "C5c non-version reply: does not continue" "$(echo "$out" | grep -c 'REACHED_END')" "0"

  [ "$FAIL" -eq 0 ]
}

echo "[prev-lookup] clean run"
if gate; then echo "[prev-lookup] clean GREEN ($PASS checks)"; CLEAN=$PASS
else echo "[prev-lookup] clean RED ($FAIL failures)"; exit 1; fi

# ==========================================================================
# MUTATION PROOF. A mutant only counts if it APPLIED and the file still parses.
# ==========================================================================
MUT="$WORK/wf.yml"
apply_mut() {
  cp "$SRC" "$MUT"
  python3 - "$MUT" "$1" <<'PY'
import sys
p,n=sys.argv[1],sys.argv[2]; s=o=open(p).read()
if n=="1":   # the original one-liner: || true masks exit 1, stdout body lands in PREV
    a=s.index("          PREV_ERR=")
    b=s.index("          # A tag is a tag.")
    s=s[:a]+'          PREV="$(gh api "repos/${GITHUB_REPOSITORY}/releases/latest" --jq \'.tag_name\' 2>/dev/null || true)"\n\n'+s[b:]
elif n=="2": # treat EVERY failure as a 404
    s=s.replace("""          elif grep -qi 'not found\\|HTTP 404' "$PREV_ERR"; then""","          elif true; then",1)
elif n=="3": # drop the semver validation
    a=s.index("          # A tag is a tag.")
    b=s.index('          if [ -n "${PREV:-}" ]; then\n            echo "currently published latest')
    s=s[:a]+s[b:]
elif n=="4": # drop the first-release approval gate
    s=s.replace('            if [ "${FORGE_FIRST_RELEASE_APPROVED:-}" != "true" ]; then','            if false; then',1)
elif n=="5": # CONTROL
    s=s.replace("# ── WHAT IS ALREADY PUBLISHED","# ── WHAT IS ALREADY PUBLISHED (control)",1)
assert s!=o, "MUTATION DID NOT APPLY"
open(p,"w").write(s)
PY
}

# Indexed BY MUTATION NUMBER. Slot 4 is deliberately empty: it tested the
# first-release approval gate, which was reverted in favour of the repo's own
# FORGE_AUTORELEASE brake. Renumbering instead would have silently re-pointed
# every later expectation at a different mutation.
MDESC=( "" "the || true one-liner restored -> the 404 body lands in PREV" \
           "every failure treated as a 404 -> an outage reads as 'no release'" \
           "semver validation removed -> a non-version reply flows downstream" \
           "(retired: approval gate reverted)" \
           "CONTROL: a comment edit (must stay GREEN)" )
MWANT=( "" RED RED RED "" GREEN )
MFAIL=0
for n in 1 2 3 5; do
  if ! apply_mut "$n" 2>/dev/null; then echo "  mutation $n: DID NOT APPLY -- void"; MFAIL=$((MFAIL+1)); continue; fi
  if cmp -s "$SRC" "$MUT"; then echo "  mutation $n: file unchanged -- void"; MFAIL=$((MFAIL+1)); continue; fi
  if ! ruby -ryaml -e 'YAML.load_file(ARGV[0])' "$MUT" 2>/dev/null; then echo "  mutation $n: YAML broken -- void"; MFAIL=$((MFAIL+1)); continue; fi
  YML="$MUT"
  if gate >/dev/null 2>&1; then got=GREEN; else got=RED; fi
  YML="$SRC"
  want=${MWANT[$n]}
  if [ "$got" = "$want" ]; then echo "  mutation $n: $got (as required) -- ${MDESC[$n]}"
  else echo "  mutation $n: $got but should be $want -- ${MDESC[$n]}"; MFAIL=$((MFAIL+1)); fi
done

echo
if [ "$MFAIL" -eq 0 ]; then
  echo "[prev-lookup] GREEN -- clean run passes ($CLEAN checks), 3 mutations red, control green"; exit 0
else
  echo "[prev-lookup] RED -- $MFAIL mutation(s) behaved wrongly"; exit 1
fi
