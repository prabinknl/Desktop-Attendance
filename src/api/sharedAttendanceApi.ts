/**
 * Attendance stored on the shared Hostinger API so every signed-in user,
 * on every computer, sees the records an admin saved.
 * The local API client stays for the office machine. This client is used
 * only when it points somewhere else.
 */
import cloudClient, { CLOUD_API_BASE_URL } from './cloudClient';
import { API_BASE_URL } from './client';
import type { Attendance } from '../types';

interface ApiResponse<T> {
  success: boolean;
  data?: T;
}

export function attendanceIsShared(): boolean {
  const local = API_BASE_URL.replace(/\/$/, '');
  const cloud = CLOUD_API_BASE_URL.replace(/\/$/, '');
  return cloud.startsWith('http') && cloud !== local;
}

export const sharedAttendanceApi = {
  async getAll(): Promise<Attendance[]> {
    const { data } = await cloudClient.get<ApiResponse<Attendance[]>>('/attendance');
    return data.data ?? [];
  },

  async upsert(record: Attendance): Promise<void> {
    await cloudClient.post('/attendance/upsert', record);
  },

  async delete(id: string): Promise<void> {
    await cloudClient.delete(`/attendance/${id}`);
  },
};
