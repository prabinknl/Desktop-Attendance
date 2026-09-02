import crypto from 'crypto';
import type { InvitationRecord } from '../../db/memoryStore.js';

/** Invitations remain valid for 240 minutes after creation (server clock). */
export const INVITATION_TTL_MS = 240 * 60 * 1000;
/** SMS verification codes expire after 10 minutes. */
export const SMS_CODE_TTL_MS = 10 * 60 * 1000;
/** Cooldown before a new SMS code can be resent (60 seconds). */
export const SMS_RESEND_COOLDOWN_MS = 60 * 1000;
/** Maximum invalid SMS verification code attempts allowed before lock out. */
export const MAX_SMS_ATTEMPTS = 5;

export type InvitationErrorCode =
  | 'invalid_token'
  | 'not_found'
  | 'expired'
  | 'already_used'
  | 'invalid_code'
  | 'code_expired'
  | 'too_many_attempts'
  | 'cooldown_active'
  | 'server_error';

export type InvitationValidationResult =
  | { ok: true }
  | { ok: false; code: InvitationErrorCode; message: string };

export function maskInviteToken(token: string): string {
  const trimmed = token.trim();
  if (trimmed.length <= 8) return '****';
  return `${trimmed.slice(0, 4)}...${trimmed.slice(-4)}`;
}

export function normalizeInviteToken(raw: string): string | null {
  if (!raw) return null;
  const cleaned = String(raw).trim().replace(/[^a-f0-9]/gi, '');
  if (!cleaned || cleaned.length < 6 || cleaned.length > 64) return null;
  return cleaned.toLowerCase();
}

export function extractTokenFromInviteLink(link: string): string | null {
  const match = link.match(/\/(?:invite|client-admin\/signup)\/([a-f0-9]+)/i) ||
                link.match(/[?&]token=([a-f0-9]+)/i);
  if (!match?.[1]) return null;
  return normalizeInviteToken(match[1]);
}

export function hashValue(val: string): string {
  return crypto.createHash('sha256').update(String(val).trim()).digest('hex');
}

export function generateSecureToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

export function generateSmsCode(): string {
  return String(crypto.randomInt(100000, 999999));
}

export function timingSafeEqualStr(a: string, b: string): boolean {
  if (!a || !b) return false;
  const bufA = Buffer.from(a, 'utf-8');
  const bufB = Buffer.from(b, 'utf-8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

export function toIsoTimestamp(value: string | Date | null | undefined): string {
  if (value == null) return '';
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toISOString();
}

export function computeInvitationExpiry(createdAt: Date): Date {
  return new Date(createdAt.getTime() + INVITATION_TTL_MS);
}

export function isInvitationExpired(
  createdAt: string | Date,
  serverNow: Date = new Date(),
): boolean {
  const created = new Date(createdAt);
  if (Number.isNaN(created.getTime())) return true;
  return serverNow.getTime() > created.getTime() + INVITATION_TTL_MS;
}

export const EXPOSED_CANCELLED_TOKENS = new Set([
  '3a69e51f213a693b1530e5f8a1d97a75f428c2ab03cd2291c64c6c9f73ebd0bf',
]);

export function validateInvitationRecord(
  inv: Pick<InvitationRecord, 'token' | 'used' | 'created_at' | 'status' | 'access_expires_at'>,
  serverNow: Date = new Date(),
): InvitationValidationResult {
  if (inv.token && EXPOSED_CANCELLED_TOKENS.has(inv.token.toLowerCase())) {
    return {
      ok: false,
      code: 'expired',
      message: 'This invitation token has been invalidated and cancelled.',
    };
  }

  if (inv.used || inv.status === 'accepted') {
    return {
      ok: false,
      code: 'already_used',
      message: 'This invitation has already been used.',
    };
  }

  if (inv.status === 'cancelled') {
    return {
      ok: false,
      code: 'expired',
      message: 'This invitation has been cancelled.',
    };
  }

  const expiresAt = inv.access_expires_at ? new Date(inv.access_expires_at) : null;
  if (expiresAt && !Number.isNaN(expiresAt.getTime()) && serverNow > expiresAt) {
    return {
      ok: false,
      code: 'expired',
      message: 'This invitation link has expired.',
    };
  }

  if (isInvitationExpired(inv.created_at, serverNow)) {
    return {
      ok: false,
      code: 'expired',
      message: 'This invitation link has expired.',
    };
  }

  return { ok: true };
}

export function serializeInvitation(inv: InvitationRecord) {
  const createdAt = toIsoTimestamp(inv.created_at);
  const createdDate = new Date(createdAt);
  const expiresAt = inv.access_expires_at
    ? toIsoTimestamp(inv.access_expires_at)
    : Number.isNaN(createdDate.getTime())
      ? toIsoTimestamp(inv.expires_at)
      : computeInvitationExpiry(createdDate).toISOString();

  return {
    id: inv.id,
    token: inv.token,
    email: inv.email,
    name: inv.name,
    role: inv.role,
    createdAt,
    expiresAt,
    used: inv.used,
    companyName: inv.company_name,
    phone: inv.phone,
    planType: inv.plan_type ?? 'free',
    durationDays: inv.duration_days,
    status: inv.status ?? (inv.used ? 'accepted' : 'pending'),
  };
}

export function logInvitationDebug(
  event: string,
  details: {
    token: string;
    createdAt?: string | Date | null;
    expiresAt?: string | Date | null;
    serverNow?: Date;
    status?: string;
    code?: InvitationErrorCode;
    [key: string]: unknown;
  },
): void {
  if ((process.env.NODE_ENV ?? 'development') === 'production') return;

  const serverNow = details.serverNow ?? new Date();
  const createdAt = details.createdAt != null ? toIsoTimestamp(details.createdAt) : undefined;
  const expiresAt =
    createdAt && !Number.isNaN(new Date(createdAt).getTime())
      ? computeInvitationExpiry(new Date(createdAt)).toISOString()
      : details.expiresAt != null
        ? toIsoTimestamp(details.expiresAt)
        : undefined;

  console.log('[Auth][Invitation]', event, {
    token: maskInviteToken(details.token),
    createdAt,
    expiresAt,
    serverNow: serverNow.toISOString(),
    status: details.status,
    code: details.code,
  });
}
