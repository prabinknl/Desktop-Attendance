import express from 'express';
import cors from 'cors';
import deviceRoutes from './routes/deviceRoutes.js';
import authRoutes from './routes/authRoutes.js';
import attendanceRoutes from './routes/attendanceRoutes.js';

const app = express();

app.use(
  cors({
    origin: ['http://localhost:3002', 'http://127.0.0.1:3002'],
    credentials: true,
  }),
);
app.use(express.json({ limit: '2mb' }));

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use('/api/auth', authRoutes);

// Singular (legacy) and plural (preferred) mounts share the same controllers
app.use('/api/device', deviceRoutes);
app.use('/api/devices', deviceRoutes);
app.use('/api/attendance', attendanceRoutes);

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[API Error]', err.message);
  res.status(500).json({ success: false, message: err.message });
});

export default app;
