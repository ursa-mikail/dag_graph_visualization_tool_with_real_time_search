import { defineConfig } from 'vite'

const backendHost = process.env.BACKEND_HOST || 'localhost'
const backendPort = process.env.BACKEND_PORT || '8080'
const backendURL  = `http://${backendHost}:${backendPort}`
const wsURL       = `ws://${backendHost}:${backendPort}`

export default defineConfig({
  server: {
    host: '0.0.0.0',
    port: 3000,
    proxy: {
      '/api': {
        target: backendURL,
        changeOrigin: true,
      },
      '/ws': {
        target: wsURL,
        ws: true,
        changeOrigin: true,
      }
    }
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  }
})
