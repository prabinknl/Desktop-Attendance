/**
 * Frontend API client for the cloud attendance persistence layer.
 * Talks to the Express server which writes to PostgreSQL (InsForge cloud DB).
 * All methods are fire-and-forget safe — callers should catch errors and
 * fall back to localStorage if the server is unreachable.
 */
import apiClient from './client';
import type { Attendance } from '../types';

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  count?: number;
  message?: string;
}

export const cloudAttendanceApi = {
  /** Fetch all attendance records from the cloud DB. */
  async getAll(): Promise<Attendance[]> {
    const { data } = await apiClient.get<ApiResponse<Attendance[]>>('/attendance');
    return data.data ?? [];
  },

  /** Upsert a single record (insert or update by employee+date). */
  async upsert(record: Attendance): Promise<Attendance | null> {
    const { data } = await apiClient.post<ApiResponse<Attendance>>('/attendance/upsert', record);
    return data.data ?? null;
  },

  /** Bulk upsert many records at once. */
  async bulkUpsert(records: Omit<Attendance, 'id' | 'createdAt' | 'updatedAt'>[]): Promise<Attendance[]> {
    const { data } = await apiClient.post<ApiResponse<Attendance[]>>('/attendance/bulk-upsert', { records });
    return data.data ?? [];
  },

  /** Partially update a record by its id. */
  async update(id: string, patch: Partial<Attendance>): Promise<Attendance | null> {
    const { data } = await apiClient.patch<ApiResponse<Attendance>>(`/attendance/${id}`, patch);
    return data.data ?? null;
  },

  /** Bulk update multiple records with the same patch. */
  async updateMany(ids: string[], patch: Partial<Attendance>): Promise<Attendance[]> {
    const { data } = await apiClient.post<ApiResponse<Attendance[]>>('/attendance/bulk-update', { ids, patch });
    return data.data ?? [];
  },

  /** Delete a record by its id. */
  async delete(id: string): Promise<void> {
    await apiClient.delete(`/attendance/${id}`);
  },
};
