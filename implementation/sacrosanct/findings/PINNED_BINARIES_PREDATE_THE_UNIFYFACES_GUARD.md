# Both pinned verifiers predate the unifyFaces coaxial guard — and why scoring survives it

## What happened

`forge_verify` SIGSEGV'd during a scoring run on 2026-08-30. The stack is one this
programme has already characterised and already fixed IN THE TREE:

    Geom2d_Curve::Value                                   (libTKG2d)
    ShapeUpgrade_UnifySameDomain::IntUnifyFaces           (libTKShHealing)
    ShapeUpgrade_UnifySameDomain::UnifyFaces
    ShapeUpgrade_UnifySameDomain::Build
    forge::unifyFaces                                     (libforge_kernel_core)
    forge::ft::Builder::opVerify
    forge::ft::compile

`ShapeUpgrade_UnifySameDomain` segfaults on two coaxial equal-radius walls stored
differently — an analytic cylinder against an extrusion-of-circle. `DirectEdit.cpp` guards
it with `mixedCoaxialSameRadiusFaces()` + `seamWalls()` before calling
`ShapeUpgrade_UnifySameDomain`, and CI runs `unify_coaxial_guard_test.sh`.

## The fact worth recording

**Neither pinned binary contains that guard**, measured with `nm`:

| artifact | sha256 | `mixedCoaxial` | `seamWalls` |
|---|---|---:|---:|
| `tools/baseline_pin_45e9ad9a/libforge_kernel_core.dylib` | `20fe6e74…` | **0** | **0** |
| `tools/pinned/libforge_kernel_core.dylib` | `2972e0e8…` | **0** | **0** |

That is expected rather than wrong — a pin is FROZEN on purpose, and 24 of 24
provenance-bearing baselines assert `45e9ad9a` / `20fe6e74` precisely so a published number
can be reproduced under the instrument that produced it. But it means **every scoring run
made through either pin can still hit this crash**, and that will remain true for as long as
the pins are the pins. It is not a reason to re-pin: re-pinning would break comparability
with every number already published, which is a far larger cost than a handful of error rows.

## Why the crash does NOT invalidate a scoring run

`interface_metrics.py` drives the verifier as a PERSISTENT process (`recycle=30`), so the
obvious fear is the documented one — the CI comment for the coaxial gate says "a crash here
takes the whole verifier process down, so before the guard a single such row silently
invalidated every row that followed it in the same emission run."

For SCORING that fear is unfounded, and the containment is explicit rather than incidental
(`interface_metrics.py:223-249`). Every failure mode is handled and each returns an error for
THAT ROW before respawning:

* write raises -> `_kill()`, `_spawn()`, `{"ok": False, "error": "verifier died on write"}`
* no line within `timeout` -> `_kill()`, `_spawn()`, timeout error
* **the pump thread sees EOF and enqueues `None`** -- which is exactly what a SIGSEGV looks
  like from the parent -> `_kill()`, `_spawn()`, `{"ok": False, "error": "verifier produced
  no output"}`
* undecodable line -> explicit error

So a segfault costs ONE ROW, recorded honestly as not-ok, and the next row is measured by a
fresh process. Nothing downstream silently inherits the crash.

**And the paired comparison stays fair.** Both arms are scored through the SAME pinned
binary, and `compare_arms_paired.py` uses only the rows EVERY arm scored ok, so a row lost to
this crash drops out of the paired set for both arms rather than counting as a zero against
one of them. That is the same discipline that produced D-011's intervals.

## What this does NOT say

* It does not say the pins are broken. They are frozen instruments and behave as frozen
  instruments should.
* It does not say the EMISSION loop is equally safe. Emission drives its own long-lived
  `forge_verify` through a different path, and this note measured only the scoring path.
  A crash there was NOT characterised here and should not be assumed contained.
* It does not measure HOW OFTEN this fires. One crash was observed; the rate across a 600-row
  run is unmeasured, and the honest way to get it is to count `"verifier produced no output"`
  rows in a scored artifact rather than to estimate.
