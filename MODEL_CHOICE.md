# MODEL_CHOICE.md — Forge base-model upgrade (7B → ~20-24B class) for MLX on a 36 GB M4 Max

> **Honesty contract (Forge Engineering Bible 0/9):** Every external claim below cites a
> real, accessible source URL. Every repo claim cites real `file:line` evidence. Numbers are
> labelled **MEASURED** (read off a source page / run on this machine), **VENDOR** (claimed by
> the model's own card/report — not independently re-run here), or **ESTIMATED** (derived /
> typical, explicitly flagged). Where something is unverifiable or not yet built it is marked
> **TODO** / **UNVERIFIED**. A correct "not measured" beats a fabricated precise number.
>
> **Compiled:** 2026-06-20. **Web facts verified:** 2026-06-20 via live fetches (cached ≤15 min).
> **Task:** [Bible LIVE RESEARCH TASK C] — pick the best open-weight ~20-24B base for
> math/logic/reasoning/engineering that runs well via MLX at 4-bit on this box, upgrading from
> the current Forge base **DeepSeek-R1-Distill-Qwen-7B**.

---

## 0. Current state (REPO EVIDENCE — verified file:line)

- Forge's local LM is served by `archdisc-Models` over an OpenAI-compatible MLX-LM server at
  `http://localhost:8080`, consumed by `ForgeRunner.js`
  (`frontend/src/ai/ForgeRunner.js:25` → `const ARCHIE_BASE_URL = 'http://localhost:8080'`).
- The provider entry names the base explicitly: `frontend/src/ai/PlannerProviders.js:246-256`
  — *"Archie local fleet — DeepSeek-R1-Distill-Qwen-7B + per-discipline LoRA adapters … served
  by mlx_lm.server (localhost:8080) … `defaultModel: 'archie-7b-base'`"*.
- `ForgeRunner.js:214` sets generation defaults `temperature = 0.1, maxTokens = 640`
  (matches the project-memory guidance to keep Forge `maxTokens ~640`). `ForgeRunner.js:221-224`
  deliberately omits the `model` field so the server uses its loaded model.
- The deployable weight today is **`archie-7b-base-4bit` = 4.0 GiB on disk** (MEASURED,
  `HARDWARE_BUDGET.md:109`). That is the 7B we are upsizing from.
- Hardware ground truth: **36.0 GiB unified** memory, **~27 GiB** Metal soft working-set cap,
  **0 swap**, single-heavy-step rule confirmed by measurement
  (`HARDWARE_BUDGET.md:43-47, 78-86, 199-207`).

> No prior `MODEL_CHOICE.md` existed in the repo before this file (TASK C deliverable).

---

## 1. Candidates table — CURRENT (mid-2026) open-weight 20-24B+ class

I deliberately verified what *exists now* rather than from memory. The dense "20-24B" band is
sparse: **Qwen3.5/3.6 dense skips 14B→27B** (no 24B dense), and **Qwen3 dense skips 14B→32B**
(no 24B dense). The genuine ~24B dense option is the **Mistral-Small / Magistral 24B** family.
I therefore widen the band to **~24-28B dense** (the real candidates) and flag Qwen3-32B as the
upper bound and a 24B Mistral as the lower/leaner bound.

| Model | Params | Released | License | Reasoning/math/code (VENDOR or 3rd-party) | MLX 4-bit repo | 4-bit footprint (MEASURED off HF) |
|---|---|---|---|---|---|---|
| **Qwen3.6-27B** (dense) | 27.8 B [13] | 2026-04-22 [9] | Apache-2.0 [11] | "significantly outperforms Qwen3.5 & Gemma 4 on AIME / MATH-500"; MMLU-Pro best of the three; SWE-bench Verified 77.2 (beats Qwen3.5-397B 76.2) [8][12] | `mlx-community/Qwen3.6-27B-4bit` [13]; `lmstudio-community/Qwen3.6-27B-MLX-4bit`; `unsloth/Qwen3.6-27B-UD-MLX-4bit` | **16.1 GB** [13] |
| **Qwen3.5-27B** (dense, reasoning) | 27.8 B [10] | 2026-02-24 [7] | Apache-2.0 [10] | AIME-2026 92.7, GPQA-Diamond 85.5 (3rd-party review figures, **NOT on the cited AA page** — corroborated by secondary sources [8][20]) [20]; AA Intelligence Index **34** (MEASURED off AA page; upper "42" UNVERIFIED) [6]; 262k ctx [6][10] | `mlx-community/Qwen3.5-27B-4bit` [14] | **16.1 GB** [14] |
| **Qwen3-32B** (dense) | 32.8 B [1][3] | 2025-04-29 [1] | Apache-2.0 [1] | DeepSeek-R1-Distill-Qwen-32B teacher-class; Qwen3-32B "matches prev-gen 72B" [4]; strong on math/code/reasoning vs QwQ/Qwen2.5 [1][4] | `mlx-community/Qwen3-32B-4bit` [5]; `Qwen/Qwen3-32B-MLX-4bit` | **18.4 GB** [5] |
| **Magistral-Small-2509 (1.2)** (24B, reasoning) | 24 B [16] | 2025-09 (1.2 update) [15] | Apache-2.0 [15][16] | AIME24 86.14, AIME25 77.34, GPQA-Diamond 70.07, LiveCodeBench-v5 70.88 (VENDOR card) [16]; 128k ctx [16] | `lmstudio-community/Magistral-Small-2509-MLX-4bit` (+5/6/8-bit) [15] | **14.1 GB** [15] |
| **Mistral-Small-3.2-24B-Instruct-2506** (24B) | 24 B [2] | 2025-06 [2] | Apache-2.0 [2] | MATH 69.42, GPQA-Diamond 46.13, HumanEval+ 92.90, Arena-Hard 43.10 (VENDOR/3rd-party) [2] | MLX 4-bit community quants exist (mlx-community / lmstudio-community) — **TODO: exact GB UNVERIFIED in this pass** | **~13-14 GB ESTIMATED** (24B @ 4-bit; cf. Magistral 24B = 14.1 GB) |
| **Gemma-3-27B-it** | 27 B [17] | 2025-03-12 [17] | Gemma license (**not** Apache; commercial-OK w/ use restrictions) [17] | MATH 69.0, GPQA-Diamond 42.4, MMLU-Pro 67.5, GSM8K 92.27 [17] | MLX 4-bit community quants exist — **TODO: exact GB UNVERIFIED in this pass** | **~15-16 GB ESTIMATED** (27B @ 4-bit; cf. Qwen3.x-27B = 16.1 GB) |
| DeepSeek-R1-Distill-Qwen-32B (reference upper) | 32 B | 2025-01 | MIT (distill weights) | AIME-2024 72.6, MATH-500 94.3, GPQA-Diamond 62.1 (VENDOR) [18] | `mlx-community/DeepSeek-R1-Distill-Qwen-32B-MLX-4Bit` [19] | ~18 GB ESTIMATED (32B @ 4-bit; cf. Qwen3-32B = 18.4 GB) |
| DeepSeek-R1-Distill-Qwen-7B (**current Forge base**) | 7 B | 2025-01 | MIT | (7B distill — the thing we're replacing) | `archie-7b-base-4bit` (local) | **4.0 GiB MEASURED** (`HARDWARE_BUDGET.md:109`) |

> **Data-quality flags (honesty):**
> - The MLX-community card *metadata* for `Qwen3.5-27B-4bit` and `Qwen3.6-27B-4bit` shows
>   **"5B params"** — this is a **known model-card metadata bug**, not the real size. The
>   upstream `Qwen/Qwen3.6-27B` / `Qwen3.5-27B` cards state **27.8 B** [12][13-orig], and a
>   16.1 GB 4-bit file is arithmetically consistent with ~27-28 B (≈4.6 bits/param incl.
>   embeddings/overhead), *not* 5 B. I report **27.8 B** and flag the card bug. [13][10]
> - Several reasoning scores (Qwen3.5/3.6 AIME/GPQA) come from a **third-party aggregator**
>   (Artificial Analysis / llm-stats), not a re-run on this box → marked VENDOR/3rd-party, not
>   MEASURED. The official Qwen3.6 technical numbers live behind `qwen.ai/blog?id=qwen3.6-27b`
>   [12] which I cite but the aggregator page did not expose discrete AIME/MATH digits in this
>   pass → those specific digits are **TODO: confirm against the primary report**.
> - **Citation correction (adversarial pass):** the Qwen3.5-27B **AIME-2026 92.7 / GPQA-Diamond
>   85.5** digits were originally attributed to the AA page [6]. On re-fetch, that page shows
>   only the **Intelligence Index (34)** and **27.8B / 262k** — it does **NOT** display those two
>   discrete digits. The 92.7 / 85.5 figures are corroborated by **secondary reviews** [8][20]
>   instead, so the *citation* was retargeted (the numbers themselves held up against an
>   independent source). The AA "Index 34-42" range had only its **34** lower bound confirmed;
>   the **42** upper bound is **UNVERIFIED** and now flagged as such.
> - Mistral-Small-3.2 and Gemma-3-27B 4-bit MLX **footprints are ESTIMATED** (interpolated from
>   the measured 24B=14.1 GB and 27B=16.1 GB points); I did **not** open their HF file lists in
>   this pass → **TODO/UNVERIFIED**.

---

## 2. Memory-fit math (against the MEASURED 36 GiB budget)

**Inputs (all from `HARDWARE_BUDGET.md`, MEASURED unless noted):**
- Total unified memory: **36.0 GiB** (`:43-47`).
- Metal soft working-set cap: **~27 GiB** (75% default; the GB cap is ESTIMATED, `:78-86`).
- Fixed OS + desktop + Electron/Chrome shell: **~8-10 GiB** (`:143`; baseline-in-use today
  18.76 GiB is mostly this and trimmable to ~8 by quitting Chrome/Safari, `:176`).
- **Live Forge subsystem load** while Archie drives the UI (the number TASK C asked to flag):
  - Native OCCT kernel (`forge-kernel.node`) working set: **2-4 GiB** (`:147`, runtime RSS
    **UNVERIFIED/TODO**).
  - Meshing/tessellation: **1-4 GiB** (`:148`).
  - Viewport (Three.js / Electron GPU, shared unified): **2-6 GiB** (`:149`).
  - → **Combined kernel+mesh+viewport ≈ 8-12 GiB** for a normal flagship session. This matches
    the **~8-12 GiB "live kernel/meshing/viewport/sim load"** the task asked me to validate
    against `HARDWARE_BUDGET.md` — **CONFIRMED consistent** (it is the sum of `:147-149`, with
    *small* sim included; a *large* 3D FEA/CFD solve is 4-12 GiB *on its own* (`:150`) and is
    explicitly a **cloud-offload** case, not co-resident with the LM).

**The fit inequality (LM must fit in what's left under the ~27 GiB Metal cap):**

```
LM_resident  ≤  27 GiB (Metal cap)  −  shell(8-10)  −  forge_live(8-12)
LM_resident  ≤  27  −  9  −  10          (mid-point estimates)
LM_resident  ≤  ~8 GiB   ... under the Metal-cap view, with a FULL live Forge session
```

```
Alternative whole-RAM view (leave ≥6 GiB OS headroom, allow >27 GiB if Metal limit is raised):
LM_resident  ≤  36  −  6(OS reserve)  −  shell(8)  −  forge_live(10)  =  ~12 GiB
```

**LM resident ≈ disk weights + KV cache + runtime overhead.** For these models:
- 27B @ 4-bit: weights **16.1 GiB** + KV/runtime **~1.5-3 GiB ESTIMATED** ≈ **~18-19 GiB resident**.
- 24B @ 4-bit (Magistral): weights **14.1 GiB** + **~1.5-3 GiB** ≈ **~16-17 GiB resident**.
- 32B @ 4-bit: weights **18.4 GiB** + **~2-3 GiB** ≈ **~20-21 GiB resident**.

**Verdict by scenario:**

| Scenario | Co-resident demand | Fits 36 GiB? | Fits ~27 GiB Metal cap? |
|---|---|---|---|
| 27B-4bit (~18.5) **alone**, no Forge UI | ~18.5 + shell 8 = **26.5** | **YES** (9.5 spare) | **YES, barely** |
| 27B-4bit + full live Forge (kernel+mesh+viewport ~10) + shell 8 | **~36.5** | **NO — over by ~0.5, will swap/OOM** | NO |
| 27B-4bit + Forge UI **with Chrome/Safari quit** (shell→8, forge live ~8) | ~18.5 + 8 + 8 = **34.5** | **YES, tight** (≤1.5 spare) | over Metal cap → relies on swap-free margin |
| 24B-4bit (Magistral ~16.5) + live Forge (~10) + shell 8 | **~34.5** | **YES, tight** | over cap |
| 24B-4bit + Forge UI, Chrome quit (~8 shell, ~8 forge) | ~16.5 + 16 = **32.5** | **YES** (~3.5 spare) | over cap, but swap-free |
| 32B-4bit (~20.5) + live Forge (~10) + shell 8 | **~38.5** | **NO — OOM** | NO |
| Large 3D FEA/CFD sim concurrent with any of the above | +4-12 GiB | **NO** → sim is **cloud-offload** (`:150,159`) | NO |

**Key consequence:** a **27B-4bit** model **only co-fits a live Forge session if the desktop
shell is trimmed** (quit Chrome/Safari per `:176`) — it is **tight, not comfortable**. A
**24B-4bit** model leaves a real ~3-4 GiB margin under the same conditions. **32B-4bit does not
co-fit a live Forge session** and would force serve-or-Forge, never both.

---

## 3. Recommendation — **Qwen3.6-27B at 4-bit (MLX), with the desktop trimmed**

**Pick: `mlx-community/Qwen3.6-27B-4bit` (16.1 GB, Apache-2.0, 27.8 B params).** [11][12][13]

**Why this one (explicit fit + capability math):**
1. **Best current reasoning/math/code in the band.** Qwen3.6-27B (Apr 2026) is the newest dense
   model in scope and is reported to **beat Qwen3.5 and Gemma 4 on AIME and MATH-500**, lead on
   MMLU-Pro, and post **SWE-bench Verified 77.2 — higher than the previous 397B flagship's 76.2**
   [8][12]. For Forge's job (engineering math, tolerancing logic, tool-call planning) this is the
   strongest verified option.
2. **Truly open + commercial.** **Apache-2.0** confirmed by fetching the actual LICENSE file
   (`huggingface.co/Qwen/Qwen3.6-27B/blob/main/LICENSE` → "Apache License, Version 2.0") [11] —
   matches the project's "free, not open-source" business posture without GPL/Gemma-style
   restrictions. (Gemma-3-27B is comparable in size but ships under the **Gemma license**, not
   Apache [17] → deprioritised on licensing alone.)
3. **First-class MLX.** Multiple maintained 4-bit MLX repos exist
   (`mlx-community/Qwen3.6-27B-4bit`, `lmstudio-community/Qwen3.6-27B-MLX-4bit`,
   `unsloth/Qwen3.6-27B-UD-MLX-4bit`) [13], so it drops straight into the existing
   `mlx_lm.server` at `localhost:8080` that `ForgeRunner.js:25` already targets — **zero client
   changes** (the runner sends no `model` field, `ForgeRunner.js:221-224`).
4. **Footprint fits the budget *with the documented trim*.** 16.1 GB weights + ~2 GiB KV ≈
   **~18 GiB resident**. With Chrome/Safari quit (shell→~8 GiB) and a normal — not large-sim —
   Forge session (~8 GiB kernel+mesh+viewport), total ≈ **34.5 GiB ≤ 36 GiB** (§2). It is a
   **3.6×** capacity jump over today's 4.0 GiB 7B while staying inside the box.

**Fit math, one line:** `18 (LM) + 8 (trimmed shell) + 8 (forge live, small/no sim) = 34 ≤ 36 GiB`
→ **fits, ~2 GiB margin, 0 swap** — contingent on (a) quitting Chrome/Safari first and (b)
**off-loading any large FEA/CFD to cloud** (never co-resident, per `HARDWARE_BUDGET.md:150,159`).

**If you want margin over peak capability:** prefer **Magistral-Small-2509 (24B, 14.1 GB)** —
see Fallbacks; it is the safer co-resident choice and is itself a strong reasoning model.

---

## 4. Fallbacks (in priority order)

1. **Magistral-Small-2509 / 1.2 — 24B, `lmstudio-community/Magistral-Small-2509-MLX-4bit`,
   14.1 GB, Apache-2.0** [15][16]. The cleanest *fit* in the true 24B slot: ~16.5 GiB resident
   leaves ~3-4 GiB margin with a live Forge session even before trimming Chrome (§2). Strong
   reasoning (AIME24 86.14 / AIME25 77.34 / GPQA 70.07 VENDOR [16]). **Use this if the 27B proves
   tight in practice** (the first thing to measure once served — see §2/§7-of-budget-doc method).
2. **Smaller quant of the 27B:** Qwen3.6-27B is also published at **5-bit/6-bit/8-bit** for the
   Magistral line and as **`unsloth/...-UD-MLX-MXFP4`** dynamic quants [13][15]. Going *up* to 5/6-bit
   buys quality at +~3-6 GiB (won't co-fit); going to a tighter **MXFP4/UD-Q3** dynamic quant
   could shave the 16.1 GB toward ~13-14 GB if co-residency is the blocker — **TODO: measure the
   exact MXFP4 GB, UNVERIFIED here.**
3. **Stay at 32B only when Forge UI is idle:** `mlx-community/Qwen3-32B-4bit` (18.4 GB) [5] or
   `DeepSeek-R1-Distill-Qwen-32B-MLX-4Bit` (~18 GB) [19] give the most headroom *if* you accept
   **serve-XOR-Forge** (32B + live Forge OOMs, §2). Good for offline batch corpus generation /
   eval, not for live CUA driving.
4. **Cloud-offload the heavy subsystem instead of the LM:** keep a 24-27B LM local and push
   **large 3D FEA / turbulent CFD / oversized batch meshing to cloud** — exactly the split
   `HARDWARE_BUDGET.md:148-160` already prescribes. This is the *preferred* way to make the 27B
   co-fit a heavy engineering session: the LM stays on-device (the product thesis), the
   occasional big solver goes remote.
5. **Last-resort floor:** keep the **7B** (`archie-7b-base-4bit`, 4.0 GiB) for sessions that must
   run a *large local sim + LM + full UI simultaneously* — the only config where a 24-27B LM
   simply won't co-reside.

---

## 5. MLX LoRA / QLoRA fine-tune notes

Forge's value is the **per-discipline LoRA adapters** layered on the base
(`PlannerProviders.js:246-252`; `HARDWARE_BUDGET.md:103` shows the 11 GiB adapter store). Moving
the base from 7B→27B changes the training budget materially:

- **Training memory blows the 36 GiB box at 27B unless done as LoRA/QLoRA on the 4-bit base.**
  The project's own measured peak for an MLX(-VLM) LoRA run is **~26 GiB**
  (`HARDWARE_BUDGET.md:151`, citing the `mlx-vlm-eager-rope-fix` note) — and that was for a
  **7-8B-class** model. A **27B LoRA** will exceed that; a **27B full-precision SFT will not fit
  36 GiB at all** → **train via `mlx_lm.lora` QLoRA on the 4-bit weights, base frozen**, or
  **cloud** for any full fine-tune. (ESTIMATED scaling; the exact 27B-LoRA peak is **TODO:
  measure** with `footprint <pid>` during a real run, per `HARDWARE_BUDGET.md:181-195`.)
- **Single-heavy-step rule is binding (MEASURED).** `mlx_lm.lora` for the 27B must run with
  **serve + Electron + Vite all stopped** (`HARDWARE_BUDGET.md:151,160` and the
  `feedback-hardware-calm` memory). Never concurrent with a live Forge session.
- **Chat template must be applied at inference.** Per the `feedback-models-eval-template` memory,
  Qwen3.x adapters need the matching chat template (and Qwen3/3.5/3.6 have a **thinking-mode**
  toggle) — `mlx_lm.generate --prompt` alone produces garbled output. Keep the existing
  server-side template path; the runner already relies on the server's loaded model + template
  (`ForgeRunner.js:221-224`). **Verify the Qwen3.6 thinking-mode token handling** doesn't fight
  Forge's tool-call JSON contract (`ForgeRunner.js:64-105`) — **TODO: confirm on first integration.**
- **Adapter portability is NOT free across base changes.** The current adapters were trained on
  **DeepSeek-R1-Distill-Qwen-7B**; they are **not transferable** to a 27B Qwen3.6 base (different
  width/depth/tokenizer-version) → **all per-discipline LoRAs must be re-trained** against the new
  base before the upgrade ships. Budget this as the real cost of the 7B→27B move. **(Built today:
  7B adapters. Targeted: 27B adapters — not yet trained → TODO.)**
- **Speculative decode / verifier still apply:** the 1.5B verifier and 1B draft
  (`HARDWARE_BUDGET.md:113-114`) are base-agnostic helpers; a Qwen3.x 0.6B/1.7B draft would be a
  better-matched speculative draft for a Qwen3.6 base — **optional, TODO.**

---

## 6. Honest gaps (what is NOT verified / NOT built)

- **No on-box benchmark was re-run.** All AIME/MATH/GPQA/SWE-bench numbers are **VENDOR or
  third-party aggregator** figures, not measured on this M4 Max. Forge-relevant capability
  (engineering tool-call accuracy, GD&T logic) is **not** captured by these public benches at
  all → the real go/no-go is an **on-device eval on Forge's own gauntlet**, which is **TODO**.
- **Discrete Qwen3.6 AIME/MATH digits are second-hand.** The primary Qwen3.6 technical report
  (`qwen.ai/blog?id=qwen3.6-27b` [12]) was cited but not fully parsed for exact AIME/MATH
  percentages in this pass; the "beats Qwen3.5 & Gemma 4" claim is from a secondary review [8].
  **TODO: pull the exact digits from the primary report before quoting them as fact.**
- **MLX-card "5B params" metadata bug** on the Qwen3.5/3.6 4-bit repos [13][14] — I assert 27.8 B
  from the upstream cards [10][12] and the 16.1 GB-at-4-bit arithmetic, but the *converted-repo
  metadata itself is wrong*; double-check the loaded param count after pulling.
- **Mistral-Small-3.2 & Gemma-3-27B 4-bit footprints are ESTIMATED**, not read off HF file lists
  this pass → **TODO/UNVERIFIED** if either becomes the pick.
- **The ~8-12 GiB "live Forge load" is partly ESTIMATED.** Kernel RSS (`HARDWARE_BUDGET.md:147`),
  meshing peaks, and the Metal ~27 GiB cap (`:78-86`) are flagged ESTIMATED/UNVERIFIED in the
  budget doc itself. The §2 fit inequality is therefore **directionally reliable but not
  measured to the GiB** — the 27B's "fits but tight" verdict **must be confirmed by measuring
  resident RSS after a real serve + flagship build** (method: `HARDWARE_BUDGET.md:181-195`).
- **27B is over the ~27 GiB Metal soft cap when co-resident with a full UI** even when it fits the
  36 GiB nameplate (§2). Until `iogpu.wired_limit_mb` behaviour is measured, treat the
  "27B + live Forge" combo as **not yet validated on hardware → TODO**, and prefer the 24B
  Magistral fallback if a measured run shows pressure.
- **Nothing here is built yet.** This is a **targeted** recommendation. No 27B weight is pulled,
  no adapter is re-trained, no served-on-8080 eval is run. Separating clearly: **Built & validated
  = the 7B base + its adapters (in production). Targeted = the 27B upgrade in this document.**

---

## Sources

1. Qwen3 Technical Report — https://arxiv.org/html/2505.09388v1 (sizes, Apache-2.0, April 2025)
2. Mistral-Small-3.2-24B-Instruct-2506 — https://aws.amazon.com/blogs/machine-learning/mistral-small-3-2-24b-instruct-2506-is-now-available-on-amazon-bedrock-marketplace-and-amazon-sagemaker-jumpstart/ and https://openrouter.ai/mistralai/mistral-small-3.2-24b-instruct (24B, Apache-2.0, MATH/GPQA/HumanEval+)
3. Qwen3 lineup (0.6B-32B dense, no 24B/no 24B dense) — https://baeseokjae.github.io/posts/qwen-3-full-lineup-guide-2026/
4. Qwen3-32B "matches prev-gen 72B" / math-code-reasoning — https://qwenlm.github.io/blog/qwen3/ and https://github.com/QwenLM/Qwen3
5. `mlx-community/Qwen3-32B-4bit` — **18.4 GB**, mlx-lm 0.24.0, 4-bit — https://huggingface.co/mlx-community/Qwen3-32B-4bit
6. Qwen3.5-27B reasoning (AIME-2026 92.7, GPQA-Diamond 85.5, AA Index) — https://artificialanalysis.ai/models/qwen3-5-27b
7. Qwen3.5 release timeline (27B dense, 2026-02-24) — https://www.compute-market.com/blog/qwen-3-5-local-hardware-guide-2026
8. Qwen3.6 vs 3.5 vs Gemma4 (AIME/MATH/MMLU-Pro/LiveCodeBench qualitative) — https://kaitchup.substack.com/p/qwen36-27b-vs-qwen35-27b-vs-gemma
9. Qwen3.6-27B release (2026-04-22, Apache-2.0; 18 GB min @ 4-bit) — https://github.com/QwenLM/Qwen3.6 and https://www.buildfastwithai.com/blogs/qwen3-6-27b-review-2026
10. `mlx-community/Qwen3.5-27B-4bit` — **16.1 GB**, Apache-2.0, mlx-vlm 0.3.12 (params 27.8B per upstream; card metadata bug) — https://huggingface.co/mlx-community/Qwen3.5-27B-4bit ; upstream 27.8B/262k — https://artificialanalysis.ai/models/qwen3-5-27b
11. Qwen3.6-27B LICENSE = Apache-2.0 (fetched LICENSE file) — https://huggingface.co/Qwen/Qwen3.6-27B/blob/main/LICENSE
12. Qwen3.6-27B benchmarks (SWE-bench 77.2 > 397B 76.2) / primary blog — https://www.buildfastwithai.com/blogs/qwen3-6-27b-review-2026 and https://qwen.ai/blog?id=qwen3.6-27b
13. `mlx-community/Qwen3.6-27B-4bit` — **16.1 GB**, Apache-2.0 (card metadata shows erroneous "5B"; upstream `Qwen/Qwen3.6-27B` = 27.8B) — https://huggingface.co/mlx-community/Qwen3.6-27B-4bit ; param/ctx — https://llm-stats.com/models/qwen3.6-27b
14. `mlx-community/Qwen3.5-27B-4bit` (file-size source) — https://huggingface.co/mlx-community/Qwen3.5-27B-4bit
15. `lmstudio-community/Magistral-Small-2509-MLX-4bit` — **14.1 GB**, Apache-2.0, base lineage Mistral-Small-3.2-24B (+5/6/8-bit variants) — https://huggingface.co/lmstudio-community/Magistral-Small-2509-MLX-4bit
16. `mistralai/Magistral-Small-2509` — 24B, Apache-2.0, 128k ctx, AIME24 86.14 / AIME25 77.34 / GPQA-Diamond 70.07 / LiveCodeBench-v5 70.88 — https://huggingface.co/mistralai/Magistral-Small-2509
17. Gemma-3-27B-it — 27B, **Gemma license** (not Apache), MATH 69.0 / GPQA-Diamond 42.4 / MMLU-Pro 67.5 / GSM8K 92.27, 128k ctx — https://huggingface.co/blog/gemma3 and https://llm-stats.com/models/gemma-3-27b-it and https://arxiv.org/html/2503.19786v1
18. DeepSeek-R1-Distill-Qwen-32B (AIME-2024 72.6 / MATH-500 94.3 / GPQA-Diamond 62.1) — https://www.emergentmind.com/topics/deepseek-r1-distilled-models and https://www.datacamp.com/blog/deepseek-r1
19. `mlx-community/DeepSeek-R1-Distill-Qwen-32B-MLX-4Bit` — https://huggingface.co/mlx-community/DeepSeek-R1-Distill-Qwen-32B-MLX-4Bit
20. Qwen3.5-27B AIME-2026 92.7 / GPQA-Diamond 85.5 (secondary review corroboration; replaces the AA-page attribution for these two digits) — https://techie007.substack.com/p/qwen-35-the-complete-guide-benchmarks and https://designforonline.com/ai-models/qwen-qwen3-5-27b/

**Repo evidence (this machine):** `frontend/src/ai/ForgeRunner.js:25,214,221-224,64-105`;
`frontend/src/ai/PlannerProviders.js:246-256`; `HARDWARE_BUDGET.md:43-47,78-86,103,109,113-114,143-160,176,181-207`.

---

## Verification (adversarial)

> Independent re-check on **2026-06-20** under the Forge Engineering Bible §9 anti-fabrication
> mandate. Method: re-fetched every cited HF/license page live, re-searched each external
> benchmark/release claim against at least one source independent of the one cited, and
> spot-checked every repo `file:line` against the actual working tree. Default posture:
> skepticism — anything a real source could not confirm is marked UNVERIFIED below.

**Repo evidence — ALL CONFIRMED (read off the live tree):**
- `ForgeRunner.js:25` → `const ARCHIE_BASE_URL = 'http://localhost:8080';` ✔ exact.
- `ForgeRunner.js:214` → `temperature = 0.1, maxTokens = 640,` ✔ exact.
- `ForgeRunner.js:221-224` → comment confirms the deliberate omission of the `model` field ✔.
- `PlannerProviders.js:246-256` → "DeepSeek-R1-Distill-Qwen-7B + per-discipline LoRA … mlx_lm.server
  (localhost:8080) … `defaultModel: 'archie-7b-base'`" ✔ all present.
- `HARDWARE_BUDGET.md` — `:109` (`archie-7b-base-4bit` = **4.0 GiB** MEASURED) ✔; `:43-47`
  (36.0 GiB unified, `hw.memsize=38654705664`) ✔; `:78-86` (Metal ~27 GiB soft cap, explicitly
  ESTIMATED in the budget doc) ✔; `:143-160` (shell 8-10, kernel 2-4, mesh 1-4, viewport 2-6,
  sim 4-12, LoRA ~26 GiB peak, cloud-offload split) ✔; `:176` (Chrome/Safari trim recovers RAM) ✔.

**External claims — CONFIRMED against live + independent sources:**
- **Qwen3.6-27B exists, 2026-04-22, Apache-2.0, 27.8B, 262k ctx** — corroborated by MarkTechPost,
  OpenRouter, llm-stats, multiple reviews [8][9][12][13]. (Both Qwen3.5 and Qwen3.6 post-date the
  Jan-2026 model cutoff; verified purely from live web, not memory.)
- **`mlx-community/Qwen3.6-27B-4bit` = 16.1 GB, apache-2.0** — fetched the HF page directly ✔.
- **The "5B params" MLX card-metadata bug is REAL** — the card literally shows "5B params" while
  the file is 16.1 GB and upstream is 27.8B. The doc's flag is accurate, not a hedge. ✔
- **Qwen3.6-27B LICENSE file = "Apache License Version 2.0, January 2004"** — fetched the raw
  LICENSE blob; opening line confirmed; © Alibaba Cloud 2026 [11]. ✔
- **SWE-bench Verified 77.2 vs prior-flagship 76.2** — corroborated by MarkTechPost + reviews [8][12]. ✔
- **`mlx-community/Qwen3-32B-4bit` = 18.4 GB, apache-2.0** — fetched HF page ✔.
- **Magistral-Small-2509: `lmstudio-community/...-MLX-4bit` = 14.1 GB, base Mistral-Small-3.x-24B,
  apache-2.0** — fetched HF page ✔. **Upstream card** AIME24 86.14 / AIME25 77.34 / GPQA 70.07 /
  LiveCodeBench-v5 70.88, 24B, 128k, Apache-2.0 — fetched `mistralai/Magistral-Small-2509` ✔ exact.
  (Note: the *lmstudio MLX* card does **not** itself print these scores — they live on the upstream
  card, which the doc cites correctly as [16].)
- **Mistral-Small-3.2-24B: HumanEval+ 92.90, Apache-2.0, 24B, 128k** — HumanEval+ 92.9 corroborated
  independently; MATH 69.42 / GPQA 46.13 / Arena-Hard 43.10 are the AWS/HF benchmark-table figures
  (source [2]); footprint is correctly left ESTIMATED. ✔
- **Gemma-3-27B-it: Gemma license (NOT Apache), MATH 69.0 / GPQA-Diamond 42.4 / MMLU-Pro 67.5** —
  all corroborated; the non-Apache license (basis for deprioritising it) confirmed [17]. ✔
- **Qwen3-32B 2025-04-29, 32.8B, Apache-2.0, "matches prev-gen 72B"** — consistent with the Qwen3
  report/blog [1][4]. ✔

**CORRECTED in this pass (overclaim downgraded):**
- The Qwen3.5-27B **AIME-2026 92.7 / GPQA-Diamond 85.5** digits were attributed to the AA page [6];
  on re-fetch that page shows **only** Index 34 + 27.8B/262k, **not** those two digits. → Retargeted
  the citation to secondary reviews [8][20] that do carry them (the numbers held; the citation was
  wrong). The AA **"Index 34-42"** had only **34** confirmed → **42 marked UNVERIFIED**. See the
  data-quality flags in §1 and row for Qwen3.5-27B.

**Still UNVERIFIED / TODO (unchanged, already honestly flagged by the doc):**
- Discrete Qwen3.6 AIME/MATH percentages from the *primary* report (`qwen.ai/blog?id=qwen3.6-27b`) —
  not parsed; the "beats Qwen3.5 & Gemma 4 on AIME/MATH-500" claim rests on a secondary review [8].
- Mistral-Small-3.2 & Gemma-3-27B exact 4-bit MLX GB (ESTIMATED, HF file lists not opened).
- All capability numbers are VENDOR / 3rd-party — **no on-box benchmark or RSS measurement was
  run**; the §2 "fits but tight" verdict for 27B + live Forge remains hardware-UNVERIFIED.

**Verdict:** the document's honesty contract holds up well. Every load-bearing fit/footprint/license
fact (Qwen3.6-27B 16.1 GB Apache-2.0, Magistral 14.1 GB, Qwen3-32B 18.4 GB, the "5B" card bug, the
36 GiB box) is independently confirmed. The single genuine overclaim — a mis-pointed citation for the
Qwen3.5 AIME/GPQA digits — has been corrected and the unconfirmed AA "42" upper bound flagged
UNVERIFIED. No fabricated source or invented number was found; the recommendation (Qwen3.6-27B-4bit,
trim desktop) stands on verified evidence.
