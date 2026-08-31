# Can Archie tool-call SearXNG? — measured 2026-08-31

**No. It has never worked and has never been tested end to end, for two independent reasons —
and the second one is deliberate.**

## 1. The Archie side has no tool-calling at all

Measured in `/Users/account_clawteam1/archdisc-Models`:

```
grep -rli searxng --include=*.py --include=*.md --include=*.json --include=*.sh .   ->  0 files
grep -n "tool_call\|tools=\|function_call" scripts/archie_loop.py                  ->  0 hits
```

`archie_loop.py`'s `Planner.plan()` builds a prompt, calls `mlx_vlm.generate()`, and returns the
text. There is a planner↔verifier correction loop (`correction_prompt()` at line 455, dispatched
at line 846) but **no tool dispatch of any kind** — no tool schema in the prompt, no parser for a
tool call in the output, no executor, no result-injection path. The model has never been asked to
emit a tool call, so nothing about its ability to do so has been established.

**There is also no sidecar running**: `lsof -nP -iTCP -sTCP:LISTEN` shows nothing on 8888.

## 2. The C++ side is built, gated in CI — and deliberately refuses autonomous callers

`retrieval/src/SearxngClient.cpp` + `retrieval/include/forge/retrieval/SearxngClient.hpp` are real
and complete, with hostile-input fixtures (`searxng_hostile.json`, `searxng_injected.json`,
`searxng_single_publisher.json`). The CI job *"SearXNG client + redaction (incl. network-denied
phase)"* passes — observed green on PR #136 in 30 s.

★**But the send path requires a human operator, and that is the point of it.** From the header:

```
THE SEND PATH IS GATED, NOT ADVISORY. search() cannot be called with a raw question:
    preview  = client.preview(request);      // redacts, serializes, digests
    approval = SendApproval::grant(preview); // operator sees the exact bytes
    result   = client.search(preview, approval);
SendApproval has no public constructor and carries the preview's body digest; search()
re-checks the digest and re-runs the redaction residue scan on the FINAL serialized
request before the socket is written. Three independent gates, none of which a caller
can skip by writing different call-site code.
```

It also fails closed on every error — sidecar down, timeout, non-200, unparseable JSON, residue
detected — with no retry, no second transport, no hosted fallback.

## What this means for the question

"Wire Archie to SearXNG" is **not** a plumbing task. The plumbing (part 1) is a day's work: a tool
schema, an output parser, an executor, a result-injection step in the correction loop. The hard
part is part 2, and it is a **policy decision, not an engineering one**:

> May a generative model grant its own `SendApproval`?

`SendApproval` having no public constructor exists precisely to make the answer "no by default".
Auto-approving would collapse three gates into zero and would sit directly against the standing
constraint on this project: *never send user geometry, drawings, names, secret dimensions, part
numbers, or private text.* An autonomous planner deciding what to search is exactly the actor that
constraint is written about — it holds the part it is reasoning over, and a query like "what is the
standard bore for a 96.85 mm flange on <customer part name>" leaks the thing the redactor exists to
strip.

**Three honest options, in order of preference:**

1. **Operator-in-the-loop.** Archie emits a *proposed* query; the preview (redacted bytes, verbatim)
   is shown; a human grants approval. Preserves every gate. Costs interactivity, which is fine for
   a desktop app and fatal for a headless benchmark run.
2. **A policy-scoped auto-approver** that can only grant approval for queries matching an allow-list
   of shapes (standards lookups, material properties, thread tables) with a hard cap and full
   audit. Weaker than (1), and it must be a written, reviewed decision — not a call-site edit.
3. **Do not connect them.** Nothing currently measured says retrieval is a bottleneck: emissions
   build 80.8% of the time and the dominant failure is self-inconsistency (41.3% `VERIFY` assertion
   failures), which no web search fixes.

**Recommendation: (3) for now, (1) when the desktop CoPilot ships.** Option 2 only with an explicit
written decision, because it is the one that quietly weakens a safety property that was carefully
built.

## 3. ★The model CAN tool-call — measured, and it refutes what I expected

An earlier revision of this report listed "can the model emit a well-formed tool call at all?" as
an open question, and guessed the CAD fine-tune had probably crowded the ability out. **That guess
was wrong.** The probe was run (`retrieval/reports/archie_toolcall_probe.py`) against the deployed
adapter `adapters/archie-30b-axis-named-v7`, expert LoRA confirmed loaded (36 switch keys, 276
LoRA modules), asking for the M12 × 1.75 tapping drill diameter under three prompt styles:

| style | parseable? | emitted |
|---|---|---|
| JSON schema | ✅ | `{"tool":"web_search","arguments":{"query":"M12 x 1.75 tap drill size"}}` |
| XML tag | ✅ | `<tool_call>web_search(query="M12 x 1.75 tapping drill diameter")</tool_call>` |
| minimal (`CALL web_search("…")`) | ❌ | answered from knowledge instead |

**Two of three are exactly right, first try, with no tool-calling fine-tune.** The capability
survived the CAD training intact.

★**And the third is not really a failure.** Given only a loose instruction, the model chose to
answer directly — *and its answer was correct*: it derived drill = nominal − pitch = 12 − 1.75,
which is the standard M12 × 1.75 tap drill at 10.25 mm. Declining to search something you know is
the behaviour you want. What the case actually shows is that **tool invocation is
prompt-format-sensitive**: a structured schema gets a structured call, a vague instruction does
not. That is a prompt-engineering fact, not a capability limit, and it means the integration must
specify the format rather than hope.

**So the technical blocker is now known to be ONLY the plumbing**, and the plumbing is a day. The
remaining blocker is entirely the policy question in §2 — whether a model may grant its own
`SendApproval` — which is unchanged and is the one that deserves the deliberation.
