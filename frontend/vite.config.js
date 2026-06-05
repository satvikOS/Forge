import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import cesium from 'vite-plugin-cesium'

export default defineConfig({
  base: './',  // relative paths for Electron file:// protocol
  plugins: [react(), cesium()],
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: process.env.VITE_API_URL || 'http://localhost:5000',
        changeOrigin: true,
      }
    }
  },
  optimizeDeps: {
    include: ['three', '@react-three/fiber', '@react-three/drei', 'resium', 'cesium'],
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    rollupOptions: {
      // Optional PDF deps used only by Forge-90/130 DrawingsWorkbench
      // via dynamic import inside try/catch. Externalising lets Rollup
      // skip static resolution; runtime gracefully falls back to SVG.
      external: ['html2canvas', 'jspdf'],
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom'],
          'three-vendor': ['three', '@react-three/fiber', '@react-three/drei'],
        },
      },
    },
    chunkSizeWarningLimit: 1000,
  }
})
