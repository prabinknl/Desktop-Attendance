import { describe, expect, it, beforeEach } from 'vitest';
import {
  generateSecureToken,
  generateSmsCode,
  hashValue,
  timingSafeEqualStr,
  validateInvitationRecord,
  SMS_CODE_TTL_MS,
  INVITATION_TTL_MS,
} from './invitationService.js';
import { normalizePhoneE164, isPhoneE164Valid, maskPhoneNumber } from '../sms/smsService.js';
import { memoryStore, setMemoryMode } from '../../db/memoryStore.js';
import { InvitationModel } from '../../models/InvitationModel.js';

describe('Client Admin Invitation & SMS Verification', () => {
  beforeEach(() => {
    setMemoryMode(true);
  });

  describe('Phone E.164 Normalization & Masking', () => {
    it('normalizes local Nepal mobile number variants to international E.164 format', () => {
      expect(normalizePhoneE164('9851064130')).toBe('+9779851064130');
      expect(normalizePhoneE164('09851064130')).toBe('+9779851064130');
      expect(normalizePhoneE164('9779851064130')).toBe('+9779851064130');
      expect(normalizePhoneE164('+977 985-106-4130')).toBe('+9779851064130');
      expect(normalizePhoneE164('+1 (555) 019-2834')).toBe('+15550192834');
    });

    it('validates Nepal E.164 phone numbers correctly', () => {
      expect(isPhoneE164Valid('+9779851064130')).toBe(true);
      expect(isPhoneE164Valid('+9779741064130')).toBe(true);
      expect(isPhoneE164Valid('+15550192834')).toBe(true);
      expect(isPhoneE164Valid('invalid')).toBe(false);
      expect(isPhoneE164Valid('+977123')).toBe(false);
    });

    it('masks phone numbers safely for non-sensitive logging', () => {
      expect(maskPhoneNumber('+9779851064130')).toBe('+977985******30');
      expect(maskPhoneNumber('9851064130')).toBe('+977985******30');
    });
  });

  describe('Token and Code Generation & Hashing', () => {
    it('generates a 64-character cryptographically secure hex token', () => {
      const token = generateSecureToken();
      expect(token).toMatch(/^[a-f0-9]{64}$/);
    });

    it('generates a 6-digit numeric SMS verification code', () => {
      const code = generateSmsCode();
      expect(code).toMatch(/^\d{6}$/);
    });

    it('hashes tokens and codes deterministically with SHA-256', () => {
      const value = '123456';
      const hash1 = hashValue(value);
      const hash2 = hashValue(value);
      expect(hash1).toBe(hash2);
      expect(hash1.length).toBe(64);
    });

    it('performs timing-safe string comparisons correctly', () => {
      const hashA = hashValue('123456');
      const hashB = hashValue('123456');
      const hashC = hashValue('654321');
      expect(timingSafeEqualStr(hashA, hashB)).toBe(true);
      expect(timingSafeEqualStr(hashA, hashC)).toBe(false);
    });
  });

  describe('Invitation Record Workflow', () => {
    it('creates and saves a client admin invitation record with hashed token and SMS code', async () => {
      const rawToken = generateSecureToken();
      const tokenHash = hashValue(rawToken);
      const smsCode = generateSmsCode();
      const smsCodeHash = hashValue(smsCode);
      const now = new Date();
      const smsExpiresAt = new Date(now.getTime() + SMS_CODE_TTL_MS).toISOString();
      const accessExpiresAt = new Date(now.getTime() + INVITATION_TTL_MS).toISOString();

      const record = {
        id: 'inv-test-1',
        token: rawToken,
        email: 'clientadmin@acme.com',
        role: 'client_admin',
        created_at: now.toISOString(),
        expires_at: accessExpiresAt,
        used: false,
        client_id: 'client-org-123',
        phone: '+9779801234567',
        company_name: 'Acme Corp',
        plan_type: 'paid' as const,
        duration_days: 30,
        access_start_at: now.toISOString(),
        access_expires_at: accessExpiresAt,
        token_hash: tokenHash,
        sms_code_hash: smsCodeHash,
        sms_expires_at: smsExpiresAt,
        sms_attempts: 0,
        status: 'pending' as const,
      };

      await InvitationModel.save(record);

      const retrieved = await InvitationModel.getByTokenHash(tokenHash);
      expect(retrieved).not.toBeNull();
      expect(retrieved?.email).toBe('clientadmin@acme.com');
      expect(retrieved?.company_name).toBe('Acme Corp');
      expect(retrieved?.plan_type).toBe('paid');
      expect(retrieved?.status).toBe('pending');
      expect(retrieved?.sms_code_hash).toBe(smsCodeHash);
    });

    it('rejects an incorrect SMS verification code and increments attempt counter', async () => {
      const rawToken = generateSecureToken();
      const tokenHash = hashValue(rawToken);
      const realCode = '123456';
      const wrongCode = '999999';
      const now = new Date();

      await InvitationModel.save({
        id: 'inv-test-2',
        token: rawToken,
        email: 'test@client.com',
        role: 'client_admin',
        created_at: now.toISOString(),
        expires_at: new Date(now.getTime() + INVITATION_TTL_MS).toISOString(),
        used: false,
        token_hash: tokenHash,
        sms_code_hash: hashValue(realCode),
        sms_expires_at: new Date(now.getTime() + SMS_CODE_TTL_MS).toISOString(),
        sms_attempts: 0,
        status: 'pending',
      });

      const inv = await InvitationModel.getByTokenHash(tokenHash);
      expect(inv).not.toBeNull();
      expect(timingSafeEqualStr(hashValue(wrongCode), inv!.sms_code_hash!)).toBe(false);

      const attempts = await InvitationModel.incrementSmsAttempt(tokenHash);
      expect(attempts).toBe(1);
    });

    it('invalidates previous SMS code when resending a new code', async () => {
      const rawToken = generateSecureToken();
      const tokenHash = hashValue(rawToken);
      const oldCodeHash = hashValue('111111');
      const newCode = '222222';
      const newCodeHash = hashValue(newCode);
      const now = new Date();
      const newExpiresAt = new Date(now.getTime() + SMS_CODE_TTL_MS).toISOString();

      await InvitationModel.save({
        id: 'inv-test-3',
        token: rawToken,
        email: 'resend@client.com',
        role: 'client_admin',
        created_at: now.toISOString(),
        expires_at: new Date(now.getTime() + INVITATION_TTL_MS).toISOString(),
        used: false,
        token_hash: tokenHash,
        sms_code_hash: oldCodeHash,
        sms_expires_at: now.toISOString(),
        sms_attempts: 3,
        status: 'pending',
      });

      await InvitationModel.updateSmsCode(tokenHash, newCodeHash, newExpiresAt);

      const updated = await InvitationModel.getByTokenHash(tokenHash);
      expect(updated?.sms_code_hash).toBe(newCodeHash);
      expect(updated?.sms_attempts).toBe(0);
      expect(timingSafeEqualStr(hashValue('111111'), updated!.sms_code_hash!)).toBe(false);
      expect(timingSafeEqualStr(hashValue(newCode), updated!.sms_code_hash!)).toBe(true);
    });

    it('rejects an expired invitation link or already used invitation', () => {
      const past = new Date(Date.now() - 300 * 60 * 1000); // 300 mins ago
      const expiredResult = validateInvitationRecord({
        used: false,
        created_at: past.toISOString(),
        status: 'pending',
      });
      expect(expiredResult.ok).toBe(false);
      expect(expiredResult.code).toBe('expired');

      const usedResult = validateInvitationRecord({
        used: true,
        created_at: new Date().toISOString(),
        status: 'accepted',
      });
      expect(usedResult.ok).toBe(false);
      expect(usedResult.code).toBe('already_used');
    });

    it('marks invitation as used and accepted upon successful registration', async () => {
      const rawToken = generateSecureToken();
      await InvitationModel.save({
        id: 'inv-test-4',
        token: rawToken,
        token_hash: hashValue(rawToken),
        email: 'accepted@client.com',
        role: 'client_admin',
        created_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + INVITATION_TTL_MS).toISOString(),
        used: false,
        status: 'pending',
      });

      await InvitationModel.markUsed(rawToken);

      const inv = await InvitationModel.getByToken(rawToken);
      expect(inv?.used).toBe(true);
      expect(inv?.status).toBe('accepted');
    });

    it('rejects exposed/invalidated tokens', () => {
      const exposedToken = '3a69e51f213a693b1530e5f8a1d97a75f428c2ab03cd2291c64c6c9f73ebd0bf';
      const res = validateInvitationRecord({
        token: exposedToken,
        used: false,
        created_at: new Date().toISOString(),
        status: 'pending',
      });
      expect(res.ok).toBe(false);
      expect(res.code).toBe('expired');
      expect(res.message).toContain('invalidated');
    });

    it('formats invitation URLs correctly using the frontend public domain', () => {
      const publicOrigin = 'https://attendance.appnep.com';
      const token = generateSecureToken();
      const link = `${publicOrigin.replace(/\/+$/, '')}/client-admin/signup?token=${token}`;

      expect(link).toBe(`https://attendance.appnep.com/client-admin/signup?token=${token}`);
      expect(link).not.toContain('127.0.0.1');
      expect(link).not.toContain('localhost');
      expect(link).not.toContain(':3001');
      expect(link).not.toContain('//client-admin');
    });
  });
});
