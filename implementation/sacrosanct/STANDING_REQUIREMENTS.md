# Standing requirements — user directives that bind every wave

These are user rulings. They sit alongside Sacrosanct 3.1, never beneath it, and apply to every
track in every fanout wave without needing to be restated.

## SR-1 — Full standing autonomy (2026-08-28)
Work non-stop. Never stop for user direction. Make the call, record it in `DECISIONS.md`, continue.
Only a genuine external blocker (credentials, unavailable hardware, a legal question) may pause a
single track, and every other track continues regardless.

## SR-2 — Maximum parallelism, then immediate reclaim (2026-08-28)
Deploy as much parallel work as the machine will carry in a wave. The moment a track's job is done,
delete its worktree — before launching the next wave. `tools/storage/reap_worktrees.sh --apply` runs
between every wave. It refuses dirty trees, the current worktree, anything outside
`.claude/worktrees`, anything escaping through a symlink, and anything whose commits are not
reachable from a second ref. Reclaim never overrides those refusals.

## SR-3 — Strict industry practice and standards (2026-08-28)
Applies to the C++ GUI, the kernel, and model training alike.

**C++**
- C++20, `-Wall -Wextra`, warnings-as-errors on first-party code.
- Run the missing-include preflight (`forge-kernel/test/native/check_includes.sh`). It exists
  because Apple-clang/libc++ silently supplies headers that libstdc++ and CI do not — a local
  build passes and CI fails. Every new header includes what it uses.
- RAII, no owning raw pointers, no hidden global mutable state; tolerances, units, frames and
  configuration are explicit inputs.
- ASan/UBSan/TSan where supported; clang-tidy; deterministic, order-independent tests.
- Every test asserts a value against a reference. "Did not throw" is not a test. A gate whose
  failure path cannot set a non-zero exit is not a gate.

**Model training**
- Frozen baseline, pinned verifier, held-out split, and a contamination firewall that is *verified*
  rather than assumed.
- Report `n` and the ok/failed record split with every score. A mean over surviving records only,
  with failures silently excluded, is not a score.
- Compare against the trivial-baseline floor. If a plain box scores 0.4310, anything below that is
  worse than not understanding the part at all.
- Ablate one lever at a time; record measured-dead levers so they are never re-bet.

## SR-4 — Nothing static or basic; simulation is real-time and scientific (2026-08-28)
No canned demos, no placeholder animation, no pre-baked frames.

- Simulation is **dynamic, scientific, and real-time**: a live interactive loop with a declared
  target rate and a declared validity/error envelope (§14.5). Degradation must be visible and must
  never silently enlarge the timestep or skip a required event.
- **Real-world motion animation is a deliverable**, not decoration: the user must see what actually
  happens to a specific CAD model in a specific situation — the mechanism moving through its real
  trajectory, the part deflecting under its real load, contact engaging, a fastener loosening,
  thermal fields evolving.
- Every animated frame is bound to a geometry revision, a solver step, and a result hash. A frame
  that cannot name its revision is not evidence.
- Motion comes from an integrator over real equations, never from an artist's keyframe or a scripted
  transform. Every trajectory is replayable from an initial state and a deterministic input.
- The live path always has a deterministic confirmation counterpart, and the live-versus-confirmation
  error is reported against an accepted envelope (§14.5, Appendix). A pretty field is not a validated
  field.
