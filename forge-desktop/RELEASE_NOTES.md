Forge for macOS — `@@VERSION@@`
================================

The native C++ Forge desktop app: the real modelling kernel, the real
feature tree, and the real renderer in one self-contained bundle. No Electron,
no Node, no separate install step.

**Apple Silicon (arm64) only. Requires macOS @@MIN_MACOS@@ or newer.**

```
sha256  @@SHA256@@
```

---

Install — please read, the app will not open without step 3
-----------------------------------------------------------

1. Download `Forge-macos-arm64-@@VERSION@@.zip` and unzip it.
2. Drag `Forge.app` into `/Applications`.
3. **Remove the download quarantine flag.** Open Terminal and run:

   ```
   xattr -dr com.apple.quarantine /Applications/Forge.app
   ```

4. Open Forge normally.

### Why step 3 is not optional

This build is **ad-hoc signed and not notarized**. It has no Apple Developer ID
certificate behind it, because that is a paid credential this project does not
currently hold — it is not something the build can fix by itself.

macOS attaches a `com.apple.quarantine` attribute to everything downloaded from
a browser. When Gatekeeper evaluates a quarantined app that is not notarized, it
refuses to launch it, and the refusal dialog does not say "not notarized" — it
usually claims the app is damaged and offers to move it to the Bin. The app is
not damaged. That is simply how macOS reports an unnotarized download, and it is
why the command above is required rather than merely convenient.

The measured evidence, from the build that produced this artifact:

```
$ spctl -a -vvv -t exec Forge.app
Forge.app: rejected

$ echo $?
3

$ codesign --verify --deep --strict -v Forge.app
Forge.app: valid on disk
Forge.app: satisfies its Designated Requirement

$ codesign -dv Forge.app
Identifier=com.archdisc.forge
Signature=adhoc
TeamIdentifier=not set
```

The signature is *internally valid* — every bundled library is signed and the
bundle passes strict verification. What is missing is a Developer ID and a
notarization round-trip, which is the only thing that satisfies Gatekeeper.

If you would rather not use Terminal, `System Settings → Privacy & Security →
Open Anyway` works too, after one failed launch attempt.

### Verify what you downloaded

```
shasum -a 256 Forge-macos-arm64-@@VERSION@@.zip
```

and compare with the `sha256` above. The release also carries a
`.manifest.json` recording the measured OS floor, the per-file minimum-OS
census, and the Gatekeeper result for this exact artifact.

---

Requirements, and why the OS floor is what it is
------------------------------------------------

Forge bundles its own copies of OpenCASCADE, SDL2, oneTBB, the Vulkan loader
and MoltenVK, so nothing needs to be installed alongside it. Those libraries
come from Homebrew bottles, and **a Homebrew bottle records the macOS version
of the machine that built it** as its `LC_BUILD_VERSION` minimum. macOS refuses
to load a binary whose recorded minimum is newer than the running system.

So the floor is inherited from the build machine, not chosen. Forge's own two
binaries are compiled against an explicitly lower deployment target and are not
what sets it; the number above is measured across every Mach-O file actually
inside the bundle and written into `LSMinimumSystemVersion`, so the bundle
states its true requirement rather than an aspiration.

Running it on an older macOS than stated will fail in `dyld` at launch, not
gracefully.

Known limitations
-----------------

- **Apple Silicon only.** There is no Intel or universal build.
- **Not notarized** (see above).
- Installing Forge on a machine that also has Homebrew's `molten-vk` may print
  an `objc` duplicate-class warning for `MVKBlockObserver` on startup: the
  Vulkan loader finds both the bundled driver and the Homebrew one. It is
  harmless, and affects developer machines only — a machine without Homebrew
  loads exactly one driver.

Uninstall
---------

Drag `/Applications/Forge.app` to the Bin. Forge writes nothing outside its own
bundle.
