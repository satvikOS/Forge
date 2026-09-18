// T-168 census harness — regenerates scripts/js_live_bundle.txt.
//
// Wraps the real vite.config.js and dumps the exact set of module ids that
// Rollup pulled into the bundle. This is the bundler's own ground truth: it
// sees dynamic import(), re-exports, aliases and plugin-injected modules,
// because it is the same resolver that builds the shipped artifact.
//
//   cd frontend
//   FORGE_CENSUS_OUT=/tmp/m.txt ./node_modules/.bin/vite build \
//        --config vite.config.census.mjs
//   # Rollup writes virtual module ids with a LEADING NUL BYTE, which makes
//   # the output a binary file — grep silently refuses to read it and exits 1
//   # with no output. Strip the NULs before filtering, or you will read a
//   # harness failure as "no matches".
//   tr '\0' '@' < /tmp/m.txt | grep "$PWD/src" | grep -v node_modules \
//     | sed "s|.*/frontend/|frontend/|; s|?.*||" | sort -u \
//     | grep -E '\.(js|jsx|mjs|cjs)$' > ../scripts/js_live_bundle.txt
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import cesium from 'vite-plugin-cesium'
import fs from 'node:fs'

export default defineConfig({
  base: './',
  plugins: [
    react(),
    cesium(),
    {
      name: 'forge-module-census',
      buildEnd() {
        const ids = []
        for (const id of this.getModuleIds()) ids.push(id)
        ids.sort()
        fs.writeFileSync(
          process.env.FORGE_CENSUS_OUT || '/tmp/forge-rollup-modules.txt',
          ids.join('\n') + '\n'
        )
        this.warn(`forge-module-census: ${ids.length} module ids written`)
      },
    },
  ],
  optimizeDeps: {
    include: ['three', '@react-three/fiber', '@react-three/drei', 'resium', 'cesium'],
  },
  build: {
    outDir: 'dist/.census',   // inside the git-ignored dist/
    sourcemap: false,
    rollupOptions: {
      external: ['html2canvas', 'jspdf'],
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom'],
          'three-vendor': ['three', '@react-three/fiber', '@react-three/drei'],
        },
      },
    },
    chunkSizeWarningLimit: 1000,
  },
})
