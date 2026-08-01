---
description: Project conventions for the Attendance Desktop application
globs: *
alwaysApply: true
---

# Attendance Desktop — Project Conventions

## Architecture

- **Frontend**: React + Vite + Tailwind CSS (SPA served via Vite dev server or Electron)
- **Backend**: Express API in `server/` with PostgreSQL
- **Desktop**: Electron shell wrapping the frontend + embedded API server
- **Gateway**: Lightweight Node.js bridge connecting LAN Hikvision ISAPI devices to the API

## Key Patterns

- The frontend communicates with the Express API via axios (`src/api/client.ts`)
- Database inserts use array format: `[{ ... }]`
- Electron uses `HashRouter`; web builds use `BrowserRouter`
- Device sync is LAN-only via Hikvision ISAPI Digest Auth
