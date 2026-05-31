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

| Spec                     | What it covers                          |
|--------------------------|-----------------------------------------|
| `forge-bridge.spec.js`   | `isReady`, namespaces, makeBox round-trip, STEP I/O round-trip |
| `forge-viewport.spec.js` | per-kind: box / cyl / sphere / boolean-cut / 100k assembly / FEA / CAM / drawings — screenshots with the kernel output rendered as a panel |
| `_helpers.js`            | `launchForge`, `shot`, `loadInlinePage` |
| `playwright.headless.config.js` | headless config (separate from the headed root one — Studio's rule is headed; Forge self-verification is headless) |

## Adding a test

Use `loadInlinePage(page, '<html…>')` to render a CSS panel and `shot(page, '<NN>-<label>')` to capture it. The panel HTML is the visual artifact I scan; the assertions guard regressions.
