import { describe, expect, it } from 'vitest';
import {
  COMPANY_DISABLED_MESSAGE,
  companyDisabledMessage,
  localLoginDecision,
  resolveAccountStatus,
} from './companyAccess';

const archivedCompany = {
  id: 'client-old',
  name: 'Khanal BP',
  email: 'new.admin@example.com',
  role: 'admin' as const,
  status: 'deleted' as const,
  password: 'old-password',
  companyName: 'Khanal BP',
  clientId: 'client-org-old',
};

describe('signup then login while an older company archive exists', () => {
  it('lets a verified active admin sign in when an archived company shares the name and email', () => {
    const activeAdmin = {
      id: 'usr-new',
      name: 'Khanal BP',
      email: 'new.admin@example.com',
      role: 'admin' as const,
      status: 'active' as const,
      password: 'new-password',
      companyName: 'Khanal BP',
      clientId: 'client-org-new',
    };

    const decision = localLoginDecision('Khanal BP', 'new-password', [activeAdmin], [archivedCompany]);

    expect(decision.allowed).toBe(true);
    if (decision.allowed) expect(decision.account.id).toBe('usr-new');
    expect(companyDisabledMessage(activeAdmin, [activeAdmin, archivedCompany])).toBeNull();
  });

  it('does not treat a shared company name as a disabled parent', () => {
    const deletedClient = {
      id: 'client-1',
      name: 'Old Org',
      email: 'old@example.com',
      role: 'client' as const,
      status: 'deleted' as const,
      password: 'x',
      companyName: 'Khanal BP',
    };
    const admin = {
      id: 'usr-new',
      name: 'Khanal BP',
      email: 'new.admin@example.com',
      role: 'admin' as const,
      status: 'active' as const,
      password: 'new-password',
      companyName: 'Khanal BP',
    };

    expect(localLoginDecision('Khanal BP', 'new-password', [admin, deletedClient], []).allowed).toBe(true);
  });

  it('keeps a deliberately deleted company from signing in', () => {
    const decision = localLoginDecision('Khanal BP', 'old-password', [], [archivedCompany]);
    expect(decision).toEqual({ allowed: false, error: COMPANY_DISABLED_MESSAGE });
  });

  it('keeps an admin out when their client organization is deleted', () => {
    const deletedClient = {
      id: 'client-org-old',
      name: 'Old Org',
      email: 'org@example.com',
      role: 'client' as const,
      status: 'deleted' as const,
      password: 'org-password',
    };
    const admin = {
      id: 'usr-linked',
      name: 'Office Admin',
      email: 'office@example.com',
      role: 'admin' as const,
      status: 'active' as const,
      password: 'office-password',
      clientId: 'client-org-old',
    };

    const decision = localLoginDecision('Office Admin', 'office-password', [admin], [deletedClient]);
    expect(decision).toEqual({ allowed: false, error: COMPANY_DISABLED_MESSAGE });
  });

  it('does not turn a deleted account active when the cloud copy is stale', () => {
    expect(
      resolveAccountStatus({
        local: { id: 'client-old', email: archivedCompany.email, role: 'admin', status: 'deleted' },
        cloud: { id: 'client-old', email: archivedCompany.email, role: 'admin', status: 'active' },
        archived: archivedCompany,
      }),
    ).toEqual({ status: 'deleted', releaseArchive: false });
  });

  it('does not restore a deleted account that was removed from the active directory', () => {
    expect(
      resolveAccountStatus({
        cloud: { id: 'client-old', email: archivedCompany.email, role: 'admin', status: 'active' },
        archived: archivedCompany,
      }),
    ).toEqual({ status: 'deleted', releaseArchive: false });
  });

  it('keeps a later active signup when the cloud row is still the old deleted company', () => {
    expect(
      resolveAccountStatus({
        local: { id: 'usr-new', email: archivedCompany.email, role: 'admin', status: 'active' },
        cloud: { id: 'client-old', email: archivedCompany.email, role: 'admin', status: 'deleted' },
        archived: archivedCompany,
      }),
    ).toEqual({ status: 'active', releaseArchive: true });
  });
});
