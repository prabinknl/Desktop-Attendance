import { afterEach, describe, expect, it, vi } from 'vitest';

const PROD_API = 'https://desktop-attendance.appnep.com/api';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function loadCloudClient({
  origin = 'http://127.0.0.1:3002',
  electron = true,
  dev = false,
  bridge,
}: {
  origin?: string;
  electron?: boolean;
  dev?: boolean;
  bridge?: AttendanceDesktopBridge;
} = {}) {
  vi.stubEnv('DEV', dev);
  vi.stubEnv('PROD', !dev);
  vi.stubEnv('VITE_IS_ELECTRON', String(electron));
  vi.stubEnv('VITE_API_BASE_URL', '/api');
  vi.stubGlobal('window', { location: new URL(origin), attendanceDesktop: bridge });
  return import('./cloudClient');
}

const desktopBridge: AttendanceDesktopBridge = {
  isElectron: true,
  apiBaseUrl: '/api',
  cloudApiBaseUrl: PROD_API,
};

describe('auth/email API routing', () => {
  it('sends packaged desktop auth calls to the hosted backend', async () => {
    const { CLOUD_API_BASE_URL } = await loadCloudClient({ bridge: desktopBridge });
    expect(CLOUD_API_BASE_URL).toBe(PROD_API);
  });

  it('falls back to the production API when the preload bridge is unavailable', async () => {
    const { CLOUD_API_BASE_URL } = await loadCloudClient({ bridge: undefined });
    expect(CLOUD_API_BASE_URL).toBe(PROD_API);
  });

  it('never lets a loopback override reach a packaged build', async () => {
    const { CLOUD_API_BASE_URL } = await loadCloudClient({
      bridge: { isElectron: true, cloudApiBaseUrl: 'http://127.0.0.1:3002/api' },
    });
    expect(CLOUD_API_BASE_URL).toBe(PROD_API);
  });

  it('appends /api to an origin-only override', async () => {
    const { CLOUD_API_BASE_URL } = await loadCloudClient({
      bridge: { isElectron: true, cloudApiBaseUrl: 'https://staging.appnep.com' },
    });
    expect(CLOUD_API_BASE_URL).toBe('https://staging.appnep.com/api');
  });

  it('keeps development on the local backend so offline work still functions', async () => {
    const { CLOUD_API_BASE_URL } = await loadCloudClient({
      origin: 'http://127.0.0.1:3000',
      dev: true,
      bridge: undefined,
    });
    expect(CLOUD_API_BASE_URL).toBe('/api');
  });

  it('keeps the hosted website on its same-origin API', async () => {
    const { CLOUD_API_BASE_URL } = await loadCloudClient({
      origin: 'https://desktop-attendance.appnep.com',
      electron: false,
      bridge: undefined,
    });
    expect(CLOUD_API_BASE_URL).toBe('/api');
  });

  it('posts verification codes to the hosted send-code route', async () => {
    const { default: client } = await loadCloudClient({ bridge: desktopBridge });
    const response = await client.post('/auth/admin/send-code', { email: 'owner@example.com' }, {
      adapter: async (config) => {
        expect(client.getUri(config)).toBe(`${PROD_API}/auth/admin/send-code`);
        return { data: { success: true }, status: 200, statusText: 'OK', headers: {}, config };
      },
    });
    expect(response.status).toBe(200);
  });
});

describe('auth/email error messages', () => {
  async function failWith(error: unknown) {
    const { default: client } = await loadCloudClient({ bridge: desktopBridge });
    return client
      .post('/auth/admin/send-code', {}, {
        adapter: () => Promise.reject(error),
      })
      .then(
        () => '',
        (err: Error) => err.message,
      );
  }

  function axiosError(extra: Record<string, unknown>) {
    return Object.assign(new Error(String(extra.message ?? 'Request failed')), {
      isAxiosError: true,
      config: { url: '/auth/admin/send-code', baseURL: PROD_API, method: 'post' },
      ...extra,
    });
  }

  it('explains a server that is unreachable or blocking the origin', async () => {
    const message = await failWith(axiosError({ code: 'ERR_NETWORK', message: 'Network Error' }));
    expect(message).toMatch(/Could not reach the online server/i);
    expect(message).toMatch(/CORS/);
  });

  it('explains a request timeout', async () => {
    const message = await failWith(axiosError({ code: 'ECONNABORTED' }));
    expect(message).toMatch(/timed out/i);
  });

  it('turns the raw SMTP env error into hosting guidance', async () => {
    const message = await failWith(
      axiosError({
        response: {
          status: 503,
          data: {
            success: false,
            message:
              'Missing required email environment variables: SMTP_HOST, SMTP_USER, SMTP_PASS. Set them in the hosting environment, not as VITE_* variables.',
          },
        },
      }),
    );
    expect(message).toMatch(/missing its email configuration/i);
    expect(message).toMatch(/Hostinger/);
  });

  it('distinguishes rejected SMTP credentials from missing ones', async () => {
    const message = await failWith(
      axiosError({
        response: { status: 503, data: { success: false, message: 'SMTP authentication failure' } },
      }),
    );
    expect(message).toMatch(/credentials were rejected/i);
  });

  it('reports an unreachable mail host', async () => {
    const message = await failWith(
      axiosError({
        response: { status: 503, data: { success: false, message: 'SMTP connection timeout' } },
      }),
    );
    expect(message).toMatch(/could not reach the mail host/i);
  });

  it('never echoes a secret-looking query parameter into the message', async () => {
    const message = await failWith(
      axiosError({
        code: 'ERR_NETWORK',
        message: 'Network Error',
        config: {
          url: '/auth/admin/verify-code?code=123456&token=abcdef',
          baseURL: PROD_API,
          method: 'post',
        },
      }),
    );
    expect(message).not.toMatch(/123456|abcdef/);
    // URLSearchParams percent-encodes the brackets when the URL is rebuilt.
    expect(message).toMatch(/(\[redacted\]|%5Bredacted%5D)/);
  });
});
