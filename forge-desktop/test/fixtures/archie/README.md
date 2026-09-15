# Recorded Archie sidecar replies

`forge_desktop_archie_model_gate` serves these over real loopback HTTP from
`archie/test/LoopbackSidecarStub.hpp`, prefixed with the request's own `id` the
way `archdisc-Models/tools/archie_sidecar/serve.py` answers `POST /plan`.

They are generated, not typed: `record_fixtures.py` feeds authored feature-IR
emissions through the sidecar's own `ir_bridge.to_steps()` against the tool list
the app actually sent (captured with `--dump-request`), and wraps each result as
serve.py does. Regenerate after any change to the app's tool schemas or the bridge:

    forge-desktop/build/forge_desktop_archie_model_gate --dump-request /tmp/plan_request.json
    python3 forge-desktop/test/fixtures/archie/record_fixtures.py /tmp/plan_request.json ~/archdisc-Models

| file | emission | what the gate proves with it |
|---|---|---|
| `plan_two_holes.json` | two `HOLE(%5, 6, ±25, 0, 20)` | prompt -> plan -> validators -> kernel, measured |
| `plan_two_holes_off_part.json` | the same at x = ±60 | mutation 4: a valid, dispatched, WRONG part is caught by measurement |
| `plan_fillet_too_big.json` | `FILLET(%5, 40)` | the kernel refuses the result; the plan is taken back and said so |
| `plan_refused.json` | `SLOT(...)` | the bridge's own refusal is shown as Archie's answer, not replaced |
