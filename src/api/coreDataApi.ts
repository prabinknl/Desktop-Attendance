/**
 * Frontend client for the entities stored in the cloud PostgreSQL database:
 * employees, departments, shifts, holidays, leave requests and punch requests.
 * These used to live only in localStorage, which meant every browser had its
 * own copy. Callers should catch errors and fall back to the local cache when
 * the server is unreachable.
 */
import apiClient from './client';
import type {
  Department, Employee, Holiday, LeaveRequest, PunchTimeRequest, Shift,
} from '../types';

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  count?: number;
  message?: string;
}

type Resource = 'departments' | 'shifts' | 'holidays' | 'employees' | 'leaves' | 'punch-requests';

function resourceApi<T extends { id: string }>(resource: Resource) {
  return {
    async getAll(): Promise<T[]> {
      const { data } = await apiClient.get<ApiResponse<T[]>>(`/data/${resource}`);
      return data.data ?? [];
    },

    /** Insert, or overwrite every field when the id already exists. */
    async upsert(record: T): Promise<T | null> {
      const { data } = await apiClient.post<ApiResponse<T>>(`/data/${resource}`, record);
      return data.data ?? null;
    },

    async bulkUpsert(records: T[]): Promise<T[]> {
      const { data } = await apiClient.post<ApiResponse<T[]>>(`/data/${resource}/bulk`, { records });
      return data.data ?? [];
    },

    async update(id: string, patch: Partial<T>): Promise<T | null> {
      const { data } = await apiClient.patch<ApiResponse<T>>(`/data/${resource}/${id}`, patch);
      return data.data ?? null;
    },

    async delete(id: string): Promise<void> {
      await apiClient.delete(`/data/${resource}/${id}`);
    },
  };
}

export const cloudDepartmentApi = resourceApi<Department>('departments');
export const cloudShiftApi = resourceApi<Shift>('shifts');
export const cloudHolidayApi = resourceApi<Holiday>('holidays');
export const cloudEmployeeApi = resourceApi<Employee>('employees');
export const cloudLeaveApi = resourceApi<LeaveRequest>('leaves');
export const cloudPunchRequestApi = resourceApi<PunchTimeRequest>('punch-requests');
