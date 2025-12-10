import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import cesium from 'vite-plugin-cesium'

export default defineConfig({
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
  }
})
