# HARDWARE_BUDGET.md — Forge (archdisc-Mech) on the real machine

> **Honesty contract (Forge Engineering Bible 0/9):** Every number below is either
> **MEASURED** (a real command was run on this machine on the date shown and the raw
> output is quoted) or **ESTIMATED** (a derived/typical figure I could not measure
> directly — explicitly flagged). Nothing here is fabricated. Where a claim is not
> yet built or not verifiable, it is marked **TODO** / **UNVERIFIED**.
>
> **Measured on:** 2026-06-20 ~17:24 local, host `Mac16,9` (serial LDQ7N9HD21).
> Reproduce with the commands quoted in each section.

---

## 1. Machine identity (MEASURED)

Command: `system_profiler SPHardwareDataType`

```
Model Name:          Mac Studio
Model Identifier:    Mac16,9
Chip:                Apple M4 Max
Total Number of Cores: 14 (10 Performance and 4 Efficiency)
Memory:              36 GB
```

Command: `sysctl -n hw.memsize hw.ncpu hw.perflevel0.physicalcpu hw.perflevel1.physicalcpu`

```
hw.memsize                 = 38654705664   (= 36.0 GiB exactly)
hw.ncpu                    = 14
hw.perflevel0.physicalcpu  = 10            (Performance / P-cores)
hw.perflevel1.physicalcpu  = 4             (Efficiency / E-cores)
```

Command: `system_profiler SPDisplaysDataType | grep -iE 'chipset|cores|metal'`

```
Chipset Model:    Apple M4 Max
Total Number of Cores: 32   (GPU cores)
Metal Support:    Metal 4
```

> **IMPORTANT CORRECTION (MEASURED):** This box has **36 GB unified memory**, not the
> larger figure assumed in some prior session notes. `hw.memsize = 38654705664 bytes
> = 36.0 GiB`. All budgets below are sized to **36 GB**, and the unified-memory
> contention warning in the project memory ("Mac OOMs when training + serve + Electron
> + Vite + agents stack") is therefore *more* binding than on a larger box, not less.

---

## 2. Measured availability table

| Resource | Total (MEASURED) | In use now (MEASURED) | Headroom now (MEASURED) | Source command |
|---|---|---|---|---|
| Unified memory (RAM=VRAM) | 36.0 GiB (38,654,705,664 B) | active+wired ≈ **18.76 GiB** | inactive+spec+free ≈ **16.66 GiB** reclaimable | `sysctl hw.memsize`; `vm_stat` |
| Swap | 0 B configured/used | **0.00 MB used** | n/a (dynamic) | `sysctl vm.swapusage` |
| Memory pressure | — | **91% free system-wide** (green) | — | `memory_pressure` |
| CPU cores | 14 (10 P + 4 E) | see §6 top procs | — | `sysctl hw.ncpu …` |
| GPU cores | 32 (M4 Max) | not directly sampled | — | `system_profiler SPDisplaysDataType` |
| Boot/root volume `/` | 460 GiB | 12 GiB | **159 GiB avail** | `df -h /` |
| Data volume `/System/Volumes/Data` | 460 GiB (shared APFS container) | **280 GiB** | **159 GiB avail** | `df -h` |

`vm_stat` raw (page size **16384 B**), used to compute the memory row:

```
Pages free:        59044     Pages active:    1025146
Pages inactive:    717651    Pages speculative: 314936
Pages wired down:  204513    Pages occupied by compressor: 0
```
Derivation (`(active+wired)*16384` and `(free+spec+inactive)*16384`):
`active+wired = 18.76 GiB`, `reclaimable ≈ 16.66 GiB`, `sum ≈ 35.42 GiB` (rest is
kernel/firmware reserve below the 36 GiB nameplate). — MEASURED + arithmetic.

`df -h` note: the 460 GiB APFS container is **shared**; `/` shows 12 GiB used but the
real consumer is `/System/Volumes/Data` at **280 GiB used**, leaving **159 GiB free**
container-wide. The 159 GiB free is the single number that matters for storage budget.

### GPU / Metal working-set cap (MEASURED, with caveat)

Command: `sysctl iogpu.wired_limit_mb` → **`0`**.
`0` = "use the OS default." On Apple Silicon the default Metal recommended working set
is **~75% of unified memory** (≈ **27 GiB** of 36 GiB) and is raisable via
`sudo sysctl iogpu.wired_limit_mb=<N>`. The 75% figure is the documented Apple Silicon
default, **ESTIMATED here** (not separately measured on this box — I did not query
`recommendedMaxWorkingSetSize` via a Metal program). Treat **~27 GiB** as the soft GPU
ceiling unless the limit is explicitly raised.

---

## 3. What is actually installed (MEASURED disk footprint)

Commands: `du -sh …`

| Artifact | Size on disk | Path (real) |
|---|---|---|
| Forge repo total | **5.9 GiB** | `/Users/account_clawteam1/archdisc-Mech` |
| `forge-kernel/` total | **76 MiB** | `…/forge-kernel` |
| Native kernel binary | **4.8 MiB** | `…/forge-kernel/build/Release/forge-kernel.node` |
| `node_modules/` (Forge) | **674 MiB** | `…/node_modules` |
| Models repo total | **138 GiB** | `/Users/account_clawteam1/archdisc-Models` |
| → model weights | 60 GiB | `…/archdisc-Models/models` |
| → datasets | 65 GiB | `…/archdisc-Models/data` |
| → LoRA adapters | 11 GiB | `…/archdisc-Models/adapters/archie` |

Individual weight sizes (MEASURED, `du -sh models/*`):

| Weight | Size | Note |
|---|---|---|
| `archie-7b-base-4bit` | **4.0 GiB** | the deployable Forge/Archie LM (4-bit MLX) |
| `archie-7b-base-bf16` | 14 GiB | full precision (training/merge only) |
| `qwen2.5-vl-7b-bf16` | 15 GiB | VLM (vision pipeline) |
| `hermes-3-8b-4bit` | 4.2 GiB | alt base, 4-bit |
| `archie-1.5b-verifier-4bit` | 965 MiB | verifier/critic |
| `archie-draft-1b-4bit` | 680 MiB | speculative-decode draft |

> **TODO / UNVERIFIED:** `forge-kernel.node` links OCCT 7.9.3 natively per project memory;
> I confirmed the **4.8 MiB** `.node` exists and the repo builds the kernel, but I did
> **not** measure OCCT's resident/shared-lib memory at runtime in this session — that
> requires loading the kernel and sampling RSS (see §7 method). Marked TODO.

---

## 4. Runtime state right now (MEASURED)

Command: `pgrep -fl mlx_lm` → **exit 1, no match.** The MLX-LM model server is **NOT
running** at measurement time, so **0 GiB** of the 36 GiB is currently held by model
weights. The 18.76 GiB in use is Chrome (the largest single renderer alone is ~2.1 GiB
RSS, `%MEM 5.7`), WindowServer, Safari/WebKit, Spotlight, and this `claude` process
(~822 MiB RSS). See §6.

Implication: **a fresh `mlx_lm.server` load of the 4-bit 7B (~4–6 GiB resident, est.)
fits comfortably right now** — but only because no Electron/Vite/training is also live.

---

## 5. Per-subsystem budget (target allocation of the 36 GiB) + local-vs-cloud call

Sizing rule: keep **active+wired ≤ ~27 GiB** (the ~75% Metal soft cap) and leave
**≥ 6 GiB** OS/desktop headroom. "Resident" figures are ESTIMATED unless flagged.

| Subsystem | Budget (of 36 GiB) | Basis | Local vs Cloud | Why |
|---|---|---|---|---|
| **OS + desktop + Chrome/Electron shell** | ~8–10 GiB | MEASURED baseline 18.76 GiB in use today is mostly this; trim Chrome before heavy runs | **Local** (fixed cost) | Unavoidable resident overhead. |
| **Forge model weights (Archie 7B 4-bit)** | **4–6 GiB resident** | disk = 4.0 GiB (MEASURED); +KV cache & runtime overhead (ESTIMATED) | **Local** | Fits; private; offline; the whole product thesis is on-device. |
| **+ verifier 1.5B-4bit / draft 1B-4bit (optional)** | +1–1.7 GiB | disk 965 MiB + 680 MiB (MEASURED) | **Local, optional** | Drop these first under pressure. |
| **VLM (qwen2.5-vl-7b)** | bf16 = 15 GiB on disk (MEASURED); 4-bit TODO | only the bf16 exists today | **Local only when nothing else heavy is live; else defer** | 15 GiB bf16 + LM + Electron will OOM 36 GiB. No 4-bit VLM built yet → **TODO**. |
| **Native kernel process (OCCT / forge-kernel.node)** | **2–4 GiB** working set | binary 4.8 MiB (MEASURED); runtime RSS **UNVERIFIED/TODO** | **Local** | BRep/STEP must be exact + native; cloud round-trips kill interactivity. |
| **Meshing (tessellation for viewport / FEA mesh)** | **1–4 GiB** | scales with element/triangle count; flagship targets ~20k components → millions of tris | **Local for interactive; Cloud for very large batch meshes** | 107k-component env (memory note) already stresses RAM; batch jobs are the first cloud-offload candidate. |
| **Viewport (Three.js / Electron renderer GPU)** | **2–6 GiB** GPU-resident (shared) | scales with instanced geometry; flagship envs hit 100k+ instances | **Local** | Realtime; uses unified mem as VRAM (≤ ~27 GiB Metal cap). |
| **Simulation (in-house FEA / SIMP / CFD)** | **4–12 GiB** depending on DOF | dense solves blow up fast; HHT-α multibody + Wilson-Q6 FEA per `FORGE_PHYSICS_VERIFICATION.md` | **Local for small/medium; Cloud for large 3D FEA & turbulent CFD** | Large sparse/dense solves exceed a shared 36 GiB; turbulent CFD is the known open gap (mech project memory). |
| **Training / LoRA fine-tune** | **~26 GiB peak** (MLX-VLM) | peak from `mlx-vlm-eager-rope-fix` memory note (ESTIMATED, that note's figure) | **Local ONLY when serve + Electron + Vite are all stopped** | Single-heavy-step rule (memory: `feedback-hardware-calm`). Otherwise **Cloud**. |

### Explicit local-vs-cloud decisions (one line each)

- **Inference (Forge/Archie 7B 4-bit): LOCAL.** 4 GiB weights fit; on-device is the product.
- **VLM at bf16: LOCAL but mutually exclusive** with a live Electron+LM stack on 36 GiB → run alone, or build a 4-bit VLM (**TODO**).
- **OCCT kernel (BRep/STEP/STEP-exact): LOCAL, always.** Exactness + latency demand native.
- **Interactive meshing + viewport: LOCAL.** Batch/oversized meshing: **CLOUD** offload candidate.
- **Small/medium FEA & multibody: LOCAL** (validated per physics doc). **Large 3D FEA + turbulent CFD: CLOUD** (the latter is also an unsolved-accuracy item).
- **LoRA / full-precision training: LOCAL only in isolation** (≈26 GiB peak vs 36 GiB), else **CLOUD**. Never concurrent with serve/Electron/Vite.

---

## 6. Top memory consumers right now (MEASURED)

Command: `ps aux | sort -rk4 | head` (RSS column)

| Process | %MEM | RSS | Note |
|---|---|---|---|
| Google Chrome Helper (Renderer) | 5.7 | **2.15 GiB** | single tab/renderer — biggest single hog |
| WebKit WebContent (Safari) | 3.4 | 1.29 GiB | |
| `claude` (this agent) | 2.2 | 822 MiB | |
| Spotlight / corespotlightd | 1.1 / 0.7 | 411 / 254 MiB | indexing |
| WindowServer | 0.8 | 299 MiB | desktop compositor |

> Takeaway: ~**4–5 GiB is recoverable just by quitting Chrome + Safari** before a heavy
> model or training run. Do this as step 1 of any local heavy step.

---

## 7. Method to close the TODOs (so they aren't left as guesses)

These figures are flagged ESTIMATED/UNVERIFIED above; here is how to make them MEASURED:

1. **mlx_lm 7B-4bit resident:** start `serve_archie_*.sh`, then
   `pgrep -fl mlx_lm` and read RSS from `ps -o rss= -p <pid>` (÷1024/1024 → GiB).
2. **forge-kernel.node runtime RSS:** launch Electron/the kernel host, find its PID,
   sample `ps -o rss=` before/after loading a flagship; the delta is the OCCT working set.
3. **Metal recommendedMaxWorkingSetSize:** read it from a Metal device query
   (or trust the ~75% default = ~27 GiB until then).
4. **Meshing/sim peaks:** sample `footprint <pid>` (or `ps` RSS) during a known
   flagship build (GE9X ~20k components) and a representative FEA solve.

Until each is measured, the corresponding row stays explicitly ESTIMATED — per the
honesty contract, a stated "UNVERIFIED" beats a fabricated precise number.

---

## 8. Bottom line (MEASURED facts that constrain everything)

- **36 GiB unified** (not more) — the binding constraint; ~27 GiB usable by GPU/Metal.
- **159 GiB free** on the 460 GiB volume; Models repo alone is **138 GiB** — storage is
  the *second* tight resource. Dataset ingest must stay download→process→delete
  one-at-a-time (mech/models memory) or this fills.
- **0 swap, 91% memory-free, no mlx_lm running** at measurement — so there is room *now*,
  but only one heavy subsystem (train **or** serve-VLM **or** big-sim) fits at a time.
- The "calm hardware / one heavy step" rule is **confirmed by measurement**, not folklore.
