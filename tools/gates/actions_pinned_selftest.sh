#!/usr/bin/env bash
# actions_pinned_selftest.sh — prove actions_pinned_gate.sh can FAIL before
# anybody believes it passing.
#
# A green gate on a clean tree is not evidence. Each case below injects ONE
# defect into a copy of the real workflows and requires the gate to go red on
# it; the last case is a GREEN control, without which this suite would pass just
# as well against a gate that always exits 1.
#
# The gate reads ACTIONS_WORKFLOW_DIR, so every case runs against a temp
# directory and the repository is never modified.
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.." || exit 2

GATE=tools/gates/actions_pinned_gate.sh
SRC=.github/workflows
PINNED='11d5960a326750d5838078e36cf38b85af677262'

pass=0; fail=0
tmproot="$(mktemp -d)"
# Verify the cleanup's own post-condition: an `rm -rf` that fails silently leaves
# a copy of the workflows in /tmp and nobody is told.
cleanup() {
  rm -rf "$tmproot"
  if [ -e "$tmproot" ]; then
    echo "[actions-pinned-selftest] WARNING: $tmproot survived cleanup" >&2
    return 1
  fi
}
trap cleanup EXIT

# run <name> <expected-rc> <mutator...>
run() {
  local name="$1" want="$2"; shift 2
  local d="$tmproot/$RANDOM$RANDOM"
  mkdir -p "$d"
  cp "$SRC"/*.yml "$d"/ 2>/dev/null
  "$@" "$d" || { echo "  FAIL  $name -- the mutation itself did not apply"; fail=$((fail+1)); return; }
  local out rc
  out="$(ACTIONS_WORKFLOW_DIR="$d" bash "$GATE" 2>&1)"; rc=$?
  if [ "$rc" -eq "$want" ]; then
    printf '  ok    %-56s (exit %s)\n' "$name" "$rc"
    pass=$((pass+1))
  else
    printf '  FAIL  %-56s (exit %s, wanted %s)\n' "$name" "$rc" "$want"
    echo "$out" | sed 's/^/          /'
    fail=$((fail+1))
  fi
}

# ── the mutators. Each must CHANGE something or run() reports it broken. ──────
m_mutable_tag() {   # 1: a tag instead of a commit
  perl -0pi -e "s/\@$PINNED  # v4/\@v4/ && \$c++; END{exit(\$c?0:1)}" "$1"/kernel-tests.yml
}
m_no_comment() {    # 2: pinned, but nothing says which version
  perl -0pi -e "s/\@$PINNED  # v4/\@$PINNED/ && \$c++; END{exit(\$c?0:1)}" "$1"/kernel-tests.yml
}
m_short_sha() {     # 3: an abbreviated commit is still ambiguous
  perl -0pi -e "s/\@$PINNED/\@11d5960/ && \$c++; END{exit(\$c?0:1)}" "$1"/kernel-tests.yml
}
m_drop_pc() {       # 4: a checkout that keeps its credential
  perl -0pi -e "s/\n\s*persist-credentials: false// && \$c++; END{exit(\$c?0:1)}" "$1"/gate-registration.yml
}
m_pc_true() {       # 5: declared, and declared wrong
  perl -0pi -e "s/persist-credentials: false/persist-credentials: true/ && \$c++; END{exit(\$c?0:1)}" "$1"/gate-registration.yml
}
m_commented_pc() {  # 6: a LIVE true beside a COMMENTED false
  # The first version of the gate grepped the step block and accepted the
  # comment. GitHub does not read comments; the token stays in .git/config.
  perl -0pi -e "s/(\n(\s*)persist-credentials: )false/\$1true\n\$2# persist-credentials: false/ && \$c++; END{exit(\$c?0:1)}" "$1"/gate-registration.yml
}
m_third_party() {   # 7: the clause must not be actions/* only in spirit
  perl -0pi -e "s{uses: actions/checkout\@$PINNED  # v4}{uses: some-vendor/deploy\@main}g && \$c++; END{exit(\$c?0:1)}" "$1"/desktop-release.yml
}
m_control() { :; }  # 8: unmodified -- must stay green

echo "== actions_pinned_gate.sh mutation proof =="
run "a mutable tag instead of a commit"            1 m_mutable_tag
run "a commit with no '# version' comment"          1 m_no_comment
run "an abbreviated commit"                         1 m_short_sha
run "a checkout that keeps its credential"          1 m_drop_pc
run "persist-credentials declared TRUE"             1 m_pc_true
run "a LIVE true beside a COMMENTED false"          1 m_commented_pc
run "a third-party action on a branch"              1 m_third_party
run "GREEN CONTROL -- the real workflows"           0 m_control

echo
echo "[actions-pinned-selftest] $((pass+fail)) cases, $pass passed, $fail failed"
[ "$fail" -eq 0 ] || { echo "[actions-pinned-selftest] RED"; exit 1; }
echo "[actions-pinned-selftest] GREEN — every injected defect turns the gate red, and the real tree does not"
