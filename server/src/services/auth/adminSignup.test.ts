import { describe, expect, it, beforeEach } from 'vitest';
import { InvitationModel } from '../../models/InvitationModel.js';
import { UserModel } from '../../models/UserModel.js';
import {
  generateVerificationCode,
  storeVerificationCode,
  verifyStoredCode,
  canResendVerificationCode,
} from './adminVerification.js';

describe('Admin Sign Up Verification Service', () => {
  const testEmail = 'newadmin@testcompany.com';

  beforeEach(async () => {
    await UserModel.deleteById('test-admin-usr-1');
  });

  it('generates a 6-digit numeric verification code', () => {
    const code = generateVerificationCode();
    expect(code).toMatch(/^\d{6}$/);
  });

  it('stores and correctly verifies verification code for invited email', () => {
    const code = '654321';
    storeVerificationCode(testEmail, code);

    // Incorrect code should fail
    const wrongRes = verifyStoredCode(testEmail, '111111');
    expect(wrongRes.ok).toBe(false);

    // Correct code should succeed
    const correctRes = verifyStoredCode(testEmail, code);
    expect(correctRes.ok).toBe(true);

    // Code is single-use: subsequent verification fails
    const reusedRes = verifyStoredCode(testEmail, code);
    expect(reusedRes.ok).toBe(false);
  });

  it('enforces 60-second cooldown for resending verification code', () => {
    const email = 'cooldown@testcompany.com';
    storeVerificationCode(email, '123456');

    // Immediately requesting resend should return false
    expect(canResendVerificationCode(email)).toBe(false);
  });

  it('saves admin user in pending_verification status and updates to active upon email verification', async () => {
    const user = await UserModel.upsert({
      id: 'test-admin-usr-1',
      name: 'Test Admin',
      email: testEmail,
      role: 'admin',
      password: 'securepassword123',
      phone: '+9779800000000',
      status: 'pending_verification',
      emailVerified: false,
    });

    expect(user).not.toBeNull();
    expect(user?.status).toBe('pending_verification');
    expect(user?.emailVerified).toBe(false);

    // Update status upon successful email verification
    await UserModel.updateStatus(testEmail, 'active', true);
    const updated = await UserModel.getByEmail(testEmail);
    expect(updated?.status).toBe('active');
    expect(updated?.emailVerified).toBe(true);
  });
});
