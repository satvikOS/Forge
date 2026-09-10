# INCOMPLETE licence records

Listed rather than reconstructed. `tools/deps/forge_deps.py notices` states the rule
in its own header: *"Nothing here is transcribed from memory; a license text that is
not on disk is reported as an INCOMPLETE record rather than reconstructed."* A licence
notice written from memory is exactly the kind of artefact that looks compliant and
is not.

## Dear ImGui — MIT — STATICALLY LINKED INTO forge_desktop

- Version: `v1.92.9 WIP` (`forge-desktop/third_party/imgui/imgui.h:1`)
- Copyright: `Copyright (c) 2014-2026 Omar Cornut` (`imgui.h`)
- Its own header says: `See LICENSE.txt for copyright and licensing details
  (standard MIT License).`
- **`LICENSE.txt` was not vendored with the subtree and is not on this machine.**
  The only MIT text under `forge-desktop/third_party/imgui/` is stb's, inside
  `imstb_rectpack.h` — a different component's licence, not ImGui's.

TO CLOSE: fetch `LICENSE.txt` from `github.com/ocornut/imgui` at the vendored
revision and place it at `third_party/licenses/DearImGui-MIT.txt`, then add Dear
ImGui to `third_party/notices/NOTICES.md`.

## Also absent from NOTICES.md while shipping

`NOTICES.md` covers opencascade, boost, planegcs, node-addon-api, vulkan-headers,
vulkan-loader, glslang, molten-vk. Two components that **ship** are missing from it:

- **SDL2** — dynamic dylib staged into `Contents/Frameworks`. Licence text now
  vendored here as `SDL2-zlib.txt`; the notices entry is still owed.
- **Dear ImGui** — static, above.

(The audit that surfaced this said the manifest omits three components. planegcs is
NOT one of them — it is present, as `## planegcs freecad-0a45a0a`. Checked.)
