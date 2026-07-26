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

  getCloudUsers: async () => {
    try {
      const { data } = await apiClient.get<{ success: boolean; data?: import('../types').User[] }>('/auth/users');
      return data.data ?? [];
    } catch {
      return [];
    }
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
