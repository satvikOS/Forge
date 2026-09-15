#!/usr/bin/env python3
"""Regenerate the recorded sidecar replies forge_desktop_archie_model_gate serves.

Each reply is produced by THE SIDECAR'S OWN CODE, not typed by hand:
archdisc-Models/tools/archie_sidecar/ir_bridge.py turns a feature-IR emission
into registry steps against the tool list the APP actually sent, and the result
is wrapped exactly as serve.py's /plan handler wraps it (minus the "id", which
the stub echoes per request, as serve.py does).

The IR emissions below are authored, not recorded from a model: this gate is
about the app's side of the contract, and a fixture that changed whenever a model
was retrained would test the model instead. Real-model runs are evidence, kept
outside CI.

Usage:
    # 1. capture the request the app sends (the stub records the far end)
    forge-desktop/build/forge_desktop_archie_model_gate --dump-request /tmp/plan_request.json
    # 2. regenerate
    python3 forge-desktop/test/fixtures/archie/record_fixtures.py \
        /tmp/plan_request.json ~/archdisc-Models
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))

# name -> (feature-IR emission, summary rule). The starter part's body is %5.
EMISSIONS = {
    # Two d6 through holes, 25 mm either side of the starter part's centre bore.
    "plan_two_holes.json":
        "%6 = HOLE(%5, 6, -25, 0, 20)\n%7 = HOLE(%6, 6, 25, 0, 20)\nRESULT(%7)\n",
    # The same plan with both holes placed OFF the 80 mm plate: every step is
    # well formed and dispatches; only the measured geometry shows the part is
    # wrong. Mutation 4.
    "plan_two_holes_off_part.json":
        "%6 = HOLE(%5, 6, -60, 0, 20)\n%7 = HOLE(%6, 6, 60, 0, 20)\nRESULT(%7)\n",
    # A fillet the 20 mm plate cannot carry: validates, dispatches, and the
    # kernel refuses the result.
    "plan_fillet_too_big.json":
        "%6 = FILLET(%5, 40)\nRESULT(%6)\n",
}


def main():
    if len(sys.argv) != 3:
        print(__doc__)
        return 2
    request_path, models_root = sys.argv[1], sys.argv[2]
    sys.path.insert(0, os.path.join(models_root, "tools", "archie_sidecar"))
    import ir_bridge  # noqa: E402  -- the sidecar's own bridge

    req = json.load(open(request_path))
    tools = [t for t in req.get("tools") or [] if t.get("id")]   # serve.py's `allowed`
    text = req.get("text") or ""
    for name, ir in EMISSIONS.items():
        steps, err = ir_bridge.to_steps(ir, tools)
        if err:
            reply = {"ok": False, "error": err}
        else:
            # serve.py plan_from_model()'s return, then the /plan handler's wrap.
            reply = {"ok": True,
                     "plan": {"intent": text[:400],
                              "summary": f"{len(steps)} step(s) from {len(steps)} "
                                         f"feature-IR statement(s)",
                              "steps": steps}}
        with open(os.path.join(HERE, name), "w") as fh:
            json.dump(reply, fh, indent=1)
            fh.write("\n")
        print(name, "->", "ok" if reply["ok"] else reply["error"])

    # The bridge's own refusal sentence for an op no offered command declares.
    steps, err = ir_bridge.to_steps("%6 = SLOT(%5, 50, 20)\nRESULT(%6)\n", tools)
    assert steps is None and err, "the bridge accepted an op no command declares"
    with open(os.path.join(HERE, "plan_refused.json"), "w") as fh:
        json.dump({"ok": False, "error": err}, fh, indent=1)
        fh.write("\n")
    print("plan_refused.json ->", err)
    return 0


if __name__ == "__main__":
    sys.exit(main())
