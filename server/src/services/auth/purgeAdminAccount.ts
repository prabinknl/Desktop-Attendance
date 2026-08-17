import { UserModel } from '../../models/UserModel.js';
import { InvitationModel } from '../../models/InvitationModel.js';
import { clearVerificationCode } from './adminVerification.js';

const PROTECTED_EMAILS = new Set([
  'noreply@appnep.com',
  'appnep@pacenp.com',
  'bpkhanal.app@gmail.com',
]);

export function isProtectedAccountEmail(email: string): boolean {
  return PROTECTED_EMAILS.has(email.trim().toLowerCase());
}

/**
 * Wipe every auth record tied to this email so the address can complete a
 * brand-new admin signup (new user id, invitations, and verification codes).
 */
export async function purgeAdminAccountByEmail(
  email: string,
  options?: { keepInvitations?: boolean },
): Promise<{
  ok: boolean;
  message?: string;
  purgedEmail?: string;
}> {
  const key = email.trim().toLowerCase();
  if (!key) {
    return { ok: false, message: 'Email is required.' };
  }
  if (isProtectedAccountEmail(key)) {
    return { ok: false, message: 'Owner accounts cannot be deleted.' };
  }

  const existing = await UserModel.getByEmail(key);
  if (existing?.role === 'owner') {
    return { ok: false, message: 'Owner accounts cannot be deleted.' };
  }

  if (!options?.keepInvitations) {
    await InvitationModel.deleteByEmail(key);
  }
  clearVerificationCode(key);
  await UserModel.purgeOrganizationByEmail(key);

  return { ok: true, purgedEmail: key };
}
