import { afterEach, describe, expect, it } from 'vitest';
import { hostedApiBase } from './hostedDeviceProfile.js';

describe('hosted device profile', () => {
  const previous = process.env.CLOUD_API_BASE_URL;

  afterEach(() => {
    if (previous === undefined) delete process.env.CLOUD_API_BASE_URL;
    else process.env.CLOUD_API_BASE_URL = previous;
  });

  it('uses the shared server and skips a loopback address', () => {
    process.env.CLOUD_API_BASE_URL = 'http://127.0.0.1:3002/api';
    expect(hostedApiBase() ?? '').not.toMatch(/127\.0\.0\.1|localhost/);

    process.env.CLOUD_API_BASE_URL = 'https://desktop-attendance.appnep.com/api';
    expect(hostedApiBase()).toBe('https://desktop-attendance.appnep.com/api');
  });
});
