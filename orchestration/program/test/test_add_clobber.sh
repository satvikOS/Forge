#!/bin/bash
# test_add_clobber.sh — re-using a task id must not destroy the task.
#
# On 2026-09-10 an agent ran `forge-program add T-036 ...` for new work without
# checking the highest id in use. T-036 and T-037 both existed and were DONE. `add`
# updated them in place, replacing title, layer, repo, write_set, acceptance and
# evidence, and printed "added". Nothing said anything was lost. They were
# recoverable only because the ledger separately records `done` events carrying
# their evidence -- the `add` events held only the title, so layer, repo, write_set
# and acceptance were gone for good.
#
# Two fixes, both asserted here:
#   1. an existing id is REFUSED unless --force
#   2. the ledger's add event carries the WHOLE record and what it replaced, so even
#      a forced replacement stays recoverable
set -u
cd "$(dirname "$0")/.."
BIN="$PWD/bin/forge-program"
PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); printf '  ok   %s\n' "$1"; }
bad() { FAIL=$((FAIL+1)); printf '  FAIL %s\n' "$1"; }

# A THROWAWAY STORE. This must never touch ~/.forge-program: a test that writes to
# the real ledger would be a second way to lose the thing this test protects.
export FORGE_PROGRAM_DIR="$(mktemp -d /tmp/forge_prog_test.XXXXXX)"
trap 'rm -rf "$FORGE_PROGRAM_DIR"' EXIT
if [ "$FORGE_PROGRAM_DIR" != "$HOME/.forge-program" ]; then
  ok "running against a throwaway store, not ~/.forge-program"
else
  bad "refusing to run against the real store"; exit 2
fi

"$BIN" add T-001 --title "the original" --layer L1 --repo somerepo \
       --write-set "a.py,b.py" --acceptance "first;second" >/dev/null
"$BIN" done T-001 --evidence "the original evidence" >/dev/null

# --- 1. a second add on the same id is refused ---------------------------------
OUT="$("$BIN" add T-001 --title "the clobber" 2>&1)"; RC=$?
if [ "$RC" -ne 0 ]; then ok "re-using an existing id exits non-zero (got $RC)"
else bad "re-using an existing id exited 0 — it was accepted"; fi
case "$OUT" in
  *"already exists"*) ok "the refusal says the id already exists" ;;
  *) bad "the refusal does not mention that the id exists: $OUT" ;;
esac
case "$OUT" in
  *"the original"*) ok "the refusal quotes the title it would have destroyed" ;;
  *) bad "the refusal does not show what would be lost" ;;
esac

# --- 2. and nothing was actually changed ---------------------------------------
T="$(python3 -c "
import json, os
d = json.load(open(os.path.join(os.environ['FORGE_PROGRAM_DIR'], 'tasks.json')))['tasks']['T-001']
print(d['title'], '|', d['state'], '|', d['evidence'], '|', ','.join(d['write_set']))")"
case "$T" in
  "the original | DONE | the original evidence | a.py,b.py")
      ok "the refused add left title, state, evidence and write_set untouched" ;;
  *)  bad "the record changed despite the refusal: $T" ;;
esac

# --- 3. --force works, and the ledger can rebuild what it replaced -------------
if "$BIN" add T-001 --force --title "the replacement" >/dev/null 2>&1; then
  ok "--force is accepted"
else bad "--force was refused"; fi
REC="$(python3 -c "
import json, os
ev = [json.loads(l) for l in open(os.path.join(os.environ['FORGE_PROGRAM_DIR'], 'ledger.jsonl'))]
adds = [e for e in ev if e.get('event') == 'add' and e.get('id') == 'T-001']
p = adds[-1].get('replaced') or {}
# Everything the clobber destroyed must be reconstructible from this one event.
print(p.get('title'), '|', p.get('state'), '|', p.get('evidence'), '|',
      ','.join(p.get('write_set') or []), '|', ','.join(p.get('acceptance') or []))")"
case "$REC" in
  "the original | DONE | the original evidence | a.py,b.py | first,second")
      ok "the ledger's add event carries the full replaced record" ;;
  *)  bad "the ledger cannot rebuild the replaced record: $REC" ;;
esac

# --- 4. a genuinely new id still works -----------------------------------------
if "$BIN" add T-002 --title "brand new" >/dev/null 2>&1; then
  ok "a new id is still accepted"
else bad "a new id was refused"; fi

echo
echo "[add-clobber] $((PASS+FAIL)) checks, $FAIL failures"
[ "$FAIL" -eq 0 ] || exit 1
