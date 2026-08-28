# A Part command cannot fail after it starts executing

**Found 2026-08-28** by the IR pipeline gate's mutation test, not by looking for it.

## What happened

Mutating `ui/src/PartCommands.cpp` so the UI emits an op name the kernel does not know
(`FILLET` -> `FILLLET`) produced this:

```
[PASS] part.fillet dispatched                     status=0
--- emitted program ---
%1 = RECT(80, 60)
%2 = EXTRUDE(%1, 20)          <- the FILLET statement is simply ABSENT
```

`part.fillet` returned `DispatchStatus::Ok`. The document recorded nothing. The user would
see a command succeed and no feature appear.

## Why

`PartDocument::appendFeature()` is documented to "refuse and mutate NOTHING when the
statement fails `validateIr()`", and it correctly returned false. `AppendFeatureEdit::apply`
propagates that bool. `UndoStack::perform` returns it. And then:

```cpp
// ui/src/PartCommands.cpp:217
stack.perform(doc, std::make_unique<AppendFeatureEdit>(rec, consumed, node));
```

The result is discarded -- at that call site and at the one on line 652.

Discarding it is not really the bug, though. **There is nowhere to report it.** The handler
signature is `std::function<void(CommandContext&)> execute`, and `CommandContext` exposes
exactly two things:

```cpp
const SelectionService& selection() const noexcept;
const CommandParams&    params()    const noexcept;
```

No failure channel. So every `DispatchStatus` the registry can return --
`SelectionSignatureMismatch`, `MissingRequiredParameter`, `Disabled` -- is decided
**before** `execute` runs. **Once execution begins the answer is always `Ok`.** The
information exists (`PartDocument::lastCheck()` holds the `IrCheck`) and is thrown away.

## Why it matters beyond the mutation

The mutation was artificial, but the path is not. `appendFeature` refuses on
`BadStatementId` -- an ir id that does not equal `nextIrId()` -- which is exactly the class
of internal-consistency failure that "cannot happen" until it does. Every such refusal is
currently a silent no-op reported as success. This is the same shape as the NAFEMS gate
printing FAIL while exiting 0, and the reaper reporting removals it never performed.

## What the gate does about it today

Nothing directly -- it catches the *consequence*, geometrically. The dropped fillet was
found because the compiled solid's volume equalled the raw prism exactly (96000 vs the
93888.19 a real 4mm fillet produces). No status check would have caught it, which is the
argument for asserting on geometry rather than on return codes.

## FIXED, same day

`CommandContext` gained a failure channel -- `fail(std::string)`, `failed()`,
`failureDetail()` -- and `CommandRegistry::dispatch` now returns
`DispatchStatus::EditRefused` with that detail instead of an unconditional `Ok`.
`EditRefused` was **appended** to the enum, never inserted: the existing values are compared
as ints in tests and stored in macros, so renumbering them would silently change what a
recorded status means.

`emit()` in `PartCommands.cpp` now takes the context and reports through it when
`UndoStack::perform` returns false, naming `toString(doc.lastCheck())`. All 13 `emit()` call
sites and the one direct `perform()` were updated; **zero discarded `perform()` results
remain** in the file.

**Measured, same mutation as above:**

| | dispatch status |
| --- | --- |
| before | `0` (`Ok`) -- the FILLET statement silently absent |
| after | `6` (`EditRefused`) |

**Gated.** `ui/test/command_registry_test.cpp` gained CONTRACT 6 (51 -> 60 checks): a handler
that calls `fail()` must yield `EditRefused` with the detail carried through, a handler that
does not must still yield `Ok` with an empty detail (so the channel cannot be stuck on), and
both must count as dispatches. Proved able to fail -- reverting the dispatch change turns it
red on exactly those three assertions; restored, **ALL 9 UI GATES PASS**, with
`part_commands` unchanged at 304 checks, so the API change broke nothing.
