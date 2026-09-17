#!/bin/zsh
# test_manifest_gate.sh -- prove forge-manifest can actually FAIL.
#
# The manifest gate exists because a write_set that lives only in an agent's prompt
# is unenforceable. So the only test that matters is the one showing the gate RED
# when an agent writes where it said it would not. Every assertion below is proved
# in BOTH directions: the green case and the red case.
set -u
BIN=${0:A:h}/../bin/forge-manifest
PASS=0; FAIL=0
ok()   { print "  ok   $1"; PASS=$((PASS+1)) }
bad()  { print "  FAIL $1"; FAIL=$((FAIL+1)) }
# expect <wanted-exit> <label> -- cmd...
expect() {
  local want=$1 label=$2; shift 2
  local out; out=$("$@" 2>&1); local got=$?
  if [[ $got == $want ]]; then ok "$label (exit $got)"; else
    bad "$label: wanted exit $want, got $got"; print "$out" | sed 's/^/       /'; fi
}

WORK=$(mktemp -d "${TMPDIR:-/tmp}/manifest-gate.XXXXXX") || exit 1
trap 'rm -rf "$WORK"' EXIT INT TERM
R=$WORK/repo
mkdir -p "$R"/{src/geometry,src/document,tests}
cd "$R" || exit 1
git init -q . && git config user.email t@t && git config user.name t
print base > src/geometry/Extrude.cpp
print base > src/document/Doc.cpp
print base > tests/t.cpp
git add -A && git commit -qm base
BASE=$(git rev-parse HEAD)

print "== manifest that declares src/geometry only =="
"$BIN" write --worktree "$R" >/dev/null <<YAML
task_id: FG-123
resource: peak_ram_gb_estimate=2, build_class=incremental, max_threads=2
objective: "prove the gate"
write_set:
  - src/geometry/*
forbidden_write_set:
  - src/document/*
acceptance:
  - "the gate goes red"
YAML
[[ -f "$R/.forge-manifest.json" ]] && ok "step 9: manifest written INTO the worktree" \
                                   || bad "step 9: no manifest file"

print "== GREEN: a change inside write_set =="
print edit >> src/geometry/Extrude.cpp
expect 0 "inside write_set passes" "$BIN" check --worktree "$R"

print "== RED: a change outside write_set =="
print edit >> tests/t.cpp
expect 1 "outside write_set FAILS" "$BIN" check --worktree "$R"
"$BIN" check --worktree "$R" 2>&1 | grep -q 'tests/t.cpp' \
  && ok "names the offending path" || bad "violation did not name tests/t.cpp"
git checkout -q -- tests/t.cpp

print "== RED: a change inside forbidden_write_set =="
print edit >> src/document/Doc.cpp
expect 1 "forbidden_write_set FAILS" "$BIN" check --worktree "$R"
"$BIN" check --worktree "$R" 2>&1 | grep -q 'forbidden pattern' \
  && ok "says WHICH forbidden pattern matched" || bad "did not name the pattern"
git checkout -q -- src/document/Doc.cpp

print "== the manifest survives a git add -A (it is excluded, not content) =="
print stray > stray.txt && git add -A && git commit -qm "an agent's routine add -A"
git ls-files --error-unmatch .forge-manifest.json >/dev/null 2>&1 \
  && bad "add -A swept the manifest into the commit" \
  || ok "add -A did NOT commit the manifest"
git reset -q --hard "$BASE" && rm -f stray.txt
[[ -f "$R/.forge-manifest.json" ]] && ok "manifest survives reset --hard to base" \
                                   || bad "reset --hard destroyed the manifest"

print "== RED: a COMMITTED violation, not just a dirty file =="
print edit >> src/document/Doc.cpp && git add src/document/Doc.cpp && git commit -qm "sneak it in"
expect 1 "committed violation FAILS too" "$BIN" check --worktree "$R"
git reset -q --hard "$BASE"

print "== RED: a rename OUT of the write_set =="
git mv src/geometry/Extrude.cpp tests/Extrude.cpp
expect 1 "rename to a new home FAILS" "$BIN" check --worktree "$R"
git reset -q --hard "$BASE"

print "== GREEN again after the violations are reverted =="
print edit >> src/geometry/Extrude.cpp
expect 0 "green returns" "$BIN" check --worktree "$R"
git checkout -q -- src/geometry/Extrude.cpp

print "== the gate refuses to pass when there is nothing to check against =="
mv "$R/.forge-manifest.json" "$WORK/held.json"
expect 2 "missing manifest is an ERROR, never a pass" "$BIN" check --worktree "$R"
mv "$WORK/held.json" "$R/.forge-manifest.json"

print "== a manifest that cannot be obeyed is refused at write time =="
expect 2 "path in BOTH sets is refused" "$BIN" write --worktree "$R" <<'Y'
task_id: FG-9
resource: peak_ram_gb_estimate=2, build_class=incremental, max_threads=2
write_set:
  - src/a.cpp
forbidden_write_set:
  - src/a.cpp
acceptance:
  - "x"
Y
expect 2 "missing required key is refused" "$BIN" write --worktree "$R" <<'Y'
task_id: FG-9
resource: peak_ram_gb_estimate=2, build_class=incremental, max_threads=2
objective: "no write_set, no acceptance"
Y

print "== doc 07 step 5: write-set overlap between two live manifests =="
A=$WORK/a; B=$WORK/b; mkdir -p "$A" "$B"
git -C "$R" worktree add -q "$A" -b wa "$BASE" 2>/dev/null || cp -R "$R"/.git "$A/.git" 2>/dev/null
git -C "$R" worktree add -q "$B" -b wb "$BASE" 2>/dev/null || cp -R "$R"/.git "$B/.git" 2>/dev/null
"$BIN" write --worktree "$A" >/dev/null <<'Y'
task_id: FG-1
resource: peak_ram_gb_estimate=2, build_class=incremental, max_threads=2
write_set:
  - src/geometry/Extrude.cpp
acceptance:
  - "x"
Y
"$BIN" write --worktree "$B" >/dev/null <<'Y'
task_id: FG-2
resource: peak_ram_gb_estimate=2, build_class=incremental, max_threads=2
write_set:
  - src/document/Doc.cpp
acceptance:
  - "x"
Y
expect 0 "disjoint manifests may run in parallel" "$BIN" overlap "$A" "$B"
"$BIN" write --worktree "$B" >/dev/null <<'Y'
task_id: FG-2
resource: peak_ram_gb_estimate=2, build_class=incremental, max_threads=2
write_set:
  - src/geometry/Extrude.cpp
acceptance:
  - "x"
Y
expect 1 "COLLIDING manifests are refused" "$BIN" overlap "$A" "$B"
"$BIN" overlap "$A" "$B" 2>&1 | grep -q 'Extrude.cpp' \
  && ok "names the contended file" || bad "did not name the contended file"
# a glob on one side must still catch a literal on the other
"$BIN" write --worktree "$B" >/dev/null <<'Y'
task_id: FG-2
resource: peak_ram_gb_estimate=2, build_class=incremental, max_threads=2
write_set:
  - src/geometry/*
acceptance:
  - "x"
Y
expect 1 "a GLOB that swallows the other task's file is refused" "$BIN" overlap "$A" "$B"
git -C "$R" worktree remove --force "$A" 2>/dev/null
git -C "$R" worktree remove --force "$B" 2>/dev/null

print ""
print "[manifest-gate] $PASS passed, $FAIL failed"
(( FAIL == 0 )) || exit 1
print "[manifest-gate] ALL CHECKS PASS -- the gate was shown RED in 7 distinct ways"
