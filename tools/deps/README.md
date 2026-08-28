# tools/deps — the dependency plane's control surface

Implements the stable command wrappers required by Sacrosanct 3.1 s21.2, plus the
engine they share (`forge_deps.py`).

```
tools/deps/seed           --lock third_party/manifest/deps.lock.json
tools/deps/build          --preset macos-arm64-release
tools/deps/export-bundle  --output <explicit-path>
tools/deps/import-bundle  --input  <explicit-path> --verify-only|--activate
```

Engine subcommands (`python3 tools/deps/forge_deps.py <cmd>`):

| command | does |
|---|---|
| `fingerprint [names] [--write-lock]` | compute installed-prefix hashes; authoring aid for the lock |
| `resolve` | apply the resolution order, write the gitignored `deps.resolved.json` |
| `verify [--full]` | compare installed reality against the lock; **nonzero exit on drift** |
| `notices [--strict]` | regenerate `third_party/notices/NOTICES.md` from real license files |
| `lint-network` | fail if any CMake file reaches the network at configure time |
| `seed` | ONLINE_SEED the source mirror; refuses while `FORGE_NETWORK=OFF` |
| `export-bundle` / `import-bundle` | move an activated plane between machines, hash-verified |

## Prefix resolution order

Applied identically by `forge_deps.py` and by `forge-kernel/cmake/ForgeDeps.cmake`:

1. `-DFORGE_DEPS_PREFIX_<NAME>=` or `$FORGE_DEPS_PREFIX_<NAME>` — explicit operator
   instruction, wins over everything.
2. `.forge-local/prefixes/<triplet>/<build>/<name>` — the activated immutable prefix.
3. `$FORGE_DEPS_ROOT/<name>` — a mirror root holding every dependency.
4. The lock's `installed.system_prefix_template` — **last resort**. Warns loudly, and
   fails the configure under `-DFORGE_DEPS_STRICT=ON`.

Rule 1 was originally ranked below rule 2. `drift_gate_test.sh` caught it: an
activated prefix silently swallowed every override, so two drift cases reported OK.

## Two hashes, never conflated

- `upstream.archive_sha256` — provenance. The hash of the upstream source archive.
  Recorded only when read from a real source; otherwise `null` with a stated reason.
  **Five of eight dependencies are `null` today** and the reasons are in the lock.
- `fingerprint.installed_*_sha256` — artifact identity. A content hash over the
  installed prefix on this workstation. Changes when the bottle or compiler changes.
  Definition is in the `forge_deps.py` module docstring; symlinks are resolved and
  their target content hashed, because Homebrew ships the names a linker opens
  (`libvulkan.dylib`, `glslangValidator`) as links.

## Tests

```
bash tools/deps/tests/offline_guard_test.sh   # FORGE_NETWORK=OFF guards actually fire
bash tools/deps/tests/drift_gate_test.sh      # verify actually detects drift
```

Both suites include a **baseline case that must pass**, so neither can score a green
by failing everything. Both perturb real state and assert on the specific finding.

## What is real today, and what is not

Real, and demonstrated:

- The lock is populated from the dependencies this build actually consumes.
- `forge-kernel/CMakeLists.txt` no longer hardcodes `/opt/homebrew/opt/opencascade`
  or `/opt/homebrew/opt/boost`; both resolve through the plane.
- `cmake --preset macos-arm64-release-make-strict` **fails** on the machine-global
  fallback and **succeeds** against an activated prefix.
- The offline guards and the drift gate both fail when they should.

Not real yet, and not claimed:

- No dependency has been **built** from its port recipe. Every prefix in use is a
  Homebrew bottle; `third_party/ports/*/port.json` are `recipe-authored`, not `proven`.
- The source mirror is empty. `.forge-local/prefixes/macos-arm64/demo-activation/`
  contains **symlinks** into the Homebrew Cellar, created to prove the resolution
  order end to end. `export-bundle` detects exactly this and warns that the bundle is
  not self-contained.
- Ninja is not installed here, so the conforming presets cannot be executed on this
  workstation; the `-make` variants are a labelled fallback, not a substitute.
