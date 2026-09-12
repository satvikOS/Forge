# Kernel benchmarks — how correctness and performance are measured

Two instruments answer two different questions, and neither can answer the
other's:

- **`forge-kernel/test/native/run_native.sh`** — does the in-house C++ kernel
  compute the right answer? Pure C++20, no OCCT, no npm, no WASM.
- **the `kernel` job of `.github/workflows/kernel-tests.yml`** — does the
  OCCT-linked `.node` still match textbook closed forms, and is the OCCT
  dependency ledger still where the tracker beside this file says it is?

Everything below was run against this worktree. Numbers taken from a command
are marked MEASURED; numbers taken from a pin or a comment in the tree are
marked as such and named as what they are, because a pin someone else measured
is evidence of a different quality from a number this document re-ran.

## Measured 2026-09-12 at ddef657b

Workstation: macOS arm64, `sysctl -n hw.ncpu` = **14**. CI runtimes are
different machines and are labelled where they appear.

---

## 1. The native gate suite — 142 gates

    bash forge-kernel/test/native/run_native.sh

Wired in exactly two places, and both were checked:
`.github/workflows/kernel-tests.yml:99` (the `native` job, `ubuntu-latest`,
`timeout-minutes: 120`) and `package.json:20` (`npm run forge:native`).

MEASURED here, full run, exit 0:

```
[self-test] OK -- 13 controls, every one the expected verdict
[native] parallelism JOBS=14
[native] compiled 156 source objects
...
[native] ALL 142 NATIVE GATES PASS (forge::native — pure C++, no deps, no WASM)
```

Wall clock on 14 cores, **three runs**: `2:01.82 total` (321.39 s user),
`2:53.84 total` (314.08 s user, 196 % CPU — that one overlapped other work on
this machine) and `2:00.01 total` (325.18 s user). Near-identical user time,
53 s apart on the wall: one sample cannot separate growth from contention, which
is the same lesson the `kernel` job's own timeout comment records. The job
comment budgets `~45 min cold` on a 4-core runner and `120` minutes covers it.

### Where 142 comes from

One `predicates_test.cpp`, plus every `*.cpp` under the nineteen class
directories the script enumerates. Counted with
`ls forge-kernel/test/native/<class>/*.cpp | wc -l`:

| class | gates |
|---|---:|
| `brep` | 61 |
| `mesh` | 26 |
| `geom` | 19 |
| `implicit` | 7 |
| `voxel` | 6 |
| `csg` | 4 |
| `fea` | 3 |
| `linalg` | 3 |
| `gdt` | 2 |
| `am`, `cam`, `composites`, `em`, `materials`, `storage`, `surfit`, `tolstack`, `viz`, `vvuq` | 1 each = 10 |
| **total under the classes** | **141** |

141 under the classes + `predicates` = **142**, which is exactly what the
script's own arithmetic prints. The directory list in the script and the
directory list on disk agree: every directory under `forge-kernel/test/native/`
is enumerated, none is silently skipped (checked by diffing `ls -d
forge-kernel/test/native/*/` against the script's `for d in …` list).

**The job comment is stale and UNDER-counts.** `kernel-tests.yml:66-67` says
`~125 native sources` and `~121 tests`; MEASURED they are **156** and **142**.
The 120-minute ceiling was set against the smaller pair. That is a note to
re-measure the ceiling, not a claim that it is currently too small — the run
above finished in two minutes on this box and the last recorded CI shape is a
cold 4-core runner.

### Three properties to know before trusting a green run

- **The preflight has its own controls.** `check_includes.sh --self-test` runs
  first and must pass its **13** controls before any compile happens; the suite
  aborts if the checker cannot be shown to fail. Verified in the run above.
- **A hang FAILS.** `TEST_TIMEOUT` defaults to **300 s** per test, enforced by a
  hand-rolled background-kill (`timeout(1)` is coreutils and absent on macOS —
  confirmed here: `timeout` is `command not found`). A timed-out test writes to
  the failure marker and exits 124.
- **`ONLY=` can never report a full gate.** A filtered run prints
  `FILTERED RUN … NOT a full gate`, and an unfiltered run that somehow ran fewer
  than `count` gates exits 1 with `INTERNAL ERROR`.

### What this suite does NOT do

- **It runs no differential against OCCT.** By design: it is the no-dependency
  arm. The OCCT oracle comparisons live in the `kernel` job (`npm run
  forge:kernel:test`, the two-path differential, `native_vs_occt_core.mjs`).
- **It asserts wall-clock time exactly once.** `grep -rnE "check\([^,]*\bms\b[^,]*[<>]"
  forge-kernel/test/native/` returns **one** line —
  `forge-kernel/test/native/brep/native_tangent_boolean_gate_test.cpp:130`,
  `check(ms < 1000.0, … "detector returns in bounded time (< 1 s)")`, fired once
  per tangent-pinch case. Three native tests mention `<chrono>`
  (`linalg/linalg_test.cpp`, `linalg/sparse_eig_test.cpp`,
  `brep/native_tangent_boolean_gate_test.cpp`); the other two print timings and
  assert on convergence and residuals, not on the clock.

---

## 2. Physics validation gates — seven wired, three pinned

Ten known-answer gates exist. **Seven run in CI**, in the `kernel` job
(`OCCT kernel smoke (TRANSITIONAL — pending native C++ harness)`,
`macos-latest`, `timeout-minutes: 75`), under the step
`Physics validation gates (known-answer, against textbook closed forms)` at
`.github/workflows/kernel-tests.yml:788-794`. They sit in that job because it is
the one that has already built the `.node` they load.

| gate | validated against | pinned in the workflow | MEASURED here |
|---|---|---:|---:|
| `calculix_io_gate.mjs` | `.inp` path == native path to machine precision; hand-transcribed decks vs σ=F/A, δ=PL³/3EI, Euler–Bernoulli modal frequency; `.frd` round-trip | 0.3 s | 0.32 s |
| `cfd_sod_gate.mjs` | the EXACT Sod shock-tube Riemann solution (Toro, Test 1) | 0.1 s | 0.11 s |
| `cfd_species_gate.mjs` | Patankar steady advection–diffusion exponential profile; monotone TVD pulse translation | 5.2 s | 5.66 s |
| `em_electrostatics_gate.mjs` | three Griffiths capacitor closed forms (plate, coaxial, sphere) | 0.1 s | 0.08 s |
| `em_joule_gate.mjs` | Joule's law power balance I²R; parabolic Joule-heated bar | 0.1 s | 0.07 s |
| `em_magnetostatics_gate.mjs` | finite-solenoid on-axis B_z; infinite-solenoid Ampère limit; ½LI² energy | 0.1 s | 0.11 s |
| `setback_clearance_gate.mjs --selftest` | its own 6 mutations against a pinned pre-fix baseline | 0.1 s | 0.05 s |
| | | **5.9 s** | **6.40 s** |

Physics coverage in that job is not only these seven: two further
known-answer FEA steps follow them — `Tet4 element convergence vs Lame exact
solution` and the `NAFEMS known-answer accuracy ratchet` — plus a `2D sketch +
constraint gate`, a `Native binding smoke` and the two-path differential. This
document measures the seven named above; the rest are listed so nobody reads
"seven physics gates" as "seven physics checks in CI".

All seven exit 0 here (`node forge-kernel/test/<gate>.mjs`, `rc=0` each, timed
with `/usr/bin/time -p`). A sample of what they print, so "known-answer" is not
taken on faith:

- `em_electrostatics`: parallel-plate `C = ε₀A/d` err **0.000 %** (band 0.5 %),
  coaxial `C' = 2πε₀/ln(b/a)` err **0.000 %** (band 1 %), finite-domain sphere
  err **0.003 %** (band 2 %).
- `cfd_sod`, MUSCL N=400: p\* **0.30314** vs exact **0.30313**, shock position
  **0.85250** vs **0.85043** (0.21 % of domain), verdict PASS.
- `setback_clearance --selftest`: unmutated control **12 checks, 0 red**, and
  **6/6 mutations made the gate RED** — over-fire, degrade, two under-fires,
  wrong-reason and silent-gain.

### The three that do NOT run in CI

They are pinned in `tools/kernel/js_gate_registration_gate.py`'s `ALLOW`, each
with a reason and a measured cost:

| gate | validated against | pinned cost |
|---|---|---:|
| `cfd_oblique_shock_gate.mjs` | analytic θ–β–M oblique-shock law + Rankine–Hugoniot (Anderson); M₁=2.0, θ=15° → β≈45.34°, M₂≈1.446 | 299.4 s (5.0 min) |
| `cfd_ghia_gate.mjs` | Ghia, Ghia & Shin (1982) Tables I & II, lid-driven cavity Re=100/400/1000 | 641.5 s (10.7 min) |
| `cfd_natconv_gate.mjs` | de Vahl Davis (1983) differentially-heated square cavity benchmark | 1612.5 s (26.9 min) |
| | | **2553.4 s = 42.6 min** |

**Those three numbers are pins, not re-measurements — this document did not run
them.** `ALLOW` records all three as PASSING. 42.6 of the physics suite's 42.7
minutes live in these three, against a host job whose measured cost is already a
34–41 minute distribution (the reason its `timeout-minutes` is 75, recorded at
`kernel-tests.yml:641-671`).

The pin is not a shrug, because a ratchet holds it. MEASURED, at ddef657b:

```
$ python3 tools/kernel/js_gate_registration_gate.py
[js-gate-registration] *_gate.{js,mjs}: 11  unreached: 3  pinned: 3
    forge-kernel/test/cfd_ghia_gate.mjs   (pinned: PASSES; 641.5s (10.7 min) measured)
    forge-kernel/test/cfd_natconv_gate.mjs   (pinned: PASSES; 1612.5s (26.9 min) measured)
    forge-kernel/test/cfd_oblique_shock_gate.mjs   (pinned: PASSES; 299.4s (5.0 min) measured)
[js-gate-registration] GREEN — every JS gate reaches CI.
```

It goes red in **both** directions: a new unwired JS gate, and a pinned gate
that becomes reachable (so `ALLOW` cannot quietly become permanent). Its
`--selftest` runs five cases and MEASURED all five give the wanted verdict
(**16.7 / 17.6 / 17.1 s**, three runs): unwired gate RED, genuine wiring GREEN,
a comment naming it RED, a pinned gate becoming reachable RED, and a control
edit naming no gate GREEN.
It is wired at `.github/workflows/gate-registration.yml:238-239` and in
`tools/gates/preflight.sh:49`.

**Where the three have to go is not built.** There is no scheduled workflow and
no path filter anywhere in this repository: `grep -rn "^\s*schedule:"` and
`grep -rn "^\s*paths\(-ignore\)\?:"` over `.github/workflows/*.yml` return
**zero** hits across all three workflow files (`desktop-release.yml`,
`gate-registration.yml`, `kernel-tests.yml`). Wiring the heavy three needs a new
CI pattern, not a new gate.

---

## 3. The OCCT closure ledger — three gates, and the order is load-bearing

The tracker beside this file quotes `OCCT_CLOSURE` as the migration's single
score. Three steps in the `kernel` job defend it, in this order:

| step | script | assertion |
|---|---|---|
| `OCCT ledger ratchet (CLOSURE is the number; DIRECT is gameable)` | `forge-kernel/scripts/occt_closure_count.sh` | `--assert-closure 14 --assert-direct 9` |
| `OCCT libraries actually RESOLVE (the ledger number cannot be faked)` | `forge-kernel/test/occt_lib_resolution_gate.sh` | the closure is not fabricated by a missing library |
| `OCCT ledger gate — closure, PHANTOM and TKOffset symbols` | `forge-kernel/scripts/tkoffset_ledger_gate.sh` | `--max-closure 14 --max-phantom 2 --max-tkoffset 42` |

The middle one runs before the ceilings for a measured reason recorded in its
own header: the closure is a BFS that expands a dependency only if it resolves
to a real file, so ONE unresolvable `libTK*` truncates the search at the binary
and the closure collapses onto the gameable direct count — **14 → 8, exit 0, no
warning**. A Homebrew upgrade or a host without OCCT would each have "improved"
the number the programme is scored by.

MEASURED here against `forge-kernel/build/Release/forge-kernel.node` (the binary
built in this worktree; OCCT 7.9.3 per the bench banner):

```
  OCCT_DIRECT  = 9    (LC_LOAD_DYLIB/DT_NEEDED records — gameable, NOT the ledger number)
  OCCT_CLOSURE = 14   ★ libraries that actually LOAD at run time — THE LEDGER NUMBER
  OCCT_PHANTOM = 2    (closure libs whose symbols the binary CALLS with no link record)
```

- direct (9): TKBRep TKernel TKFillet TKG3d TKMath TKOffset TKPrim TKShHealing TKTopAlgo
- closure (14): the above plus TKBO TKBool TKG2d TKGeomAlgo TKGeomBase
- `tkoffset_ledger_gate.sh … --max-closure 14 --max-phantom 2 --max-tkoffset 42`
  → `TKOffset syms = 42 (ceiling 42)`, `PASS — every ceiling held`, rc 0.
- `occt_lib_resolution_gate.sh` → `7 passed, 0 failed`, including T2 (a
  relocated OCCT must exit 2 and print NO closure number) and T4 (identical
  14-toolkit census on a 7.9.x tree and on a fabricated 9.9 tree).

These agree, exactly, with the `OCCT removal tracker` beside this file and with
`MIGRATION.md`: 14 dylibs in the bundle, 6 toolkits linked by the shipped
binaries.

### One number in the tree disagrees with itself

`kernel-tests.yml:707` says the two phantoms are `TKBO 32 symbols, TKG2d 24`.
MEASURED on this tree's binary: TKBO **32**, TKG2d **27**.

**A committed census already agrees with the measurement and not with the
comment.** `forge-kernel/reports/OCCT_TOOLKIT_SYMBOL_CENSUS_2026-09-04.md` is a
per-toolkit called-symbol census taken from ONE named binary — the 9,425,344-byte
`.node` built by CI on PR #232 — and it records **TKG2d 27**, TKBO 32, TKOffset
42, and 541 distinct symbols across the fourteen toolkits, with `called` ==
`uniquely attributed` on every row. That is not the binary built in this
worktree, so `27` now stands on two independently-built binaries against the
comment's `24`: the comment is the outlier, and it is simply stale.

That census also **settles** the two figures the workflow comment calls
contested: TKTopAlgo is **110**, not 106, and TKMath is **32**, not 31. (That
warning lives in the workflow comment at `kernel-tests.yml:734-737`, not in the
tracker beside this file — grepping `OCCT_REMOVAL_TRACKER.md` for
`census|110|106` returns no such line.)

So what is missing is **not the census — it is a gate over it.** Nothing catches
per-toolkit drift, or a comment going stale: the ledger gate asserts only the
phantom *count* (≤ 2) and `TKOffset`'s symbol count (≤ 42), and no workflow, no
`package.json` script and no `tools/gates/` entry runs
`tools/occt_symbol_census.sh` (grep over all three → zero hits). A per-toolkit
number quoted in *prose* is therefore still unpinned — but the reference to
check it against exists and is committed, so re-measure against that file rather
than taking a fresh census. The workflow comment at that line asks for exactly
this census "in a follow-up"; the follow-up landed and the comment was never
updated to say so.

`--assert-no-phantom` is deliberately not set, so a *new* phantom is reported by
the ceiling (`--max-phantom 2`) rather than by name.

---

## 4. Performance — measured, printed, and NOT gated

There is **no performance regression gate in this repository.** That is a
statement about enforcement, not about instrumentation: performance IS measured
on every CI run, and the numbers are printed for a human to read.

`forge-kernel/test/bench_100k.js` runs inside `npm run forge:kernel:test` — a
26-entry chain (counted by splitting the `forge:kernel:test` script on `&&`),
invoked by the `Kernel smoke suite` step of the `kernel` job. MEASURED here,
whole script **0.34-0.35 s** wall, rc 0. Every row is the RANGE over repeated
runs, not one sample, because a single sample of this script is
contention-sensitive: an earlier single run of it on this same box at this same
SHA read `addInstance` at 73.2 ms, more than twice anything in the nine runs
below.

| operation | scale | measured (range over N runs) | N |
|---|---|---:|---:|
| `addInstance` | 100,000 | 32.9-34.5 ms (0.33-0.34 µs each) | 9 |
| `buildBvh` | 100,000 prims | 15.8-16.4 ms | 9 |
| `queryAABB` (BVH) | 100k | 0.004-0.005 ms | 6 |
| `queryAABB` (linear, BVH dirty) | 100k | 0.25-0.35 ms | 6 |
| `queryRay` column | 100k | 0.006-0.011 ms | 6 |
| `updateTransform` × 1000 | 90k live | 0.4 ms (0.36-0.37 µs each) | 6 |
| `buildBvh` | **500,000** | **83.4-86.4 ms** (target < 200 ms) | 9 |
| `queryAABB` (tiny cube) | 500k | 0.009-0.011 ms (target < 0.2 ms) | 6 |
| `queryFrustum` | 500k, all hit | 3.06-3.19 ms (target < 5 ms) | 6 |
| `queryRay` | 500k | 0.017-0.025 ms | 6 |
| resident | 100k instances | 18.3 MiB (identical every run) | 6 |

The spread is the point, not a caveat. Each timed section is a few milliseconds
of wall clock on a shared workstation, so the honest form of any row here is an
interval; a single number quoted from one run of this script can be 2× off with
nothing wrong in the kernel — the same lesson §1's three wall-clock samples
record.

Why "not gated", precisely:

- Of the three targets, only `buildBvh < 200 ms` is compared in code
  (`bench_100k.js:170`) and a miss prints `WARN` — it does not set an exit code.
- `process.exitCode = 1` appears **once** in the file (line 130) and it is a
  *functional* check: `updateTransform` on a removed handle must throw.
- The file's other three assertions are `console.assert`, which in Node prints
  `Assertion failed` and leaves the exit code at 0. Verified:
  `node -e 'console.assert(false,"boom")'` → `node rc=0`.

So the only automatic wall-clock enforcement anywhere in kernel CI is a
**timeout**: per-job `timeout-minutes` (native 120, kernel 75, desktop 30, ui
45, …), the native suite's per-test `TEST_TIMEOUT=300`, and the guardian gate's
own `GATE_BUDGET: '1080'`. A timeout catches a hang. It does not catch a 3×
slowdown, and nothing else will either.

---

## What is NOT built — plainly, so nobody schedules it twice

- **No performance regression gate.** See §4. Budgets exist as comments and as
  one `WARN`; none fails a build.
- **The three heavy CFD gates never execute in CI.** They pass when run by hand
  (per their pins); CI has not run them, and there is no scheduled or
  path-filtered job to put them in.
- **`forge-kernel/test/physics_validation_harness.mjs` reaches no workflow.**
  The only executable that names it is `forge-kernel/BUILD_AND_VERIFY_RIGOR.sh`,
  and `git ls-files | xargs grep -ln BUILD_AND_VERIFY_RIGOR` finds it named by
  no workflow either (only by itself, the harness, the zero-JS manifest and a
  deletion-inventory tool). It is not a JS *gate* by filename, so the ratchet in
  §2 cannot see it.
- **No GATE over the per-toolkit OCCT symbol census.** The census itself EXISTS
  and is committed (`forge-kernel/reports/OCCT_TOOLKIT_SYMBOL_CENSUS_2026-09-04.md`,
  one named binary, 541 symbols, TKG2d 27) — do not take it again. What is absent
  is any workflow, npm script or preflight entry that runs
  `tools/occt_symbol_census.sh` and compares, so a per-toolkit number can drift or
  a comment go stale unseen. See §3.
- **The native suite carries no OCCT differential**, by design.

## What IS built — do not rebuild it

Under-claiming here costs as much as over-claiming, so, explicitly:

- **142 native gates exist and pass**, covering far more than B-rep: `fea`,
  `em`, `linalg`, `cam`, `materials`, `composites`, `am`, `surfit`, `tolstack`,
  `vvuq`, `viz` and `storage` all have gates in the pure-C++ suite. Physics
  coverage is not confined to the `.mjs` gates.
- **Ten gates in the physics-validation family exist**, seven of them wired:
  CalculiX I/O, Sod, species transport, electrostatics, Joule coupling,
  magnetostatics and the setback guard run in CI; oblique shock, Ghia cavity and
  natural convection are written and passing but pinned out. None of them needs
  writing again. Two further known-answer FEA steps run in the same job and are
  separate from those ten: `Tet4 element convergence vs Lame exact solution`
  (`fea_tet4_convergence.mjs`) and the `NAFEMS known-answer accuracy ratchet`
  (`fea_nafems_ratchet.sh`, which is how the eleventh `*_gate.mjs`,
  `fea_nafems_gate.mjs`, reaches CI).
- **The OCCT ledger has three gates, not one**, including a resolution gate that
  proves the ledger number cannot be faked by a missing library, and all three
  are wired.
- **The gates that check the gates exist**: `check_includes.sh --self-test` (13
  controls), `js_gate_registration_gate.py --selftest` (5 cases, both
  directions), `setback_clearance_gate.mjs --selftest` (12-check control, 6
  mutations), `occt_lib_resolution_gate.sh` (7 checks incl. two physically
  reproduced failure modes).

## House rule this document is held to

Every number above names the command or the file:line that produced it, and a
number this document did not re-run is labelled a pin. The failure this repo
keeps hitting is not a wrong number — it is a *stale* one that reads as current.
Re-measure at the SHA in the heading before quoting anything here.
