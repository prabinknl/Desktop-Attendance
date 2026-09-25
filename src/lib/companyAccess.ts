/**
 * Company access is stored on the user row, not in a separate companies table.
 * `app_users.status` defaults to `active`. The owner disables a company by
 * setting that status to `deleted` (browser copy: `ams_deleted_clients`).
 *
 * An archived email or a shared display name is not a disabled company.
 * This module never changes a deleted account back to active.
 */

export const COMPANY_DISABLED_MESSAGE =
  'Your company account has been disabled. Please contact the application owner.';

export const INVALID_LOGIN_MESSAGE = 'Invalid user name or password';

export interface CompanyAccount {
  id?: string;
  name?: string;
  email: string;
  role?: string;
  status?: string | null;
  clientId?: string | null;
  companyName?: string | null;
  employeeId?: string | null;
  password?: string;
}

export function isDeletedStatus(status?: string | null): boolean {
  return String(status ?? '').toLowerCase() === 'deleted';
}

function sameId(a?: { id?: string }, b?: { id?: string }): boolean {
  return Boolean(a?.id && b?.id && a.id === b.id);
}

/** Disabled only when this account, or the client org it belongs to, is deleted. */
export function companyDisabledMessage(
  account: CompanyAccount,
  directory: CompanyAccount[],
): string | null {
  if (account.role === 'owner') return null;
  if (isDeletedStatus(account.status)) return COMPANY_DISABLED_MESSAGE;
  if (account.clientId) {
    const parent = directory.find((user) => user.role === 'client' && user.id === account.clientId);
    if (parent && isDeletedStatus(parent.status)) return COMPANY_DISABLED_MESSAGE;
  }
  return null;
}

/**
 * Status to keep when a local signup, the cloud row, and the deleted-company
 * archive all refer to one email.
 *
 * A deleted status stays deleted when it is the same account the owner disabled.
 * A newer account (different id) that is already active is not marked deleted
 * just because an older archive shares the email.
 */
export function resolveAccountStatus(input: {
  local?: CompanyAccount;
  cloud?: CompanyAccount;
  archived?: CompanyAccount;
}): { status: string; releaseArchive: boolean } {
  const { local, cloud, archived } = input;
  if (local?.role === 'owner' || (!local && cloud?.role === 'owner')) {
    return { status: local?.status || cloud?.status || 'active', releaseArchive: false };
  }

  const cloudDeleted = Boolean(cloud && isDeletedStatus(cloud.status));
  const localDeleted = Boolean(local && isDeletedStatus(local.status));

  // Owner disabled this exact account locally. A cloud row that is still
  // active has not caught up, and must not restore it.
  if (local && localDeleted && (!cloud || sameId(cloud, local) || !cloud.id || !local.id)) {
    return { status: 'deleted', releaseArchive: false };
  }

  // Server disabled this exact account.
  if (cloud && cloudDeleted && (!local || sameId(cloud, local) || !cloud.id || !local.id)) {
    return { status: 'deleted', releaseArchive: false };
  }

  // Removed from the active directory and archived under this same id.
  if (!local && cloud && !cloudDeleted && archived && sameId(archived, cloud)) {
    return { status: 'deleted', releaseArchive: false };
  }

  const live = (cloud && !cloudDeleted ? cloud : undefined) ?? (local && !localDeleted ? local : undefined);
  if (!live) return { status: 'deleted', releaseArchive: false };

  const archiveIsOtherAccount = Boolean(archived?.id && live.id && archived.id !== live.id);
  const status = live.status && !isDeletedStatus(live.status) ? String(live.status) : 'active';
  return { status, releaseArchive: archiveIsOtherAccount };
}

function matchesIdentifier(account: CompanyAccount, identifier: string): boolean {
  const key = identifier.trim().toLowerCase();
  if (!key) return false;
  return (
    account.email.trim().toLowerCase() === key ||
    (account.name ?? '').trim().toLowerCase() === key ||
    Boolean(account.employeeId && account.employeeId.trim().toLowerCase() === key)
  );
}

/**
 * Offline / local credential check. Archive name or email collisions do not
 * reject a different active account. A deleted account stays rejected.
 */
export function localLoginDecision(
  identifier: string,
  password: string,
  users: CompanyAccount[],
  archived: CompanyAccount[],
): { allowed: true; account: CompanyAccount } | { allowed: false; error: string } {
  const passwordMatches = (list: CompanyAccount[]) =>
    list.filter((user) => matchesIdentifier(user, identifier) && user.password === password);

  const activeMatch = passwordMatches(users).find((user) => !isDeletedStatus(user.status));
  const deletedMatch = [
    ...passwordMatches(users).filter((user) => isDeletedStatus(user.status)),
    ...passwordMatches(archived),
  ][0];
  const found = activeMatch ?? deletedMatch;
  if (!found) return { allowed: false, error: INVALID_LOGIN_MESSAGE };

  const message = companyDisabledMessage(found, [...users, ...archived]);
  if (message) return { allowed: false, error: message };
  return { allowed: true, account: found };
}
