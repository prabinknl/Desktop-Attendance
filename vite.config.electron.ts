import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * Electron-only frontend build.
 * Uses relative asset URLs (base: './') and HashRouter-friendly output
 * without changing the hosted web Vite config.
 */
export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: 'dist-electron',
    emptyOutDir: true,
  },
  // Same-origin /api — Electron main serves the UI and proxies /api to the cloud.
  // Preload also exposes window.attendanceDesktop.apiBaseUrl = '/api'.
  define: {
    'import.meta.env.VITE_API_BASE_URL': JSON.stringify('/api'),
    'import.meta.env.VITE_IS_ELECTRON': JSON.stringify('true'),
  },
})
