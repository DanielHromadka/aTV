/// <reference types="vitest/config" />
import preact from '@preact/preset-vite'
import legacy from '@vitejs/plugin-legacy'
import { defineConfig } from 'vite'

const hub = process.env.HUB_DEV_URL ?? 'http://localhost:8090'

export default defineConfig({
  // Relative asset paths: packaged .wgt/.ipk apps load index.html from file://.
  base: './',
  // Oldest target is Tizen 3.0 (2017 Samsung TVs), whose web engine is Chromium 47.
  plugins: [preact(), legacy({ targets: ['chrome >= 47'] })],
  build: {
    target: 'chrome47',
    minify: 'terser',
    terserOptions: { ecma: 5, compress: { arrows: false }, format: { ecma: 5 } },
    rollupOptions: { input: { main: 'index.html', remote: 'remote.html' } },
  },
  server: {
    host: true,
    port: 5173,
    // In development the hub runs separately (`npm run hub`); the dev server forwards to it.
    proxy: { '/api': hub, '/ws': { target: hub.replace(/^http/, 'ws'), ws: true } },
  },
  preview: { host: true, port: 4173 },
  test: { include: ['shared/**/*.test.ts', 'hub/**/*.test.ts', 'src/**/*.test.ts'] },
})
