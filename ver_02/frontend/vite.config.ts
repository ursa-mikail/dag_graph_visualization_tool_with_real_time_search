import { defineConfig } from 'vite'

const backendHost = process.env.BACKEND_HOST || 'localhost'
const backendPort = process.env.BACKEND_PORT || '8081'
const backendURL  = `http://${backendHost}:${backendPort}`

export default defineConfig({
  server: {
    host: '0.0.0.0',
    port: 3001,
    proxy: {
      '/api': { target: backendURL, changeOrigin: true },
      '/ws':  { target: backendURL.replace('http','ws'), ws: true, changeOrigin: true },
    }
  },
  build: { outDir: 'dist', sourcemap: false }
})
