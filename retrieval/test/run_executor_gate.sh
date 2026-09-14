#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# run_executor_gate.sh — the gate on forge_retrieve, the retrieval EXECUTOR.
#
# retrieval/run_retrieval_tests.sh proves the CLIENT. This proves the BINARY
# Archie actually invokes: that its send path is the client's gated one, that it
# refuses to approve itself, that the operator's secrets do not appear in its
# output, and that every way the sidecar can be absent or wrong comes back
# RETRIEVAL_UNAVAILABLE with nothing transmitted.
#
# It drives the REAL executable through a real loopback socket. Nothing leaves
# the machine: LoopbackHttpTransport refuses a non-loopback literal by
# construction, and every stub binds 127.0.0.1 on an ephemeral port.
#
#   --mutations   after the clean run, inject four defects into a COPY of
#                 retrieval/tools/forge_retrieve.cpp and require that each one
#                 turns a NAMED check RED. A gate nobody has seen fail is
#                 silence. The mutations never touch the checkout.
#
# Exit 0 iff every check passes (and, with --mutations, every mutation was
# caught). Override the compiler with CXX=clang++.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
cd "$ROOT" || exit 1

CXX="${CXX:-clang++}"
FLAGS="-std=c++20 -O2 -Wall -Wextra -Werror"
INC="-Iretrieval/include"
SRCS="retrieval/src/Json.cpp retrieval/src/Redactor.cpp retrieval/src/SearchRequest.cpp
      retrieval/src/EvidenceRecord.cpp retrieval/src/HttpTransport.cpp retrieval/src/SearxngClient.cpp"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/forge_executor_gate.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT

PASS=0
FAIL=0
MUTATING=0          # when 1, a failure is the EXPECTED outcome and is reported, not counted
LAST_FAILED_CHECKS=""

ok()   { PASS=$((PASS+1)); echo "  ok   $1"; }
bad()  { FAIL=$((FAIL+1)); LAST_FAILED_CHECKS="$LAST_FAILED_CHECKS|$1"; echo "  FAIL $1"; }
check(){ if [ "$1" = "1" ]; then ok "$2"; else bad "$2"; fi; }
section(){ echo; echo "== $1 =="; }

# ── build ───────────────────────────────────────────────────────────────────
# $1 = the forge_retrieve.cpp to compile, $2 = where to put the binary.
build_executor() {
  # shellcheck disable=SC2086
  "$CXX" $FLAGS $INC "$1" $SRCS -o "$2"
  return $?
}

# ── one executor invocation ─────────────────────────────────────────────────
# Sets RC / OUT_JSON. The exit status comes from the PROCESS, captured on its own
# line before any pipeline can overwrite it.
BIN=""
run_exec() {
  local mode="$1" payload="$2"
  printf '%s' "$payload" > "$WORK/in.json"
  "$BIN" "$mode" < "$WORK/in.json" > "$WORK/out.json" 2> "$WORK/err.txt"
  RC=$?
  OUT_JSON="$(cat "$WORK/out.json")"
  return 0
}

# Reads one field out of the last result with python3 (never a grep on JSON).
# The reader is written ONCE to a file rather than fed on stdin: `python3 - ARG
# <<'PY' < file` silently makes the REDIRECTED FILE the script, so every call
# parsed the JSON as Python and reported "<unparseable>" for everything. That
# looked like a failing executor and was a failing instrument.
cat > "$WORK/jfield.py" <<'PY'
import json, sys
try:
    d = json.load(open(sys.argv[2]))
except Exception:
    print("<unparseable>"); raise SystemExit(0)
cur = d
for part in sys.argv[1].split('.'):
    if isinstance(cur, list):
        cur = cur[int(part)] if part.isdigit() and int(part) < len(cur) else None
    elif isinstance(cur, dict):
        cur = cur.get(part)
    else:
        cur = None
    if cur is None:
        break
if cur is None:
    print("<missing>")
elif isinstance(cur, bool):
    print("true" if cur else "false")
elif isinstance(cur, list):
    print("[]" if not cur else "[%d items]" % len(cur))
else:
    print(cur)
PY

jfield() { python3 "$WORK/jfield.py" "$1" "$WORK/out.json"; }

# ── request builders ────────────────────────────────────────────────────────
# One question, carrying a registered customer, a registered part number and a
# registered secret dimension, so every check below has something to leak.
SECRET_Q='tensile strength of 6061-T6 aluminium per ASTM B209 for the Northwind bracket at 47.625 mm web thickness'

request_json() {           # $1 host, $2 port, $3 question, $4 privacy_class
  python3 - "$1" "$2" "$3" "$4" <<'PY'
import json, sys
host, port, question, privacy = sys.argv[1], int(sys.argv[2]), sys.argv[3], sys.argv[4]
print(json.dumps({
  "engineering_question": question,
  "retrieval_rationale": "the local reference index has no allowable for this temper",
  "esg_assertion_id": "ESG-4471-tensile",
  "expected_fact_types": ["material_property", "numeric_limit"],
  "expected_units": ["MPa"],
  "standard_edition": "ASTM B209",
  "language": "en",
  "privacy_class": privacy,
  "max_results": 8,
  "min_distinct_publishers": 2,
  "lexicon": {"customer_names": ["Northwind"], "part_numbers": ["ACME-4471"],
              "secret_dimensions": [47.625]},
  "endpoint": {"host": host, "port": port, "path": "/search", "use_post": True},
}))
PY
}

approved_json() {          # $1 request json, $2 encoded_body, $3 digest
  python3 -c '
import json,sys
req=json.loads(sys.argv[1]); body=sys.argv[2]; dig=sys.argv[3]
print(json.dumps({"request":req,"approval":{"encoded_body":body,"body_digest":dig}}))
' "$1" "$2" "$3"
}

# ═════════════════════════════════════════════════════════════════════════════
run_all_checks() {
  PASS=0; FAIL=0; LAST_FAILED_CHECKS=""

  # ── A. preview opens no socket and leaks no secret ───────────────────────
  section "A. preview: redacts, digests, and never echoes the secret"
  local REQ; REQ="$(request_json 127.0.0.1 8888 "$SECRET_Q" same_mac_searxng)"
  run_exec preview "$REQ"
  check "$([ "$RC" -eq 0 ] && echo 1 || echo 0)" "A1 preview exits 0 (rc=$RC)"
  check "$([ "$(jfield sendable)" = "true" ] && echo 1 || echo 0)" "A2 preview is sendable"
  local BODY DIGEST; BODY="$(jfield encoded_body)"; DIGEST="$(jfield body_digest)"
  check "$([ -n "$BODY" ] && echo 1 || echo 0)" "A3 preview carries encoded bytes"

  # THE CHECK THAT MATTERS MOST HERE. stdout is consumed by Archie, logged, and
  # may be shown back to a model. RedactionEvent::matched must not be in it.
  local LEAK=0
  for secret in Northwind northwind 47.625 47625 ACME-4471; do
    if grep -qi -- "$secret" "$WORK/out.json"; then LEAK=1; echo "      leaked: $secret"; fi
  done
  check "$([ "$LEAK" -eq 0 ] && echo 1 || echo 0)" "A4 NO registered secret appears anywhere in the preview JSON"
  check "$(grep -q 'RegisteredCustomer' "$WORK/out.json" && echo 1 || echo 0)" \
        "A5 the removal is still REPORTED by kind, so the operator sees what went"
  check "$(grep -q 'DimensionLiteral' "$WORK/out.json" && echo 1 || echo 0)" \
        "A6 and the secret dimension is reported as removed too"

  # ── B. the executor will not approve its own request ─────────────────────
  section "B. approval must come from outside this process"
  run_exec search "$(python3 -c '
import json,sys; print(json.dumps({"request":json.loads(sys.argv[1])}))' "$REQ")"
  check "$([ "$RC" -eq 5 ] && echo 1 || echo 0)" "B1 search with NO approval exits 5 REQUEST_REJECTED (rc=$RC)"
  check "$([ "$(jfield transmit_attempts)" = "0" ] && echo 1 || echo 0)" "B2 and nothing was transmitted"

  local GOOD; GOOD="$(approved_json "$REQ" "$BODY" "$DIGEST")"

  run_exec search "$(python3 -c '
import json,sys
d=json.loads(sys.argv[1]); d["approval"]["body_digest"]="0xdeadbeefdeadbeef"; print(json.dumps(d))' "$GOOD")"
  check "$([ "$RC" -eq 5 ] && echo 1 || echo 0)" "B3 a TAMPERED digest exits 5 (rc=$RC)"
  check "$([ "$(jfield transmit_attempts)" = "0" ] && echo 1 || echo 0)" "B4 and nothing was transmitted"

  run_exec search "$(python3 -c '
import json,sys
d=json.loads(sys.argv[1]); d["approval"]["body_digest"]="not-a-hex-value"; print(json.dumps(d))' "$GOOD")"
  check "$([ "$RC" -eq 5 ] && echo 1 || echo 0)" "B5 a MALFORMED digest exits 5 rather than decaying to zero (rc=$RC)"

  # The cross-process time-of-check/time-of-use attack: approve one question,
  # submit another with the approved token.
  run_exec search "$(python3 -c '
import json,sys
d=json.loads(sys.argv[1])
d["request"]["engineering_question"]="fatigue limit of 7075-T7351 per AMS 4045"
print(json.dumps(d))' "$GOOD")"
  check "$([ "$RC" -eq 5 ] && echo 1 || echo 0)" "B6 a question EDITED AFTER approval exits 5 (rc=$RC)"
  check "$([ "$(jfield transmit_attempts)" = "0" ] && echo 1 || echo 0)" "B7 and nothing was transmitted"

  # B8 EXISTS BECAUSE A MUTATION WENT UNCAUGHT. Removing the encoded_body
  # comparison passed every check above, because an edited question also changes
  # the digest, so the digest check was doing all the work and the body check was
  # dead redundancy. This is the case only the body comparison catches: an
  # approval whose DIGEST matches the query about to be sent, but whose
  # encoded_body records a DIFFERENT query. The bytes sent would be correct and
  # the approval record would be a lie — which is worse than a rejection, because
  # it is an audit trail that disagrees with what happened.
  local STALE_REQ; STALE_REQ="$(python3 -c '
import json,sys
d=json.loads(sys.argv[1]); d["engineering_question"]="yield strength of 7075-T6 per AMS 4045"
print(json.dumps(d))' "$REQ")"
  run_exec preview "$STALE_REQ"
  local STALE_BODY; STALE_BODY="$(jfield encoded_body)"
  run_exec search "$(python3 -c '
import json,sys
d=json.loads(sys.argv[1]); d["approval"]["encoded_body"]=sys.argv[2]; print(json.dumps(d))' "$GOOD" "$STALE_BODY")"
  check "$([ "$RC" -eq 5 ] && echo 1 || echo 0)" \
        "B8 an approval recording DIFFERENT bytes than it digests exits 5 (rc=$RC)"
  check "$([ "$(jfield transmit_attempts)" = "0" ] && echo 1 || echo 0)" "B9 and nothing was transmitted"

  # B10-B12 ARE THE REALISTIC ARCHIE BUG, not an attack: the private lexicon
  # travels ON the request, so a loop that carries it into preview() and forgets
  # it on search() would re-derive a LESS REDACTED query. The digest is taken over
  # the encoded body, so it binds the REDACTION POLICY and not merely the question
  # text — but that is a consequence worth pinning rather than reasoning about,
  # and it needs a secret the default-deny posture cannot see on its own.
  #
  # A capitalised name or a numeric literal is the wrong probe here: the redactor
  # strips both with no lexicon at all, the two previews come out byte-identical,
  # and the check would pass while testing nothing. A LOWERCASE, NON-NUMERIC
  # project code name is the case only the lexicon catches.
  local LEXQ='bend radius for 6061-T6 sheet used on the falcon programme'
  local REQ_LEX; REQ_LEX="$(python3 -c '
import json,sys
d=json.loads(sys.argv[1]); d["engineering_question"]=sys.argv[2]
d["lexicon"]={"project_names":["falcon"]}
print(json.dumps(d))' "$REQ" "$LEXQ")"
  local REQ_NOLEX; REQ_NOLEX="$(python3 -c '
import json,sys
d=json.loads(sys.argv[1]); d.pop("lexicon", None); print(json.dumps(d))' "$REQ_LEX")"

  run_exec preview "$REQ_LEX";   local Q_LEX; Q_LEX="$(jfield redacted_query)"
  local B_LEX D_LEX; B_LEX="$(jfield encoded_body)"; D_LEX="$(jfield body_digest)"
  run_exec preview "$REQ_NOLEX"; local Q_NOLEX; Q_NOLEX="$(jfield redacted_query)"
  case "$Q_LEX" in *falcon*) local lex_hit=1;; *) local lex_hit=0;; esac
  case "$Q_NOLEX" in *falcon*) local nolex_hit=1;; *) local nolex_hit=0;; esac
  check "$([ "$lex_hit" -eq 0 ] && [ "$nolex_hit" -eq 1 ] && echo 1 || echo 0)" \
        "B10 the probe is valid: 'falcon' is removed WITH the lexicon and survives WITHOUT it"

  run_exec search "$(approved_json "$REQ_NOLEX" "$B_LEX" "$D_LEX")"
  check "$([ "$RC" -eq 5 ] && echo 1 || echo 0)" \
        "B11 approving the REDACTED query then searching with the lexicon DROPPED exits 5 (rc=$RC)"
  check "$([ "$(jfield transmit_attempts)" = "0" ] && echo 1 || echo 0)" \
        "B12 and nothing was transmitted — the digest binds the redaction policy, not just the text"

  # ── C. the sidecar is DOWN ───────────────────────────────────────────────
  # Nothing is listening on this port, which is byte-for-byte the code path a
  # stopped SearXNG produces: connectLoopback -> ECONNREFUSED -> ConnectFailed
  # -> RETRIEVAL_UNAVAILABLE. Proving fail-closed does not require stopping a
  # service other agents may be using.
  section "C. SIDECAR DOWN — the fail-closed path"
  local DEAD_PORT=9
  local REQD; REQD="$(request_json 127.0.0.1 "$DEAD_PORT" "$SECRET_Q" same_mac_searxng)"
  run_exec preview "$REQD"
  local BODYD DIGD; BODYD="$(jfield encoded_body)"; DIGD="$(jfield body_digest)"
  run_exec search "$(approved_json "$REQD" "$BODYD" "$DIGD")"
  check "$([ "$RC" -eq 3 ] && echo 1 || echo 0)" "C1 a sidecar that is not listening exits 3 RETRIEVAL_UNAVAILABLE (rc=$RC)"
  check "$([ "$(jfield status)" = "RETRIEVAL_UNAVAILABLE" ] && echo 1 || echo 0)" "C2 the status says so"
  check "$([ "$(jfield ok)" = "false" ] && echo 1 || echo 0)" "C3 ok is false"
  local TA; TA="$(jfield transmit_attempts)"
  check "$([ "$TA" -le 1 ] && echo 1 || echo 0)" "C4 transmit_attempts is $TA (<=1: no retry, no second transport)"
  check "$([ "$(jfield evidence)" = "[]" ] && echo 1 || echo 0)" "C5 zero evidence — a refusal is not an empty success"

  # ── D. a destination that is not the sidecar ─────────────────────────────
  section "D. policy refusals decided before a socket exists"
  local REQX; REQX="$(request_json 93.184.216.34 80 "$SECRET_Q" same_mac_searxng)"
  run_exec preview "$REQX"
  local BX DX; BX="$(jfield encoded_body)"; DX="$(jfield body_digest)"
  run_exec search "$(approved_json "$REQX" "$BX" "$DX")"
  check "$([ "$RC" -eq 3 ] && echo 1 || echo 0)" "D1 a NON-LOOPBACK host is refused (rc=$RC)"
  check "$(echo "$OUT_JSON" | grep -q 'RefusedNonLoopback' && echo 1 || echo 0)" \
        "D2 and the refusal names RefusedNonLoopback, not a network error"

  local REQL; REQL="$(request_json 127.0.0.1 8888 "$SECRET_Q" local_index_only)"
  run_exec search "$(python3 -c '
import json,sys; print(json.dumps({"request":json.loads(sys.argv[1]),
  "approval":{"encoded_body":"x","body_digest":"0x1"}}))' "$REQL")"
  check "$([ "$RC" -eq 6 ] && echo 1 || echo 0)" "D3 privacy_class local_index_only exits 6 POLICY_LOCAL_ONLY (rc=$RC)"

  # A question that is entirely proprietary has nothing left to send.
  #
  # THE FIRST RUN OF THIS CHECK FAILED, AND THE CODE WAS RIGHT. `standard_edition`
  # is appended to the query as an operator-authored scope term, so a question
  # that is 100% proprietary still yields a SENDABLE query — made entirely of the
  # scope term, with nothing of the question in it. Nothing private leaves, so it
  # is not a leak; but it is worth pinning in both directions, because a query
  # that bears no relation to the question asked is a thing the operator should
  # recognise in the preview rather than discover later.
  local REQP; REQP="$(request_json 127.0.0.1 8888 'Northwind ACME-4471 47.625' same_mac_searxng)"
  run_exec preview "$REQP"
  local QSENT; QSENT="$(jfield redacted_query)"
  check "$([ "$(jfield sendable)" = "true" ] && echo 1 || echo 0)" \
        "D4 a wholly-proprietary question survives ONLY as its operator-authored scope ('$QSENT')"
  local PLEAK=0
  for secret in Northwind northwind 47.625 47625 ACME-4471; do
    case "$QSENT" in *"$secret"*) PLEAK=1;; esac
  done
  check "$([ "$PLEAK" -eq 0 ] && echo 1 || echo 0)" \
        "D5 and not one byte of the question itself is in the query that would be sent"

  # With the scope term removed there is genuinely nothing left, and the preview
  # must refuse rather than send an empty q=.
  local REQP2; REQP2="$(python3 -c '
import json,sys
d=json.loads(sys.argv[1]); d["standard_edition"]=""; print(json.dumps(d))' "$REQP")"
  run_exec preview "$REQP2"
  check "$([ "$RC" -ne 0 ] && echo 1 || echo 0)" \
        "D6 with no scope term left, a wholly-proprietary question is REFUSED (rc=$RC)"
  check "$([ "$(jfield sendable)" = "false" ] && echo 1 || echo 0)" "D7 and says so"
  check "$(grep -q 'nothing survived redaction' "$WORK/out.json" && echo 1 || echo 0)" \
        "D8 naming the reason: nothing survived redaction"

  # ── E. a real socket to a stub that answers wrongly ──────────────────────
  section "E. the sidecar is UP but the answer is not usable"
  stub_case() {   # $1 mode, $2 expected rc, $3 label
    local port
    python3 "$HERE/executor_stub_sidecar.py" "$1" 1 > "$WORK/stub.out" 2> "$WORK/stub.err" &
    local stub_pid=$!
    for _ in $(seq 1 100); do
      port="$(head -1 "$WORK/stub.out" 2>/dev/null)"
      [ -n "$port" ] && break
      perl -e 'select(undef,undef,undef,0.05)'
    done
    if [ -z "$port" ]; then bad "$3 (stub never printed a port)"; kill "$stub_pid" 2>/dev/null; return; fi
    local r b d
    r="$(request_json 127.0.0.1 "$port" "$SECRET_Q" same_mac_searxng)"
    run_exec preview "$r"; b="$(jfield encoded_body)"; d="$(jfield body_digest)"
    run_exec search "$(approved_json "$r" "$b" "$d")"
    wait "$stub_pid" 2>/dev/null
    check "$([ "$RC" -eq "$2" ] && echo 1 || echo 0)" "$3 (rc=$RC, want $2)"
    STUB_ERR="$WORK/stub.err"
  }

  stub_case http500  3 "E1 HTTP 500 -> RETRIEVAL_UNAVAILABLE"
  stub_case html     3 "E2 an HTML page (format=json disabled) -> RETRIEVAL_UNAVAILABLE"
  stub_case truncated 3 "E3 a truncated body -> RETRIEVAL_UNAVAILABLE"
  stub_case notarray 3 "E4 results-is-not-an-array -> RETRIEVAL_UNAVAILABLE"
  stub_case one_publisher 7 "E5 one publisher -> INSUFFICIENT_DIVERSITY"

  # ── F. a real socket to a stub that answers correctly ────────────────────
  section "F. the happy path, and the far-end assertion"
  stub_case json 0 "F1 a well-formed body -> exit 0"
  check "$([ "$(jfield ok)" = "true" ] && echo 1 || echo 0)" "F2 ok is true"
  check "$([ "$(jfield transmit_attempts)" = "1" ] && echo 1 || echo 0)" "F3 exactly one transmit attempt"
  check "$([ "$(jfield distinct_publishers)" = "2" ] && echo 1 || echo 0)" "F4 two distinct publishers"
  # publisherFromUrl strips a leading "www.", so the host is iso.org and not
  # www.iso.org. The first run of this check asserted the wrong string and the
  # code was right.
  check "$([ "$(jfield evidence.0.publisher)" = "iso.org" ] && echo 1 || echo 0)" \
        "F5 the publisher is derived from the URL host ('$(jfield evidence.0.publisher)'), not from page text"
  check "$([ "$(jfield evidence.0.source_type)" = "LawOrRegulator" ] && echo 1 || echo 0)" \
        "F6 and iso.org is ranked as a standards body, from the host alone"

  # THE FAR END. This is the only assertion made on the bytes the SERVER
  # received rather than the ones the client believes it sent.
  local FARLEAK=0
  for secret in Northwind northwind 47.625 47625 ACME-4471; do
    if grep -qi -- "$secret" "$STUB_ERR"; then FARLEAK=1; echo "      arrived at the stub: $secret"; fi
  done
  check "$([ "$FARLEAK" -eq 0 ] && echo 1 || echo 0)" \
        "F7 FAR END: no registered secret arrived at the server"
  check "$(grep -q 'REQUEST-BODY: q=' "$STUB_ERR" && echo 1 || echo 0)" \
        "F8 FAR END: a q= body really did arrive (the check above is not vacuous)"

  # ── G. injection in the retrieved text ───────────────────────────────────
  section "G. an instruction-shaped result is recorded, not obeyed and not hidden"
  stub_case injection 0 "G1 a hostile body still parses to exit 0"
  # The hostile record is NOT at index 0: it is a community-tier forum post and
  # ranking demoted it below the datasheet. The first run of this check looked at
  # index 0 and reported a missing flag that was present one row down. Find the
  # record by its flag, not by its position — and pin the demotion too, since
  # that ordering is the property doing the work.
  check "$(python3 -c '
import json,sys
d=json.load(open(sys.argv[1]))
print(1 if any(e["injection_attempt_flagged"] for e in d["evidence"]) else 0)' "$WORK/out.json")" \
        "G2 injection_attempt_flagged is set on the hostile record"
  check "$(python3 -c '
import json,sys
d=json.load(open(sys.argv[1]))
ev=d["evidence"]
hostile=[i for i,e in enumerate(ev) if e["injection_attempt_flagged"]]
print(1 if hostile and hostile[0] > 0 and ev[hostile[0]]["source_type"]=="CommunityDiscussion" else 0)' "$WORK/out.json")" \
        "G3 and it was DEMOTED below the datasheet as a community-tier source"
  check "$(grep -q 'MUTATE_GEOMETRY' "$WORK/out.json" && echo 1 || echo 0)" \
        "G4 the record is RETAINED, not silently dropped — a reviewer must see the attempt"
  check "$(python3 -c '
import json,sys
d=json.load(open(sys.argv[1]))
spans="".join(e["quoted_span"]+e["title"] for e in d["evidence"])
print(1 if ("\x1b" not in spans and "\r" not in spans and "\n" not in spans) else 0)' "$WORK/out.json")" \
        "G5 control characters and ANSI escapes are neutralized by display() in EVERY span"
  check "$(python3 -c '
import json,sys
d=json.load(open(sys.argv[1]))
print(1 if all(e["may_be_sole_authority"] is False for e in d["evidence"] if e["source_type"]=="CommunityDiscussion") else 0)' "$WORK/out.json")" \
        "G6 a community-tier source is marked as never a sole authority for a critical value"
}

# ═════════════════════════════════════════════════════════════════════════════
echo "[executor] compiler: $($CXX --version | head -1)"
if ! build_executor retrieval/tools/forge_retrieve.cpp "$WORK/forge_retrieve"; then
  echo "[executor] COMPILE FAILED"
  exit 1
fi
echo "[executor] built $WORK/forge_retrieve"
BIN="$WORK/forge_retrieve"

# ── 0. source-shape checks, made on CODE and not on prose ───────────────────
# These counts were wrong the first time this gate ran, in the direction that
# matters: they counted the file's own COMMENTS. "SendApproval::grant appears
# exactly once" was 2 because a comment names it, and "no retry" was 4 because
# four comments say there is no retry. A check that a comment can fail is not
# measuring the code, so comments are stripped first. `grep -c` prints 0 and
# EXITS 1, so every count is taken with the || form that keeps ITS zero.
section "0. the executor has ONE send path"
sed -e 's://.*::' retrieval/tools/forge_retrieve.cpp \
  | sed -e '/^[[:space:]]*\*/d' -e '/^[[:space:]]*\/\*/d' > "$WORK/code_only.cpp"
CODE_LINES=$(grep -c . "$WORK/code_only.cpp" || true)
check "$([ "${CODE_LINES:-0}" -gt 200 ] && echo 1 || echo 0)" \
      "0.0 the comment stripper left real code behind ($CODE_LINES lines) — the counts below are not vacuous"

GRANTS=$(grep -c 'SendApproval::grant' "$WORK/code_only.cpp" || true)
check "$([ "${GRANTS:-0}" -eq 1 ] && echo 1 || echo 0)" \
      "0.1 SendApproval::grant is called from exactly ONE line of code (${GRANTS:-0})"
# The executor must not contain a socket of its own: it reaches the network only
# through the client's single transport.
SOCKETS=$(grep -cE '<sys/socket\.h>|::socket\(|[^a-zA-Z_]connect\(|getaddrinfo' "$WORK/code_only.cpp" || true)
check "$([ "${SOCKETS:-0}" -eq 0 ] && echo 1 || echo 0)" \
      "0.2 the executor contains no socket call of its own (${SOCKETS:-0})"
# `fallback` on its own is not a networking concept here — it is the name of a
# default-value parameter — so the pattern is anchored to the word "retry" and to
# a second transport. macOS grep has no \b, hence the explicit character classes.
RETRIES=$(grep -ciE '(^|[^a-z])retry([^a-z]|$)|second transport' "$WORK/code_only.cpp" || true)
check "$([ "${RETRIES:-0}" -eq 0 ] && echo 1 || echo 0)" \
      "0.3 no retry in the code (${RETRIES:-0})"
TRANSPORTS=$(grep -c 'make_shared<LoopbackHttpTransport>' "$WORK/code_only.cpp" || true)
check "$([ "${TRANSPORTS:-0}" -eq 1 ] && echo 1 || echo 0)" \
      "0.4 exactly one transport is ever constructed (${TRANSPORTS:-0})"
SEARCHES=$(grep -c 'client\.search(' "$WORK/code_only.cpp" || true)
check "$([ "${SEARCHES:-0}" -eq 1 ] && echo 1 || echo 0)" \
      "0.5 client.search is called from exactly ONE line — one send per invocation (${SEARCHES:-0})"

run_all_checks
CLEAN_PASS=$PASS
CLEAN_FAIL=$FAIL

echo
echo "[executor] $CLEAN_PASS passed, $CLEAN_FAIL failed"
if [ "$CLEAN_FAIL" -ne 0 ]; then
  echo "[executor] GATE FAILED"
  exit 1
fi

# ── mutations: prove each gate can go RED ───────────────────────────────────
if [ "${1:-}" != "--mutations" ]; then
  echo "[executor] GATE PASSED (run with --mutations to prove each check can fail)"
  exit 0
fi

echo
echo "════════════════════════════════════════════════════════════════════════"
echo "[executor] MUTATIONS — a gate nobody has seen fail is silence."
echo "[executor] Each defect is injected into a COPY; the checkout is untouched."
echo "════════════════════════════════════════════════════════════════════════"

MUT_DIR="$WORK/mutants"
mkdir -p "$MUT_DIR"
MUT_TOTAL=0
MUT_CAUGHT=0

# $1 label, $2 sed program (one command per line, delimiter %), $3 substring of
# the check name that MUST go red.
# The program goes through `sed -f` and a FILE rather than being passed inline:
# a multi-command program with embedded `|` cannot survive as one argument, and
# `|` is also the delimiter this file's other patterns use.
mutate() {
  MUT_TOTAL=$((MUT_TOTAL+1))
  local label="$1" prog="$2" want="$3"
  local src="$MUT_DIR/m$MUT_TOTAL.cpp"
  printf '%s\n' "$prog" > "$MUT_DIR/m$MUT_TOTAL.sed"
  sed -f "$MUT_DIR/m$MUT_TOTAL.sed" retrieval/tools/forge_retrieve.cpp > "$src"
  if cmp -s "$src" retrieval/tools/forge_retrieve.cpp; then
    echo "  MUTATION $MUT_TOTAL ($label): the sed changed NOTHING — the mutation itself is broken."
    return
  fi
  if ! build_executor "$src" "$MUT_DIR/m$MUT_TOTAL" 2> "$MUT_DIR/m$MUT_TOTAL.build"; then
    echo "  MUTATION $MUT_TOTAL ($label): did not compile — cannot prove the check catches it."
    head -5 "$MUT_DIR/m$MUT_TOTAL.build"
    return
  fi
  BIN="$MUT_DIR/m$MUT_TOTAL"
  echo
  echo "── mutation $MUT_TOTAL: $label"
  run_all_checks > "$MUT_DIR/m$MUT_TOTAL.log" 2>&1
  if [ "$FAIL" -eq 0 ]; then
    echo "  NOT CAUGHT: the mutant passed every check. The gate does not test what it claims."
    return
  fi
  if echo "$LAST_FAILED_CHECKS" | grep -q "$want"; then
    MUT_CAUGHT=$((MUT_CAUGHT+1))
    echo "  CAUGHT by the named check ($FAIL failed, incl. one matching '$want')"
    echo "$LAST_FAILED_CHECKS" | tr '|' '\n' | grep -v '^$' | sed 's/^/      RED: /'
  else
    echo "  caught, but NOT by '$want' — the named check is not the one doing the work:"
    echo "$LAST_FAILED_CHECKS" | tr '|' '\n' | grep -v '^$' | sed 's/^/      RED: /'
  fi
}

# 1. Remove the digest comparison: an approval for different bytes is accepted.
mutate "accept any digest (delete the digest comparison)" \
  's%if (approved_digest != digestBytes(preview.encoded_body)) {%if (false) {%' \
  "B3 a TAMPERED digest"

# 2. Remove the encoded-body comparison. THIS MUTATION WENT UNCAUGHT ON THE FIRST
#    RUN: an edited question also changes the digest, so check 1 was catching it
#    and this comparison was dead redundancy. Check B8 was added for the case only
#    this comparison can catch — a right digest recorded against wrong bytes.
mutate "accept edited bytes (delete the approved-body comparison)" \
  's%if (approved_body != preview.encoded_body) {%if (false) {%' \
  "B8 an approval recording DIFFERENT bytes"

# 3. Self-approve — and this one took three attempts to write, which is itself the
#    finding. Removing the isObject() guard went uncaught (an absent object yields
#    empty strings, and the emptiness guard rejected them). Removing BOTH went
#    uncaught too (parseHex64("") returns false, and rejects). Removing all three
#    would still be caught, because approved_digest stays 0 and cannot equal the
#    digest of a non-empty body. FOUR INDEPENDENT GUARDS STAND BETWEEN A MISSING
#    APPROVAL AND A SEND, and any three of them can be deleted without a byte
#    moving. So the mutation is not a deletion at all: it is the defect a careless
#    implementer would actually introduce — grant the approval and send BEFORE the
#    record is ever looked at.
mutate "self-approve (grant and send before reading the approval record)" \
  's%  const json::Value\& approval_node = root.at("approval");%  { const SendApproval a = SendApproval::grant(preview); const RetrievalResult r = client.search(preview, a); Out oo; writeResult(oo, r); std::cout << oo.s; return exitCodeFor(r.status); }  const json::Value\& approval_node = root.at("approval");%' \
  "B1 search with NO approval"

# 4. Serialize RedactionEvent::matched into the preview JSON — the secret leak.
mutate "leak the secret (emit RedactionEvent::matched)" \
  's%// `matched` is DELIBERATELY ABSENT. See the comment above this function.%o.comma(); o.key("matched"); o.str(e.matched);%' \
  "A4 NO registered secret"

# 5. Turn a fail-closed status into a success.
#    Mutating exitCodeFor's RETRIEVAL_UNAVAILABLE arm does not compile: it leaves
#    kExitUnavailable unused and -Werror -Wunused-const-variable rejects it. That
#    is the build being stricter than the mutation, not the gate being weak — so
#    the defect is injected at the point a careless edit would really put it, the
#    final return.
mutate "fail OPEN on a dead sidecar (return 0 whatever the status says)" \
  's%  return exitCodeFor(result.status);%  return kExitOk;%' \
  "C1 a sidecar that is not listening"

echo
echo "════════════════════════════════════════════════════════════════════════"
echo "[executor] mutations: $MUT_CAUGHT of $MUT_TOTAL caught by their named check"
echo "[executor] clean run: $CLEAN_PASS passed, $CLEAN_FAIL failed"
if [ "$MUT_CAUGHT" -ne "$MUT_TOTAL" ]; then
  echo "[executor] GATE FAILED: a defect this gate is named for went undetected."
  exit 1
fi
echo "[executor] GATE PASSED (green, and every check demonstrated red)"
exit 0
