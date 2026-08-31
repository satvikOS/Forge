# Sacrosanct — normative document set

## Authority

`SacrosanctUltima_v3.1.pdf` (Archie Sacrosanct **3.1-draft**, dated 2026-08-28, 214 pages) is the
governing engineering constitution for satvikOS/Forge. `SACROSANCT_3.1.txt` is a faithful
`pdftotext -layout` extraction of that PDF, committed so the normative text is greppable,
diffable, and readable by tooling without a PDF parser. The PDF is authoritative where the two
ever disagree.

| Artifact | SHA-256 |
| --- | --- |
| `SacrosanctUltima_v3.1.pdf` | `7f083b5961a6df6f7d607d74d450047c54e40695e1a431db5d012fbb69a79d55` |
| `SACROSANCT_3.1.txt` | `c12f872dd889c1cd42cedb8184bad04788faefec6330ac23e4eeaef13da66278` |

## Relationship to the older documents

There are three generations of this document. They are **not** interchangeable.

| Generation | Location | Status |
| --- | --- | --- |
| 2026-07-16 (v1) | `sacrosanct.md` at `HEAD` (44 KB, 1176 lines) | superseded |
| 2026-07-26 (v2) | `sacrosanct.md` in the **working tree** (14 KB, 221 lines), uncommitted | superseded, preserved |
| 2026-08-28 (**3.1**) | this directory | **normative** |

The working-tree `sacrosanct.md` is a deliberate v2 rewrite that has never been committed. It shows
in `git diff` as −1136/+181 lines against v1. That is authored work, **not** a truncation
accident, and it is preserved untouched. Nothing in this directory overwrites it.

## What 3.1 changes that matters most to execution

3.1 is materially stricter than v2 and adds whole subsystems v2 never described:

- **§0 Elastic Exact Feature DAG Constitution** — release-blocking. Exact length law, completeness
  contract, cardinality reconciliation (declared == parsed == compiled == replayed == logged), no
  opaque loops/macros, chunked generation with a hash-chained stream, and `PAUSED_INCOMPLETE`
  instead of silent truncation.
- **§0.16 / §9.6** — "compile the feature tree" is defined as an *incremental domain compile*:
  lower typed IR into **prebuilt** C++ operators and execute only the invalidated dependency
  closure. Model text never reaches a compiler or shell.
- **§3.2 Zero-JavaScript repository** — Electron/Node/npm/JS/TS are migration inputs only, removable
  only through a reviewed manifest that maps every deleted behavior to a C++ symbol *and* a C++
  test, followed by a permanent CI gate.
- **§10.6 / §21.2** — a fully local dependency plane: `third_party/manifest/deps.lock.json`,
  `ONLINE_SEED` vs `OFFLINE_BUILD`, immutable content-addressed prefixes, and a CI-proved
  network-disabled build.
- **§19.2** — the desktop stack is chosen: Qt 6 Widgets (no QML), KDDockWidgets, one Diligent
  Engine viewport on Metal, with OCCT tessellation carrying stable entity IDs.
- **§21.3** — a native C++ storage governor with proof-based garbage collection.
- **Law 2 / §12** — a same-Mac SearXNG sidecar is the *only* permitted production network egress.
- **Appendix B** — twelve mandatory acceptance tests, including `LONG-10X-RESUME`,
  `LONG-100X-RESUME`, `CHUNK-CORRUPTION`, `RESOURCE-EXHAUSTION`, `OPAQUE-MACRO`, and
  `DETERMINISTIC-COMMIT`.

## Reading rule

3.1 states its own status plainly, and it is repeated here because it governs how this repository
may describe itself:

> Checkmarks, leaderboard positions, throughput claims, and parity claims are prohibited in this
> document unless a reproducible artifact proves them against a pinned build. A unit test is not
> evidence of system completion; a screenshot is not evidence of geometric correctness; and a
> benchmark score is not evidence of industrial readiness.

Every page footer reads *"target specification, not a completion claim."* Treat it that way.
