#!/usr/bin/env python3
# ─────────────────────────────────────────────────────────────────────────────
#  cadgen_mm_vlm_extract.py — PHASE 1 of the multimodal drawing→CAD pipeline.
#
#  Reads each CADGenBench *generation* fixture's input.png (an engineering
#  drawing — the ONLY geometry source), runs Qwen2.5-VL once per drawing with a
#  dimension-extraction prompt, and writes ONE jsonl line per fixture:
#      {"id": "...", "png": "...", "spec": "<structured dimensioned text spec>"}
#
#  This is the VLM FRONT-END. The downstream text→CAD backend (cadgen-v7,
#  driven from cadgen_mm_pipeline.mjs PHASE 2) consumes spec[] as the user prompt
#  and emits Forge tool-calls → kernel build → io.exportStep → output.step.
#
#  Serve strategy: this script loads the VLM ALONE (≈ 9 GB for the 7B bf16) and
#  extracts ALL specs first, then EXITS — freeing the GPU before the 14B text
#  backend is served. The two models are NEVER co-resident (36 GB box). This is
#  why the pipeline is two sequential phases, not one co-loaded serve.
#
#  Run (normally invoked by cadgen_mm_pipeline.mjs, but standalone-safe):
#    .venv/bin/python scripts/cadgen_mm_vlm_extract.py \
#        --data-dir data/cadgenbench-data --out /tmp/cadgen_mm_specs.jsonl \
#        --ids 101,110,120,135,140  [--max-tokens 1200] [--model models/qwen2.5-vl-7b-bf16]
#
#  cwd must be ~/archdisc-Models (so models/ and data/ resolve).
# ─────────────────────────────────────────────────────────────────────────────
import argparse, json, os, sys, time
from pathlib import Path

# The extraction prompt. We ask for a PRECISE, BUILDABLE, dimensioned text spec
# in the exact register the text backend was trained on (mm, primitives, holes,
# fillets). We tell the VLM to read every view, prefer the dimensioned ortho
# views over the isometric, and to NOT invent numbers it cannot read.
# ── Two-pass prompts ──────────────────────────────────────────────────────────
# PASS 1 (ANALYSIS): a detailed read of every view — this is the human-auditable
#   record of what the VLM saw (used for the feasibility report; NOT fed to the
#   text backend, which goes into chat-mode on long markdown).
# PASS 2 (BUILD SENTENCE): compress that read into ONE terse, single-paragraph
#   buildable description in the EXACT register cadgen-v7 was trained on
#   (e.g. "An 80×80×15 mm plate with a single 20 mm through-hole in the centre.").
#   This terse sentence is what is actually fed to the text→CAD backend — the
#   long markdown flips the model into explanation mode and it emits NO tool-calls.
EXTRACT_PROMPT = (
    "You are a senior mechanical engineer reading a formal engineering drawing. "
    "This drawing is the ONLY source of geometry. Read EVERY view: the dimensioned "
    "orthographic views (front / top / side / section) carry the real numbers; the "
    "shaded isometric is only for overall shape understanding. All dimensions are in "
    "millimetres.\n\n"
    "Produce a single PRECISE, BUILDABLE part specification that another engineer "
    "could model from blind. Be concrete and numeric. Cover, in this order:\n"
    "1. OVERALL SHAPE: the base solid and its overall bounding size (length x width x "
    "height in mm), e.g. 'rectangular plate 120 x 80 x 10 mm' or 'cylindrical hub "
    "Ø80 x 12 mm'.\n"
    "2. PRIMARY FEATURES: every boss, pad, rib, flange, step, pocket, slot or counterbore "
    "that adds or removes material — give each one's size and its position relative to "
    "the part centre or an edge (mm).\n"
    "3. HOLES: every hole / bore — diameter, whether THRU or blind (depth), and its "
    "X,Y location relative to the part centre. List bolt circles as 'N holes Ø_ on a "
    "Ø_ bolt circle'. Read hole tables and 'N x Ø' callouts.\n"
    "4. FILLETS / CHAMFERS / DRAFT: any edge radii or chamfers (mm).\n\n"
    "Rules: report ONLY dimensions you can actually read on the drawing; if a number is "
    "unreadable, give your best engineering estimate and mark it (approx). Do NOT output "
    "tool-calls or code — output a clear dimensioned prose+bullet spec only. Centre the "
    "part on the origin. End with one line 'BUILD SUMMARY:' giving the recommended base "
    "primitive and its dimensions."
)

# PASS 2 is text-only (the VLM already saw the image in PASS 1; we hand it back its
# own analysis and ask for the terse build sentence). Kept image-attached too so it
# can re-check a number. The few-shot examples are LITERAL cadgenbench_set prompts.
BUILD_SENTENCE_PROMPT_TMPL = (
    "From the engineering analysis below, write ONE concise build description of the "
    "part — a single short paragraph (1–3 sentences), in plain mechanical-CAD English, "
    "naming the base solid with its overall size in mm and then the holes / bosses / "
    "fillets / chamfers with their sizes and positions. No headings, no bullet lists, "
    "no markdown, no commentary — just the description sentence(s). Match this style:\n"
    "  • 'An 80 x 80 x 15 mm plate with a single 20 mm diameter through-hole in the centre.'\n"
    "  • 'A 120 mm diameter, 16 mm thick flange disc with six 8 mm holes equally spaced on a 96 mm bolt circle.'\n"
    "  • 'A 70 x 50 x 30 mm block with four 6 mm corner holes and every edge rounded with a 4 mm fillet.'\n\n"
    "ANALYSIS:\n{analysis}\n\nBUILD DESCRIPTION (one short paragraph, no markdown):"
)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data-dir", default="data/cadgenbench-data")
    ap.add_argument("--out", required=True)
    ap.add_argument("--ids", default="", help="comma-separated fixture ids; empty = all gen fixtures (png, no step)")
    ap.add_argument("--model", default="models/qwen2.5-vl-7b-bf16")
    ap.add_argument("--max-tokens", type=int, default=1200)
    ap.add_argument("--temp", type=float, default=0.0)
    args = ap.parse_args()

    data_dir = Path(args.data_dir)
    if not data_dir.is_dir():
        print(f"[vlm] data dir not found: {data_dir.resolve()}", file=sys.stderr)
        sys.exit(2)

    # Select fixture ids.
    if args.ids.strip():
        ids = [s.strip() for s in args.ids.split(",") if s.strip()]
    else:
        ids = []
        for d in sorted(data_dir.iterdir(), key=lambda p: p.name):
            if not d.is_dir() or not d.name.isdigit():
                continue
            png = d / "input.png"
            step = d / "input.step"
            if png.exists() and not step.exists():  # generation fixture
                ids.append(d.name)
    print(f"[vlm] {len(ids)} fixture(s) to extract: {', '.join(ids[:12])}{' …' if len(ids) > 12 else ''}", flush=True)

    # Load the VLM ONCE. This is the only model resident in this process.
    print(f"[vlm] loading {args.model} (one-time, ~9 GB bf16)…", flush=True)
    t_load = time.time()
    try:
        from mlx_vlm import load, generate
        from mlx_vlm.prompt_utils import apply_chat_template
        from mlx_vlm.utils import load_config
    except ImportError as e:
        print(f"[vlm] ERROR: mlx-vlm not installed ({e})", file=sys.stderr)
        sys.exit(4)
    model, processor = load(args.model)
    config = load_config(args.model)
    print(f"[vlm] ready ({time.time() - t_load:.1f}s)", flush=True)

    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    n_ok = 0
    with open(out_path, "w") as fout:
        for i, fid in enumerate(ids):
            png = data_dir / fid / "input.png"
            if not png.exists():
                print(f"[vlm] [{i+1}/{len(ids)}] {fid}: no input.png — skip", flush=True)
                continue
            t0 = time.time()
            analysis = ""
            spec = ""
            try:
                # PASS 1 — detailed analysis of every view (auditable record).
                formatted = apply_chat_template(processor, config, EXTRACT_PROMPT, num_images=1)
                res = generate(
                    model, processor, formatted, image=[str(png)],
                    max_tokens=args.max_tokens, temperature=args.temp, verbose=False,
                )
                analysis = (res.text if hasattr(res, "text") else str(res)).strip()
                # PASS 2 — compress to ONE terse build sentence in the trained register.
                bsp = BUILD_SENTENCE_PROMPT_TMPL.format(analysis=analysis)
                formatted2 = apply_chat_template(processor, config, bsp, num_images=1)
                res2 = generate(
                    model, processor, formatted2, image=[str(png)],
                    max_tokens=320, temperature=args.temp, verbose=False,
                )
                spec = (res2.text if hasattr(res2, "text") else str(res2)).strip()
                # Strip any stray markdown the VLM may still emit.
                spec = spec.replace("**", "").replace("\n\n", " ").replace("\n", " ").strip()
                if spec.lower().startswith("build description"):
                    spec = spec.split(":", 1)[-1].strip()
            except Exception as e:
                print(f"[vlm] [{i+1}/{len(ids)}] {fid}: EXTRACT ERROR {e}", file=sys.stderr, flush=True)
            # Fall back to the analysis text if pass 2 produced nothing usable.
            if len(spec) < 20 and analysis:
                spec = analysis
            rec = {"id": fid, "png": str(png.resolve()), "spec": spec, "analysis": analysis}
            fout.write(json.dumps(rec) + "\n")
            fout.flush()
            ok = len(spec) > 20
            n_ok += int(ok)
            head = spec.replace("\n", " ")[:110]
            print(f"[vlm] [{i+1}/{len(ids)}] {fid}: spec={len(spec)}ch analysis={len(analysis)}ch {time.time()-t0:.1f}s | {head}", flush=True)

    print(f"[vlm] DONE — {n_ok}/{len(ids)} non-empty specs → {out_path}", flush=True)


if __name__ == "__main__":
    main()
