import { defineConfig } from 'vite'

export default defineConfig({
  root: 'web',
  server: {
    proxy: {
      '/content': 'http://127.0.0.1:8080',
    },
  },
  build: {
    outDir: '../server/web/dist',
    emptyOutDir: true,
  },
})
