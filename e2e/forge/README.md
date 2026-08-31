# Forge headless E2E — self-verification suite

Headless Playwright tests that exercise `window.forge.*` end-to-end and
write a screenshot per assertion into
`test-results/forge-screenshots/`. The screenshots are how I
visually verify the kernel's output without a watcher — every commit
that touches a Forge-exposed API should re-run this suite and the
screenshots get diffed by eye.

## Run

```sh
./node_modules/.bin/playwright test e2e/forge/ \
  --config=e2e/forge/playwright.headless.config.js \
  --reporter=list
```

## Files

| File                     | What it covers                          |
|--------------------------|-----------------------------------------|
| `playwright.headless.config.js` | headless config (separate from the headed root one — Studio's rule is headed; Forge self-verification is headless) |
| `cadgenbench-cua-helper.js` | page-driven CUA helpers, imported by 3 specs |
| `*.spec.js` (240)        | the v4 behavioural suite — see `implementation/sacrosanct/FORGE_DELETION_PLAN.md` §5 T5 for why it is still the reference gate 3 is measured against |

### Retired

This table used to name three more files. They were the **pre-app-shell (v3-era)
harness**, and all three are gone from the tree:

| Retired file             | When | Why it could go |
|--------------------------|------|-----------------|
| `forge-bridge.spec.js`   | before this record | not in the tree; `git ls-files` finds neither it nor `forge-viewport.spec.js` |
| `forge-viewport.spec.js` | before this record | as above |
| `forge-v3-shell.spec.js` | #138 | read `frontend/src/forge-app/v3/tokens.css`, and `frontend/src/forge-app` has 0 tracked files |
| `forge-v3-live.spec.js`  | this pass | said it mounts "the v3 app"; that app has 0 tracked files, and the spec carries **zero** `expect(` — it screenshots v4 and asserts nothing |
| `_helpers.js`            | this pass | `launchForge`, `shot`, `loadInlinePage`, `SHOTS_DIR`. After `forge-v3-live.spec.js` went it had **no importer anywhere in the tree** — its own header says it exists so tests "must not require the React-mounted Forge app shell to exist (Forge-26 is in flight)", and that shell has shipped |
| `demo-ge9x-full-process.spec.js` | this pass | a self-declared "DEPRECATED SHIM" whose whole body was `require('./demo-leap1a-full-process.spec.js')`; the replacement it names is present, and the shim made Playwright register the LEAP-1A tests twice |

## Adding a test

`loadInlinePage()` / `shot()` are gone with `_helpers.js`. New specs launch
`electron/main.js` through `_electron.launch` directly, the way the 240 live
specs already do, and assert on `data-testid` selectors — a screenshot with no
`expect(` is not a gate.
