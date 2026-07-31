import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Avoid scanning build artifacts (release/, dist-electron/) — OneDrive can leave
  // those HTML files unreadable and crash Vite's dependency optimizer.
  optimizeDeps: {
    entries: ['index.html'],
  },
  server: {
    // Bind IPv4 explicitly so Electron + wait-on (127.0.0.1) can reach the UI.
    // On some Windows setups Vite defaults to ::1 only.
    host: '127.0.0.1',
    port: 3002,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3001',
        changeOrigin: true,
      },
    },
  },
})
