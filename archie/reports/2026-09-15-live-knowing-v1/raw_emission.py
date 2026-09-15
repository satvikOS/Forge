#!/usr/bin/env python3
"""Evidence only: what does knowing-v1 actually emit through serve.py's own prompt path?

Single-threaded (no HTTP server), so a crash here is not a threading artefact.
"""
import json, sys, time
sys.path.insert(0, "/Users/account_clawteam1/archdisc-Models/tools/archie_sidecar")
import serve  # noqa: E402

MODEL = "/Users/account_clawteam1/archdisc-Models/models/qwen3-vl-30b-a3b-4bit"
ADAPTER = "/Users/account_clawteam1/archdisc-Models/adapters/archie-30b-knowing-v1"
IMG = "/Users/account_clawteam1/archdisc-Models/data/cadgenbench_fixtures/112/input.png"
req_tools = json.load(open(sys.argv[1]))["tools"]

serve.load_model(MODEL, ADAPTER)
print("loaded", serve.STATE["loaded"], serve.STATE["load_error"], flush=True)
from mlx_vlm import generate  # noqa: E402

cases = [
    ("edit, text only", "drill two 6 mm through holes, 25 mm either side of the centre bore\nSelection: 0 picked\nDocument: untitled: 5 statement(s), 0 command-authored", None),
    ("whole part, text only", "A rectangular mounting plate, 80 mm by 50 mm and 20 mm thick, with a 12 mm through hole in the centre.", None),
    ("whole part, with a render", "Reconstruct this part.", IMG),
]
for name, user, image in cases:
    messages = [{"role": "system", "content": serve.DEFAULT_SYSTEM}, {"role": "user", "content": user}]
    prompt = serve.STATE["apply"](serve.STATE["proc"], serve.STATE["cfg"], messages,
                                  num_images=1 if image else 0)
    kw = {"max_tokens": 512, "verbose": False}
    if image:
        kw["image"] = [image]
    t0 = time.time()
    out = generate(serve.STATE["model"], serve.STATE["proc"], prompt, **kw)
    text = out if isinstance(out, str) else getattr(out, "text", str(out))
    steps, err = serve.ir_bridge.to_steps(text, [t for t in req_tools if t.get("id")])
    print(f"=== {name}  ({time.time()-t0:.1f}s)\n--- raw emission ---\n{text[:1500]}\n--- bridge: "
          f"{'error: ' + err if err else json.dumps(steps)[:800]}", flush=True)
