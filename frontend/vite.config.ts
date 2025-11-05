import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: '/',
  build: {
    outDir: '../output/dist',
    emptyOutDir: true,
  },
  server: {
    port: 3000,
    proxy: {
      '/output': {
        target: 'http://localhost:8080',
        changeOrigin: true,
      }
    }
  }
})

