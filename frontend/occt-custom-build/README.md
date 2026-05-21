# ArchDisc — Custom OCCT WASM Build

Build a **complete-API OCCT WebAssembly module** locally, replacing the
prebuilt `opencascade.js@2.0.0-beta.b5ff984` npm package. The prebuilt package
exposes only a subset of the OCCT API; this custom build exposes the **full**
API plus a small `Handle` helper, which closes the last four roadmap-§3 parity
gaps (see `docs/superpowers/notes/parity-audit.md`).

This directory contains the build *setup* only. The actual build is a long
(~3–6 h) Docker run launched separately.

---

## Files

| File | Purpose |
|---|---|
| `archdisc-occt.yml` | Build config — `bindings: []` (full API) + `additionalCppCode` Handle helper |
| `build.ps1` | Windows / Docker Desktop launcher |
| `build.sh` | WSL 2 / Git Bash / Linux launcher |
| `README.md` | This file |

The build **outputs** (`archdisc-occt.js`, `archdisc-occt.wasm`,
`archdisc-occt.d.ts`) are written into this directory by the build and are
**git-ignored as artifacts** — do not commit them; commit only the setup above.

---

## Why this is "full OCCT"

The upstream `builds/opencascade.full.yml` (which produced the prebuilt WASM the
app ships today) declares **no** `bindings` list, so it defaults to `[]`.
In the build entrypoint `buildFromYaml.py`, `shouldProcessSymbol()` returns
`True` for **every** symbol when `len(bindings) == 0`. An empty `bindings` list
therefore literally means "expose the complete OCCT API." `archdisc-occt.yml`
reproduces that full build and adds an `additionalCppCode` Handle helper that
cannot be expressed as a plain symbol entry.

**Build-scope decision: full-API build (`bindings: []`), not a targeted subset.**
Reasons:

1. It *is* the roadmap goal — "full OCCT, local" — verbatim.
2. The `donalffons/opencascade.js` Docker image (`custom-build-image` stage)
   **pre-compiles every OCCT source file and every binding object at image-build
   time**. A `bindings: []` custom run therefore mostly **re-links** an already
   compiled object set — it does not recompile all of OCCT from scratch — so the
   marginal cost of "full" over a subset is modest.
3. A targeted subset would have to enumerate every symbol used across
   `frontend/src/kernel/brep/` (hundreds) — fragile and easy to under-specify.
   The full build cannot under-specify.
4. With `-O3 -flto` dead-code elimination the output WASM stays close to the
   current prebuilt 48 MB; "full" does not bloat the artifact materially.

## API compatibility with the app's existing kernel code

The build uses Docker image **`donalffons/opencascade.js:2.0.0-beta.b5ff984`** —
the image tag that **exactly matches** the npm pin
`opencascade.js@2.0.0-beta.b5ff984` in `frontend/package.json`.

- Same OCCT commit: `bb368e271e24f63078129283148ce83db6b9670a` (OCCT 7.6.2).
- Same Emscripten: `emscripten/emsdk:3.1.14`.

The custom WASM is therefore a strict **superset** of the current `oc` API —
every symbol `kernel/brep/` already uses keeps the same signature/ABI; the
build only makes additional symbols *reachable*. No kernel code changes are
required beyond the two-line loader swap below.

---

## Prerequisites

- Docker Desktop running, **WSL 2 backend** (Linux containers). Verified:
  `docker run --rm hello-world` prints the success banner.
- Disk: ~10 GB free (image ~1.7 GB compressed / ~5 GB on disk, plus build
  scratch).
- Time: plan an overnight run.

---

## Step 1 — Pre-pull the image (already done in preparation)

```powershell
docker pull donalffons/opencascade.js:2.0.0-beta.b5ff984
```

This is a large pull (~1.7 GB compressed) but is **not** the multi-hour build.
The `:2.0.0-beta.b5ff984` tag is pinned deliberately — `:latest` happens to
point at the same digest today, but pinning protects against drift.

---

## Step 2 — Launch the build

**The exact `docker run` command** (copy-pasteable, Docker Desktop on Windows —
run from this directory, `frontend\occt-custom-build`):

```powershell
docker run --rm -v "${PWD}:/src" donalffons/opencascade.js:2.0.0-beta.b5ff984 archdisc-occt.yml
```

Equivalent with an absolute path (run from anywhere):

```powershell
docker run --rm -v "C:\Users\satvi\archdiscv1\frontend\occt-custom-build:/src" donalffons/opencascade.js:2.0.0-beta.b5ff984 archdisc-occt.yml
```

On WSL 2 / Git Bash / Linux, add `-u "$(id -u):$(id -g)"` so output files are
owned by the host user:

```bash
docker run --rm -v "$(pwd):/src" -u "$(id -u):$(id -g)" donalffons/opencascade.js:2.0.0-beta.b5ff984 archdisc-occt.yml
```

Or just run the wrapper script, which does the pre-flight checks, pulls the
image if missing, runs the build, and lists the outputs:

```powershell
pwsh -File .\build.ps1        # Windows
```
```bash
bash ./build.sh               # WSL 2 / Git Bash / Linux
```

Notes:
- The container `ENTRYPOINT` is `buildFromYaml.py`; its **single argument is the
  config filename** (`archdisc-occt.yml`), resolved relative to the working dir
  `/src` (which is this mounted directory).
- **No `-it`** — the build is non-interactive; omitting `-it` lets it run
  detached / in the background cleanly.
- Docker Desktop on Windows accepts native Windows paths in `-v`; they are
  translated into the WSL 2 VM automatically. `${PWD}` works in PowerShell.

### Expected build time

**~3–6 hours.** The image pre-compiles OCCT + all bindings, so a `bindings: []`
run is dominated by the final `-O3 -flto` link of the full symbol set rather
than recompiling OCCT. Docker Desktop's WSL 2 VM may run 20–40 % slower than
native Linux. Treat it as an overnight job.

### Expected outputs

Written into `frontend/occt-custom-build/`:

| File | Approx. size | Role |
|---|---|---|
| `archdisc-occt.js` | ~0.4 MB | Emscripten ESM loader stub |
| `archdisc-occt.wasm` | ~48 MB | The OCCT WASM binary (full API) |
| `archdisc-occt.d.ts` | ~9 MB | TypeScript definitions |

Total ~57 MB, comparable to the current prebuilt package.

---

## Step 3 — Consume the build in the app

Copy the three outputs into the kernel source tree:

```powershell
New-Item -ItemType Directory -Force ..\src\kernel\brep\custom
Copy-Item archdisc-occt.js,archdisc-occt.wasm,archdisc-occt.d.ts ..\src\kernel\brep\custom\
```

Edit `frontend/src/kernel/brep/kernelLoader.js` — replace the two imports:

```js
// Before (prebuilt npm package):
import ocFactory from 'opencascade.js/dist/opencascade.full.js';
import ocWasmUrl  from 'opencascade.js/dist/opencascade.full.wasm?url';

// After (local custom build):
import ocFactory from './custom/archdisc-occt.js';
import ocWasmUrl  from './custom/archdisc-occt.wasm?url';
```

No other app code changes — the custom build is a superset of the same `oc`
API. Vite resolves `?url` for the local `.wasm` exactly as for the package one.
The `opencascade.js` dependency can then be dropped from `package.json` (or
kept pinned as a fallback).

### Verifying the unlocked symbols

After swapping, re-run the kernel recon e2e specs that documented each gap:

| Symbol | Verify |
|---|---|
| `gp_Pnt2d_2(u,v)` | `new oc.gp_Pnt2d_2(0.5, 0.3)` no longer throws |
| `BOPAlgo_PaveFiller` | `new oc.BOPAlgo_CheckerSI()` no longer `UnboundTypeError` |
| `BVH_PrimitiveSet` | `BRepExtrema_SelfIntersection.OverlapElements()` return type bound |
| `ShapeConstruct_ProjectCurveOnSurface` | constructible (pcurve generation for P4) |
| `Handle_Geom_BSplineSurface` | `oc.ArchDiscHandleHelper.handleFromTransient(surf)` returns a Handle accepted by `BRepBuilderAPI_MakeFace_8` |
| `BRepOffsetAPI_MakeFilling` | `Build(pr)` on a 4-edge wire — **see risk below** |

---

## Risks

- **`BRepOffsetAPI_MakeFilling.Build()` (N-Sided Patch, parity item §3.3 / G1)** —
  In the prebuilt build `Build()` throws a raw C++ integer exception for all
  inputs. The recon estimates **~40 % probability** this is a deeper WASM /
  GeomPlate incompatibility rather than a missing binding. A full-API build
  exposes the symbol but **cannot be guaranteed to fix a core C++ crash**. If it
  still crashes after this build, the shipped pure-JS `G2BlendSurface.js`
  degree-5 Bézier path remains the correct fallback (boundary fit ~1e-14 mm).
- **Build time** — 3–6 h; plan overnight. WSL 2 VM is slower than native Linux.
- **Image staleness** — the `donalffons/opencascade.js` image was last pushed
  ~3 years ago; the pinned tag guarantees the build is reproducible and ABI-
  matched to the app's npm pin, but the toolchain will not receive updates.
- **Maintenance** — any future OCCT/opencascade.js bump means re-running this
  build. The pinned image tag mitigates drift.

---

## References

- opencascade.js custom builds doc:
  `https://github.com/donalffons/opencascade.js/blob/master/website/docs/03-app-dev-workflow/03-custom-builds.md`
- Build schema: `src/customBuildSchema.py` — `mainBuild` (`name`, `bindings`,
  `emccFlags`, `additionalBindCode`), top-level `additionalCppCode`,
  `extraBuilds`, `generateTypescriptDefinitions`.
- Entrypoint: `src/buildFromYaml.py` — `shouldProcessSymbol()` confirms
  `bindings: []` ⇒ full API.
- Dockerfile: `FROM emscripten/emsdk:3.1.14`; OCCT commit
  `bb368e271e24f63078129283148ce83db6b9670a` (7.6.2).
- Docker image: `donalffons/opencascade.js:2.0.0-beta.b5ff984` (Docker Hub).
- Feasibility recon: `docs/superpowers/notes/custom-occt-build-recon.md`.
