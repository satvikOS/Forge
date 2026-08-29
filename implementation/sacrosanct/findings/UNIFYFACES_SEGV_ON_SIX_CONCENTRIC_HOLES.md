# forge::unifyFaces segfaults on the sixth concentric hole enlargement

**Measured 2026-08-28. Deterministic, minimal, and present in the PINNED baseline
binary that every published score is measured with.**

## The crash

```
EXC_BAD_ACCESS (SIGSEGV) at address 0x0

libTKG2d        Geom2d_Curve::Value(double) const
libTKShHealing  ShapeUpgrade_UnifySameDomain::IntUnifyFaces(...)
libTKShHealing  ShapeUpgrade_UnifySameDomain::UnifyFaces()
libTKShHealing  ShapeUpgrade_UnifySameDomain::Build()
forge_kernel    forge::unifyFaces(unsigned int)
forge_kernel    forge::ft::Builder::opVerify(...)
forge_kernel    forge::ft::compile(...)
```

`Geom2d_Curve` is the PCURVE type, and the null is the `this` pointer -- OCCT's
face-unification obtained a null pcurve handle for an edge and called `Value()` on
it. The VERIFY op runs `forge::unifyFaces` unconditionally, and the OCCT path in
`forge-kernel/src/DirectEdit.cpp` is completely unguarded:

```cpp
const TopoDS_Shape& shape = ShapeRegistry::instance().get(body);
ShapeUpgrade_UnifySameDomain u(shape, Standard_True, Standard_True, Standard_True);
u.Build();
return ShapeRegistry::instance().add(u.Shape());
```

No validity check, no try/catch -- and a SIGSEGV would not be catchable anyway.

## The reproducer, and what it says about the cause

Found by bisecting a real emitted tree (`ho1139`, 54 ops) down to 49 ops, then
hand-reducing to **34 lines**: `forge-kernel/test/ft_unify_concentric_hole_segv.ir`.

The shape is a plate, into which N cylinders of radius 4.495 are CUT, and then N
`HOLE` ops of radius **8.99 at the same centres** enlarge each one concentrically.

    plate + 1 concentric cut+HOLE pair   rc=0
    plate + 2 pairs                      rc=0
    plate + 3 pairs                      rc=0
    plate + 4 pairs                      rc=0
    plate + 5 pairs                      rc=0
    plate + 6 pairs                      rc=-11   SIGSEGV

**The threshold is a COUNT, not a geometry.** Five concentric enlargements are fine
and the sixth crashes, with every hole identical apart from its y position. That
points at indexing or capacity inside `IntUnifyFaces` over the same-domain merge
groups, not at a degenerate face -- a genuinely malformed pcurve would fail on the
first hole, not the sixth.

Confirmed against `tools/baseline_pin_45e9ad9a/forge_verify` (`rc=-11`), so this is
not specific to the in-flight build.

## Why it did not corrupt the run

The emission absorbed it: `[verifier] child closed its output; respawn #4`, and the
three rows after `ho1139` scored normally. Before today's respawn fix this crash
would have silently invalidated every remaining row. `ho1139` itself is recorded
`verifier produced no output` with `_verifier_restarted`, so it is auditable.

The scorer is also protected -- `CensusVerifier` already respawns -- but a candidate
that triggers this is classified REFUSED, so it silently leaves the paired set.
Any arm containing such a row loses it from n.

## The fix, NOT applied yet and why

`DirectEdit.cpp` is clean (not among the in-flight files), so it can be fixed in a
worktree branch and PR. Two candidate guards:

1. **Pre-check** every edge of every face for a pcurve (`BRep_Tool::CurveOnSurface`
   non-null) and skip unification when any is missing, returning the shape
   unchanged. This changes behaviour ONLY where the current behaviour is a crash --
   the same reasoning that made respawn safe to add mid-programme.
2. **Repair** with `ShapeFix_Shape` (already included in this file) before unifying.
   REJECTED as the default: it would alter the geometry of every shape that passes
   through VERIFY, and every score in this programme is measured through that path.

Guard 1 is the one to write. It must be validated against the count threshold above:
a fix that stops the crash but also stops unification for the 1-5 cases would
silently change results for shapes that work today.

**Deferred** because a kernel rebuild is heavy and a 600-row emission plus a chained
v1 arm are on the critical path; the memory incident earlier today was caused by
exactly this kind of concurrent load.
