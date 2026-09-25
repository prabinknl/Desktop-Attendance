import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Same package.json version electron-builder stamps into the installer, so the
// version shown in the UI always matches the version that was released.
const pkgVersion = JSON.parse(
  readFileSync(fileURLToPath(new URL('./package.json', import.meta.url)), 'utf-8'),
).version

/**
 * Electron-only frontend build.
 * Uses relative asset URLs (base: './') and HashRouter-friendly output
 * without changing the hosted web Vite config.
 *
 * IMPORTANT: Packaged Electron starts a local backend on localhost:3002 with
 * device sync enabled. Device, attendance and core-data calls use the relative
 * /api path so they reach that local backend and the office LAN device.
 *
 * Auth, invitations and verification codes are the exception — they need SMTP
 * and the shared database, which only the hosted Hostinger backend has, so
 * they use VITE_CLOUD_API_BASE_URL (see src/api/cloudClient.ts).
 */
const CLOUD_API_BASE_URL =
  process.env.ELECTRON_CLOUD_API_TARGET?.trim() || 'https://desktop-attendance.appnep.com/api'

export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: 'dist-electron',
    emptyOutDir: true,
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('antd') || id.includes('@ant-design')) {
              return 'vendor-antd';
            }
            if (id.includes('jspdf') || id.includes('html2canvas')) {
              return 'vendor-pdf';
            }
            if (id.includes('recharts')) {
              return 'vendor-charts';
            }
            if (id.includes('framer-motion')) {
              return 'vendor-motion';
            }
            if (id.includes('react') || id.includes('react-dom') || id.includes('react-router-dom')) {
              return 'vendor-react';
            }
          }
        },
      },
    },
  },
  // Packaged Electron loads UI from local backend (http://127.0.0.1:${port}),
  // so all API calls via relative /api route to the local backend.
  define: {
    'import.meta.env.VITE_API_BASE_URL': JSON.stringify('/api'),
    'import.meta.env.VITE_IS_ELECTRON': JSON.stringify('true'),
    // Auth, invitations and verification codes need SMTP and the shared
    // database, which only the hosted backend has. Public URL only — SMTP_*
    // and DB_* must never appear as VITE_* variables.
    'import.meta.env.VITE_CLOUD_API_BASE_URL': JSON.stringify(CLOUD_API_BASE_URL),
    __APP_VERSION__: JSON.stringify(pkgVersion),
  },
})
