import { describe, expect, it } from 'vitest';
import {
  computeInvitationExpiry,
  extractTokenFromInviteLink,
  INVITATION_TTL_MS,
  isInvitationExpired,
  isAdminInvitationRole,
  displayNameFromInviteEmail,
  publicAdminInvitePayload,
  maskInviteToken,
  normalizeInviteToken,
  validateInvitationRecord,
} from './invitationService.js';

const SAMPLE_TOKEN = 'a'.repeat(48);
const BASE_TIME = new Date('2026-08-05T10:00:00.000Z');

describe('invitationService', () => {
  it('accepts a valid token immediately after creation', () => {
    const result = validateInvitationRecord(
      { used: false, created_at: BASE_TIME.toISOString() },
      BASE_TIME,
    );
    expect(result.ok).toBe(true);
  });

  it('accepts a valid token after 239 minutes 59 seconds', () => {
    const almostExpired = new Date(BASE_TIME.getTime() + INVITATION_TTL_MS - 1_000);
    const result = validateInvitationRecord(
      { used: false, created_at: BASE_TIME.toISOString() },
      almostExpired,
    );
    expect(result.ok).toBe(true);
  });

  it('rejects an invitation after more than 240 minutes', () => {
    const expiredAt = new Date(BASE_TIME.getTime() + INVITATION_TTL_MS + 1);
    const result = validateInvitationRecord(
      { used: false, created_at: BASE_TIME.toISOString() },
      expiredAt,
    );
    expect(result).toEqual({
      ok: false,
      code: 'expired',
      message: 'This invitation link has expired.',
    });
  });

  it('rejects an already-used invitation', () => {
    const result = validateInvitationRecord(
      { used: true, created_at: BASE_TIME.toISOString() },
      BASE_TIME,
    );
    expect(result).toEqual({
      ok: false,
      code: 'already_used',
      message: 'This invitation has already been used.',
    });
  });

  it('rejects malformed tokens', () => {
    expect(normalizeInviteToken('abc')).toBeNull();
    expect(normalizeInviteToken('g'.repeat(48))).toBeNull();
  });

  it('extracts tokens from emailed path and hash links', () => {
    expect(extractTokenFromInviteLink(`https://example.com/invite/${SAMPLE_TOKEN}`)).toBe(SAMPLE_TOKEN);
    expect(extractTokenFromInviteLink(`http://127.0.0.1:3010/#/invite/${SAMPLE_TOKEN}`)).toBe(SAMPLE_TOKEN);
  });

  it('computes expiry as created_at plus 240 minutes', () => {
    const expires = computeInvitationExpiry(BASE_TIME);
    expect(expires.getTime()).toBe(BASE_TIME.getTime() + INVITATION_TTL_MS);
    expect(isInvitationExpired(BASE_TIME, expires)).toBe(false);
    expect(isInvitationExpired(BASE_TIME, new Date(expires.getTime() + 1))).toBe(true);
  });

  it('masks tokens in debug output', () => {
    expect(maskInviteToken(SAMPLE_TOKEN)).toBe('aaaa...aaaa');
  });

  it('accepts owner/admin invitation roles and rejects others', () => {
    expect(isAdminInvitationRole('admin')).toBe(true);
    expect(isAdminInvitationRole('client')).toBe(true);
    expect(isAdminInvitationRole('client_admin')).toBe(true);
    expect(isAdminInvitationRole('CLIENT_ADMIN')).toBe(true);
    expect(isAdminInvitationRole('accountant')).toBe(false);
    expect(isAdminInvitationRole('employee')).toBe(false);
    expect(isAdminInvitationRole('')).toBe(false);
  });

  it('derives a display name from the invited email', () => {
    expect(displayNameFromInviteEmail('jane.doe@client.com')).toBe('Jane Doe');
    expect(displayNameFromInviteEmail('admin@pace.com')).toBe('Admin');
  });

  it('exposes only name, email, and company from an admin invitation', () => {
    const payload = publicAdminInvitePayload({
      token: SAMPLE_TOKEN,
      email: 'invited.admin@client.com',
      role: 'client_admin',
      created_at: BASE_TIME.toISOString(),
      expires_at: BASE_TIME.toISOString(),
      used: false,
      company_name: 'Pace Consultant',
      phone: '+9779800000000',
    });
    expect(payload).toEqual({
      email: 'invited.admin@client.com',
      name: 'Invited Admin',
      companyName: 'Pace Consultant',
    });
    expect(payload).not.toHaveProperty('token');
    expect(payload).not.toHaveProperty('phone');
  });
});
