import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import deviceRoutes from './routes/deviceRoutes.js';
import authRoutes from './routes/authRoutes.js';
import attendanceRoutes from './routes/attendanceRoutes.js';
import coreRoutes from './routes/coreRoutes.js';
import { env } from './config/env.js';
import { getInsForgeStatus } from './services/insforge/insforgeClient.js';

import { authorizeAccountantPermissions } from './middleware/authMiddleware.js';
import gatewayRoutes from './routes/gatewayRoutes.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function resolveClientDistPath(): string | null {
  if (process.env.CLIENT_DIST_PATH && fs.existsSync(path.join(process.env.CLIENT_DIST_PATH, 'index.html'))) {
    return path.resolve(process.env.CLIENT_DIST_PATH);
  }
  const candidates = [
    path.resolve(__dirname, '../../dist'),
    path.resolve(__dirname, '../../dist-electron'),
    path.resolve(__dirname, '../public'),
    path.resolve(__dirname, 'public'),
    path.resolve(process.cwd(), 'dist'),
    path.resolve(process.cwd(), 'dist-electron'),
    path.resolve(process.cwd(), 'public'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, 'index.html'))) {
      return candidate;
    }
  }
  return null;
}

const app = express();

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (like mobile apps, curl, Postman, Electron file://)
      if (!origin) return callback(null, true);

      // In non-production development mode, allow any local loopback origin (port 3002, 3003, etc.)
      if (env.nodeEnv !== 'production' && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
        return callback(null, true);
      }

      if (env.corsOrigins === true) return callback(null, true);
      if (Array.isArray(env.corsOrigins) && env.corsOrigins.includes(origin)) {
        return callback(null, true);
      }

      return callback(null, false);
    },
    credentials: true,
  }),
);
app.use(express.json({ limit: '2mb' }));

app.get('/api/health', async (_req, res) => {
  const insforgeStatus = await getInsForgeStatus();
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    // The frontend hides device settings when the API cannot reach the LAN
    deviceSyncEnabled: env.deviceSyncEnabled,
    insforge: insforgeStatus,
  });
});

app.use('/api/auth', authRoutes);

// Local connector agent (ISAPI on LAN → HTTPS to cloud)
app.use('/api/gateway', gatewayRoutes);

// Apply authorization middleware for Accountant role security enforcement
app.use(authorizeAccountantPermissions);

// Singular (legacy) and plural (preferred) mounts share the same controllers
app.use('/api/device', deviceRoutes);
app.use('/api/devices', deviceRoutes);
app.use('/api/attendance', attendanceRoutes);
// Employees, departments, shifts, holidays, leave and punch requests
app.use('/api/data', coreRoutes);

// Serve frontend static assets and SPA fallback
const clientDist = resolveClientDistPath();
if (clientDist) {
  console.log(`[Server] Serving frontend static assets from: ${clientDist}`);
  app.use(express.static(clientDist));

  // SPA fallback for all non-API GET routes
  app.use((req, res, next) => {
    if (req.method !== 'GET' || req.path.startsWith('/api/')) return next();
    // Do not return HTML for missing static assets (.js, .css, .ico, etc.)
    if (path.extname(req.path)) {
      return res.status(404).send('Not found');
    }
    return res.sendFile(path.join(clientDist, 'index.html'));
  });
} else {
  // Fallback for non-API GET routes when frontend dist is not built
  app.use((req, res, next) => {
    if (req.method !== 'GET' || req.path.startsWith('/api/')) return next();
    const targetOrigin = env.appPublicUrl || 'http://127.0.0.1:3002';
    return res.redirect(302, `${targetOrigin.replace(/\/+$/, '')}${req.originalUrl}`);
  });
}

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[API Error]', err.message);
  res.status(500).json({ success: false, message: err.message });
});

export default app;

