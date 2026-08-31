# `forge_verify` aborts on a malformed `\u` escape — and takes the whole batch with it

**Found:** 2026-08-28 by the health monitor (27 crashes in ~90s).
**CORRECTED:** 2026-08-28, same day. **The original diagnosis in this file named the wrong
function.** It is preserved below as a worked example of a confident wrong attribution, because the
way it went wrong is reusable.
**Independently confirmed by CodeRabbit** on PR #61 as a MAJOR finding at `forge_verify.cpp:84`.

---

## What I originally wrote, and why it was wrong

I read 27 crash reports, found **22 with an identical signature** — `SIGSEGV` in
`(anonymous namespace)::jsonEscape` called directly from `main` — and concluded there was a bounds
error in `jsonEscape`'s buffer handling. The signature was real. **The attribution was not.**

A verifying agent refuted it with the code:

> `jsonEscape`'s only buffer write is `std::snprintf(buf, sizeof buf, "\\u%04x", c)`, reachable only
> under the guard `static_cast<unsigned char>(c) < 0x20`, so the widest output is 6 chars + NUL into
> a `char buf[8]`. **It cannot overflow.** `jsonEscape` is inlined into `main` at all ~12 of its call
> sites, and the abort raised from **`jsonUnescape` one statement earlier** symbolizes into the
> adjacent inlined frame. **Anyone sent to audit `jsonEscape` will find nothing.**

**The lesson:** a stack frame in an optimised binary names *where the symbol was inlined*, not
necessarily *what executed*. 22 identical signatures felt like overwhelming evidence and were
actually 22 instances of the same misleading symbolization. Frequency is not attribution.

---

## The actual defect

`forge-kernel/src/tools/forge_verify.cpp:71`

```cpp
const int cp = std::stoi(s.substr(i + 1, 4), nullptr, 16);   // unguarded
```

`std::stoi` throws `std::invalid_argument` when no conversion is possible (input `\uZZZZ`) and
`std::out_of_range` otherwise. Nothing catches it.

**Also refuted:** the bounds check on the line above is *correct*. `if (i + 4 < s.size())` reads
indices `i+1..i+4` and requires `i+4 <= size-1`, which is exactly what it tests. **Do not "fix" it.**

## Why it is worse than a crashing line

The abort is **process-wide and unhandled**:

- `main` (line 346) has **no try block**.
- The six `jsonString()` calls on lines 355–360 — `id`, `refStep`, `iouGrid`, `ir`, `inputStep`,
  `outStep` — each reach `jsonUnescape` **before** the only try/catch on the path, which begins at
  line 375 and wraps `compileText` alone.

So a malformed `\u` in **any of six fields on any input line** escapes `main`, hits
`std::terminate`, and **kills the entire remaining batch of candidates** — not just the offending
row. Every subsequent candidate is simply never scored.

The codebase already knows `stoi` throws: line 656 guards its other `stoi` with
`try { grid = std::stoi(gridStr); } catch (...) { grid = 64; }`.

Two further defects in the same function: the truncated-escape branch falls through to `break`
without consuming, re-emitting `u` and the partial digits; and a surrogate-pair code point
`D800–DFFF` is encoded as a bare 3-byte sequence, producing invalid UTF-8.

## The higher-value half is still open

`forge_verify` speaks one JSON line in, one JSON line out. **A caller cannot distinguish a
signal-terminated verifier from a candidate that genuinely failed to build** — both present as "no
result line". Every build-failure count this programme has reasoned about was produced by a harness
that cannot tell those apart.

That is the same confusion that already redirected this programme once: the v4a run's 35/36
"build failures" were reported as a capability ceiling and halted the work. Fixing the `stoi` throw
removes one cause; teaching the harness to distinguish instrument failure from candidate failure
removes the *class*.

## Status

- `stoi` guard: **owed**, with a malformed-escape reproducer under ASan/UBSan.
- Harness distinction between a crashed verifier and a failed candidate: **owed, higher value**.
- `jsonEscape`: **not a defect. Do not audit it.**


---

## RESOLVED 2026-08-28 — branch `fix/forge-verify-stoi`

Fixed, gated, and both defects measured on real binaries built from the same kernel core.

### What was wrong

`jsonUnescape` read `\uXXXX` with `std::stoi(s.substr(i + 1, 4), nullptr, 16)`. Two defects,
one loud and one silent:

1. **`std::stoi` throws.** `std::invalid_argument` on `\uZZZZ`. `main()` calls `jsonString()`
   SIX times before it opens its first `try`, so the throw escaped `main` and the process died
   with SIGABRT, **taking every later record with it**.
2. **Base-16 `std::stoi` stops at the first non-hex character.** `\u00ZZ` partially parsed to
   `0` and **silently injected a NUL byte**. No crash, no message — corrupt output that looks
   like clean output. Only reachable once defect 1 stopped killing the process first.

### Measured, on the gate's own 6-record fixture

| | exit | records emitted |
| --- | --- | --- |
| before | **134** (SIGABRT, `uncaught exception of type std::invalid_argument: stoi: no conversion`) | **2 of 6** |
| after | **0** | **6 of 6** |

Of the four records lost before the fix, **three were well-formed**. The silent defect, isolated:

```
before   X\u00ZZY  ->  X <NUL> Y      (echoed back as X\u0000Y)
after    X\u00ZZY  ->  X u 0 0 Z Z Y  (kept literal)
```

Valid escapes are byte-for-byte unchanged: `\u0041`->A, `\u007A`->z, `\u20AC`->euro sign,
`\u00F1`->n-tilde, identical on both binaries. The fix does not buy robustness with correctness.

### The fix

A strict four-hex-digit parse that cannot throw and cannot partially parse. Malformed or
truncated escapes keep the `u` literally, exactly as the existing `default:` case already does
for every other unknown escape — never a throw, never an invented byte.

### The gate

`forge-kernel/test/forge_verify_batch_gate.sh`, wired into the `kernel` CI job (which now builds
`forge_verify`, since no job did). Proven able to fail, all three ways:

- against the fixed binary: **GREEN**, 9 checks
- against the unfixed binary: **RED (exit 1)**, 6 failing checks, stderr naming the exact cause
- with the binary missing: **RED (exit 3)** — a check that could not run is not a check that
  passed, so this is never a silent skip

The file is deliberately pure ASCII and builds its fixture from octal escapes: a literal
backslash-u in the source can be decoded in transit by any layer that carries the file. That is
not hypothetical — it happened twice while writing this gate, and produced a fixture with **zero**
malformed escapes that "passed" against both binaries and proved nothing.

### Integration

The fix is on `fix/forge-verify-stoi`, not on the execution branch: `forge_verify.cpp` is one of
the 37 user-owned in-flight files. Their uncommitted diff to it is +33/-1 and **does not touch
`jsonUnescape`**, so the two changes do not overlap textually — this merges cleanly once the
in-flight work is committed.

`jsonEscape` remains **not a defect. Do not audit it.**
