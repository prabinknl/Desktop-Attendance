// Auth, invitations and verification codes require the hosted backend: only it
// holds the SMTP credentials and the shared database. See ./cloudClient.
import cloudClient from './cloudClient';
import type { Invitation } from '../contexts/InvitationContext';
import {
  logInviteClientDebug,
  normalizeInviteToken,
  type InvitationLookupResult,
} from '../lib/inviteToken';
import {
  deliverClientAdminInviteEmail,
  verifyClientAdminInviteCode,
} from '../lib/clientAdminInvite';

interface SendCodeResponse {
  success: boolean;
  message?: string;
  emailSent?: boolean;
  email?: string;
  devCode?: string;
}

interface VerifyCodeResponse {
  success: boolean;
  verified?: boolean;
  message?: string;
  email?: string;
}

/** Accounts as returned by the API — always without the password field. */
type CloudUser = Omit<import('../types').User, 'password'>;

/** Server refused this login. Do not fall back to a local copy of the account. */
export class LoginRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LoginRejectedError';
  }
}

export const authApi = {
  sendAdminCode: async (input: { name: string; email?: string; emails?: string[] }) => {
    const { data } = await cloudClient.post<SendCodeResponse>('/auth/admin/send-code', input);
    return data;
  },

  verifyAdminCode: async (input: { email: string; code: string }) => {
    const { data } = await cloudClient.post<VerifyCodeResponse>('/auth/admin/verify-code', input);
    return data;
  },

  sendInviteEmail: async (input: { email: string; name?: string; role: string; inviteLink?: string; token?: string; code?: string }) => {
    const { data } = await cloudClient.post<{ success: boolean; message?: string; emailSent?: boolean; inviteLink?: string; code?: string }>(
      '/auth/admin/send-invite',
      input,
      { validateStatus: (status) => status < 500 || status === 503 }
    );
    return data;
  },

  getInvitation: async (token: string): Promise<InvitationLookupResult> => {
    const normalized = normalizeInviteToken(token);
    if (!normalized) {
      return {
        ok: false,
        reason: 'invalid_token',
        message: 'Invalid invitation token.',
      };
    }

    try {
      const { data, status } = await cloudClient.get<{
        success: boolean;
        code?: string;
        message?: string;
        data?: Invitation;
      }>(`/auth/invitations/${normalized}`, {
        validateStatus: (s) => s === 200 || s === 400 || s === 404 || s === 410 || s >= 500,
      });

      if (status === 200 && data.success && data.data) {
        logInviteClientDebug('validated', {
          token: normalized,
          createdAt: data.data.createdAt,
          expiresAt: data.data.expiresAt,
          status: 'valid',
        });
        return { ok: true, invitation: data.data };
      }

      const reason =
        data.code === 'invalid_token'
          ? 'invalid_token'
          : data.code === 'already_used'
            ? 'already_used'
            : data.code === 'expired'
              ? 'expired'
              : status === 404 || data.code === 'not_found'
                ? 'not_found'
                : 'server_error';

      logInviteClientDebug('rejected', {
        token: normalized,
        reason,
        status: reason,
      });

      return {
        ok: false,
        reason,
        message: data.message ?? 'Could not validate invitation.',
      };
    } catch (error) {
      logInviteClientDebug('network-error', {
        token: normalized,
        reason: 'network',
        status: 'network',
      });
      return {
        ok: false,
        reason: 'network',
        message: error instanceof Error ? error.message : 'Could not reach the server.',
      };
    }
  },

  markInvitationUsed: async (token: string) => {
    try {
      await cloudClient.post(`/auth/invitations/${token}/use`);
    } catch {
      /* ignore offline errors */
    }
  },

  /** Account list without passwords — the server never returns credentials. */
  getCloudUsers: async () => {
    try {
      const { data } = await cloudClient.get<{ success: boolean; data?: CloudUser[] }>('/auth/users');
      return data.data ?? [];
    } catch {
      return [];
    }
  },

  /**
   * Verify credentials server-side. Returns the account on success, null when
   * the credentials are unknown, and throws LoginRejectedError when the server
   * refuses the account (disabled company or unverified email). Network
   * failures still throw so the caller can fall back to the offline cache.
   */
  login: async (identifier: string, password: string) => {
    const { data, status } = await cloudClient.post<{ success: boolean; data?: CloudUser; message?: string }>(
      '/auth/login',
      { identifier, password },
      { validateStatus: (code) => code === 200 || code === 401 || code === 403 },
    );
    if (status === 403) {
      throw new LoginRejectedError(data.message || 'Login failed');
    }
    return data.success ? data.data ?? null : null;
  },

  /** Whether first-Owner setup is still open. Null when the server cannot be reached. */
  getOwnerBootstrapStatus: async () => {
    try {
      const { data } = await cloudClient.get<{
        success: boolean;
        ownerExists?: boolean;
        setupCodeRequired?: boolean;
      }>('/auth/owner/bootstrap');
      if (!data.success || typeof data.ownerExists !== 'boolean') return null;
      return { ownerExists: data.ownerExists, setupCodeRequired: Boolean(data.setupCodeRequired) };
    } catch {
      return null;
    }
  },

  bootstrapOwner: async (input: { name: string; email: string; password: string; setupCode?: string }) => {
    const { data } = await cloudClient.post<{ success: boolean; code?: string; message?: string; data?: CloudUser }>(
      '/auth/owner/bootstrap',
      input,
      { validateStatus: (s) => s === 201 || s === 400 || s === 403 || s === 409 || s === 503 },
    );
    return data;
  },

  createClientAdminInvite: async (input: {
    email: string;
    phone: string;
    companyName?: string;
    planType: 'free' | 'paid';
    durationDays: number;
  }) => {
    try {
      const { data } = await cloudClient.post<{
        success: boolean;
        emailSent?: boolean;
        smsSent?: boolean;
        message?: string;
        inviteLink?: string;
        devSmsCode?: string;
      }>('/auth/client-admin/invite', input, {
        validateStatus: (status) => status < 500 || status === 503,
      });
      if (data) {
        return data;
      }
    } catch (err) {
      return {
        success: false,
        emailSent: false,
        message: err instanceof Error ? err.message : 'Could not reach the server to send the invitation email.',
      };
    }

    // OBSOLETE InsForge fallback — only used when Hostinger API returned no body.
    return deliverClientAdminInviteEmail(input);
  },

  validateClientAdminInvite: async (token: string): Promise<InvitationLookupResult> => {
    const normalized = normalizeInviteToken(token);
    if (!normalized) {
      return { ok: false, reason: 'invalid_token', message: 'Invalid invitation token.' };
    }

    try {
      const { data, status } = await cloudClient.get<{
        success: boolean;
        code?: string;
        message?: string;
        data?: Invitation;
      }>('/auth/client-admin/invitations/validate', {
        params: { token: normalized },
        validateStatus: (s) => s === 200 || s === 400 || s === 404 || s === 410 || s >= 500,
      });

      if (status === 200 && data.success && data.data) {
        logInviteClientDebug('validated-client-admin', {
          token: normalized,
          createdAt: data.data.createdAt,
          expiresAt: data.data.expiresAt,
          status: 'valid',
        });
        return { ok: true, invitation: data.data };
      }

      const reason =
        data.code === 'invalid_token'
          ? 'invalid_token'
          : data.code === 'already_used'
            ? 'already_used'
            : data.code === 'expired'
              ? 'expired'
              : status === 404 || data.code === 'not_found'
                ? 'not_found'
                : 'server_error';

      return { ok: false, reason, message: data.message ?? 'Could not validate invitation.' };
    } catch (error) {
      return {
        ok: false,
        reason: 'network',
        message: error instanceof Error ? error.message : 'Could not reach server.',
      };
    }
  },

  resendClientAdminSms: async (token: string) => {
    const { data } = await cloudClient.post<{
      success: boolean;
      smsSent?: boolean;
      code?: string;
      message?: string;
      remainingSeconds?: number;
      devSmsCode?: string;
    }>('/auth/client-admin/resend-sms', { token }, {
      validateStatus: (s) => s === 200 || s === 400 || s === 404 || s === 410 || s === 429 || s >= 500,
    });
    return data;
  },

  signupClientAdmin: async (input: {
    token: string;
    name: string;
    password: string;
    smsCode: string;
  }) => {
    const { data } = await cloudClient.post<{
      success: boolean;
      code?: string;
      message?: string;
      data?: CloudUser;
    }>('/auth/client-admin/signup', input, {
      validateStatus: (s) => s === 200 || s === 400 || s === 404 || s === 410 || s === 429 || s >= 500,
    });
    return data;
  },

  syncCloudUser: async (user: import('../types').User) => {
    try {
      const { data } = await cloudClient.post<{ success: boolean; data?: import('../types').User }>('/auth/users/sync', user);
      return data.data ?? null;
    } catch {
      return null;
    }
  },

  purgeAdminAccount: async (email: string) => {
    const { data } = await cloudClient.post<{
      success: boolean;
      purgedEmail?: string;
      message?: string;
    }>('/auth/admin-accounts/purge', { email }, {
      validateStatus: (s) => s === 200 || s === 400 || s === 404 || s >= 500,
    });
    return data;
  },

  deleteStaffAccess: async (email: string) => {
    const { data } = await cloudClient.post<{
      success: boolean;
      deletedEmail?: string;
      message?: string;
    }>('/auth/users/delete', { email }, {
      validateStatus: (s) => s === 200 || s === 400 || s === 404 || s >= 500,
    });
    return data;
  },

  verifyAdminSignupInvite: async (input: { invitationCode: string; phone: string }) => {
    try {
      const { data } = await cloudClient.post<{
        success: boolean;
        message?: string;
        invitation?: {
          invitationToken: string;
          companyName: string;
          invitedEmail: string;
          invitingOwner: string;
          packageDuration: string;
          phone: string;
        };
      }>('/auth/admin-signup/verify-invitation', input, {
        validateStatus: (s) => s === 200 || s === 400 || s === 404 || s === 410 || s >= 500,
      });
      if (data) {
        return data;
      }
    } catch {
      /* Hostinger unreachable — OBSOLETE InsForge OTP verification may still run if enabled. */
    }

    return verifyClientAdminInviteCode(input);
  },

  submitAdminSignup: async (input: { invitationToken: string; name: string; password: string; phone: string }) => {
    const { data } = await cloudClient.post<{
      success: boolean;
      message?: string;
      emailSent?: boolean;
      email?: string;
      devCode?: string;
    }>('/auth/admin-signup/submit', input, {
      validateStatus: (s) => s === 200 || s === 400 || s === 404 || s === 410 || s === 429 || s >= 500,
    });
    return data;
  },

  verifyAdminSignupEmail: async (input: { email: string; code: string; invitationToken?: string }) => {
    const { data } = await cloudClient.post<{
      success: boolean;
      message?: string;
    }>('/auth/admin-signup/verify-email', input, {
      validateStatus: (s) => s === 200 || s === 400 || s === 404 || s >= 500,
    });
    return data;
  },

  resendAdminSignupEmail: async (input: { email: string; invitationToken?: string }) => {
    const { data } = await cloudClient.post<{
      success: boolean;
      message?: string;
      emailSent?: boolean;
      devCode?: string;
    }>('/auth/admin-signup/resend-email', input, {
      validateStatus: (s) => s === 200 || s === 400 || s === 429 || s >= 500,
    });
    return data;
  },

  getInvitationsByRole: async (role: string) => {
    try {
      const { data } = await cloudClient.get<{
        success: boolean;
        data?: Array<{
          token: string;
          email: string;
          name?: string;
          role: string;
          status: string;
          createdAt: string;
          expiresAt: string;
          used: boolean;
        }>;
        message?: string;
      }>(`/auth/invitations/by-role/${role}`);
      return data.success ? data.data ?? [] : [];
    } catch {
      return [];
    }
  },
};

