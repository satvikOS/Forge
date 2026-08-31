<!--
  ─────────────────────────────────────────────────────────────────────────────
  THE GITHUB RELEASE BODY. This file is the single source of the text that
  appears on the release page, so the notes and the README cannot drift.

  .github/workflows/desktop-release.yml reads this file on a pushed tag and
  substitutes the placeholders below before calling `gh release create`. Every
  placeholder is a MEASURED value pulled out of the build's own dryrun report —
  a hard-coded minimum-macOS or sha256 is wrong the moment anything changes.

    @@TAG@@      the pushed tag, e.g. v0.1.0
    @@VERSION@@  the tag without its leading v, e.g. 0.1.0
    @@FLOOR@@    measured_floor from Forge-macos-arm64-<v>.dryrun.json
    @@SHA@@      sha256 of the zip, from Forge-macos-arm64-<v>.zip.sha256
    @@REPO_URL@@ https://<host>/<owner>/<repo>, so links resolve on the
                 release page (a RELATIVE link does not reliably resolve there)

  Everything from the first `##` heading down is the body. This comment is
  stripped before publishing.

  The first-launch steps below are NOT improvisable. They are the ones Apple
  currently documents, and the wording was read out of macOS itself; the full
  measurement record is in docs/FIRST_LAUNCH_MACOS.md. In particular: do NOT
  reintroduce "right-click → Open". That shortcut was REMOVED in macOS 15
  (Sequoia) and telling a user to do it sends them somewhere that does nothing.
  ─────────────────────────────────────────────────────────────────────────────
-->
## Forge @@TAG@@ — native C++ desktop app for macOS (Apple Silicon)

**Requires an Apple Silicon Mac (M1 or newer) running macOS @@FLOOR@@ or later.**
That minimum is measured from the shipped bundle itself, not asserted: it is the
highest `LC_BUILD_VERSION minos` across every Mach-O file inside `Forge.app`.

**Download:** `Forge-macos-arm64-@@VERSION@@.zip`
**sha256:** `@@SHA@@`

### First launch — one approval, once

macOS will refuse to open Forge the first time. This is expected. Approving it
takes about twenty seconds and you never do it again for that copy of the app.

1. Unzip the download and **drag `Forge.app` into your `Applications` folder.**
   Do this before step 2 — approving a copy still in `Downloads` approves *that*
   copy, and you would be asked again after moving it.
2. **Double-click Forge. It will not open.** That failed attempt is required —
   it is what puts Forge into the list you visit next. The dialog reads
   **“Forge” Not Opened** on macOS 15 and later, or **“Forge” cannot be opened
   because the developer cannot be verified** on older versions. Click **Done**
   — *not* Move to Trash.
3. Open **System Settings → Privacy & Security** and scroll down to the
   **Security** section. There is a line reading **“Forge” was blocked to
   protect your Mac.**
4. Click **Open Anyway**, and authenticate with Touch ID or your login password.
5. A final dialog appears. Click **Open**. Forge launches.

Done. Forge now opens by double-clicking it, like anything else.

> **Ignore any instructions that say to right-click → Open.** Apple removed that
> shortcut in macOS 15 (Sequoia); it does nothing on current macOS. The System
> Settings route above is the one that works.

### Why macOS asks

Forge **is** code-signed, and the signature is valid — macOS verifies it fine.
What it lacks is **notarization**, an Apple review stamp that requires a paid
Apple Developer ID certificate we have not bought yet. macOS trusts
"notarized by Apple" automatically and asks you about everything else. So the
warning is not saying the download is damaged or suspect; it is saying Apple has
not personally vouched for it, and the approval is you vouching instead.

You approve **a copy of the app**, not the name. So the approval survives for
as long as that copy does, and a version you download and install by hand needs
the same one-time approval again. The whole step disappears for every build
once a Developer ID certificate and notarization are in place.

Forge does tell you when there is a new version: it checks this release page in
the background on launch and shows a notice in the app. That check is
**read-only** — it downloads nothing and installs nothing, so updating is still
something you do by hand, and it still costs one approval. Nothing is fetched
before you ask for it.

Full detail, including the exact commands and system strings this was checked
against: [`docs/FIRST_LAUNCH_MACOS.md`](@@REPO_URL@@/blob/@@TAG@@/docs/FIRST_LAUNCH_MACOS.md)

### Also attached

- `Forge-macos-arm64-@@VERSION@@.zip.sha256` — checksum
- `Forge-macos-arm64-@@VERSION@@.dryrun.json` — the build's own measurement
  report: per-file OS floor, the bundled Mach-O inventory, and the Gatekeeper
  verdict
