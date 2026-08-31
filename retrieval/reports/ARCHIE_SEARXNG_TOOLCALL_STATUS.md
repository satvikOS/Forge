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

## What was NOT tested, and why

Because the plumbing does not exist, this report establishes only that the path is absent and that
the C++ half is gated. It does **not** establish whether the local model can emit a well-formed
tool call at all — that is a real open question (this is a 30B 4-bit VLM fine-tuned on CAD IR, not
on tool-calling, and the fine-tune may well have crowded the ability out). Answering it needs the
plumbing first. **A prerequisite for wiring this is a cheap probe: prompt the model with a tool
schema and see whether it emits a parseable call.** That probe costs minutes and should precede any
integration work.
