import type { IncomingMessage, ServerResponse } from 'node:http';

process.env.DEVICE_SYNC_ENABLED ??= 'false';
process.env.APP_PUBLIC_URL ??= 'https://desktop-attendance.appnep.com';
process.env.ATTENDANCE_DATA_DIR ??= '/tmp/attendance-data';

export const vercelApiConfig = {
  api: { bodyParser: false as const },
  maxDuration: 30,
};

export function resolveApiUrl(req: IncomingMessage): string {
  const reqUrl = req.url ?? '/';
  const matchedPath =
    (req.headers['x-matched-path'] as string) ||
    (req.headers['x-forwarded-url'] as string) ||
    (req.headers['x-vercel-matched-path'] as string) ||
    '';

  if (matchedPath && matchedPath.startsWith('/api')) {
    const queryIdx = reqUrl.indexOf('?');
    if (queryIdx !== -1 && !matchedPath.includes('?')) {
      return `${matchedPath}${reqUrl.slice(queryIdx)}`;
    }
    return matchedPath;
  }
  if (!reqUrl.startsWith('/api')) {
    return `/api${reqUrl.startsWith('/') ? reqUrl : `/${reqUrl}`}`;
  }
  return reqUrl;
}

function writeJsonError(res: ServerResponse, message: string) {
  if (res.headersSent) return;
  res.statusCode = 500;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ success: false, message }));
}

type ExpressLike = (req: IncomingMessage, res: ServerResponse) => unknown;

export async function runExpressApp(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  try {
    const mod = await import('../server/src/app.js');
    const app = mod.default as ExpressLike;
    req.url = resolveApiUrl(req);

    await new Promise<void>((resolve, reject) => {
      const finish = () => resolve();
      res.once('finish', finish);
      res.once('close', finish);
      try {
        const result = app(req, res);
        if (result && typeof (result as Promise<unknown>).then === 'function') {
          (result as Promise<unknown>).catch((err: unknown) => {
            res.removeListener('finish', finish);
            res.removeListener('close', finish);
            reject(err);
          });
        }
      } catch (err) {
        res.removeListener('finish', finish);
        res.removeListener('close', finish);
        reject(err);
      }
    });
  } catch (error) {
    console.error('API handler failed:', error);
    writeJsonError(
      res,
      error instanceof Error ? error.message : 'API function failed',
    );
  }
}
