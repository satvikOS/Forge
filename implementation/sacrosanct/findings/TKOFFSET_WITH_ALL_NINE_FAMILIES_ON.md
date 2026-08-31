# TKOffset with all nine families ON: 38 -> 25 symbols, and the last 25 are real calls

**Measured 2026-08-29 at HEAD (`b67dd96c`), in a clean worktree.** The dependency ladder
says TKOffset must be dropped before TKFillet is worth anything (see
`THE_OTOOL_COUNT_IS_NOT_THE_DEPENDENCY.md`, where the TKFillet drop was measured at
closure 14 -> 14). This is the TKOffset attempt.

## Every family flag exists at HEAD, and they all build together

The nine TKOffset families configure and build cleanly with all of them ON:

    -DFORGE_OFFSET_DROP_MAKEOFFSET=ON  -DFORGE_OFFSET_DROP_MAKEPIPE=ON
    -DFORGE_OFFSET_DROP_DRAFT=ON       -DFORGE_OFFSET_DROP_MAKEFILLING=ON
    -DFORGE_OFFSET_DROP_THICKEN=ON     -DFORGE_OFFSET_DROP_THICKSOLID=ON
    -DFORGE_OFFSET_DROP_OFFSETSHAPE=ON -DFORGE_THRUSECTIONS_DROP_NATIVE=ON
    -DFORGE_PIPESHELL_DROP_NATIVE=ON

    configure rc=0, build rc=0, 0 errors, 420 TUs.

(The last two are the ones a survey reported as missing. They are missing from the
IN-FLIGHT working tree and present at HEAD -- see
`THE_IN_FLIGHT_CMAKELISTS_REMOVED_THREE_THINGS.md`.)

## The result: real progress, and not a drop

    build                          undefined BRepOffset* refs
    baseline (build-fixcheck)                 38
    FILLET drop only                          42
    ALL NINE TKOffset families ON             25

    TKOffset still on the link line: YES.  CLOSURE: 14 -> 14.

Turning on every family removes 13 of 38 symbol references and **does not drop the
toolkit**, because `OCCT_LIBS` lists `TKOffset` unconditionally (CMakeLists:214) and 25
references survive.

## The blocking set is now TWO FILES, and I was wrong about why

    src/Features.cpp   20 refs
    src/Healing.cpp     5 refs   (BRepOffsetAPI_MakeFilling, line 488)

My first hypothesis was that these are vtable references dragged in by UNGUARDED
INCLUDES -- `Features.cpp:80-102` includes eight BRepOffset* headers with no `#ifndef`,
and the CMakeLists explicitly warns that "guarding the include is what keeps the drop
build from emitting a reference to a vtable". **Measured, and refuted:**

    vtable refs in Features.cpp.o :  3
    real method calls             : 17

    BRepOffset_MakeOffset::Initialize / MakeThickSolid / Shape / IsDone
    BRepOffsetAPI_DraftAngle::Add / Build / Remove / AddDone
    BRepOffsetAPI_MakeThickSolid::MakeThickSolidByJoin / Build
    BRepOffsetAPI_MakeOffsetShape::PerformByJoin
    BRepOffsetAPI_MakePipe::Build

These are LIVE CALL SITES that the family flags do not compile out. Guarding the
includes would remove 3 of 25 and leave the toolkit exactly where it is.

## What TKOffset actually needs

Not a build-flag combination -- **the remaining call sites in two files have to route
native or be compiled out**. That is a bounded, nameable piece of work: 17 calls across
6 API classes in `Features.cpp`, plus one `MakeFilling` site in `Healing.cpp`. Each
family already has a native peer; what is missing is that these particular sites are
outside the `#ifdef` regions the flags control.

**The honest status of the kernel drop: closure is 14 and has not moved.** Every step
taken so far -- the BRepPrimAPI fix, the dead-include hygiene, the concave fillet engine,
and this -- is prerequisite work whose effect on the number that counts is still zero.
Saying so is the point; the ladder is real, but nothing has been banked yet.
