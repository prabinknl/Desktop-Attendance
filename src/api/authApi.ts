import apiClient from './client';

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

export const authApi = {
  sendAdminCode: async (input: { name: string; email: string }) => {
    const { data } = await apiClient.post<SendCodeResponse>('/auth/admin/send-code', input);
    return data;
  },

  verifyAdminCode: async (input: { email: string; code: string }) => {
    const { data } = await apiClient.post<VerifyCodeResponse>('/auth/admin/verify-code', input);
    return data;
  },

  sendInviteEmail: async (input: { email: string; role: string; inviteLink: string }) => {
    const { data } = await apiClient.post<{ success: boolean; message?: string; emailSent?: boolean }>('/auth/admin/send-invite', input);
    return data;
  },

  /** Account list without passwords — the server never returns credentials. */
  getCloudUsers: async () => {
    try {
      const { data } = await apiClient.get<{ success: boolean; data?: CloudUser[] }>('/auth/users');
      return data.data ?? [];
    } catch {
      return [];
    }
  },

  /**
   * Verify credentials server-side. Returns the account on success, null when
   * rejected, and throws when the server cannot be reached so the caller can
   * fall back to the offline account cache.
   */
  login: async (identifier: string, password: string) => {
    const { data } = await apiClient.post<{ success: boolean; data?: CloudUser }>(
      '/auth/login',
      { identifier, password },
      { validateStatus: (status) => status === 200 || status === 401 },
    );
    return data.success ? data.data ?? null : null;
  },

  syncCloudUser: async (user: import('../types').User) => {
    try {
      const { data } = await apiClient.post<{ success: boolean; data?: import('../types').User }>('/auth/users/sync', user);
      return data.data ?? null;
    } catch {
      return null;
    }
  },
};
