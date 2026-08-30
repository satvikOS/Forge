# Opening Forge for the first time on macOS

Forge is distributed from GitHub Releases (and later from the ArchDisc
website), not from the Mac App Store. The very first time you open a
downloaded copy, macOS refuses and you have to approve it once, by hand. This
page is the exact sequence. It is four clicks and you never do it again for
that copy of the app.

---

## Install

1. **Download** `Forge-macos-arm64-<version>.zip` from the release page.
   Forge is Apple Silicon only (M1 or newer).
2. **Unzip it**, then **drag `Forge.app` into your `Applications` folder.**
   Do this *before* the next step — approving a copy that is still sitting in
   `Downloads` approves the copy in `Downloads`, and you will be asked again
   after you move it.
3. **Double-click Forge.** It will *not* open. That failed attempt is
   required: it is what puts Forge into the list you are about to visit.

   The dialog you get says one of the following, depending on your macOS
   version. They all mean the same thing:

   - macOS 15 (Sequoia) and later, including macOS 26 —
     **“Forge” Not Opened**, with the detail *“Apple could not verify “Forge”
     is free of malware that may harm your Mac or compromise your privacy.”*
   - Older macOS — **“Forge” cannot be opened because the developer cannot be
     verified**, or *“Forge” can’t be opened because the developer didn’t
     notarize it.*

   Click **Done**. Do **not** click *Move to Trash*.

4. **Open System Settings → Privacy & Security.** Scroll down to the
   **Security** section, below *Allow applications from*. You will see a line
   reading **“Forge” was blocked to protect your Mac.** with an **Open Anyway**
   button next to it.

   > This line only appears *after* the blocked launch in step 3, and it does
   > not stay there forever. If you do not see it, go back and double-click
   > Forge again, then return here.

5. **Click “Open Anyway.”** macOS asks you to authenticate — Touch ID, or your
   login password — with the explanation *“You are attempting to open an app
   that may cause harm to your Mac or compromise your privacy.”* Approve it.

6. A **final confirmation dialog** appears. Click **Open**. Forge launches.

That is the whole thing. From now on Forge opens by double-clicking it like
any other app.

### Do not use right-click → Open

Older instructions on the internet — and older versions of our own notes — tell
you to Control-click (right-click) the app and choose *Open*. **That shortcut
was removed in macOS 15 (Sequoia)** and does nothing on any current version of
macOS. If a page tells you to do that, it is out of date. The System Settings
route above is the one Apple documents today, and it is the only one that
works.

### If you would rather use Terminal

The steps above are the supported route and you do not need this. But the
approval is really just macOS clearing a "downloaded from the internet" mark,
and this does the same thing in one command:

```sh
xattr -dr com.apple.quarantine /Applications/Forge.app
```

Only run a command like that for software you actually meant to download.
Being talked into running it for something else is a standard way people get
malware onto a Mac, which is exactly why Apple made the GUI route the
documented one.

---

## Why this happens, in plain language

Forge **is** code-signed — the signature is intact and macOS verifies it fine.
What Forge does not have is **notarization**: an Apple review stamp that
requires a paid Apple Developer ID certificate, which costs money every year
and which we have not bought yet. macOS treats “signed by a real developer
account and stamped by Apple” as the trusted case and everything else — Forge
included — as the case that needs your explicit say-so.

So the warning is not telling you something is wrong with the download. It is
telling you Apple has not personally vouched for it. You are the one vouching,
which is what the one-time approval is.

**You approve a copy of the app, not the name “Forge.”** So:

- The app updating *itself* in place does not ask again. Nothing new gets
  downloaded through a browser, so nothing gets re-marked, and the prompt does
  not come back.
- Downloading a *new version by hand* and replacing the old one is a fresh
  download, and you will approve that copy once too.

Which of those applies depends on the build — see the table below.

| Build | Auto-updates itself? | Approval repeats on each new version? |
|---|---|---|
| Electron build (`ArchDiscForge-*.dmg` / `.zip`) | Yes — `electron-updater`, wired against this repo's GitHub Releases | No |
| Native desktop build (`Forge-macos-arm64-*.zip`) | **Not yet** — no in-app updater exists in `forge-desktop` today | Yes, until an updater ships |

We will drop the whole approval step entirely, for every build, the day a
Developer ID certificate and notarization are in place. Nothing about your
install has to change when that happens.

---

## Appendix — what was measured, and what was not

Written 2026-08-30. Everything in the "measured" list was run on this machine
against a real packaged bundle; do not restate the "not verified" items as
fact.

**Host used for the measurements**

```
$ sw_vers
ProductName:    macOS
ProductVersion: 26.6.2
BuildVersion:   25G83
```

**Measured — the signature is valid, and Gatekeeper still refuses it**

Against `Forge-macos-arm64-0.1.0-final.zip`, extracted with `ditto -x -k`:

```
$ codesign -dvvv Forge.app
Identifier=com.archdisc.forge
CodeDirectory v=20400 flags=0x2(adhoc)
Signature=adhoc
TeamIdentifier=not set

$ codesign -v --deep --strict Forge.app   ; echo $?
0

$ spctl -a -vvv -t exec Forge.app
Forge.app: rejected                        (exit 3)
```

Re-run with `com.apple.quarantine` set on the bundle: `codesign` still exits
`0`, `spctl` still exits `3`. **The quarantine attribute changes neither
verdict.** `spctl` assesses signature *policy*, and an ad-hoc signature can
never satisfy it — this is expected and is not a packaging defect. Do not try
to make `spctl` pass.

```
$ security find-identity -v -p codesigning
0 valid identities found
```

No Developer ID certificate exists on this machine, which is why the signature
is ad-hoc.

**Measured — Apple's own tooling names the two problems**

```
$ syspolicy_check distribution Forge.app
Adhoc Signed App
    Severity: Warning
    This app is adhoc signed. While it may run locally, adhoc signed apps are
    not suitable for distribution.
Notary Ticket Missing
    Severity: Fatal
    A Notarization ticket is not stapled to this application.
```

**Measured — the exact user-facing strings, read out of macOS 26.6.2 itself**

Extracted with `plutil -extract en json` from the system frameworks, so these
are the literal strings this OS will display:

| String | Source |
|---|---|
| `“%@” Not Opened` | `CoreServicesUIAgent.app/.../QuarantineHeadlines.loctable` → `Q_HEADLINE_SUNFISH_NOT_VERIFIED` |
| `Apple could not verify “%@” is free of malware that may harm your Mac or compromise your privacy.` | `.../Quarantine.loctable` → `Q_DETAIL_CASPIAN_UNVERIFIED` |
| `“%@” can’t be opened because the developer didn’t notarize it.` | `.../FirstLaunch.loctable` → `FIRST_LAUNCH_UNNOTARIZED_HEADLINE` |
| `“%@” was blocked to protect your Mac.` | `SecurityPrivacyExtension.appex/.../Localizable.loctable` |
| `Open Anyway` | same file, and `.../CodeEvaluation.loctable` → `OPEN_ANYWAY_BUTTON` |
| `Open` | `.../CodeEvaluation.loctable` → `OPEN_BUTTON` |
| `You are attempting to open an app that may cause harm to your Mac or compromise your privacy` | `SystemPolicy.framework/.../Localizable.loctable` → `GK_OVERRIDE_AUTH_EXPLANATION` |

Note what this shows: on macOS 26 there is **no** string reading “cannot be
opened because the developer cannot be verified.” That is older wording. Both
phrasings are given in step 3 above so a reader on any version recognises
their own dialog.

**Verified against Apple's current published guidance**

`https://support.apple.com/en-us/102445` documents the route as: try to open
the app, then *System Settings → Privacy & Security → scroll down → Open
Anyway → confirm with Open*. It does **not** mention Control-click or
right-click anywhere. The removal of the Control-click override in macOS 15
Sequoia is reported by AppleInsider (2024-08-06) and others; Apple's own page
simply no longer documents it.

**Measured — the auto-update claim, per build**

- `electron-updater@^6.3.9` is a dependency in `package.json`, initialised in
  `electron/main.js` (`autoDownload = true`, `autoInstallOnAppQuit = true`),
  bridged to the renderer in `electron/preload.js`, and pointed at GitHub
  Releases by `electron-builder.yml`. The Electron build auto-updates.
- `grep -rn -iE 'update_check|autoupdat|sparkle|check_for_update|https://'`
  over `forge-desktop/src` (14 source files) returns **nothing**. The native
  `forge_desktop` binary has no updater and no network client. A statement
  that "updates arrive automatically" is therefore **false for the native
  artifact today** and must not appear in its release notes.

**NOT verified — stated here so nobody upgrades it to a fact**

- The exact headline/detail *pairing* the dialog uses for this specific bundle.
  All the candidate strings are present in macOS 26.6.2 (above), but confirming
  which pair renders would mean triggering the GUI dialog, which was not done.
  Step 3 lists every candidate rather than guessing one.
- That the recorded approval is keyed to the app *version* rather than the app
  *path or name*. The user-visible consequence in the table above follows from
  a re-download carrying a fresh quarantine attribute, which is independently
  true; the keying itself was not measured.
- Behaviour on macOS versions other than 26.6.2. Nothing older was available to
  test on.
