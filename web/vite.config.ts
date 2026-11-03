import { svelte, vitePreprocess } from '@sveltejs/vite-plugin-svelte'
import { defineConfig } from 'vite'

const hub = process.env.HUB_DEV_URL ?? 'http://localhost:8090'

// The web app for desktop and phone browsers. The hub serves it at /web/ next to the TV app.
export default defineConfig({
  root: import.meta.dirname,
  base: './',
  // The same background photos and credits as the TV app.
  publicDir: '../public',
  plugins: [svelte({ preprocess: vitePreprocess() })],
  // hls.js is large but loads only when a stream needs it.
  build: { outDir: '../dist/web', emptyOutDir: true, target: 'es2022', chunkSizeWarningLimit: 700 },
  server: {
    host: true,
    port: 5180,
    proxy: { '/api': hub, '/ws': { target: hub.replace(/^http/, 'ws'), ws: true } },
  },
})
