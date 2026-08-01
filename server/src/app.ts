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
    origin: env.corsOrigins,
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

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[API Error]', err.message);
  res.status(500).json({ success: false, message: err.message });
});

export default app;
