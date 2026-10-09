# ArchDisc Forge

Native parametric mechanical CAD built on a high-performance C++ kernel.
The geometric core links directly to OCCT 7.9 and FreeCAD's authoring
layers; **no WASM, no Node, no Electron** in the product. The application is
the native `forge_desktop` (`forge-desktop/` + `ui/`: SDL2, Vulkan on MoltenVK,
Dear ImGui), which links the C++ kernel core `libforge_kernel_core` from
`forge-kernel/` and isolates kernel work in a bundled `forge_kernel_worker`
process. The Electron app and the `forge-kernel.node` addon are not part of the
native shipping build (see **Build** below).

## What Forge is

- Solid + surface modeling with the OCCT BREP kernel.
- Parametric sketcher with a 2D constraint solver (planegcs upstream).
- Assembly system designed for **100,000+ component instances** with
  reference-counted BREP de-duplication and a BVH spatial index built
  in C++.
- Feature tree authoring, drawings, GD&T, configurations, FEA, CAM,
  PDM — see `BRAND.md` for the staged rollout plan and `ARCHITECTURE.md`
  for the layered design.

## Install on macOS — the one-time approval

Forge ships from GitHub Releases (and later from the ArchDisc website), not
from the Mac App Store. Downloads are **Apple Silicon only**, and the release
page states the minimum macOS version, which is measured from the shipped
bundle rather than promised.

The first time you open a downloaded copy, **macOS will refuse, and you have to
approve it once by hand.** This is expected, it takes about twenty seconds, and
you never do it again for that copy of the app:

1. Unzip the download and drag **`Forge.app` into your `Applications` folder.**
   Do this first — approving a copy still sitting in `Downloads` approves
   *that* copy, and you would be asked again after moving it.
2. **Double-click Forge. It will not open.** That failed attempt is required:
   it is what puts Forge into the list you visit next. The dialog reads
   **“Forge” Not Opened** on macOS 15 and later, or **“Forge” cannot be opened
   because the developer cannot be verified** on older versions. Click
   **Done** — not *Move to Trash*.
3. Open **System Settings → Privacy & Security**, scroll down to the
   **Security** section, and find the line reading **“Forge” was blocked to
   protect your Mac.**
4. Click **Open Anyway** and authenticate with Touch ID or your login password.
5. A final dialog appears. Click **Open**. Forge launches, and from now on it
   opens by double-clicking like any other app.

**Ignore anything that tells you to right-click → Open.** Apple removed that
shortcut in macOS 15 (Sequoia), so it does nothing on current macOS.

### Why macOS asks

Forge **is** code-signed and the signature is valid — macOS verifies it fine.
What it lacks is **notarization**, an Apple review stamp that requires a paid
Apple Developer ID certificate we have not bought yet. macOS trusts "notarized
by Apple" automatically and asks you about everything else, so the warning is
not saying the download is damaged or suspect; it is saying Apple has not
personally vouched for it, and the approval is you vouching instead.

You approve **a copy of the app**, not the name. An app that updates itself in
place never re-triggers the prompt, because nothing is re-downloaded through a
browser — that is what makes the approval genuinely one-time for the Electron
build, which auto-updates. The native `forge_desktop` build has no in-app
updater yet, so for that one a hand-installed new version needs the same
one-time approval again. The step disappears for every build once a Developer
ID certificate and notarization are in place.

Every claim above was measured rather than assumed, including the exact macOS
dialog strings; the record, and the list of things that were *not* verified, is
in [`docs/FIRST_LAUNCH_MACOS.md`](docs/FIRST_LAUNCH_MACOS.md).

## Status

Pre-1.0, slice-numbered. Latest slice prefix is `Forge-N`. Earlier work
shipped under the `SP-N` prefix when the product was named ArchDisc Mech.

## Build

Native toolchain (macOS arm64, Homebrew; the app's list is in
`forge-desktop/README.md`):

```sh
brew install cmake opencascade boost sdl2 vulkan-headers vulkan-loader molten-vk glslang
```

The native app, from the **shipping presets** (`macos-arm64-ship` in
`forge-kernel/CMakePresets.json` and `forge-desktop/CMakePresets.json`). They
pin what ships — no Node addon (`FORGE_BUILD_NODE_ADDON=OFF`; the CMake default
is ON), no Python step in the build, Release, arm64, macOS 14.0 — and need no
`node`, `npm` or `node_modules`:

```sh
(cd forge-kernel  && cmake --preset macos-arm64-ship && cmake --build --preset macos-arm64-ship -j6)
(cd forge-desktop && cmake --preset macos-arm64-ship && cmake --build --preset macos-arm64-ship -j6)
```

Builds land in `.forge-local/builds/macos-arm64-ship{,-app}`. Package and report
without publishing anything (ad-hoc signed, no notarization):

```sh
KERNEL_BUILD="$PWD/.forge-local/builds/macos-arm64-ship" \
APP_BUILD="$PWD/.forge-local/builds/macos-arm64-ship-app" \
  forge-desktop/release_dryrun.sh --no-build      # -> forge-desktop/dist/
```

`forge-desktop/test/native_ship_gate.sh` is the gate for all of the above: it
builds both presets with node/npm/python/electron trap shims first on `PATH`,
audits `-Werror` on first-party code, runs the headless gates, packages under
the same trap, scans the bundle for any Node/Electron/Python artifact, and makes
the relocated bundle's worker build a solid under `env -i`
(`--prove-mutations` shows each check can fail).

Legacy Electron app — not the shipping product. Every `forge-kernel` preset
other than `macos-arm64-ship` leaves `FORGE_BUILD_NODE_ADDON` at its default
(ON), so those presets still build `forge-kernel.node` and run `node` at
configure time:

```sh
npm install
npm run forge:kernel        # build forge-kernel.node
npm run electron:dev        # launch the Electron app
```

## Branches

- `archdisc` — active development. Every push is a discrete slice.

## Repos

- This repo (Forge) — desktop app + native kernel.
- `archdisc-Studio` — separate sibling repo for the 3D-content product.
- `archdisc-Models` — the Archie local-fleet LLM provider both apps use.
