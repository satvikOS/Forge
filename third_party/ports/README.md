# third_party/ports — Forge-controlled build recipes

Sacrosanct 3.1 s10.6 requires Forge to own the recipe by which each dependency is
turned into an activated prefix, rather than inheriting whatever a system package
manager happened to do.

A port is a directory named for the dependency, containing `port.json`:

| field | meaning |
|---|---|
| `name`, `lock_version` | must match the entry in `third_party/manifest/deps.lock.json` |
| `acquire` | how the pinned source reaches `.forge-local/sources/<name>/<revision>/` |
| `configure`, `build`, `install` | the recipe that produces `.forge-local/prefixes/<triplet>/<build-hash>/<name>` |
| `provides` | the files the activated prefix must contain — checked against the lock's `presence_marker` and `anchor_globs` |
| `status` | see below |

## Status vocabulary — read this before trusting a port

- **`recipe-authored`** — the recipe is written down and reviewable, but it has NOT
  yet been executed end to end on this workstation. It is a specification, not a
  proven build.
- **`proven`** — the recipe has produced an activated prefix that
  `tools/deps/forge_deps.py verify --full` accepted.

Every port in this directory is `recipe-authored` today. Nothing here claims to
have built OCCT from source; the prefixes currently in use are Homebrew bottles,
which is exactly what `deps.lock.json` records under `binary_provenance` and why
`tools/deps/build` warns on every configure. Promoting a port to `proven` means
running it, not editing this file.

## Why the recipes exist before they are run

The recipes are the difference between "we depend on whatever brew installed" and
"we depend on a named source revision built a stated way". Writing them down is
what makes the drift measurable; `tools/deps/forge_deps.py verify` already fails
when the installed prefix stops matching the lock, whether or not the port has
been executed.
