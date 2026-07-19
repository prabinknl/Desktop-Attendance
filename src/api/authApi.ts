import apiClient from './client';

interface SendCodeResponse {
  success: boolean;
  message?: string;
  emailSent?: boolean;
  email?: string;
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
};
