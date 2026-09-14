#!/usr/bin/env python3
"""Launcher for a VISION LoRA with MoE-expert LoRA on Qwen3-VL-30B-A3B-4bit.

It is `scripts/lora_eager_rope.py` (in the model repo) plus the two things that file
does not do, each of which is a measured failure mode rather than a nicety.

1. EAGER MULTIMODAL RoPE  (inherited, unchanged)
   mlx_vlm 0.6.2's fused MRoPE is a `mx.fast.metal_kernel`, i.e. a CustomKernel with
   no registered vjp, and it sits on the LoRA gradient path. Backward dies with
   `ValueError: [Primitive::vjp] Not implemented for CustomKernel`. Forcing
   `rope_utils._HAS_METAL = False` before the model is built selects the pure-MLX
   differentiable path. Inference is untouched.

2. EXPERT LoRA ON *BOTH* PATHS  (new here)
   89% of this model's bytes are 128 `QuantizedSwitchLinear` experts per layer, which
   mlx_vlm cannot see: `find_all_linear_names` never names them and
   `_apply_language_lora_layers` filters on `isinstance(nn.Linear | nn.QuantizedLinear)`.
   `lora_eager_rope.py` patches that FRESH path. It does not patch the RESUME path,
   which is `_apply_lora_layers` -> `_to_lora`, and `_to_lora` raises on a switch layer.
   So a resumed run either dies or silently drops every expert tensor — the exact shape
   of the v4a defect (72 expert tensors ignored, composite 0.0210 against a 0.3174
   baseline, nearly recorded as "expert LoRA does not work").
   This launcher installs `expert_lora_patch` as well, so resume works.

3. FREEZE BEFORE RESUME  (new here, and the reason a naive resume is unusable)
   `setup_model_for_training` freezes the towers only on the FRESH branch
   (`get_peft_model(freeze=True)`). Its resume branch calls `apply_lora_layers` and
   returns with NOTHING frozen, so a resumed run tries to train all 30B parameters.
   On a 36 GB box that is not a slow run, it is an immediate death. We freeze first,
   then apply — the same order the fresh path uses. `print_trainable_parameters` in
   mlx_vlm's own main() then prints the proof: a correct resume reports the same
   trainable count as the fresh run, not billions.

Usage is a drop-in for `python -m mlx_vlm.lora`, with two environment variables:
    FORGE_EXPERT_LORA_LAYERS   trailing layers to give expert LoRA   (0 = off)
    FORGE_EXPERT_LORA_RANK     rank for those expert factors
"""
from __future__ import annotations

import os
import re
import runpy
import sys

MODEL_REPO = os.environ.get("FORGE_MODEL_REPO", "/Users/account_clawteam1/archdisc-Models")
sys.path.insert(0, os.path.join(MODEL_REPO, "scripts"))

import mlx_vlm.models.rope_utils as ru  # noqa: E402

ru._HAS_METAL = False
ru._mrope_apply_kernel = lambda *a, **k: None
ru._rotary_apply_kernel = lambda *a, **k: None
ru._compiled_mrope_apply = lambda *a, **k: None
ru._compiled_rotary_apply = lambda *a, **k: None
print("[launch] rope_utils._HAS_METAL forced False (eager MRoPE, vjp-safe)", flush=True)

# --- (2) the resume path: _to_lora must know what a switch layer is ------------- #
import expert_lora_patch  # noqa: E402

if not expert_lora_patch.install():
    raise SystemExit(
        "[launch] expert_lora_patch.install() returned False — mlx/mlx_lm/mlx_vlm are "
        "not importable, so a resumed run would silently drop every expert tensor. "
        "Refusing to start.")
print("[launch] expert_lora_patch installed (_to_lora routes switch layers)", flush=True)

# --- (3) freeze before a resumed apply ------------------------------------------ #
#
# PATCH `trainer.utils`, NOT `mlx_vlm.lora`. This launcher hands argv to
# `runpy.run_module("mlx_vlm.lora", run_name="__main__")`, which RE-EXECUTES that module
# in a fresh namespace; its `from .trainer.utils import apply_lora_layers` then rebinds
# the name and silently discards a patch applied to the cached `mlx_vlm.lora` object.
# Measured, not reasoned: with the patch on `mlx_vlm.lora`, a resumed run printed
#     #trainable params: 657.691888 M || trainable%: 9.951%
# against the fresh run's 118.849536 M / 1.798%, and the resumed adapter came back
# carrying 544 extra non-LoRA tensors (the layer norms and the whole vision tower,
# unfrozen and trained). Patching trainer.utils survives the re-execution because
# `mlx_vlm.lora` imports the name from there at execution time.
import mlx_vlm.trainer.utils as _tu_freeze  # noqa: E402

_orig_apply_lora_layers = _tu_freeze.apply_lora_layers


def _apply_lora_layers_frozen(model, adapter_path):
    _tu_freeze.freeze_model(model)
    print(f"[launch] froze towers before resuming from {adapter_path}", flush=True)
    return _orig_apply_lora_layers(model, adapter_path)


_tu_freeze.apply_lora_layers = _apply_lora_layers_frozen

# ...and REFUSE to train if the freeze did not take. A launcher that silently trains the
# vision tower produces an adapter that is a different experiment from the one the config
# describes, and the only visible symptom is a line in a log nobody reads. FORGE_MAX_
# TRAINABLE_M is the ceiling in millions; 118.85 M is this recipe's LoRA-only figure.
_MAX_TRAINABLE_M = float(os.environ.get("FORGE_MAX_TRAINABLE_M", "200"))
_orig_ptp = _tu_freeze.print_trainable_parameters


def _print_trainable_parameters_gated(model):
    from mlx.utils import tree_flatten  # noqa: PLC0415

    _orig_ptp(model)
    m = sum(v.size for _, v in tree_flatten(model.trainable_parameters())) / 1e6
    if m > _MAX_TRAINABLE_M:
        raise SystemExit(
            f"[launch] {m:.3f} M trainable parameters exceeds the {_MAX_TRAINABLE_M} M "
            f"ceiling for this LoRA recipe. Something is unfrozen that should not be "
            f"(on the resume path that is the layer norms and the vision tower, 544 "
            f"tensors). Refusing to train a different experiment than the config states.")


_tu_freeze.print_trainable_parameters = _print_trainable_parameters_gated

# --- (2b) the fresh path: add expert LoRA to the trailing layers ----------------- #
_EXPERT_LAYERS = int(os.environ.get("FORGE_EXPERT_LORA_LAYERS", "0") or 0)
if _EXPERT_LAYERS > 0:
    from mlx_lm.models.switch_layers import (QuantizedSwitchLinear,  # noqa: E402
                                             SwitchLinear)
    from mlx_lm.tuner.lora import LoRASwitchLinear  # noqa: E402
    import mlx_vlm.trainer.utils as _tu  # noqa: E402

    _EXPERT_RANK = int(os.environ.get("FORGE_EXPERT_LORA_RANK", "8"))
    _SWITCH = (SwitchLinear, QuantizedSwitchLinear)
    _orig_apply = _tu._apply_language_lora_layers

    def _apply_with_experts(model, linear_layers, lora_parameters):
        keys = _orig_apply(model, linear_layers, lora_parameters)
        n_layers = len(model.language_model.model.layers)
        first = max(0, n_layers - _EXPERT_LAYERS)
        added = 0
        for name, module in model.language_model.named_modules():
            if not isinstance(module, _SWITCH):
                continue
            m = re.search(r"layers\.(\d+)\.", name)
            if not m or int(m.group(1)) < first:
                continue
            _tu.set_module_by_name(
                model.language_model, name,
                LoRASwitchLinear.from_base(module, r=_EXPERT_RANK,
                                           scale=lora_parameters["scale"],
                                           dropout=lora_parameters["dropout"]))
            keys.append(_tu._linear_layer_key("language_model", name))
            added += 1
        print(f"[launch] EXPERT LoRA: {added} switch module(s) in layers "
              f"{first}..{n_layers - 1} at rank {_EXPERT_RANK}, scale "
              f"{lora_parameters['scale']} (+{len(keys) - added} attention/router keys)",
              flush=True)
        if added == 0:
            raise SystemExit(
                "[launch] FORGE_EXPERT_LORA_LAYERS was set but NO switch module was "
                "converted. Refusing to run a job that trains the same thing as before "
                "while claiming to train the experts.")
        return keys

    _tu._apply_language_lora_layers = _apply_with_experts
    # The patched name is read through the module object inside get_peft_model, so the
    # rebind above is enough; assert it rather than trust it.
    assert _tu._apply_language_lora_layers is _apply_with_experts
    print(f"[launch] expert LoRA ENABLED: last {_EXPERT_LAYERS} layer(s), "
          f"rank {_EXPERT_RANK}", flush=True)
else:
    print("[launch] expert LoRA DISABLED (FORGE_EXPERT_LORA_LAYERS unset/0)", flush=True)

# --- (4) GUARDIAN'S POLITEST SIGNAL IS THE ONE THAT KILLS ----------------------- #
#
# MEASURED 2026-09-14, and it cost this run three attempts before I read the log:
#
#   guardian.log  17:31:57  shed sig=USR1 -> job='knowing-v1-lora' pid=78851
#   train log     17:31:57  ATTEMPT_DONE rc=158
#
# 158 = 128 + 30 = SIGUSR1. Guardian's stage-1 shed is COOPERATIVE by design — its own
# source says "SIGUSR1 means checkpoint now and reduce your footprint" — but the default
# disposition of SIGUSR1 is TERMINATE, and `forge-job` traps only EXIT/INT/TERM
# (`grep USR1 ~/.local/bin/forge-job` finds nothing). So the request to checkpoint kills
# the wrapper, the job dies before its first checkpoint, and the failure reads as an
# ordinary crash. Every registered job on this box has that property.
#
# Two halves of the fix. This is the half that lives in the process Guardian signals:
# SIGUSR1 does what it asks — save now, drop the cache — and then CONTINUES. The other
# half is in train_knowing_v1.sh, which registers the PYTHON pid rather than a shell
# wrapper's, so the signal reaches a process that can honour it.
import signal  # noqa: E402

_TRAIN_STATE = {"model": None, "adapter_file": None}


def _checkpoint(reason):
    import mlx.core as mx  # noqa: PLC0415
    from mlx_vlm.trainer.utils import save_adapter  # noqa: PLC0415

    m, f = _TRAIN_STATE.get("model"), _TRAIN_STATE.get("adapter_file")
    if m is None or f is None:
        print(f"[launch] {reason}: nothing to checkpoint yet (training has not started)",
              flush=True)
        return False
    # Write beside the real file and rename, so a signal that arrives during a save
    # cannot leave a half-written adapters.safetensors behind.
    tmp = str(f) + ".sigsave"
    save_adapter(m, tmp)
    os.replace(tmp, str(f))
    mx.clear_cache()
    print(f"[launch] {reason}: checkpointed to {f} and cleared the MLX cache", flush=True)
    return True


def _on_usr1(signum, frame):
    print("[launch] SIGUSR1 (Guardian stage-1: checkpoint and reduce footprint)",
          flush=True)
    try:
        _checkpoint("SIGUSR1")
    except Exception as e:                                          # noqa: BLE001
        print(f"[launch] SIGUSR1 checkpoint failed: {type(e).__name__}: {e}", flush=True)
    # DO NOT EXIT. Stage 1 is a request, not an eviction; stage 3 sends SIGTERM.


def _on_term(signum, frame):
    print("[launch] SIGTERM (Guardian stage-3 eviction or an operator) — saving and exiting",
          flush=True)
    try:
        _checkpoint("SIGTERM")
    except Exception as e:                                          # noqa: BLE001
        print(f"[launch] SIGTERM checkpoint failed: {type(e).__name__}: {e}", flush=True)
    raise SystemExit(143)


signal.signal(signal.SIGUSR1, _on_usr1)
signal.signal(signal.SIGTERM, _on_term)
print("[launch] SIGUSR1/SIGTERM handlers installed (Guardian-cooperative)", flush=True)

# Capture the model and the adapter path the trainer is using, so the handlers above
# have something to save. Wrapping train() is the only hook mlx_vlm offers.
import mlx_vlm.trainer.sft_trainer as _sft  # noqa: E402

_orig_train = _sft.train


def _train_capturing(model, optimizer, train_dataset, val_dataset=None,
                     args=None, *a, **kw):
    _TRAIN_STATE["model"] = model
    _TRAIN_STATE["adapter_file"] = getattr(args, "adapter_file", None)
    print(f"[launch] checkpoint target for signals: {_TRAIN_STATE['adapter_file']}",
          flush=True)
    return _orig_train(model, optimizer, train_dataset, val_dataset, args, *a, **kw)


_sft.train = _train_capturing
# mlx_vlm.lora does `from .trainer.sft_trainer import TrainingArgs, train`, and runpy
# re-executes that import, so patching the module attribute is what survives. Proven by
# the same mechanism one patch above: the mlx_vlm.lora-level patch did NOT survive and
# a resumed run trained 657 M parameters instead of 118 M.

sys.argv = ["mlx_vlm.lora"] + sys.argv[1:]
runpy.run_module("mlx_vlm.lora", run_name="__main__", alter_sys=True)
