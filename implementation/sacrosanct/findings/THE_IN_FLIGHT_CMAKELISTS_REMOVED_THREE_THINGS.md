# The in-flight CMakeLists edit silently removed three things that exist at HEAD

**Measured 2026-08-29.** The main checkout carries ~111 modified files, of which
`forge-kernel/CMakeLists.txt` is `544+/483-` against HEAD. Comparing the two directly
(`git show HEAD:forge-kernel/CMakeLists.txt` vs the working tree) shows the in-flight
version has DELETED capability rather than only adding it:

    thing removed                                    at HEAD   in-flight
    src/native/brep/NativeLoftPipe.cpp in SOURCES       yes        NO
    option(FORGE_THRUSECTIONS_DROP_NATIVE ...)          yes        NO
    option(FORGE_PIPESHELL_DROP_NATIVE ...)             yes        NO

## Why each one matters

**1. The dropped source file is a RUNTIME crash, not a build error.** `NativeLoftPipe.cpp`
is the only definition of `forge::occtloft`, and `Primitives.cpp`, `Airfoil.cpp` and
`ClassASurfacing.cpp` all call into it. The CMakeLists says what happens, a few lines
above its own source list: *"an explicit source list plus `-undefined dynamic_lookup`, an
unlisted TU is a runtime SIGSEGV, not a link error."* That is exactly what
`forge-desktop/test/run_ir_pipeline.sh` was dying of -- signal 11, not an assertion.

**2. The two removed options make TKOffset undroppable.** Families D (ThruSections) and
F (MakePipeShell) are two of the nine that must all route native before TKOffset can
leave the link line. Without the `option()` declarations the `if(FORGE_NATIVE_BREP AND
FORGE_THRUSECTIONS_DROP_NATIVE)` blocks can never be true, so those families cannot be
compiled out at all, and the whole TKOffset cut is blocked.

## This produced a false finding, which is the reason to write it down

A survey agent reading the in-flight working tree reported, as a hard blocker:

> FORGE_THRUSECTIONS_DROP_NATIVE (7 uses in src) and FORGE_PIPESHELL_DROP_NATIVE (5 uses)
> appear NOWHERE in CMakeLists.txt -- no option(), no add_compile_definitions().

**That is true of the working tree and FALSE of HEAD**, where both options are declared
at lines 567 and 570 with their `add_compile_definitions` immediately below. The agent
measured honestly; it just measured the wrong artifact, because the working tree is what
you get by default and the difference is invisible unless you look for it.

**The rule this earns:** when auditing a repository with a large uncommitted delta, state
WHICH TREE every claim is measured against, and check a structural absence against HEAD
before recording it as a blocker. A missing `option()` looks identical whether it was
never written or recently deleted, and the two demand opposite responses -- write it, or
restore it.

## Status

Not fixed here. `Features.cpp` and `CMakeLists.txt` carry substantial unrelated in-flight
work and are not mine to commit; the repairs are applied in the working tree so the tree
builds, and are deliberately uncommitted. Whoever owns that work should reconcile these
three deletions before it lands. At HEAD nothing is broken.
