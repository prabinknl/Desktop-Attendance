import express from 'express';
import cors from 'cors';
import deviceRoutes from './routes/deviceRoutes.js';
import authRoutes from './routes/authRoutes.js';
import attendanceRoutes from './routes/attendanceRoutes.js';
import coreRoutes from './routes/coreRoutes.js';
import { env } from './config/env.js';
import { getInsForgeStatus } from './services/insforge/insforgeClient.js';

import { authorizeAccountantPermissions } from './middleware/authMiddleware.js';
import gatewayRoutes from './routes/gatewayRoutes.js';

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

// Fallback for non-API GET routes (e.g., /client-admin/signup or /invite/...) when opened on the backend API port 3001
app.use((req, res, next) => {
  if (req.method !== 'GET' || req.path.startsWith('/api/')) return next();
  const targetOrigin = env.appPublicUrl || 'http://127.0.0.1:3002';
  return res.redirect(302, `${targetOrigin.replace(/\/+$/, '')}${req.originalUrl}`);
});

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[API Error]', err.message);
  res.status(500).json({ success: false, message: err.message });
});

export default app;
