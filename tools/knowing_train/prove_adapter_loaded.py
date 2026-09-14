#!/usr/bin/env python3
"""Prove an adapter is actually LOADED and actually CHANGES this model's output.

WHY THIS EXISTS. A silently-unloaded adapter reports plausible numbers. It cost this
repository a whole wrong conclusion once ("expert LoRA does not work", composite 0.0210
against a 0.3174 baseline) when 72 expert tensors were dropped at load and the
co-trained attention weights ran alone. `adapter_config.json` parsing is not proof;
nor is a module count, because a module built with a fresh lora_b is a no-op.

FOUR CHECKS, each of which can fail on its own, run against ONE model load:

  1. CONFIG DESCRIBES THE WEIGHTS   expert_lora_patch.verify() — every LoRA factor in
     the file is named by the config. A factor the config does not name has no module
     to land in and `load_weights(strict=False)` discards it in silence.

  2. THE MODULES EXIST IN THE BUILT GRAPH   count LoRALinear / LoRASwitchLinear in the
     constructed model, and compare the switch count against the config's claim
     (expert_lora_patch.assert_experts_live).

  3. THE FILE'S NUMBERS ARE IN THE GRAPH   read lora_a/lora_b back OUT of the live
     model and compare elementwise with the safetensors file. max|delta| must be 0.
     This is the check that distinguishes "a module was built" from "the trained
     weights are in it". It also reports how many lora_b are still exactly zero:
     lora_b is ZERO-INITIALISED, so a loaded adapter must have non-zero lora_b, and an
     adapter that failed to load is a mathematical no-op whatever its module count.

  4. IT CHANGES THE OUTPUT   generate greedily from one fixed prompt, then zero every
     lora_b in place (which makes the adapter an exact identity) and generate again.
     Two different strings prove the adapter is on the compute path. Identical strings
     mean it is not, whatever checks 1-3 said.

Usage:
    python prove_adapter_loaded.py <base-model-dir> <adapter-dir> [--tasks FILE --row N]
"""
from __future__ import annotations

import argparse
import json
import os
import sys

REPO = os.environ.get("FORGE_MODEL_REPO", "/Users/account_clawteam1/archdisc-Models")
sys.path.insert(0, os.path.join(REPO, "scripts"))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("base")
    ap.add_argument("adapter")
    ap.add_argument("--tasks", default="data/forge/bench_tasks_benchcad.jsonl")
    ap.add_argument("--row", type=int, default=0)
    ap.add_argument("--max-tokens", type=int, default=48)
    ap.add_argument("--json-out", default=None)
    args = ap.parse_args()

    import mlx.core as mx
    import mlx.nn as nn
    import expert_lora_patch as elp

    result = {"base": args.base, "adapter": args.adapter}
    print("=" * 78)
    print("ADAPTER-LOADED PROOF")
    print("  base    :", args.base)
    print("  adapter :", args.adapter)
    print("=" * 78)

    # ---- 1. config describes the weights ---------------------------------- #
    ok, msg = elp.verify(args.adapter)
    print(f"\n[1] config-vs-weights : {'OK ' if ok else 'BAD'} {msg}")
    result["check1_config_describes_weights"] = {"ok": bool(ok), "detail": msg}
    if not ok:
        raise SystemExit("check 1 failed — refusing to go further")

    # The loader MUST be patched before mlx_vlm.load or switch layers are dropped.
    if not elp.install():
        raise SystemExit("expert_lora_patch.install() returned False")
    print("    expert_lora_patch installed before load")

    from mlx_vlm import generate, load
    from mlx_vlm.prompt_utils import apply_chat_template

    print("\n    loading model (this materialises ~18 GB) ...", flush=True)
    model, proc = load(args.base, adapter_path=args.adapter)

    # ---- 2. the modules exist in the built graph --------------------------- #
    live = elp.assert_experts_live(model, args.adapter)
    print(f"\n[2] modules in graph  : {live}")
    result["check2_modules_live"] = live

    kinds = {}
    lora_modules = []
    for name, mod in model.named_modules():
        cname = type(mod).__name__
        if cname in ("LoRALinear", "LoRASwitchLinear", "DoRALinear"):
            kinds[cname] = kinds.get(cname, 0) + 1
            lora_modules.append((name, mod, cname))
    print(f"    module census: {kinds}")
    result["check2_module_census"] = kinds

    # ---- 3. the file's numbers are in the graph ---------------------------- #
    file_w = mx.load(os.path.join(args.adapter, "adapters.safetensors"))
    checked = 0
    worst = 0.0
    zero_b = 0
    nonzero_b = 0
    missing = []
    for name, mod, cname in lora_modules:
        for suffix in ("lora_a", "lora_b"):
            key = f"{name}.{suffix}"
            if key not in file_w:
                missing.append(key)
                continue
            live_arr = getattr(mod, suffix)
            f = file_w[key]
            if tuple(live_arr.shape) != tuple(f.shape):
                raise SystemExit(
                    f"check 3 FAILED: {key} is {tuple(live_arr.shape)} in the graph and "
                    f"{tuple(f.shape)} in the file — the trained factor was NOT applied")
            d = float(mx.max(mx.abs(live_arr.astype(mx.float32) - f.astype(mx.float32))))
            worst = max(worst, d)
            checked += 1
            if suffix == "lora_b":
                if float(mx.max(mx.abs(f.astype(mx.float32)))) == 0.0:
                    zero_b += 1
                else:
                    nonzero_b += 1
    print(f"\n[3] weights in graph  : compared {checked} tensor(s) live-vs-file, "
          f"max|delta| = {worst:.3e}")
    print(f"    lora_b non-zero (i.e. NOT a fresh no-op): {nonzero_b}, "
          f"still exactly zero: {zero_b}")
    if missing:
        print(f"    !! {len(missing)} live LoRA factor(s) absent from the file: "
              f"{missing[:4]}")
    result["check3"] = {"tensors_compared": checked, "max_abs_delta": worst,
                        "lora_b_nonzero": nonzero_b, "lora_b_zero": zero_b,
                        "live_factors_missing_from_file": len(missing)}
    if worst != 0.0:
        raise SystemExit("check 3 FAILED: the graph does not hold the file's numbers")
    if nonzero_b == 0:
        raise SystemExit("check 3 FAILED: every lora_b is zero — the adapter is a no-op")

    # ---- 4. it changes the output ------------------------------------------ #
    tasks_path = args.tasks if os.path.isabs(args.tasks) else os.path.join(REPO, args.tasks)
    rows = [json.loads(l) for l in open(tasks_path) if l.strip()]
    row = rows[args.row]
    messages = [{"role": "system", "content": row["system"]},
                {"role": "user", "content": row["user"]}]
    cfg = getattr(model, "config", None)
    if cfg is None:
        cfg = json.load(open(os.path.join(args.base, "config.json")))
    image = row.get("image")
    prompt = apply_chat_template(proc, cfg, messages, num_images=1 if image else 0)
    kw = {"max_tokens": args.max_tokens, "verbose": False}
    if image:
        kw["image"] = [image]

    out_on = generate(model, proc, prompt, **kw)
    text_on = out_on.text if hasattr(out_on, "text") else str(out_on)

    # Zero every lora_b in place. lora_b = 0 makes B@A == 0, i.e. the adapter becomes
    # the exact identity, WITHOUT unloading anything: same graph, same modules, same
    # everything but the trained delta.
    for name, mod, cname in lora_modules:
        mod.lora_b = mx.zeros_like(mod.lora_b)
    mx.eval(model.parameters())

    out_off = generate(model, proc, prompt, **kw)
    text_off = out_off.text if hasattr(out_off, "text") else str(out_off)

    differs = text_on.strip() != text_off.strip()
    print(f"\n[4] adapter on the compute path : {'YES' if differs else 'NO'}")
    print(f"    task id: {row.get('id')}  image: {'yes' if image else 'no'}")
    print("    --- adapter LIVE ---")
    print("    " + text_on.strip().replace("\n", "\n    ")[:600])
    print("    --- lora_b zeroed (adapter neutralised, same graph) ---")
    print("    " + text_off.strip().replace("\n", "\n    ")[:600])
    result["check4"] = {"task_id": row.get("id"), "differs": differs,
                        "adapter_live": text_on, "adapter_neutralised": text_off}

    print("\n" + "=" * 78)
    verdict = "PROVEN LOADED" if differs else "NOT PROVEN — output identical with the adapter neutralised"
    print("VERDICT:", verdict)
    print("=" * 78)
    result["verdict"] = verdict

    if args.json_out:
        with open(args.json_out, "w") as fh:
            json.dump(result, fh, indent=1)
        print("wrote", args.json_out)

    if not differs:
        raise SystemExit(2)


if __name__ == "__main__":
    main()
