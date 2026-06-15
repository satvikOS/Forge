# Pipe flange — Ø80, 6 bolt holes on Ø60 BCD, Ø25 bore

Reference: V-656 mechanical / standard part

## Archie's engineering plan (the spec)
Real flange: disc + centre bore + 6-hole bolt circle, composed in one parametric asset call → one clean body. STEP out.

## Execution (human-like app drive)
Prompt: model a Ø80 steel flange, 12 mm thick, 6 bolt holes on a 60 mm bolt circle, 25 mm bore

Render: pathtrace-gpu @ 128 spp (M4 Max GPU ray tracing)
Deliverable: glb + STEP (manufacturing) + STL + render PNG
