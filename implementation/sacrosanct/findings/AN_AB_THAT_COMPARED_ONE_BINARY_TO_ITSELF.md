# An A/B that compared one binary against itself, three times

**Measured 2026-08-29.** A three-variant comparison (no guard / narrow guard /
deliberately over-wide guard) over 150 real emissions and over the 20 refused rows
returned **0 differences in all three pairwise comparisons**. That looked like a
clean, strong safety result for a kernel change. It was worthless. Three independent
traps stacked, and every one of them produced a plausible number instead of an error.

## Trap 1: the executable is a stub

    $ otool -L build-verify/forge_verify
        @rpath/libforge_kernel_core.dylib

`forge_verify` is 77 KB. Every line of kernel logic lives in the dylib it loads at
run time. `cp build-verify/forge_verify /tmp/fv_NOGUARD` copied **none of the code
under test** -- it copied a loader. All three `/tmp` copies were byte-identical
(`shasum` on all three: `06ed5534325e`), and each one resolved to whichever dylib
was sitting in the build directory when it ran. The "A/B" ran the same code three
times.

The tell was there and I read past it: all three files were exactly 77552 bytes.

## Trap 2: `cp -R` makes the objects newer than the source

Rebuilding into a copied build directory (`cp -R build-verify build-wide`) does not
rebuild. `cp -R` does not preserve mtimes, so every copied `.o` becomes NEWER than
the source file, and CMake correctly concludes there is nothing to do:

    [100%] Built target forge_verify      <- with no "Building CXX .../DirectEdit.cpp.o"

The fix is `touch` on the source, and the check is to grep the build output for the
compile line rather than trusting "Built target".

## Trap 3: CMake bakes an ABSOLUTE rpath

Even after forcing the recompile, all three variant executables carried the same
`LC_RPATH`:

    path /Users/.../forge-kernel/build-verify

So `build-noguard/forge_verify` loaded `build-verify`'s dylib. The variant
directories were real, the dylibs inside them were genuinely different (three
distinct shas), and the binaries still all behaved identically.

Swapping the dylib under one executable does not work either on Apple Silicon:
replacing `libforge_kernel_core.dylib` in place invalidates the signature and the
process is SIGKILLed (`rc=137`) rather than running the variant.

**What actually selects the variant is `DYLD_LIBRARY_PATH`**, and it must be proved
to work before it is trusted:

    DYLD->build-noguard  crasher rc=139     <- the guard is absent, it crashes
    DYLD->build-wide     crasher rc=0
    DYLD->build-verify   crasher rc=0

## What the corrected measurement says

Three variants built as three separate dylibs, selected with `DYLD_LIBRARY_PATH`:

    comparison                    20 refused rows      150 corpus rows
    this guard vs no guard        1 (ho1139 rescued)   0
    this guard vs over-wide       4                    39   (26%)

**The corrected run agrees with the broken one on the headline number** -- 0 of 150
for the no-guard comparison. That is exactly why the broken harness was believable,
and it is the whole point: the number was right by accident. What makes the
corrected result mean anything is not the zero, it is the over-wide arm finding 39
differences and the positive control finding a rescue in the same harness.

The corrected run also OVERTURNED the conclusion drawn from the broken one. On the
invalid evidence the narrow and wide guards looked indistinguishable, so the
narrowness was described as justified "on principle, not by corpus evidence".
Measured properly, dropping the mixed-representation test changes 39 of 150 real
parts -- a quarter of them silently stop unifying. The narrowness is earned.

## The single-row evidence

`ho1139` -- the real 55-op row that hit this in production -- with the guard as the
ONLY difference between two builds of the same source:

    no-guard   rc=139   0 bytes      (SIGSEGV, verifier process dies)
    guarded    rc=0     480 bytes    valid=true

## The rule

**A comparison that reports NO DIFFERENCE has not passed a test; it has failed to
run one until proven otherwise.** Before believing a null result from an A/B, prove
the two arms are actually different: check the artefact under test is the artefact
that contains the change (`otool -L` for a stub), that the build actually rebuilt
(grep for the compile line), and that the running process loaded what you think
(a positive control -- one input that MUST behave differently, verified to do so).

A null A/B result and a broken A/B harness are indistinguishable from the outside,
and this programme keeps meeting the same failure mode: an artifact that misreports
what it did. Here it took the shape of the most reassuring possible answer.
