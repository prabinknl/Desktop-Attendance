/** Client-side invite token helpers (mirrors server validation shape). */

const TOKEN_PATTERN = /^[a-f0-9]{6,64}$/i;

export function normalizeInviteToken(raw: string): string | null {
  const trimmed = raw.trim();
  if (!TOKEN_PATTERN.test(trimmed)) return null;
  return trimmed.toLowerCase();
}

export function extractTokenFromInviteLink(link: string): string | null {
  const match = link.match(/\/(?:invite|client-admin\/signup)\/([a-f0-9]+)/i) ||
                link.match(/[?&]token=([a-f0-9]+)/i);
  if (!match?.[1]) return null;
  return normalizeInviteToken(match[1]);
}

/** Read an invite token from hash or path-style desktop/browser URLs. */
export function extractInviteTokenFromLocation(location: Pick<Location, 'hash' | 'pathname' | 'search'>): string | null {
  const fullStr = `${location.pathname}${location.search}${location.hash}`;
  const match = fullStr.match(/[?&]token=([a-f0-9]{6,64})/i) ||
                fullStr.match(/\/(?:invite|client-admin\/signup)\/([a-f0-9]{6,64})/i);
  if (match?.[1]) return normalizeInviteToken(match[1]);
  return null;
}

export function maskInviteToken(token: string): string {
  const trimmed = token.trim();
  if (trimmed.length <= 6) return trimmed;
  if (trimmed.length <= 8) return '****';
  return `${trimmed.slice(0, 4)}...${trimmed.slice(-4)}`;
}

export type InvitationErrorReason =
  | 'invalid_token'
  | 'not_found'
  | 'expired'
  | 'already_used'
  | 'network'
  | 'server_error';

export type InvitationLookupResult =
  | { ok: true; invitation: import('../contexts/InvitationContext').Invitation }
  | { ok: false; reason: InvitationErrorReason; message: string };

export function logInviteClientDebug(
  event: string,
  details: {
    token: string;
    createdAt?: string;
    expiresAt?: string;
    status?: string;
    reason?: InvitationErrorReason;
  },
): void {
  if (import.meta.env.PROD) return;
  console.log('[Invite]', event, {
    token: maskInviteToken(details.token),
    createdAt: details.createdAt,
    expiresAt: details.expiresAt,
    serverNow: new Date().toISOString(),
    status: details.status,
    reason: details.reason,
  });
}
