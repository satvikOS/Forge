# forge-kernel — Native Build Requirements

## Mac Studio M4 Max (primary dev box)

- Xcode Command Line Tools (provides Apple Clang 21)
- `brew install cmake opencascade`  → OCCT 7.9.3 at `/opt/homebrew/opt/opencascade`
- `npm install` at repo root → installs `node-addon-api`, `cmake-js`

Build:

```sh
npm run forge:kernel        # configure + build → forge-kernel/build/Release/forge-kernel.node
npm run forge:kernel:test   # node forge-kernel/test/smoke.js
```

## Notes

- OCCT 7.9 reorganised the Data Exchange toolkits: STEP/IGES/STL/VRML now
  live in `TKDE*` libraries with the shared `TKDE` base. CMakeLists.txt
  reflects this — links against `TKDESTEP`, `TKDEIGES`, `TKDESTL`,
  `TKDEVRML`, `TKXSBase`, `TKDE`.
- Built with `cmake-js` (not `node-gyp`) because cmake-js handles the
  Node-header download and the Electron-ABI rebuild story cleanly. Pure
  `cmake` works too if you pass `-DCMAKE_JS_INC=$(node -p ...)`.
- The `.node` file is a Mach-O bundle with bundle-loader linkage; symbols
  like `napi_*` resolve at load time against the host process (Node /
  Electron). `-undefined dynamic_lookup` is set by cmake-js.

## Electron rebuild

When Electron's V8 ABI differs from the Node we built against,
`./node_modules/.bin/electron-rebuild` (already a transitive dep via
electron-builder) rebuilds the addon for Electron's ABI. Not yet wired
into the dev workflow — slice Forge-5 covers that.
