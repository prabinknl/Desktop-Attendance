import { afterEach, describe, expect, it, vi } from 'vitest';

const cloudApi = 'https://desktop-attendance.appnep.com/api';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function loadClient({
  origin = 'http://127.0.0.1:3002',
  electron = false,
  configured = '',
  bridge,
}: {
  origin?: string;
  electron?: boolean;
  configured?: string;
  bridge?: AttendanceDesktopBridge;
} = {}) {
  vi.stubEnv('PROD', true);
  vi.stubEnv('VITE_IS_ELECTRON', String(electron));
  vi.stubEnv('VITE_API_BASE_URL', configured);
  vi.stubGlobal('window', { location: new URL(origin), attendanceDesktop: bridge });
  return import('./client');
}

describe('API routing', () => {
  it.each(['http://127.0.0.1:3002', 'http://127.0.0.1:3017'])(
    'keeps packaged device requests on the local UI origin %s',
    async (origin) => {
      const { API_BASE_URL, default: client } = await loadClient({
        origin,
        electron: true,
        configured: '/api',
        bridge: { isElectron: true, apiBaseUrl: '/api' },
      });
      expect(API_BASE_URL).toBe('/api');
      const response = await client.post('/devices/test-connection', {}, {
        adapter: async (config) => {
          expect(new URL(client.getUri(config), origin).href)
            .toBe(`${origin}/api/devices/test-connection`);
          return { data: {}, status: 200, statusText: 'OK', headers: {}, config };
        },
      });
      expect(response.status).toBe(200);
    },
  );

  it('honors the relative preload setting over a hosted build URL', async () => {
    const { API_BASE_URL } = await loadClient({
      configured: cloudApi,
      bridge: { isElectron: true, apiBaseUrl: '/api' },
    });
    expect(API_BASE_URL).toBe('/api');
  });

  it('defaults the desktop bundle to local API when preload is unavailable', async () => {
    const { API_BASE_URL } = await loadClient({ electron: true, configured: cloudApi });
    expect(API_BASE_URL).toBe('/api');
  });

  it('honors an explicit absolute runtime API setting', async () => {
    const { API_BASE_URL } = await loadClient({
      electron: true,
      bridge: { isElectron: true, apiBaseUrl: 'http://127.0.0.1:3017/api' },
    });
    expect(API_BASE_URL).toBe('http://127.0.0.1:3017/api');
  });

  it('keeps the hosted website on its configured public API', async () => {
    const { API_BASE_URL } = await loadClient({
      origin: 'https://attendance.appnep.com', configured: cloudApi,
    });
    expect(API_BASE_URL).toBe(cloudApi);
  });

  it('defaults web requests to the same origin', async () => {
    const { API_BASE_URL } = await loadClient({ origin: 'https://attendance.appnep.com' });
    expect(API_BASE_URL).toBe('/api');
  });

  it('does not let a hosted build target loopback', async () => {
    const { API_BASE_URL } = await loadClient({
      origin: 'https://attendance.appnep.com', configured: 'http://127.0.0.1:3002/api',
    });
    expect(API_BASE_URL).toBe('/api');
  });
});
