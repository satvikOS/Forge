# `forge_verify` segfaults in `jsonEscape` — the measurement instrument is memory-unsafe

**Found:** 2026-08-28, incidentally, by the health monitor during wave 4.
**Status:** OPEN. Not fixed here — recorded so it cannot be lost, and because it bears on numbers
this programme has already reasoned about.

## Signature

27 crash reports in ~90 seconds while the PIN and REEMIT tracks exercised the pinned verifier:

| count | signal | top frames |
| ---: | --- | --- |
| **22** | `SIGSEGV` | `(anonymous namespace)::jsonEscape(std::string...)` ← `main` ← `start` |
| 5 | `SIGABRT` | `abort` ← `pthread_kill` |

`EXC_BAD_ACCESS / KERN_INVALID_ADDRESS` at a large non-null address (e.g. `0x4064ecf5c0000017`),
which reads as a corrupted or misinterpreted pointer/length rather than a null dereference.

## Why this is more than a crashing tool

`forge_verify` is **the instrument that produces every measurement in the model programme** — the
composite scores, the build-failure counts, the pinned baselines.

`jsonEscape` runs while **emitting the result**, not while computing it. So the failure mode is:
the verifier does the geometry work, then dies writing its answer. The caller observes no output
and, depending on the harness path, records that as a build failure or a refusal.

That is the same shape as two defects already confirmed this session — an instrument reporting a
number it did not earn:

- the adapter that was never loaded, whose out-of-vocabulary output made 35/36 tasks "fail to build";
- the scorer that could not distinguish "the candidate failed" from "the instrument failed", which
  the MFIX track hardened for exactly this reason.

**Any build-failure count produced by a harness that shells out to `forge_verify` is suspect until
this is understood.** It does not automatically invalidate anything — the v4a analysis stands on
op-vocabulary evidence independent of the crash — but it is a live confound.

## What must happen next

1. **Find the input that reproduces it.** The tracks were feeding real candidates; capture the
   stdin/argv of a crashing invocation. A 22× repeat means it is not exotic.
2. Fix the bounds error in `jsonEscape`. Likely candidates: a byte-vs-code-point length confusion,
   an unterminated buffer, or an unchecked index while escaping a control or multi-byte character.
   Build the fix with ASan/UBSan (SR-3 already requires sanitizers) and add the reproducer as a
   regression test.
3. **Make the harness distinguish a crashed verifier from a failed candidate.** A non-zero exit
   from a signal is not the same fact as "this geometry did not build", and today they may be
   recorded identically. This is the higher-value half of the fix.
4. Re-examine whether any published build-failure count includes crashed-verifier rows.

## Reproduction pointers

Crash reports: `~/Library/Logs/DiagnosticReports/forge_verify-2026-08-28-0327*.ips`
Binaries seen live: `~/archdisc-Models/tools/pinned/forge_verify`,
`~/archdisc-Models/tools/baseline_pin_45e9ad9a/forge_verify`.

Related: the PIN track separately established that `tools/pinned` is **not actually pinned** — its
RPATH points into a mutable sibling build directory with no `@loader_path`, so "provenance is
truthful by coincidence."
