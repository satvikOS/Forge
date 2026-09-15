# Archie in Forge — measured evidence, 2026-09-15

This is evidence, not a CI gate. The hermetic gate is `forge_desktop_archie_model_gate`, and a CI runner has no model.

**Model.** The base is `models/qwen3-vl-30b-a3b-4bit` with `adapters/archie-30b-knowing-v1` (8000 iters). This is the licence-clear option. `archie-30b-astra-v1` was trained on MM-CAD:A (CC BY-NC), so it cannot be shown commercially and was not used. knowing-v1's own score was still being produced by another workflow, so this report makes no quality claim for it. It only shows what the app does with what the model emits.

**Loading.** Each load ran under `forge-job --gpu --peak-gb 31 --need orange`, after `top -l 1 -o mem` showed no process at or above 8G.

## 1. The gate: RED against the old default, then GREEN

| log | what |
|---|---|
| `gate_RED_old_default.log` | `configFromEnvironment(nullptr)` temporarily returned `off`, which was main.cpp's policy before this change (model only when `FORGE_ARCHIE_ENDPOINT` is set). **29 of 79 checks failed.** It was run at an earlier revision of the gate (79 checks). |
| `gate_green5.log` | The final gate: **83 checks, 0 failures.** It measured 77583.5 → 76452.6 mm³, with 1130.97 removed against 1130.97 expected, bbox 80 × 50 × 20, faces 11 → 13. |
| `gate_green5_mut{1..4}.log` | Each mutation is red: discovery off (29 fail), schema dropped (19), blocking service (2, 1216 ms), holes off the part (2, 0 mm³ removed). |

## 2. The real model through serve.py as shipped (`live_edit.log`, `live_empty.log`, `raw_emission.log`, `sidecar.log`)

- The app path worked end to end:
  - The sidecar was discovered on 127.0.0.1:8731 (`/health` loaded=true) and the panel header said "Archie's model is running on this computer."
  - The frame that submitted the prompt took 0.6 ms.
  - The real `POST /plan` came back in 3.8 s and 2.6 s.
- Both answers were refusals: *"emission contains no feature-IR statements"*. Before the fix in commit bb5e1b62, that service sentence reached the chat verbatim. It is now a user sentence, and the reason goes to the Console.
- **Why the model refused (`raw_emission.log`, single-threaded, serve.py's own prompt path):**
  - Under serve.py's `DEFAULT_SYSTEM` (the astra-v1 reconstruction prompt), knowing-v1 emits `CREATEPLANE(XY,0,0,0)` / `CREATECIRCLE(...)` / `plate = EXTRUDE(BOX(...))`, which is not Forge feature-IR.
  - Given a render, it degenerates into `EXTRUDE(-1.25,1.25,1.25,...)` repetition.
- **`sidecar.log` ends `sidecar_exit=139`.** serve.py died with SIGSEGV after answering its second `/plan`. `sidecar2.log` shows the same exit after two requests. The cause is not diagnosed here; this belongs to the Models repo.

## 3. The same serve.py, given the system prompt knowing-v1 was TRAINED on (`live2_*.log`, `sidecar_knowing_prompt.py`)

`sidecar_knowing_prompt.py` imports serve.py unchanged and swaps `DEFAULT_SYSTEM`, at runtime, for the system turn of `data/forge/knowing_v1/train.jsonl` row 1. Nothing in archdisc-Models is modified.

- **`live2_empty.log`: the whole lifecycle, real model to measured part.**
  - Prompt, typed into an emptied document: *"A rectangular plate 60 mm by 40 mm and 10 mm thick, with one 8 mm through hole in the centre."*
  - The model answered in 2.1 s: `BOX` then `HOLE`, shown as "Archie proposes 2 steps: Box, Hole".
  - Forge's validators accepted both steps, and Accept applied 2 of 2.
  - The panel said: *"Forge rebuilt the part: 7 faces, volume 23497.3 mm³."*
  - The kernel measured: valid, declared = parsed = compiled, bbox 60 × 40 × 10, V = 23497.3. That matches 60·40·10 − π·4²·10 = 23497.35.
- **`live2_edit.log`: an honest refusal.** The prompt was an edit on the starter part. The model answered with a whole part (BOX, CYL, TRANSLATE, CUT, CYL, PATTERN). Forge refused step 6, *"PATTERN — "count" was given the wrong kind of value"*, line by line, and ran nothing. The sidecar's `ir_bridge` maps IR literals to schema names by position, so `LINEAR` landed in `count`.

## What this says

- **The app side works as intended:** discovery, a non-blocking ask, real HTTP, the /plan contract, validators, kernel, a measured part, and a refusal shown with the step that caused it.
- **Three model-side facts block a live demo today.** Each belongs to archdisc-Models:
  1. serve.py's `DEFAULT_SYSTEM` is not the prompt knowing-v1 was trained on.
  2. serve.py SIGSEGVs after two requests.
  3. `ir_bridge` maps arguments by position.
- **One app-side product gap remains.** The model emits whole parts, and the app has no "prompt into an empty part" gesture.
  - **Measured in `replay_on_starter.log`** (`replay_sidecar.py` replays the model's recorded BOX+HOLE answer on a loopback port): on the starter part both steps validate and dispatch.
  - The kernel then refuses the program: the old body no longer reaches the result.
  - The panel says *"Forge could not build a valid part from these steps, so all 2 steps that ran were taken back and your part is as it was."*
  - The document is byte-identical to before (V 77583.5, faces 11).
