# Sacrosanct execution — decision record

Each entry: the question, the constraints, what the evidence says, what was chosen, what was
rejected and why, whether it is reversible, and the measurement that would settle it.

---

## D-001 — Desktop UI stack: Qt 6 Widgets vs Dear ImGui — **OPEN, needs the user**

**Question.** Sacrosanct 3.1 §19.2 mandates Qt 6 Widgets + KDDockWidgets. The repository's own
committed `docs/FORGE_CPP_MIGRATION.md` (2026-07-16) is headed **"NOT Qt"** and commits to Dear
ImGui, which `forge-desktop/` already vendors. Which governs?

**Constraints.**
- Sacrosanct is the constitution and 3.1 (2026-08-28) is six weeks newer than the migration doc.
- The migration doc's reasoning is substantive, not stylistic.
- Whatever is chosen must eventually reproduce a **~445-function** kernel surface (today exposed by
  a 1,635-line `preload.js` via `contextBridge`), not merely 24 IPC channels.

**Evidence — where the two documents actually agree.**
The migration doc names its own flip condition: *"if enterprise procurement hard-requires certified
accessibility (screen-reader/AT trees), rich-text document editing, printing pipelines, or
20-language i18n inside the app chrome."* Sacrosanct §19.2 selects Qt for, verbatim, *"native menus,
actions, text, input, **accessibility**, model/view, dialogs, **printing**, and platform
integration."* 3.1 asserts the flip condition as a requirement. **On capability reasoning the
documents converge on Qt.**

**Evidence — what does not resolve.**
1. **Licensing.** Qt LGPLv3 allows proprietary use only via **dynamic linking** and requires a
   *prominent in-user-interface notice* plus a relink path. The migration doc records that Forge is
   free-but-proprietary and wants a statically-linkable binary with no attribution-in-UI obligation.
   3.1's Law 16 requires the *dependency stack* to be open source and source-buildable — it does
   **not** make Forge itself open source, and it never addresses this obligation. KDDockWidgets
   (GPL / commercial dual licence) raises the same question again.
2. **Latency.** ImGui composites UI into the *same* Vulkan command buffer as the scene. Qt places
   the scene in a separate context or an FBO copied per frame. 3.1 §19.2 independently selects
   **Diligent Engine with a Metal backend** — not Vulkan — so the migration doc's specific latency
   argument is about a renderer 3.1 does not choose, and needs re-measuring rather than re-quoting.

**Status.** OPEN. Sacrosanct governs, so **Qt 6 is the working default** and no UI work will be
built on Dear ImGui in the meantime. But this is a licensing commitment on the shippable binary and
a multi-month build, so it is escalated rather than resolved silently.

**What would settle it.**
- A licensing determination: is Forge shipped proprietary? If yes, Qt LGPL dynamic-linking plus the
  in-UI notice must be accepted explicitly, or a Qt commercial licence obtained.
- A measured comparison on the *actual* 3.1 stack (Diligent/Metal), not the Vulkan stack the
  migration doc assumed: frame latency and input-to-photon for Qt-hosted vs ImGui-composited.

**Reversible?** Cheaply now (`forge-desktop/` is 6 probe programs, not an app). Expensively later.
This is the right moment to decide.

---

## D-002 — Sacrosanct 3.1 placed at `docs/sacrosanct/`, not `output/pdf/` — **DECIDED**

The execution brief suggested `output/pdf/Archie_Sacrosanct_v3.1.pdf` "or an equivalent versioned
PDF." `output/` reads as build output and is a deletion target under the storage governor; a
normative constitution must never sit in a directory a garbage collector may treat as disposable.
Placed at `docs/sacrosanct/` with a text extraction and recorded SHA-256 for both. Reversible.

---

## D-003 — `sacrosanct.md` left untouched — **DECIDED**

The working tree's `sacrosanct.md` shows −1136/+181 against HEAD. That is the uncommitted
2026-07-26 **v2 rewrite**, not a truncation accident. It was preserved byte-for-byte and the
three-generation lineage documented in `docs/sacrosanct/README.md`. Overwriting it with 3.1 would
have destroyed authored work that was never committed anywhere.

---

## D-004 — `kernel-tests.yml` `kernel` job retained despite being Node — **DECIDED**

The macOS OCCT job builds `forge-kernel.node` and runs the smoke suites through Node. It is
JavaScript, and Sacrosanct §3.2 targets its removal. It was **kept** because it is the only coverage
the OCCT-linked kernel has, and §3.2 permits removal only after a mapped C++ owner and C++ test
exist. Deleting it now would be removal-by-extension ahead of its replacement — the specific error
the section forbids. Marked TRANSITIONAL in the workflow and tracked as a deletion target.

The `guards` job and the `Bridge smoke` step were removed, because both are Electron/React app
concerns with no C++ successor to wait for: `bridge_smoke.js` literally launches Electron and
asserts the `window.forge` preload bridge round-trips.

---

## D-005 — Parallel writers must use worktrees — **DECIDED (learned the hard way)**

Five of eight baseline auditors reported HEAD moving underneath them mid-audit. The cause was this
session committing into the shared checkout while read-only agents were reading it. No finding was
invalidated (the SHA held during the census and results were re-verified), but the rule is now
binding: **parallel writers get their own worktree; audits pin a SHA and report against it, never
against `HEAD`;** and any manifest derived from a census is re-validated against the SHA actually
checked out when it executes.
