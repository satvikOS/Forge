# T-171 — negative controls for the JS deadness gate, and the residual it certifies

Measured 2026-09-18 on `origin/archdisc` @ `6d70a777` (the merge of #278).

## 1. The gate has six checks

| check | refuses an input that… |
|---|---|
| C1 `NOT_IMPORTED` | is named by a resolvable module specifier in some file **outside the deletion set** |
| C2 `NOT_IN_BUNDLE` | appears in the Rollup module census of the shipped bundle (`scripts/js_live_bundle.txt`) |
| C3 `NOT_TEST` | lives under a test/fixture path — a test is entered by a **runner**, so "nothing imports it" is not evidence of death |
| C4 `NOT_TOOL_ENTRY` | matches a tool-entry pattern (`*.config.js`, `frontend/public/`, `electron/`, `playwright.config.js`) **or** whose path/basename is named by any CI/config/shell/JSON file |
| C5 `NOT_MENTIONED` | has its basename (or quoted stem) appear in any non-markdown file outside the set — string-keyed dispatch |
| C6 `NOT_RESEARCH` | lives under a research/corpus/benchmark asset path |

## 2. Isolation — `node scripts/js_deadness_controls.mjs --mutate`

The pre-existing `--selftest` carries twelve **positive** controls (live files that must
be refused). `--audit` shows eleven of the twelve are refused by three or four checks at
once; exactly **one** had `sole? = yes`. That is the hole: one broad check (C5, firing on
11 of 12) carried nearly every control, so all six check bodies could be deleted with the
selftest still green.

T-171 adds **negative** controls: per check, an input that check **and only that check**
refuses. C4 is split because it has two independent clauses.

| check | probe | refused by | sole? | flips when disabled? | mutant kills only its own control? |
|---|---|---|---|---|---|
| C1 | `zz<R>_c1.js` + importer using an **extension-less** specifier | C1 | **yes** | yes | yes |
| C2 | `zz<R>_c2.js`, present only in a substituted census | C2 | **yes** | yes | yes |
| C3 | `zz<R>_c3.test.js` | C3 | **yes** | yes | yes |
| C4a | `zz<R>_c4a.config.js` (pattern clause) | C4 | **yes** | yes | yes |
| C4b | `<dir>/main.js` + a JSON naming `main.js` (named-by-config clause) | C4 | **yes** | yes | yes |
| C5 | `zz<R>_c5.js` named as a bare string, never imported | C5 | **yes** | yes | yes |
| C6 | `zz<R>_c6corpus.js` | C6 | **yes** | yes | yes |

**6 of 6 checks isolated (7 of 7 controls).** None is multiply-refused.

### Why C1 needed an extension-less importer

Any ordinary `import './Foo.js'` puts the basename `Foo.js` into the importer's text, so
C5 fires too and C1 is unisolable. An extension-less specifier is resolved by the gate's
`resolveSpec` but is invisible to a substring search. **C1 and C5 are separable only
through that gap.**

### Why C4's second clause needed a generic basename

For a *distinctive* basename, "named by a config" is a strict subset of "mentioned in a
non-markdown file" — C4b is then structurally inseparable from C5. It is isolable only
where C5 treats the basename as generic (`index|main|utils|types|constants|helpers`) and
switches to `<parent>/<base>`. Isolating the clause is also the measurement that shows it
is **over-broad**: it matches a *bare basename*, so one config saying `main.js` pins every
`main.js` in the repository. That is safe for a deletion gate (false positives only refuse
more) but it is why `electron/main.js` fires C4b.

### The seam cannot weaken a real run

`--only=`/`--without=` exist for this harness. With any check disabled the gate prints
`*** CHECKS DISABLED — THIS RUN CANNOT CERTIFY ANYTHING ***`, never writes `GATE_OUT`,
and exits **4** instead of 0. Verified: `GATE_OUT` file was not created.

### The harness was falsified in both directions

- A mutant whose needle matched nothing → `*** NO SUBSTITUTION — this mutant ran the unmutated gate ***`, `controls: RED`, rc=1. (A mutation round that silently runs unmutated source is the classic blind gate.)
- Breaking C5's generic-basename branch → C4b becomes `C4,C5`, `sole? = **no**`, `flips = **no**`, `isolation: 6/7`, rc=1. Gate restored byte-identically (SHA-256 `d8e3728…`).

So `sole?` and `flips` can both say *no*; they are not `return true`.

### The instrument is not in the corpus it measures

The old defect: the gate's control list names paths, and C5 counted those names as live
references, so the gate kept files alive by reading itself. A blocklist (`SELF_REFS`) fixes
that instance and not the next one. Every probe basename here carries a **random per-run
token**, so no tracked file — this harness included — can contain it as a literal. The
harness *asserts* this at runtime and fails on `*** INSTRUMENT READS ITSELF ***`. Measured:
clean; the only file naming a probe is the aux file written to make it so.

The fixture is added to the **real** repository and removed again; it hardcodes nothing
about the repo's inventory, so adding a real check can never turn its green control red.

## 3. The residual: iterate to a fixed point

Candidates: all 844 tracked `.js/.jsx/.mjs/.cjs` files under `frontend/src/`.

```
iter 1:  844 in →  188 certified,  656 refused
iter 2:  188 in →   98 certified,   90 refused
iter 3:   98 in →   69 certified,   29 refused
iter 4:   69 in →    5 certified,   64 refused
iter 5:    5 in →    0 certified,    5 refused
iter 6:    0 in →    0 certified          FIXED POINT (6 iterations)
```

**0 files certified deletable. 844 refused.** Denominator: 844 of 844.

Refusal reasons at the fixed point (`--set` empty = strictest; a file may have several):

| check | refuses | is the sole reason for |
|---|---|---|
| C1 | 746 | 13 |
| C2 | 553 | 0 |
| C3 | 49 | 43 |
| C4 | 2 | 0 |
| C5 | 787 | 49 |
| C6 | 0 | 0 |

C2's 553 is the entire bundle census: **every** census entry is under `frontend/src/`,
so 553 of the 844 are in the shipped artifact and 291 are not. C6 fires on nothing here —
its domain is `projects/`, `data/`, `implementation/`, which the boundary excludes.

### The fixed point is what makes this safe

A **one-pass** run says 188 are deletable. Three of those 188, re-scored at the fixed point:

```
frontend/src/assets/environments/abiotic/index.js
  C1: imported by frontend/src/systems/EnvironmentSystem.js
frontend/src/assets/environments/biotic/index.js
  C1: imported by frontend/src/systems/EnvironmentSystem.js
frontend/src/ai/autonomous/Perception.js
  C5: named by frontend/src/ai/VisionPerception.js, frontend/src/forge-v4/ForgeShellV4.jsx  (both in the shipped bundle)
```

Deleting the one-pass set would have removed files imported by code that survives. The
iteration is a **greatest**-fixed-point computation: both SET-dependent predicates (C1's
importer filter, C5's mention filter) refuse *more* as SET shrinks, so starting from the
full candidate set and shrinking converges to the largest self-consistent dead cluster.
It converged to the empty set: **no non-empty dead cluster exists under `frontend/src/`.**

### Where the remaining leverage is

49 non-bundled files are pinned by C5 alone — a string mention and nothing else. Those
mentions come from `frontend/src` (67), `e2e` (12), `forge-kernel` (9), `forge-desktop` (4),
`implementation` (1). Among them are the flagship demo builders (`turbofanBuilder.js`,
`planetaryGearboxToolSequence.js`). **These were not relaxed away.** An `e2e` or
`forge-kernel` mention is exactly the runtime entry no import graph can see — the refusal
class that saved `DrawingsWorkbench.jsx` and 11 modules in #278.

## 4. Deletions: none

Nothing was deleted, so there is nothing to recover. `git status` shows `frontend/` is
untouched (0 entries) and `scripts/js_live_bundle.txt` is byte-identical to
`origin/archdisc`. **Live bundle: 553 → 553 entries**, unchanged by construction — no
bundle input changed. The census was not independently regenerated: `frontend/node_modules`
is absent and `vite.config.census.mjs` needs a full dependency install.

The mirror test still passes — the gate certifies a genuinely dead probe (rc=0), so it has
not degenerated into "always refuse":

```
printf 'export const p = () => 42;\n' > frontend/src/__probe_mirror.js
git add -f frontend/src/__probe_mirror.js
node scripts/js_deadness_gate.mjs frontend/src/__probe_mirror.js   # certified, rc=0
```

`--selftest` 12/12, `--audit` 12/12 + 6/6 discrimination, both rc=0 after the hardening.
